from rest_framework import serializers
from django.utils import timezone
from datetime import timedelta
from ..models import ChatThread, Message
from django.contrib.auth.models import User


class UserMiniSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    status_text = serializers.SerializerMethodField()
    last_seen = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    stories = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'avatar', 'bio', 'status_text', 'is_staff',
                  'first_name', 'last_name', 'last_seen', 'is_online', 'stories']

    def get_avatar(self, obj):
        if hasattr(obj, 'profile') and obj.profile.avatar:
            return obj.profile.avatar
        return None

    def get_bio(self, obj):
        if hasattr(obj, 'profile') and obj.profile.bio:
            return obj.profile.bio
        return ''

    def get_status_text(self, obj):
        if hasattr(obj, 'profile') and obj.profile.status_text:
            return obj.profile.status_text
        return ''

    def get_last_seen(self, obj):
        if hasattr(obj, 'profile') and obj.profile.last_seen:
            return obj.profile.last_seen.isoformat()
        return None

    def get_is_online(self, obj):
        if hasattr(obj, 'profile') and obj.profile.last_seen:
            delta = timezone.now() - obj.profile.last_seen
            return delta.total_seconds() < 180  # 3 minutes
        return False

    def get_stories(self, obj):
        time_threshold = timezone.now() - timedelta(hours=24)
        stories = obj.stories.filter(created_at__gte=time_threshold).order_by('created_at')
        return [{
            'id': story.id,
            'type': story.type,
            'content': story.content,
            'background': story.background,
            'created_at': story.created_at.isoformat()
        } for story in stories]


class MessageSerializer(serializers.ModelSerializer):
    sender = UserMiniSerializer(read_only=True)
    sender_id = serializers.IntegerField(source='sender.id', read_only=True)
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    reply_to_id = serializers.IntegerField(source='reply_to.id', read_only=True, allow_null=True)
    reply_to_snippet = serializers.SerializerMethodField()
    reply_to_sender = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id', 'thread', 'sender', 'sender_id', 'sender_username',
            'content', 'audio', 'image',
            'reply_to_id', 'reply_to_snippet', 'reply_to_sender',
            'is_read', 'is_delivered', 'is_edited', 'edited_at',
            'created_at'
        ]

    def get_reply_to_snippet(self, obj):
        parent = obj.reply_to
        if not parent:
            return ''
        if parent.content:
            return parent.content[:80]
        if parent.image:
            return '📷 Image'
        if parent.audio:
            return '🎙️ Voice'
        return ''

    def get_reply_to_sender(self, obj):
        parent = obj.reply_to
        if not parent:
            return ''
        return parent.sender.username if parent.sender else ''


class ChatThreadSerializer(serializers.ModelSerializer):
    participants = UserMiniSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = ChatThread
        fields = ['id', 'participants', 'created_at', 'updated_at',
                  'last_message', 'unread_count']

    def get_last_message(self, obj):
        last = obj.messages.order_by('-created_at').first()
        if last:
            return MessageSerializer(last, context={'request': self.context.get('request')}).data
        return None

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            return obj.messages.filter(is_read=False).exclude(sender=request.user).count()
        return 0
