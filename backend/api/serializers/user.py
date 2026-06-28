"""
User + Profile + Block/Mute serializers.

Three serializer families:
  * ProfileSerializer  — read+write for the current user's profile; surface a
                         redesigned `notification_prefs` accessor that merges
                         user-supplied values with sane defaults on read so
                         absent keys fall back gracefully without DB drift.
  * UserSerializer     — read shape used by chat / settings / contact panel.
                         Wraps ProfileSerializer as a nested `profile` field.
  * BlockedUserSerializer / MutedUserSerializer — narrow read+write shape
                         for the moderation endpoints.

Design note on notification_prefs:
  We store only what the user has explicitly toggled away from defaults.
  That keeps SQLite JSON blobs small AND lets us flip the default for
  a new channel (e.g. ``push_notif``) in a single product update without
  a migration. The ``to_representation`` override expands the stored
  dict with the platform's defaults so the frontend always sees the
  full set of channels.
"""
from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import serializers

from api.models import BlockedUser, MutedUser, Profile


# Default notification preferences — expanded on read in the serializer.
NOTIFICATION_DEFAULTS = {
    'sound': True,
    'desktop_notif': False,
    'email_notif': False,
    'message_preview': True,
}


# Maximum dimensions we accept on a base64 cover_photo payload.
# 5 MB cap so the JSON blob stays roughly <7 MB once Django serializes it.
COVER_PHOTO_MAX_BYTES = 5 * 1024 * 1024
# Base64 of 5 MiB is ⌈5*1024*1024 / 3⌉ * 4 = 6,990,508 chars (the remainder
# 2 bytes of a 5 MiB blob force a 4th padding group). The previous
# `MAX * 4 // 3` formula used FLOOR division, which under-counted by 2
# and caused every 5 MB cover-photo upload to fail with a 400 the user
# read as "cannot find server" (the FE's catch handler surfaced the raw
# `{"cover_photo":["Ensure this field has no more than 6990506 characters."]}`
# blob). The +1024 here is a small buffer for the `data:<mime>;base64,`
# prefix and any MIME-padding variance from FileReader.readAsDataURL.
COVER_PHOTO_BASE64_MAX_CHARS = (COVER_PHOTO_MAX_BYTES * 4 + 2) // 3 + 1024

# Maximum dimensions we accept on a base64 avatar payload.
# 2 MB cap matching the bucket upload limit in storage_utils.
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_BASE64_MAX_CHARS = (AVATAR_MAX_BYTES * 4 + 2) // 3 + 1024

# Maximum number of tags we'll keep, and the cap on each tag's length.
INTERESTS_MAX_TAGS = 10
INTERESTS_TAG_MAX_LEN = 30
INTERESTS_ALLOWED = set(
    'abcdefghijklmnopqrstuvwxyzàáâãäåèéêëìíîïòóôõöùúûüñçßœæ0123456789-_\' '
)


