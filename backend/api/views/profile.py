"""
Profile, Block & Mute views.

ProfileViewSet
--------------
  * GET    /api/profile/           — list (effectively the current user)
  * GET    /api/profile/<int:pk>/  — another user's public profile (privacy-aware)
  * GET    /api/profile/me/        — current user's full serialized User
  * PUT    /api/profile/me/        — replace
  * PATCH  /api/profile/me/        — partial update
  * GET    /api/profile/countries/ — ISO-3166 catalog for the country dropdown

BlockViewSet / MuteViewSet
--------------------------
  * GET    /api/blocks/             — list users I have blocked
  * POST   /api/blocks/             — {user_id: int, reason?: str}
  * DELETE /api/blocks/<int:pk>/    — unblock
  * same shape for /api/mutes/ + optional mute_until

block_or_muted_id helper
------------------------
Export ``get_block_or_mute_user_ids(request.user)`` so the chat sub-app
can filter blocked/muted rows out without re-implementing the merge:
  - ids I have blocked
  - ids that have blocked me
  - muted users whose mute_until is null OR in the future
"""
import logging
from urllib.parse import urlparse

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from api.models import COUNTRIES, BlockedUser, MutedUser, Profile, ProfileActivityLog
from api.serializers.user import (
    BlockedUserSerializer,
    MutedUserSerializer,
    ProfileActivityLogSerializer,
    ProfileSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------
# Activity log helper
# ----------------------------------------------------------------------
def record_activity(user, action, details=None):
    """
    Append-only helper for ``ProfileActivityLog``. Called from the
    ``ProfileViewSet.me`` PATCH flow and the public-username route
    so every privacy change + profile view is captured.

    The function is intentionally fire-and-forget (no exception
    bubble-up) so a logging failure can never break a write that
    the user is waiting for. We log at WARNING level if the insert
    fails so operators still see the issue in Sentry/Datadog.
    """
    try:
        ProfileActivityLog.objects.create(
            user=user, action=action, details=details or {},
        )
    except Exception:
        logger.warning(
            'Failed to record profile activity for user_id=%s action=%s',
            getattr(user, 'id', None), action, exc_info=True,
        )


# Allowed schemed for social_links URLs. We reject javascript:, data:,
# vbscript: and the empty scheme so a malicious URL can't run script on
# the contact card.
_SOCIAL_ALLOWED_SCHEMES = {'http', 'https'}

# Profile-view activity throttle. The activity log is append-only and
# the FE renders the last 50 entries — without throttling, a single
# scraper polling the public route could fill a user's timeline in
# seconds, masking real events (privacy changes, etc.). One log per
# (viewer, target) pair every 60 s is plenty for analytics and keeps
# the timeline readable. The cache backend is whatever Django is
# configured with (LocMem in dev, Redis in prod); the ``cache`` calls
# are wrapped in try/except so a cache outage never breaks the read.
PROFILE_VIEW_THROTTLE_SECONDS = 60
PROFILE_VIEW_THROTTLE_KEY = 'profile_view_logged:{viewer}:{target}'


def _log_profile_view(user, viewer, via):
    """
    Throttled wrapper around ``record_activity`` for the
    ``profile_view`` action. One log per ``(viewer, target)`` pair
    per ``PROFILE_VIEW_THROTTLE_SECONDS`` window.
    """
    viewer_key = str(viewer.id) if viewer else 'anon'
    cache_key = PROFILE_VIEW_THROTTLE_KEY.format(viewer=viewer_key, target=user.id)
    try:
        already_logged = cache.get(cache_key)
    except Exception:
        # Cache outage — fall back to "log everything" rather than
        # silently swallowing. The DB is the durability backstop.
        already_logged = False
    if already_logged:
        return
    try:
        cache.set(cache_key, timezone.now().isoformat(), PROFILE_VIEW_THROTTLE_SECONDS)
    except Exception:
        # Best-effort: if the SET fails we still log this view and
        # the next call will go through the same code path.
        pass
    record_activity(user, 'profile_view', {
        'viewer_id': viewer.id if viewer else None,
        'viewer_username': viewer.username if viewer else 'anonymous',
        'via': via,
    })


def _validate_social_links(value):
    """
    Returns ``(clean_dict, errors)``. Each entry must be a valid URL with
    an http(s) scheme. Empty string entries are dropped silently so the
    FE can clear a previously-set link without a separate "remove" call.
    """
    clean = {}
    errors = {}
    if not value:
        return clean, errors
    for platform, url in value.items():
        if url in (None, ''):
            continue
        try:
            parsed = urlparse(str(url).strip())
        except Exception:
            errors[platform] = 'Invalid URL.'
            continue
        if parsed.scheme.lower() not in _SOCIAL_ALLOWED_SCHEMES:
            errors[platform] = 'Only http(s) URLs are allowed.'
            continue
        if not parsed.netloc:
            errors[platform] = 'Missing host.'
            continue
        clean[platform] = parsed.geturl()
    return clean, errors


def _sanitize_interests(value):
    """
    Lowercase, dedupe, cap to ``INTERESTS_MAX_TAGS`` tags ×
    ``INTERESTS_TAG_MAX_LEN`` chars each. Filters out anything that
    contains control characters.
    """
    from api.serializers.user import INTERESTS_ALLOWED, INTERESTS_MAX_TAGS, INTERESTS_TAG_MAX_LEN
    out = []
    seen = set()
    if not value:
        return out
    for raw in value:
        if not isinstance(raw, str):
            continue
        tag = raw.strip().lower()
        if not tag:
            continue
        # Strip disallowed chars (anything not in INTERESTS_ALLOWED).
        tag = ''.join(ch for ch in tag if ch in INTERESTS_ALLOWED).strip()
        if not tag:
            continue
        tag = tag[:INTERESTS_TAG_MAX_LEN]
        if tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
        if len(out) >= INTERESTS_MAX_TAGS:
            break
    return out


class ProfileViewSet(viewsets.ModelViewSet):
    """
    Profile CRUD + public profile retrieval.

    ``me`` action handles the authenticated user's read/write.
    The base ``retrieve`` is privacy-aware: redacts bio/status_text/
    cover_photo/social_links if the profile is private.
    """
    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        return Profile.objects.select_related('user').all()

    @action(detail=False, methods=['get', 'put', 'patch'])
    def me(self, request):
        if not request.user.is_authenticated:
            return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            profile, _ = Profile.objects.get_or_create(user_id=request.user.id)
            storage_results = {}

            if request.method == 'GET':
                # Intentionally bypasses the ``retrieve`` email-blanking
                # redaction. The user must ALWAYS see their own email
                # on the Kot3 Profile single-page preview regardless of
                # the ``show_contact_info`` toggle — that toggle only
                # affects how OTHER users see this user's profile. The
                # persona emulator (Stranger / Mutual Friend / You) in
                # ``src/components/kot3/Kot3Profile.jsx`` depends on
                # this asymmetry to work correctly.
                user = User.objects.select_related('profile').get(id=request.user.id)
                return Response(UserSerializer(user).data)

            # Username update.
            username = request.data.get('username')
            if username is not None:
                username = username.strip()
                is_ht = request.query_params.get('lang') == 'ht' or request.data.get('lang') == 'ht'
                if not username:
                    error_msg = 'Non itilizatè a pa ka vid.' if is_ht else 'Username cannot be empty.'
                    return Response({'error': error_msg}, status=status.HTTP_400_BAD_REQUEST)
                if User.objects.exclude(id=request.user.id).filter(username__iexact=username).exists():
                    error_msg = 'Non itilizatè sa a deja pran.' if is_ht else 'Username already taken.'
                    return Response({'error': error_msg}, status=status.HTTP_400_BAD_REQUEST)
                request.user.username = username
                request.user.save()

            # Validate and sanitize the new PROFILE fields BEFORE handing
            # the payload to the serializer so the saved row has clean data.
            clean = dict(request.data)

            # Cover photo: explicit 5 MB cap on the base64 string length.
            if 'cover_photo' in clean and clean['cover_photo']:
                from api.serializers.user import COVER_PHOTO_MAX_BYTES
                # Account for the data-URL prefix overhead when present.
                payload_len = len(clean['cover_photo'])
                # 4/3 base64 inflation factor + a 1KB data-URL prefix cap.
                if payload_len > COVER_PHOTO_MAX_BYTES * 4 // 3 + 1024:
                    return Response(
                        {'error': 'Cover photo is too large (max 5 MB).'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # Sanity check: base64 must decode.
                import base64
                try:
                    raw = clean['cover_photo']
                    if ',' in raw and raw.startswith('data:'):
                        raw = raw.split(',', 1)[1]
                    base64.b64decode(raw, validate=True)
                except Exception:
                    return Response(
                        {'error': 'Cover photo payload is not valid base64.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # Migrate base64 → Supabase Storage URL (idempotent: passes
                # through URLs as-is). The structured ``Media`` result
                # is captured in a closure-local dict so we can report
                # upload fallbacks via the response without polluting
                # the Django model instance.
                from api import storage_utils
                cover_result = storage_utils.ensure_url(
                    request.user, 'cover', clean['cover_photo'],
                )
                storage_results['cover_photo'] = cover_result
                clean['cover_photo'] = cover_result.value

            # Avatar: explicit 2 MB cap on the base64 string length, plus
            # a sanity base64 decode check, BEFORE routing through
            # storage_utils so oversized payloads are rejected with a
            # clear 400 instead of being silently kept as base64 in DB.
            if 'avatar' in clean and clean['avatar']:
                from api.serializers.user import AVATAR_MAX_BYTES
                avatar_raw = clean['avatar']
                payload_len = len(avatar_raw)
                if payload_len > AVATAR_MAX_BYTES * 4 // 3 + 1024:
                    return Response(
                        {'error': 'Avatar photo is too large (max 2 MB).'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                import base64
                try:
                    raw = avatar_raw
                    if ',' in raw and raw.startswith('data:'):
                        raw = raw.split(',', 1)[1]
                    base64.b64decode(raw, validate=True)
                except Exception:
                    return Response(
                        {'error': 'Avatar photo payload is not valid base64.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                from api import storage_utils
                avatar_result = storage_utils.ensure_url(
                    request.user, 'avatar', clean['avatar'],
                )
                storage_results['avatar'] = avatar_result
                clean['avatar'] = avatar_result.value

            if 'interests' in clean:
                clean['interests'] = _sanitize_interests(clean['interests'])

            if 'social_links' in clean:
                clean_social, social_errors = _validate_social_links(clean['social_links'])
                if social_errors:
                    return Response(
                        {'error': 'Invalid social links.', 'details': social_errors},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                clean['social_links'] = clean_social

            if 'country' in clean and clean['country']:
                # Validate against the COUNTRIES catalog so the FE always
                # sees canonical ISO-3166 shortnames, not free text.
                allowed = {code for code, _ in COUNTRIES}
                if clean['country'] not in allowed:
                    return Response(
                        {'error': 'Unknown country code.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            serializer = self.get_serializer(profile, data=clean, partial=True)
            if serializer.is_valid():
                # Capture the BEFORE values of the 4 privacy knobs so the
                # activity log can record an ``old -> new`` transition.
                # We do this only when those keys are present in the
                # request payload so a normal bio / avatar update does
                # not generate noise.
                privacy_keys = (
                    'profile_visibility', 'last_seen_visibility',
                    'show_contact_info', 'allow_stranger_dms',
                )
                privacy_before = {k: getattr(profile, k) for k in privacy_keys}
                serializer.save()
                # Decide which activity entries to write, one per key
                # that actually flipped. Putting the loop after ``save``
                # means we use the POST-save state for the new value.
                for key in privacy_keys:
                    if key not in clean:
                        continue
                    new_val = getattr(profile, key)
                    old_val = privacy_before[key]
                    if new_val == old_val:
                        continue
                    if key in ('show_contact_info', 'allow_stranger_dms'):
                        action = 'contact_toggle' if key == 'show_contact_info' else 'dms_toggle'
                    else:
                        action = 'visibility_change'
                    record_activity(request.user, action, {
                        'field': key,
                        'old': old_val,
                        'new': new_val,
                    })
                # Catch-all for any non-privacy field the user touched.
                non_privacy_changes = [
                    k for k in clean.keys()
                    if k not in privacy_keys
                    and k not in ('username',)  # username is a User field, not Profile
                ]
                if non_privacy_changes:
                    record_activity(request.user, 'profile_update', {
                        'fields': non_privacy_changes,
                    })
                resp = Response(serializer.data)
                # Surface Supabase Storage upload-fallback to operators /
                # the FE observability layer so a misconfigured deploy
                # isn't silent. We attach the header after save because
                # the result depends on what ensure_url decided for
                # ``avatar`` and ``cover_photo``.
                fallback_reasons = [
                    f'{field}={result.reason}'
                    for field, result in storage_results.items()
                    if result.fallback
                ]
                if fallback_reasons:
                    resp['X-Devrose-Storage-Fallback'] = 'base64'
                    resp.data = {
                        **resp.data,
                        '__storage_warning': 'kept_as_base64',
                        '__storage_reasons': fallback_reasons,
                    }
                return resp
            logger.warning(
                "Profile validation errors for user_id=%s: %s",
                request.user.id, serializer.errors,
            )
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            # ``exception`` emits a full traceback at ERROR level — the same
            # diagnostic info that ``print(traceback.format_exc())`` used
            # to dump, but routed through Django's logging pipeline so prod
            # aggregators (Sentry/Datadog) can pick it up.
            logger.exception("Profile update error for user_id=%s", request.user.id)
            return Response(
                {'error': 'Profile update failed. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['get'])
    def countries(self, request):
        """
        Returns ``[{"code": "HT", "name": "Haiti"}, ...]``. ENTIRE list
        is shipped to the FE once and cached client-side; the FE's country
        dropdown reads from this single source of truth.
        """
        return Response([{'code': code, 'name': name} for code, name in COUNTRIES])

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        scoping = (instance.profile_visibility or 'public').lower()
        user = instance.user
        data = UserSerializer(user).data
        if scoping == 'private':
            # Strict privacy mode: strip ALL rich profile fields. Only
            # username (top-level) and avatar are kept so the contact card
            # is still identifiable. We must explicitly nil out the new
            # 0012 fields (cover_photo, interests, social_links, country)
            # because UserSerializer nests ProfileSerializer which
            # exposes them by default.
            profile = data.get('profile') or {}
            redacted_profile = {'avatar': profile.get('avatar')}
            for hidden_field in (
                'bio', 'status_text', 'cover_photo', 'interests',
                'social_links', 'country', 'last_seen',
            ):
                redacted_profile[hidden_field] = None
            data['profile'] = redacted_profile
        elif not getattr(instance, 'show_contact_info', False):
            # Public / friends mode: honor the per-field 0021 toggle
            # ``show_contact_info``. When the user has opted to hide
            # their contact details, blank the top-level ``email`` on
            # the response (the only User-level field we redact here;
            # ``phone`` is not currently exposed via the serializer).
            data['email'] = ''
        # Record the view in the activity log (fire-and-forget,
        # throttled per (viewer, target) pair — see _log_profile_view).
        # Skip self-views so the user's own timeline isn't cluttered
        # with every page-load from the MyProfile / Kot3Profile.
        viewer = request.user if request.user.is_authenticated else None
        if viewer is None or viewer.id != user.id:
            _log_profile_view(user, viewer, via='retrieve')
        return Response(data)

    @action(detail=False, methods=['get'], url_path=r'u/(?P<username>[\w.@+-]+)')
    def public_by_username(self, request, username=None):
        """
        Public, privacy-redacted profile view keyed by username.

        The FE uses this for the QR-code share flow:
        - The QR encodes ``<frontend-host>/u/<username>``.
        - Scanning the QR takes the visitor to the React single-page
          app which calls THIS endpoint (or the React app's own
          /u/<username> route once we add a public share-page).
        - We attach a ``public_url`` field to the response so the
          React ``ShareModal`` can copy-paste it without rebuilding
          the path.

        We re-use ``retrieve``'s redaction logic to keep the two
        endpoints in lockstep — a single source of truth for what
        a non-friend / non-self can see.
        """
        try:
            user = User.objects.select_related('profile').get(username__iexact=username)
        except User.DoesNotExist:
            return Response(
                {'error': 'User not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        # Borrow ``retrieve``'s response building so the redaction is
        # identical. We can't call ``self.retrieve`` directly because
        # it expects a pk from the URL router; instead we inline the
        # same logic.
        instance = user.profile
        scoping = (instance.profile_visibility or 'public').lower()
        data = UserSerializer(user).data
        if scoping == 'private':
            profile = data.get('profile') or {}
            redacted_profile = {'avatar': profile.get('avatar')}
            for hidden_field in (
                'bio', 'status_text', 'cover_photo', 'interests',
                'social_links', 'country', 'last_seen',
            ):
                redacted_profile[hidden_field] = None
            data['profile'] = redacted_profile
        elif not getattr(instance, 'show_contact_info', False):
            data['email'] = ''
        # Public, shareable URL pointing at the React share-page.
        data['public_url'] = request.build_absolute_uri(f'/u/{user.username}')
        # Record the view in the activity log (throttled — see
        # ``_log_profile_view``).
        viewer = request.user if request.user.is_authenticated else None
        if viewer is None or viewer.id != user.id:
            _log_profile_view(user, viewer, via='public_by_username')
        return Response(data)


# ----------------------------------------------------------------------
# Block + Mute ViewSets — both scoped to actor = request.user
# ----------------------------------------------------------------------
class BlockViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = BlockedUserSerializer

    def get_queryset(self):
        return BlockedUser.objects.filter(actor=self.request.user).select_related('blocked')

    def perform_destroy(self, instance):
        # Only allow unblocking users you actually blocked.
        if instance.actor_id != self.request.user.id:
            self.permission_denied(self.request)
        instance.delete()


class MuteViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = MutedUserSerializer

    def get_queryset(self):
        # Filter out expired mutes so the consumer never sees stale rows.
        return (
            MutedUser.objects
            .filter(actor=self.request.user)
            .filter(Q(mute_until__isnull=True) | Q(mute_until__gt=timezone.now()))
            .select_related('muted')
        )

    def perform_destroy(self, instance):
        if instance.actor_id != self.request.user.id:
            self.permission_denied(self.request)
        instance.delete()


# ----------------------------------------------------------------------
# Activity log viewset (read-only)
# ----------------------------------------------------------------------
class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ``GET /api/profile/activity/`` — returns the authenticated user's
    last N profile events, newest first. Capped at 50 entries per
    request to keep the payload small; pagination can be added later
    if users with high activity hit the cap.
    """
    serializer_class = ProfileActivityLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            ProfileActivityLog.objects
            .filter(user=self.request.user)
            .order_by('-created_at')[:50]
        )


def get_block_or_mute_user_ids(user):
    """
    Returns the union of:
      - ids that ``user`` has blocked (None of THEIR messages should reach me)
      - ids that have blocked ``user`` (they don't want to hear from me)
      - ids that ``user`` has muted (omit from chat threads list)

    Computed in three small queries; cached in Python as a single ``set``
    so callers can ``.exclude(id__in=...)`` once.

    Excludes the user's own id from the result so a self-id never
    accidentally filters the user out of their own thread list.
    """
    if not user or not user.is_authenticated:
        return set()

    blocked_by_user = set(
        BlockedUser.objects.filter(actor=user).values_list('blocked_id', flat=True)
    )
    user_blocked_by = set(
        BlockedUser.objects.filter(blocked=user).values_list('actor_id', flat=True)
    )
    muted_by_user = set(
        MutedUser.objects
        .filter(actor=user)
        .filter(Q(mute_until__isnull=True) | Q(mute_until__gt=timezone.now()))
        .values_list('muted_id', flat=True)
    )

    exclude = blocked_by_user | user_blocked_by | muted_by_user
    exclude.discard(user.id)
    return exclude
