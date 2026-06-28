from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from ..models import ChatThread, Message, UserStory
from ..serializers import ChatThreadSerializer, MessageSerializer, UserMiniSerializer
from .profile import get_block_or_mute_user_ids
from django.db.models import Q
from datetime import timedelta
from django.utils import timezone

# Note: a previous ``IsParticipant`` permission class lived here but was
# never wired into any ViewSet's ``permission_classes``. The chat surface
# already enforces participant checks inline (e.g.
# ``ChatThreadViewSet.messages`` / ``mark_read`` / ``send_message`` all
# short-circuit non-participants with a 403). Keeping the inline guard
# here is clearer than a permission class because callers see exactly
# which action rejected them.

class ChatThreadViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        # Step 1 (chat module hardening): exclude threads whose other
        # participant is blocked/muted, so blocked users vanish from the
        # sidebar. We reuse the helper in views/profile.py so the rule
        # stays single-sourced across chat + search + user-list callers.
        # .distinct() collapses the M2M-Cartesian-product that the
        # ``exclude(participants__id__in=…)`` lookup produces (otherwise
        # each blocked 1-on-1 thread can show up N times where N is the
        # number of participants).
        exclude_ids = get_block_or_mute_user_ids(request.user)
        qs = ChatThread.objects.filter(participants=request.user)
        if exclude_ids:
            # ``exclude(participants__id__in=...)`` JOINs the M2M through
            # table and produces one row per (thread, participant) pair,
            # so chain .distinct() to collapse the cartesian product.
            qs = qs.exclude(participants__id__in=exclude_ids).distinct()
        # Pre-aggregate the most-recent Message id per thread via a
        # Subquery annotation so ``ChatThreadSerializer.get_last_message``
        # finds each thread's newest message via ``real_last_message``
        # WITHOUT loading the thread's full message history. A naive
        # ``Prefetch('messages', ..., to_attr=...)`` would materialize
        # every Message of every thread into Python — fine for
        # prototypes, catastrophic at scale (1k+ rows / active thread).
        from django.db.models import OuterRef, Subquery
        from ..models import Message
        last_ids_sq = (
            Message.objects
            .filter(thread=OuterRef('pk'))
            .order_by('-created_at')
            .values('id')[:1]
        )
        qs = qs.annotate(_annotated_last_message_id=Subquery(last_ids_sq))
        threads = list(qs)
        last_ids = [t._annotated_last_message_id for t in threads if t._annotated_last_message_id]
        # One bulk SELECT (with sender/thread joins) instead of N inner
        # ``.values('sender')`` lookups inside the serializer.
        last_msgs = {
            m.id: m for m in Message.objects
            .filter(id__in=last_ids)
            .select_related('sender', 'thread')
        }
        for t in threads:
            t.real_last_message = last_msgs.get(t._annotated_last_message_id)
        serializer = ChatThreadSerializer(
            threads, many=True, context={'request': request}
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
        serializer = ChatThreadSerializer(thread, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        thread = get_object_or_404(ChatThread, pk=pk)
        if request.user not in thread.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        messages = list(thread.messages.order_by('-created_at')[:100])
        # Pre-aggregate the MessageReaction rows ONCE so the inner
        # ``MessageSerializer.get_reactions`` / ``get_my_reactions`` can
        # read from ``context`` instead of issuing N+1 SELECTs (one per
        # message). Falls back gracefully when no request is attached.
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
        reply_to_id = request.data.get('reply_to_id')

        if not content and not audio and not image:
            return Response({'error': 'Content, audio or image required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            reply_to = Message.objects.get(id=int(reply_to_id)) if reply_to_id and str(reply_to_id).isdigit() else None
        except (Message.DoesNotExist, ValueError):
            reply_to = None

        # Migrate any base64 payloads to Supabase Storage URLs BEFORE
        # save. ``storage_utils.ensure_url`` returns a structured
        # ``Media`` so the response can honestly tell the operator
        # whether the upload succeeded, whether we kept a fallback
        # base64 (env-unset / decode / oversize / network error), or
        # whether we passed through an already-http URL.
        from api import storage_utils
        image_result = storage_utils.ensure_url(request.user, 'image', image)
        audio_result = storage_utils.ensure_url(request.user, 'audio', audio)
        image = image_result.value
        audio = audio_result.value
        any_fallback = image_result.fallback or audio_result.fallback

        message = Message.objects.create(
            thread=thread,
            sender=request.user,
            content=content,
            audio=audio,
            image=image,
            reply_to=reply_to,
        )

        thread.updated_at = message.created_at
        thread.save(update_fields=['updated_at'])

        # Broadcast via Channels layer for real-time delivery
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from ..serializers import MessageSerializer as MsgSerializer

        msg_data = MsgSerializer(message).data

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

            # Send notification to other user (without heavy image payload)
            notification_payload = {**msg_data}
            if message.audio:
                notification_payload['audio'] = ''
                notification_payload['audio_pending'] = True

            async_to_sync(channel_layer.group_send)(
                f'kot3_user_{other_user.id}',
                {
                    'type': 'new_message_notification',
                    'thread_id': thread.id,
                    'message': notification_payload,
                    'other_user': other_data
                }
            )

        # Send full message to thread room
        async_to_sync(channel_layer.group_send)(
            f'kot3_thread_{thread.id}',
            {
                'type': 'new_message',
                'thread_id': thread.id,
                'message': msg_data
            }
        )

        response = Response(msg_data, status=status.HTTP_201_CREATED)
        if any_fallback:
            # Honest signal: ``ensure_url`` kept base64 in DB because
            # the upload was skipped or failed. Operators can grep
            # response logs for this header; FE can render a "pending
            # migration" indicator.
            reasons = []
            if image_result.fallback:
                reasons.append(f'image={image_result.reason}')
            if audio_result.fallback:
                reasons.append(f'audio={audio_result.reason}')
            response['X-Devrose-Storage-Fallback'] = 'base64'
            response.data = {
                **response.data,
                '__storage_warning': 'kept_as_base64',
                '__storage_reasons': reasons,
            }
        return response

class UserListViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        # Hide anyone I've blocked, anyone who has blocked me, and anyone
        # I've muted (until mute_until expires). One bulk lookup keeps it
        # O(1) queries; see ``get_block_or_mute_user_ids``.
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
        # MED (chat module hardening): also exclude threads whose other
        # participant is blocked/muted, mirroring ChatThreadViewSet.list
        # so a global search can't surface a blocked user's thread even
        # when the user retypes that contact's name.
        if search_exclude_ids:
            thread_qs = thread_qs.exclude(participants__id__in=search_exclude_ids)
        thread_qs = thread_qs.distinct()

        message_qs = Message.objects.filter(
            thread__participants=request.user,
            content__icontains=query
        ).select_related('thread', 'sender')[:20]

        time_threshold = timezone.now() - timedelta(hours=24)
        story_qs = UserStory.objects.filter(
            user__chat_threads__participants=request.user,
            created_at__gte=time_threshold
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
                'created_at': story.created_at.isoformat()
            } for story in story_qs]
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
            'created_at': story.created_at.isoformat()
        } for story in stories])

    def create(self, request):
        story_type = request.data.get('story_type', 'text')
        content = request.data.get('content', '')
        background = request.data.get('background', '')
        if not content:
            return Response({'error': 'content required'}, status=status.HTTP_400_BAD_REQUEST)
        # Image-type stories carry a DataURL in ``content``; route through
        # the chat-images bucket so the consumer cell can serve them from
        # the public CDN instead of inlining ~MB of base64.
        image_result = None
        if story_type == 'image':
            from api import storage_utils
            image_result = storage_utils.ensure_url(request.user, 'image', content)
            content = image_result.value
        story = UserStory.objects.create(
            user=request.user,
            type=story_type,
            content=content,
            background=background
        )
        payload = {
            'id': story.id,
            'user_id': request.user.id,
            'username': request.user.username,
            'type': story.type,
            'content': story.content,
            'background': story.background,
            'created_at': story.created_at.isoformat()
        }
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)('kot3_presence', {'type': 'story_broadcast', 'story': payload})
        response = Response(payload, status=status.HTTP_201_CREATED)
        if image_result and image_result.fallback:
            response['X-Devrose-Storage-Fallback'] = 'base64'
            response.data = {
                **response.data,
                '__storage_warning': 'kept_as_base64',
                '__storage_reasons': [f'image={image_result.reason}'],
            }
        return response