class ProfileSerializer(serializers.ModelSerializer):
    avatar = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=AVATAR_BASE64_MAX_CHARS)
    bio = serializers.CharField(required=False, allow_blank=True)
    status_text = serializers.CharField(required=False, allow_blank=True, default='')
    # Fields from the auth-extension phase (0011).
    email_verified = serializers.BooleanField(required=False, read_only=True)
    email_verified_at = serializers.DateTimeField(required=False, read_only=True)
    profile_visibility = serializers.CharField(required=False, allow_blank=True)
    last_seen_visibility = serializers.CharField(required=False, allow_blank=True)

    # Fields added in 0012 (PROFILE module). All optional — privacy-aware
    # updates will skip individual fields the caller didn't want to change.
    cover_photo = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=COVER_PHOTO_BASE64_MAX_CHARS,
    )
    interests = serializers.ListField(
        child=serializers.CharField(max_length=INTERESTS_TAG_MAX_LEN),
        required=False,
        default=list,
    )
    social_links = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=dict,
    )
    notification_prefs = serializers.DictField(
        child=serializers.BooleanField(),
        required=False,
        default=dict,
    )
    country = serializers.CharField(required=False, allow_blank=True, max_length=60)

    class Meta:
        model = Profile
        fields = [
            'avatar', 'bio', 'status_text',
            'email_verified', 'email_verified_at',
            'profile_visibility', 'last_seen_visibility',
            'cover_photo', 'interests', 'social_links',
            'notification_prefs', 'country',
        ]

    # ------------------------------------------------------------------
    # Notification prefs accessor: on read we expand the stored partial
    # dict with platform defaults so the frontend never has to guess
    # whether a missing key is "false" or "unknown".
    # ------------------------------------------------------------------
    def to_representation(self, instance):
        data = super().to_representation(instance)
        stored = data.get('notification_prefs') or {}
        # Merge with defaults; user-set values override the defaults.
        merged = {**NOTIFICATION_DEFAULTS, **stored}
        data['notification_prefs'] = merged
        return data


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)
    stories = serializers.SerializerMethodField()
    # Surface registration date so the profile screen can show e.g. "Member since..."
    date_joined = serializers.DateTimeField(read_only=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'password', 'profile', 'stories', 'date_joined')
        extra_kwargs = {'password': {'write_only': True}}

    def get_stories(self, obj):
        time_threshold = timezone.now() - timedelta(hours=24)
        stories = obj.stories.filter(created_at__gte=time_threshold).order_by('created_at')
        return [{
            'id': story.id,
            'type': story.type,
            'content': story.content,
            'background': story.background,
            'created_at': story.created_at.isoformat()
        } for story in stories]

    def to_representation(self, instance):
        # Ensure profile exists for the user being serialized
        if not hasattr(instance, 'profile'):
            Profile.objects.get_or_create(user_id=instance.id)
        return super().to_representation(instance)

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        Profile.objects.get_or_create(user=user)
        return user


class _UserMiniNested(serializers.ModelSerializer):
    """Minimal id+username+avatar shape — used as nested for blocks/mutes."""

    avatar = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'username', 'avatar')

    def get_avatar(self, obj):
        try:
            return obj.profile.avatar
        except Profile.DoesNotExist:
            return None


class BlockedUserSerializer(serializers.ModelSerializer):
    """
    ``POST /api/blocks/ {user_id: <int>}`` → creates a BlockedUser row.

    We expose ``user_id`` on write (the FE only knows the ID) and the
    full mini ``blocked`` user shape on read so the FE can render a list
    with avatars + usernames without a second round-trip.
    """
    user_id = serializers.IntegerField(write_only=True, required=True)
    blocked = _UserMiniNested(read_only=True)

    class Meta:
        model = BlockedUser
        fields = ('id', 'user_id', 'blocked', 'created_at', 'reason')
        read_only_fields = ('id', 'blocked', 'created_at')

    def create(self, validated_data):
        actor = self.context['request'].user
        target_id = validated_data.pop('user_id')
        if target_id == actor.id:
            raise serializers.ValidationError(
                {'user_id': 'Cannot block yourself.'}
            )
        # Validate target exists; get_or_create handles the duplicate case.
        try:
            target = User.objects.get(id=target_id)
        except User.DoesNotExist:
            raise serializers.ValidationError(
                {'user_id': 'Target user does not exist.'}
            )
        obj, _ = BlockedUser.objects.get_or_create(
            actor=actor,
            blocked=target,
            defaults={'reason': validated_data.get('reason', '')},
        )
        return obj


class MutedUserSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(write_only=True, required=True)
    muted = _UserMiniNested(read_only=True)
    mute_until = serializers.DateTimeField(required=False, allow_null=True)

    class Meta:
        model = MutedUser
        fields = ('id', 'user_id', 'muted', 'mute_until', 'created_at')
        read_only_fields = ('id', 'muted', 'created_at')

    def create(self, validated_data):
        actor = self.context['request'].user
        target_id = validated_data.pop('user_id')
        if target_id == actor.id:
            raise serializers.ValidationError(
                {'user_id': 'Cannot mute yourself.'}
            )
        try:
            target = User.objects.get(id=target_id)
        except User.DoesNotExist:
            raise serializers.ValidationError(
                {'user_id': 'Target user does not exist.'}
            )
        obj, _ = MutedUser.objects.get_or_create(
            actor=actor,
            muted=target,
            defaults={'mute_until': validated_data.get('mute_until')},
        )
        # If mute_until is being updated (e.g. +1h extension), patch in place.
        new_until = validated_data.get('mute_until')
        if new_until is not None and obj.mute_until != new_until:
            obj.mute_until = new_until
            obj.save(update_fields=['mute_until'])
        return obj
