from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


# ─────────── Status privacy choices (shared by UserStory + overrides) ───────────
# The frontend privacy picker renders these options for new + existing stories.
# Each value MUST stay stable across releases — any rename here requires a
# data migration that rewrites existing UserStory.privacy values.
STATUS_PRIVACY_CHOICES = [
    ('public',          'Public — everyone (who is not blocked)'),            # default
    ('contacts_only',   'Contacts only'),                                       # ChatThread ∪ CallLog
    ('everyone_except', 'Everyone except…'),                                   # uses StatusPrivacyOverride as denylist
    ('only_share_with', 'Only share with…'),                                    # uses StatusPrivacyOverride as allowlist
    ('hidden',          'Hidden — explicitly only listed viewers'),             # uses StatusPrivacyOverride as allowlist
]


class MessageReaction(models.Model):
    """
    One user × one emoji on one message.

    Design choice (per the gemini plan): separate table, NOT a JSONField.
    Trade-offs:
      * Schema-level unique_together ⇒ a user's emoji toggles are
        idempotent at the DB layer (no duplicate reaction noise).
      * Real-time broadcast is a clean delta ({action: 'add'|'remove',
        message_id, emoji, user_id}) — the FE rebuilds the chip locally.
      * Migrations stay flat (one new table) so SQLite + Postgres behave
        identically.
      * The bubble's ``reactions_summary`` is computed at serialization
        time, NOT stored on ``Message`` — so we don't have to remember
        to bump a counter whenever we add a new field elsewhere.

    ``emoji`` is max_length=32 to comfortably hold any multi-codepoint
    emoji (e.g. ``'👨‍👩‍👧‍👦'`` can render to 11 codepoints / 25 UTF-16
    units; >32 visually-equivalent shortcodes is the practical upper
    bound for a community app).
    """
    message = models.ForeignKey(
        'Message', on_delete=models.CASCADE, related_name='reactions',
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='message_reactions',
    )
    # 32 chars comfortably holds ZWJ-joined family/profession emojis
    # like '👨‍👩‍👧‍👦' (11 codepoints, 25 UTF-8 bytes) plus a couple of
    # combinator modifiers. Anything longer than that should be sent as
    # a shortcode, not a raw glyph.
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    # NOTE: Meta declares the UniqueConstraint + Index so Django's state
    # tracking matches what migration 0013 applied at the DB level.
    # Without these in Meta, ``makemigrations --check`` would generate
    # a spurious "remove unique_usr_msg_emoji" migration (the model
    # state from the migration already has them, but the model file did
    # not — so a follow-up diff appears). Keep these names exactly in
    # sync with migration 0013.
    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=('message', 'user', 'emoji'),
                name='unique_usr_msg_emoji',
            ),
        ]
        indexes = [
            models.Index(fields=['message', '-created_at'], name='react_msg_created_idx'),
        ]

    def __str__(self):
        return f"Reaction {self.emoji} on msg {self.message_id} by {self.user_id}"


class ChatThread(models.Model):
    participants = models.ManyToManyField(User, related_name='chat_threads')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ───────────────────────── Phase 9 ──────────────────────────
    # ``is_group`` flips a thread from a 1-on-1 conversation into a
    # group chat. ``name`` is the human-readable title; for 1-on-1
    # threads it stays blank and the FE computes the title from the
    # other participant's display name.
    #
    # Per-user preferences (``is_pinned``/``is_archived``/``muted_until``)
    # live in the ``UserThreadSetting`` model below — NOT here —
    # because they MUST NOT bleed across users (User A archiving a
    # thread must not hide it from User B).
    is_group = models.BooleanField(default=False, db_index=True)
    name = models.CharField(max_length=100, blank=True, default='')

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        if self.is_group and self.name:
            return f"Group {self.id} ({self.name})"
        return f"Thread {self.id}"


