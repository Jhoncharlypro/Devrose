from django.db import models
from django.contrib.auth.models import User

class SessionMemory(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    last_activity = models.DateTimeField(auto_now=True)
    terminal_state = models.JSONField(default=dict, blank=True)
    current_tab = models.CharField(max_length=50, default='commerce')

    def __str__(self):
        return f"Session for {self.user.username}"
