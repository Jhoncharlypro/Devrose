from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from ..models import ChatThread, Message, UserStory
from ..serializers import ChatThreadSerializer, MessageSerializer, UserMiniSerializer
from django.db.models import Q
from datetime import timedelta
from django.utils import timezone

class IsParticipant(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if hasattr(obj, 'participants'):
            return request.user in obj.participants.all()
        return False

class ChatThreadViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        threads = ChatThread.objects.filter(participants=request.user)
        serializer = ChatThreadSerializer(threads, many=True, context={'request': request})
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
        messages = thread.messages.order_by('-created_at')[:100]
        serializer = MessageSerializer(messages, many=True, context={'request': request})
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
            from ..consumers import online_users
            other_data = {
                'id': other_user.id,
                'username': other_user.username,
                'avatar': other_user.profile.avatar if (hasattr(other_user, 'profile') and other_user.profile.avatar) else None,
                'is_online': other_user.id in online_users
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

        return Response(msg_data, status=status.HTTP_201_CREATED)

class UserListViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        users = User.objects.exclude(id=request.user.id)
        serializer = UserMiniSerializer(users, many=True)
        return Response(serializer.data)

class ChatSearchViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def global_search(self, request):
        query = (request.query_params.get('q') or '').strip()
        if not query:
            return Response({'users': [], 'threads': [], 'messages': [], 'stories': []})

        user_qs = User.objects.exclude(id=request.user.id).filter(
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
        ).distinct()

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
        return Response(payload, status=status.HTTP_201_CREATED)
