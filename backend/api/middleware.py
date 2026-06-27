from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework.authtoken.models import Token


@database_sync_to_async
def get_user_from_token(token_key):
    try:
        token = Token.objects.select_related('user').get(key=token_key)
        return token.user
    except Token.DoesNotExist:
        return AnonymousUser()


class TokenAuthMiddleware:
    """
    ASGI middleware that authenticates a WebSocket scope by reading the token
    from the QUERY STRING.

    WHY the query string and not an HTTP header?
    Browser-native `new WebSocket(url)` cannot attach custom HTTP request
    headers — browsers silently strip them as a security measure to prevent
    credential exfiltration. The token therefore rides in the URL itself, e.g.
        ws://host/ws/chat/?token=xxxxxxxxxx
    Treat any logged `?token=` value as sensitive (log only user ids and
    connection close codes, never the token bytes).

    If you ever add a native mobile app, that client CAN set Authorization
    headers via the platform WebSocket API; in that case extend this middleware
    to read both the Authorization header AND the query string fallback.
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode('utf-8')
        # Build a dict from key=value pairs, ignoring stray '&' characters from
        # malformed URLs (e.g. trailing `?token=abc&`).
        query_params = dict(
            qp.split('=', 1) for qp in query_string.split('&') if '=' in qp
        )
        token_key = query_params.get('token', None)

        if token_key:
            scope['user'] = await get_user_from_token(token_key)
        else:
            scope['user'] = AnonymousUser()

        return await self.inner(scope, receive, send)
