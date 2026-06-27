from django.shortcuts import get_object_or_404
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from ..models import LiveRoom
from ..serializers import LiveRoomSerializer


class LiveRoomViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        rooms = LiveRoom.objects.filter(host=request.user).order_by('-last_seen_at')[:12]
        return Response(LiveRoomSerializer(rooms, many=True).data)

    @action(detail=False, methods=['get'])
    def mine(self, request):
        rooms = LiveRoom.objects.filter(host=request.user).order_by('-last_seen_at')[:12]
        return Response(LiveRoomSerializer(rooms, many=True).data)

    @action(detail=False, methods=['get'])
    def active(self, request):
        rooms = LiveRoom.objects.filter(is_active=True).order_by('-last_seen_at')[:20]
        return Response(LiveRoomSerializer(rooms, many=True).data)

    @action(detail=False, methods=['post'])
    def sync(self, request):
        room_id = (request.data.get('room_id') or '').strip().lower()
        public_code = (request.data.get('public_code') or room_id).strip().lower()
        private_host_key = (request.data.get('private_host_key') or '').strip()
        title = (request.data.get('title') or room_id).strip()
        if not room_id:
            return Response({'error': 'room_id required'}, status=status.HTTP_400_BAD_REQUEST)

        room, _ = LiveRoom.objects.update_or_create(
            room_id=room_id,
            defaults={
                'title': title or room_id,
                'host': request.user,
                'public_code': public_code or room_id,
                'private_host_key': private_host_key or None,
                'is_active': bool(request.data.get('is_active', True)),
                'mode': request.data.get('mode', 'video'),
                'theme': request.data.get('theme', 'neon'),
                'pinned_message': request.data.get('pinned_message', ''),
                'last_url': request.data.get('last_url', ''),
                'participant_count': int(request.data.get('participant_count') or 0),
            }
        )
        room.last_url = request.data.get('share_url', room.last_url) or room.last_url
        room.save(update_fields=['last_url', 'last_seen_at'])
        return Response(LiveRoomSerializer(room).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def restore(self, request):
        private_host_key = (request.data.get('private_host_key') or '').strip()
        if not private_host_key:
            return Response({'error': 'private_host_key required'}, status=status.HTTP_400_BAD_REQUEST)
        room = get_object_or_404(LiveRoom, private_host_key=private_host_key, host=request.user)
        return Response(LiveRoomSerializer(room).data)

    @action(detail=False, methods=['post'])
    def resolve(self, request):
        public_code = (request.data.get('public_code') or '').strip().lower()
        if not public_code:
            return Response({'error': 'public_code required'}, status=status.HTTP_400_BAD_REQUEST)
        room = get_object_or_404(LiveRoom, public_code=public_code)
        return Response(LiveRoomSerializer(room).data)

    @action(detail=True, methods=['patch'])
    def state(self, request, pk=None):
        room = get_object_or_404(LiveRoom, room_id=pk, host=request.user)
        room.is_active = bool(request.data.get('is_active', room.is_active))
        room.mode = request.data.get('mode', room.mode)
        room.theme = request.data.get('theme', room.theme)
        room.pinned_message = request.data.get('pinned_message', room.pinned_message)
        room.last_url = request.data.get('last_url', room.last_url)
        if 'public_code' in request.data:
            room.public_code = (request.data.get('public_code') or room.public_code) or room.room_id
        if 'private_host_key' in request.data and request.data.get('private_host_key'):
            room.private_host_key = request.data.get('private_host_key')
        if 'participant_count' in request.data:
            room.participant_count = int(request.data.get('participant_count') or 0)
        room.save()
        return Response(LiveRoomSerializer(room).data)
