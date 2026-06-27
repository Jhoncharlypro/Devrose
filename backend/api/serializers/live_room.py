from rest_framework import serializers
from ..models import LiveRoom


class LiveRoomSerializer(serializers.ModelSerializer):
    host_username = serializers.CharField(source='host.username', read_only=True)

    class Meta:
        model = LiveRoom
        fields = [
            'id', 'room_id', 'public_code', 'private_host_key', 'title', 'host', 'host_username',
            'is_active', 'mode', 'theme', 'pinned_message', 'last_url', 'participant_count',
            'last_seen_at', 'created_at'
        ]
        read_only_fields = ['host', 'last_seen_at', 'created_at']
