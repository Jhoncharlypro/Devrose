"""
Part 4 backend panels — models.

Five new tables that back the premium panels built in Parts 1-3:

  * AuditLog          - sensitive-action ledger (block / mute / login / delete).
  * CallLog           - per-call history row (CallHistoryPanel).
  * ChatGroup         - 3+ person chat "group" (GroupMemberList endpoint).
  * ChatGroupMember   - (group, user, role) M2M through-table.
  * PinnedMessage     - one row per thread pin (PinnedMessagesBanner).

Naming choices:
  * ``ChatGroup`` (NOT ``Group``) to avoid shadowing
    ``django.contrib.auth.models.Group`` — Django's app registry would
    happily accept ``Group`` but every class method on the admin side
    (``request.user.groups.all()``, ``user.has_perm(...)``, permission
    classes for the admin) walks ``auth.models.Group`` by class name,
    so reusing the name silently breaks the permission machinery.
  * ``ChatGroupMember`` mirrors the existing ``BlockedUser`` /
    ``MutedUser`` naming convention (subject + qualifier) so future
    maintenance scans for ``User``-suffixed tables find this in the
    same alphabetical cluster.
  * ``CallLog`` (NOT ``CallHistory``) because the table is the
    authoritative call ledger; the ViewSet that wraps it is named
    ``CallHistoryViewSet`` for the FE face.

Indexes:
  Every table gets an index on the timestamp column so admin-range
  and "last 200" queries hit one B-tree scan. Composite indexes on
  the (group, role) and (thread, pinned_at) combinations let the
  pinned/banner SQLs skip table-sorts.
"""

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


# ====================================================================
# 1. AUDIT LOG
# ====================================================================
#
# Spec sentence (Part 4 §SECURITY): "Audit all sensitive actions."
# Row shape: actor / action / target / metadata / IP / UA / timestamp.
#
# The spec asks for SECURITY_EVENT logging. We store IP + User-Agent
# so a security analyst can correlate unusual bursts (e.g. a single
# IP triggering 20 delete-account requests in 10s is a smoking gun).
# We DO NOT store the raw JWT or password bytes here — those are
# handled by Django's password reset / SimpleJWT blacklist path.
#
class AuditLog(models.Model):
    """
    One row per sensitive server-side action.

    Fields:
      actor          - FK User who performed the action (nullable so
                       anonymous / system actions can be logged).
      action         - 'login' | 'logout' | 'block' | 'unblock' |
                       'mute' | 'unmute' | 'pin' | 'unpin' |
                       'delete_account' | 'password_change' |
                       'pin_message' | 'unpin_message' |
                       'archive_thread' | 'unarchive_thread'.
      target_type    - 'user' | 'thread' | 'message' | 'group'.
      target_id      - BigIntegerField (forward-compat with shards
                       splitting across Postgres instances).
      metadata       - JSONField for extra context (previous role,
                       reason, mute-until, etc.). Stays small.
      ip_address     - GenericIPAddressField (nullable for tests).
      user_agent     - Short-truncated UA. CharField(255) caps abuse.
      created_at     - auto_now_add = server-side timestamp.

    Why nullable FK rather than settings.AUTH_USER_MODEL? Django's
    contrib.auth.User is the only user model here; using the literal
    avoids the import-name cycle that goes through apps.ready and
    shaves a string lookup at migration time.
    """
    actor = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='audit_logs',
    )
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=32, blank=True, default='')
    target_id = models.BigIntegerField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['action', '-created_at'], name='audit_action_time_idx'),
            models.Index(fields=['actor', '-created_at'], name='audit_actor_time_idx'),
            models.Index(
                fields=['target_type', 'target_id'],
                name='audit_target_idx',
            ),
        ]

    def __str__(self):
        who = self.actor.username if self.actor_id else 'system'
        return f"Audit {self.action} by {who} @ {self.created_at.isoformat()}"


