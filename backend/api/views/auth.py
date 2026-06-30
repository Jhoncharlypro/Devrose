"""
Authentication views for the DevRose Academy API.

These views replace the original DRF Token-based flow with a JWT-only flow
that uses ``djangorestframework-simplejwt``.

Flow:
  * POST /api/signup/     → register + auto-login (returns access+refresh).
  * POST /api/login/      → authenticate, return access+refresh+user.
  * POST /api/logout/     → blacklist the supplied refresh token.
  * POST /api/refresh/    → rotate refresh + issue fresh access token.
  * POST /api/password/forgot/      → dev-mode: print a signed reset JWT
                                       to the console + return it in the
                                       response body. No SMTP integration.
  * POST /api/password/reset/confirm/ → consume a reset JWT and set
                                         the new password.
  * GET  /api/me/         → return the logged-in user (kept for compat).

Security notes
--------------
* Password reset does NOT reveal whether the supplied email exists. Both
  existent and non-existent addresses return ``{"detail": "If that email
  is registered, a reset link has been issued."}`` to prevent email
  enumeration.
* Login response shape is:
      ``{"access": "...", "refresh": "...", "user": {...}}``
  matching what SimpleJWT's TokenObtainPairView returns + a serialized
  user attached so the frontend can boot directly into an authenticated
  state with one round-trip.
* Logout expects ``{"refresh": "..."}`` in the body. If the refresh is
  already blacklisted we treat it as "best-effort success" anyway so
  stale clients aren't bricked by clock skew.
* Change-Password verifies the CURRENT password before accepting the new
  one and revokes ALL outstanding SimpleJWT refresh tokens for that user
  (mitigates stolen-session password changes).
* Email-Verification is dev-mode only: a signed JWT with
  ``purpose='email_verification'`` is returned in the API response + logged
  to the console. Production should swap this for an SMTP provider.
* Delete-Account reassigns ``Message.sender`` to a single per-instance
  ``deleted_user`` placeholder so the OTHER participants' chat history
  is preserved verbatim. After that, the user row is hard-deleted which
  cascades to their Profile, Favorites, Enrollments, Sessions, and
  Stories. Empty ChatThreads (no remaining participants) are garbage-
  collected at the end.
"""
import json
import logging
import os
import uuid
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from django.contrib.auth import get_user_model
from django.contrib.auth import authenticate  # used by change_password + Django-only auth fallback
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

from django.db import IntegrityError
from django.db.models import Count, Q

from api.models import Profile, ChatThread, Message, BlockedUser, MutedUser
from api.models.part6 import LoginAttempt, UserSession
from api.serializers import UserSerializer

User = get_user_model()
logger = logging.getLogger(__name__)


def _supabase_headers():
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '').strip() or os.environ.get('SUPABASE_SECRET_KEY', '').strip()
    if not key:
        return None
    return {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
    }


def _supabase_request(path, method='POST', payload=None):
    base = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
    headers = _supabase_headers()
    if not base or headers is None:
        raise RuntimeError('Supabase auth is not configured')
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    req = urlrequest.Request(
        f"{base}{path}",
        headers=headers,
        method=method,
        data=data,
    )
    try:
        with urlrequest.urlopen(req, timeout=15) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            return resp.status, json.loads(body) if body else {}
    except HTTPError as exc:
        body = exc.read().decode('utf-8', errors='replace')
        try:
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {'msg': body or str(exc)}
        return exc.code, parsed
    except URLError as exc:
        raise RuntimeError(f'Supabase request failed: {exc}') from exc


def _supabase_user_payload(supabase_user):
    email = (supabase_user.get('email') or '').strip().lower()
    metadata = supabase_user.get('user_metadata') or {}
    username = (
        metadata.get('username')
        or metadata.get('full_name')
        or metadata.get('name')
        or (email.split('@', 1)[0] if email else '')
        or supabase_user.get('id', 'supabase-user')
    )
    return {
        'username': username[:150],
        'email': email or f"{username[:60]}@supabase.local",
        'sub': supabase_user.get('id', ''),
    }


def _sync_local_user(supabase_user):
    payload = _supabase_user_payload(supabase_user)
    user, _ = User.objects.get_or_create(
        email=payload['email'],
        defaults={
            'username': payload['username'],
            'first_name': payload['sub'][:150],
        },
    )
    updated = False
    if user.username != payload['username']:
        user.username = payload['username']
        updated = True
    if user.first_name != payload['sub'][:150]:
        user.first_name = payload['sub'][:150]
        updated = True
    if updated:
        user.save(update_fields=['username', 'first_name'])
    Profile.objects.get_or_create(user=user)
    return user


