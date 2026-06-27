from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class ChatThread(models.Model):
    participants = models.ManyToManyField(User, related_name='chat_threads')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"Thread {self.id}"

class Message(models.Model):
    thread = models.ForeignKey(ChatThread, related_name='messages', on_delete=models.CASCADE)
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField(blank=True, default='')
    audio = models.TextField(blank=True, default='')          # base64 voice notes
    image = models.TextField(blank=True, default='')           # base64 image attachments
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    is_read = models.BooleanField(default=False)
    is_delivered = models.BooleanField(default=False)
    is_edited = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Msg {self.id} by {self.sender.username}"

class UserStory(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='stories')
    type = models.CharField(max_length=10, default='text') # 'text' or 'image'
    content = models.TextField()
    background = models.CharField(max_length=100, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Story {self.id} by {self.user.username}"
