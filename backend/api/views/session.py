from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action
from api.models import SessionMemory
from api.serializers import SessionMemorySerializer

class SessionMemoryViewSet(viewsets.ModelViewSet):
    serializer_class = SessionMemorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SessionMemory.objects.filter(user=self.request.user)

    @action(detail=False, methods=['get', 'put', 'patch'])
    def me(self, request):
        session, created = SessionMemory.objects.get_or_create(user=request.user)
        if request.method == 'GET':
            serializer = self.get_serializer(session)
            return Response(serializer.data)
        
        serializer = self.get_serializer(session, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
