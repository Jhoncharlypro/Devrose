"""
Part 8 — Production / DevOps / Monitoring migration.

Adds 7 new tables (AnalyticsEvent, JobQueue, MediaAsset,
MaintenanceWindow, RateLimitBucket, SecurityAlert,
DeploymentEvent) + 1 supporting table (IPGeolocation for the
impossible-travel detector). Every table has a composite index on
its hot-path query columns so the daily sweep queries stay O(matches)
instead of triggering full-table scans.

Order of CreateModel operations matches ``api/models/part8.py`` so
forward + reverse migrations are mirror images.
"""
from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0018_part6_admin'),
    ]

    operations = [
        migrations.CreateModel(
            name='AnalyticsEvent',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[
                    ('app_open', 'App Open'),
                    ('message_sent', 'Message Sent'),
                    ('call_audio', 'Audio Call'),
                    ('call_video', 'Video Call'),
                    ('media_upload', 'Media Upload'),
                    ('login_success', 'Login Success'),
                    ('crash', 'Crash'),
                    ('page_view', 'Page View'),
                ], db_index=True, max_length=32)),
                ('attributes', models.JSONField(blank=True, default=dict)),
                ('latency_ms', models.PositiveIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(
                    blank=True, null=True, on_delete=models.SET_NULL,
                    related_name='analytics_events', to='auth.user',
                )),
            ],
            options={'indexes': [
                models.Index(fields=['kind', '-created_at'], name='analytics_kind_time_idx'),
                models.Index(fields=['user', '-created_at'], name='analytics_user_time_idx'),
                models.Index(fields=['-created_at'], name='analytics_time_idx'),
            ]},
        ),
        migrations.CreateModel(
            name='JobQueue',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('name', models.CharField(db_index=True, max_length=64)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('idempotency_key', models.CharField(blank=True, max_length=128, null=True, unique=True)),
                ('status', models.CharField(choices=[
                    ('pending', 'Pending'),
                    ('running', 'Running'),
                    ('done', 'Done'),
                    ('failed', 'Failed'),
                    ('dead', 'Dead'),
                ], db_index=True, default='pending', max_length=16)),
                ('run_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('locked_at', models.DateTimeField(blank=True, null=True)),
                ('locked_by', models.CharField(blank=True, default='', max_length=128)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('max_attempts', models.PositiveIntegerField(default=3)),
                ('last_error', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'indexes': [
                models.Index(fields=['status', 'run_at'], name='jobqueue_status_time_idx'),
                models.Index(fields=['name', 'status'], name='jobqueue_name_status_idx'),
                models.Index(fields=['-created_at'], name='jobqueue_created_idx'),
            ]},
        ),
        migrations.CreateModel(
            name='MediaAsset',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('kind', models.CharField(db_index=True, max_length=16)),
                ('bucket', models.CharField(db_index=True, max_length=64)),
                ('storage_path', models.CharField(db_index=True, max_length=512)),
                ('public_url', models.URLField(blank=True, default='', max_length=1024)),
                ('size_bytes', models.BigIntegerField(default=0)),
                ('mime_type', models.CharField(blank=True, default='', max_length=128)),
                ('sha256', models.CharField(blank=True, default='', max_length=64)),
                ('status', models.CharField(choices=[
                    ('uploaded', 'Uploaded'),
                    ('processed', 'Processed'),
                    ('failed', 'Failed'),
                ], db_index=True, default='uploaded', max_length=16)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('uploader', models.ForeignKey(
                    blank=True, null=True, on_delete=models.SET_NULL,
                    related_name='media_assets', to='auth.user',
                )),
            ],
            options={'indexes': [
                models.Index(fields=['uploader', '-created_at'], name='media_uploader_time_idx'),
                models.Index(fields=['kind', 'status'], name='media_kind_status_idx'),
                models.Index(fields=['sha256'], name='media_sha256_idx'),
            ]},
        ),
        migrations.CreateModel(
            name='MaintenanceWindow',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('scope', models.CharField(choices=[
                    ('read_only', 'Read-only'),
                    ('full_lockout', 'Full lockout'),
                ], default='read_only', max_length=16)),
                ('message', models.TextField(blank=True, default='')),
                ('starts_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('ends_at', models.DateTimeField(blank=True, null=True)),
                ('started_by', models.ForeignKey(
                    blank=True, null=True, on_delete=models.SET_NULL,
                    related_name='maintenance_started', to='auth.user',
                )),
                ('ended_by', models.ForeignKey(
                    blank=True, null=True, on_delete=models.SET_NULL,
                    related_name='maintenance_ended', to='auth.user',
                )),
            ],
            options={'indexes': [
                models.Index(fields=['is_active', '-starts_at'], name='maint_active_time_idx'),
            ]},
        ),
        migrations.CreateModel(
            name='RateLimitBucket',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('bucket', models.CharField(db_index=True, max_length=64)),
                ('key', models.CharField(db_index=True, max_length=128)),
                ('count', models.PositiveIntegerField(default=0)),
                ('window_start', models.DateTimeField(default=django.utils.timezone.now)),
                ('expires_at', models.DateTimeField(db_index=True)),
            ],
            options={'indexes': [
                models.Index(fields=['expires_at'], name='rate_expires_idx'),
            ]},
        ),
        migrations.AddConstraint(
            model_name='ratelimitbucket',
            constraint=models.UniqueConstraint(
                fields=('bucket', 'key'), name='rate_bucket_key_unique',
            ),
        ),
        migrations.CreateModel(
            name='SecurityAlert',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[
                    ('brute_force', 'Brute Force'),
                    ('impossible_travel', 'Impossible Travel'),
                    ('api_abuse', 'API Abuse'),
                    ('spam_attack', 'Spam Attack'),
                    ('bot_behavior', 'Bot Behavior'),
                ], db_index=True, max_length=32)),
                ('severity', models.CharField(choices=[
                    ('low', 'Low'),
                    ('medium', 'Medium'),
                    ('high', 'High'),
                    ('critical', 'Critical'),
                ], db_index=True, default='medium', max_length=16)),
                ('ip_address', models.GenericIPAddressField(blank=True, db_index=True, null=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('resolved', models.BooleanField(db_index=True, default=False)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('resolution_note', models.CharField(blank=True, default='', max_length=512)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(
                    blank=True, null=True, on_delete=models.SET_NULL,
                    related_name='security_alerts', to='auth.user',
                )),
                ('resolved_by', models.ForeignKey(
                    blank=True, null=True, on_delete=models.SET_NULL,
                    related_name='security_alerts_resolved', to='auth.user',
                )),
            ],
            options={'indexes': [
                models.Index(fields=['kind', '-created_at'], name='secalert_kind_time_idx'),
                models.Index(fields=['resolved', '-created_at'], name='secalert_status_time_idx'),
                models.Index(fields=['severity', 'resolved'], name='secalert_sev_resolved_idx'),
            ]},
        ),
        migrations.CreateModel(
            name='DeploymentEvent',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[
                    ('preflight', 'Preflight Check'),
                    ('deploy', 'Deploy'),
                    ('rollback', 'Rollback'),
                    ('migrate', 'Migration'),
                ], db_index=True, max_length=16)),
                ('environment', models.CharField(db_index=True, default='production', max_length=16)),
                ('status', models.CharField(choices=[
                    ('pending', 'Pending'),
                    ('running', 'Running'),
                    ('success', 'Success'),
                    ('failure', 'Failure'),
                    ('rolled_back', 'Rolled Back'),
                ], db_index=True, default='pending', max_length=16)),
                ('commit_sha', models.CharField(blank=True, default='', max_length=64)),
                ('actor', models.CharField(blank=True, default='', max_length=128)),
                ('notes', models.TextField(blank=True, default='')),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={'indexes': [
                models.Index(fields=['environment', '-created_at'], name='deploy_env_time_idx'),
                models.Index(fields=['kind', 'status'], name='deploy_kind_status_idx'),
            ]},
        ),
        migrations.CreateModel(
            name='IPGeolocation',
            fields=[
                ('ip_address', models.GenericIPAddressField(primary_key=True, serialize=False)),
                ('latitude', models.FloatField(blank=True, null=True)),
                ('longitude', models.FloatField(blank=True, null=True)),
                ('country', models.CharField(blank=True, default='', max_length=8)),
                ('city', models.CharField(blank=True, default='', max_length=128)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'indexes': [
                models.Index(fields=['country'], name='ipgeo_country_idx'),
            ]},
        ),
    ]
