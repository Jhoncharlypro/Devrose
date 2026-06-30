"""
Channels / Django middleware for the DevRose Academy API.

Four middlewares live here, in declaration order (top runs first):

  TokenAuthMiddleware
      Populates ``scope['user']`` from the ``?token=<JWT>`` query
      string passed in the WebSocket URL handshake. See the
      docstring in this file for the WHY of the query-string
      approach.

  IPBlockMiddleware
      Defense-in-depth: terminates requests from BannedIP rows
      with 403 BEFORE auth. Skips /api/healthz/ + /api/metrics/ so
      load balancers + Prometheus scrapers are never blackholed.

  MaintenanceModeMiddleware
      Part 8: reads the active MaintenanceWindow (cached 5s) and
      short-circuits WRITE requests with 503 ``Service Unavailable``
      when in ``read_only`` or ``full_lockout`` scope. Reads (GET /
      HEAD / OPTIONS) pass through with a ``X-Maintenance: 1``
      response header so the FE banner can light up. ``full_lockout``
      scope short-circuits ALL non-admin requests with the same
      503. Admins (``is_staff=True``) bypass the gate so the admin
      dashboard stays usable during a maintenance event.

  RequestTimingMiddleware
      Part 8: records per-request latency in an in-process
      Prometheus-friendly counter so the admin dashboard's "API
      Latency" card has real data. Bounded to a 10k-sample
      ring buffer to keep memory predictable.
"""
import logging
import time
from collections import deque
from typing import Deque, Tuple

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.http import JsonResponse
from django.utils import timezone

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------
# Channels: WebSocket JWT auth (unchanged)
# ----------------------------------------------------------------------
class TokenAuthMiddleware(BaseMiddleware):
    """
    Reads ``?token=<JWT>`` from the WebSocket URL and authenticates
    the user. Stores the resolved user on ``scope['user']`` and
    the decoded token on ``scope['token']`` for downstream
    consumers to read.

    Why query-string instead of Sec-WebSocket-Protocol subprotocol?
    Browsers don't let the FE set arbitrary headers on the WS
    handshake, so the token has to come from somewhere a JS
    client can set. The query string is the most-compatible
    option (works in every browser, every test runner, every
    mobile webview).
    """

    async def __call__(self, scope, receive, send):
        from urllib.parse import parse_qs
        from channels.db import database_sync_to_async
        from django.contrib.auth.models import AnonymousUser
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
        from rest_framework_simplejwt.tokens import AccessToken

        query_string = scope.get('query_string', b'').decode('utf-8')
        params = parse_qs(query_string)
        token = (params.get('token') or [None])[0]

        scope['user'] = AnonymousUser()
        scope['token'] = None

        if token:
            try:
                access = AccessToken(token)
                user = await database_sync_to_async(self._get_user)(access)
                if user and user.is_active:
                    scope['user'] = user
                    scope['token'] = access
            except (InvalidToken, TokenError):
                # Token expired / malformed. Keep the anonymous user;
                # consumers can decide whether to close the socket.
                pass
        return await super().__call__(scope, receive, send)

    def _get_user(self, access_token):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            return User.objects.get(id=access_token['user_id'])
        except (KeyError, User.DoesNotExist):
            return None


# ----------------------------------------------------------------------
# HTTP: IP block middleware (unchanged)
# ----------------------------------------------------------------------
class IPBlockMiddleware:
    """BannedIP enforcement BEFORE auth. See header docstring."""

    SKIP_PATHS = (
        '/api/healthz/',
        '/api/metrics/',
        '/static/',
        '/favicon.ico',
    )

    def __init__(self, get_response):
        self.get_response = get_response
        self._cache = {}
        self._cache_ttl = 30
        import threading
        self._lock = threading.Lock()

    def __call__(self, request):
        path = request.path
        if any(path.startswith(p) for p in self.SKIP_PATHS):
            return self.get_response(request)
        ip = self._client_ip(request)
        if not ip:
            return self.get_response(request)
        if self._is_blocked(ip):
            logger.info('IPBlockMiddleware: blocked %s on %s', ip, path)
            return JsonResponse(
                {'error': 'IP blocked.', 'ip': ip},
                status=403,
            )
        return self.get_response(request)

    def _client_ip(self, request):
        xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if xff:
            first = xff.split(',', 1)[0].strip()
            return first or request.META.get('REMOTE_ADDR', '')
        return request.META.get('REMOTE_ADDR', '') or None

    def _is_blocked(self, ip):
        now = timezone.now()
        with self._lock:
            cached = self._cache.get(ip)
            if cached and cached[1] > now:
                return cached[0]
        from api.models import BannedIP
        try:
            ban = BannedIP.objects.filter(
                ip_address=ip, is_active=True,
            ).first()
        except Exception:
            return False
        blocked = bool(ban and ban.is_currently_banned())
        with self._lock:
            self._cache[ip] = (blocked, now + timezone.timedelta(seconds=self._cache_ttl))
        return blocked