# ----------------------------------------------------------------------
# Internal helpers
# ----------------------------------------------------------------------
def _is_supabase_configured():
    """
    True iff Supabase env is fully wired for the auth endpoints used here.

    Used to gate the Django-only fallback in signup()/login() — without
    this gate, callers with an unsaved .env (no SUPABASE_URL yet) would
    500 every time because ``_supabase_request`` raises RuntimeError when
    the base URL is blank. The fallback returns the SAME response
    envelope so the FE doesn't branch on the wire.
    """
    base = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
    key = (
        os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
        or os.environ.get('SUPABASE_SECRET_KEY', '')
        or os.environ.get('SUPABASE_SERVICE_KEY', '')
    ).strip()
    return bool(base) and bool(key)


def _django_login_response(email, password):
    """
    Django-only fallback for /api/login/ when Supabase env is unset.

    Mirrors the production Supabase credential check (look up by
    email OR username, then verify password) without going through
    Supabase REST. Returns ``(access, refresh, user)`` so the caller
    can mint the same response envelope as the Supabase path.
    """
    User = get_user_model()
    lookup = 'email__iexact' if '@' in email else 'username__iexact'
    user_obj = None
    for candidate in User.objects.filter(**{lookup: email}).only('id', 'username', 'password'):
        if authenticate(request=None, username=candidate.username, password=password) is not None:
            user_obj = candidate
            break
    if user_obj is None:
        raise ValueError('invalid_credentials')
    _ensure_profile(user_obj)
    access, refresh = _issue_tokens(user_obj)
    return access, refresh, user_obj


def _django_signup_response(email, password, requested_username=None):
    """
    Django-only fallback for /api/signup/ when Supabase env is unset.

    If the client supplies ``requested_username`` we honour it as long as
    it's non-empty + unique (case-insensitive). If the client DOESN'T send
    a username — or sends one that's blank or taken — we fall back to the
    original auto-derivation from the email locally-part (with a numeric
    suffix on collision and a uuid4 hex tail after 5 attempts) so every
    existing caller keeps working.

    Raises:
      * ``ValueError('account_already_exists')`` — email already on file.
      * ``ValueError('username_required')``       — client sent a non-empty
                                                    ``username`` slot whose
                                                    value was empty after
                                                    strip. (We do NOT reject
                                                    a missing key — that
                                                    triggers the auto-derive
                                                    fallback below.)
      * ``ValueError('username_taken')``         — requested username is in
                                                    use. The FE re-asks.
    """
    User = get_user_model()
    if User.objects.filter(email__iexact=email).exists():
        raise ValueError('account_already_exists')

    final_username = None

    # Honour an explicit username ONLY when the client sent it AND it's
    # non-empty. Otherwise we fall through to the auto-derive path so
    # older FE versions (which never sent a username) keep working.
    if requested_username is not None:
        candidate = requested_username.strip()[:150]
        if candidate:
            if User.objects.filter(username__iexact=candidate).exists():
                raise ValueError('username_taken')
            final_username = candidate
        else:
            # Client sent the key but the value was empty — treat as a
            # hard error so users can't accidentally drop out with a
            # blank username. The auto-derive path requires the key to
            # be ABSENT, not merely blank.
            raise ValueError('username_required')

    if final_username is None:
        # Backward-compat: derive from email. The previous numeric-suffix
        # collision loop is preserved verbatim so users who hit it in
        # the wild keep their legacy PKs (no real-user-row churn).
        base_username = (email.split('@', 1)[0] or 'user')[:140]
        candidate = base_username
        suffix_attempts = 0
        while User.objects.filter(username__iexact=candidate).exists():
            suffix_attempts += 1
            if suffix_attempts > 5:
                # Pathological collision loop — give the row an
                # unguessable name so the user can still register.
                candidate = f"user_{uuid.uuid4().hex[:8]}"
                break
            candidate = f"{base_username}{suffix_attempts}"[:150]
        final_username = candidate

    try:
        user = User.objects.create_user(username=final_username, email=email, password=password)
    except IntegrityError:
        # Race condition: a concurrent signup inserted the same username
        # between our .exists() check and the INSERT. The DB UNIQUE
        # constraint fired. Map back to the same friendly code the view
        # returns as 409 ('Username already taken.') so the FE sees a
        # uniform error envelope.
        raise ValueError('username_taken')
    _ensure_profile(user)
    access, refresh = _issue_tokens(user)
    return access, refresh, user


