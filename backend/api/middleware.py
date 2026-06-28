"""
ASGI middleware for WebSocket authentication.

Channels runs the WebSocket consumer outside the DRF authentication chain,
so we re-implement JWT validation here. The chat URL pattern is:

    ws://host/ws/chat/?token=<jwt>

Browsers cannot attach arbitrary HTTP headers to a `new WebSocket(url)` call
(many browsers silently strip custom headers as a deliberate defense against
credential exfiltration), so the access JWT rides in the URL query string.
Treat any ``?token=`` value as sensitive — log only user ids and close codes,
never the raw JWT bytes.

When SimpleJWT is correctly configured the access token is a stateless
HS256-signed blob with a 15-minute lifetime (see settings.SIMPLE_JWT). On
expiry we attach ``AnonymousUser`` and the consumer is expected to close the
connection with code ``4401`` so the frontend can transparently refresh and
reconnect.
"""
from urllib.parse import unquote

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


@database_sync_to_async
def _user_from_token(validated_token):
    """
    Resolve a JWT to its Django user.

    Why ``UntypedToken`` and not ``AccessToken``? ``AccessToken`` performs
    audit-trail checks against the blacklist; we want pure stateless
    validation here so an expired-but-unused token behaves predictably
    (the consumer closes the WS connection with 4401 and the frontend
    refreshes).
    """
    from django.contrib.auth.models import User
    try:
        user_id = validated_token.get('user_id')
        if not user_id:
            return AnonymousUser()
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return AnonymousUser()


class JwtAuthMiddleware:
    """
    Populate ``scope['user']`` from the ``?token=`` query string.

    Authentication ladder:
      1. Parse ``?token=<jwt>`` from ``scope['query_string']``.
      2. Validate the JWT signature + expiry via ``UntypedToken``.
      3. Resolve the user from the JWT ``user_id`` claim.
      4. If any step fails, leave ``scope['user']`` as ``AnonymousUser``
         so the downstream consumer can close with code ``4401``.

    Importantly: invalid/expired tokens do NOT raise; the consumer is the
    gatekeeper that decides whether to accept the connection.
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode('utf-8')
        # Build a dict from key=value pairs, ignoring stray '&' from malformed
        # URLs (e.g. trailing `?token=abc&`).
        query_params = dict(
            qp.split('=', 1) for qp in query_string.split('&') if '=' in qp
        )

        # The query string value for `token` is URL-encoded; the browser's
        # WebSocket constructor already encodes it, so decode here.
        raw_token = query_params.get('token', None)
        if raw_token:
            raw_token = unquote(raw_token)

        if raw_token:
            try:
                # UntypedToken validates signature + expiry without DB lookups.
                validated_token = UntypedToken(raw_token)
                scope['user'] = await _user_from_token(validated_token)
            except (InvalidToken, TokenError, Exception):
                scope['user'] = AnonymousUser()
        else:
            scope['user'] = AnonymousUser()

        return await self.inner(scope, receive, send)
