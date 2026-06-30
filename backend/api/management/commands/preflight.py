"""
``preflight`` — deployment health gate.

Runs the FULL pre-deployment checklist and records every check
as a ``DeploymentEvent`` row so the operator dashboard has a
deploy audit trail. Exits non-zero on any failure so CI / CD
can block a bad release.

Checks performed (in order):
  1. ``env``      — DJANGO_ENV is one of development|staging|production.
  2. ``secret``   — DJANGO_SECRET_KEY is set + non-dev.
  3. ``db``       — Postgres reachable + migrations applied.
  4. ``migrations`` — no unapplied migrations.
  5. ``healthz``  — local /api/healthz/ returns 200/healthy.
  6. ``storage``  — Supabase storage bucket is reachable.
  7. ``redis``    — Redis reachable when REDIS_URL is set.

Each check writes a DeploymentEvent with kind='preflight' and
status='success' or 'failure' so the operator can grep the
audit table for the exact failure.
"""
from __future__ import annotations

import os
import socket
import time
from datetime import datetime, timezone as dt_tz
from urllib.parse import urlparse

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from api.models import DeploymentEvent


class Command(BaseCommand):
    help = 'Run the full pre-deployment checklist and write audit rows.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--skip', action='append', default=[],
            help='Skip one or more checks (repeatable).',
        )
        parser.add_argument(
            '--no-audit', action='store_true',
            help="Don't write DeploymentEvent rows (dry run).",
        )
        parser.add_argument(
            '--environment', default='production',
            help='Environment label to attach to the audit rows.',
        )

    def handle(self, *args, **options):
        skip = set(options.get('skip') or [])
        env_label = options.get('environment') or 'production'
        no_audit = options.get('no_audit', False)
        all_ok = True
        commit_sha = os.environ.get('GIT_SHA') or os.environ.get('COMMIT_SHA') or ''
        actor = os.environ.get('CI_ACTOR') or os.environ.get('USER') or 'preflight'
        results = []
        for name, fn in [
            ('env', self._check_env),
            ('secret', self._check_secret),
            ('db', self._check_db),
            ('migrations', self._check_migrations),
            ('healthz', self._check_healthz),
            ('storage', self._check_storage),
            ('redis', self._check_redis),
        ]:
            if name in skip:
                results.append((name, 'skipped', 'explicit skip'))
                continue
            t0 = time.time()
            try:
                detail = fn() or ''
                results.append((name, 'success', detail))
                self.stdout.write(self.style.SUCCESS(f'  ✓ {name}: {detail or "ok"}'))
            except Exception as e:
                detail = str(e)[:512]
                results.append((name, 'failure', detail))
                all_ok = False
                self.stdout.write(self.style.ERROR(f'  ✗ {name}: {detail}'))
            finally:
                elapsed = (time.time() - t0) * 1000
                if not no_audit:
                    try:
                        DeploymentEvent.objects.create(
                            kind='preflight',
                            environment=env_label,
                            status='success' if results[-1][1] == 'success' else 'failure',
                            commit_sha=commit_sha,
                            actor=actor,
                            notes=f'{name}: {results[-1][2]}',
                            metadata={'check': name, 'elapsed_ms': round(elapsed, 1)},
                            completed_at=timezone.now(),
                        )
                    except Exception as audit_err:
                        self.stdout.write(self.style.WARNING(
                            f'  ! audit row write failed: {audit_err}'
                        ))
        if not all_ok:
            self.stdout.write(self.style.ERROR('preflight: one or more checks failed.'))
            raise CommandError('preflight failed')
        self.stdout.write(self.style.SUCCESS('preflight: all checks passed.'))

    # ---- individual checks ----
    def _check_env(self):
        env = (os.environ.get('DJANGO_ENV') or '').strip()
        if env not in ('development', 'staging', 'production'):
            raise RuntimeError(
                f'DJANGO_ENV must be one of development|staging|production, got {env!r}'
            )
        return f'environment={env}'

    def _check_secret(self):
        key = (os.environ.get('DJANGO_SECRET_KEY') or '').strip()
        if not key:
            raise RuntimeError('DJANGO_SECRET_KEY is not set')
        if key.startswith('django-insecure-'):
            raise RuntimeError('DJANGO_SECRET_KEY is the dev fallback — set a real secret')
        return f'len={len(key)}'

    def _check_db(self):
        with connection.cursor() as c:
            c.execute('SELECT 1')
            row = c.fetchone()
        if not row or row[0] != 1:
            raise RuntimeError('SELECT 1 did not return 1')
        vendor = connection.vendor
        return f'vendor={vendor}'

    def _check_migrations(self):
        from io import StringIO
        out = StringIO()
        try:
            call_command('showmigrations', '--list', stdout=out, no_color=True)
        except Exception as e:
            raise RuntimeError(f'showmigrations failed: {e}')
        # Lines starting with '[X]' are applied; '[ ]' are pending.
        pending = [
            line.strip() for line in out.getvalue().splitlines()
            if line.strip().startswith('[ ]')
        ]
        if pending:
            raise RuntimeError(f'{len(pending)} unapplied migrations: {pending[:3]}')
        return 'all migrations applied'

    def _check_healthz(self):
        # Probe the same Daphne port we're running on. For staging
        # this works because Daphne binds 0.0.0.0:8000. For CI we
        # skip with a 'skipped (no port)' note.
        port = int(os.environ.get('DJANGO_PORT') or 0)
        if not port:
            return 'skipped (DJANGO_PORT not set)'
        import urllib.request
        with urllib.request.urlopen(
            f'http://127.0.0.1:{port}/api/healthz/', timeout=5,
        ) as resp:
            if resp.status != 200:
                raise RuntimeError(f'healthz returned {resp.status}')
        return 'healthz=200'

    def _check_storage(self):
        url = (os.environ.get('SUPABASE_URL') or '').strip()
        if not url:
            return 'skipped (SUPABASE_URL not set)'
        key = (os.environ.get('SUPABASE_SERVICE_KEY')
               or os.environ.get('SUPABASE_SECRET_KEY') or '').strip()
        if not key:
            raise RuntimeError('SUPABASE_SERVICE_KEY not set')
        import urllib.request
        req = urllib.request.Request(
            f'{url.rstrip("/")}/storage/v1/bucket',
            headers={'Authorization': f'Bearer {key}', 'apikey': key},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status != 200:
                    raise RuntimeError(f'storage status={resp.status}')
        except Exception as e:
            raise RuntimeError(f'storage probe failed: {e}')
        return 'storage=200'

    def _check_redis(self):
        url = (os.environ.get('REDIS_URL') or '').strip()
        if not url:
            return 'skipped (REDIS_URL not set)'
        import redis as redislib
        client = redislib.from_url(
            url, socket_connect_timeout=2, socket_timeout=2,
            health_check_interval=0,
        )
        try:
            if not client.ping():
                raise RuntimeError('redis PING returned falsy')
        finally:
            try:
                client.close()
            except Exception:
                pass
        return 'redis=200'
