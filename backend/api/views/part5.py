"""
Part 5 panel-backend DRF Views.

Five ViewSets + a smart-reply / translate / summarize / rewrite /
detect-spam suite under ``views/ai.py`` that back the Part 5 spec
(AI features, scheduled messages, chat folders, premium, anti-spam,
backup).

REST surface added:

  Scheduled messages
    GET    /api/scheduled-messages/                List my pending/failed sends.
    POST   /api/scheduled-messages/                Schedule a new send.
    GET    /api/scheduled-messages/{id}/           Retrieve.
    PATCH  /api/scheduled-messages/{id}/           Edit content / time.
    DELETE /api/scheduled-messages/{id}/           Cancel (status='cancelled').
    POST   /api/scheduled-messages/{id}/send_now/  Promote immediately.

  Chat folders
    GET    /api/folders/                  List my folders (with thread_count).
    POST   /api/folders/                  Create folder.
    GET    /api/folders/{id}/             Retrieve.
    PATCH  /api/folders/{id}/             Rename / recolor / re-order.
    DELETE /api/folders/{id}/             Delete (cascade removes memberships).
    POST   /api/folders/{id}/add_thread/  body={"thread_id": <int>}
    POST   /api/folders/{id}/remove_thread/ body={"thread_id": <int>}

  Premium
    GET    /api/premium/                  My subscription history.
    POST   /api/premium/                  Activate (dev-mode: no payment).
    POST   /api/premium/cancel/           Cancel current active subscription.
    GET    /api/premium/status/           {is_premium, premium_until, plan}.

  Spam reports
    GET    /api/spam-reports/             Staff-only moderation queue.
    POST   /api/spam-reports/             File a report (any user).
    GET    /api/spam-reports/{id}/        Staff-only retrieve.
    PATCH  /api/spam-reports/{id}/        Staff-only resolve.

  Backup
    GET    /api/backups/                  List my past backups.
    POST   /api/backups/                  Create a fresh backup.
    GET    /api/backups/{id}/             Download a specific backup.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta

from django.contrib.auth.models import User
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.http import HttpResponse

from api.models import (
    ChatThread,
    Message,
    Profile,
    SmartReplyCache,
    ScheduledMessage,
    ChatFolder,
    ChatFolderMembership,
    PremiumSubscription,
    SpamReport,
    BackupArchive,
    score_spam,
)
# Part 4 audit writer — keep using the same observability surface.
from api.views.part4 import write_audit, bump
# Promoted-message logic for the ScheduledMessage "send_now" action.
from api.models.part5 import score_spam as _score_spam

logger = logging.getLogger(__name__)


# ===================================================================
# Permissions
# ===================================================================
class IsThreadParticipant(permissions.BasePermission):
    """Caller must be a participant in the target thread (for folder ops)."""

    def has_object_permission(self, request, view, obj):
        if not (request.user and request.user.is_authenticated):
            return False
        # obj is a ChatFolder (we check the owner) OR a ChatThread.
        if isinstance(obj, ChatFolder):
            return obj.user_id == request.user.id
        if isinstance(obj, ChatThread):
            return obj.participants.filter(id=request.user.id).exists()
        return False


class IsStaffOrReadOnly(permissions.BasePermission):
    """Only staff can write spam reports; authenticated users can read their own."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return bool(request.user.is_staff)


# ===================================================================
# 1. SCHEDULED MESSAGE
# ===================================================================
class ScheduledMessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = ScheduledMessage
        fields = [
            'id', 'thread', 'sender', 'sender_username',
            'content', 'audio', 'image', 'reply_to',
            'send_at', 'status', 'promoted_message',
            'created_at', 'updated_at', 'is_overdue',
        ]
        read_only_fields = [
            'id', 'sender', 'status', 'promoted_message',
            'created_at', 'updated_at', 'is_overdue',
        ]

    def get_is_overdue(self, obj):
        return (
            obj.status == 'pending'
            and obj.send_at <= timezone.now()
        )


