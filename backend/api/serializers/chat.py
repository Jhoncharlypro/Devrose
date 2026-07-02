from rest_framework import serializers
from django.utils import timezone
from datetime import timedelta
from django.db.models import Q
from ..models import ChatThread, Message, MessageReaction, UserThreadSetting, CallLog
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
            'created_at': story.created_at.isoformat(),
        } for story in stories]


def _build_reactions_context(messages, request_user):
    """
    Aggregate ``MessageReaction`` rows for ``messages`` in two passes so
    the serializer reads from ``context`` instead of issuing N+1 SELECTs.
    Returns ``{'reactions_by_message': {...}, 'my_reactions_by_message': {...}}``.
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
    reply_to_id = serializers.IntegerField(read_only=True, allow_null=True)
    reply_to_snippet = serializers.SerializerMethodField()
    reply_to_sender = serializers.SerializerMethodField()
    forwarded_from_id = serializers.IntegerField(read_only=True, allow_null=True)
    reactions = serializers.SerializerMethodField()
    my_reactions = serializers.SerializerMethodField()
    # Phase 9 — delete + attachments + disappearing
    is_deleted = serializers.SerializerMethodField()
    deleted_at = serializers.DateTimeField(read_only=True, allow_null=True)
    deleted_by_id = serializers.IntegerField(read_only=True, allow_null=True)
    deleted_by_username = serializers.SerializerMethodField()
    document = serializers.CharField(read_only=True, allow_blank=True, default='')
    document_name = serializers.CharField(read_only=True, allow_blank=True, default='')
    has_document = serializers.SerializerMethodField()
    location_lat = serializers.DecimalField(read_only=True, max_digits=9, decimal_places=6, allow_null=True)
    location_lng = serializers.DecimalField(read_only=True, max_digits=9, decimal_places=6, allow_null=True)
    location_name = serializers.CharField(read_only=True, allow_blank=True, default='')
    has_location = serializers.SerializerMethodField()
    attachment_kind = serializers.SerializerMethodField()  # 'image'|'audio'|'document'|'location'|None

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
            'is_deleted', 'deleted_at', 'deleted_by_id', 'deleted_by_username',
            'document', 'document_name', 'has_document',
            'location_lat', 'location_lng', 'location_name', 'has_location',
            'attachment_kind',
            'is_ephemeral', 'expires_at',
        ]

    def get_reactions(self, obj):
        cached = (self.context or {}).get('reactions_by_message', {}) or {}
        rows = cached.get(obj.id)
        if rows is None:
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

    def get_reply_to_snippet(self, obj):
        if obj.reply_to_id is None:
            return ''
        if getattr(obj.reply_to, 'deleted_at', None):
            return ''
        c = obj.reply_to.content or ''
        return (c[:80] + '…') if len(c) > 80 else c

    def get_reply_to_sender(self, obj):
        if obj.reply_to_id is None:
            return ''
        if getattr(obj.reply_to, 'deleted_at', None):
            return ''
        return obj.reply_to.sender.username if obj.reply_to.sender_id else ''

    def get_is_deleted(self, obj):
        return obj.deleted_at is not None

    def get_deleted_by_username(self, obj):
        if not obj.deleted_by_id:
            return ''
        return obj.deleted_by.username if obj.deleted_by else ''

    def get_has_document(self, obj):
        return bool(obj.document)

    def get_has_location(self, obj):
        return obj.location_lat is not None and obj.location_lng is not None

    def get_attachment_kind(self, obj):
        if obj.image:
            return 'image'
        if obj.audio:
            return 'audio'
        if obj.document:
            return 'document'
        if obj.location_lat is not None and obj.location_lng is not None:
            return 'location'
        return None


class ChatThreadSerializer(serializers.ModelSerializer):
    participants = UserMiniSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    # Phase 9 — per-user prefs + group fields + dynamic is_request
    is_pinned = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    is_muted = serializers.SerializerMethodField()
    is_request = serializers.SerializerMethodField()
    is_group = serializers.BooleanField(read_only=True)
    name = serializers.CharField(read_only=True, allow_blank=True, default='')

    class Meta:
        model = ChatThread
        fields = ['id', 'participants', 'created_at', 'updated_at',
                  'last_message', 'unread_count',
                  'is_pinned', 'is_archived', 'is_muted', 'is_request',
                  'is_group', 'name']

    def _settings_for(self, obj):
        ctx_map = (self.context or {}).get('thread_settings_map') or {}
        if obj.id in ctx_map:
            return ctx_map[obj.id]
        try:
            return obj.settings.get(user=self.context['request'].user)
        except Exception:
            return None

    def get_is_pinned(self, obj):
        s = self._settings_for(obj)
        return bool(s and s.is_pinned)

    def get_is_archived(self, obj):
        s = self._settings_for(obj)
        return bool(s and s.is_archived)

    def get_is_muted(self, obj):
        s = self._settings_for(obj)
        if not s or not s.muted_until:
            return False
        return s.muted_until > timezone.now()

    def get_is_request(self, obj):
        """Dynamic — never a column. A thread flips into request state when
        the caller has unread messages AND has not yet sent any. Once they
        reply, the serializer flips back to ``is_request=False``.
        Explicit ``UserThreadSetting.is_request_ignored`` also suppresses."""
        s = self._settings_for(obj)
        if s and s.is_request_ignored:
            return False
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        ever_sent = obj.messages.filter(sender=request.user).exists()
        if ever_sent:
            return False
        cached = getattr(obj, '_unread_inbound_count', None)
        if cached is not None:
            return cached > 0
        return obj.messages.filter(is_read=False).exclude(sender=request.user).exists()

    def get_last_message(self, obj):
        cached = getattr(obj, 'real_last_message', None)
        last = cached if cached is not None else obj.messages.order_by('-created_at').first()
        if not last:
            return None
        request = self.context.get('request')
        request_user = getattr(request, 'user', None) if request else None
        rxn_ctx = _build_reactions_context([last], request_user)
        return MessageSerializer(last, context={'request': request, **rxn_ctx}).data

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            cached = getattr(obj, '_unread_inbound_count', None)
            if cached is not None:
                return cached
            return obj.messages.filter(is_read=False).exclude(sender=request.user).count()
        return 0


class CallLogSerializer(serializers.ModelSerializer):
    caller_username = serializers.CharField(source='caller.username', read_only=True)
    callee_username = serializers.CharField(source='callee.username', read_only=True)
    caller_avatar = serializers.SerializerMethodField()
    callee_avatar = serializers.SerializerMethodField()
    # The FE (CallHistoryPanel.jsx + kot3chat websocket envelope) talks
    # ``call_type`` / ``duration_seconds`` but ``part4.CallLog`` stores
    # them as ``kind`` / ``duration`` with enums. We expose BOTH the
    # legacy names (read-only aliases via ``source=``) and the canonical
    # part4 names so an incremental FE migration never breaks.
    call_type = serializers.CharField(source='kind', read_only=True)
    duration_seconds = serializers.IntegerField(source='duration', read_only=True, default=0)

    class Meta:
        model = CallLog
        fields = [
            'id', 'caller', 'caller_username', 'caller_avatar',
            'callee', 'callee_username', 'callee_avatar',
            'thread', 'call_type', 'kind', 'status',
            'started_at', 'ended_at', 'duration', 'duration_seconds',
        ]

    def get_caller_avatar(self, obj):
        if hasattr(obj.caller, 'profile') and obj.caller.profile.avatar:
            return obj.caller.profile.avatar
        return None

    def get_callee_avatar(self, obj):
        if hasattr(obj.callee, 'profile') and obj.callee.profile.avatar:
            return obj.callee.profile.avatar
        return None
