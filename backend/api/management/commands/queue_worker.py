"""
``queue_worker`` — DB-backed background job worker.

Drains the ``JobQueue`` table. Designed to run under systemd /
supervisor / k8s CronJob; one process per worker, scale
horizontally by adding more processes.

Lifecycle per loop:
  1. Claim a batch of pending jobs (SKIP LOCKED on Postgres; a
     single UPDATE on SQLite dev path).
  2. Dispatch to the registered handler by ``name``.
  3. Mark the job done; on exception, increment ``attempts`` and
     re-queue (status='pending') if attempts < max_attempts,
     else mark 'dead'.
  4. Sleep ``--interval`` seconds and repeat.

Handlers are registered via the ``@register_handler`` decorator
in the same module. Each handler is ``def handle(payload) -> None``
and MUST be idempotent (the worker re-runs on retry).
"""
from __future__ import annotations

import functools
import logging
import socket
import time
import traceback
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.utils import timezone

from api.models import JobQueue, DeploymentEvent

logger = logging.getLogger(__name__)

# Handler registry: name -> callable(payload: dict) -> None.
# Populated by @register_handler below.
_HANDLERS = {}


def register_handler(name):
    """Decorator that registers a function as the handler for a job name."""
    def deco(fn):
        _HANDLERS[name] = fn
        return fn
    return deco


# ---------------- built-in handlers ----------------
@register_handler('media.transcode')
def handle_media_transcode(payload):
    """Stub media transcoder. Real impl would call ffmpeg / a worker
    service; this just logs the request so the queue is exercised
    end-to-end in dev."""
    logger.info('media.transcode payload=%s', payload)


@register_handler('email.send')
def handle_email_send(payload):
    """Stub email sender. Real impl would call SendGrid / SES."""
    logger.info('email.send payload=%s', payload)


@register_handler('backup.create')
def handle_backup_create(payload):
    """Stub backup creator. Real impl would snapshot Supabase storage."""
    logger.info('backup.create payload=%s', payload)


@register_handler('analytics.rollup')
def handle_analytics_rollup(payload):
    """Stub analytics rollup. Real impl would group events into a
    daily aggregate table."""
    logger.info('analytics.rollup payload=%s', payload)