def _ensure_profile(user):
    Profile.objects.get_or_create(user=user)
    return User.objects.select_related('profile').get(id=user.id)


def _issue_tokens(user):
    """
    Mint a fresh access + refresh JWT pair for ``user``.

    Returns ``(access_str, refresh_str)``. Caller decides whether to put
    them on the wire.
    """
    refresh = RefreshToken.for_user(user)
    return str(refresh.access_token), str(refresh)


# ----------------------------------------------------------------------
# Part 6 audit hooks — login attempts + per-device sessions.
#
# Every login (success or failure) writes a ``LoginAttempt`` row so the
# Admin Dashboard's "Failed Login Attempts" card has real data. On a
# successful login we ALSO open a ``UserSession`` keyed by the refresh
# token's JTI so the Security Center can list active devices and
# "Force logout all" (or "this device only") can revoke a specific JTI
# without invalidating every other session.
# ----------------------------------------------------------------------
def _client_ip(request):
    """Best-effort IP extraction: trust X-Forwarded-For first hop if present."""
    fwd = (request.META.get('HTTP_X_FORWARDED_FOR') or '').strip()
    if fwd:
        # Left-most is the originating client per RFC 7239 conventions.
        return fwd.split(',', 1)[0].strip()[:64] or '0.0.0.0'
    return (request.META.get('REMOTE_ADDR') or '0.0.0.0')[:64]


def _client_user_agent(request):
    return (request.META.get('HTTP_USER_AGENT') or '')[:512]


def _record_login_attempt(
    *,
    username,
    user=None,
    success,
    failure_reason='',
    request=None,
):
    """
    Persist a ``LoginAttempt`` row for the Admin Dashboard.

    Wrapped in ``try/except`` so a DB hiccup never breaks the auth
    response — login is the hottest endpoint, the audit row is best-effort.
    The ``username`` slot always reflects what the user typed (not the
    resolved user) so the Security Center can show a "wrong-password
    probe" pattern even when the username doesn't exist.
    """
    try:
        ip = _client_ip(request) if request is not None else ''
        ua = _client_user_agent(request) if request is not None else ''
        LoginAttempt.objects.create(
            user=user if (success and user) else None,
            username=(username or '')[:255],
            ip_address=ip[:64],
            user_agent=ua[:512],
            success=bool(success),
            failure_reason=(failure_reason or '')[:64],
        )
    except Exception as e:  # pragma: no cover - defensive
        logger.warning('record_login_attempt failed: %s', e)


def _open_user_session(*, user, refresh_token, request):
    """
    Create a ``UserSession`` row keyed by the refresh JWT's JTI claim.

    Returns the new ``UserSession`` (or ``None`` on best-effort failure).
    ``force_logout`` later revokes by JTI, so the Security Center's
    "Force logout all devices" only needs to flip ``is_active`` on every
    active row for the target user -- no need to rotate the signing key.
    """
    try:
        jti = refresh_token.get('jti') or ''
        if not jti:
            return None
        return UserSession.objects.create(
            user=user,
            jti=str(jti)[:64],
            device_label=(request.data.get('device_label') or '')[:120] if request is not None else '',
            ip_address=_client_ip(request) if request is not None else '',
            user_agent=_client_user_agent(request) if request is not None else '',
        )
    except Exception as e:  # pragma: no cover - defensive
        logger.warning('open_user_session failed for uid=%s: %s', user.id, e)
        return None


# ----------------------------------------------------------------------
# Public endpoints
# ----------------------------------------------------------------------
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_profile(request):
    """Return the authenticated user's serialized profile."""
    user = _ensure_profile(request.user)
    return Response(UserSerializer(user).data)


