from .auth import (
    signup,
    login,
    logout,
    refresh_token,
    forgot_password,
    reset_password_confirm,
    change_password,
    send_email_verification,
    verify_email_confirm,
    delete_account,
    get_profile,
)
from .course import CourseViewSet
from .enrollment import EnrollmentViewSet
from .progress import UserProgressViewSet
from .session import SessionMemoryViewSet
from .live_room import LiveRoomViewSet
from .favorite import FavoriteViewSet
from .profile import ProfileViewSet, BlockViewSet, MuteViewSet, ActivityLogViewSet
from .chat import ChatThreadViewSet, UserListViewSet, ChatSearchViewSet, StoryViewSet, CallLogViewSet, ChatPresenceViewSet
from .ai import AIGenerateViewSet
from .healthz import healthz  # /api/healthz/ — Supabase probe endpoint.
from .root import api_root  # GET / — JSON API root (replaces the old Vite-served index.html).

# Part 4 panel backends — re-exported so api/urls.py can register them.
from .part4 import (
    AuditLogViewSet,
    CallHistoryViewSet,
    ChatGroupViewSet,
    PinnedMessageViewSet,
)
from .metrics import metrics  # Prometheus-style scrape endpoint, no-JWT.

# Part 5 premium-feature ViewSets (added 0017) — re-exported so
# api/urls.py can register them. Keep alphabetised.
from .part5 import (
    ScheduledMessageViewSet,
    ChatFolderViewSet,
    PremiumSubscriptionViewSet,
    SpamReportViewSet,
    BackupArchiveViewSet,
)
# Part 5 smart-AI endpoints (translate, summarize, rewrite, smart_reply,
# detect_spam|scam|abuse). The legacy AIGenerateViewSet lives in the
# same module; we re-export only the new one here to keep the urls.py
# import line clean.
from .ai import AIServiceViewSet

# Part 6 admin dashboard and moderation surface (added 0018).
# Re-exported so api/urls.py can register them; the rest of the
# aggregator matches the same flat-name convention used for Part 4/5.
from .part6 import (
    AdminDashboardView, UserManagementViewSet, ModerationViewSet,
    SecurityCenterViewSet, AdminBroadcastViewSet,
)

# Part 8 production / devops / monitoring surface (added 0019).
# ``version_info`` and ``VersionedAPIRoot`` are small function+class
# views; everything below is a ModelViewSet or ReadOnlyModelViewSet.
from .part8 import (
    VersionedAPIRoot, version_info,
    MaintenanceViewSet, AnalyticsIngestView,
    JobQueueViewSet, SecurityAlertViewSet,
    DeploymentEventViewSet, MediaAssetViewSet,
    RateLimitInspectView,
)
