"""
``api.views.part8`` — Part 8: Production / DevOps / Monitoring views.

REST surface added:

  Versioning
    GET  /api/version/                         Build + commit + uptime.
    GET  /api/v1/                              Versioned API root (compat
                                               with /api/ for v1).
    GET  /api/v2/                              Versioned API root (v2
                                               preview — same surface for
                                               now, distinct header so FE
                                               can negotiate).

  Maintenance
    GET    /api/maintenance/                   Current state (public).
    POST   /api/maintenance/                   Toggle (admin only).
    DELETE /api/maintenance/<id>/              End the window (admin).

  Analytics
    POST   /api/analytics/ingest/              Fire-and-forget event
                                               ingest (anon, no PII).

  Queue
    GET    /api/queue/                         List jobs (admin).
    POST   /api/queue/                         Enqueue (admin).
    GET    /api/queue/stats/                   Aggregate counts.

  Security
    GET    /api/security/alerts/               List alerts (admin).
    POST   /api/security/alerts/<id>/resolve/  Mark resolved (admin).
    GET    /api/security/sweep/                Trigger a sweep (admin).

  Deployments
    GET    /api/deployments/                   Recent events (admin).
    POST   /api/deployments/                   Log an event (admin).

  Media
    GET    /api/media/assets/                  List uploaded assets.
    POST   /api/media/assets/                  Register a new asset.

  Rate limit inspection
    GET    /api/rate-limits/                   Bucket stats (admin).
"""
from __future__ import annotations

import logging
import os
import platform
import time
from datetime import datetime, timedelta, timezone as dt_tz

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from api.models import (
    AnalyticsEvent, JobQueue, MediaAsset, MaintenanceWindow,
    RateLimitBucket, SecurityAlert, DeploymentEvent,
)
from api.models.part8 import (
    enqueue_job, rate_limit_check, current_maintenance, impossible_travel,
)
from api.views.part4 import write_audit, bump
from api.views.part6 import HasAdminPermission

logger = logging.getLogger(__name__)

# Process start time so the version_info endpoint can report uptime.
_PROCESS_START_TS = time.time()


# ======================================================================
# 0. Version info (no auth)
# ======================================================================
def _git_sha():
    """Best-effort git SHA for the version endpoint. Returns short SHA
    or 'unknown' if git isn't available / this isn't a git checkout."""
    try:
        import subprocess
        out = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return out.decode('utf-8').strip()[:12] or 'unknown'
    except Exception:
        return 'unknown'


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def version_info(request):
    """GET /api/version/    Build + commit + uptime + env (no PII)."""
    return Response({
        'service': 'devrose-api',
        'version': getattr(settings, 'APP_VERSION', '1.0.0'),
        'environment': getattr(settings, 'DJANGO_ENV', 'development'),
        'git_sha': _git_sha(),
        'python': platform.python_version(),
        'django': __import__('django').__version__,
        'uptime_seconds': round(time.time() - _PROCESS_START_TS, 1),
        'started_at': datetime.fromtimestamp(
            _PROCESS_START_TS, tz=dt_tz.utc,
        ).isoformat(),
        'maintenance': bool(current_maintenance() and current_maintenance().is_currently_active()),
    })


# ======================================================================
# 1. Versioned API roots
# ======================================================================
@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def VersionedAPIRoot(request, version='v1'):
    """
    GET /api/<version>/    The API root. Both v1 and v2 share the
    same surface today; v2 adds the ``X-API-Version: 2`` response
    header so FE can detect which mount it hit. Future v2 routes
    (e.g. breaking changes to /api/chat/threads/) will be added
    under this prefix and the old /api/ paths will redirect or
    410 depending on the migration policy.
    """
    return Response({
        'name': 'DevRose API',
        'version': version,
        'documentation': 'https://github.com/devrose',
        'endpoints': {
            'auth': '/api/login/, /api/signup/, /api/refresh/, /api/logout/',
            'profile': '/api/profile/, /api/me/',
            'chat': '/api/chat/threads/, /api/chat/users/, /api/chat/search/, /api/chat/stories/',
            'live': '/api/live/rooms/',
            'ai': '/api/ai/, /api/ai/translate/, /api/ai/summarize/, /api/ai/rewrite/, /api/ai/smart_reply/, /api/ai/detect_spam/, /api/ai/detect_scam/, /api/ai/detect_abuse/',
            'admin': '/api/admin/dashboard/, /api/admin/users/, /api/admin/reports/, /api/admin/broadcasts/, /api/admin/security/',
            'ops': '/api/healthz/, /api/metrics/, /api/version/, /api/maintenance/, /api/queue/, /api/security/alerts/, /api/deployments/, /api/media/assets/, /api/rate-limits/',
        },
    })


