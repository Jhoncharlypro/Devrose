import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'devrose_backend.settings')

django_asgi_app = get_asgi_application()

import api.routing
# JwtAuthMiddleware replaces the legacy TokenAuthMiddleware. It validates the
# access JWT carried in `?token=` on the WebSocket URL and exposes the
# resolved user via `scope['user']`. See api/middleware.py.
from api.middleware import JwtAuthMiddleware

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": JwtAuthMiddleware(
        URLRouter(
            api.routing.websocket_urlpatterns
        )
    ),
})
