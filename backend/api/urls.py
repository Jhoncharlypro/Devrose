"""URL routing for the DevRose Academy API.

The auth surface lives at the root URL (so the frontend hits ``/api/login/``
not ``/api/auth/login/``), and the chat / courses / live / ai app routes are
exposed via the DRF router below.
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

# Auth surface:
#   POST /api/signup/                     → register + auto-login (JWT)
#   POST /api/login/                      → authenticate (JWT)
#   POST /api/logout/                     → blacklist refresh
#   POST /api/refresh/                    → rotate refresh + new access
#   POST /api/password/forgot/            → dev-mode reset token
#   POST /api/password/reset/confirm/     → consume reset JWT
#   GET  /api/me/                         → current user (compat with old)
#   POST /api/token/refresh/              → SimpleJWT default alias
urlpatterns = [
    path('', include(router.urls)),
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
    path('account/delete/', delete_account, name='delete_account'),
    # Aliases — SimpleJWT default views, in case a 3rd-party client asks for them.
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    # Concrete Supabase health endpoint — see api/views/healthz.py.
    # Public (no JWT required) so load balancers + uptime probes can hit it.
    # Returns 200 if all components are ok, 503 if Postgres is unreachable.
    path('healthz/', healthz, name='healthz'),
] 
