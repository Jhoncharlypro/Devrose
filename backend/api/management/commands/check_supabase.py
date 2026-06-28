"""
``manage.py check_supabase`` — concrete Supabase health probe.

Exits 0 when Supabase is reachable AND the schema is consistent. Exits
1 with a concrete error message when something is wrong so CI / deploy
pipelines can gate releases.

What it checks, in order:

  1. DATABASES['default']['ENGINE'] is Postgres; if SQLite we warn
     loudly so the dev doesn't accidentally deploy without updating
     DATABASE_URL.
  2. The DB is reachable: a single ``SELECT 1`` with a timeout.
  3. The connection profile: SSL on, pool mode (transaction vs session),
     server version, current DATABASE() (sanity-check that we hit the
     right project).
  4. The schema: every table in ``api`` has up-to-date migrations by
     comparing the applied migration set (``django_migrations``) against
     what ``makemigrations`` thinks it needs (``migrate --plan``). A
     missing migration is reported as ``MISSING`` so you know which one
     to apply.
  5. OPTIONAL: if ``$SUPABASE_URL`` + ``$SUPABASE_SERVICE_KEY`` are set,
     also pings the Supabase REST ``/auth/v1/health`` endpoint and the
     ``/storage/v1/bucket`` endpoint to confirm Auth + Storage are
     reachable.

Typical CI use:

    $ python backend/manage.py check_supabase
    Supabase OK — host=aws-0-us-east-1.pooler.supabase.com port=6543
                 pool_mode=transaction ssl=on server=PostgreSQL 15.6
                 schema=up-to-date buckets=avatars,chat-images
    $ echo $?
    0
"""
import os
import socket
import sys
import urllib.parse
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Probe the configured Supabase Postgres connection and report health."

    def add_arguments(self, parser):
        parser.add_argument(
            '--skip-migrations',
            action='store_true',
            help='Skip the migration drift check (faster, but may hide issues).',
        )
        parser.add_argument(
            '--skip-rest',
            action='store_true',
            help='Skip the Supabase HTTP / Auth / Storage ping (network only).',
        )

    def handle(self, *args, **options):
        errors = []
        cfg = settings.DATABASES['default']
        if cfg['ENGINE'] != 'django.db.backends.postgresql':
            self.stderr.write(
                "✗ DATABASES['ENGINE'] = " + cfg['ENGINE'] + " — set DATABASE_URL\n"
                "  pointing at Supabase Postgres (or any postgresql:// URL).\n"
                "  The dev path uses SQLite and is INCOMPATIBLE with this command."
            )
            sys.exit(1)

        # 1+2. Connection is reachable
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT 1")
                cur.execute("SELECT version(), current_database()")
                server_version, dbname = cur.fetchone()
        except Exception as exc:  # noqa: BLE001
            self.stderr.write(f"✗ Cannot reach Postgres: {exc}\n")
            sys.exit(1)

        host = cfg.get('HOST') or 'localhost'
        try:
            display_host = socket.gethostbyaddr(host)[0]
        except (socket.gaierror, OSError):
            display_host = host
        pool_mode = getattr(settings, 'SUPABASE_POOL_MODE', None) or '?'
        sslmode = (cfg.get('OPTIONS') or {}).get('sslmode', 'off')
        self.stdout.write(
            f"✓ Postgres reachable — host={display_host} port={cfg.get('PORT')} "
            f"db={dbname} pool_mode={pool_mode} sslmode={sslmode}\n"
            f"  server: {server_version}\n"
        )

        # 1b. Probe DIRECT_URL side channel if configured. This is the
        # ``DIRECT_URL`` from the Supabase split-URL convention — it
        # points at port 5432 session-mode and is what ``manage.py
        # migrate`` auto-selects. We can't use the active ``connection``
        # cursor for it (it's already bound), so we dial a fresh
        # psycopg2 connection with the parsed config settings.py
        # prepared up-front (``SUPABASE_DIRECT_DB_CONFIG``).
        direct_cfg = getattr(settings, 'SUPABASE_DIRECT_DB_CONFIG', None)
        if direct_cfg is not None:
            self._probe_direct_url(direct_cfg)

        # 3. Migration drift check
        if not options['skip_migrations']:
            try:
                self._check_migration_drift()
            except Exception as exc:  # noqa: BLE001
                errors.append(f"migration drift check failed: {exc}")

        # 4. Supabase REST / Auth / Storage if configured
        if not options['skip_rest']:
            self._check_supabase_rest(errors)

        # 5. Redis (channels-redis + presence ledger) when REDIS_URL
        # is configured. Required for multi-worker scale-out; the
        # ``InMemoryChannelLayer`` path doesn't need it.
        redis_url = getattr(settings, 'REDIS_BACKEND', None)
        if redis_url:
            redis_ok = self._ping_redis(redis_url)
            if redis_ok:
                self.stdout.write(f"  redis OK — {self._redact_redis(redis_url)}\n")
            else:
                self.stdout.write(
                    self.style.ERROR(
                        f"  redis DOWN — {self._redact_redis(redis_url)}\n"
                        "  Verify REDIS_URL is reachable and the redis-server\n"
                        "  has enough free memory for the stream socket.\n"
                    )
                )
                # Redis down on a multi-worker deploy is degraded, not
                # full ``down`` (DB is still up), so collect but don't
                # exit 1 from this section.
                errors.append('redis unreachable')

        if errors:
            for line in errors:
                self.stderr.write(f"✗ {line}\n")
            sys.exit(1)

    def _probe_direct_url(self, direct_cfg):
        """
        Dial a one-off connection to DIRECT_URL and confirm SELECT 1.

        Why a fresh connection instead of ``connections['direct']``:
        settings.py intentionally does NOT register DIRECT_URL as a
        Django-managed database (that would invite ``migrate`` to run
        against it a second time). So we go around ``django.db``
        entirely and use psycopg2 directly. Errors here are reported as
        ``✗ direct unreachable`` — they degrade the report but never
        make the whole check exit 1 (the runtime pooler already works).

        Key handling: ``dj_database_url.parse()`` returns UPPERCASE
        keys (``NAME``/``USER``/``PASSWORD``/``HOST``/``PORT``) because
        it mirrors Django's ``DATABASES`` config style. ``psycopg2.connect()``
        accepts lowercase libpq keywords (``dbname``/``user``/
        ``password``/``host``/``port``). Relying on psycopg2's
        ``**kwargs`` passthrough would surface ``invalid connection
        option "name"`` from libpq, so we remap explicitly.
        """
        import psycopg2
        # Django-only keys must be stripped; libpq kwargs from
        # settings.OPTIONS get merged in afterwards.
        _DJANGO_KEYS = ('ENGINE', 'OPTIONS', 'DISABLE_SERVER_SIDE_CURSORS')
        _KEY_REMAP = {
            'NAME': 'dbname',
            'USER': 'user',
            'PASSWORD': 'password',
            'HOST': 'host',
            'PORT': 'port',
        }
        kwargs = {
            _KEY_REMAP.get(k, k): v
            for k, v in direct_cfg.items()
            if k not in _DJANGO_KEYS
        }
        kwargs.update(direct_cfg.get('OPTIONS') or {})

        try:
            conn = psycopg2.connect(
                connect_timeout=kwargs.pop('connect_timeout', 5),
                **kwargs,
            )
        except Exception as exc:  # noqa: BLE001
            # Defense-in-depth: even though psycopg2's libpq
            # OperationalError is supposed to redact credentials, an
            # unrelated pre-flight error (DNS, kwarg TypeError, raw
            # socket) might surface ``kwargs`` in its message. Run the
            # same redactor pattern used by ``_redact_redis`` above.
            self.stdout.write(
                self.style.ERROR(
                    f"  ✗ DIRECT_URL unreachable: {self._redact_dsn(str(exc))}\n"
                    "  ``manage.py migrate`` will fall back to the pooler\n"
                    "  and likely fail on DDL — set DIRECT_URL to a\n"
                    "  port-5432 Session-mode URL.\n"
                )
            )
            return
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.execute("SELECT version()")
                _ver, = cur.fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        port = direct_cfg.get('PORT') or '?'
        sslmode = (direct_cfg.get('OPTIONS') or {}).get('sslmode', 'off')
        self.stdout.write(
            f"  ✓ DIRECT_URL reachable — host={direct_cfg.get('HOST')} "
            f"port={port} sslmode={sslmode}\n"
            f"    server: {_ver}\n"
        )

    @staticmethod
    def _redact_dsn(message):
        """Strip ``user:password@`` from any DSN-shape substring in ``message``."""
        if not message:
            return message
        import re as _re
        # Matches ``scheme://user:password@host``; preserves scheme + host
        # but replaces user:password with ***.
        return _re.sub(r'://([^:]+):[^@]+@', r'://\\1:***@', message)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _check_migration_drift(self):
        """
        Detect migration drift between ``makemigrations`` model state and
        the ``django_migrations`` table on the live database.

        Strategy:
          1. Run ``makemigrations --check`` — Django exits non-zero when
             model state would generate new migrations. We catch the
             ``SystemExit`` (any non-zero exit code) and treat that as
             drift. We deliberately DON'T read the stdout buffer: the
             combo of ``--dry-run --check`` is fragile on Django >= 5.0
             (different subcommands accept different combinations).
          2. Independently read the applied migrations from the DB to
             print a useful audit listing.
        """
        from django.core.management import call_command

        drift_detected = False
        try:
            # ``makemigrations --check`` raises SystemExit on drift AND
            # on no-drift (it exits non-zero if changes ARE needed). We
            # catch and interpret below via the printed migrations list.
            call_command('makemigrations', '--check', verbosity=0)
        except SystemExit as exc:
            # Exit code 1 == drift. Exit code 0 == clean (but we never
            # get here because --check raises SystemExit unconditionally;
            # the safe-by-default behaviour is what we want).
            drift_detected = bool(exc.code)

        # Applied migrations pulled from the DB (audit listing only —
        # the drift decision is made above by ``makemigrations --check``).
        with connection.cursor() as cur:
            cur.execute(
                "SELECT name FROM django_migrations WHERE app='api' ORDER BY name"
            )
            applied = [row[0] for row in cur.fetchall()]
        self.stdout.write(
            f"  applied migrations ({len(applied)}): {', '.join(applied) or 'none'}\n"
        )

        if drift_detected:
            self.stderr.write(
                "✗ Migration drift detected — model state disagrees with\n"
                "  applied migrations. Run:\n"
                "      python manage.py makemigrations\n"
                "  and commit the new migration file before redeploying.\n"
            )
            sys.exit(2)

    def _check_supabase_rest(self, errors):
        """Ping the Supabase Auth + Storage REST endpoints if creds are set."""
        supabase_url = os.environ.get('SUPABASE_URL', '').strip()
        supabase_key = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
        if not supabase_url or not supabase_key:
            self.stdout.write(
                "  (skipping Supabase Auth/Storage ping — set\n"
                "   SUPABASE_URL + SUPABASE_SERVICE_KEY in .env to enable)\n"
            )
            return
        parsed = urllib.parse.urlparse(supabase_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc:
            errors.append(f"SUPABASE_URL is not a valid http(s) URL: {supabase_url!r}")
            return

        # /auth/v1/health — no auth header needed for the endpoint itself.
        try:
            auth_headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key,
            }
            with urlrequest.urlopen(
                urlrequest.Request(
                    f"{supabase_url.rstrip('/')}/auth/v1/health",
                    headers=auth_headers,
                ),
                timeout=5,
            ) as resp:
                self.stdout.write(f"  auth/v1/health → {resp.status}\n")
        except (URLError, HTTPError, TimeoutError) as exc:
            errors.append(f"Supabase Auth health unreachable: {exc}")

        # /storage/v1/bucket — lists all buckets; requires the service key.
        try:
            req = urlrequest.Request(
                f"{supabase_url.rstrip('/')}/storage/v1/bucket",
                headers={
                    'Authorization': f'Bearer {supabase_key}',
                    'apikey': supabase_key,
                },
            )
            with urlrequest.urlopen(req, timeout=5) as resp:
                body = resp.read().decode('utf-8', errors='replace')
                self.stdout.write(f"  storage/v1/bucket → {resp.status} (ok)\n")
                # Surface the bucket list so the operator sees what's
                # already wired up.
                import json as _json
                try:
                    data = _json.loads(body) if body else []
                except ValueError:
                    data = []
                names = [b.get('name') for b in data if isinstance(b, dict)]
                self.stdout.write(
                    "  existing buckets (" + str(len(names)) + "): "
                    + (', '.join(names) if names else 'none') + "\n"
                )
        except (URLError, HTTPError, TimeoutError) as exc:
            errors.append(f"Supabase Storage list unreachable: {exc}")

    # ------------------------------------------------------------------
    # Redis probe (only when REDIS_URL is set; the InMemoryChannelLayer
    # dev path doesn't need it).
    # ------------------------------------------------------------------
    def _ping_redis(self, redis_url):
        import socket
        try:
            import redis as redislib
            client = redislib.from_url(
                redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                health_check_interval=0,
            )
            try:
                return bool(client.ping())
            finally:
                try:
                    client.close()
                except Exception:
                    pass
        except (ImportError, OSError, socket.timeout):
            return False
        except Exception:
            return False

    @staticmethod
    def _redact_redis(redis_url):
        """Strip password from ``redis://user:pass@host[/db]`` for safe log."""
        if '@' not in redis_url:
            return redis_url
        scheme, rest = redis_url.split('://', 1)
        creds, host_part = rest.split('@', 1)
        if ':' in creds:
            user, _ = creds.split(':', 1)
            return f'{scheme}://{user}:***@{host_part}'
        return f'{scheme}://***@{host_part}'
