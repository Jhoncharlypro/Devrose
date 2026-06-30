"""
Part 6 — Enterprise Admin / Moderation / Security surface.

Six new models that back the spec's admin dashboard, user
management, content moderation, report system, security center,
notification broadcasting, and audit log enhancements. See
``backend/api/views/part6.py`` for the corresponding ViewSets.

Architecture choices (locked in by the Part 6 thinker):
  * AdminRole  - separate table (not Profile flag) so we can
                 support multi-role assignments + a JSON
                 permissions dict for enterprise orgs.
  * UserSession - per-device row created on every login. ``jti``
                 is the JWT identifier so ``JwtOnlyAuthentication``
                 can reject a token whose session has been
                 force-revoked. ``is_active=False`` is the
                 force-logout signal.
  * BannedIP    - middleware-level block list. The middleware
                 runs BEFORE auth so malicious IPs never consume
                 JWT-validation compute.
  * BannedUser  - formal ban (suspension / permanent). Distinct
                 from BlockedUser (bilateral block) and from
                 Profile.is_premium.  Banning a user ends their
                 active sessions in the same transaction.
  * AdminBroadcast - simple table paired with a Channels global
                 group so the FE receives new notices in real
                 time without a polling endpoint.
  * LoginAttempt - every login (success or failure) is recorded
                 for the Security Center. Success rows feed the
                 "Login history" admin card; failure rows feed
                 the "Failed login attempts" card.
  * Report      - broader than SpamReport: targets a user, group,
                 or call (not just a message). SpamReport stays
                 for backward compat; the FE moderation queue
                 renders both tables in one stream.
"""
from __future__ import annotations

import secrets

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


# ====================================================================
# 1. AdminRole
# ====================================================================
#
# Spec §PERMISSION SYSTEM: "Super Administrator, Administrator,
# Moderator, Support Agent, Content Moderator, Viewer. Each role
# has configurable permissions."
#
# We use a separate table (not a Profile flag) so a user can hold
# multiple roles AND we can track granted_by / granted_at for
# audit. The ``permissions`` JSONField stores an allow-list like
# {"can_ban_user": true, "can_view_audit": true, ...}; absence
# means default-deny. Helpers below (has_permission, ROLE_PERMS)
# provide the canonical permission set per role.
#
class AdminRole(models.Model):
    ROLE_CHOICES = [
        ('super_admin',     'Super Administrator'),
        ('admin',           'Administrator'),
        ('moderator',       'Moderator'),
        ('support',         'Support Agent'),
        ('content_mod',     'Content Moderator'),
        ('viewer',          'Viewer'),
    ]
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='admin_roles',
    )
    role = models.CharField(max_length=15, choices=ROLE_CHOICES)
    permissions = models.JSONField(
        default=dict, blank=True,
        help_text='Per-role override permissions. Empty = use the role default.',
    )
    granted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='admin_roles_granted',
    )
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        # A user can hold each role at most once. ``revoked_at``
        # lets a user be re-granted the same role later.
        unique_together = ('user', 'role')
        ordering = ['-granted_at']
        indexes = [
            models.Index(fields=['user', 'role'], name='adminrole_user_role_idx'),
        ]

    def is_active(self) -> bool:
        return self.revoked_at is None

    def __str__(self):
        state = 'revoked' if self.revoked_at else 'active'
        return f"AdminRole {self.role} for {self.user_id} ({state})"


# Default permission sets per role. The ViewSet layer merges these
# with any per-role override in ``AdminRole.permissions`` (an
# override KEY is True ⇒ grant, KEY missing or False ⇒ fall through
# to the role default).
ROLE_PERMISSIONS = {
    'super_admin': {
        'can_ban_user', 'can_suspend_user', 'can_restore_user',
        'can_force_logout', 'can_view_audit', 'can_resolve_reports',
        'can_remove_message', 'can_delete_conversation', 'can_ban_ip',
        'can_broadcast', 'can_grant_admin_role', 'can_manage_billing',
    },
    'admin': {
        'can_ban_user', 'can_suspend_user', 'can_restore_user',
        'can_force_logout', 'can_view_audit', 'can_resolve_reports',
        'can_remove_message', 'can_ban_ip', 'can_broadcast',
    },
    'moderator': {
        'can_suspend_user', 'can_view_audit', 'can_resolve_reports',
        'can_remove_message',
    },
    'content_mod': {
        'can_resolve_reports', 'can_remove_message',
    },
    'support': {
        'can_view_audit',
    },
    'viewer': set(),
}


