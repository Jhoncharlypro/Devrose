import os
import django
import sys

# Add the backend directory to sys.path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'devrose_backend.settings')
django.setup()

from api.models import Course
from django.contrib.auth.models import User
from api.models import Profile

# Demo accounts (see .env for matching tokens). Demo creds are intentionally simple
# so reviewers / testers can log in fast and inspect the new Kot3Chat features
# (image attach, reply-to, edit, real-time delivery ticks, dark mode, scroll FAB).
DEMO_ACCOUNTS = [
    {'username': 'demo_student',  'password': 'devrose2026', 'first_name': 'Demo',   'last_name': 'Student', 'is_staff': False},
    {'username': 'demo_teacher',  'password': 'devrose2026', 'first_name': 'Demo',   'last_name': 'Teacher', 'is_staff': True},
    {'username': 'demo_admin',    'password': 'devrose2026', 'first_name': 'Demo',   'last_name': 'Admin',   'is_staff': True},
    {'username': 'visitor_jane',  'password': 'jane2026',    'first_name': 'Jane',   'last_name': 'Visitor', 'is_staff': False},
]

def seed_users():
    for acc in DEMO_ACCOUNTS:
        user, created = User.objects.get_or_create(
            username=acc['username'],
            defaults={
                'first_name': acc['first_name'],
                'last_name': acc['last_name'],
                'is_staff': acc['is_staff'],
                'email': f"{acc['username']}@devrose.local",
            },
        )
        user.set_password(acc['password'])
        user.is_staff = acc['is_staff']
        user.save()
        Profile.objects.get_or_create(user=user)
        print(f"  {'+ created' if created else '~ updated'}: {acc['username']} / {acc['password']}")
    print(f"Database seeded with {len(DEMO_ACCOUNTS)} demo users.")


def seed_courses():
    courses_data = [
        {
            "title": "Linux System Control (Command)",
            "description": "Master the terminal and server administration. Learn SSH, permissions, and shell scripting.",
            "price": 45.00,
            "image_url": "https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&w=600&q=80",
            "is_featured": True,
            "syllabus": ["Intro & Installation", "Navigation & File Mgmt", "Permissions & Security", "Admin & SSH"]
        },
        {
            "title": "Python Pro (Automation)",
            "description": "Create scripts to automate your work. Learn programming basics, data structures, and APIs.",
            "price": 55.00,
            "image_url": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80",
            "is_featured": True,
            "syllabus": ["Programming Basics", "Functions & Data Structures", "File Mgmt & Automation", "API Communication"]
        },
        {
            "title": "React JS Framework",
            "description": "Build modern and fast web applications. Become an expert in creating modern interfaces.",
            "price": 75.00,
            "image_url": "https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=600&q=80",
            "is_featured": True,
            "syllabus": ["Config & Components", "State & Props", "API Fetching & useEffect", "Routing & Deployment"]
        },
        {
            "title": "Web Development (HTML/CSS)",
            "description": "Learn the basics of professional website creation with HTML5 and CSS3.",
            "price": 60.00,
            "image_url": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=600&q=80",
            "is_featured": False,
            "syllabus": ["HTML5 Structure", "CSS3 Styling", "Responsive Design", "Landing Page Project"]
        }
    ]

    for data in courses_data:
        Course.objects.update_or_create(
            title=data['title'],
            defaults=data
        )
    print("Database seeded successfully with courses!")

if __name__ == "__main__":
    seed_courses()
    seed_users()
