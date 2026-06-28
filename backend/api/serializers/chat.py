from rest_framework import serializers
from django.utils import timezone
from datetime import timedelta
from ..models import ChatThread, Message, MessageReaction
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


def _build_reactions_context(messages, request_user):
    """
    Aggregate ``MessageReaction`` rows for ``messages`` in two passes (one
    for the chip aggregation, one for ``my_reactions``) so the caller can
    pass the result as serializer context and avoid an N+1 inside
    ``MessageSerializer.get_reactions`` / ``get_my_reactions``.

    Returns ``{'reactions_by_message': {msg_id: [{emoji, user_id}, ...]},
              'my_reactions_by_message': {msg_id: [emoji, ...]}}``.
    """
    from ..models import MessageReaction
    msg_ids = [m.id for m in messages if m.id]
    if not msg_ids:
        return {'reactions_by_message': {}, 'my_reactions_by_message': {}}
    all_rows = list(
        MessageReaction.objects
        .filter(message_id__in=msg_ids)
        .values('message_id', 'emoji', 'user_id')
    )
    reactions_by_message = {}
    mine_by_message = {}
    for r in all_rows:
        reactions_by_message.setdefault(r['message_id'], []).append(
            {'emoji': r['emoji'], 'user_id': r['user_id']}
        )
        if request_user and request_user.is_authenticated and r['user_id'] == request_user.id:
            mine_by_message.setdefault(r['message_id'], []).append(r['emoji'])
    return {
        'reactions_by_message': reactions_by_message,
        'my_reactions_by_message': mine_by_message,
    }


class MessageSerializer(serializers.ModelSerializer):
    sender = UserMiniSerializer(read_only=True)
    sender_id = serializers.IntegerField(source='sender.id', read_only=True)
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    # Use the underlying integer FK column directly. ``source='reply_to.id'``
    # would trigger a follow-up SELECT for every message in the list
    # (n+1); the integer column is already loaded as part of the row.
    reply_to_id = serializers.IntegerField(read_only=True, allow_null=True)
    reply_to_snippet = serializers.SerializerMethodField()
    reply_to_sender = serializers.SerializerMethodField()
    # Step 3+4 (chat module additions): additive fields only. Existing
    # callers see None / empty string on legacy rows → no rendering
    # breakage, only a richer UI on new messages.
    # Same n+1 reasoning as reply_to_id: read the FK column directly.
    # ``source='forwarded_from.id'`` would crash with ``AttributeError``
    # on legacy rows where the FK is NULL (DRF tries to dot-walk a None
    # when the parent is unset).
    forwarded_from_id = serializers.IntegerField(read_only=True, allow_null=True)
    reactions = serializers.SerializerMethodField()
    my_reactions = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id', 'thread', 'sender', 'sender_id', 'sender_username',
            'content', 'audio', 'image',
            'reply_to_id', 'reply_to_snippet', 'reply_to_sender',
            'is_read', 'is_delivered', 'is_edited', 'edited_at',
            'created_at',
            'forwarded_from_id', 'forward_sender_name',
            'reactions', 'my_reactions',
        ]

    def get_reactions(self, obj):
        # ``MessageReaction`` rows are pushed onto the message via
        # ``.reactions`` (a reverse FK). For a thread history of 100
        # messages that would be 100 extra SELECTs. ``get_reactions_map``
        # on the parent view/consumer pre-aggregates the same rows once
        # via ``Message.objects.prefetch_related('reactions')`` and
        # attaches the result on ``self.context`` so we can reuse it
        # here without a per-row query.
        cached = (self.context or {}).get('reactions_by_message', {}) or {}
        rows = cached.get(obj.id)
        if rows is None:
            # Fallback for ad-hoc serialization outside the chat list:
            # one query for this message only, not for the whole list.
            rows = list(obj.reactions.values('emoji', 'user_id'))
        grouped = {}
        for r in rows:
            bucket = grouped.setdefault(r['emoji'], {'emoji': r['emoji'], 'count': 0, 'user_ids': []})
            bucket['count'] += 1
            bucket['user_ids'].append(r['user_id'])
        return list(grouped.values())

    def get_my_reactions(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return []
        cached = (self.context or {}).get('my_reactions_by_message', {}) or {}
        if obj.id in cached:
            return cached[obj.id]
        return list(obj.reactions.filter(user=request.user).values_list('emoji', flat=True))


class ChatThreadSerializer(serializers.ModelSerializer):
    participants = UserMiniSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = ChatThread
        fields = ['id', 'participants', 'created_at', 'updated_at',
                  'last_message', 'unread_count']

    def get_last_message(self, obj):
        # Prefer the prefetched "real last" cached by ChatThreadViewSet.list
        # (zero extra queries). Falls back to a single SELECT when the
        # serializer is used outside the list endpoint (single-resource
        # reads, ad-hoc serialization, test fixtures).
        cached = getattr(obj, 'real_last_message', None)
        last = cached if cached is not None else obj.messages.order_by('-created_at').first()
        if not last:
            return None
        # Aggregate reactions for this single message so the nested
        # MessageSerializer skips its per-row fallback SELECT. This
        # closes the N+1 cascade that ``/api/chat/threads/`` previously
        # surfaced (each thread's last_message serializer re-fetched
        # its own reactions in isolation).
        request = self.context.get('request')
        request_user = getattr(request, 'user', None) if request else None
        rxn_ctx = _build_reactions_context([last], request_user)
        return MessageSerializer(last, context={'request': request, **rxn_ctx}).data

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            return obj.messages.filter(is_read=False).exclude(sender=request.user).count()
        return 0
