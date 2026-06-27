from rest_framework import viewsets
from rest_framework.permissions import AllowAny
from api.models import Course
from api.serializers import CourseSerializer

class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all().order_by('id')
    serializer_class = CourseSerializer
    permission_classes = [AllowAny]
