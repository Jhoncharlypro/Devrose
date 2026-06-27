from rest_framework.authentication import TokenAuthentication
from rest_framework import exceptions

class CustomTokenAuthentication(TokenAuthentication):
    def authenticate(self, request):
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
