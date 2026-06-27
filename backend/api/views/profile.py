from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action
from api.models import Profile
from api.serializers.user import ProfileSerializer

class ProfileViewSet(viewsets.ModelViewSet):
    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Profile.objects.filter(user=self.request.user)

    @action(detail=False, methods=['get', 'put', 'patch'])
    def me(self, request):
        try:
            # Use user_id to avoid issues with lazy objects
            profile, created = Profile.objects.get_or_create(user_id=request.user.id)
            
            if request.method == 'GET':
                serializer = self.get_serializer(profile)
                return Response(serializer.data)
            
            # For PUT/PATCH, handle update
            username = request.data.get('username')
            if username is not None:
                username = username.strip()
                is_ht = request.query_params.get('lang') == 'ht' or request.data.get('lang') == 'ht'
                if not username:
                    error_msg = 'Non itilizatè a pa ka vid.' if is_ht else 'Username cannot be empty.'
                    return Response({'error': error_msg}, status=status.HTTP_400_BAD_REQUEST)
                from django.contrib.auth.models import User
                if User.objects.exclude(id=request.user.id).filter(username__iexact=username).exists():
                    error_msg = 'Non itilizatè sa a deja pran.' if is_ht else 'Username already taken.'
                    return Response({'error': error_msg}, status=status.HTTP_400_BAD_REQUEST)
                request.user.username = username
                request.user.save()

            serializer = self.get_serializer(profile, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            
            # Log validation errors for debugging
            print(f"Profile validation errors: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
        except Exception as e:
            # Detailed error logging
            import traceback
            error_msg = f"Profile update error: {str(e)}\n{traceback.format_exc()}"
            print(error_msg)
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
