from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


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

    ``emoji`` is max_length=16 to comfortably hold any multi-codepoint
    emoji (e.g. ``'👨‍👩‍👧‍👦'`` can render to 11 codepoints / 25 UTF-16
    units; >16 visually-equivalent shortcodes is the practical upper
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

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"Thread {self.id}"

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
        ]

    def __str__(self):
        return f"Msg {self.id} by {self.sender.username}"

class UserStory(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='stories')
    type = models.CharField(max_length=10, default='text') # 'text' or 'image'
    content = models.TextField()
    background = models.CharField(max_length=100, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Story {self.id} by {self.user.username}"
