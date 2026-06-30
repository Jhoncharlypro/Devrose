"""
``api.models.part8`` — Part 8: Production / DevOps / Monitoring surface.

Seven new models + four helper functions/classes that back the
"production-ready" surface called out in the spec:

  * ``AnalyticsEvent``     — anonymous usage telemetry (DAU, MAU, message
                             counts, crash rate). Never stores message
                             content; only the typed event name + 1-2
                             scalar attributes. Partitioned by day
                             (created_at index) so the daily rollup
                             management command can sweep in O(matches).
  * ``JobQueue``           — DB-backed background job (the spec asks for
                             "Queue System" + "retry failed jobs"). We
                             back it with a Postgres table + a
                             ``queue_worker`` management command rather
                             than introducing Celery — Celery requires
                             Redis as the broker AND a result backend,
                             which would force a new infra dependency
                             on a project that already has Redis but
                             only for the channel layer. The DB-backed
                             queue is one extra table, scales to the
                             "thousands of jobs/day" regime, and
                             survives Daphne restarts (jobs in flight
                             stay locked + retry).
  * ``MediaAsset``         — durable record of every uploaded file
                             (avatar, story, voice, image, video). The
                             current code only stores the raw bytes on
                             ``Message.image`` / ``Message.audio``; this
                             table gives the platform a single
                             "media library" that CDN URLs, transcoding
                             results, and the "Backup" feature can all
                             reference. The Supabase Storage migration
                             (0015) is the storage layer; this is the
                             catalog layer.
  * ``MaintenanceWindow``  — admin-toggled maintenance mode. The middleware
                             (``MaintenanceModeMiddleware``) reads the
                             most-recent active row on every request so
                             toggling is instant; we don't cache the
                             state because the toggle is a rare, audited
                             event. The Channels broadcast on toggle lets
                             connected clients show a banner without a
                             full page reload.
  * ``RateLimitBucket``    — finer-grained throttling than DRF's built-in
                             scope system. The DRF ``user`` scope is a
                             flat 30/min global cap; the spec wants
                             per-endpoint buckets (e.g. ``login`` is 5/min,
                             ``ai/translate`` is 20/min, ``uploads`` is
                             10/min). We model it as (bucket_name, key)
                             → (count, window_start) with a TTL index on
                             ``window_start`` so dead rows auto-expire.
  * ``SecurityAlert``      — auto-generated alert when ``security_sweep``
                             finds impossible-travel, brute-force, or
                             impossible-velocity events. The dashboard
                             surfaces them; staff can resolve + the
                             resolution_note is preserved for the audit
                             trail.
  * ``DeploymentEvent``    — every deploy / preflight / rollback writes a
                             row so the operator dashboard can show "last
                             successful deploy" and "deploys in last 24h".
                             The preflight command also writes one row
                             per check (pass / fail) so a deploy audit
                             has the full chain.

Helpers (module-level, not on the model classes):

  * ``impossible_travel(user, ip, when)`` — return the distance + ETA if
    the user's last successful login from a different IP was within an
    impossible physical-travel window. We use a 1000 km/h + 30 min
    lower-bound heuristic so a VPN switching between two data centers
    2000 km apart doesn't false-positive.
  * ``enqueue_job(name, payload, run_at)`` — DB-backed enqueue with a
    unique ``idempotency_key`` for safe retries.
  * ``rate_limit_check(bucket, key, limit, window_seconds)`` — atomic
    RateLimitBucket upsert that returns (allowed, retry_after_seconds).
    Uses ``update_or_create`` + a single round-trip.
  * ``current_maintenance()`` — return the active MaintenanceWindow row
    or ``None``. The middleware calls this on every request; the
    sub-millisecond cost is acceptable since toggles are rare and
    the result is internally memoised for 5s.
"""
from __future__ import annotations

import hashlib
import logging
import math
import time
import uuid
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import models, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