def user_has_permission(user, permission: str) -> bool:
    """
    Return True if any active AdminRole grants ``permission``.
    Super admin implicitly grants every permission.
    """
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    roles = AdminRole.objects.filter(user=user, revoked_at__isnull=True)
    for role in roles:
        if role.role == 'super_admin':
            return True
        defaults = ROLE_PERMISSIONS.get(role.role, set())
        if permission in defaults:
            return True
        if role.permissions.get(permission) is True:
            return True
    return False


# ====================================================================
# 2. UserSession
# ====================================================================
#
# Spec §USER MANAGEMENT: "View connected devices. Allow removing
# devices remotely."
#
# One row per (user, jti) created on every successful login. The
# ``is_active`` flag is the force-logout signal — flipping it to
# False is what the Security Center / User Management endpoints
# do. ``last_seen`` is bumped on every authenticated request so
# the "View connected devices" UI can show last activity per
# device.
#
class UserSession(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='sessions',
    )
    jti = models.CharField(
        max_length=64,
        help_text='JWT identifier (claim "jti"). Unique per token.',
    )
    # Best-effort device fingerprint. Parsed from the User-Agent
    # at login time; the FE can do better client-side but this
    # gives the admin a one-line summary per device.
    device_label = models.CharField(max_length=120, blank=True, default='')
    device_kind = models.CharField(
        max_length=20, blank=True, default='',
        help_text='"mobile" | "tablet" | "desktop" | "bot" | ""',
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True, default='')
    is_active = models.BooleanField(default=True)
    last_seen = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=120, blank=True, default='')

    class Meta:
        # A single jti must be unique; the second login with the
        # same jti is a token-replay attempt.
        unique_together = ('jti',)
        ordering = ['-last_seen']
        indexes = [
            models.Index(fields=['user', 'is_active', '-last_seen'], name='usersess_active_idx'),
            models.Index(fields=['jti'], name='usersess_jti_idx'),
        ]

    def revoke(self, reason: str = ''):
        self.is_active = False
        self.revoked_at = timezone.now()
        self.revoked_reason = (reason or '')[:120]
        self.save(update_fields=['is_active', 'revoked_at', 'revoked_reason'])

    def __str__(self):
        return f"UserSession {self.jti[:8]} for user {self.user_id}"


# ====================================================================
# 3. BannedIP
# ====================================================================
class BannedIP(models.Model):
    """
    Middleware-level block list. The IPBlockMiddleware reads from
    this table on every request; an active row short-circuits to
    403 BEFORE auth.
    """
    ip_address = models.GenericIPAddressField()
    reason = models.CharField(max_length=255, blank=True, default='')
    banned_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='ips_banned',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ('ip_address',)
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', '-created_at'], name='bannedip_active_idx'),
        ]

    def is_currently_banned(self) -> bool:
        if not self.is_active:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        return True

    def __str__(self):
        return f"Ban {self.ip_address} ({'active' if self.is_currently_banned() else 'expired'})"


# ====================================================================
# 4. BannedUser
# ====================================================================
class BannedUser(models.Model):
    """
    Formal ban: suspension (banned_until set) or permanent (NULL).
    Distinct from BlockedUser (which is a bilateral block) and
    from Profile.is_premium (which is a feature flag).
    Banning a user sets ALL their active UserSession.is_active=False
    in the same transaction so the next request is rejected.
    """
    BAN_REASON_CHOICES = [
        ('spam', 'Spam'),
        ('abuse', 'Abusive language'),
        ('impersonation', 'Impersonation'),
        ('illegal', 'Illegal content'),
        ('harassment', 'Harassment'),
        ('csam', 'Child safety'),
        ('other', 'Other'),
    ]
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='bans',
    )
    reason = models.CharField(max_length=15, choices=BAN_REASON_CHOICES)
    details = models.TextField(blank=True, default='')
    banned_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='bans_issued',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # NULL = permanent ban; otherwise the ban auto-lifts at this time.
    banned_until = models.DateTimeField(null=True, blank=True)
    lifted_at = models.DateTimeField(null=True, blank=True)
    lifted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='bans_lifted',
    )
    lift_reason = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'], name='ban_user_time_idx'),
            models.Index(fields=['banned_until'], name='ban_until_idx'),
        ]

    def is_currently_banned(self) -> bool:
        if self.lifted_at:
            return False
        if self.banned_until and self.banned_until <= timezone.now():
            return False
        return True

    def __str__(self):
        kind = 'permanent' if not self.banned_until else f'until {self.banned_until}'
        return f"Ban {self.user_id} ({self.reason}, {kind})"


