"""
``cleanup_expired`` — periodic janitor command for Part 5 features.

Three responsibilities, run in this order:

  1. Sweep expired messages (is_ephemeral=True AND expires_at < now).
     Hard-delete is intentional: a "disappearing" message is a
     privacy promise and the spec asks us to honour it. Audit-log
     the delete count for observability.

  2. Promote due scheduled messages (status='pending' AND
     send_at <= now) into real Message rows. The promotion is a
     small transaction: create the Message, set
     schedule.promoted_message, flip status to 'sent'. A WebSocket
     broadcast is intentionally NOT done here — the next
     ``chat/threads/{id}/messages/`` GET will pick the new row up
     naturally. (A real-time push would require either polling
     the management command from Channels or wiring a signal
     handler; both are out-of-scope for a focused Part 5.)

  3. Prune stale smart-reply cache rows (expires_at < now) so the
     table doesn't grow unbounded. Cheap DELETE; index-driven.

Usage:
    python manage.py cleanup_expired                    # run once
    python manage.py cleanup_expired --dry-run          # report counts only
    python manage.py cleanup_expired --batch-size 5000  # cap per-loop

For a real production deployment, wire this to a cron entry (every
minute is overkill; every 5 minutes is plenty for "send at 14:30"
granularity) OR a celery-beat schedule. The command is idempotent
— running it twice in the same minute is a no-op the second time.
"""
from __future__ import annotations

import logging

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from api.models import (
    Message,
    ScheduledMessage,
    SmartReplyCache,
)

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Sweep expired (disappearing) messages, promote due scheduled '
        'sends, and prune stale smart-reply cache rows. Idempotent.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would happen without changing any rows.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Max rows affected per inner loop. Default 1000.',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        batch_size = max(1, int(options.get('batch_size') or 1000))
        now = timezone.now()

        self.stdout.write(self.style.NOTICE(
            f'cleanup_expired starting at {now.isoformat()} '
            f'(dry_run={dry_run}, batch_size={batch_size})'
        ))

        # ----- 1. Sweep expired messages ---------------------------------
        expired_qs = Message.objects.filter(
            is_ephemeral=True, expires_at__lt=now,
        ).order_by('expires_at')
        expired_count = expired_qs.count()
        if dry_run:
            self.stdout.write(f'[dry-run] Would delete {expired_count} expired messages.')
        else:
            deleted = 0
            while True:
                # ``iterator(chunk_size=...)`` keeps the cursor open and
                # streams rows in batches so a million-row sweep doesn't
                # blow the heap. Each batch is a single DELETE.
                batch_ids = list(
                    expired_qs.values_list('id', flat=True)[:batch_size]
                )
                if not batch_ids:
                    break
                Message.objects.filter(id__in=batch_ids).delete()
                deleted += len(batch_ids)
                self.stdout.write(f'  deleted {deleted}/{expired_count}...')
            self.stdout.write(self.style.SUCCESS(
                f'Deleted {deleted} expired messages.'
            ))

        # ----- 2. Promote due scheduled messages ------------------------
        due_qs = ScheduledMessage.objects.filter(
            status='pending', send_at__lte=now,
        ).select_related('thread', 'sender').order_by('send_at')
        due_count = due_qs.count()
        promoted = 0
        failed = 0
        if dry_run:
            self.stdout.write(f'[dry-run] Would promote {due_count} scheduled messages.')
        else:
            for schedule in due_qs.iterator(chunk_size=batch_size):
                try:
                    with transaction.atomic():
                        msg = Message.objects.create(
                            thread=schedule.thread,
                            sender=schedule.sender,
                            content=schedule.content,
                            audio=schedule.audio,
                            image=schedule.image,
                            reply_to=schedule.reply_to,
                        )
                        schedule.status = 'sent'
                        schedule.promoted_message = msg
                        schedule.save(update_fields=['status', 'promoted_message', 'updated_at'])
                    promoted += 1
                except Exception:  # noqa: BLE001
                    logger.exception(
                        'Failed to promote schedule %s', schedule.id,
                    )
                    schedule.status = 'failed'
                    schedule.save(update_fields=['status', 'updated_at'])
                    failed += 1
            self.stdout.write(self.style.SUCCESS(
                f'Promoted {promoted} scheduled messages '
                f'({failed} failed).'
            ))

        # ----- 3. Prune stale smart-reply cache -------------------------
        stale_qs = SmartReplyCache.objects.filter(expires_at__lt=now)
        stale_count = stale_qs.count()
        if dry_run:
            self.stdout.write(f'[dry-run] Would prune {stale_count} stale smart-reply cache rows.')
        else:
            while True:
                batch_ids = list(stale_qs.values_list('id', flat=True)[:batch_size])
                if not batch_ids:
                    break
                SmartReplyCache.objects.filter(id__in=batch_ids).delete()
            self.stdout.write(self.style.SUCCESS(
                f'Pruned {stale_count} stale smart-reply cache rows.'
            ))

        self.stdout.write(self.style.SUCCESS('cleanup_expired done.'))