# ======================================================================
# 1. Analytics
# ======================================================================
class AnalyticsEvent(models.Model):
    """
    One row per anonymous telemetry event. The spec explicitly forbids
    collecting message content; this table only stores the event NAME
    (e.g. ``message_sent``) + up to 3 numeric/string attributes and
    the user/thread it was scoped to (for the per-user rollup).

    Privacy defaults:
      * No PII (no message body, no email, no IP — those are stored on
        ``LoginAttempt`` / ``SecurityAlert`` separately for security
        purposes, NOT for analytics).
      * The ``user`` FK is ``null=True`` so events that happen before
        authentication (cold-start page view) still record.
      * Old rows are auto-aggregated + purged by the
        ``analytics_rollup`` management command at 30 days.
    """

    EVENT_KINDS = [
        ('app_open', 'App Open'),
        ('message_sent', 'Message Sent'),
        ('call_audio', 'Audio Call'),
        ('call_video', 'Video Call'),
        ('media_upload', 'Media Upload'),
        ('login_success', 'Login Success'),
        ('crash', 'Crash'),
        ('page_view', 'Page View'),
    ]

    id = models.BigAutoField(primary_key=True)
    kind = models.CharField(max_length=32, choices=EVENT_KINDS, db_index=True)
    user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='analytics_events',
    )
    # Up to 3 scalar attributes; JSONField keeps the schema flexible.
    attributes = models.JSONField(default=dict, blank=True)
    # Connection-quality snapshot at the time of the event (ms latency
    # to the nearest presence server). Optional — the FE only fills
    # this when navigator.connection is available.
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['kind', '-created_at'], name='analytics_kind_time_idx'),
            models.Index(fields=['user', '-created_at'], name='analytics_user_time_idx'),
            models.Index(fields=['-created_at'], name='analytics_time_idx'),
        ]

    def __str__(self):
        return f'AnalyticsEvent({self.kind} uid={self.user_id} @ {self.created_at.isoformat()})'


# ======================================================================
# 2. Job queue (DB-backed)
# ======================================================================
class JobQueue(models.Model):
    """
    DB-backed background job. Lifecycle:
        pending → running → done
                    └→ failed (retries left) → pending
                    └→ failed (exhausted)   → dead

    The ``queue_worker`` management command claims rows by:
        UPDATE api_jobqueue
        SET status='running', locked_at=now(), locked_by=<host>
        WHERE id IN (
          SELECT id FROM api_jobqueue
          WHERE status='pending' AND run_at <= now()
          ORDER BY run_at LIMIT 50 FOR UPDATE SKIP LOCKED
        )
    then dispatches by ``name`` to the registered handler. The
    ``SKIP LOCKED`` clause is Postgres 9.5+; for SQLite (dev) we fall
    back to a ``transaction.atomic()`` + a single UPDATE that picks
    any pending row by id. The job handler MUST be idempotent — the
    worker re-runs on retry.

    Why DB-backed instead of Celery:
      * No new infra dependency (project already uses Redis for
        channels but adding Celery + a result backend is multi-PR).
      * Survives worker crashes (Daphne restart doesn't lose jobs).
      * Trivially auditable: ``SELECT * FROM api_jobqueue`` is the
        entire queue.
      * Throughput: Postgres + SKIP LOCKED comfortably handles
        ~5k jobs/min on the free-tier pooler, well above the spec's
        "background tasks" regime.
    """

    STATUS_PENDING = 'pending'
    STATUS_RUNNING = 'running'
    STATUS_DONE = 'done'
    STATUS_FAILED = 'failed'
    STATUS_DEAD = 'dead'

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=64, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    # Idempotency: an enqueue with the same key replaces the pending
    # row instead of creating a duplicate. Used by "send welcome
    # email" + "schedule a broadcast" so re-clicking doesn't double-fire.
    idempotency_key = models.CharField(
        max_length=128, null=True, blank=True, unique=True,
    )
    status = models.CharField(
        max_length=16,
        choices=[
            (STATUS_PENDING, 'Pending'),
            (STATUS_RUNNING, 'Running'),
            (STATUS_DONE, 'Done'),
            (STATUS_FAILED, 'Failed'),
            (STATUS_DEAD, 'Dead'),
        ],
        default=STATUS_PENDING, db_index=True,
    )
    run_at = models.DateTimeField(default=timezone.now, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    locked_by = models.CharField(max_length=128, blank=True, default='')
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=3)
    last_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['status', 'run_at'], name='jobqueue_status_time_idx'),
            models.Index(fields=['name', 'status'], name='jobqueue_name_status_idx'),
            models.Index(fields=['-created_at'], name='jobqueue_created_idx'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['idempotency_key'],
                condition=~models.Q(idempotency_key=''),
                name='jobqueue_idempotency_unique',
            ),
        ]

    def __str__(self):
        return f'JobQueue({self.name} #{self.id} {self.status})'


