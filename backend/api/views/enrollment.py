from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from api.models import Enrollment
from api.serializers import EnrollmentSerializer

class EnrollmentViewSet(viewsets.ModelViewSet):
    serializer_class = EnrollmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Enrollment.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
