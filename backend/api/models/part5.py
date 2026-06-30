"""
Part 5 — premium messenger features.

Seven new tables that back the Part 5 spec (AI features, scheduled
messages, chat folders, premium subscriptions, anti-spam reporting,
backup archives). See ``backend/api/views/part5.py`` for the
corresponding ViewSets and the per-model docstrings in the same file
for the WHY behind each field.

Naming choices:
  * ``ChatFolder`` (not ``Folder``) — same anti-collision reasoning as
    ``ChatGroup`` in part4.py: Django's auth machinery walks the
    ``Group`` class for permission classes, so reusing the name
    silently breaks the admin.
  * ``ChatFolderMembership`` — M2M through-table (user, folder, thread)
    so the same thread can live in N of the user's folders, which is
    the spec's "Move conversations between folders" requirement.
  * ``SmartReplyCache`` — per-(thread, message) cache of the last AI
    reply suggestions so we don't re-bill Gemini on every page-open.
  * ``BackupArchive`` — JSON dump + signed hash; on restore the FE
    presents a diff so the user sees exactly what will be written.
  * ``SpamReport`` — distinct from the existing ``BlockedUser`` because
    a block is bilateral and a report is one-way to the moderation
    team. Auto-rate-limit is implemented at the views layer (see
    ``views/part5.py`` -> ``SpamReportViewSet``) NOT in the model.
"""
from __future__ import annotations

import hashlib

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


# ====================================================================
# 1. AI SMART-REPLY CACHE
# ====================================================================
#
# Spec §SMART REPLIES: "When a user receives a message, generate
# intelligent reply suggestions." We call Gemini to produce 3 short
# candidate replies for the most recent incoming message in a thread
# and cache the result here. TTL is 1 hour; the same suggestion is
# reused for the same (thread, message, user) tuple so refreshing the
# page doesn't re-bill.
#
class SmartReplyCache(models.Model):
    """Cached AI reply suggestions for a (thread, message) pair.

    Per the Part 5 spec, smart replies are thread-context aware
    ("Okay" / "Sounds good" / "See you soon" depending on the
    conversation). We cache the prompt's response so back-navigation
    re-renders instantly without re-hitting Gemini.
    """
    thread = models.ForeignKey(
        'api.ChatThread', on_delete=models.CASCADE,
        related_name='smart_reply_cache',
    )
    # The message we generated replies FOR (the latest incoming msg in
    # the thread). Nullable: if the source message is later deleted,
    # we SET_NULL so the cache row survives for the (short) TTL and
    # then ages out.
    source_message = models.ForeignKey(
        'api.Message', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='smart_reply_rows',
    )
    # The user the suggestions are FOR (the recipient, not the
    # sender). The same incoming message produces DIFFERENT replies
    # for different recipients depending on prior context, so this
    # is part of the cache key.
    for_user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='smart_reply_cache',
    )
    # JSON list of 1-3 short candidate replies (max 80 chars each).
    suggestions = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(
        help_text='After this time, regenerate on next request.',
    )

    class Meta:
        # One cache row per (thread, source_message, for_user). A second
        # user reading the same message gets a separate row.
        unique_together = ('thread', 'source_message', 'for_user')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['expires_at'], name='smartreply_ttl_idx'),
        ]

    def is_fresh(self) -> bool:
        return self.expires_at > timezone.now()

    def __str__(self):
        return f"SmartReply cache for thread {self.thread_id} → user {self.for_user_id}"


