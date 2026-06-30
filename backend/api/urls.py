"""URL routing for the DevRose Academy API.

Part 4 panel backends, Part 5 premium features, Part 6 enterprise
admin surface, and Part 8 production / devops surface are all
registered here so the existing surface remains backwards-compatible.

Part 8 also adds versioned mounts at /api/v1/ and /api/v2/. Both
mounts point at the same ViewSet surface today; v2 is a forward-
looking namespace so breaking changes can land there without
disturbing clients still on v1. The legacy /api/ mount remains
the default for backward compatibility.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    signup, login, logout as logout_view, refresh_token,
    forgot_password, reset_password_confirm,
    change_password,
    send_email_verification, verify_email_confirm,
    delete_account,
    get_profile,
    healthz,
    CourseViewSet, EnrollmentViewSet,
    UserProgressViewSet, SessionMemoryViewSet,
    FavoriteViewSet, ProfileViewSet, BlockViewSet, MuteViewSet,
    ChatThreadViewSet, UserListViewSet, ChatSearchViewSet, StoryViewSet,
    LiveRoomViewSet, AIGenerateViewSet,
    AuditLogViewSet, CallHistoryViewSet, ChatGroupViewSet, PinnedMessageViewSet,
    ScheduledMessageViewSet, ChatFolderViewSet, PremiumSubscriptionViewSet,
    SpamReportViewSet, BackupArchiveViewSet, AIServiceViewSet,
    AdminDashboardView, UserManagementViewSet, ModerationViewSet,
    SecurityCenterViewSet, AdminBroadcastViewSet,
    # Part 8 — production / devops / monitoring surface:
    VersionedAPIRoot, version_info,
    MaintenanceViewSet, AnalyticsIngestView,
    JobQueueViewSet, SecurityAlertViewSet,
    DeploymentEventViewSet, MediaAssetViewSet,
    RateLimitInspectView,
    metrics,
)

router = DefaultRouter()
router.register(r'courses', CourseViewSet)
router.register(r'enrollments', EnrollmentViewSet, basename='enrollment')
router.register(r'progress', UserProgressViewSet, basename='progress')
router.register(r'session', SessionMemoryViewSet, basename='session')
router.register(r'favorites', FavoriteViewSet, basename='favorite')
router.register(r'profile', ProfileViewSet, basename='profile')
router.register(r'blocks', BlockViewSet, basename='blocks')
router.register(r'mutes', MuteViewSet, basename='mutes')
router.register(r'chat/threads', ChatThreadViewSet, basename='chat-thread')
router.register(r'chat/users', UserListViewSet, basename='chat-users')
router.register(r'chat/search', ChatSearchViewSet, basename='chat-search')
router.register(r'chat/stories', StoryViewSet, basename='chat-stories')
router.register(r'live/rooms', LiveRoomViewSet, basename='live-rooms')
router.register(r'ai', AIGenerateViewSet, basename='ai')
router.register(r'audit', AuditLogViewSet, basename='audit')
router.register(r'calls', CallHistoryViewSet, basename='calls')
router.register(r'groups', ChatGroupViewSet, basename='groups')
router.register(r'scheduled-messages', ScheduledMessageViewSet, basename='scheduled-messages')
router.register(r'folders', ChatFolderViewSet, basename='folders')
router.register(r'premium', PremiumSubscriptionViewSet, basename='premium')
router.register(r'spam-reports', SpamReportViewSet, basename='spam-reports')
router.register(r'backups', BackupArchiveViewSet, basename='backups')
router.register(r'admin/reports', ModerationViewSet, basename='admin-reports')
router.register(r'admin/users', UserManagementViewSet, basename='admin-users')
router.register(r'admin/broadcasts', AdminBroadcastViewSet, basename='admin-broadcasts')
# Part 8 — production / devops:
router.register(r'maintenance', MaintenanceViewSet, basename='maintenance')
router.register(r'queue', JobQueueViewSet, basename='queue')
router.register(r'security/alerts', SecurityAlertViewSet, basename='security-alerts')
router.register(r'deployments', DeploymentEventViewSet, basename='deployments')
router.register(r'media/assets', MediaAssetViewSet, basename='media-assets')

urlpatterns = [
    path('', include(router.urls)),
    # Auth surface
    path('signup/', signup, name='signup'),
    path('login/', login, name='login'),
    path('logout/', logout_view, name='logout'),
    path('refresh/', refresh_token, name='refresh'),
    path('me/', get_profile, name='get_profile'),
    path('password/forgot/', forgot_password, name='forgot_password'),
    path('password/reset/confirm/', reset_password_confirm, name='reset_password_confirm'),
    path('password/change/', change_password, name='change_password'),
    path('email/verify/send/', send_email_verification, name='send_email_verification'),
    path('email/verify/confirm/', verify_email_confirm, name='verify_email_confirm'),
    path('account/delete/', delete_account, name='account_delete'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    # Health + metrics + version (no JWT required):
    path('healthz/', healthz, name='healthz'),
    path('metrics/', metrics, name='metrics'),
    path('version/', version_info, name='version_info'),
    # Part 8 — analytics ingest (AllowAny + rate-limited)
    path('analytics/ingest/', AnalyticsIngestView, name='analytics_ingest'),
    # Part 8 — rate limit inspection (admin)
    path('rate-limits/', RateLimitInspectView, name='rate_limits_inspect'),
    # Per-thread pinned-messages surface (Part 4)
    path('chat/threads/<int:thread_id>/pins/',
         PinnedMessageViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='thread-pins'),
    path('chat/threads/<int:thread_id>/pins/<int:pk>/',
         PinnedMessageViewSet.as_view({'delete': 'destroy'}),
         name='thread-pin-detail'),
    # Part 5 — AI smart-feature endpoints
    path('ai/translate/',   AIServiceViewSet.as_view({'post': 'translate'}),   name='ai-translate'),
    path('ai/summarize/',   AIServiceViewSet.as_view({'post': 'summarize'}),   name='ai-summarize'),
    path('ai/rewrite/',     AIServiceViewSet.as_view({'post': 'rewrite'}),     name='ai-rewrite'),
    path('ai/smart_reply/', AIServiceViewSet.as_view({'post': 'smart_reply'}), name='ai-smart-reply'),
    path('ai/detect_spam/',  AIServiceViewSet.as_view({'post': 'detect_spam'}),  name='ai-detect-spam'),
    path('ai/detect_scam/',  AIServiceViewSet.as_view({'post': 'detect_scam'}),  name='ai-detect-scam'),
    path('ai/detect_abuse/', AIServiceViewSet.as_view({'post': 'detect_abuse'}), name='ai-detect-abuse'),
    # Part 6 — admin / moderation / security surface
    path('admin/dashboard/',          AdminDashboardView.as_view({'get': 'list'}),    name='admin-dashboard'),
    path('admin/security/',            SecurityCenterViewSet.as_view({'get': 'list'}), name='admin-security'),
    path('admin/security/logins/',     SecurityCenterViewSet.as_view({'get': 'logins'}), name='admin-security-logins'),
    path('admin/security/ips/',        SecurityCenterViewSet.as_view({'get': 'ips', 'post': 'ips'}), name='admin-security-ips'),
    path('admin/security/ips/<int:ip_id>/', SecurityCenterViewSet.as_view({'delete': 'delete_ip'}), name='admin-security-ips-detail'),
    path('admin/users/<int:pk>/suspend/',      UserManagementViewSet.as_view({'post': 'suspend'}),      name='admin-users-suspend'),
    path('admin/users/<int:pk>/ban/',          UserManagementViewSet.as_view({'post': 'ban'}),          name='admin-users-ban'),
    path('admin/users/<int:pk>/restore/',      UserManagementViewSet.as_view({'post': 'restore'}),      name='admin-users-restore'),
    path('admin/users/<int:pk>/force_logout/', UserManagementViewSet.as_view({'post': 'force_logout'}), name='admin-users-force-logout'),
    path('admin/reports/<int:pk>/resolve/',    ModerationViewSet.as_view({'post': 'resolve'}),    name='admin-reports-resolve'),
    path('admin/reports/<int:pk>/ban_user/',   ModerationViewSet.as_view({'post': 'ban_user'}),   name='admin-reports-ban-user'),
    # Part 8 — Versioned API roots
    #   /api/v1/  →  same surface as /api/ (legacy compat)
    #   /api/v2/  →  same surface for now, distinct header so FE can negotiate
    path('v1/', VersionedAPIRoot, {'version': 'v1'}, name='api_v1_root'),
    path('v2/', VersionedAPIRoot, {'version': 'v2'}, name='api_v2_root'),
]
