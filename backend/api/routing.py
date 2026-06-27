from django.urls import re_path
from .consumers import ClassroomLiveConsumer, Kot3ChatConsumer

websocket_urlpatterns = [
    re_path(r'ws/live/(?P<room_id>[\w-]+)/$', ClassroomLiveConsumer.as_asgi()),
    re_path(r'ws/chat/$', Kot3ChatConsumer.as_asgi()),
]