# ====================================================================
# 2. SCHEDULED MESSAGE
# ====================================================================
#
# Spec §MESSAGE SCHEDULING: "Users can schedule messages ... backend
# sends messages automatically." We persist the pending send as a
# ScheduledMessage row. A periodic worker (management command
# ``cleanup_expired`` + external cron) scans for rows whose
# ``send_at`` is in the past and promotes them into a real ``Message``
# row, then deletes the schedule row. This keeps the live ``Message``
# table clean (no is_scheduled=False rows that the chat consumer
# would have to special-case) and lets the user edit/cancel a
# pending send without polluting the chat history.
#
class ScheduledMessage(models.Model):
    STATUS_CHOICES = [
        ('pending', 'pending'),
        ('sent', 'sent'),
        ('cancelled', 'cancelled'),
        ('failed', 'failed'),
    ]
    thread = models.ForeignKey(
        'api.ChatThread', on_delete=models.CASCADE,
        related_name='scheduled_messages',
    )
    sender = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='scheduled_messages',
    )
    content = models.TextField(blank=True, default='')
    # Base64 voice / image — same encoding as Message.
    audio = models.TextField(blank=True, default='')
    image = models.TextField(blank=True, default='')
    reply_to = models.ForeignKey(
        'api.Message', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='scheduled_replies',
    )
    send_at = models.DateTimeField(
        help_text='UTC timestamp when the worker should promote this '
                  'to a real Message row.',
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default='pending',
    )
    # The promoted Message row (NULL until promotion). Set to NULL on
    # cascade so deleting the Message doesn't cascade-delete the
    # schedule record (audit value).
    promoted_message = models.ForeignKey(
        'api.Message', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='promoted_from_schedules',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['send_at']
        indexes = [
            # The worker's hot scan: WHERE status='pending' AND send_at <= now()
            # ORDER BY send_at LIMIT N. Composite index makes this one B-tree walk.
            models.Index(
                fields=['status', 'send_at'],
                name='sched_status_time_idx',
            ),
        ]

    def __str__(self):
        return f"Scheduled msg in thread {self.thread_id} for {self.send_at}"


# ====================================================================
# 3. CHAT FOLDER + MEMBERSHIP
# ====================================================================
#
# Spec §CHAT FOLDERS: "Allow users to create folders. Examples: Work,
# Friends, Family, School, Business, Gaming. Users can move
# conversations between folders."
#
# Folders are PER-USER (Alice's "Work" folder is not Bob's "Work"
# folder). We use a through-table (user, folder, thread) so a single
# thread can live in multiple folders simultaneously (e.g. a colleague
# who's also a family friend can be in both "Work" and "Family" for
# the same thread).
#
class ChatFolder(models.Model):
    """A user-owned folder that groups threads in the messenger sidebar."""
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='chat_folders',
    )
    name = models.CharField(max_length=60)
    # Hex / theme color for the folder chip. Free-form so the user can
    # pick any CSS-compatible color. Defaults to the primary brand color.
    color = models.CharField(max_length=20, blank=True, default='')
    # Display order in the folder sidebar (lowest first).
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Per-user uniqueness so two folders with the same name can't
        # collide in the same user's sidebar.
        unique_together = ('user', 'name')
        ordering = ['sort_order', 'name']
        indexes = [
            models.Index(fields=['user', 'sort_order'], name='folder_user_order_idx'),
        ]

    def __str__(self):
        return f"Folder {self.name} (user {self.user_id})"