# ====================================================================
# 5. AdminBroadcast
# ====================================================================
class AdminBroadcast(models.Model):
    """
    Maintenance / emergency / feature announcements. The
    AdminBroadcastViewSet publishes a Channels message on
    the global 'system_broadcast' group so any connected
    chat session receives it in real time.
    """
    SEVERITY_CHOICES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]
    AUDIENCE_CHOICES = [
        ('all', 'All users'),
        ('staff', 'Staff / admin only'),
        ('premium', 'Premium users only'),
    ]
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default='info')
    message = models.TextField()
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    audience = models.CharField(max_length=10, choices=AUDIENCE_CHOICES, default='all')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='broadcasts_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', '-created_at'], name='broadcast_active_idx'),
        ]

    def is_currently_active(self) -> bool:
        if not self.is_active:
            return False
        now = timezone.now()
        if self.starts_at > now:
            return False
        if self.ends_at and self.ends_at <= now:
            return False
        return True

    def __str__(self):
        return f"Broadcast {self.severity} '{self.message[:40]}'"


# ====================================================================
# 6. LoginAttempt
# ====================================================================
class LoginAttempt(models.Model):
    """
    Every login (success OR failure) is recorded so the
    Security Center can show login history, failed-login
    rates, and IP abuse patterns. Username is stored (not
    just user FK) so failed attempts on non-existent users
    also count toward the brute-force detection.
    """
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='login_attempts',
    )
    username = models.CharField(max_length=150)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True, default='')
    success = models.BooleanField(default=False)
    failure_reason = models.CharField(max_length=60, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'], name='login_user_time_idx'),
            models.Index(fields=['ip_address', '-created_at'], name='login_ip_time_idx'),
            models.Index(fields=['success', '-created_at'], name='login_success_idx'),
        ]

    def __str__(self):
        return f"Login {'OK' if self.success else 'FAIL'} {self.username} from {self.ip_address or '?'}"


# ====================================================================
# 7. Report (broader than SpamReport)
# ====================================================================
class Report(models.Model):
    """
    The spec's report system: users can report messages, profiles,
    groups, calls, images, videos, voice messages, with reasons
    spam / harassment / fake_profile / violence / scam / illegal /
    copyright / other. The existing SpamReport (Part 5) covers
    message-scoped spam reports; Report covers the rest.
    Both write to the same moderation queue UI.
    """
    TARGET_CHOICES = [
        ('message', 'Message'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('voice', 'Voice message'),
        ('profile', 'Profile'),
        ('group', 'Group'),
        ('call', 'Call'),
    ]
    REASON_CHOICES = [
        ('spam', 'Spam'),
        ('harassment', 'Harassment'),
        ('fake_profile', 'Fake profile'),
        ('violence', 'Violence'),
        ('scam', 'Scam'),
        ('illegal', 'Illegal content'),
        ('copyright', 'Copyright'),
        ('other', 'Other'),
    ]
    reporter = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='reports_filed',
    )
    reported_user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='reports_received',
    )
    # At least one of these targets must be set; the serializer
    # enforces it.
    target_type = models.CharField(max_length=10, choices=TARGET_CHOICES)
    target_id = models.BigIntegerField(
        help_text='ID of the target row. Generic to support all '
                  'target types in one column.',
    )
    reason = models.CharField(max_length=15, choices=REASON_CHOICES)
    description = models.TextField(blank=True, default='')
    resolved = models.BooleanField(default=False)
    resolved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='reports_resolved',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Same (reporter, target_type, target_id, reason) tuple
        # dedupes; the user can re-open a resolved report by
        # updating resolution_note instead of creating a new row.
        unique_together = ('reporter', 'target_type', 'target_id', 'reason')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['target_type', 'target_id'], name='report_target_idx'),
            models.Index(fields=['resolved', '-created_at'], name='report_status_idx'),
        ]

    def __str__(self):
        return f"Report by {self.reporter_id} → {self.target_type}#{self.target_id} ({self.reason})"
