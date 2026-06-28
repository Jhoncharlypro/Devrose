"""
``/api/healthz/`` — concrete health endpoint for Supabase deployments.

Returns 200 with green status if Postgres is reachable + (optionally)
Supabase Auth & Storage are reachable. Returns 503 with red status if
the DB is down so a load balancer / uptime monitor can mark the pod
unhealthy.

Why not piggy-back ``/api/``? uptime monitors hit ``/healthz`` on a
cadence that doesn't require auth (Varnish / cloudflare cache might
think the response cacheable; a path that's clearly named ``healthz``
avoids that ambiguity).

Security note: ``/api/healthz/`` deliberately does NOT leak the server
version or connection string. Operators get ``ok`` / ``degraded`` /
``down`` + a sanitized ``components`` map only.
"""
import os

from django.conf import settings
from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(['GET'])
@permission_classes([AllowAny])
def healthz(request):
    """
    GET /api/healthz/

    Returns:
      200 {"status": "ok",     "components": {"db": "ok", "rest": "ok"}}
      200 {"status": "degraded","components": {"db": "ok", "rest": "down"}}
      503 {"status": "down",   "components": {"db": "down", "rest": "ok"}}
    """
    components = {}
    overall_status = 'ok'

    # -- Component 1: Postgres (or SQLite for dev) ------------------
    try:
        # 3s timeout so a wedged connection can't hang the probe. We use
        # ``SET statement_timeout TO '3s'`` (NOT ``SET LOCAL``) because
        # ``SET LOCAL`` only has effect inside an explicit transaction
        # block — Django's default cursor is in autocommit mode (no
        # ``BEGIN`` issued), so ``SET LOCAL`` would emit a
        # "SET LOCAL can only be used in transaction blocks" warning to
        # stderr and silently NOT enforce the timeout. Without
        # ``LOCAL`` the setting persists for the connection lifetime,
        # which is what we want (the healthz endpoint is rate-limited
        # so a per-connection 3s cap is safe).
        #
        # IMPORTANT — vendor-aware: ``SET statement_timeout`` is a
        # Postgres-only GUC. SQLite (and MySQL connection.vendor !=
        # 'postgresql') would raise ``OperationalError`` (or silently
        # ignore, depending on driver) and the ``finally`` reset
        # ``SET statement_timeout TO DEFAULT`` would also fail — which
        # used to trip the entire healthz probe into ``db: down`` /
        # ``503`` on the dev-path SQLite. Gate the GUC on the vendor
        # so SQLite/MySql get a clean ``SELECT 1`` with no per-stmt
        # timeout (still bounded by client-side socket timeouts).
        with connection.cursor() as cur:
            try:
                if connection.vendor == 'postgresql':
                    cur.execute("SET statement_timeout TO '3s'")
                cur.execute("SELECT 1")
                row = cur.fetchone()
            finally:
                if connection.vendor == 'postgresql':
                    # Restore the session default so subsequent
                    # connections in the pool don't inherit a tight
                    # 3s ceiling.
                    cur.execute("SET statement_timeout TO DEFAULT")
        db_ok = bool(row) and row[0] == 1
        components['db'] = 'ok' if db_ok else 'down'
    except Exception:  # noqa: BLE001
        # Never leak the exception in the response — only the status.
        components['db'] = 'down'
        overall_status = 'down'

    # -- Component 2: Rest (Auth + Storage) --------------------------
    # Only probed when explicit env is defined so dev / CI without
    # SUPABASE_URL still gets a green check on pure-Postgres health.
    supabase_url = os.environ.get('SUPABASE_URL', '').strip()
    if supabase_url:
        rest_ok = _ping_supabase_rest(supabase_url)
        components['rest'] = 'ok' if rest_ok else 'down'
        if not rest_ok and overall_status != 'down':
            overall_status = 'degraded'

    # Mode identifier so a deploy audit can confirm which DB this
    # replica is talking to (transaction pooler, session pooler, sqlite).
    components['pool_mode'] = getattr(settings, 'SUPABASE_POOL_MODE', None) or 'sqlite'

    # -- Component 3: Redis (channels-redis + presence ledger) -------
    # Only probed when REDIS_URL is set. On the InMemory dev path we
    # skip the Redis check entirely so a freshly-cloned repo doesn't
    # report ``degraded`` for missing-Redis.
    redis_url = getattr(settings, 'REDIS_BACKEND', None)
    if redis_url:
        redis_ok = _ping_redis_sync(redis_url)
        components['redis'] = 'ok' if redis_ok else 'down'
        # Surface the channel-layer backend class so an operator can
        # confirm at a glance that ``channels-redis`` is wired. Set
        # once unconditionally to avoid identical branches.
        components['redis_backend'] = 'channels_redis.core.RedisChannelLayer'
        if not redis_ok and overall_status != 'down':
            overall_status = 'degraded'

    code = 503 if overall_status == 'down' else 200
    return Response(
        {'status': overall_status, 'components': components},
        status=code,
    )


def _ping_redis_sync(redis_url):
    """
    Sync Redis PING (no event loop). Uses a short-lived client instead
    of ``presence.get_backend()._get_sync()`` to keep this probe
    isolated from the long-lived pool the consumer side uses.
    """
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


def _ping_supabase_rest(supabase_url):
    """
    Best-effort ping of the Supabase REST endpoints.

    We use only the /auth/v1/health endpoint because it doesn't require
    any credentials. If it returns 200, the REST is up; if it times out
    or 5xx's, mark down.
    """
    import urllib.parse
    from urllib import request as urlrequest
    from urllib.error import URLError, HTTPError
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY', '').strip() or os.environ.get('SUPABASE_SECRET_KEY', '').strip()

    parsed = urllib.parse.urlparse(supabase_url)
    if parsed.scheme not in ('http', 'https'):
        return False
    base = supabase_url.rstrip('/')
    try:
        headers = {}
        if supabase_key:
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key,
            }
        with urlrequest.urlopen(
            urlrequest.Request(f"{base}/auth/v1/health", headers=headers),
            timeout=3,
        ) as resp:
            return 200 <= resp.status < 300
    except (URLError, HTTPError, TimeoutError, OSError):
        return False
