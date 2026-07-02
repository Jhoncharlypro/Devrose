# Devrose API — re-exports every model so callers can do
# ``from api.models import Message`` without caring which file the
# model lives in. New parts are added to the bottom so existing
# import paths remain stable across upgrades.
#
# IMPORTANT: this module exposes ONLY models. ViewSets / function-
# based views live in ``api.views`` and are registered by
# ``api.urls.py`` directly. There's no historical reason to re-export
# ViewSets from here, and earlier turns accidentally did so by
# copy-paste — which made ``django.setup()`` crash with
# ``ModuleNotFoundError: No module named 'api.models.metrics'``
# (the ``metrics`` function actually lives in ``api/views/metrics.py``).
# Keep this file purely about models so it stays importable.
from .chat import (
    ChatThread, Message, MessageReaction, UserStory, UserThreadSetting,
    # Phase 10 — Status (Stories) full schema. Each table has its own
    # constraints + indexes (see chat.py for the rationale of each).
    StatusMedia, StatusView, StatusReaction, StatusPrivacyOverride,
    STATUS_PRIVACY_CHOICES,
)
from .course import Course
from .enrollment import Enrollment
from .favorite import Favorite
from .live_room import LiveRoom
# BlockedUser / MutedUser were moved into ``profile.py`` during the
# Part 4 cleanup (migration 0012) so the privacy/block family lives
# alongside the Profile model. They used to be re-exported from
# ``.chat`` here — Django setup now crashes with
# ``ImportError: cannot import name 'BlockedUser' from 'api.models.chat'``
# because the original mixed-domain import block above lost those
# names. Keep them here so callers can still ``from api.models
# import BlockedUser, MutedUser`` without caring about the file split.
from .profile import Profile, BlockedUser, MutedUser, COUNTRIES, ProfileActivityLog
from .progress import UserProgress
# SessionMemory was moved into ``session.py`` (it pairs with the
# ``Session`` per-device user session model) — keep the flat
# ``from api.models import SessionMemory`` import path so callers
# don't have to track the file split.
from .session import SessionMemory
# Part 4 panel backends (added 0016):
from .part4 import (
    AuditLog, CallLog, ChatGroup, ChatGroupMember, PinnedMessage,
)
# Part 5 premium features (added 0017):
from .part5 import (
    SmartReplyCache, ScheduledMessage,
    ChatFolder, ChatFolderMembership,
    PremiumSubscription, SpamReport, BackupArchive,
    score_spam,
)
# Part 6 enterprise admin / moderation / security (added 0018):
from .part6 import (
    AdminRole, UserSession, BannedIP, BannedUser,
    AdminBroadcast, LoginAttempt, Report,
    ROLE_PERMISSIONS, user_has_permission,
)
# Part 8 production / devops / monitoring (added 0019):
from .part8 import (
    AnalyticsEvent, JobQueue, MediaAsset, MaintenanceWindow,
    RateLimitBucket, SecurityAlert, DeploymentEvent, IPGeolocation,
    enqueue_job, rate_limit_check, current_maintenance,
    impossible_travel,
)
