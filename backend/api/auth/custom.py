from rest_framework.authentication import TokenAuthentication
from rest_framework import exceptions


class CustomTokenAuthentication(TokenAuthentication):
    """
    DRF Token authentication, but ALSO accepting the `X-Authorization` header.

    WHY support X-Authorization alongside the standard Authorization header?
    A handful of legacy mobile clients in the original DevRose pilot shipped
    their token via a custom `X-Authorization` header (matching an older
    internal convention). We accept both during the migration window so we
    don't break those clients. Real production should drop the X-Authorization
    fallback once those clients are retired — and rotate any tokens that have
    been seen on both headers (legacy header transmissions should already be
    treated as "compromised" by policy).
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
            
        return self.authenticate_credentials(auth_parts[1])