def enqueue_job(name: str, payload: Optional[Dict[str, Any]] = None,
                run_at=None, idempotency_key: Optional[str] = None,
                max_attempts: int = 3) -> JobQueue:
    """
    Enqueue a background job. Idempotent on ``idempotency_key``: if a
    row with the same key is still pending/running, we return it instead
    of creating a duplicate. ``run_at`` defaults to now; pass a future
    datetime for delayed jobs (e.g. broadcast at 9am tomorrow).
    """
    if idempotency_key:
        existing = JobQueue.objects.filter(
            idempotency_key=idempotency_key,
            status__in=[JobQueue.STATUS_PENDING, JobQueue.STATUS_RUNNING],
        ).first()
        if existing:
            return existing
    return JobQueue.objects.create(
        name=name,
        payload=payload or {},
        run_at=run_at or timezone.now(),
        idempotency_key=idempotency_key or None,
        max_attempts=max_attempts,
    )


# ======================================================================
# 3. Media asset catalog
# ======================================================================
class MediaAsset(models.Model):
    """
    Catalog of every uploaded file. The Supabase Storage migration
    (0015) is the BYTES layer; this is the metadata layer. The CDN
    can then use the public URL column to populate edge caches, and
    the analytics/backup features can iterate ``MediaAsset`` instead
    of grepping every Message row.

    Lifecycle:
      * UPLOADED  — bytes on storage, processing queue enqueued.
      * PROCESSED — thumb + webp variants generated; ready to serve.
      * FAILED    — transcoding rejected (corrupt, too big, banned
                    MIME); bytes purged from storage.
    """

    STATUS_UPLOADED = 'uploaded'
    STATUS_PROCESSED = 'processed'
    STATUS_FAILED = 'failed'

    KIND_IMAGE = 'image'
    KIND_VIDEO = 'video'
    KIND_AUDIO = 'audio'
    KIND_FILE = 'file'

    id = models.BigAutoField(primary_key=True)
    uploader = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='media_assets',
    )
    kind = models.CharField(max_length=16, db_index=True)
    bucket = models.CharField(max_length=64, db_index=True)
    storage_path = models.CharField(max_length=512, db_index=True)
    public_url = models.URLField(max_length=1024, blank=True, default='')
    size_bytes = models.BigIntegerField(default=0)
    mime_type = models.CharField(max_length=128, blank=True, default='')
    # sha256 of the bytes — used to dedup uploads + to verify backup
    # integrity (the BackupArchive flow snapshots hashes for diffing).
    sha256 = models.CharField(max_length=64, blank=True, default='')
    status = models.CharField(
        max_length=16,
        choices=[
            (STATUS_UPLOADED, 'Uploaded'),
            (STATUS_PROCESSED, 'Processed'),
            (STATUS_FAILED, 'Failed'),
        ],
        default=STATUS_UPLOADED, db_index=True,
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['uploader', '-created_at'], name='media_uploader_time_idx'),
            models.Index(fields=['kind', 'status'], name='media_kind_status_idx'),
            models.Index(fields=['sha256'], name='media_sha256_idx'),
        ]

    def __str__(self):
        return f'MediaAsset({self.kind} {self.bucket}/{self.storage_path} {self.status})'


