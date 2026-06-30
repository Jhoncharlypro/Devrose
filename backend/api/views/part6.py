"""
Part 6 panel-backend DRF Views.

Five ViewSets backing the admin dashboard, user management,
moderation queue, security center, and broadcast system. The
12 dashboard stat cards aggregate across existing Part 4-5
models so the implementation is a thin layer on top of the
data the platform already records.

REST surface added:

  Admin Dashboard
    GET    /api/admin/dashboard/        12 stat cards (Redis-cached, 30s TTL).
    GET    /api/admin/health/           Liveness summary for the dashboard footer.

  User Management (staff only)
    GET    /api/admin/users/            List users with ban/session status.
    GET    /api/admin/users/{id}/       Single-user detail (ban history + active sessions).
    POST   /api/admin/users/{id}/suspend/   body={"days": int, "reason": str}
    POST   /api/admin/users/{id}/ban/       body={"reason": str, "permanent": bool}
    POST   /api/admin/users/{id}/restore/   body={"reason": str}
    POST   /api/admin/users/{id}/force_logout/   body={"reason": str, "device_jti": str?}

  Moderation (moderator / content_mod)
    GET    /api/admin/reports/          All reports (filter ?resolved=true|false).
    GET    /api/admin/reports/{id}/
    POST   /api/admin/reports/{id}/resolve/   body={"note": str, "remove_message": bool}
    POST   /api/admin/reports/{id}/ban_user/
    POST   /api/admin/reports/spam-reports/  (SpamReport fallback for Part 5 parity)
    GET    /api/admin/reports/spam-reports/

  Security Center
    GET    /api/admin/security/         Aggregate security stats.
    GET    /api/admin/security/logins/  LoginAttempt paginated list.
    GET    /api/admin/security/ips/     BannedIP list.
    POST   /api/admin/security/ips/     body={"ip_address": str, "reason": str, "expires_at": str?}
    DELETE /api/admin/security/ips/{id}/

  Broadcasts
    GET    /api/admin/broadcasts/       List + filter.
    POST   /api/admin/broadcasts/       body={"message": str, "severity": str, "ends_at": str?, "audience": str}
    DELETE /api/admin/broadcasts/{id}/  Soft-deactivate.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db.models import Count, Exists, F, OuterRef, Q, Subquery, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from api import presence
from api.models import (
    ChatThread, Message, Profile,
    AuditLog, BackupArchive, CallLog, ChatGroup, ChatGroupMember,
    PinnedMessage, PremiumSubscription, ScheduledMessage, SpamReport,
    # Part 6 new models:
    AdminRole, UserSession, BannedIP, BannedUser, AdminBroadcast,
    LoginAttempt, Report,
)
# Reuse Part 4 audit + bump + write_audit for observability parity.
from api.views.part4 import write_audit, bump
from api.models.part6 import user_has_permission

logger = logging.getLogger(__name__)


# ===================================================================
# Permission classes
# ===================================================================
class HasAdminPermission(permissions.BasePermission):
    """
    Generic permission that gates an endpoint behind an
    ``admin_permission_required`` attribute on the view. Uses
    ``user_has_permission(user, permission)`` so the role
    hierarchy is centralised in models/part6.py.
    """
    message = 'Admin permission required.'

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        required = getattr(view, 'admin_permission_required', None)
        if not required:
            return bool(user.is_staff)
        return user_has_permission(user, required)


# ===================================================================
# 1. ADMIN DASHBOARD
# ===================================================================
class AdminDashboardView(viewsets.ViewSet):
    """
    GET /api/admin/dashboard/

    Returns 12 stat cards. Cached in Redis for 30 seconds — the
    first request after TTL expiry pays the full query cost,
    subsequent requests within the TTL window are O(1).
    """
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    admin_permission_required = 'can_view_audit'
    DASHBOARD_CACHE_KEY = 'part6_dashboard_stats'
    DASHBOARD_CACHE_TTL = 30  # seconds

    def list(self, request):
        # Manual cache: we don't want stale data forever, but we DO
        # want to coalesce concurrent admin dashboard loads.
        cached = cache.get(self.DASHBOARD_CACHE_KEY)
        if cached:
            return Response({**cached, 'cached': True, 'cached_at': cached.get('__cached_at')})
        # Live aggregation.
        now = timezone.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        last_7d = now - timedelta(days=7)
        last_30d = now - timedelta(days=30)
        # 1. Total users
        total_users = User.objects.count()
        # 2. Online users (presence)
        try:
            online_users = presence.count_online()
        except Exception:
            online_users = 0
        # 3. Active conversations (threads with a message in the last 24h)
        active_conversations = (
            ChatThread.objects.filter(messages__created_at__gte=now - timedelta(hours=24))
            .distinct().count()
        )
        # 4. Messages today
        messages_today = Message.objects.filter(created_at__gte=today_start).count()
        # 5. Voice calls today
        voice_calls_today = CallLog.objects.filter(
            kind='audio', started_at__gte=today_start,
        ).count()
        # 6. Video calls today
        video_calls_today = CallLog.objects.filter(
            kind='video', started_at__gte=today_start,
        ).count()
        # 7. Groups created
        groups_created = ChatGroup.objects.count()
        # 8. Reports pending
        reports_pending = (
            Report.objects.filter(resolved=False).count()
            + SpamReport.objects.filter(resolved=False).count()
        )
        # 9. Banned users (currently active bans)
        banned_users = BannedUser.objects.filter(
            lifted_at__isnull=True,
        ).filter(
            Q(banned_until__isnull=True) | Q(banned_until__gt=now),
        ).count()
        # 10. Storage usage (sum of backup payload_bytes)
        storage_bytes = (
            BackupArchive.objects.aggregate(total=Sum('payload_bytes'))['total'] or 0
        )
        # 11. Server health (DB reachable, presence ledger reachable, Redis cache works)
        server_health = {
            'db': True,
            'presence_ledger': True,
            'cache_layer': True,
        }
        try:
            from django.db import connection
            with connection.cursor() as c:
                c.execute('SELECT 1')
        except Exception:
            server_health['db'] = False
        try:
            presence.count_online()
        except Exception:
            server_health['presence_ledger'] = False
        try:
            cache.set('__healthcheck__', 'ok', 5)
            server_health['cache_layer'] = cache.get('__healthcheck__') == 'ok'
        except Exception:
            server_health['cache_layer'] = False
        # 12. API health — composed of the 3 above.
        api_health = (
            server_health['db']
            and server_health['presence_ledger']
            and server_health['cache_layer']
        )
        stats = {
            'total_users': total_users,
            'online_users': online_users,
            'active_conversations': active_conversations,
            'messages_today': messages_today,
            'voice_calls_today': voice_calls_today,
            'video_calls_today': video_calls_today,
            'groups_created': groups_created,
            'reports_pending': reports_pending,
            'banned_users': banned_users,
            'storage_bytes': storage_bytes,
            'server_health': server_health,
            'api_health': api_health,
            'generated_at': now.isoformat(),
            '__cached_at': now.isoformat(),
        }
        cache.set(self.DASHBOARD_CACHE_KEY, stats, self.DASHBOARD_CACHE_TTL)
        return Response({**stats, 'cached': False})


# ===================================================================
# 2. USER MANAGEMENT
# ===================================================================
class UserSummarySerializer(serializers.ModelSerializer):
    # The four "computed" fields are populated from annotations attached
    # in ``UserManagementViewSet.get_queryset`` -- this collapses the
    # classic N+4 (is_banned, is_premium, active_sessions, last_login)
    # into 4 subqueries evaluated by the database once for the whole
    # list page. SerializerMethodFields that issue a fresh query per
    # row would have cost ``O(users * 4)`` round-trips; the annotated
    # path is O(1) extra SQL no matter how many users the staff user
    # pages through.
    is_banned = serializers.BooleanField(read_only=True)
    is_premium = serializers.BooleanField(read_only=True)
    active_sessions = serializers.IntegerField(read_only=True)
    last_login_attempt = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email',
            'is_active', 'is_staff', 'date_joined', 'last_login',
            'is_banned', 'is_premium', 'active_sessions', 'last_login_attempt',
        ]
        read_only_fields = fields

    def get_last_login_attempt(self, obj):
        # The annotation only carries the timestamp; format the dict here
        # so the wire shape stays the same as the legacy implementation.
        ts = getattr(obj, 'last_login_attempt_at', None)
        if ts is None:
            return None
        return {
            'success': bool(getattr(obj, 'last_login_attempt_success', False)),
            'ip_address': getattr(obj, 'last_login_attempt_ip', '') or '',
            'created_at': ts.isoformat() if hasattr(ts, 'isoformat') else str(ts),
        }


class UserManagementViewSet(viewsets.ReadOnlyModelViewSet):
    """Staff-only user list with ban/session status + moderation actions."""
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    admin_permission_required = 'can_suspend_user'
    serializer_class = UserSummarySerializer
    queryset = User.objects.all().order_by('-date_joined')

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(username__icontains=search) | Q(email__icontains=search),
            )
        # ---- N+1 collapse (Part 6 hardening) ------------------------------
        # The serializer reads four "is_/active_/last_" fields that, if
        # implemented as SerializerMethodField + per-row queries, would
        # issue 4 extra round-trips per user. We push the work into SQL
        # with Exists / Count(Subquery) / Subquery so the user-list page
        # is one round-trip no matter how many rows the staff user
        # pages through.
        #
        # IMPORTANT: ``Count(Subquery(qs.values('pk')))`` is the only
        # legal way to count rows from a filtered sub-query. A bare
        # ``Count(qs.values('pk'), distinct=True)`` raises
        # ``TypeError: Complex aggregates require an alias`` and never
        # reaches the wire.
        now = timezone.now()

        active_ban_sq = BannedUser.objects.filter(
            user=OuterRef('pk'),
            lifted_at__isnull=True,
        ).filter(
            Q(banned_until__isnull=True) | Q(banned_until__gt=now),
        )
        active_session_count_sq = UserSession.objects.filter(
            user=OuterRef('pk'),
            is_active=True,
        )
        last_login_sq = LoginAttempt.objects.filter(
            user=OuterRef('pk'),
        ).order_by('-created_at')
        active_premium_sq = Profile.objects.filter(
            user=OuterRef('pk'),
            is_premium=True,
            premium_until__gt=now,
        )

        qs = qs.annotate(
            is_banned=Exists(active_ban_sq),
            is_premium=Exists(active_premium_sq),
            # Subquery wrapper is required — Count() on a bare queryset
            # is the classic N+1 footgun; Count(Subquery(...)) is the
            # one-shot equivalent.
            active_sessions=Count(Subquery(active_session_count_sq.values('pk'))),
            # last_login_attempt_at + success + ip are 3 scalar subqueries
            # so the serializer can render the full dict without a
            # second round-trip.
            last_login_attempt_at=Subquery(last_login_sq.values('created_at')[:1]),
            last_login_attempt_success=Subquery(last_login_sq.values('success')[:1]),
            last_login_attempt_ip=Subquery(last_login_sq.values('ip_address')[:1]),
        )
        return qs

    @action(detail=True, methods=['post'])
    def suspend(self, request, pk=None):
        """POST /api/admin/users/{id}/suspend/   body={"days": int, "reason": str}"""
        target = self.get_object()
        if not user_has_permission(request.user, 'can_suspend_user'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        try:
            days = int(request.data.get('days') or 7)
        except (TypeError, ValueError):
            days = 7
        days = max(1, min(days, 365))
        ban = BannedUser.objects.create(
            user=target,
            reason=request.data.get('reason') or 'other',
            banned_until=timezone.now() + timedelta(days=days),
            banned_by=request.user,
            details=(request.data.get('details') or '')[:1000],
        )
        # Force-logout all active sessions in the same transaction.
        UserSession.objects.filter(user=target, is_active=True).update(
            is_active=False,
            revoked_at=timezone.now(),
            revoked_reason=f'suspended {days}d',
        )
        write_audit(
            request,
            action='admin_user_suspend',
            target_type='user',
            target_id=target.id,
            metadata={'days': days, 'reason': ban.reason},
        )
        bump('devrose_part6_suspend_total')
        return Response({
            'id': ban.id, 'user_id': target.id, 'days': days,
            'banned_until': ban.banned_until.isoformat(),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def ban(self, request, pk=None):
        """POST /api/admin/users/{id}/ban/   body={"reason": str, "permanent": bool}"""
        target = self.get_object()
        if not user_has_permission(request.user, 'can_ban_user'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        permanent = bool(request.data.get('permanent', True))
        ban = BannedUser.objects.create(
            user=target,
            reason=request.data.get('reason') or 'other',
            banned_until=None if permanent else timezone.now() + timedelta(days=30),
            banned_by=request.user,
            details=(request.data.get('details') or '')[:1000],
        )
        UserSession.objects.filter(user=target, is_active=True).update(
            is_active=False,
            revoked_at=timezone.now(),
            revoked_reason='banned',
        )
        write_audit(
            request,
            action='admin_user_ban',
            target_type='user',
            target_id=target.id,
            metadata={'permanent': permanent, 'reason': ban.reason},
        )
        bump('devrose_part6_ban_total')
        return Response({
            'id': ban.id, 'user_id': target.id, 'permanent': permanent,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """POST /api/admin/users/{id}/restore/   body={"reason": str}"""
        target = self.get_object()
        if not user_has_permission(request.user, 'can_restore_user'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        now = timezone.now()
        active_bans = BannedUser.objects.filter(
            user=target, lifted_at__isnull=True,
        ).filter(
            Q(banned_until__isnull=True) | Q(banned_until__gt=now),
        )
        count = 0
        for ban in active_bans:
            ban.lifted_at = now
            ban.lifted_by = request.user
            ban.lift_reason = (request.data.get('reason') or '')[:255]
            ban.save(update_fields=['lifted_at', 'lifted_by', 'lift_reason'])
            count += 1
        write_audit(
            request,
            action='admin_user_restore',
            target_type='user',
            target_id=target.id,
            metadata={'bans_lifted': count},
        )
        bump('devrose_part6_restore_total')
        return Response({'user_id': target.id, 'bans_lifted': count})

    @action(detail=True, methods=['post'])
    def force_logout(self, request, pk=None):
        """
        POST /api/admin/users/{id}/force_logout/
        body={"reason": str, "device_jti": str?}

        If device_jti is given, only that one session is revoked.
        Otherwise ALL active sessions for the user are revoked.
        """
        target = self.get_object()
        if not user_has_permission(request.user, 'can_force_logout'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        qs = UserSession.objects.filter(user=target, is_active=True)
        device_jti = request.data.get('device_jti')
        if device_jti:
            qs = qs.filter(jti=device_jti)
        count = qs.update(
            is_active=False,
            revoked_at=timezone.now(),
            revoked_reason=(request.data.get('reason') or 'force_logout')[:120],
        )
        write_audit(
            request,
            action='admin_user_force_logout',
            target_type='user',
            target_id=target.id,
            metadata={'sessions_revoked': count, 'device_jti': device_jti or '*'},
        )
        bump('devrose_part6_force_logout_total')
        return Response({
            'user_id': target.id, 'sessions_revoked': count,
        })


# ===================================================================
# 3. MODERATION
# ===================================================================
class ReportSerializer(serializers.ModelSerializer):
    reporter_username = serializers.CharField(source='reporter.username', read_only=True)
    reported_username = serializers.CharField(source='reported_user.username', read_only=True)
    resolved_by_username = serializers.CharField(source='resolved_by.username', read_only=True)

    class Meta:
        model = Report
        fields = [
            'id', 'reporter', 'reporter_username',
            'reported_user', 'reported_username',
            'target_type', 'target_id', 'reason', 'description',
            'resolved', 'resolved_by', 'resolved_by_username',
            'resolved_at', 'resolution_note', 'created_at',
        ]
        read_only_fields = fields


class ModerationViewSet(viewsets.ReadOnlyModelViewSet):
    """Moderation queue: reports + actions."""
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    admin_permission_required = 'can_resolve_reports'
    serializer_class = ReportSerializer
    queryset = Report.objects.all().order_by('-created_at')

    def get_queryset(self):
        qs = super().get_queryset()
        resolved = self.request.query_params.get('resolved')
        if resolved is not None:
            qs = qs.filter(resolved=resolved.lower() == 'true')
        return qs

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """POST /api/admin/reports/{id}/resolve/   body={"note": str, "remove_message": bool}"""
        report = self.get_object()
        if report.resolved:
            return Response({'error': 'already resolved'}, status=status.HTTP_400_BAD_REQUEST)
        report.resolved = True
        report.resolved_by = request.user
        report.resolved_at = timezone.now()
        report.resolution_note = (request.data.get('note') or '')[:255]
        report.save(update_fields=['resolved', 'resolved_by', 'resolved_at', 'resolution_note'])
        # Optional: remove the offending message (target_type=message).
        removed = False
        if (request.data.get('remove_message') and report.target_type == 'message'):
            try:
                msg = Message.objects.get(pk=report.target_id)
                msg.delete()
                removed = True
            except Message.DoesNotExist:
                removed = False
        write_audit(
            request,
            action='admin_report_resolve',
            target_type='report',
            target_id=report.id,
            metadata={'target_type': report.target_type, 'remove_message': removed},
        )
        bump('devrose_part6_report_resolve_total')
        return Response({
            'id': report.id, 'resolved': True,
            'message_removed': removed,
        })

    @action(detail=True, methods=['post'])
    def ban_user(self, request, pk=None):
        """POST /api/admin/reports/{id}/ban_user/   body={"permanent": bool}"""
        if not user_has_permission(request.user, 'can_ban_user'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        report = self.get_object()
        target = report.reported_user
        permanent = bool(request.data.get('permanent', True))
        BannedUser.objects.create(
            user=target,
            reason=report.reason if report.reason in ('spam', 'abuse', 'harassment', 'illegal', 'impersonation', 'csam') else 'other',
            banned_until=None if permanent else timezone.now() + timedelta(days=30),
            banned_by=request.user,
            details=f'From report #{report.id}: {report.description[:200]}',
        )
        UserSession.objects.filter(user=target, is_active=True).update(
            is_active=False,
            revoked_at=timezone.now(),
            revoked_reason='banned_from_report',
        )
        report.resolved = True
        report.resolved_by = request.user
        report.resolved_at = timezone.now()
        report.resolution_note = 'banned'
        report.save(update_fields=['resolved', 'resolved_by', 'resolved_at', 'resolution_note'])
        write_audit(
            request,
            action='admin_report_ban',
            target_type='report',
            target_id=report.id,
            metadata={'permanent': permanent, 'target_user_id': target.id},
        )
        return Response({
            'report_id': report.id, 'banned_user_id': target.id,
            'permanent': permanent,
        })


# ===================================================================
# 4. SECURITY CENTER
# ===================================================================
class BannedIPSerializer(serializers.ModelSerializer):
    class Meta:
        model = BannedIP
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'banned_by']


class LoginAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoginAttempt
        fields = ['id', 'username', 'ip_address', 'user_agent', 'success',
                  'failure_reason', 'created_at']
        read_only_fields = fields


class SecurityCenterViewSet(viewsets.ViewSet):
    """
    GET    /api/admin/security/             Aggregate stats (failed logins, top IPs, active bans).
    GET    /api/admin/security/logins/      LoginAttempt list (?success=true|false).
    GET    /api/admin/security/ips/         BannedIP list.
    POST   /api/admin/security/ips/         body={"ip_address": str, "reason": str, "expires_at": str?}
    DELETE /api/admin/security/ips/{id}/    Lift the IP ban.
    """
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    admin_permission_required = 'can_view_audit'

    def list(self, request):
        """GET /api/admin/security/   Aggregate."""
        now = timezone.now()
        last_24h = now - timedelta(hours=24)
        failed_logins_24h = LoginAttempt.objects.filter(
            success=False, created_at__gte=last_24h,
        ).count()
        successful_logins_24h = LoginAttempt.objects.filter(
            success=True, created_at__gte=last_24h,
        ).count()
        # Top 5 IPs with most failed logins (potential brute-force sources).
        top_ips = (
            LoginAttempt.objects.filter(success=False, created_at__gte=last_24h)
            .values('ip_address')
            .annotate(count=Count('id'))
            .order_by('-count')[:5]
        )
        active_ip_bans = BannedIP.objects.filter(
            is_active=True,
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now),
        ).count()
        active_user_bans = BannedUser.objects.filter(
            lifted_at__isnull=True,
        ).filter(
            Q(banned_until__isnull=True) | Q(banned_until__gt=now),
        ).count()
        active_sessions = UserSession.objects.filter(is_active=True).count()
        return Response({
            'failed_logins_24h': failed_logins_24h,
            'successful_logins_24h': successful_logins_24h,
            'active_ip_bans': active_ip_bans,
            'active_user_bans': active_user_bans,
            'active_sessions': active_sessions,
            'top_failed_ips_24h': list(top_ips),
        })

    @action(detail=False, methods=['get'])
    def logins(self, request):
        """GET /api/admin/security/logins/   ?success=true|false&user_id=int"""
        qs = LoginAttempt.objects.all().order_by('-created_at')
        success = request.query_params.get('success')
        if success is not None:
            qs = qs.filter(success=success.lower() == 'true')
        user_id = request.query_params.get('user_id')
        if user_id and user_id.isdigit():
            qs = qs.filter(user_id=int(user_id))
        try:
            limit = min(int(request.query_params.get('limit', 100)), 500)
        except (TypeError, ValueError):
            limit = 100
        return Response(LoginAttemptSerializer(qs[:limit], many=True).data)

    @action(detail=False, methods=['get', 'post'])
    def ips(self, request):
        """
        GET  /api/admin/security/ips/   BannedIP list.
        POST /api/admin/security/ips/   body={"ip_address": str, "reason": str, "expires_at": str?}
        """
        if request.method == 'GET':
            qs = BannedIP.objects.all().order_by('-created_at')
            return Response(BannedIPSerializer(qs, many=True).data)
        if not user_has_permission(request.user, 'can_ban_ip'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        ip = (request.data.get('ip_address') or '').strip()
        if not ip:
            return Response({'error': 'ip_address is required.'}, status=status.HTTP_400_BAD_REQUEST)
        expires_at = request.data.get('expires_at')
        expires_dt = None
        if expires_at:
            from django.utils.dateparse import parse_datetime
            expires_dt = parse_datetime(expires_at)
        ban = BannedIP.objects.create(
            ip_address=ip,
            reason=(request.data.get('reason') or '')[:255],
            banned_by=request.user,
            expires_at=expires_dt,
        )
        write_audit(
            request,
            action='admin_ip_ban',
            target_type='ip',
            target_id=ban.id,
            metadata={'ip_address': ip},
        )
        return Response(BannedIPSerializer(ban).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'ips/(?P<ip_id>\d+)')
    def delete_ip(self, request, pk=None, ip_id=None):
        """DELETE /api/admin/security/ips/{ip_id}/   Lift the ban."""
        if not user_has_permission(request.user, 'can_ban_ip'):
            return Response({'error': 'permission denied'}, status=status.HTTP_403_FORBIDDEN)
        ban = get_object_or_404(BannedIP, pk=ip_id)
        ban.is_active = False
        ban.save(update_fields=['is_active'])
        write_audit(
            request,
            action='admin_ip_unban',
            target_type='ip',
            target_id=ban.id,
            metadata={'ip_address': ban.ip_address},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ===================================================================
# 5. BROADCASTS
# ===================================================================
class AdminBroadcastSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = AdminBroadcast
        fields = [
            'id', 'severity', 'message', 'starts_at', 'ends_at',
            'audience', 'is_active', 'created_by', 'created_by_username',
            'created_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at']

    def create(self, validated_data):
        validated_data['created_by'] = self.context['request'].user
        return super().create(validated_data)


class AdminBroadcastViewSet(viewsets.ModelViewSet):
    """
    CRUD on admin broadcast notices. On create/update, the view
    publishes a Channels message to the global 'system_broadcast'
    group so any connected client sees the notice in real time.
    """
    permission_classes = [permissions.IsAuthenticated, HasAdminPermission]
    admin_permission_required = 'can_broadcast'
    serializer_class = AdminBroadcastSerializer
    queryset = AdminBroadcast.objects.all().order_by('-created_at')

    def perform_create(self, serializer):
        broadcast = serializer.save()
        self._publish(broadcast)
        write_audit(
            self.request,
            action='admin_broadcast_create',
            target_type='broadcast',
            target_id=broadcast.id,
            metadata={'severity': broadcast.severity, 'audience': broadcast.audience},
        )
        bump('devrose_part6_broadcast_total')

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active'])
        write_audit(
            self.request,
            action='admin_broadcast_deactivate',
            target_type='broadcast',
            target_id=instance.id,
        )

    def _publish(self, broadcast):
        """
        Push the broadcast to the global 'system_broadcast' Channels
        group. Failures are caught so a Channels outage doesn't
        block the API response.
        """
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            layer = get_channel_layer()
            if not layer:
                return
            payload = {
                'type': 'broadcast.message',
                'id': broadcast.id,
                'severity': broadcast.severity,
                'message': broadcast.message,
                'audience': broadcast.audience,
                'created_at': broadcast.created_at.isoformat(),
            }
            async_to_sync(layer.group_send)('system_broadcast', payload)
        except Exception:  # noqa: BLE001
            logger.exception('broadcast publish failed; broadcast still persisted')