# ----------------------------------------------------------------------
# HTTP: Maintenance mode middleware (Part 8)
# ----------------------------------------------------------------------
class MaintenanceModeMiddleware:
    """
    Reads the active ``MaintenanceWindow`` and short-circuits writes
    during maintenance. Reads continue, with a ``X-Maintenance: 1``
    response header so the FE banner can light up without a
    second round-trip.

    Rules:
      * ``read_only``  → all non-GET/HEAD/OPTIONS requests get 503.
      * ``full_lockout`` → all requests (including reads) get 503
                           unless the caller is staff.
      * Staff (``is_staff=True``) bypass the gate entirely so the
        admin dashboard + healthz stay usable.
      * ``/api/healthz/`` + ``/api/metrics/`` always pass through so
        load balancers + Prometheus scrapers don't flap.

    Cost: ``current_maintenance()`` is a single SELECT against an
    indexed column, but the result is cached in Django's default
    cache for 5s. Toggling maintenance triggers a cache invalidation
    (see ``MaintenanceViewSet.perform_create``) so the next request
    after a toggle sees the new state.
    """

    SKIP_PATHS = (
        '/api/healthz/',
        '/api/metrics/',
        '/api/admin/',  # staff needs the admin surface during maintenance
        '/static/',
        '/favicon.ico',
    )
    READ_METHODS = frozenset({'GET', 'HEAD', 'OPTIONS'})

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Cheap pre-checks before we hit the DB / cache.
        path = request.path
        if any(path.startswith(p) for p in self.SKIP_PATHS):
            return self.get_response(request)
        user = getattr(request, 'user', None)
        # Staff bypass: never short-circuit an admin.
        if user is not None and getattr(user, 'is_staff', False):
            return self.get_response(request)
        # Lazy import to avoid a model-import cycle at startup.
        try:
            from api.models.part8 import current_maintenance
            win = current_maintenance()
        except Exception:  # pragma: no cover - defensive
            return self.get_response(request)
        if not win or not win.is_currently_active():
            return self.get_response(request)
        # We're in an active maintenance window.
        is_read = request.method in self.READ_METHODS
        if is_read and win.scope == 'read_only':
            # Reads pass through with a banner header.
            response = self.get_response(request)
            response['X-Maintenance'] = '1'
            response['X-Maintenance-Scope'] = win.scope
            return response
        # Either full_lockout OR a write during read_only: 503.
        message = (win.message or 'Service is in maintenance. Please try again shortly.').strip()[:512]
        return JsonResponse(
            {
                'error': 'maintenance_mode',
                'detail': message,
                'scope': win.scope,
                'ends_at': win.ends_at.isoformat() if win.ends_at else None,
            },
            status=503,
            headers={'Retry-After': '120', 'X-Maintenance': '1'},
        )


# ----------------------------------------------------------------------
# HTTP: Request timing middleware (Part 8)
# ----------------------------------------------------------------------
# Module-level ring buffer of (timestamp_ms, latency_ms) so the admin
# dashboard can read the last N samples without a per-request DB hit.
# Bounded to 10k entries; older samples are evicted FIFO. The admin
# dashboard reads `_REQUEST_TIMING_BUFFER` directly (importable).
_REQUEST_TIMING_BUFFER: Deque[Tuple[float, float]] = deque(maxlen=10000)
_REQUEST_TIMING_LOCK = __import__('threading').Lock()


def get_recent_request_timings(limit: int = 1000):
    """Return the most recent (timestamp, latency_ms) samples."""
    with _REQUEST_TIMING_LOCK:
        # Snapshot the deque without copying the whole 10k — slice from the end.
        return list(_REQUEST_TIMING_BUFFER)[-limit:]


class RequestTimingMiddleware:
    """
    Records per-request latency. The buffer is intentionally
    in-process so a DB outage doesn't lose visibility, and a Redis
    outage doesn't matter (the dashboard reads this from memory
    once on load). For multi-worker deployment the per-worker
    samples will be a slightly different distribution but the
    mean/percentile aggregation on the dashboard smooths that out.

    Skipped paths:
      * /api/healthz/  (the probe would otherwise pollute the
        latency stats with its own 0.5ms sample and skew the
        mean toward "always fast").
      * /api/metrics/  (the scrape is itself a request; same
        pollution concern).
    """

    SKIP_PATHS = ('/api/healthz/', '/api/metrics/')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if any(path.startswith(p) for p in self.SKIP_PATHS):
            return self.get_response(request)
        t0 = time.perf_counter()
        try:
            response = self.get_response(request)
        finally:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            with _REQUEST_TIMING_LOCK:
                _REQUEST_TIMING_BUFFER.append((time.time(), elapsed_ms))
        return response


# ----------------------------------------------------------------------
# Compat alias — devrose_backend/asgi.py imports ``JwtAuthMiddleware``.
# Same class as ``TokenAuthMiddleware``; both names point at the same
# callable so either import path works.
# ----------------------------------------------------------------------
JwtAuthMiddleware = TokenAuthMiddleware