# ======================================================================
# 2. Maintenance
# ======================================================================
class MaintenanceSerializer(serializers.ModelSerializer):
    started_by_username = serializers.CharField(source='started_by.username', read_only=True)
    ended_by_username = serializers.CharField(source='ended_by.username', read_only=True)

    class Meta:
        model = MaintenanceWindow
        fields = [
            'id', 'is_active', 'scope', 'message',
            'starts_at', 'ends_at',
            'started_by', 'started_by_username',
            'ended_by', 'ended_by_username',
        ]
        read_only_fields = ['id', 'starts_at', 'started_by', 'ended_by']


class MaintenanceViewSet(viewsets.ModelViewSet):
    """
    GET    /api/maintenance/       Current + recent windows (no auth).
    POST   /api/maintenance/       Toggle ON (admin only).
    DELETE /api/maintenance/<id>/  Toggle OFF (admin only).
    """
    serializer_class = MaintenanceSerializer
    queryset = MaintenanceWindow.objects.all().order_by('-starts_at')

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated(), HasAdminPermission()]

    def admin_permission_required(self):
        return 'can_broadcast'

    def create(self, request, *args, **kwargs):
        if not (request.user and request.user.is_authenticated and (
            request.user.is_staff or
            request.user.has_perm('api.add_maintenancewindow')
        )):
            return Response({'error': 'admin only'}, status=status.HTTP_403_FORBIDDEN)
        scope = (request.data.get('scope') or 'read_only')[:16]
        if scope not in ('read_only', 'full_lockout'):
            scope = 'read_only'
        ends_at = request.data.get('ends_at')
        ends_dt = None
        if ends_at:
            from django.utils.dateparse import parse_datetime
            ends_dt = parse_datetime(ends_at)
        win = MaintenanceWindow.objects.create(
            is_active=True,
            scope=scope,
            message=(request.data.get('message') or '')[:2000],
            ends_at=ends_dt,
            started_by=request.user,
        )
        # Invalidate the 5s cache so the middleware sees the toggle immediately.
        cache.delete('part8_current_maintenance')
        # Broadcast to connected clients so the FE banner lights up.
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            layer = get_channel_layer()
            if layer:
                async_to_sync(layer.group_send)('system_broadcast', {
                    'type': 'broadcast.message',
                    'id': win.id,
                    'severity': 'maintenance',
                    'message': win.message,
                    'scope': win.scope,
                    'ends_at': win.ends_at.isoformat() if win.ends_at else None,
                })
        except Exception:
            logger.debug('maintenance broadcast failed (non-fatal)')
        write_audit(request, action='admin_maintenance_start', target_type='maintenance',
                    target_id=win.id, metadata={'scope': scope})
        bump('devrose_part8_maintenance_total')
        return Response(MaintenanceSerializer(win).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        if not (request.user and request.user.is_authenticated and (
            request.user.is_staff or
            request.user.has_perm('api.delete_maintenancewindow')
        )):
            return Response({'error': 'admin only'}, status=status.HTTP_403_FORBIDDEN)
        win = self.get_object()
        win.is_active = False
        win.ended_by = request.user
        win.save(update_fields=['is_active', 'ended_by'])
        cache.delete('part8_current_maintenance')
        write_audit(request, action='admin_maintenance_end', target_type='maintenance',
                    target_id=win.id)
        return Response(MaintenanceSerializer(win).data)


# ======================================================================
# 3. Analytics ingest
# ======================================================================
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def AnalyticsIngestView(request):
    """
    POST /api/analytics/ingest/

    Body: { "kind": "message_sent", "attributes": {...}, "latency_ms": 42 }

    The endpoint is intentionally AllowAny + throttled by an
    internal rate_limit_check so anonymous beacon-style pings
    from the FE (navigator.sendBeacon on unload) are accepted
    without an auth round-trip. The cost is bounded to one
    INSERT per call; no PII is stored (no IP, no user-agent,
    no message body).
    """
    kind = (request.data.get('kind') or '')[:32]
    if kind not in dict((k, v) for k, v in AnalyticsEvent.EVENT_KINDS):
        return Response({'error': f'invalid kind: {kind!r}'}, status=status.HTTP_400_BAD_REQUEST)
    # Rate-limit by IP so a misbehaving client can't flood.
    ip = (request.META.get('HTTP_X_FORWARDED_FOR', '').split(',', 1)[0].strip()
          or request.META.get('REMOTE_ADDR', '') or '0.0.0.0')
    allowed, retry = rate_limit_check('analytics_ingest', ip, limit=120, window_seconds=60)
    if not allowed:
        return Response({'error': 'rate_limited', 'retry_after': retry},
                        status=status.HTTP_429_TOO_MANY_REQUESTS,
                        headers={'Retry-After': str(retry)})
    attributes = request.data.get('attributes') or {}
    if not isinstance(attributes, dict):
        attributes = {}
    # Coerce scalar attributes; cap nested depth to 3.
    clean = {}
    for k, v in list(attributes.items())[:10]:
        if isinstance(v, (int, float, str, bool)):
            clean[str(k)[:64]] = str(v)[:256]
    user = request.user if (request.user and request.user.is_authenticated) else None
    latency_ms = request.data.get('latency_ms')
    try:
        latency_ms = int(latency_ms) if latency_ms is not None else None
    except (TypeError, ValueError):
        latency_ms = None
    evt = AnalyticsEvent.objects.create(
        kind=kind,
        user=user,
        attributes=clean,
        latency_ms=latency_ms,
    )
    return Response({'id': evt.id, 'kind': kind}, status=status.HTTP_201_CREATED)


# ======================================================================
# 4. Job queue
# ======================================================================
class JobQueueSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobQueue
        fields = [
            'id', 'name', 'payload', 'idempotency_key',
            'status', 'run_at', 'locked_at', 'locked_by',
            'attempts', 'max_attempts', 'last_error',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'status', 'locked_at', 'locked_by',
            'attempts', 'last_error', 'created_at', 'updated_at',
        ]


class JobQueueViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET  /api/queue/         List jobs (admin).
    POST /api/queue/         Enqueue (admin).
    GET  /api/queue/stats/   Aggregate counts (admin).
    """
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    serializer_class = JobQueueSerializer
    queryset = JobQueue.objects.all().order_by('-created_at')

    def admin_permission_required(self):
        return 'can_view_audit'

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        name_filter = self.request.query_params.get('name')
        if name_filter:
            qs = qs.filter(name=name_filter)
        return qs

    def create(self, request, *args, **kwargs):
        name = (request.data.get('name') or '')[:64]
        if not name:
            return Response({'error': 'name is required'}, status=status.HTTP_400_BAD_REQUEST)
        payload = request.data.get('payload') or {}
        if not isinstance(payload, dict):
            payload = {}
        run_at = request.data.get('run_at')
        run_dt = None
        if run_at:
            from django.utils.dateparse import parse_datetime
            run_dt = parse_datetime(run_at)
        idem = (request.data.get('idempotency_key') or '')[:128] or None
        try:
            max_attempts = int(request.data.get('max_attempts') or 3)
        except (TypeError, ValueError):
            max_attempts = 3
        job = enqueue_job(
            name=name, payload=payload, run_at=run_dt,
            idempotency_key=idem, max_attempts=max(1, min(max_attempts, 10)),
        )
        write_audit(request, action='admin_queue_enqueue', target_type='job',
                    target_id=job.id, metadata={'name': name})
        return Response(JobQueueSerializer(job).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        now = timezone.now()
        last_24h = now - timedelta(hours=24)
        qs = JobQueue.objects.all()
        return Response({
            'pending': qs.filter(status=JobQueue.STATUS_PENDING).count(),
            'running': qs.filter(status=JobQueue.STATUS_RUNNING).count(),
            'done': qs.filter(status=JobQueue.STATUS_DONE).count(),
            'failed': qs.filter(status=JobQueue.STATUS_FAILED).count(),
            'dead': qs.filter(status=JobQueue.STATUS_DEAD).count(),
            'enqueued_24h': qs.filter(created_at__gte=last_24h).count(),
            'completed_24h': qs.filter(
                status=JobQueue.STATUS_DONE, updated_at__gte=last_24h,
            ).count(),
        })


# ======================================================================
# 5. Security alerts
# ======================================================================
class SecurityAlertSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    resolved_by_username = serializers.CharField(source='resolved_by.username', read_only=True)

    class Meta:
        model = SecurityAlert
        fields = [
            'id', 'kind', 'severity',
            'user', 'user_username',
            'ip_address', 'metadata',
            'resolved', 'resolved_by', 'resolved_by_username',
            'resolved_at', 'resolution_note', 'created_at',
        ]
        read_only_fields = fields


class SecurityAlertViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET  /api/security/alerts/                  List (admin).
    POST /api/security/alerts/<id>/resolve/     Mark resolved.
    GET  /api/security/alerts/sweep/            Trigger a sweep.
    """
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    serializer_class = SecurityAlertSerializer
    queryset = SecurityAlert.objects.all().order_by('-created_at')

    def admin_permission_required(self):
        return 'can_view_audit'

    def get_queryset(self):
        qs = super().get_queryset()
        resolved = self.request.query_params.get('resolved')
        if resolved is not None:
            qs = qs.filter(resolved=resolved.lower() == 'true')
        kind = self.request.query_params.get('kind')
        if kind:
            qs = qs.filter(kind=kind)
        return qs

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        alert = self.get_object()
        alert.resolved = True
        alert.resolved_by = request.user
        alert.resolved_at = timezone.now()
        alert.resolution_note = (request.data.get('note') or '')[:512]
        alert.save(update_fields=['resolved', 'resolved_by', 'resolved_at', 'resolution_note'])
        write_audit(request, action='admin_security_alert_resolve',
                    target_type='security_alert', target_id=alert.id)
        return Response(SecurityAlertSerializer(alert).data)

    @action(detail=False, methods=['get'])
    def sweep(self, request):
        """Run a one-shot sweep; same logic as the management command."""
        from django.core.management import call_command
        call_command('security_sweep', '--no-output')
        return Response({
            'swept_at': timezone.now().isoformat(),
            'recent_alerts': SecurityAlertSerializer(
                SecurityAlert.objects.filter(resolved=False).order_by('-created_at')[:25],
                many=True,
            ).data,
        })


# ======================================================================
# 6. Deployment events
# ======================================================================
class DeploymentEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeploymentEvent
        fields = [
            'id', 'kind', 'environment', 'status',
            'commit_sha', 'actor', 'notes', 'metadata',
            'created_at', 'completed_at',
        ]
        read_only_fields = ['id', 'created_at']


class DeploymentEventViewSet(viewsets.ModelViewSet):
    """GET/POST /api/deployments/    Audit log of deploys + preflights."""
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    serializer_class = DeploymentEventSerializer
    queryset = DeploymentEvent.objects.all().order_by('-created_at')

    def admin_permission_required(self):
        return 'can_view_audit'

    def create(self, request, *args, **kwargs):
        ev = DeploymentEvent.objects.create(
            kind=(request.data.get('kind') or 'deploy')[:16],
            environment=(request.data.get('environment') or 'production')[:16],
            status=(request.data.get('status') or 'success')[:16],
            commit_sha=(request.data.get('commit_sha') or '')[:64],
            actor=(request.data.get('actor') or request.user.username)[:128],
            notes=(request.data.get('notes') or '')[:4000],
            metadata=request.data.get('metadata') or {},
            completed_at=timezone.now(),
        )
        return Response(DeploymentEventSerializer(ev).data, status=status.HTTP_201_CREATED)


# ======================================================================
# 7. Media assets
# ======================================================================
class MediaAssetSerializer(serializers.ModelSerializer):
    uploader_username = serializers.CharField(source='uploader.username', read_only=True)

    class Meta:
        model = MediaAsset
        fields = [
            'id', 'uploader', 'uploader_username',
            'kind', 'bucket', 'storage_path', 'public_url',
            'size_bytes', 'mime_type', 'sha256', 'status',
            'metadata', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'uploader', 'created_at', 'updated_at', 'public_url']

    def create(self, validated_data):
        validated_data['uploader'] = self.context['request'].user
        return super().create(validated_data)


class MediaAssetViewSet(viewsets.ModelViewSet):
    """GET/POST /api/media/assets/    Catalog of uploaded media."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MediaAssetSerializer
    queryset = MediaAsset.objects.all().order_by('-created_at')

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_staff:
            qs = qs.filter(uploader=user)
        kind = self.request.query_params.get('kind')
        if kind:
            qs = qs.filter(kind=kind)
        return qs


# ======================================================================
# 8. Rate limit inspection
# ======================================================================
class RateLimitBucketSerializer(serializers.ModelSerializer):
    class Meta:
        model = RateLimitBucket
        fields = ['id', 'bucket', 'key', 'count', 'window_start', 'expires_at']
        read_only_fields = fields


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated, HasAdminPermission])
def RateLimitInspectView(request):
    """GET /api/rate-limits/    Active bucket stats (admin)."""
    if not request.user.has_perm('api.view_ratelimitbucket'):
        return Response({'error': 'admin only'}, status=status.HTTP_403_FORBIDDEN)
    qs = RateLimitBucket.objects.all().order_by('-expires_at')[:500]
    by_bucket = (
        RateLimitBucket.objects.values('bucket')
        .annotate(total=Count('id'), total_count=Count('count'))
    )
    return Response({
        'recent': RateLimitBucketSerializer(qs, many=True).data,
        'by_bucket': list(by_bucket),
    })
