from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from api.serializers import UserSerializer
from api.models import Profile

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_profile(request):
    # Ensure profile exists and fetch it
    Profile.objects.get_or_create(user=request.user)
    # Refresh user from DB to include the profile relation
    user = User.objects.select_related('profile').get(id=request.user.id)
    serializer = UserSerializer(user)
    return Response(serializer.data)

@api_view(['POST'])
@permission_classes([AllowAny])
def signup(request):
    serializer = UserSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        Profile.objects.get_or_create(user=user)
        # Fetch fresh user with profile
        user = User.objects.select_related('profile').get(id=user.id)
        token, created = Token.objects.get_or_create(user=user)
        return Response({
            'token': token.key,
            'user': UserSerializer(user).data
        }, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    username = request.data.get('username')
    password = request.data.get('password')
    user = authenticate(username=username, password=password)
    if user:
        Profile.objects.get_or_create(user=user)
        # Fetch fresh user with profile
        user = User.objects.select_related('profile').get(id=user.id)
        token, created = Token.objects.get_or_create(user=user)
        serializer = UserSerializer(user)
        return Response({
            'token': token.key,
            'user': serializer.data
        })
    return Response({'error': 'Invalid Credentials'}, status=status.HTTP_400_BAD_REQUEST)