class ScheduledMessageViewSet(viewsets.ModelViewSet):
    """CRUD on a user's own scheduled (pending) sends."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ScheduledMessageSerializer

    def get_queryset(self):
        return ScheduledMessage.objects.filter(
            sender=self.request.user,
        ).order_by('send_at')

    def perform_create(self, serializer):
        send_at = serializer.validated_data.get('send_at')
        if not send_at or send_at <= timezone.now():
            raise serializers.ValidationError(
                {'send_at': 'send_at must be in the future.'},
            )
        thread = serializer.validated_data.get('thread')
        if not thread.participants.filter(id=self.request.user.id).exists():
            raise serializers.ValidationError(
                {'thread': 'Not a participant in this thread.'},
            )
        schedule = serializer.save(sender=self.request.user)
        write_audit(
            self.request,
            action='schedule_message',
            target_type='scheduled',
            target_id=schedule.id,
            metadata={'send_at': send_at.isoformat()},
        )

    @action(detail=True, methods=['post'])
    def send_now(self, request, pk=None):
        """
        POST /api/scheduled-messages/{id}/send_now/
        Promote the schedule to a real Message immediately.
        """
        schedule = self.get_object()
        if schedule.status != 'pending':
            return Response(
                {'error': f'schedule is {schedule.status}, not pending.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        msg = Message.objects.create(
            thread=schedule.thread,
            sender=schedule.sender,
            content=schedule.content,
            audio=schedule.audio,
            image=schedule.image,
            reply_to=schedule.reply_to,
        )
        schedule.status = 'sent'
        schedule.promoted_message = msg
        schedule.save(update_fields=['status', 'promoted_message', 'updated_at'])
        write_audit(
            request,
            action='schedule_send_now',
            target_type='message',
            target_id=msg.id,
            metadata={'schedule_id': schedule.id},
        )
        return Response(
            {'message_id': msg.id, 'schedule_id': schedule.id},
            status=status.HTTP_201_CREATED,
        )

    def perform_destroy(self, instance):
        # Soft-cancel: keep the row for audit but mark it cancelled.
        instance.status = 'cancelled'
        instance.save(update_fields=['status', 'updated_at'])
        write_audit(
            self.request,
            action='schedule_cancel',
            target_type='scheduled',
            target_id=instance.id,
        )


# ===================================================================
# 2. CHAT FOLDER
# ===================================================================
class ChatFolderSerializer(serializers.ModelSerializer):
    thread_count = serializers.SerializerMethodField()
    thread_ids = serializers.SerializerMethodField()

    class Meta:
        model = ChatFolder
        fields = [
            'id', 'user', 'name', 'color', 'sort_order',
            'created_at', 'updated_at',
            'thread_count', 'thread_ids',
        ]
        read_only_fields = [
            'id', 'user', 'created_at', 'updated_at',
            'thread_count', 'thread_ids',
        ]

    def get_thread_count(self, obj):
        return obj.memberships.count()

    def get_thread_ids(self, obj):
        return list(
            obj.memberships.values_list('thread_id', flat=True)
        )


class ChatFolderViewSet(viewsets.ModelViewSet):
    """User-owned folder that groups threads in the messenger sidebar."""
    permission_classes = [permissions.IsAuthenticated, IsThreadParticipant]
    serializer_class = ChatFolderSerializer

    def get_queryset(self):
        return ChatFolder.objects.filter(
            user=self.request.user,
        ).prefetch_related('memberships').order_by('sort_order', 'name')

    def perform_create(self, serializer):
        folder = serializer.save(user=self.request.user)
        write_audit(
            self.request,
            action='folder_create',
            target_type='folder',
            target_id=folder.id,
            metadata={'name': folder.name},
        )

    def perform_update(self, serializer):
        serializer.save()
        write_audit(
            self.request,
            action='folder_update',
            target_type='folder',
            target_id=serializer.instance.id,
        )

    @action(detail=True, methods=['post'])
    def add_thread(self, request, pk=None):
        """
        POST /api/folders/{id}/add_thread/   body={"thread_id": <int>}
        Idempotent join: a second POST is a no-op.
        """
        folder = self.get_object()
        thread_id = request.data.get('thread_id')
        if not thread_id or not str(thread_id).isdigit():
            return Response(
                {'error': 'thread_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        thread = get_object_or_404(ChatThread, pk=int(thread_id))
        if not thread.participants.filter(id=request.user.id).exists():
            return Response(
                {'error': 'Not a participant in this thread.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        ChatFolderMembership.objects.get_or_create(
            folder=folder, thread=thread,
        )
        write_audit(
            request,
            action='folder_add_thread',
            target_type='folder',
            target_id=folder.id,
            metadata={'thread_id': thread.id},
        )
        return Response(
            {'folder_id': folder.id, 'thread_id': thread.id},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def remove_thread(self, request, pk=None):
        """POST /api/folders/{id}/remove_thread/   body={"thread_id": <int>}"""
        folder = self.get_object()
        thread_id = request.data.get('thread_id')
        if not thread_id or not str(thread_id).isdigit():
            return Response(
                {'error': 'thread_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deleted, _ = ChatFolderMembership.objects.filter(
            folder=folder, thread_id=int(thread_id),
        ).delete()
        write_audit(
            request,
            action='folder_remove_thread',
            target_type='folder',
            target_id=folder.id,
            metadata={'thread_id': int(thread_id), 'removed': bool(deleted)},
        )
        return Response(
            {'folder_id': folder.id, 'thread_id': int(thread_id), 'removed': bool(deleted)},
        )


# ===================================================================
# 3. PREMIUM SUBSCRIPTION
# ===================================================================
class PremiumSubscriptionSerializer(serializers.ModelSerializer):
    is_currently_active = serializers.SerializerMethodField()

    class Meta:
        model = PremiumSubscription
        fields = [
            'id', 'user', 'plan', 'status',
            'started_at', 'expires_at', 'cancelled_at',
            'payment_ref', 'is_currently_active',
        ]
        read_only_fields = fields

    def get_is_currently_active(self, obj):
        return obj.is_currently_active()


class PremiumSubscriptionViewSet(viewsets.ReadOnlyModelViewSet):
    """User's premium subscription history."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = PremiumSubscriptionSerializer

    def get_queryset(self):
        return PremiumSubscription.objects.filter(
            user=self.request.user,
        ).order_by('-started_at')

    @action(detail=False, methods=['get'])
    def status(self, request):
        """
        GET /api/premium/status/  Fast read for the FE.
        Returns: {is_premium, premium_until, plan, badge_visible}
        """
        profile = getattr(request.user, 'profile', None)
        is_premium = bool(
            profile and profile.is_premium
            and profile.premium_until
            and profile.premium_until > timezone.now()
        )
        # Find the most recent active plan for the badge label.
        current = PremiumSubscription.objects.filter(
            user=request.user,
            status='active',
            expires_at__gt=timezone.now(),
        ).order_by('-started_at').first()
        return Response({
            'is_premium': is_premium,
            'premium_until': (
                profile.premium_until.isoformat() if profile and profile.premium_until else None
            ),
            'plan': current.plan if current else None,
            'badge_visible': is_premium,
        })

    @action(detail=False, methods=['post'])
    def cancel(self, request):
        """
        POST /api/premium/cancel/  Cancel current active subscription.
        Premium access continues until expires_at; status flips to 'cancelled'.
        """
        current = PremiumSubscription.objects.filter(
            user=request.user,
            status='active',
            expires_at__gt=timezone.now(),
        ).order_by('-started_at').first()
        if not current:
            return Response(
                {'error': 'No active subscription to cancel.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        current.status = 'cancelled'
        current.cancelled_at = timezone.now()
        current.save(update_fields=['status', 'cancelled_at'])
        # Also clear the Profile flag — caller can re-subscribe anytime.
        profile = getattr(request.user, 'profile', None)
        if profile:
            profile.is_premium = False
            profile.save(update_fields=['is_premium'])
        write_audit(
            request,
            action='premium_cancel',
            target_type='premium',
            target_id=current.id,
        )
        return Response(PremiumSubscriptionSerializer(current).data)

    def create(self, request, *args, **kwargs):
        """
        POST /api/premium/   Dev-mode activation.
        Body: {"plan": "monthly" | "quarterly" | "yearly" | "lifetime",
               "payment_ref": "<optional 4-char ref>"}
        Real Stripe integration would replace this with a webhook handler.
        """
        plan = (request.data.get('plan') or '').strip().lower()
        if plan not in ('monthly', 'quarterly', 'yearly', 'lifetime'):
            return Response(
                {'error': 'plan must be one of: monthly, quarterly, yearly, lifetime.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # 30 days / 90 days / 365 days / 100 years.
        if plan == 'monthly':
            expires_at = timezone.now() + timedelta(days=30)
        elif plan == 'quarterly':
            expires_at = timezone.now() + timedelta(days=90)
        elif plan == 'yearly':
            expires_at = timezone.now() + timedelta(days=365)
        else:
            expires_at = timezone.now() + timedelta(days=365 * 100)

        # Cancel any existing active subscription first.
        PremiumSubscription.objects.filter(
            user=request.user, status='active',
        ).update(status='cancelled', cancelled_at=timezone.now())

        sub = PremiumSubscription.objects.create(
            user=request.user,
            plan=plan,
            status='active',
            expires_at=expires_at,
            payment_ref=(request.data.get('payment_ref') or '')[:40],
        )
        # Flip the Profile flags so middleware / request.user.profile
        # returns is_premium=True during this session without an extra JOIN.
        profile, _ = Profile.objects.get_or_create(user=request.user)
        profile.is_premium = True
        profile.premium_until = expires_at
        profile.save(update_fields=['is_premium', 'premium_until'])
        write_audit(
            request,
            action='premium_activate',
            target_type='premium',
            target_id=sub.id,
            metadata={'plan': plan},
        )
        return Response(
            PremiumSubscriptionSerializer(sub).data,
            status=status.HTTP_201_CREATED,
        )


# ===================================================================
# 4. SPAM REPORT
# ===================================================================
class SpamReportSerializer(serializers.ModelSerializer):
    reporter_username = serializers.CharField(source='reporter.username', read_only=True)
    reported_username = serializers.CharField(source='reported_user.username', read_only=True)

    class Meta:
        model = SpamReport
        fields = [
            'id', 'reporter', 'reporter_username',
            'reported_user', 'reported_username',
            'message', 'reason', 'description',
            'heuristic_score',
            'created_at', 'resolved', 'resolved_at', 'resolution_note',
        ]
        read_only_fields = [
            'id', 'reporter', 'reporter_username', 'reported_username',
            'heuristic_score', 'created_at',
            'resolved', 'resolved_at', 'resolution_note',
        ]


class SpamReportViewSet(viewsets.ModelViewSet):
    """
    File a spam report (any user). Resolve reports (staff only).
    Heuristic scoring happens at send-time; the FE can also surface a
    "Report" button next to a delivered message.
    """
    permission_classes = [permissions.IsAuthenticated, IsStaffOrReadOnly]
    serializer_class = SpamReportSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return SpamReport.objects.all().order_by('-created_at')
        # Non-staff callers see only their own filed reports.
        return SpamReport.objects.filter(reporter=user).order_by('-created_at')

    def create(self, request, *args, **kwargs):
        reason = (request.data.get('reason') or '').strip().lower()
        if reason not in ('spam', 'scam', 'abuse', 'impersonation', 'mass_message', 'other'):
            return Response(
                {'error': 'reason must be one of: spam, scam, abuse, impersonation, mass_message, other.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reported_user_id = request.data.get('reported_user')
        if not reported_user_id or not str(reported_user_id).isdigit():
            return Response(
                {'error': 'reported_user is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if int(reported_user_id) == request.user.id:
            return Response(
                {'error': 'Cannot report yourself.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reported_user = get_object_or_404(User, pk=int(reported_user_id))
        message = None
        heuristic = None
        message_id = request.data.get('message')
        if message_id and str(message_id).isdigit():
            try:
                message = Message.objects.get(pk=int(message_id))
                if message.content:
                    heuristic = score_spam(message.content)
            except Message.DoesNotExist:
                pass
        report = SpamReport.objects.create(
            reporter=request.user,
            reported_user=reported_user,
            message=message,
            reason=reason,
            description=(request.data.get('description') or '')[:1000],
            heuristic_score=heuristic,
        )
        write_audit(
            request,
            action='spam_report',
            target_type='user',
            target_id=reported_user.id,
            metadata={'reason': reason, 'report_id': report.id},
        )
        return Response(
            SpamReportSerializer(report).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        if not request.user.is_staff:
            return Response(
                {'error': 'Only staff can resolve reports.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        report = self.get_object()
        if 'resolved' in request.data and request.data['resolved']:
            report.resolved = True
            report.resolved_at = timezone.now()
            report.resolution_note = (request.data.get('resolution_note') or '')[:255]
            report.save(update_fields=['resolved', 'resolved_at', 'resolution_note'])
            write_audit(
                request,
                action='spam_resolve',
                target_type='spam_report',
                target_id=report.id,
                metadata={'note': report.resolution_note},
            )
        return Response(SpamReportSerializer(report).data)


# ===================================================================
# 5. BACKUP ARCHIVE
# ===================================================================
class BackupArchiveSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupArchive
        fields = [
            'id', 'user', 'payload_hash', 'payload_summary',
            'created_at', 'payload_bytes',
        ]
        read_only_fields = fields


class BackupArchiveViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET    /api/backups/       List my past backups.
    POST   /api/backups/       Create a fresh backup.
    GET    /api/backups/{id}/  Download a specific backup (raw JSON).
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = BackupArchiveSerializer

    def get_queryset(self):
        return BackupArchive.objects.filter(
            user=self.request.user,
        ).order_by('-created_at')

    def create(self, request, *args, **kwargs):
        """
        Create a fresh backup snapshot of the caller's account.

        Includes:
          * profile fields
          * every thread the caller is a participant in
          * every message in those threads (text + metadata; media
            references but NOT inline base64 — that would explode
            the row size)
          * folders + folder memberships
          * blocks + mutes
          * notification_prefs + social_links + interests

        Does NOT include:
          * other users' private profiles
          * deleted messages
          * media bytes (full media restore is a future async job)
          * audit log rows
        """
        user = request.user
        profile = getattr(user, 'profile', None)
        threads = ChatThread.objects.filter(participants=user)
        thread_payload = []
        for thread in threads:
            msgs = thread.messages.order_by('created_at').values(
                'id', 'sender_id', 'content', 'reply_to_id',
                'is_read', 'is_delivered', 'is_edited', 'edited_at',
                'created_at', 'forwarded_from_id', 'forward_sender_name',
                'expires_at', 'is_ephemeral',
            )
            thread_payload.append({
                'id': thread.id,
                'created_at': thread.created_at.isoformat(),
                'updated_at': thread.updated_at.isoformat(),
                'messages': [
                    {**m, 'created_at': m['created_at'].isoformat() if m['created_at'] else None,
                          'edited_at': m['edited_at'].isoformat() if m['edited_at'] else None,
                          'expires_at': m['expires_at'].isoformat() if m['expires_at'] else None}
                    for m in msgs
                ],
            })
        folders = [
            {
                'id': f.id, 'name': f.name, 'color': f.color,
                'sort_order': f.sort_order,
                'thread_ids': list(f.memberships.values_list('thread_id', flat=True)),
            }
            for f in user.chat_folders.all()
        ]
        payload = {
            'version': 1,
            'created_at': timezone.now().isoformat(),
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
            },
            'profile': {
                'bio': profile.bio if profile else '',
                'avatar': bool(profile and profile.avatar),
                'cover_photo': bool(profile and profile.cover_photo),
                'interests': profile.interests if profile else [],
                'social_links': profile.social_links if profile else {},
                'notification_prefs': profile.notification_prefs if profile else {},
                'is_premium': profile.is_premium if profile else False,
                'premium_until': profile.premium_until.isoformat() if profile and profile.premium_until else None,
            } if profile else None,
            'threads': thread_payload,
            'folders': folders,
        }
        body_str = json.dumps(payload, sort_keys=True, default=str)
        payload_hash = BackupArchive.hash_payload(payload)
        archive = BackupArchive.objects.create(
            user=user,
            payload_hash=payload_hash,
            payload=payload,
            payload_summary={
                'threads': len(thread_payload),
                'messages': sum(len(t['messages']) for t in thread_payload),
                'folders': len(folders),
            },
            payload_bytes=len(body_str.encode('utf-8')),
        )
        write_audit(
            request,
            action='backup_create',
            target_type='backup',
            target_id=archive.id,
            metadata=archive.payload_summary,
        )
        return Response(
            BackupArchiveSerializer(archive).data,
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, *args, **kwargs):
        """
        GET /api/backups/{id}/  Returns the raw JSON archive.
        """
        archive = self.get_object()
        if 'download' in request.query_params:
            response = HttpResponse(
                json.dumps(archive.payload, default=str, indent=2),
                content_type='application/json',
            )
            response['Content-Disposition'] = (
                f'attachment; filename="devrose-backup-{archive.id}.json"'
            )
            return response
        return Response(BackupArchiveSerializer(archive).data)