# ====================================================================
# 2. CALL LOG
# ====================================================================
#
# Spec sentence (Part 4 §VOICE & VIDEO CALL SIGNALING): "Store call
# events for Call History." / "Call Again / Delete" affordances.
#
# The Channels consumer already broadcasts call setup/connected/hangup
# events; this table is the AUTHORITATIVE record of "did the call
# actually happen, for how long, and how did it end". A VOIP bug
# where the WS broadcast fired but the media session crashed would
# otherwise leave no trace.
#
# We persist a row at THREE moments via the consumer:
#   1. ``call_user`` arrives  → status='outgoing' or 'incoming', duration=0.
#   2. ``call_accepted`` arrives → status flips to 'completed' (when started).
#   3. ``call_declined`` arrives OR a hangup frame arrives after start
#      → status flips to 'rejected'/'missed'/'completed' with duration.
#
# FE panel reads: 'incoming' | 'outgoing' | 'missed' | 'rejected'
# (CallHistoryPanel.jsx enum). We also persist 'completed' for the
# analytics view that powers the spec sheet's Call Again button.
#
class CallLog(models.Model):
    KIND_CHOICES = [
        ('audio', 'audio'),
        ('video', 'video'),
    ]
    STATUS_CHOICES = [
        ('incoming', 'incoming'),
        ('outgoing', 'outgoing'),
        ('missed', 'missed'),
        ('rejected', 'rejected'),
        ('completed', 'completed'),
        ('failed', 'failed'),
    ]

    caller = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='calls_initiated',
    )
    callee = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='calls_received',
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default='audio')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='outgoing')
    duration = models.PositiveIntegerField(
        default=0,
        help_text='Call duration in seconds. 0 = never connected.',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']
        indexes = [
            models.Index(
                fields=['caller', '-started_at'],
                name='call_caller_time_idx',
            ),
            models.Index(
                fields=['callee', '-started_at'],
                name='call_callee_time_idx',
            ),
            models.Index(
                fields=['status', '-started_at'],
                name='call_status_time_idx',
            ),
        ]

    def __str__(self):
        return f"Call {self.caller_id}→{self.callee_id} {self.kind} {self.status} {self.duration}s"


# ====================================================================
# 3. CHAT GROUP + MEMBERSHIP
# ====================================================================
#
# Spec sentence (Part 4 §GROUP CHAT): drop-in model for a Group with
# Owner/Admin/Moderator/Member roles. Frontend GroupMemberList.jsx
# already exists and expects members: [{...role,joined_at,is_online}].
#
# Why a NEW ChatGroup table (don't reuse ChatThread with kind='group'):
#   * ChatThread's participants M2M is shape-uniform (every participant
#     is equal — no role), so adding a role column would either (a)
#     require a nullable role on ChatThread + an extra M2M table or
#     (b) a parallel ChatGroup. Option (b) is cleaner: LiveRoom already
#     defines a similar shape for live classrooms, and ChatGroup fills
#     the same niche for messaging-only groups.
#   * ChatGroup has dedicated fields the spec demands that ChatThread
#     lacks: avatar (TextField), description (TextField), is_public
#     (BooleanField), created_by (FK). The first three would require
#     updates to ChatThread's serializer if we reused it; cleaner to
#     introduce a focused model.
#
# ChatGroupMember is the per-(group, user) joined_at + role row.
# Unique-together (group, user) keeps the M2M deduped.
#
ROLE_CHOICES = [
    ('owner', 'Owner'),
    ('admin', 'Admin'),
    ('mod', 'Moderator'),
    ('member', 'Member'),
]

class ChatGroup(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default='')
    avatar = models.TextField(
        null=True, blank=True,
        help_text='Base64 data URL. Same encoding as Profile.avatar.',
    )
    is_public = models.BooleanField(
        default=False,
        help_text='Public groups are joinable via invite link without admin approval.',
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='groups_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['-updated_at'], name='group_updated_idx'),
            models.Index(fields=['is_public'], name='group_public_idx'),
        ]

    def __str__(self):
        return f"ChatGroup {self.id} '{self.name}'"


class ChatGroupMember(models.Model):
    group = models.ForeignKey(
        ChatGroup, on_delete=models.CASCADE, related_name='memberships',
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='chat_group_memberships',
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='member')
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Idempotent join: a second join request for the same (group,user)
        # is rejected at the schema level rather than silently creating a
        # duplicate membership row.
        unique_together = ('group', 'user')
        ordering = ['joined_at']
        indexes = [
            models.Index(
                fields=['group', 'role', 'joined_at'],
                name='groupmember_role_idx',
            ),
            models.Index(
                fields=['user', 'group'],
                name='groupmember_user_idx',
            ),
        ]

    def __str__(self):
        return f"ChatGroupMember {self.user_id} in {self.group_id} as {self.role}"


# ====================================================================
# 4. PINNED MESSAGE
# ====================================================================
#
# Spec sentence (Part 4 §PIN MESSAGE): "Pinned messages appear at the
# top of the conversation. Tapping the pinned banner scrolls to
# the original message." PinnedMessagesBanner.jsx reads from this.
#
# One row per (thread, message) pin. Toggling PIN/UNPIN is a
# delete-or-create on this row (the spec wants instant ripple across
# all peers); the FE PinnedMessagesBanner handles navigation.
#
# We do NOT cascade-delete PinnedMessage rows when the underlying
# Message is deleted (e.g. a "Delete for Everyone" later). ON DELETE
# SET_NULL would leave a dangling pointer; we use on_delete=DO_NOTHING
# and let a periodic janitor sweep reconcile. Keeping the FK with a
# cascading lifecycle would orphan the pinned banner mid-session.
#
class PinnedMessage(models.Model):
    thread = models.ForeignKey(
        'api.ChatThread', on_delete=models.CASCADE,
        related_name='pinned_messages',
    )
    message = models.ForeignKey(
        'api.Message',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='pin_rows',
        help_text='Nullable so a later "Delete for Everyone" on the original '
                  'message does NOT cascade-fail with an IntegrityError. The '
                  'pinned banner survives with a null FK; the FE detects the '
                  'null and renders a "message removed" placeholder.',
    )
    pinned_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pinned_actions',
    )
    pinned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # A message can only be pinned once per thread. (Same message
        # pinned in two threads = two rows, which is correct.)
        unique_together = ('thread', 'message')
        ordering = ['-pinned_at']
        indexes = [
            models.Index(
                fields=['thread', '-pinned_at'],
                name='pin_thread_time_idx',
            ),
        ]

    def __str__(self):
        return f"Pinned msg {self.message_id} in thread {self.thread_id}"