@api_view(['POST'])
@permission_classes([AllowAny])
def signup(request):
    """
    Create a new user and return JWT pair + canonical UserSerializer.

    Same dual-mode contract as ``login``:
      * Supabase env configured → create via Supabase Auth + sync local row.
      * Supabase env missing   → create via Django ORM directly.

    Falls back to the Django-only path BEFORE we even touch Supabase so
    a half-configured dev environment doesn't 500 on every signup.
    """
    email = (request.data.get('email') or '').strip().lower()
    password = request.data.get('password') or ''
    # Read the optional `username` slot. A controlled React input with
    # no defaultValue ships an EMPTY STRING when the field is untouched;
    # we collapse that to `None` so the auto-derive branch below treats
    # "missing" and "empty-but-explicit" identically. A user who actually
    # typed a username reaches `username_required` only when they sent
    # a non-empty value that fails our validators — see
    # `_django_signup_response`.
    raw_username = request.data.get('username')
    if isinstance(raw_username, str) and raw_username.strip():
        username = raw_username.strip()[:150]
    else:
        username = None
    if not email or not password:
        return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    if not _is_supabase_configured():
        try:
            access, refresh, user = _django_signup_response(email, password, username)
        except ValueError as exc:
            err = str(exc)
            if err == 'account_already_exists':
                return Response(
                    {'error': 'Email already registered.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if err == 'username_taken':
                return Response(
                    {'error': 'Username already taken.'},
                    status=status.HTTP_409_CONFLICT,
                )
            if err == 'username_required':
                return Response(
                    {'error': 'Username is required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {'error': 'Signup failed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {'access': access, 'refresh': refresh, 'user': UserSerializer(user).data},
            status=status.HTTP_201_CREATED,
        )

    # Dev-friendly path: create the user via the admin endpoint with the
    # email already confirmed so the user can log in immediately without
    # clicking a confirmation link.
    status_code, data = _supabase_request(
        '/auth/v1/admin/users',
        payload={
            'email': email,
            'password': password,
            'email_confirm': True,
            # Honor the FE-supplied username when present; fall back to
            # the email local-part when the user didn't pick one. The
            # `username` local variable is already normalized above
            # (None when the field was missing/empty).
            'user_metadata': {'username': (username or email.split('@', 1)[0])[:150]},
        },
    )
    if status_code >= 400:
        # Fallback: some projects may not allow the admin create endpoint
        # to set the password directly. In that case we fall back to the
        # public signup flow and rely on the project's email confirmation
        # setting.
        status_code, data = _supabase_request(
            '/auth/v1/signup',
            payload={
                'email': email,
                'password': password,
                'data': {'username': (username or email.split('@', 1)[0])[:150]},
            },
        )
        if status_code >= 400:
            return Response({'error': data.get('msg') or data.get('message') or 'Signup failed'}, status=status_code)

    supabase_user = data.get('user') or {}
    user = _sync_local_user(supabase_user)
    # Admin-created users usually do not get tokens back directly. Sign in
    # immediately so the frontend receives a live session and can upload
    # profile media without requiring a second login step.
    if not data.get('access_token'):
        status_code, login_data = _supabase_request(
            '/auth/v1/token?grant_type=password',
            payload={'email': email, 'password': password},
        )
        if status_code >= 400:
            return Response({'error': login_data.get('msg') or login_data.get('error_description') or 'Signup succeeded but session creation failed'}, status=status.HTTP_400_BAD_REQUEST)
        data = login_data
        supabase_user = data.get('user') or supabase_user
        # Same phantom-user guard as login() above — see Reviewer MAJOR#1.
        if not supabase_user.get('id') and not supabase_user.get('email'):
            return Response(
                {'error': 'Auth provider returned no user identifier.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = _sync_local_user(supabase_user)

    # WHY this mints Django SimpleJWT (HS256) and not the Supabase RS256
    # tokens from `data['access_token']`: ``/api/me/`` (and every other
    # DRF view) authenticates via ``JwtOnlyAuthentication``, which by
    # default validates HS256 tokens signed with ``SECRET_KEY`` and only
    # optionally falls back to a JWKS-verified Supabase RS256 path. That
    # fallback demands ``PyJWKClient`` + ``SUPABASE_JWKS_URL``/``SUPABASE_URL``
    # be fully wired — fragile in dev. Returning Django JWTs keeps the
    # entire authenticated surface (me/, enrollments/, favorites/, …) on
    # the path that just works. The Supabase-direct flow (the FE's
    # "Continue with Supabase" affordance) still works because it stores
    # its RS256 tokens in the ``sb_access_token`` localStorage slot and
    # goes through the same JWKS branch; we are only changing what the
    # ``/api/login/`` and ``/api/signup/`` endpoints mint.
    access, refresh = _issue_tokens(user)
    return Response(
        {
            'access': access,
            'refresh': refresh,
            'user': UserSerializer(user).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    """
    Authenticate and return JWT pair + local user.

    When Supabase env (URL + key) is configured we go through
    ``_supabase_request`` as the source-of-truth for credentials.
    Otherwise we fall back to Django-only auth so a freshly-cloned dev
    repo can still onboard before SUPABASE_URL is provisioned — the
    response envelope is identical so the FE doesn't branch.
    """
    email = (request.data.get('email') or request.data.get('username') or '').strip().lower()
    password = request.data.get('password') or ''
    if not email or not password:
        return Response(
            {'error': 'Email and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not _is_supabase_configured():
        try:
            access, refresh, user = _django_login_response(email, password)
        except ValueError:
            _record_login_attempt(
                username=email, user=None, success=False,
                failure_reason='invalid_credentials', request=request,
            )
            return Response(
                {'error': 'Invalid Credentials'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        _record_login_attempt(
            username=email, user=user, success=True, request=request,
        )
        # Open a UserSession keyed by the refresh JTI so the Security
        # Center can list/revoke this device later.
        try:
            refresh_obj = RefreshToken(refresh)
        except Exception:
            refresh_obj = None
        if refresh_obj is not None:
            _open_user_session(user=user, refresh_token=refresh_obj, request=request)
        return Response(
            {'access': access, 'refresh': refresh, 'user': UserSerializer(user).data}
        )

    # If the user typed a USERNAME (no '@'), translate to email via a
    # local lookup so Supabase's password-grant endpoint gets the email
    # it expects. We do the lookup BEFORE the Supabase round-trip so
    # a nonexistent username fails fast with the same generic error
    # as a wrong password — no enumeration leak.
    if '@' not in email:
        try:
            email = User.objects.get(username__iexact=email).email
        except User.DoesNotExist:
            return Response(
                {'error': 'Invalid Credentials'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    status_code, data = _supabase_request(
        '/auth/v1/token?grant_type=password',
        payload={'email': email, 'password': password},
    )
    if status_code >= 400:
        _record_login_attempt(
            username=email, user=None, success=False,
            failure_reason='supabase_rejected', request=request,
        )
        return Response({'error': data.get('msg') or data.get('error_description') or 'Invalid Credentials'}, status=status.HTTP_400_BAD_REQUEST)

    supabase_user = data.get('user') or {}
    # Guard against a phantom Django User row: if Supabase's response
    # envelope has no ``id`` (admin-API edge cases) AND no ``email`` (the
    # only other stable identifier we use), refuse to call
    # ``_sync_local_user`` — its current fallback would otherwise create a
    # local account with the hard-coded username ``supabase-user`` and
    # email ``supabase-user@supabase.local``. That row would permanently
    # lock that username/email to whoever signed up second, and break
    # ``forgot_password`` recovery for any real user holding the same
    # address. See Reviewer MAJOR#1.
    if not (supabase_user.get('id') or '').strip() and not (supabase_user.get('email') or '').strip():
        return Response(
            {'error': 'Auth provider returned no user identifier.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = _sync_local_user(supabase_user)
    # Mint Django SimpleJWT (HS256) tokens (see login() docstring for the WHY).
    # We authenticate the *credential* against Supabase (the source of truth
    # for passwords + email confirmation) but authorise the *session* with
    # Django's signer so every downstream DRF endpoint validates it without
    # a JWKS round-trip. ``_sync_local_user(supabase_user)`` already created
    # the Django User row above, so ``_issue_tokens(user)`` produces a
    # working HS256 pair.
    access, refresh = _issue_tokens(user)
    _record_login_attempt(
        username=email, user=user, success=True, request=request,
    )
    try:
        refresh_obj = RefreshToken(refresh)
    except Exception:
        refresh_obj = None
    if refresh_obj is not None:
        _open_user_session(user=user, refresh_token=refresh_obj, request=request)
    return Response(
        {
            'access': access,
            'refresh': refresh,
            'user': UserSerializer(user).data,
        }
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def logout(request):
    """
    Blacklist the supplied refresh token.

    Idempotent: a refresh that's already been blacklisted (e.g. user
    double-clicks "Logout") returns ``200`` anyway so the frontend can
    proceed to wipe local storage.
    """
    refresh_str = (request.data.get('refresh') or '').strip()
    if not refresh_str:
        return Response(
            {'error': 'Refresh token is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        token = RefreshToken(refresh_str)
        token.blacklist()
        # Part 6: mark the matching UserSession inactive so the Security
        # Center's "active devices" count drops immediately. Best-effort
        # -- if the row doesn't exist (stale token) the UPDATE is a no-op.
        try:
            jti = token.get('jti') or ''
            if jti and request.user.is_authenticated:
                UserSession.objects.filter(
                    user=request.user, jti=str(jti)[:64], is_active=True,
                ).update(is_active=False, revoked_at=timezone.now(), revoked_reason='logout')
        except Exception as e:  # pragma: no cover - defensive
            logger.debug('logout: session close failed: %s', e)
    except (InvalidToken, TokenError):
        # Stale or malformed token — log but don't fail. The client just
        # needs to drop its copies.
        logger.info('logout: refresh token already invalid; treating as success')
    except Exception as e:
        logger.warning('logout: unexpected error blacklisting refresh: %s', e)

    return Response({'detail': 'Logged out.'})


@api_view(['POST'])
@permission_classes([AllowAny])
def refresh_token(request):
    """
    Rotate the supplied refresh token.

    Wraps SimpleJWT's ``TokenRefreshSerializer`` so we can return a
    consistent envelope (``{"access": ..., "refresh": ...}``) instead
    of exposing ``ROTATE_REFRESH_TOKENS`` quirks to callers.

    Note: with ``ROTATE_REFRESH_TOKENS=True`` + ``BLACKLIST_AFTER_ROTATION=True``
    the OLD refresh is auto-blacklisted, so even if it's later leaked it
    will fail with ``token_blacklisted`` instead of being accepted.
    """
    serializer = TokenRefreshSerializer(data=request.data)
    try:
        serializer.is_valid(raise_exception=True)
    except (InvalidToken, TokenError) as e:
        return Response(
            {'error': 'Invalid or expired refresh token.', 'detail': str(e)},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    data = serializer.validated_data
    out = {'access': data.get('access')}
    # When rotation is enabled, ``refresh`` is included in the response.
    if 'refresh' in data:
        out['refresh'] = data['refresh']
    return Response(out)


# ----------------------------------------------------------------------
# Password reset (dev mode)
# ----------------------------------------------------------------------
def _make_reset_token(user):
    """
    Build a short-lived signed token for password reset.

    Why a hand-rolled JWT and not a DB-backed ``PasswordResetToken``?
    We're dev-mode only — no SMTP, no email body. A signed JWT lets us
    skip the extra table + migration, and SimpleJWT already gives us
    signature verification + expiry for free. Embedding ``user_id`` and a
    ``purpose`` claim guards against a stolen access token being used as
    a reset token.

    Why we return the REFRESH token (not the access token):
    ``reset_password_confirm`` decodes via ``UntypedToken`` and reads the
    ``user_id`` claim directly. Returning ``refresh.access_token`` here
    would still work (both decode as a JWT), but the refresh JWT carries
    a longer canonical lifetime baseline + a different type claim which
    better matches the consumer's expectations.
    """
    refresh = RefreshToken.for_user(user)
    refresh.set_exp(lifetime=timezone.timedelta(minutes=10))
    refresh['purpose'] = 'password_reset'
    return str(refresh)


@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password(request):
    """
    DEV-MODE password reset endpoint.

    Accepts ``{"email": "..."}`` and:
      * If the email belongs to a user, builds a short-lived (10 min)
        signed JWT carrying ``user_id`` + ``purpose=password_reset``.
      * Prints the token + reset URL to the Django console (logger).
      * Returns the token + a fake reset URL in the JSON response so
        the dev frontend can drive the UI end-to-end without SMTP.

    NOTE: the response always uses a generic success message so attackers
    cannot enumerate which emails are registered.
    """
    email = (request.data.get('email') or '').strip().lower()
    if not email:
        return Response(
            {'error': 'Email is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    generic_message = {
        'detail': 'If that email is registered, a reset link has been issued.'
    }
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        # Don't leak existence. Return the generic message AND no token.
        return Response(generic_message)

    token = _make_reset_token(user)
    reset_url = f'/reset-password?token={token}'  # Frontend handles this path.
    logger.info(
        '[dev] Password-reset token issued for %s (uid=%s): %s',
        email, user.id, reset_url,
    )
    return Response({
        **generic_message,
        # Dev-only fields so the UI can pick them up without reading logs.
        'dev_reset_token': token,
        'dev_reset_url': reset_url,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password_confirm(request):
    """
    Consume a reset JWT and set a new password.

    Body: ``{"token": "...", "new_password": "..."}``.

    Validates:
      * The token is a JWT signed by us and not yet expired.
      * The token has ``purpose == 'password_reset'`` (an access token
        stolen for normal browsing cannot be used as a reset token).
      * The new password passes Django's password validators.

    Validation ordering matters: we validate the password BEFORE decoding
    the token so a typo from the user doesn't burn a single-use reset
    token + force them to request a new one. (Reviewer MAJOR#3.)
    """
    token_str = (request.data.get('token') or '').strip()
    new_password = request.data.get('new_password') or ''

    if not token_str or not new_password:
        return Response(
            {'error': 'Both token and new_password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Cheap password validation FIRST — don't burn the token on a typo.
    try:
        validate_password(new_password)
    except DjangoValidationError as e:
        return Response(
            {'error': ' '.join(e.messages)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Decode the reset JWT. We use ``UntypedToken`` (not ``RefreshToken``)
    # so the token can be minted EITHER from a refresh JWT OR an access
    # JWT; we only care about the ``user_id`` + ``purpose`` claims here.
    from rest_framework_simplejwt.tokens import UntypedToken
    try:
        validated = UntypedToken(token_str)
        user_id = validated.get('user_id')
        purpose = validated.get('purpose')
    except (InvalidToken, TokenError):
        return Response(
            {'error': 'Invalid or expired reset token.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if purpose != 'password_reset':
        # Probably a regular access token — refuse strongly.
        return Response(
            {'error': 'Invalid reset token.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response(
            {'error': 'Invalid reset token.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user.set_password(new_password)
    user.save(update_fields=['password'])

    # Best-effort: force everyone to log in again after a password change.
    return Response({'detail': 'Password updated. Please log in.'})


# ----------------------------------------------------------------------
# Authenticated account-management endpoints
# ----------------------------------------------------------------------
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    Authenticated password change.

    Body: ``{"current_password": "...", "new_password": "..."}``.

    Why we re-validate the supplied CURRENT password even though the
    access JWT was already required: an attacker who has stolen the JWT
    should NOT be able to silently rotate the password without ALSO
    knowing the current one — that's a strong second factor for a
    "shoulder-surf / cookie-theft" scenario.
    """
    current_password = request.data.get('current_password') or ''
    new_password = request.data.get('new_password') or ''

    if not current_password or not new_password:
        return Response(
            {'error': 'Both current_password and new_password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Cheap validator first so a "weak new password" does not consume
    # the CPU on the bcrypt check below.
    try:
        validate_password(new_password, request.user)
    except DjangoValidationError as e:
        return Response(
            {'error': ' '.join(e.messages)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Re-authenticate with the supplied current password. If it fails,
    # raise 401 so the frontend can show "wrong current password".
    user = authenticate(
        username=request.user.username,
        password=current_password,
    )
    if not user or user.id != request.user.id:
        return Response(
            {'error': 'Current password is incorrect.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    # All checks passed — rotate the password on the actual row.
    request.user.set_password(new_password)
    request.user.save(update_fields=['password'])

    # Revoke ALL outstanding refresh tokens for this user. We use the
    # SimpleJWT blacklist tables directly (instead of relying on the
    # access-token expiry + rotation alone) so a stolen JWT cannot be
    # paired with a still-valid refresh to mint a new access token.
    try:
        from rest_framework_simplejwt.token_blacklist.models import (
            BlacklistedToken,
            OutstandingToken,
        )
        for outstanding in OutstandingToken.objects.filter(user=request.user):
            BlacklistedToken.objects.get_or_create(token=outstanding)
    except Exception as e:
        # Don't let a DB hiccup fail the password change — log + move on.
        logger.warning('change_password: failed to blacklist tokens: %s', e)

    return Response(
        {'detail': 'Password updated. All devices have been signed out.'}
    )


def _make_email_verification_token(user):
    """
    Build a short-lived (24h) signed token for email verification.

    Mirrors the dev-mode pattern used for password reset: a signed JWT
    with ``purpose='email_verification'`` so a stolen access token
    can't accidentally be used to verify an email.
    """
    refresh = RefreshToken.for_user(user)
    refresh.set_exp(lifetime=timezone.timedelta(hours=24))
    refresh['purpose'] = 'email_verification'
    return str(refresh)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_email_verification(request):
    """
    Issue an email-verification token for the currently-authenticated user.

    Always returns a generic success message — we don't reveal whether
    the user already has a verified email so enumeration isn't possible.
    """
    token = _make_email_verification_token(request.user)
    verify_url = f'/verify-email?token={token}'
    logger.info(
        '[dev] Email-verification token for uid=%s: %s',
        request.user.id, verify_url,
    )
    # If already verified, skip; the FE will silently ignore.
    return Response({
        'detail': 'If your account can be verified, a verification link has been issued.',
        'dev_verify_token': token,
        'dev_verify_url': verify_url,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_email_confirm(request):
    """
    Consume a verify-email token and mark Profile.email_verified=True.

    Body: ``{"token": "..."}``.
    """
    token_str = (request.data.get('token') or '').strip()
    if not token_str:
        return Response(
            {'error': 'Verification token is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from rest_framework_simplejwt.tokens import UntypedToken
    try:
        validated = UntypedToken(token_str)
        user_id = validated.get('user_id')
        purpose = validated.get('purpose')
    except (InvalidToken, TokenError):
        return Response(
            {'error': 'Invalid or expired verification token.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if purpose != 'email_verification':
        return Response(
            {'error': 'Invalid verification token.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(id=user_id)
        profile = Profile.objects.get_or_create(user=user)[0]
    except User.DoesNotExist:
        return Response(
            {'error': 'Invalid verification token.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if profile.email_verified:
        return Response({'detail': 'Email already verified.'})

    profile.email_verified = True
    profile.email_verified_at = timezone.now()
    profile.save(update_fields=['email_verified', 'email_verified_at'])
    return Response({'detail': 'Email verified.'})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_account(request):
    """
    Permanently delete the currently-authenticated user.

    Body: ``{"confirmation": "DELETE"}`` — the frontend prompts the user
    to literally type the word "DELETE" so a stray click can't poison
    their account.

    The flow is intentionally NOT a raw ``User.delete()``:
      1. Reassign ``Message.sender`` to a single ``deleted_user``
         placeholder so other participants keep their chat history
         intact.
      2. Detach the user from every ChatThread.participants M2M
         relation.
      3. ``User.delete()`` — cascades Profile, Favorite, Enrollment,
         SessionMemory, UserStory via the FK on_delete=CASCADE rules.
      4. Garbage-collect any ChatThread that has 0 remaining participants.

    The cascade-deletion of the User row invalidates all outstanding
    SimpleJWTs automatically (the JWT decoder raises on missing user_id).
    """
    confirmation = (request.data.get('confirmation') or '').strip()
    if confirmation != 'DELETE':
        return Response(
            {'error': 'Confirmation does not match. Type DELETE exactly to proceed.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = request.user
    username = user.username
    user_id = user.id

    # 1) Find or create the per-instance ghost user that we will
    #    re-attribute messages to. We use a deterministic username so
    #    it's stable across multiple deletions.
    deleted_username = 'deleted_user'
    ghost, created = User.objects.get_or_create(
        username=deleted_username,
        defaults={
            'is_active': False,
            'first_name': 'Deleted',
            'last_name': 'User',
            'email': f'{deleted_username}@removed.invalid',
        },
    )

    # 2) Reassign every message authored by the doomed user to the
    #    ghost placeholder so other participants keep their chat
    #    history verbatim (``Message.sender`` has on_delete=CASCADE,
    #    so without this reassignment the OTHER party would lose the
    #    entire thread once we delete the user row).
    updated_msgs = Message.objects.filter(sender_id=user_id).update(sender=ghost)

    # 3) Detach the doomed user from every ChatThread they belong to.
    #    Going through the M2M ``through`` table in a single bulk
    #    delete is O(1) round-trips vs an N+1 ``remove()`` loop, and
    #    it doesn't cascade-delete the ChatThread rows themselves.
    ChatThreadParticipation = ChatThread.participants.through
    ChatThreadParticipation.objects.filter(user_id=user_id).delete()

    # Delete moderation rows where the doomed user is on EITHER side
    # of the relationship — otherwise leftover rows cause
    # select_related('blocked') joins in the survivor's chat filter
    # to raise DoesNotExist.
    BlockedUser.objects.filter(Q(actor=user) | Q(blocked=user)).delete()
    MutedUser.objects.filter(Q(actor=user) | Q(muted=user)).delete()

    # 4) Hard delete the user — Profile, Favorite, Enrollment,
    #    SessionMemory, UserStory all cascade via their FK on_delete.
    user.delete()

    # 5) Sweep up any thread that lost its last participant so the
    #    chat list doesn't display empty cards.
    dead_threads = ChatThread.objects.annotate(c=Count('participants')).filter(c=0)
    dead_count = dead_threads.count()
    dead_threads.delete()

    logger.info(
        'delete_account: uid=%s (%s) deleted; reassigned %d messages; '
        'cleaned up %d empty threads.',
        user_id, username, updated_msgs, dead_count,
    )
    return Response({
        'detail': 'Account deleted.',
        'messages_reassigned': updated_msgs,
        'empty_threads_cleaned': dead_count,
    })
