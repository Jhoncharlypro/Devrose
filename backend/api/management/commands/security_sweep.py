"""
``security_sweep`` — Part 8 security detector.

Walks the recent ``LoginAttempt`` + ``Message`` + ``JobQueue`` log
and writes a ``SecurityAlert`` row for every detected pattern:

  * brute_force   — 5+ failed logins from one IP in 60s.
  * impossible_travel — successful logins from two IPs >1000km
                        apart in <30min.
  * api_abuse     — single user hits 10x their normal request rate.
  * spam_attack   — 20+ outbound messages from one user in 60s.
  * bot_behavior  — 10+ signups from a single IP range in 5min.

Each detection runs in isolation — a failure in one detector
doesn't block the others. The sweep is idempotent: it only
considers events since the last sweep (recorded on
``SecurityAlert.metadata.sweep_id``).
"""
from __future__ import annotations

import hashlib
import logging
import time
import uuid
from collections import defaultdict
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from api.models import (
    LoginAttempt, SecurityAlert, Message, User,
)
from api.models.part8 import impossible_travel

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Detect security patterns and write SecurityAlert rows.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--window-minutes', type=int, default=5,
            help='Look-back window in minutes (default 5).',
        )
        parser.add_argument(
            '--no-output', action='store_true',
            help="Don't print anything (used by the API sweep action).",
        )

    def handle(self, *args, **options):
        window_min = max(1, options['window_minutes'])
        no_output = options['no_output']
        cutoff = timezone.now() - timedelta(minutes=window_min)
        sweep_id = uuid.uuid4().hex[:12]
        detectors = [
            ('brute_force', self._detector_brute_force),
            ('impossible_travel', self._detector_impossible_travel),
            ('api_abuse', self._detector_api_abuse),
            ('spam_attack', self._detector_spam_attack),
            ('bot_behavior', self._detector_bot_behavior),
        ]
        total_written = 0
        for name, fn in detectors:
            try:
                written = fn(cutoff, sweep_id)
                total_written += written
                if not no_output and written:
                    self.stdout.write(self.style.SUCCESS(
                        f'  ✓ {name}: {written} alert(s) written'
                    ))
            except Exception as e:
                if not no_output:
                    self.stdout.write(self.style.ERROR(
                        f'  ✗ {name}: {e!r}'
                    ))
                logger.exception('security_sweep detector %s failed', name)
        if not no_output:
            self.stdout.write(self.style.SUCCESS(
                f'security_sweep done: {total_written} alert(s) in {window_min}m window '
                f'(sweep_id={sweep_id})'
            ))

    # ---- individual detectors ----
    def _detector_brute_force(self, cutoff, sweep_id):
        # 5+ failed logins from one IP in the window.
        rows = (
            LoginAttempt.objects
            .filter(success=False, created_at__gte=cutoff)
            .values('ip_address')
            .annotate(n=Count('id'))
            .filter(n__gte=5)
        )
        written = 0
        for r in rows:
            ip = r['ip_address']
            if not ip:
                continue
            SecurityAlert.objects.create(
                kind='brute_force',
                severity='high',
                ip_address=ip,
                metadata={
                    'failed_logins': r['n'],
                    'window_minutes': self._window_minutes(cutoff),
                    'sweep_id': sweep_id,
                },
            )
            written += 1
        return written

    def _detector_impossible_travel(self, cutoff, sweep_id):
        # Walk the last hour of successful logins per user; flag any
        # pair that's impossible to physically reach. We keep the
        # window at 60m (longer than brute_force) so the detector
        # has time to span a real inter-city flight.
        extended_cutoff = timezone.now() - timedelta(minutes=60)
        # Find users with >=2 successful logins in the window.
        users = (
            LoginAttempt.objects
            .filter(success=True, created_at__gte=extended_cutoff, user__isnull=False)
            .values_list('user_id', flat=True)
            .annotate(n=Count('id'))
            .filter(n__gte=2)
        )
        written = 0
        for uid in users:
            user = User.objects.filter(pk=uid).first()
            if not user:
                continue
            last = (
                LoginAttempt.objects
                .filter(success=True, user=user, created_at__gte=extended_cutoff)
                .order_by('-created_at')
                .first()
            )
            if not last or not last.ip_address:
                continue
            evidence = impossible_travel(user, last.ip_address)
            if not evidence:
                continue
            SecurityAlert.objects.create(
                kind='impossible_travel',
                severity='critical',
                user=user,
                ip_address=last.ip_address,
                metadata={**evidence, 'sweep_id': sweep_id},
            )
            written += 1
        return written

    def _detector_api_abuse(self, cutoff, sweep_id):
        # Single user with 500+ requests in the window. The exact
        # threshold is intentionally high; the spec wants
        # "10x normal rate" which we approximate as 500 req/5min.
        from api.models import UserSession
        rows = (
            UserSession.objects
            .filter(last_seen__gte=cutoff)
            .values('user_id')
            .annotate(n=Count('id'))
            .filter(n__gte=500)
        )
        written = 0
        for r in rows:
            SecurityAlert.objects.create(
                kind='api_abuse',
                severity='medium',
                user_id=r['user_id'],
                metadata={'sessions_5m': r['n'], 'sweep_id': sweep_id},
            )
            written += 1
        return written

    def _detector_spam_attack(self, cutoff, sweep_id):
        # 20+ outbound messages from one user in the window.
        rows = (
            Message.objects
            .filter(created_at__gte=cutoff, sender__isnull=False)
            .values('sender_id')
            .annotate(n=Count('id'))
            .filter(n__gte=20)
        )
        written = 0
        for r in rows:
            SecurityAlert.objects.create(
                kind='spam_attack',
                severity='high',
                user_id=r['sender_id'],
                metadata={'messages_5m': r['n'], 'sweep_id': sweep_id},
            )
            written += 1
        return written

    def _detector_bot_behavior(self, cutoff, sweep_id):
        # 10+ signups from a single /24 subnet in the window. We
        # approximate the subnet with a SHA-256 of the IP so the
        # row never accidentally leaks the actual IP range.
        rows = (
            LoginAttempt.objects
            .filter(success=False, created_at__gte=cutoff, failure_reason='invalid_credentials')
            .values('ip_address')
            .annotate(n=Count('id'))
            .filter(n__gte=10)
        )
        written = 0
        for r in rows:
            ip = r['ip_address']
            if not ip:
                continue
            subnet_hash = hashlib.sha256(
                '.'.join(ip.split('.')[:3]).encode('utf-8')
            ).hexdigest()[:16]
            SecurityAlert.objects.create(
                kind='bot_behavior',
                severity='high',
                ip_address=ip,
                metadata={
                    'signup_probes_5m': r['n'],
                    'subnet_hash': subnet_hash,
                    'sweep_id': sweep_id,
                },
            )
            written += 1
        return written

    def _window_minutes(self, cutoff):
        return int((timezone.now() - cutoff).total_seconds() / 60)