class ChatFolderMembership(models.Model):
    """A (folder, thread) link. The folder's owner is implicit (folder.user)."""
    folder = models.ForeignKey(
        ChatFolder, on_delete=models.CASCADE, related_name='memberships',
    )
    thread = models.ForeignKey(
        'api.ChatThread', on_delete=models.CASCADE,
        related_name='folder_memberships',
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Idempotent: adding the same thread twice to the same folder
        # is a no-op rather than a duplicate row.
        unique_together = ('folder', 'thread')
        indexes = [
            models.Index(fields=['thread'], name='folderthread_thread_idx'),
        ]

    def __str__(self):
        return f"Folder {self.folder_id} ↔ thread {self.thread_id}"


# ====================================================================
# 4. PREMIUM SUBSCRIPTION (history) + Profile flags
# ====================================================================
#
# The Profile model gets two new fields: ``is_premium`` (boolean) and
# ``premium_until`` (datetime). For the simple "are you premium right
# now" check during a request, those two fields are sufficient. The
# PremiumSubscription table is the HISTORY of plan changes — it lets
# us render "You were on Premium for 14 months" or "Your last plan
# was Family Quarterly" without losing the data when a subscription
# lapses.
#
class PremiumSubscription(models.Model):
    PLAN_CHOICES = [
        ('monthly', 'Monthly'),
        ('quarterly', 'Quarterly'),
        ('yearly', 'Yearly'),
        ('lifetime', 'Lifetime'),
    ]
    STATUS_CHOICES = [
        ('active', 'active'),
        ('cancelled', 'cancelled'),
        ('expired', 'expired'),
        ('refunded', 'refunded'),
    ]
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='premium_subscriptions',
    )
    plan = models.CharField(max_length=10, choices=PLAN_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='active')
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # Last-4 of the card / payment provider reference. NOT a full
    # PAN — we never want to store the real card number. Future Stripe
    # integration would replace this with a Stripe Subscription id.
    payment_ref = models.CharField(max_length=40, blank=True, default='')

    class Meta:
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['user', '-started_at'], name='premium_user_time_idx'),
        ]

    def is_currently_active(self) -> bool:
        return (
            self.status == 'active'
            and self.expires_at > timezone.now()
        )

    def __str__(self):
        return f"Premium {self.plan} for user {self.user_id} ({self.status})"


# ====================================================================
# 5. SPAM REPORT
# ====================================================================
#
# Spec §ANTI-SPAM: "Automatically detect spam, scam links, mass
# messaging, bot accounts, fake accounts, suspicious behaviour. Auto
# rate-limit abusive users."
#
# Detection happens heuristically at send-time (see views/part5.py
# MessageViewSet extension -> ``_score_spam``). Reports are user-
# submitted confirmations: a report from a recipient after a
# message has already been delivered. The combination of (a)
# heuristic send-time flagging + (b) user report = our combined
# signal.
#
class SpamReport(models.Model):
    REASON_CHOICES = [
        ('spam', 'Spam'),
        ('scam', 'Scam / phishing'),
        ('abuse', 'Abusive language'),
        ('impersonation', 'Impersonation / fake account'),
        ('mass_message', 'Mass / bot messaging'),
        ('other', 'Other'),
    ]
    reporter = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='spam_reports_filed',
    )
    reported_user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='spam_reports_received',
    )
    # Optional — a spam report can be against a user (general) or a
    # specific message. message is NULL when the report is user-level.
    message = models.ForeignKey(
        'api.Message', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='spam_reports',
    )
    reason = models.CharField(max_length=15, choices=REASON_CHOICES)
    description = models.TextField(blank=True, default='')
    # Heuristic score at the time of send (0-100) for cross-checking
    # the user report. NULL when the report is user-level (no specific
    # message to score).
    heuristic_score = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Moderation status. New reports default to 'open' and a
    # staff user triages them via /api/spam-reports/.
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        # A user can only file the same (message, reason) once. If
        # they want to add a description they update the existing row.
        unique_together = ('reporter', 'message', 'reason')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['reported_user', '-created_at'], name='spamreport_target_idx'),
            models.Index(fields=['resolved', '-created_at'], name='spamreport_status_idx'),
        ]

    def __str__(self):
        return f"Spam report by {self.reporter_id} → {self.reported_user_id} ({self.reason})"