class UserThreadSetting(models.Model):
    """
    Per-user thread preferences.

    Created lazily on FIRST access by the chat serializers (so we don't
    need to backfill millions of rows on migration). One row per
    (user, thread) — primary key is the composite plus an auto id.

    Why a separate model rather than ChatThread columns:
      • Pinning must NOT be visible to the other participants. If user A
        pins a 1-on-1 chat, user B should not see A's pin in their
        thread list.
      • Archive is symmetric to that — "Hide for me, not for them."
      • Mute-until is a per-user heartbeat timer; declaring it on
        ``ChatThread`` would force a row update every time ANY user
        unmuted, and SCHEMA-level uniqueness can't enforce per-user.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='thread_settings')
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name='settings')
    is_pinned = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    muted_until = models.DateTimeField(null=True, blank=True)
    is_request_ignored = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=('user', 'thread'), name='unique_user_thread_setting'),
        ]
        indexes = [
            models.Index(fields=['user', 'is_pinned'], name='usrthread_pin_idx'),
            models.Index(fields=['user', 'is_archived'], name='usrthread_arch_idx'),
        ]

    def __str__(self):
        return f"Setting(user={self.user_id}, thread={self.thread_id})"


# Phase 9 — server-side call history. NOTE: ``CallLog`` already lives in
# ``api/models/part4.py`` (with `kind`/`duration`/`status` enums). We REUSE
# it instead of duplicating. The ``CallLogViewSet`` adds a thin HTTP
# wrapper that floors the legacy field shape for the FE, and the WS
# consumer (``consumers.py``) writes the same schema.
# This file intentionally does NOT define CallLog anymore.

class Message(models.Model):
    thread = models.ForeignKey(ChatThread, related_name='messages', on_delete=models.CASCADE)
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField(blank=True, default='')
    audio = models.TextField(blank=True, default='')          # base64 voice notes
    image = models.TextField(blank=True, default='')           # base64 image attachments
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    is_read = models.BooleanField(default=False)
    is_delivered = models.BooleanField(default=False)
    is_edited = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Step 4 (chat module additions): forwarded provenance.
    # ``forwarded_from`` is a nullable FK to the original message so we
    # can keep the audit link, and ``on_delete=SET_NULL`` means deleting
    # the original does NOT cascade-delete the forward (we want the
    # forwarded copy to survive and just lose its badge data when the
    # parent is gone — see also ``forward_sender_name`` which keeps the
    # human-readable "Forwarded from @bob" string stable even after the
    # parent row is removed).
    forwarded_from = models.ForeignKey(
        'self',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='forwards',
    )
    forward_sender_name = models.CharField(max_length=150, blank=True, default='')

    # Part 5 (disappearing messages): ``expires_at`` is NULL for normal
    # messages and set for ephemeral ones. The management command
    # ``cleanup_expired`` sweeps rows whose ``expires_at`` is in the
    # past on a periodic cron. The composite index on
    # (expires_at, created_at) keeps that sweep an O(matches) scan
    # rather than a full table scan even on million-row message
    # tables. ``is_ephemeral`` is a denormalized boolean so the chat
    # consumer can hide the "Sent" tick + add a "disappearing" pill
    # without a comparison against NULL.
    expires_at = models.DateTimeField(null=True, blank=True)
    is_ephemeral = models.BooleanField(
        default=False,
        help_text='True for messages with an expires_at deadline. Lets the '
                  'FE show a "disappearing" badge without a NULL check.',
    )

    # ───────────────────────── Phase 9 ──────────────────────────
    # Delete-for-everyone (soft delete). We NEVER hard-delete a
    # chat message so the audit trail + delivered/read receipts stay
    # queryable. The consumer computes ``is_visible = deleted_at IS NULL``.
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='deleted_messages',
    )

    # Document attachment (PDF / DOCX / XLSX / TXT). Either a public
    # URL (after Supabase Storage upload) or base64 fallback (dev).
    # ``document_name`` is what the FE should display in the chip.
    document = models.TextField(blank=True, default='')
    document_name = models.CharField(max_length=255, blank=True, default='')
    # Photo composer shares the ``image`` field already; multi-image
    # payloads are split into multiple Message rows.
    #
    # Location attachment: client posts (lat, lng, name). Stored as
    # Decimal for sub-meter precision; indexed together so a future
    # "by geofence" lookup stays efficient.
    location_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_name = models.CharField(max_length=255, blank=True, default='')

    # ───────────────────────── Phase 10 ──────────────────────────
    # Story reply. When a user replies to a Status ("story") via the
    # viewer footer, the reply becomes a regular ``Message`` row in the
    # 1-on-1 chat thread between status-owner and replier, with this FK
    # pointing back at the originating ``UserStory`` so the chat bubble
    # can render the "Replying to @bob's status · Xh ago" header.
    #
    # ``on_delete=SET_NULL`` is deliberate: when the story expires + the
    # janitor hard-deletes it, the chat reply MUST survive so the chat
    # history stays intact — the bubble header just loses its status
    # snippet/badge (the serializer checks ``reply_to_story is None``
    # and falls back to a generic reply chip).
    #
    # ``related_name='chat_replies'`` so the story can later introspect
    # its replies via ``story.chat_replies.all()`` (used by the owner's
    # "viewers + reactions" panel to surface replies inline).
    reply_to_story = models.ForeignKey(
        'UserStory',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='chat_replies',
    )

    class Meta:
        ordering = ['created_at']
        indexes = [
            # Janitor's hot scan: WHERE expires_at < now() AND is_ephemeral
            # ORDER BY expires_at. Composite index on (is_ephemeral,
            # expires_at) makes this a single B-tree walk; the
            # ``created_at`` index is kept for the default ordering.
            models.Index(
                fields=['is_ephemeral', 'expires_at'],
                name='msg_ephemeral_idx',
            ),
            # Soft-delete sweep: WHERE deleted_at IS NULL AND thread_id = X
            models.Index(
                fields=['thread', 'deleted_at'],
                name='msg_thread_visible_idx',
            ),
            # Story-reply sweep: WHERE reply_to_story_id = X (used by the
            # owner's viewers panel to inline-replies-thread with status).
            # Composite keeps the ORDER BY created_at a free B-tree walk.
            models.Index(
                fields=['reply_to_story', '-created_at'],
                name='msg_reply_to_story_idx',
            ),
        ]

    def __str__(self):
        return f"Msg {self.id} by {self.sender.username}"

    @property
    def is_deleted(self):
        return self.deleted_at is not None

    @property
    def has_attachment(self):
        return bool(self.image or self.audio or self.document or self.location_lat is not None)


class UserStory(models.Model):
    """
    A WhatsApp/Instagram-class status post — 24h-TTL multi-media story
    attached to a User. Phase 10 extends the original Phase 0 model (text
    + image, single content field) with media-independent fields, privacy
    enum, and the per-viewer / per-reaction / per-override side tables
    defined further down.

    Why ``UserStory`` and not ``Status`` for the table name: the original
    migration 0006 used ``UserStory`` and codebase call-sites grew around
    that name (``story.*``, ``UserStory.objects``, ``StoryViewSet``).
    Renaming now would force a touchless, drift-prone mass rename. The
    FE-facing copy is "Status" / "Estati"; the DB-level table is the
    2014-era Instagram vocabulary of "Story". ADR-002 documents the
    decision.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='stories')
    # max_length widened from 10 → 16 (Phase 10) so future near-term
    # content kinds ('document', 'carousel', 'slideshow', 'voice_clip', …)
    # fit without a follow-up migration. SQLite + Postgres CHAR(n) cost
    # is negligible at these widths.
    type = models.CharField(max_length=16, default='text')           # 'text'|'image'|'video'|'audio'|'gif'|'emoji'|'location'|'music'|'link'|...
    content = models.TextField()                                       # URL or text or base64 fallback
    background = models.CharField(max_length=100, blank=True, default='')  # gradient/colour for text-only posts
    created_at = models.DateTimeField(auto_now_add=True)

    # ───────────────────────── Phase 10 ──────────────────────────
    # Caption overlay. Media posts (photo / video / voice / gif)
    # display an optional caption as a bottom-of-bubble overlay.
    # ``blank=True`` keeps existing rows zero-length.
    caption = models.TextField(blank=True, default='')

    # Free-form structured payload — localizations, music track refs,
    # link-preview metadata, sticker position, future Slide carousel
    # positions. JSONField is portable across SQLite (TEXT) and Postgres
    # (JSONB); ``default=dict`` is callable so Django generates a clean
    # ``ALTER TABLE ... DEFAULT '{}'`` on both backends.
    extra_data = models.JSONField(default=dict, blank=True)

    # Server-computed 24h expiry. Set at publish-time by ``StoryViewSet.create``
    # + the WS ``publish_story`` branch — both call ``now() + 24h`` and
    # store the absolute deadline so client clocks don't matter for the
    # janitor sweep. Indexed because the cleanup cron does
    # ``WHERE expires_at < now()`` continuously.
    #
    # Soft-filtering on ``created_at`` (the legacy path) is kept too —
    # both columns stay in lock-step so a row where ``expires_at`` drifts
    # from ``created_at + 24h`` (manual admin fix, etc.) still gets
    # swept correctly.
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # Privacy selector (see ``STATUS_PRIVACY_CHOICES`` above). Default
    # is 'public' to match the pre-Phase-10 behaviour where every
    # story broadcast into ``kot3_presence`` and any user could see it.
    # Privacy resolution runs server-side per request; FE caches the
    # resolved "viewer can see" boolean.
    privacy = models.CharField(
        max_length=20,
        choices=STATUS_PRIVACY_CHOICES,
        default='public',
    )

    class Meta:
        ordering = ['-created_at']
        constraints = [
            # Privacy override pairing: enforced at StatusPrivacyOverride
            # level (UNIQUE(story, viewer)) — UserStory itself does not
            # need a per-row uniqueness constraint.
        ]
        indexes = [
            # Primary access path: "list a user's active stories" feeds the
            # Home ring row, so we need a fast (user, -created_at) scan.
            # Naming: ``status_*`` prefix chosen for parity with the side
            # tables (statusmedia_/statusview_/statusreact_/statusprivoverride_)
            # so a developer querying the migration history doesn't bounce
            # between Instagram ``story_`` and the WhatsApp-style
            # ``status_`` vocabulary we committed to in ADR-002.
            models.Index(fields=['user', '-created_at'], name='status_user_created_idx'),
            # Cross-user feed: phase-10 endpoint /api/chat/stories/feed/
            # orders by recency across all users.
            models.Index(fields=['-created_at'], name='status_recent_idx'),
            # Janitor sweep hot path: WHERE expires_at < now().
            # expires_at already has db_index=True from the column-level
            # declaration; this composite is removed to avoid duplicates.
        ] 

    def __str__(self):
        return f"Story {self.id} by {self.user.username}"

    # ── computed properties the FE can rely on without a serializer pass ──
    @property
    def is_expired(self):
        return self.expires_at is not None and self.expires_at <= timezone.now()

    @property
    def needs_override_lookup(self):
        """
        Returns True when resolving this story's visibility requires a
        join against :class:`StatusPrivacyOverride`. The three
        override-based privacy modes ('everyone_except', 'only_share_with',
        'hidden') consult StatusPrivacyOverride as either a denylist
        ('everyone_except') or an allowlist ('only_share_with', 'hidden').

        The other two ('public', 'contacts_only') resolve through generic
        ACL machinery (no per-story override table needed) — 'public'
        via the global user-blocking list, 'contacts_only' via
        ChatThread ∪ CallLog intersection. FE/serializers should short-
        circuit ``StatusPrivacyOverride.objects.filter(story=self)`` with
        this property.
        """
        return self.privacy in ('everyone_except', 'only_share_with', 'hidden')