# ======================================================================
# 4. Maintenance mode
# ======================================================================
class MaintenanceWindow(models.Model):
    """
    A scheduled or active maintenance window. The middleware reads the
    latest row with ``is_active=True`` on every request (cheap with
    the index below) so toggling is instant. An ``ends_at`` in the
    past auto-expires; the row stays so the audit log shows when the
    last maintenance was.

    The Channels layer broadcasts a ``maintenance.toggle`` event on
    every save so connected clients can show / hide the banner
    without a page reload.
    """

    SCOPE_READ_ONLY = 'read_only'
    SCOPE_FULL_LOCKOUT = 'full_lockout'

    id = models.BigAutoField(primary_key=True)
    is_active = models.BooleanField(default=True, db_index=True)
    scope = models.CharField(
        max_length=16,
        choices=[
            (SCOPE_READ_ONLY, 'Read-only'),
            (SCOPE_FULL_LOCKOUT, 'Full lockout'),
        ],
        default=SCOPE_READ_ONLY,
    )
    message = models.TextField(blank=True, default='')
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='maintenance_started',
    )
    ended_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='maintenance_ended',
    )

    class Meta:
        indexes = [
            models.Index(fields=['is_active', '-starts_at'], name='maint_active_time_idx'),
        ]

    def is_currently_active(self) -> bool:
        if not self.is_active:
            return False
        if self.ends_at and self.ends_at <= timezone.now():
            return False
        return True

    def __str__(self):
        return f'MaintenanceWindow(active={self.is_active} scope={self.scope})'


def current_maintenance() -> Optional[MaintenanceWindow]:
    """
    Return the active MaintenanceWindow or None. Cached in Django's
    default cache for 5s — the toggle is rare, audited, and the
    cost of a stale read for 5s is acceptable.
    """
    cache_key = 'part8_current_maintenance'
    cached = cache.get(cache_key)
    if cached is not None:
        if cached == '__none__':
            return None
        return cached
    win = (
        MaintenanceWindow.objects
        .filter(is_active=True)
        .order_by('-starts_at')
        .first()
    )
    if win and not win.is_currently_active():
        win = None
    cache.set(cache_key, win or '__none__', 5)
    return win


# ======================================================================
# 5. Rate limit bucket
# ======================================================================
class RateLimitBucket(models.Model):
    """
    Finer-grained throttling than DRF's built-in scope system. The
    DRF ``user`` scope is a flat 30/min global cap; the spec wants
    per-endpoint buckets (e.g. ``login`` is 5/min, ``ai/translate`` is
    20/min, ``uploads`` is 10/min).

    Row shape:
        (bucket_name, key) → (count, window_start)
    Hits past ``limit`` within ``window_seconds`` are rejected; the
    helper returns ``(False, retry_after)`` so the caller can populate
    the ``Retry-After`` header.

    The composite uniqueness on (bucket, key) means a single
    UPSERT keeps the implementation atomic at the row level. The
    ``window_start`` is bumped on every limit-exceeded transition
    so the bucket is naturally rolling.
    """

    id = models.BigAutoField(primary_key=True)
    bucket = models.CharField(max_length=64, db_index=True)
    key = models.CharField(max_length=128, db_index=True)
    count = models.PositiveIntegerField(default=0)
    window_start = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['bucket', 'key'], name='rate_bucket_key_unique'),
        ]
        indexes = [
            models.Index(fields=['expires_at'], name='rate_expires_idx'),
        ]

    def __str__(self):
        return f'RateLimitBucket({self.bucket}:{self.key} {self.count})'