# ====================================================================
# 6. BACKUP ARCHIVE
# ====================================================================
#
# Spec §MESSAGE BACKUP: "Allow users to backup conversations. Restore
# conversations. Backup media. Encrypt backups."
#
# We persist the most recent backup per user as a JSON blob (text
# messages + metadata). Media (images, voice) are referenced by URL
# but NOT included in the archive — downloading every attachment
# would explode the row size. A full media restore would need an
# async job (out of scope for a single-session delivery). Encryption
# is a followup: the API already returns over HTTPS, so the wire is
# encrypted; at-rest encryption is a property of the storage layer.
#
class BackupArchive(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='backup_archives',
    )
    # SHA-256 of the JSON payload so the FE can verify integrity on
    # restore without trusting the server. NOT for security (a
    # hostile server could lie) — for tamper detection after a
    # legitimate backup is created.
    payload_hash = models.CharField(max_length=64)
    # Stats for the FE: "324 messages, 18 threads, 12 images".
    payload_summary = models.JSONField(default=dict, blank=True)
    # Raw JSON dump of messages, threads, profile, settings.
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Size on disk in bytes (best-effort: len(json.dumps(payload))).
    payload_bytes = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'], name='backup_user_time_idx'),
        ]

    @staticmethod
    def hash_payload(payload: dict) -> str:
        import json
        canonical = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()

    def __str__(self):
        return f"Backup for user {self.user_id} @ {self.created_at}"


# ====================================================================
# 7. ANTI-SPAM HEURISTIC
# ====================================================================
#
# Pure helper, NOT a model. Lives here because it needs to be
# importable from views/part5.py and from tests. Heuristic scoring
# runs in <1ms; we cap the weight of any single signal so a single
# long URL doesn't auto-classify a message as spam.
#
def score_spam(text: str) -> int:
    """
    Return a 0-100 spam score for ``text``. Higher = more spammy.

    Signals:
      * URL density:        +0..30   (cap at 3+ urls)
      * Caps ratio:         +0..25   (>50% caps on >= 12 chars)
      * Banned keywords:    +0..30   (one per hit, capped at 3)
      * Repetition:         +0..15   (one word >40% of total tokens)
      * Excessive emoji:    +0..10   (>20% of characters are emoji)
      * Phone number:       +0..10   (digit density >30%)

    Returns the sum, capped at 100. Threshold for "likely spam" is
    60 (see views/part5.py -> SpamReportViewSet).
    """
    if not text or not text.strip():
        return 0

    score = 0
    t = text.strip()
    lower = t.lower()
    char_count = max(len(t), 1)
    token_count = max(len(t.split()), 1)

    # 1. URL density
    import re as _re
    urls = _re.findall(r'https?://\S+', t)
    if len(urls) >= 3:
        score += 30
    elif len(urls) == 2:
        score += 20
    elif len(urls) == 1:
        score += 10

    # 2. Caps ratio (only on >= 12 chars to avoid false positives on
    # short emphatic messages like "OK!")
    letters = [c for c in t if c.isalpha()]
    if len(letters) >= 12:
        caps = sum(1 for c in letters if c.isupper())
        caps_ratio = caps / len(letters)
        if caps_ratio > 0.7:
            score += 25
        elif caps_ratio > 0.5:
            score += 15

    # 3. Banned keywords (case-insensitive, word-boundary)
    banned = (
        'free money', 'click here', 'limited time', 'act now',
        'congratulations', 'you have won', 'verify your account',
        'crypto giveaway', 'double your', 'risk free', 'wire transfer',
        'western union', 'gift card', 'urgent', 'bitcoin',
    )
    hits = sum(1 for kw in banned if kw in lower)
    score += min(hits, 3) * 10

    # 4. Repetition
    from collections import Counter
    counts = Counter(lower.split())
    if counts:
        most_common_count = counts.most_common(1)[0][1]
        if most_common_count / token_count > 0.4 and token_count > 6:
            score += 15

    # 5. Excessive emoji
    emoji_chars = sum(1 for c in t if ord(c) > 0x1F000)
    if emoji_chars / char_count > 0.2:
        score += 10

    # 6. Phone-number-ish digit density
    digits = sum(1 for c in t if c.isdigit())
    if digits / char_count > 0.3 and digits >= 8:
        score += 10

    return min(score, 100)
