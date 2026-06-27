from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    signup, login, get_profile,
    CourseViewSet, EnrollmentViewSet,
    UserProgressViewSet, SessionMemoryViewSet,
    FavoriteViewSet, ProfileViewSet,
    ChatThreadViewSet, UserListViewSet, ChatSearchViewSet, StoryViewSet,
    LiveRoomViewSet, AIGenerateViewSet
)

router = DefaultRouter()
router.register(r'courses', CourseViewSet)
router.register(r'enrollments', EnrollmentViewSet, basename='enrollment')
router.register(r'progress', UserProgressViewSet, basename='progress')
router.register(r'session', SessionMemoryViewSet, basename='session')
router.register(r'favorites', FavoriteViewSet, basename='favorite')
router.register(r'profile', ProfileViewSet, basename='profile')
router.register(r'chat/threads', ChatThreadViewSet, basename='chat-thread')
router.register(r'chat/users', UserListViewSet, basename='chat-users')
router.register(r'chat/search', ChatSearchViewSet, basename='chat-search')
router.register(r'chat/stories', StoryViewSet, basename='chat-stories')
router.register(r'live/rooms', LiveRoomViewSet, basename='live-rooms')
router.register(r'ai', AIGenerateViewSet, basename='ai')

urlpatterns = [
    path('', include(router.urls)),
    path('signup/', signup, name='signup'),
    path('login/', login, name='login'),
    path('me/', get_profile, name='get_profile'),
]