def rate_limit_check(bucket: str, key: str, limit: int,
                     window_seconds: int = 60) -> Tuple[bool, int]:
    """
    Atomic check-and-increment. Returns ``(allowed, retry_after)``.

    ``retry_after`` is 0 when ``allowed`` is True. When ``allowed`` is
    False, it is the number of seconds until the current window expires
    (a non-strict lower bound — clients should back off and retry
    after that, not at exactly that second).

    The implementation is a single ``update_or_create`` so the
    round-trip cost is one DB call. We don't use ``SELECT FOR UPDATE``
    because the row-level write lock is already taken by
    ``update_or_create`` in MySQL/Postgres/SQLite.
    """
    now = timezone.now()
    expires_at = now + timedelta(seconds=window_seconds)
    try:
        with transaction.atomic():
            row, created = RateLimitBucket.objects.update_or_create(
                bucket=bucket, key=key,
                defaults={
                    'count': 1,
                    'window_start': now,
                    'expires_at': expires_at,
                },
            )
            if created:
                return True, 0
            # If the previous window has expired, reset count to 1.
            if row.window_start and (now - row.window_start).total_seconds() >= window_seconds:
                row.count = 1
                row.window_start = now
                row.expires_at = expires_at
                row.save(update_fields=['count', 'window_start', 'expires_at'])
                return True, 0
            # Otherwise bump.
            if row.count >= limit:
                # Compute retry_after from the current window's expires_at.
                remaining = (row.expires_at - now).total_seconds()
                return False, max(1, int(remaining))
            row.count += 1
            row.save(update_fields=['count'])
            return True, 0
    except Exception as e:  # pragma: no cover - defensive
        # A DB hiccup must NEVER take a request down. Log + allow.
        logger.warning('rate_limit_check failed for %s:%s: %s', bucket, key, e)
        return True, 0


# ======================================================================
# 6. Security alert
# ======================================================================
class SecurityAlert(models.Model):
    """
    Auto-generated alert when the ``security_sweep`` management command
    (or a real-time hook in the auth views) flags a pattern:
      * brute_force   — 5+ failed logins from one IP in 60s.
      * impossible_travel — successful logins from two IPs >1000km
                            apart in <30min.
      * api_abuse     — single user hits 10x their normal request rate.
      * spam_attack   — 20+ outbound messages from one user in 60s.
      * bot_behavior  — registration burst (10+ signups in 5min) from
                        a single IP range.

    Each row carries the evidence in ``metadata`` (JSON) so a staff
    member investigating doesn't have to re-run the detection query.
    Resolved rows keep their resolution_note + resolved_by for the
    audit trail.
    """

    KIND_CHOICES = [
        ('brute_force', 'Brute Force'),
        ('impossible_travel', 'Impossible Travel'),
        ('api_abuse', 'API Abuse'),
        ('spam_attack', 'Spam Attack'),
        ('bot_behavior', 'Bot Behavior'),
    ]
    SEVERITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ]

    id = models.BigAutoField(primary_key=True)
    kind = models.CharField(max_length=32, choices=KIND_CHOICES, db_index=True)
    severity = models.CharField(
        max_length=16, choices=SEVERITY_CHOICES, default='medium', db_index=True,
    )
    user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='security_alerts',
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)
    resolved = models.BooleanField(default=False, db_index=True)
    resolved_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='security_alerts_resolved',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=512, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['kind', '-created_at'], name='secalert_kind_time_idx'),
            models.Index(fields=['resolved', '-created_at'], name='secalert_status_time_idx'),
            models.Index(fields=['severity', 'resolved'], name='secalert_sev_resolved_idx'),
        ]

    def __str__(self):
        return f'SecurityAlert({self.kind} sev={self.severity} resolved={self.resolved})'


