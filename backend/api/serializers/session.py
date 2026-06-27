from rest_framework import serializers
from api.models import SessionMemory

class SessionMemorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SessionMemory
        fields = '__all__'
