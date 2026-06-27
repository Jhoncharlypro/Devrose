from django.db import models
from django.contrib.auth.models import User


class LiveRoom(models.Model):
    room_id = models.SlugField(max_length=80, unique=True)
    public_code = models.SlugField(max_length=80, unique=True, null=True, blank=True)
    private_host_key = models.CharField(max_length=120, unique=True, null=True, blank=True)
    title = models.CharField(max_length=140)
    host = models.ForeignKey(User, on_delete=models.CASCADE, related_name='hosted_live_rooms')
    is_active = models.BooleanField(default=False)
    mode = models.CharField(max_length=10, default='video')  # video | audio
    theme = models.CharField(max_length=32, default='neon')
    pinned_message = models.TextField(blank=True, default='')
    last_url = models.TextField(blank=True, default='')
    participant_count = models.PositiveIntegerField(default=0)
    last_seen_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-last_seen_at']

    def __str__(self):
        return f"{self.room_id} ({self.title})"
