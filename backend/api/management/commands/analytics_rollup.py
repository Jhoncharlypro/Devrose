"""
``analytics_rollup`` — Part 8 analytics daily rollup.

Reads ``AnalyticsEvent`` rows older than the cutover, writes a
summary line per (kind, day) into ``DeploymentEvent.metadata`` (the
operator dashboard surfaces the rollup counts there), and purges
the raw events. Bounded to ``--batch-size`` rows per query so a
multi-million-row backlog doesn't OOM the worker.

The "raw events purge" step is conservative: we keep the last
7 days of raw events for the dashboard's recent-7d chart, and
purge anything older. The rollup itself stays as a daily aggregate
row so the operator can graph DAU / MAU trends.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from api.models import AnalyticsEvent, DeploymentEvent

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Roll up + purge old AnalyticsEvent rows.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--keep-days', type=int, default=7,
            help='Days of raw events to keep (default 7).',
        )
        parser.add_argument(
            '--batch-size', type=int, default=5000,
            help='Max rows to scan per query (default 5000).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would happen without writing.',
        )

    def handle(self, *args, **options):
        keep_days = max(1, options['keep_days'])
        batch_size = max(100, min(options['batch_size'], 100_000))
        dry = options['dry_run']
        cutoff = timezone.now() - timedelta(days=keep_days)
        # ---- 1. Rollup ----
        # Group by kind + day (date-truncated created_at). We
        # project to Python dicts to keep the implementation DB-agnostic
        # (Postgres DATE_TRUNC vs SQLite strftime would require a
        # second branch otherwise).
        per_kind_per_day = defaultdict(lambda: defaultdict(int))
        per_user_total = defaultdict(int)
        scan = 0
        for evt in (
            AnalyticsEvent.objects
            .filter(created_at__lt=cutoff)
            .order_by('id')
            .values('kind', 'user_id', 'created_at')[:batch_size]
        ):
            day = evt['created_at'].date().isoformat()
            per_kind_per_day[evt['kind']][day] += 1
            per_user_total[evt['user_id']] += 1
            scan += 1
        if scan == 0:
            self.stdout.write(self.style.SUCCESS(
                f'analytics_rollup: nothing older than {keep_days}d to roll up.'
            ))
            return
        # ---- 2. Persist rollup as a DeploymentEvent row ----
        rollup = {
            'cutoff': cutoff.isoformat(),
            'scan': scan,
            'kind_per_day': {
                kind: dict(days) for kind, days in per_kind_per_day.items()
            },
            'unique_users': len(per_user_total),
        }
        if not dry:
            DeploymentEvent.objects.create(
                kind='deploy', environment='analytics',
                status='success', actor='analytics_rollup',
                notes=f'rolled up {scan} events older than {keep_days}d',
                metadata=rollup,
            )
        self.stdout.write(self.style.SUCCESS(
            f'analytics_rollup: rolled up {scan} events '
            f'({rollup["unique_users"]} unique users) '
            f'across {len(per_kind_per_day)} kinds'
        ))
        # ---- 3. Purge ----
        if dry:
            self.stdout.write(self.style.WARNING('dry-run: skipping purge.'))
            return
        # Bulk delete in chunks so the DB doesn't lock for seconds.
        deleted = 0
        while True:
            ids = list(
                AnalyticsEvent.objects
                .filter(created_at__lt=cutoff)
                .order_by('id')
                .values_list('id', flat=True)[:batch_size]
            )
            if not ids:
                break
            n, _ = AnalyticsEvent.objects.filter(id__in=ids).delete()
            deleted += n
        self.stdout.write(self.style.SUCCESS(
            f'analytics_rollup: purged {deleted} rows older than {keep_days}d.'
        ))
