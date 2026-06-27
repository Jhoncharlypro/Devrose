from rest_framework import serializers
from django.contrib.auth.models import User
from api.models import Profile
from django.utils import timezone
from datetime import timedelta

class ProfileSerializer(serializers.ModelSerializer):
    avatar = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    bio = serializers.CharField(required=False, allow_blank=True)
    status_text = serializers.CharField(required=False, allow_blank=True, default='')
    
    class Meta:
        model = Profile
        fields = ['avatar', 'bio', 'status_text']

class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)
    stories = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'password', 'profile', 'stories')
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