class StatusMedia(models.Model):
    """
    Per-Status media attachment. V1 still writes single media via the
    legacy ``UserStory.content`` field so we don't break Migration 0006
    rows; the V1 serializer reads BOTH ``content`` and any rows here so
    a Front-end that posts via the REST endpoint with an explicit
    ``media_entries`` payload gets persisted here while legacy callers
    keep working.

    V2 (carousel/slide) extends this naturally: positions < N are
    auto-advanced by the same Viewer UI without schema changes.
    """
    story = models.ForeignKey(UserStory, on_delete=models.CASCADE, related_name='media')
    position = models.PositiveSmallIntegerField(default=0)
    # 'image' | 'video' | 'audio' | 'gif' | 'document' | 'music' | ... —
    # the FE-side list mirrors the V0 ``UserStory.type`` enum but
    # explicitly excludes 'text' (a text post has no media row).
    # max_length 16 mirrors UserStory.type — kept in lock-step so future
    # type-string additions touch both fields at once.
    media_type = models.CharField(max_length=16)
    url = models.TextField()
    # Public thumbnail for instant pre-paint (LQIP). For videos we
    # extract the first frame server-side (Phase 11 worker); for images
    # a 320×320 downscale; for audio a waveform PNG.
    thumbnail_url = models.TextField(blank=True, default='')
    # Dwell override. NULL falls back to the Viewer UI's per-type
    # default (5s photo, video=play-through, etc.). Crowdsourced via
    # the analytics rollup worker.
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    width = models.PositiveSmallIntegerField(null=True, blank=True)
    height = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # Slideshow ordering invariant: at most one row per (story, position).
            models.UniqueConstraint(fields=['story', 'position'], name='uniq_story_media_position'),
        ]
        indexes = [
            models.Index(fields=['story', 'position'], name='statusmedia_story_pos_idx'),
        ]
        ordering = ['position', 'id']

    def __str__(self):
        return f"Media {self.id} story={self.story_id} pos={self.position} type={self.media_type}"


