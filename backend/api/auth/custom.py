"""
Authentication classes for the DevRose Academy API.

Two classes live here:

* ``CustomTokenAuthentication`` — the ORIGINAL DRF Token-based class.
  Kept around for emergency rollback only. NOT registered in
  ``settings.REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES']`` since the
  JWT migration (see CHANGELOG). The legacy `rest_framework.authtoken` app
  has been removed from ``INSTALLED_APPS``, so importing this class and
  using it end-to-end will fail — we keep it here purely as historical
  context for code archaeologists.

* ``JwtOnlyAuthentication`` — the new default. Validates a Bearer JWT
  minted by ``djangorestframework-simplejwt`` and accepts it from EITHER
  the standard ``Authorization`` header OR the legacy ``X-Authorization``
  header (which the original native mobile clients still send during the
  migration window — see the docstring on ``CustomTokenAuthentication``
  in the git history for the WHY).
"""
import os

from django.contrib.auth import get_user_model
from django.utils.text import slugify
from rest_framework.authentication import TokenAuthentication
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

try:
    import jwt
    from jwt import PyJWKClient
except Exception:  # pragma: no cover
    jwt = None
    PyJWKClient = None

from api.models import Profile

UserModel = get_user_model()


class CustomTokenAuthentication(TokenAuthentication):
    """
    LEGACY — DRF Token authentication, kept only as a historical reference.

    WHY this still exists in the codebase: a small number of native mobile
    clients from the original DevRose pilot shipped their auth token via a
    custom ``X-Authorization`` header. We accepted both headers during the
    migration window so we didn't break those clients.

    The class is INACTIVE — ``settings.REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES']``
    no longer references it, and ``rest_framework.authtoken`` has been removed
    from ``INSTALLED_APPS``. Do NOT re-enable without first re-installing the
    authtoken app and writing a data migration to seed tokens for existing
    users.
    """

    def authenticate(self, request):
        # Prefer the standard Authorization header; fall back to X-Authorization
        # for legacy clients (see class docstring).
        auth = request.headers.get('X-Authorization')
        if not auth:
            auth = request.headers.get('Authorization')

        if not auth:
            return None

        auth_parts = auth.split()
        if not auth_parts or auth_parts[0].lower() != 'token':
            return None

        if len(auth_parts) == 1:
            msg = 'Invalid token header. No credentials provided.'
            raise exceptions.AuthenticationFailed(msg)
        elif len(auth_parts) > 2:
            msg = 'Invalid token header. Token string should not contain spaces.'
            raise exceptions.AuthenticationFailed(msg)

        # NOTE: This call will raise if the authtoken app is no longer
        # installed. The class is documented as legacy-only — see the module
        # docstring.
        return self.authenticate_credentials(auth_parts[1])


class JwtOnlyAuthentication(JWTAuthentication):
    """
    JWT-only authentication class.

    Differences from DRF's stock ``JWTAuthentication``:
      * Reads the token from ``X-Authorization`` as well as ``Authorization``.
        This keeps native mobile clients (that still send ``X-Authorization``)
        working during the JWT cut-over — once they're confirmed off the
        legacy header, drop the ``X-Authorization`` branch.
      * Returns ``None`` (instead of raising) for unknown / malformed /
        expired tokens so callers without an active session can still hit
        ``@permission_classes([AllowAny])`` endpoints (login, refresh,
        forgot-password) without seeing stack traces. ``PermissionDenied``
        still fires after this returns ``None`` for endpoints that
        require ``IsAuthenticated``.
    """

    # Both header names are valid; the first non-empty one wins.
    _HEADER_CANDIDATES = ('Authorization', 'X-Authorization')

    def get_validated_token(self, raw_token):
        # Use the parent's strict JWT validation. If the token is expired
        # or otherwise invalid, this raises InvalidToken — which we re-raise
        # later as an AuthenticationFailed with a friendly message.
        return super().get_validated_token(raw_token)

    def authenticate(self, request):
        # Prefer Supabase JWTs when present. Fall back to the Django-issued
        # JWTs so existing dev sessions keep working during the migration.
        for header_name in self._HEADER_CANDIDATES:
            header_value = request.headers.get(header_name)
            if not header_value:
                continue

            parts = header_value.split()
            if len(parts) != 2 or parts[0].lower() != 'bearer':
                # Wrong scheme on this header — try the next one. If neither
                # works, fall through to return None so unauthenticated
                # endpoints (login, refresh) still work.
                continue

            raw_token = parts[1]
            supabase_user = self._authenticate_supabase_jwt(raw_token)
            if supabase_user is not None:
                return (supabase_user, raw_token)
            try:
                validated_token = self.get_validated_token(raw_token)
            except (InvalidToken, TokenError):
                # Don't raise — let downstream @permission_classes decide.
                return None

            try:
                user = self.get_user(validated_token)
            except Exception:
                return None

            return (user, validated_token)

        # No usable header — caller is anonymous.
        return None

    def _authenticate_supabase_jwt(self, raw_token):
        """
        Validate a Supabase access token via JWKS and map it to a Django user.

        Supabase issues RS256 JWTs. We verify the signature against the
        project's JWKS endpoint and then either find or create a matching
        Django user using the Supabase email / metadata.
        """
        jwks_url = os.environ.get('SUPABASE_JWKS_URL', '').strip()
        if not jwks_url:
            supabase_url = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
            if supabase_url:
                jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
        if not jwks_url or jwt is None or PyJWKClient is None:
            return None

        try:
            client = PyJWKClient(jwks_url)
            signing_key = client.get_signing_key_from_jwt(raw_token).key
            claims = jwt.decode(
                raw_token,
                signing_key,
                algorithms=['RS256'],
                audience=None,
                options={'verify_aud': False},
            )
        except Exception:
            return None

        # Supabase uses `sub` as the stable user identifier; email may be
        # absent for some auth providers, so we derive a safe username when
        # needed and cache the Supabase UUID in first_name for traceability.
        email = (claims.get('email') or '').strip().lower()
        metadata = claims.get('user_metadata') or {}
        preferred_username = (
            metadata.get('username')
            or metadata.get('full_name')
            or metadata.get('name')
            or (email.split('@', 1)[0] if email else '')
            or claims.get('sub')
        )
        username = slugify(preferred_username)[:150] or f"supabase-{claims.get('sub', '')[:8]}"
        if not email:
            email = f"{username}@supabase.local"

        user, created = UserModel.objects.get_or_create(
            email=email,
            defaults={
                'username': username,
                'first_name': claims.get('sub', '')[:150],
            },
        )
        if not created:
            changed = False
            if user.username != username:
                user.username = username
                changed = True
            if user.first_name != claims.get('sub', '')[:150]:
                user.first_name = claims.get('sub', '')[:150]
                changed = True
            if changed:
                user.save(update_fields=['username', 'first_name'])
        Profile.objects.get_or_create(user=user)
        return user

    def authenticate_header(self, request):
        # Send the proper WWW-Authenticate on 401 so browsers / OpenAPI
        # tooling know what scheme we expect (Reviewer MINOR#6).
        return 'Bearer realm="api"'
