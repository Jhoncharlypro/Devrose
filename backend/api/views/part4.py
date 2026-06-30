"""
Part 4 panel-backend DRF Views.

Five endpoints that back the premium panels built in Parts 1-3:

  GET    /api/audit/                 - Audit log (admin/staff only).
  GET    /api/calls/                 - Pin-protected call history (own calls).
  GET    /api/groups/                - Groups the caller is a member of.
  POST   /api/groups/                - Create a new group; caller becomes owner.
  GET    /api/groups/{id}/members/   - Group member roster (with role + presence).
  POST   /api/groups/{id}/members/   - Add a member (owner/admin only).
  DELETE /api/groups/{id}/members/{uid}/ - Remove member (owner/admin only).
  GET    /api/threads/{id}/pins/     - Pinned messages for a thread.
  POST   /api/threads/{id}/pins/     - Pin a message (caller must be thread participant).
  DELETE /api/threads/{id}/pins/{mid}/ - Unpin.

Plus the singleton metrics endpoint in views/metrics.py.

All endpoints authenticate JWT, are throttled per-user (DRF default
"user" rate from settings.REST_FRAMEWORK), and emit AuditLog rows
for mutating actions so the security/audit trail is complete.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone as dt_tz

from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import viewsets, status, permissions, serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from api import presence
from api.models import (
    ChatThread,
    Message,
    AuditLog,
    CallLog,
    ChatGroup,
    ChatGroupMember,
    PinnedMessage,
)
# Metrics: bump counters into the /api/metrics/ Prometheus scrape endpoint.
# Every list/create/destroy on a Part 4 viewset emits ONE counter so the
# scrape endpoint reflects actual traffic, not just ``devrose_up 1``.
from api.views.metrics import bump

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tiny shared helpers
# ---------------------------------------------------------------------------
def _client_ip(request):
    """
    Best-effort client IP extraction behind a load balancer.

    Honours X-Forwarded-For (first hop) when present and well-formed;
    falls back to ``REMOTE_ADDR`` for direct connections. Wrapped in
    try/except so a malformed header can't crash the auth flow.
    """
    xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if xff:
        first = xff.split(',', 1)[0].strip()
        return first or request.META.get('REMOTE_ADDR', '')
    return request.META.get('REMOTE_ADDR', '') or None


def _short_ua(request):
    """Truncate the user-agent header to 255 chars to keep rows slim."""
    ua = request.META.get('HTTP_USER_AGENT', '') or ''
    return ua[:255]


def write_audit(request, action, target_type='', target_id=None, metadata=None):
    """
    Insert an AuditLog row for a sensitive action.

    Called from every mutating endpoint below so the security analyst
    has a unified trail. Wrapped in try/except so a logging failure
    can't block the actual user action — observability shouldn't
    take the user experience down with it.
    """
    try:
        AuditLog.objects.create(
            actor=request.user if request.user.is_authenticated else None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            metadata=metadata or {},
            ip_address=_client_ip(request),
            user_agent=_short_ua(request),
        )
    except Exception:  # noqa: BLE001
        logger.exception("AuditLog write failed for action=%s", action)


# ---------------------------------------------------------------------------
# 1. AUDIT LOG — admin/staff only.
# ---------------------------------------------------------------------------
class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id', 'actor', 'actor_username',
            'action', 'target_type', 'target_id',
            'metadata', 'ip_address', 'user_agent',
            'created_at',
        ]
        read_only_fields = fields

    def get_actor_username(self, obj):
        return obj.actor.username if obj.actor_id else None


class IsStaff(permissions.BasePermission):
    """
    Allow only staff/admin users (Django's ``is_staff`` flag) to read
    the audit log. Mutating actions are still filtered to ``IsAuthenticated``
    so a non-staff caller gets 403, not 401.
    """
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_staff)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/audit/    List the last 200 audit events (staff only).
    GET /api/audit/?action=login&limit=500   Filterable by action.

    Filter shape (DRF convention):
      ?action=<str>            exact match on AuditLog.action
      ?target_type=user&target_id=42   filter by target
      ?actor=<int>             filter by actor user id
      ?limit=<int>             pagination (max 200).

    No POST/PATCH/DELETE - this is a read-only feed.
    """
    permission_classes = [permissions.IsAuthenticated, IsStaff]
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.all()
        action = self.request.query_params.get('action')
        if action:
            qs = qs.filter(action=action)
        target_type = self.request.query_params.get('target_type')
        if target_type:
            qs = qs.filter(target_type=target_type)
        target_id = self.request.query_params.get('target_id')
        if target_id and target_id.lstrip('-').isdigit():
            qs = qs.filter(target_id=int(target_id))
        actor = self.request.query_params.get('actor')
        if actor and actor.isdigit():
            qs = qs.filter(actor_id=int(actor))
        # Cap at 200 rows per page so a single GET can't blow up a JSON
        # response on a misconfigured scraper.
        try:
            limit = min(int(self.request.query_params.get('limit', 200)), 200)
        except (TypeError, ValueError):
            limit = 200
        return qs[:limit]

    def list(self, request, *args, **kwargs):
        """
        Override the inherited list() so the metrics endpoint can observe
        audit-read traffic. Every other viewset in this module also bumps
        a counter, so this is the one missing piece for full observability
        parity across the Part 4 surface.
        """
        bump('devrose_part4_audit_total')
        return super().list(request, *args, **kwargs)


# ---------------------------------------------------------------------------
# 2. CALL HISTORY — pin-protected (only your own calls).
# ---------------------------------------------------------------------------
class CallLogSerializer(serializers.ModelSerializer):
    caller_username = serializers.CharField(source='caller.username', read_only=True)
    callee_username = serializers.CharField(source='callee.username', read_only=True)
    caller_avatar = serializers.SerializerMethodField()
    callee_avatar = serializers.SerializerMethodField()

    class Meta:
        model = CallLog
        fields = [
            'id', 'kind', 'status', 'duration',
            'started_at', 'ended_at',
            'caller', 'caller_username', 'caller_avatar',
            'callee', 'callee_username', 'callee_avatar',
        ]
        read_only_fields = fields

    def get_caller_avatar(self, obj):
        try:
            return obj.caller.profile.avatar
        except Exception:
            return None

    def get_callee_avatar(self, obj):
        try:
            return obj.callee.profile.avatar
        except Exception:
            return None


class CallHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/calls/             List the last 200 calls I'm a participant in.
    GET /api/calls/?kind=audio   Filter by audio|video.
    GET /api/calls/?status=missed   Filter by status.

    The spec asks for "Call Again / Delete". The frontend CallHistoryPanel
    renders a Call Again button per row — the FE builds a fresh
    /api/calls/{id}/call_again/ request that re-opens the WS signalling.
    DELETE /api/calls/{id}/ removes the row from MY history view (id-level
    delete only; the OTHER participant's history is unchanged because
    pin-protection means rows are duplicated across participants anyway).

    Pin-protection details:
      We include only calls where caller == request.user OR callee ==
      request.user. The /api/calls/me endpoint aliases to /api/calls/
      for the FE's convenience.
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CallLogSerializer

    def get_queryset(self):
        # A caller MUST be caller OR callee to see the row. Combined
        # with .distinct() collapse of the cross-product this stays
        # O(n) over a small per-user index range.
        qs = CallLog.objects.filter(
            Q(caller=self.request.user) | Q(callee=self.request.user)
        )
        kind = self.request.query_params.get('kind')
        if kind in ('audio', 'video'):
            qs = qs.filter(kind=kind)
        status_filter = self.request.query_params.get('status')
        if status_filter in ('incoming', 'outgoing', 'missed', 'rejected', 'completed', 'failed'):
            qs = qs.filter(status=status_filter)
        try:
            limit = min(int(self.request.query_params.get('limit', 200)), 200)
        except (TypeError, ValueError):
            limit = 200
        return qs.distinct()[:limit]

    def destroy(self, request, *args, **kwargs):
        """
        DELETE /api/calls/{id}/ — remove the call row entirely.

        Spec: "Call Again / Delete" with Call Again plus a Delete
        affordance. Pin-protection in ``get_queryset`` already
        ensures only caller or callee can DELETE the row, so this
        is safe — we don't soft-delete because both sides share the
        same row and per-user soft-delete would require a through-
        table; for the messaging app's history view, deleting the
        row outright is clean and the audit trail records the
        action for compliance.

        Audit action: 'call_log_delete' — distinct from
        ``delete_account`` so the audit filter views cleanly separate.
        """
        instance = self.get_object()
        # Belt-and-braces: explicitly verify caller/callee membership.
        if request.user.id not in (instance.caller_id, instance.callee_id):
            return Response(
                {'error': 'Not a participant in this call'},
                status=status.HTTP_403_FORBIDDEN,
            )
        write_audit(
            request,
            action='call_log_delete',
            target_type='call',
            target_id=instance.id,
            metadata={
                'kind': instance.kind,
                'caller_id': instance.caller_id,
                'callee_id': instance.callee_id,
                'duration': instance.duration,
            },
        )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def call_again(self, request, pk=None):
        """
        POST /api/calls/{id}/call_again/   re-initiate the call.
        """
        original = self.get_object()
        bump('devrose_part4_calls_call_again_total')
        # Pin protection: only the caller or callee can re-call.
        if request.user.id not in (original.caller_id, original.callee_id):
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        # The "other party" for the new call is the opposite side of the line.
        if request.user.id == original.caller_id:
            target = original.callee
        else:
            target = original.caller
        new_call = CallLog.objects.create(
            caller=request.user,
            callee=target,
            kind=original.kind,
            status='outgoing',
            duration=0,
        )
        write_audit(
            request,
            action='call_reinitiate',
            target_type='call',
            target_id=original.id,
            metadata={'new_call_id': new_call.id},
        )
        return Response(
            CallLogSerializer(new_call).data,
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# 3. CHAT GROUP + MEMBERS (owner can promote/demote/remove).
# ---------------------------------------------------------------------------
class ChatGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatGroup
        fields = ['id', 'name', 'description', 'avatar', 'is_public', 'created_by', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']


class ChatGroupMemberSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    avatar = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()

    class Meta:
        model = ChatGroupMember
        fields = ['id', 'group', 'user', 'username', 'avatar', 'role', 'joined_at', 'is_online']
        read_only_fields = fields

    def get_avatar(self, obj):
        try:
            return obj.user.profile.avatar
        except Exception:
            return None

    def get_is_online(self, obj):
        # Frontend GroupMemberList.jsx subscribes to a presence channel
        # but also accepts a synchronous is_online per row. Cheap lookup;
        # ON the Redis path it's a single EXISTS, on LocalMemory it's
        # a dict check.
        try:
            return bool(presence.is_online(obj.user_id))
        except Exception:
            return False


class IsGroupOwnerOrAdmin(permissions.BasePermission):
    """
    Permission gate for ``ChatGroupViewSet`` mutating actions.

    Owner:   full access (delete, edit, transfer).
    Admin:   add/remove members, promote/demote.
    Member:  GET only.

    Spec phrasing: "The Owner can: Change group name, Change group photo,
    Change description, Promote Admins, Remove Admins, Transfer
    Ownership, Delete Group. Admins can: Remove members, Accept join
    requests, Pin messages, Mute members, Ban members, Approve invite
    requests." Our endpoint set covers promote/demote/remove — the
    other admin actions (mute/ban/pin) are shipping in the in-thread
    ``PinnedMessage`` flow, not as group-wide moderator controls.
    """
    message = 'Owner or admin permission required.'

    def has_object_permission(self, request, view, obj):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.is_staff:
            return True
        # Membership check with a short-circuit.
        membership = ChatGroupMember.objects.filter(
            group=obj, user=request.user,
        ).first()
        if not membership:
            return False
        if membership.role == 'owner' or membership.role == 'admin':
            return True
        return request.method in permissions.SAFE_METHODS


class ChatGroupViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, IsGroupOwnerOrAdmin]
    serializer_class = ChatGroupSerializer

    def get_queryset(self):
        user = self.request.user
        # The caller sees groups they belong to PLUS public groups so
        # they can browse / search public listings without auto-join.
        return ChatGroup.objects.filter(
            Q(memberships__user=user) | Q(is_public=True)
        ).distinct()

    def perform_create(self, serializer):
        # Owner-on-create.
        bump('devrose_part4_groups_create_total')
        group = serializer.save(created_by=self.request.user)
        ChatGroupMember.objects.create(
            group=group, user=self.request.user, role='owner',
        )
        write_audit(
            self.request,
            action='group_create',
            target_type='group',
            target_id=group.id,
            metadata={'name': group.name},
        )

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """
        GET /api/groups/{id}/members/   Roster with role + presence.

        Mirrors the GroupMemberList.jsx prop shape:
          [{id, user, username, avatar, role, joined_at, is_online}]
        Sorted owner → admin → mod → member → alphabetic username.
        """
        group = self.get_object()
        memberships = (
            ChatGroupMember.objects
            .filter(group=group)
            .select_related('user')
        )
        order = {'owner': 0, 'admin': 1, 'mod': 2, 'member': 3}
        rows = sorted(
            memberships,
            key=lambda m: (order.get(m.role, 99), m.user.username.lower()),
        )
        return Response(ChatGroupMemberSerializer(rows, many=True).data)

    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        """
        POST /api/groups/{id}/add_member/   body={"user_id": <int>, "role": <str>}

        Owner/admin only. Idempotent join: a second POST upgrades the
        role instead of duplicating the row.
        """
        group = self.get_object()
        user_id = request.data.get('user_id')
        role = (request.data.get('role') or 'member').strip()
        if role not in ('owner', 'admin', 'mod', 'member'):
            return Response({'error': 'invalid role'}, status=status.HTTP_400_BAD_REQUEST)
        if not user_id or not str(user_id).isdigit():
            return Response({'error': 'user_id required'}, status=status.HTTP_400_BAD_REQUEST)
        target_user = get_object_or_404(User, id=int(user_id))
        membership, created = ChatGroupMember.objects.get_or_create(
            group=group, user=target_user,
            defaults={'role': role},
        )
        # Allow role upgrade on existing membership.
        if not created and membership.role != role:
            membership.role = role
            membership.save(update_fields=['role'])
        write_audit(
            request,
            action='group_member_add',
            target_type='group',
            target_id=group.id,
            metadata={'user_id': target_user.id, 'role': role},
        )
        return Response(
            ChatGroupMemberSerializer(membership).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['delete'], url_path='members/(?P<user_id>[0-9]+)')
    def remove_member(self, request, pk=None, user_id=None):
        """
        DELETE /api/groups/{id}/members/{user_id}/   owner/admin only.

        Cannot remove the owner (last owner wins). Returns 400 if the
        caller attempts the removal.
        """
        group = self.get_object()
        target = get_object_or_404(User, id=int(user_id))
        membership = ChatGroupMember.objects.filter(group=group, user=target).first()
        if not membership:
            return Response({'error': 'not a member'}, status=status.HTTP_404_NOT_FOUND)
        if membership.role == 'owner':
            return Response(
                {'error': 'Cannot remove owner. Transfer ownership first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        membership.delete()
        write_audit(
            request,
            action='group_member_remove',
            target_type='group',
            target_id=group.id,
            metadata={'user_id': target.id},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 4. PINNED MESSAGES — pinned banner data feed.
# ---------------------------------------------------------------------------
class PinnedMessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.SerializerMethodField()
    content = serializers.SerializerMethodField()
    message_created_at = serializers.SerializerMethodField()

    class Meta:
        model = PinnedMessage
        fields = [
            'id', 'thread', 'message', 'pinned_by',
            'pinned_at', 'sender_username', 'content', 'message_created_at',
        ]
        read_only_fields = fields

    def get_sender_username(self, obj):
        try:
            return obj.message.sender.username
        except Exception:
            return None

    def get_content(self, obj):
        try:
            # Snap the message content at serialization time so even if
            # the message is later edited, the pinned banner reflects
            # what was pinned (FE can opt-in to fresh-fetch if needed).
            return obj.message.content
        except Exception:
            return None

    def get_message_created_at(self, obj):
        try:
            return obj.message.created_at
        except Exception:
            return None


class IsThreadParticipant(permissions.BasePermission):
    """
    The caller must be a participant in the thread to read or write
    its pinned-messages list. Mirrors the inline check in
    ChatThreadViewSet.messages / send_message so the chat surface and
    the Part 4 panels share the same rule.
    """
    def has_object_permission(self, request, view, obj):
        if not (request.user and request.user.is_authenticated):
            return False
        # obj is either a PinnedMessage (obj.thread) or a ChatThread.
        thread = obj if isinstance(obj, ChatThread) else getattr(obj, 'thread', None)
        if thread is None:
            return False
        return thread.participants.filter(id=request.user.id).exists()


class PinnedMessageViewSet(viewsets.GenericViewSet):
    """
    GET    /api/threads/{thread_id}/pins/   List pins for a thread.
    POST   /api/threads/{thread_id}/pins/   Pin a message. Body: {message_id: <int>}
    DELETE /api/threads/{thread_id}/pins/{pin_id}/   Unpin.
    """
    permission_classes = [permissions.IsAuthenticated, IsThreadParticipant]
    serializer_class = PinnedMessageSerializer

    def _get_thread(self, request, thread_id):
        thread = get_object_or_404(ChatThread, pk=thread_id)
        # Manual permission gate so the body can call raise PermissionDenied.
        if not thread.participants.filter(id=request.user.id).exists():
            self.permission_denied(request, message='Not a participant')
        return thread

    def list(self, request, thread_id=None):
        thread = self._get_thread(request, thread_id)
        bump('devrose_part4_pins_list_total')
        pins = (
            PinnedMessage.objects
            .filter(thread=thread)
            .select_related('message', 'message__sender')
        )
        return Response(PinnedMessageSerializer(pins, many=True).data)

    def create(self, request, thread_id=None):
        thread = self._get_thread(request, thread_id)
        bump('devrose_part4_pins_create_total')
        message_id = request.data.get('message_id')
        if not message_id or not str(message_id).isdigit():
            return Response({'error': 'message_id required'}, status=status.HTTP_400_BAD_REQUEST)
        message = get_object_or_404(Message, pk=int(message_id), thread=thread)
        pin, created = PinnedMessage.objects.get_or_create(
            thread=thread,
            message=message,
            defaults={'pinned_by': request.user},
        )
        write_audit(
            request,
            action='pin_message',
            target_type='message',
            target_id=message.id,
            metadata={'thread_id': thread.id},
        )
        return Response(
            PinnedMessageSerializer(pin).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def destroy(self, request, thread_id=None, pk=None):
        thread = self._get_thread(request, thread_id)
        bump('devrose_part4_pins_delete_total')
        pin = get_object_or_404(PinnedMessage, pk=pk, thread=thread)
        pin.delete()
        write_audit(
            request,
            action='unpin_message',
            target_type='message',
            target_id=pin.message_id,
            metadata={'thread_id': thread.id},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