class StatusView(models.Model):
    """
    One row per (story, viewer). UniqueConstraint enforces
    at-the-DB-level idempotency, so the FE's "view recorded"-handshake
    is a cheap ``INSERT … ON CONFLICT DO NOTHING`` even if the WS + REST
    paths race a re-fire.
    """
    story = models.ForeignKey(UserStory, on_delete=models.CASCADE, related_name='views')
    viewer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='status_views')
    # Partition-suitable sort key. Composite index (story, -viewed_at)
    # serves the owner's viewers list endpoint cold-warm.
    viewed_at = models.DateTimeField(auto_now_add=True)
    # Device fingerprint surfaced in the owner UI ("seen on iPhone 16
    # vs Pixel 8"). PII-light; only the user-agent family, never the
    # raw UA. NULL when the WS handshake couldn't resolve the user
    # agent (older clients).
    device_kind = models.CharField(max_length=32, blank=True, default='')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['story', 'viewer'], name='uniq_status_view_story_viewer'),
        ]
        indexes = [
            models.Index(fields=['story', '-viewed_at'], name='statusview_story_viewed_idx'),
        ]
        ordering = ['-viewed_at']

    def __str__(self):
        return f"View story={self.story_id} viewer={self.viewer_id}"


class StatusReaction(models.Model):
    """
    Mirror of ``MessageReaction`` but pointed at a UserStory. Same
    constraint shape, same emoji length cap, same dedupe semantics.
    """
    story = models.ForeignKey(UserStory, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='status_reactions')
    # 32 chars to hold ZWJ-joined family/profession emojis. The
    # Viewer UI presents 7 quick-emojis; longer values fall back to
    # a custom-emoji modal (V2).
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=('story', 'user', 'emoji'),
                name='uniq_status_react_story_user_emoji',
            ),
        ]
        indexes = [
            models.Index(fields=['story', '-created_at'], name='statusreact_story_created_idx'),
        ]

    def __str__(self):
        return f"Reaction {self.emoji} on story={self.story_id} by user={self.user_id}"


class StatusPrivacyOverride(models.Model):
    """
    Per-viewer privacy allow/deny entry. Populated ONLY when
    ``UserStory.privacy`` is one of:

      * ``everyone_except`` — the rows here are DENYLIST (do not show).
      * ``only_share_with`` — the rows here are ALLOWLIST (only show).
      * ``hidden``          — the rows here are ALLOWLIST (only show).

    For ``public`` / ``contacts_only`` this table is irrelevant and
    NEVER consulted (cheap early-return in the serializer).
    """
    story = models.ForeignKey(UserStory, on_delete=models.CASCADE, related_name='privacy_overrides')
    viewer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='status_privacy_overrides')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Stable foreign-key-cascade-friendly ordering, mirroring the
        # other Status side tables (StatusView, StatusReaction).
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(
                fields=('story', 'viewer'),
                name='uniq_status_priv_override_story_viewer',
            ),
        ]
        indexes = [
            models.Index(fields=['story'], name='statusprivoverride_story_idx'),
            models.Index(fields=['viewer'], name='statusprivoverride_viewer_idx'),
        ]

    def __str__(self):
        return f"Override story={self.story_id} viewer={self.viewer_id}"