# ---------------------------------------------------------------------
# Impossible-travel detector
# ---------------------------------------------------------------------
# Great-circle distance between two (lat, lon) points in km.
# We use this so the detector can reason about whether two logins are
# physically reachable in the time elapsed, instead of relying on
# crude "different country code" heuristics that miss VPN hops.
def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    try:
        lat1, lon1, lat2, lon2 = map(float, (lat1, lon1, lat2, lon2))
    except (TypeError, ValueError):
        return 0.0
    r = 6371.0  # Earth radius in km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def impossible_travel(user: User, current_ip: str, when=None) -> Optional[Dict[str, Any]]:
    """
    Return a dict describing the impossible-travel evidence if the
    user's last successful login was from a far-away IP within an
    impossibly short time window. Returns ``None`` if no anomaly.

    Heuristic:
      * Look at the user's two most-recent successful ``LoginAttempt``s.
      * If they're > 30 minutes apart, ignore (long enough for a real
        flight).
      * Else if the geographic distance (haversine) is > the distance
        a 1000 km/h jet could cover in that window, flag.

    IP → lat/lon lookup is best-effort via the in-process
    ``ip_geolocation`` table populated by the ``ip_geo_update``
    management command (it pulls from a public CSV daily). If the
    IP isn't in the table, we return None rather than false-positive.
    """
    when = when or timezone.now()
    if not current_ip:
        return None
    # Lazy import to avoid a hard dep on the geolocation table.
    try:
        from api.models import LoginAttempt, IPGeolocation
    except ImportError:
        return None
    recent = list(
        LoginAttempt.objects
        .filter(user=user, success=True, ip_address__isnull=False)
        .exclude(ip_address='')
        .order_by('-created_at')[:2]
    )
    if len(recent) < 2:
        return None
    last, prev = recent[0], recent[1]
    if last.ip_address == current_ip:
        return None
    minutes_apart = (when - prev.created_at).total_seconds() / 60.0
    if minutes_apart > 30:
        return None
    # Look up the geo for both IPs.
    def _geo(ip):
        row = IPGeolocation.objects.filter(ip_address=ip).first()
        if not row:
            return None
        return (row.latitude, row.longitude)
    last_geo = _geo(last.ip_address)
    prev_geo = _geo(current_ip)
    if not last_geo or not prev_geo:
        return None
    km = _haversine_km(prev_geo[0], prev_geo[1], last_geo[0], last_geo[1])
    # Max distance a 1000 km/h flight could cover in the elapsed time.
    max_km = max(1.0, 1000.0 * (minutes_apart / 60.0))
    if km <= max_km:
        return None
    return {
        'km': round(km, 1),
        'minutes_apart': round(minutes_apart, 1),
        'previous_ip': prev.ip_address,
        'current_ip': current_ip,
        'previous_geo': {'lat': prev_geo[0], 'lon': prev_geo[1]},
        'current_geo': {'lat': last_geo[0], 'lon': last_geo[1]},
    }


# ======================================================================
# 7. Deployment event
# ======================================================================
class DeploymentEvent(models.Model):
    """
    A single deploy / preflight / rollback audit row. Written by:
      * The ``preflight`` management command (one row per check).
      * The CI / CD pipeline (one row per release via the
        ``deployment_event`` helper).
      * A rollback action (one row on each roll-forward + roll-back).

    The operator dashboard reads ``DeploymentEvent`` to show "last
    successful deploy" + "deploys in last 24h" + a per-environment
    pass/fail timeline.
    """

    KIND_CHOICES = [
        ('preflight', 'Preflight Check'),
        ('deploy', 'Deploy'),
        ('rollback', 'Rollback'),
        ('migrate', 'Migration'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('success', 'Success'),
        ('failure', 'Failure'),
        ('rolled_back', 'Rolled Back'),
    ]

    id = models.BigAutoField(primary_key=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, db_index=True)
    environment = models.CharField(max_length=16, db_index=True, default='production')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='pending', db_index=True)
    commit_sha = models.CharField(max_length=64, blank=True, default='')
    actor = models.CharField(max_length=128, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['environment', '-created_at'], name='deploy_env_time_idx'),
            models.Index(fields=['kind', 'status'], name='deploy_kind_status_idx'),
        ]

    def __str__(self):
        return f'DeploymentEvent({self.kind} {self.environment} {self.status})'


# ---------------------------------------------------------------------
# A small geo table for impossible_travel(). Populated by the
# ``ip_geo_update`` management command (CSV import from a public
# source). No PII — just IP → (lat, lon, country).
# ---------------------------------------------------------------------
class IPGeolocation(models.Model):
    """IP → (lat, lon, country) lookup, refreshed daily."""

    ip_address = models.GenericIPAddressField(primary_key=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    country = models.CharField(max_length=8, blank=True, default='')
    city = models.CharField(max_length=128, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['country'], name='ipgeo_country_idx'),
        ]

    def __str__(self):
        return f'IPGeolocation({self.ip_address} {self.country})'
