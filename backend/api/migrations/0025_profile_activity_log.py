"""
0022 — ProfileActivityLog model

Adds the ``ProfileActivityLog`` table that powers the Activity
Timeline UI in ``src/components/kot3/Kot3Profile.jsx``. The model
records:
  - ``user``      — the profile owner whose timeline the event belongs to
  - ``action``    — stable string identifier (see model docstring)
  - ``details``   — JSON blob for action-specific data
  - ``created_at`` — event timestamp (indexed)

The model is read-only from the API perspective — entries are
written exclusively from the server side via the
``record_activity`` helper in ``api/views/profile.py`` so users can
never tamper with their own log via the REST surface.
"""
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0024_kot3_privacy_toggles'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProfileActivityLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(max_length=40)),
                ('details', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='profile_activity',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='profileactivitylog',
            index=models.Index(fields=['user', '-created_at'], name='profile_act_user_idx'),
        ),
        migrations.AddIndex(
            model_name='profileactivitylog',
            index=models.Index(fields=['action'], name='profile_act_action_idx'),
        ),
    ]
