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
from .profile import ProfileViewSet, BlockViewSet, MuteViewSet
from .chat import ChatThreadViewSet, UserListViewSet, ChatSearchViewSet, StoryViewSet
from .ai import AIGenerateViewSet
from .healthz import healthz  # /api/healthz/ — Supabase probe endpoint.
from .root import api_root  # GET / — JSON API root (replaces the old Vite-served index.html).