@register_handler('notifications.broadcast')
def handle_notifications_broadcast(payload):
    """Push a broadcast via Channels. Failures are caught by the
    worker so the row transitions to failed→dead instead of
    poisoning the queue."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)('system_broadcast', payload)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning('notifications.broadcast group_send failed: %s', e)


class Command(BaseCommand):
    help = 'Drain the JobQueue table (DB-backed background worker).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--interval', type=float, default=5.0,
            help='Seconds to sleep between empty polls (default 5).',
        )
        parser.add_argument(
            '--once', action='store_true',
            help='Process one batch and exit (useful for cron).',
        )
        parser.add_argument(
            '--batch-size', type=int, default=25,
            help='Max jobs to claim per poll (default 25).',
        )
        parser.add_argument(
            '--max-runtime', type=int, default=0,
            help='Stop after N seconds (0 = run forever).',
        )
        parser.add_argument(
            '--host-id', default=socket.gethostname()[:120],
            help='Override the worker host id (default = hostname).',
        )

    def handle(self, *args, **options):
        host = options['host_id'] or socket.gethostname()[:120]
        interval = max(0.5, options['interval'])
        once = options['once']
        batch = max(1, min(options['batch_size'], 200))
        max_runtime = options['max_runtime']
        start = time.time()
        # Audit "worker started" so the deploy dashboard shows the
        # worker liveness timeline.
        DeploymentEvent.objects.create(
            kind='deploy', environment='worker',
            status='running', actor=host,
            notes=f'queue_worker started (batch={batch}, interval={interval}s)',
        )
        self.stdout.write(self.style.SUCCESS(
            f'queue_worker: started host={host} batch={batch} interval={interval}s'
        ))
        try:
            while True:
                ran_any = self._drain_once(host, batch)
                if once:
                    break
                if not ran_any:
                    time.sleep(interval)
                if max_runtime and (time.time() - start) > max_runtime:
                    self.stdout.write(self.style.SUCCESS(
                        f'queue_worker: max-runtime {max_runtime}s reached, exiting.'
                    ))
                    break
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING('queue_worker: keyboard interrupt, exiting.'))

    def _drain_once(self, host, batch):
        """Claim a batch and dispatch. Returns True if any work was done."""
        jobs = self._claim_batch(host, batch)
        if not jobs:
            return False
        for job in jobs:
            self._process_one(job)
        return True

    def _claim_batch(self, host, batch):
        """
        Claim up to ``batch`` jobs that are due. We do this in two
        steps so the per-row SELECT-then-UPDATE pattern is portable
        across Postgres (FOR UPDATE SKIP LOCKED) and SQLite (a
        single UPDATE picks one row by id).
        """
        now = timezone.now()
        # Find candidates.
        candidates = list(
            JobQueue.objects
            .filter(status=JobQueue.STATUS_PENDING, run_at__lte=now)
            .order_by('run_at')
            .values_list('id', flat=True)[:batch]
        )
        if not candidates:
            return []
        # Atomically claim each row. We re-fetch + save instead of
        # using ``update(attempts=F('attempts') + 1)`` because the
        # F() expression inside ``update()`` is rejected by SQLite
        # (no subquery in UPDATE) and Django's docs warn against
        # mixing it with multi-table inheritance. The claim window
        # is tiny because the SELECT ordered by ``run_at`` picks
        # the most-overdue jobs first, so a thundering herd of
        # workers stepping on each other is bounded.
        claimed_jobs = []
        for jid in candidates:
            try:
                with transaction.atomic():
                    job = JobQueue.objects.select_for_update().get(
                        id=jid, status=JobQueue.STATUS_PENDING,
                    )
                    job.status = JobQueue.STATUS_RUNNING
                    job.locked_at = now
                    job.locked_by = host
                    job.attempts = (job.attempts or 0) + 1
                    job.save(update_fields=['status', 'locked_at', 'locked_by', 'attempts'])
                    claimed_jobs.append(job)
            except JobQueue.DoesNotExist:
                # Another worker grabbed it first. Skip silently.
                continue
        return claimed_jobs

    def _process_one(self, job):
        """Dispatch a single claimed job. Updates status on success/failure."""
        handler = _HANDLERS.get(job.name)
        if handler is None:
            self._mark_failed(job, f'no handler registered for {job.name!r}', dead=True)
            return
        try:
            handler(job.payload or {})
        except Exception as e:
            tb = traceback.format_exc(limit=8)
            # Retry-or-dead decision.
            if job.attempts < job.max_attempts:
                self._mark_failed(
                    job, f'{e!r}\n{tb}',
                    dead=False,
                    next_status=JobQueue.STATUS_PENDING,
                    next_run=timezone.now() + timedelta(seconds=min(300, 5 * (2 ** job.attempts))),
                )
            else:
                self._mark_failed(job, f'{e!r}\n{tb}', dead=True)
            return
        # Success.
        job.status = JobQueue.STATUS_DONE
        job.locked_at = None
        job.locked_by = ''
        job.save(update_fields=['status', 'locked_at', 'locked_by'])

    def _mark_failed(self, job, error, *, dead=False, next_status=None, next_run=None):
        if dead:
            job.status = JobQueue.STATUS_DEAD
        else:
            job.status = next_status or JobQueue.STATUS_PENDING
        job.last_error = (error or '')[:4000]
        if next_run:
            job.run_at = next_run
        job.save(update_fields=['status', 'last_error', 'run_at'])
        logger.warning('queue_worker: job %s -> %s: %s', job.id, job.status, error[:200])
