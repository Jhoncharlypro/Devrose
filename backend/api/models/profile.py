"""
Profile + Block/Mute models.

The PROFILE module expansion (post auth-extension phase) added 5 fields
to Profile and 2 self-referencing through-models for User-to-User
moderation:

  Profile fields added (0012):
    cover_photo          — Base64 data URL for the wide banner above the avatar.
                            Same encoding as ``avatar`` so existing upload
                            pipeline (FileReader.readAsDataURL) works as-is.
    interests            — JSONField, default=[], free-text tags the user
                            shares publicly (e.g. ["python", "music", "taekwondo"]).
    social_links         — JSONField, default={}, keyed by platform
                            (instagram / whatsapp / website / twitter / linkedin / github).
                            Each value URL-validated server-side to reject
                            ``javascript:`` / ``data:`` schemed injects.
    notification_prefs   — JSONField, default={}, per-channel toggles
                            (sound / desktop_notif / email_notif / message_preview).
                            The serializer merges user-supplied values with
                            defaults on read so absent keys fall back gracefully.
    country              — short CharField, ISO-3166 shortname (FR/EN UI).

  New through-models:
    BlockedUser          — actor (hunter) → blocked (prey) with optional reason.
                            Self-referential. Unique on (actor, blocked) so
                            duplicating a block is idempotent.
    MutedUser            — actor → muted with optional ``mute_until`` (null = forever).
                            Self-referential. Unique on (actor, muted).
                            Expired mutes (mute_until < now) are best-effort
                            skipped by the consumer of the chat filter.

Why explicit related_names?
  ``blocks_created`` and ``blocked_by`` (and ``mutes_created`` /
  ``muted_by``) are distinct so we don't trip Django's "reverse query
  accessor would clash" validation. They're also descriptive enough to
  be queried directly (``user.blocks_created.all()`` and
  ``user.blocked_by.all()`` to enumerate blocks in either direction for
  the chat filter).
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


# ----------------------------------------------------------------------
# ISO-3166 shortname list. Exposed via GET /api/profile/countries/
# so the FE country dropdown can be populated without a hardcoded
# 250-entry array in JS bundles. Single source of truth.
# ----------------------------------------------------------------------
COUNTRIES = [
    ('HT', 'Haiti'),
    ('US', 'United States'),
    ('CA', 'Canada'),
    ('FR', 'France'),
    ('BR', 'Brazil'),
    ('DO', 'Dominican Republic'),
    ('CU', 'Cuba'),
    ('JM', 'Jamaica'),
    ('MX', 'Mexico'),
    ('CO', 'Colombia'),
    ('VE', 'Venezuela'),
    ('AR', 'Argentina'),
    ('CL', 'Chile'),
    ('PE', 'Peru'),
    ('EC', 'Ecuador'),
    ('BO', 'Bolivia'),
    ('PY', 'Paraguay'),
    ('UY', 'Uruguay'),
    ('GB', 'United Kingdom'),
    ('IE', 'Ireland'),
    ('DE', 'Germany'),
    ('NL', 'Netherlands'),
    ('BE', 'Belgium'),
    ('LU', 'Luxembourg'),
    ('CH', 'Switzerland'),
    ('ES', 'Spain'),
    ('PT', 'Portugal'),
    ('IT', 'Italy'),
    ('PL', 'Poland'),
    ('RU', 'Russia'),
    ('UA', 'Ukraine'),
    ('TR', 'Turkey'),
    ('CN', 'China'),
    ('JP', 'Japan'),
    ('KR', 'South Korea'),
    ('TW', 'Taiwan'),
    ('IN', 'India'),
    ('PK', 'Pakistan'),
    ('BD', 'Bangladesh'),
    ('NG', 'Nigeria'),
    ('ZA', 'South Africa'),
    ('KE', 'Kenya'),
    ('EG', 'Egypt'),
    ('MA', 'Morocco'),
    ('DZ', 'Algeria'),
    ('TN', 'Tunisia'),
    ('AU', 'Australia'),
    ('NZ', 'New Zealand'),
    ('SG', 'Singapore'),
    ('MY', 'Malaysia'),
    ('TH', 'Thailand'),
    ('PH', 'Philippines'),
    ('ID', 'Indonesia'),
    ('VN', 'Vietnam'),
    ('AE', 'United Arab Emirates'),
    ('SA', 'Saudi Arabia'),
    ('IL', 'Israel'),
]


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.TextField(null=True, blank=True)  # Stores Base64
    bio = models.TextField(max_length=500, blank=True)
    status_text = models.CharField(max_length=255, blank=True, default='')
    last_seen = models.DateTimeField(null=True, blank=True)

    # Email verification
    email_verified = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)

    # Privacy controls
    # 'public' | 'friends' | 'private' — who can see this user's profile fields
    profile_visibility = models.CharField(max_length=10, default='public')
    # 'everyone' | 'friends' | 'nobody' — who can see last_seen
    last_seen_visibility = models.CharField(max_length=10, default='everyone')

    # ---- Kot3 Profile privacy additions (0021) ----
    # Two per-field toggles that complement the coarse-grained visibility
    # enums above. ``show_contact_info`` controls whether email + phone
    # appear on the About tab of the user's Kot3 chat profile (the
    # ``ProfileViewSet.retrieve`` redaction enforces this even when the
    # coarse-grained profile_visibility is ``public``). ``allow_stranger_dms``
    # gates whether non-mutual users can DM the user (the chat consumer
    # honors it via a future ``get_block_or_mute_user_ids`` extension —
    # today it's exposed read/write so the UI toggle persists).
    #
    # Default for ``show_contact_info`` is ``True`` to preserve the
    # pre-0021 behavior (email was always shown unless the user set
    # profile_visibility to ``private``). Users opt OUT of contact
    # visibility by flipping the Kot3 Profile single-page privacy
    # console toggle to ``False``. The previous draft used ``False``
    # but that silently hid the email for every existing user on
    # rollout — not a backward-compatible default.
    show_contact_info = models.BooleanField(default=True)
    allow_stranger_dms = models.BooleanField(default=True)

    # ---- PROFILE module additions (0012) ----
    # Wide banner above the avatar. Data URL (base64) — same encoding as
    # ``avatar`` so FileReader.readAsDataURL + service.patch() works
    # without an additional upload pipeline.
    cover_photo = models.TextField(null=True, blank=True)
    # JSON list of strings (lowercased tags). Capped at 10 tags × 30 chars
    # each by the view layer.
    interests = models.JSONField(default=list, blank=True)
    # JSON dict keyed by platform name → URL. URL-validated on save.
    social_links = models.JSONField(default=dict, blank=True)
    # JSON dict of channel toggles. Serializer merges user value with
    # sane defaults on read.
    notification_prefs = models.JSONField(default=dict, blank=True)
    # ISO-3166 shortname from COUNTRIES. Empty string is allowed.
    country = models.CharField(max_length=60, blank=True, default='')

    # ---- Part 5 (premium subscription flags) ----
    # ``is_premium`` is a hot-path boolean; ``premium_until`` is the
    # expiry. The two together drive every "show the premium badge?"
    # decision in the FE without an extra JOIN. PremiumSubscription is
    # the HISTORY table — see models/part5.py. We flip both in a
    # single save() when activate/cancel fires (see views/part5.py).
    is_premium = models.BooleanField(default=False)
    premium_until = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile for {self.user.username}"


class BlockedUser(models.Model):
    """
    ``actor`` blocked ``blocked``. Direction matters: if Alice blocks
    Bob but Bob has NOT blocked Alice, the chat filter distinguishes
    who initiated the block.
    """
    actor = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocks_created')
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocked_by')
    created_at = models.DateTimeField(auto_now_add=True)
    reason = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        # Idempotent: a second POST /api/blocks/ for the same pair is
        # a no-op rather than a duplicate row.
        unique_together = ('actor', 'blocked')
        ordering = ['-created_at']

    def __str__(self):
        return f"Block {self.actor_id} → {self.blocked_id}"


class MutedUser(models.Model):
    """
    ``actor`` muted ``muted``. ``mute_until`` is nullable: if NULL
    the mute is permanent; if set the consumer should treat it as
    expired when ``mute_until < now()``.
    """
    actor = models.ForeignKey(User, on_delete=models.CASCADE, related_name='mutes_created')
    muted = models.ForeignKey(User, on_delete=models.CASCADE, related_name='muted_by')
    created_at = models.DateTimeField(auto_now_add=True)
    mute_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('actor', 'muted')
        ordering = ['-created_at']

    def __str__(self):
        return f"Mute {self.actor_id} → {self.muted_id}"


class ProfileActivityLog(models.Model):
    """
    Append-only audit log of profile-related events. Powers the
    Activity Timeline UI in ``src/components/kot3/Kot3Profile.jsx``.

    ``user`` is the user whose profile the event applies to (NOT
    necessarily the actor — a ``profile_view`` event is about the
    target user's profile, not the viewer's).

    ``action`` is a short stable string the FE maps to an icon + color.
    Known actions:
      - ``visibility_change``  : profile_visibility / last_seen_visibility toggled
      - ``contact_toggle``     : show_contact_info flipped
      - ``dms_toggle``         : allow_stranger_dms flipped
      - ``profile_view``       : someone fetched the public profile
      - ``profile_update``     : any other non-privacy field changed

    ``details`` is a free-form JSONField so we don't have to migrate
    the schema every time we add a new event type. The FE only reads
    a few well-known keys (old → new, viewer_username, etc.).
    """
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='profile_activity',
    )
    action = models.CharField(max_length=40)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # Hot read path: the user's last N events.
            models.Index(fields=['user', '-created_at'], name='profile_act_user_idx'),
            # Filtering by action type for analytics queries later.
            models.Index(fields=['action'], name='profile_act_action_idx'),
        ]

    def __str__(self):
        return f'{self.user_id} {self.action} @ {self.created_at:%Y-%m-%d %H:%M}'
