from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from ..models import ChatThread, Message, UserStory, CallLog, UserThreadSetting
from ..serializers import ChatThreadSerializer, MessageSerializer, UserMiniSerializer, CallLogSerializer
from .profile import get_block_or_mute_user_ids
from django.db.models import Count, OuterRef, Q, Subquery
from datetime import timedelta
from django.utils import timezone


# Note: a previous ``IsParticipant`` permission class lived here but was
# never wired into any ViewSet's ``permission_classes``. The chat surface
# already enforces participant checks inline. Phase 9 adds per-thread
# preference actions + a delete-message action.


class ChatThreadViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        exclude_ids = get_block_or_mute_user_ids(request.user)
        qs = ChatThread.objects.filter(participants=request.user)
        if exclude_ids:
            qs = qs.exclude(participants__id__in=exclude_ids).distinct()
        # Pre-aggregate the most-recent Message id per thread
        last_ids_sq = (
            Message.objects
            .filter(thread=OuterRef('pk'))
            .order_by('-created_at')
            .values('id')[:1]
        )
        qs = qs.annotate(_annotated_last_message_id=Subquery(last_ids_sq))
        threads = list(qs)
        last_ids = [t._annotated_last_message_id for t in threads if t._annotated_last_message_id]
        last_msgs = {
            m.id: m for m in Message.objects
            .filter(id__in=last_ids)
            .select_related('sender', 'thread')
        }
        for t in threads:
            t.real_last_message = last_msgs.get(t._annotated_last_message_id)
        # Bulk-load per-user thread preferences to avoid N+1 on
        # is_pinned/is_archived/is_muted/is_request resolution.
        settings_map = {
            s.thread_id: s for s in UserThreadSetting.objects
            .filter(user=request.user, thread__in=threads)
        }
        # Phase 9: real N+1 prevention for unread count + request flag.
        # Single GROUP BY thread_id count replaces the per-thread .count() calls
        # the serializer fallback would otherwise issue. Results are stashed
        # on each thread as ``_unread_inbound_count`` so the serializer's
        # ``get_unread_count`` AND ``get_is_request`` both read the cache.
        inbound_counts = dict(
            Message.objects
            .filter(thread__in=threads, is_read=False, deleted_at__isnull=True)
            .exclude(sender=request.user)
            .values('thread_id')
            .annotate(c=Count('id'))
            .values_list('thread_id', 'c')
        )
        for t in threads:
            t._unread_inbound_count = inbound_counts.get(t.id, 0)
        serializer = ChatThreadSerializer(
            threads, many=True,
            context={'request': request, 'thread_settings_map': settings_map},
        )
        return Response(serializer.data)

    def create(self, request):
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': 'user_id required'}, status=status.HTTP_400_BAD_REQUEST)
        other_user = get_object_or_404(User, id=user_id)
        if other_user == request.user:
            return Response({'error': 'Cannot chat with yourself'}, status=status.HTTP_400_BAD_REQUEST)
        existing = ChatThread.objects.filter(participants=request.user).filter(participants=other_user).first()
        if existing:
            serializer = ChatThreadSerializer(existing, context={'request': request})
            return Response(serializer.data)
        thread = ChatThread.objects.create()
        thread.participants.add(request.user, other_user)
        serializer = ChatThreadSerializer(thread, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        settings_map = {}
        try:
            settings_map[thread.id] = thread.settings.get(user=request.user)
        except Exception:
            pass
        serializer = ChatThreadSerializer(thread, context={'request': request, 'thread_settings_map': settings_map})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        messages = list(
            thread.messages.filter(deleted_at__isnull=True).order_by('-created_at')[:100]
        )
        from ..serializers.chat import _build_reactions_context
        rxn_ctx = _build_reactions_context(messages, request.user)
        serializer = MessageSerializer(
            messages,
            many=True,
            context={'request': request, **rxn_ctx},
        )
        return Response(serializer.data[::-1])

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        msg_ids = request.data.get('message_ids', [])
        valid_ids = [int(mid) for mid in msg_ids if str(mid).isdigit()]
        if not valid_ids:
            return Response({'updated': 0})
        updated = Message.objects.filter(id__in=valid_ids, thread=thread).exclude(sender=request.user).update(is_read=True)
        return Response({'updated': updated})

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)

        content = request.data.get('content', '')
        audio = request.data.get('audio', '')
        image = request.data.get('image', '')
        document = request.data.get('document', '')
        document_name = request.data.get('document_name', '')
        location_lat = request.data.get('location_lat')
        location_lng = request.data.get('location_lng')
        location_name = request.data.get('location_name', '')
        expires_at = request.data.get('expires_at')
        reply_to_id = request.data.get('reply_to_id')

        if not content and not audio and not image and not document and location_lat is None:
            return Response({'error': 'Content, audio, image, document or location required'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            reply_to = Message.objects.get(id=int(reply_to_id)) if reply_to_id and str(reply_to_id).isdigit() else None
        except (Message.DoesNotExist, ValueError):
            reply_to = None

        from api import storage_utils
        image_result = storage_utils.ensure_url(request.user, 'image', image)
        audio_result = storage_utils.ensure_url(request.user, 'audio', audio)
        document_result = storage_utils.ensure_url(request.user, 'document', document) if document else None
        image = image_result.value
        audio = audio_result.value
        any_fallback = image_result.fallback or audio_result.fallback or (document_result and document_result.fallback)

        # Phase 9 — disappearing messages: parse ISO datetime; null/invalid → no expiry
        from django.utils.dateparse import parse_datetime
        is_ephemeral = False
        parsed_expires = None
        if expires_at:
            parsed_expires = parse_datetime(expires_at) if isinstance(expires_at, str) else None
            if parsed_expires is not None:
                is_ephemeral = True

        message = Message.objects.create(
            thread=thread,
            sender=request.user,
            content=content,
            audio=audio,
            image=image,
            document=document_result.value if document_result else '',
            document_name=document_name if document_result else '',
            location_lat=location_lat if location_lat is not None else None,
            location_lng=location_lng if location_lng is not None else None,
            location_name=location_name if location_lat is not None else '',
            expires_at=parsed_expires,
            is_ephemeral=is_ephemeral,
            reply_to=reply_to,
        )

        thread.updated_at = message.created_at
        thread.save(update_fields=['updated_at'])

        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        msg_data = MessageSerializer(message).data
        channel_layer = get_channel_layer()
        other_user = thread.participants.exclude(id=request.user.id).first()
        other_data = None
        if other_user:
            from .. import presence
            other_data = {
                'id': other_user.id,
                'username': other_user.username,
                'avatar': other_user.profile.avatar if (hasattr(other_user, 'profile') and other_user.profile.avatar) else None,
                'is_online': presence.is_online(other_user.id),
            }
            notification_payload = {**msg_data}
            if message.audio:
                notification_payload['audio'] = ''
                notification_payload['audio_pending'] = True
            if message.document:
                notification_payload['document'] = ''
            async_to_sync(channel_layer.group_send)(
                f'kot3_user_{other_user.id}',
                {
                    'type': 'new_message_notification',
                    'thread_id': thread.id,
                    'message': notification_payload,
                    'other_user': other_data,
                },
            )
        async_to_sync(channel_layer.group_send)(
            f'kot3_thread_{thread.id}',
            {'type': 'new_message', 'thread_id': thread.id, 'message': msg_data},
        )
        response = Response(msg_data, status=status.HTTP_201_CREATED)
        if any_fallback:
            reasons = []
            if image_result.fallback:
                reasons.append(f'image={image_result.reason}')
            if audio_result.fallback:
                reasons.append(f'audio={audio_result.reason}')
            if document_result and document_result.fallback:
                reasons.append(f'document={document_result.reason}')
            response['X-Devrose-Storage-Fallback'] = 'base64'
            response.data = {
                **response.data,
                '__storage_warning': 'kept_as_base64',
                '__storage_reasons': reasons,
            }
        return response

    # ─────────────────── Phase 9: per-thread lifecycle ───────────────────
    @action(detail=True, methods=['delete'], url_path=r'messages/(?P<message_id>\d+)')
    def delete_message(self, request, pk=None, message_id=None):
        """Soft-delete a message. Sender-only authorization (admins not yet
        wired). Sets ``deleted_at`` + ``deleted_by`` and broadcasts a
        ``message_deleted`` event to the thread group so other devices
        collapse the bubble into a tombstone."""
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(Message, pk=message_id, thread=thread)
        if msg.sender_id != request.user.id:
            return Response({'error': 'Only the author may delete.'}, status=status.HTTP_403_FORBIDDEN)
        if msg.deleted_at:
            return Response({'id': msg.id, 'deleted_at': msg.deleted_at.isoformat(), 'already_deleted': True})
        msg.deleted_at = timezone.now()
        msg.deleted_by = request.user
        msg.save(update_fields=['deleted_at', 'deleted_by'])
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        try:
            async_to_sync(get_channel_layer().group_send)(
                f'kot3_thread_{thread.id}',
                {
                    'type': 'message_deleted',
                    'thread_id': thread.id,
                    'message_id': msg.id,
                    'deleted_by_id': request.user.id,
                    'deleted_at': msg.deleted_at.isoformat(),
                },
            )
        except Exception:
            pass  # WS may be down — REST already persisted the truth.
        return Response({'id': msg.id, 'deleted_at': msg.deleted_at.isoformat()})

    @action(detail=True, methods=['post'])
    def pin(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.is_pinned = True
        s.save(update_fields=['is_pinned', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_pinned': True})
        return Response({'id': thread.id, 'is_pinned': True})

    @action(detail=True, methods=['post'])
    def unpin(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.is_pinned = False
        s.save(update_fields=['is_pinned', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_pinned': False})
        return Response({'id': thread.id, 'is_pinned': False})

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.is_archived = True
        s.save(update_fields=['is_archived', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_archived': True})
        return Response({'id': thread.id, 'is_archived': True})

    @action(detail=True, methods=['post'])
    def unarchive(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.is_archived = False
        s.save(update_fields=['is_archived', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_archived': False})
        return Response({'id': thread.id, 'is_archived': False})

    @action(detail=True, methods=['post'])
    def mute(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        hours = int(request.data.get('duration_hours') or 0)
        hours = max(0, min(hours or 8, 24 * 30))
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.muted_until = timezone.now() + timedelta(hours=hours) if hours else None
        s.save(update_fields=['muted_until', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_muted': bool(s.muted_until)})
        return Response({'id': thread.id, 'is_muted': bool(s.muted_until),
                        'muted_until': s.muted_until.isoformat() if s.muted_until else None})

    @action(detail=True, methods=['post'])
    def unmute(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.muted_until = None
        s.save(update_fields=['muted_until', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_muted': False})
        return Response({'id': thread.id, 'is_muted': False})

    @action(detail=True, methods=['post'])
    def accept_request(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.is_request_ignored = False
        s.save(update_fields=['is_request_ignored', 'updated_at'])
        self._broadcast_thread_setting(thread, request.user, {'is_request': False})
        return Response({'id': thread.id, 'is_request': False})

    @action(detail=True, methods=['post'])
    def ignore_request(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        s, _ = UserThreadSetting.objects.get_or_create(user=request.user, thread=thread)
        s.is_request_ignored = True
        s.save(update_fields=['is_request_ignored', 'updated_at'])
        return Response({'id': thread.id, 'is_request_ignored': True})

    def _broadcast_thread_setting(self, thread, user, updates):
        """Per-user settings — only broadcast back to the same user's other
        devices, never to the OTHER participants (a pinned thread for me
        must not show as pinned for them)."""
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        try:
            async_to_sync(get_channel_layer().group_send)(
                f'kot3_user_{user.id}',
                {
                    'type': 'thread_setting_updated',
                    'thread_id': thread.id,
                    'user_id': user.id,
                    'updates': updates,
                },
            )
        except Exception:
            pass


class UserListViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        exclude_ids = get_block_or_mute_user_ids(request.user)
        users = User.objects.exclude(id__in=exclude_ids).exclude(id=request.user.id)
        serializer = UserMiniSerializer(users, many=True)
        return Response(serializer.data)


class ChatSearchViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def global_search(self, request):
        query = (request.query_params.get('q') or '').strip()
        if not query:
            return Response({'users': [], 'threads': [], 'messages': [], 'stories': []})

        search_exclude_ids = get_block_or_mute_user_ids(request.user)
        user_qs = User.objects.exclude(id=request.user.id).exclude(id__in=search_exclude_ids).filter(
            Q(username__icontains=query) |
            Q(first_name__icontains=query) |
            Q(last_name__icontains=query) |
            Q(profile__bio__icontains=query) |
            Q(profile__status_text__icontains=query)
        ).distinct()

        thread_qs = ChatThread.objects.filter(participants=request.user).filter(
            Q(participants__username__icontains=query) |
            Q(participants__first_name__icontains=query) |
            Q(participants__last_name__icontains=query) |
            Q(messages__content__icontains=query)
        )
        if search_exclude_ids:
            thread_qs = thread_qs.exclude(participants__id__in=search_exclude_ids)
        thread_qs = thread_qs.distinct()

        message_qs = Message.objects.filter(
            thread__participants=request.user, deleted_at__isnull=True,
            content__icontains=query,
        ).select_related('thread', 'sender')[:20]

        time_threshold = timezone.now() - timedelta(hours=24)
        story_qs = UserStory.objects.filter(
            user__chat_threads__participants=request.user,
            created_at__gte=time_threshold,
        ).filter(
            Q(content__icontains=query) |
            Q(user__username__icontains=query) |
            Q(user__first_name__icontains=query) |
            Q(user__last_name__icontains=query)
        ).distinct()[:20]

        return Response({
            'users': UserMiniSerializer(user_qs, many=True).data,
            'threads': ChatThreadSerializer(thread_qs, many=True, context={'request': request}).data,
            'messages': MessageSerializer(message_qs, many=True, context={'request': request}).data,
            'stories': [{
                'id': story.id,
                'user': UserMiniSerializer(story.user).data,
                'type': story.type,
                'content': story.content,
                'background': story.background,
                'created_at': story.created_at.isoformat(),
            } for story in story_qs],
        })


class StoryViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        time_threshold = timezone.now() - timedelta(hours=24)
        stories = UserStory.objects.filter(user=request.user, created_at__gte=time_threshold).order_by('created_at')
        return Response([{
            'id': story.id,
            'type': story.type,
            'content': story.content,
            'background': story.background,
            'created_at': story.created_at.isoformat(),
        } for story in stories])

    def create(self, request):
        story_type = request.data.get('story_type', 'text')
        content = request.data.get('content', '')
        background = request.data.get('background', '')
        if not content:
            return Response({'error': 'content required'}, status=status.HTTP_400_BAD_REQUEST)
        image_result = None
        if story_type == 'image':
            from api import storage_utils
            image_result = storage_utils.ensure_url(request.user, 'image', content)
            content = image_result.value
        story = UserStory.objects.create(
            user=request.user,
            type=story_type,
            content=content,
            background=background,
        )
        payload = {
            'id': story.id,
            'user_id': story.user.id,
            'username': story.user.username,
            'type': story.type,
            'content': story.content,
            'background': story.background,
            'created_at': story.created_at.isoformat(),
        }
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        try:
            async_to_sync(get_channel_layer().group_send)('kot3_presence', {'type': 'story_broadcast', 'story': payload})
        except Exception:
            pass
        response = Response(payload, status=status.HTTP_201_CREATED)
        if image_result and image_result.fallback:
            response['X-Devrose-Storage-Fallback'] = 'base64'
            response.data = {
                **response.data,
                '__storage_warning': 'kept_as_base64',
                '__storage_reasons': [f'image={image_result.reason}'],
            }
        return response


class CallLogViewSet(viewsets.ViewSet):
    """Server-side call history. ``list`` returns the caller's history (inbound +
    outbound) ordered by recency."""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        # Exclude blocked/muted users from the history list.
        exclude_ids = get_block_or_mute_user_ids(request.user)
        qs = CallLog.objects.filter(
            Q(caller=request.user) | Q(callee=request.user)
        ).exclude(
            Q(caller__in=exclude_ids) | Q(callee__in=exclude_ids)
        ).select_related('caller', 'callee', 'thread').order_by('-started_at')[:100]
        return Response(CallLogSerializer(qs, many=True).data)

    def create(self, request):
        """Record a new call attempt on the server. The WS path also creates a
        CallLog on ``call_user``; this REST endpoint is the fallback when
        WS is unreachable and the FE has to persist the ring manually."""
        target_user_id = request.data.get('target_user_id')
        call_type = request.data.get('call_type', 'audio')
        thread_id = request.data.get('thread_id')
        if not target_user_id:
            return Response({'error': 'target_user_id required'}, status=400)
        target_user = get_object_or_404(User, id=target_user_id)
        from ..models import ChatThread
        thread = ChatThread.objects.filter(id=thread_id).first() if thread_id else None
        log = CallLog.objects.create(
            caller=request.user, callee=target_user,
            kind=call_type if call_type in ('audio', 'video') else 'audio',
            status='outgoing', thread=thread, duration=0,
        )
        return Response(CallLogSerializer(log).data, status=201)

    @action(detail=True, methods=['post'])
    def connect(self, request, pk=None):
        """Mark a ringing CallLog as connected (receiver accepted)."""
        log = get_object_or_404(CallLog, pk=pk)
        if request.user.id not in (log.caller_id, log.callee_id):
            return Response({'error': 'Not your call'}, status=403)
        log.status = 'completed'
        log.save(update_fields=['status'])
        return Response(CallLogSerializer(log).data)

    @action(detail=True, methods=['post'])
    def finish(self, request, pk=None):
        """Mark a CallLog done with a duration."""
        log = get_object_or_404(CallLog, pk=pk)
        if request.user.id not in (log.caller_id, log.callee_id):
            return Response({'error': 'Not your call'}, status=403)
        # part4 part4.CallLog uses `duration` (not duration_seconds) and the
        # STATUS_CHOICES enum ('completed'|'missed'|'rejected'|'failed').
        duration = max(0, int(request.data.get('duration_seconds') or 0))
        outcome = request.data.get('outcome', 'completed')
        valid_outcomes = {c[0] for c in CallLog.STATUS_CHOICES}
        log.duration = duration
        # Map 'declined' → 'rejected' (part4 vocabulary).
        log.status = 'rejected' if outcome == 'declined' else (
            outcome if outcome in valid_outcomes else 'completed'
        )
        log.ended_at = timezone.now()
        log.save(update_fields=['status', 'ended_at', 'duration'])
        return Response(CallLogSerializer(log).data)


class ChatPresenceViewSet(viewsets.ViewSet):
    """
    Phase 9 — REST surface for presence.

    The WS path is the live truth, but a freshly-loaded page (or a
    long-idle tab) needs a synchronous answer before the WS even
    opens. ``GET /api/chat/presence/online/`` returns the current
    online set with username + last_seen, so the FE can hydrate the
    "Online" dot state in one round-trip.

    Cost: one Redis SMEMBERS-equivalent + one indexed SELECT — both
    O(1) for a chat-class workload.
    """
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        from .. import presence as _presence
        from django.contrib.auth.models import User
        from asgiref.sync import async_to_sync
        # The sync DRF path can't await the async presence facade.
        # Bridge through async_to_sync (one event-loop round-trip
        # per request, but the local-memory backend doesn't touch
        # the loop, so it's effectively free; the Redis backend
        # reuses the async connection pool).
        try:
            online_set = async_to_sync(_presence.online_user_ids_async)()
        except Exception:
            online_set = set()
        if not online_set:
            return Response({
                'online': {},
                'count': 0,
                'ts': timezone.now().isoformat(),
            })
        rows = User.objects.filter(id__in=online_set).values(
            'id', 'username', 'profile__last_seen',
        )
        out = {
            r['id']: {
                'username': r['username'],
                'last_seen': (
                    r['profile__last_seen'].isoformat()
                    if r['profile__last_seen'] else None
                ),
            }
            for r in rows
        }
        return Response({
            'online': out,
            'count': len(out),
            'ts': timezone.now().isoformat(),
        })
