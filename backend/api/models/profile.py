from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.TextField(null=True, blank=True) # Stores Base64
    bio = models.TextField(max_length=500, blank=True)
    status_text = models.CharField(max_length=255, blank=True, default='')
    last_seen = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile for {self.user.username}"
