"""
Part 6 — Enterprise admin / moderation / security surface.

Adds 7 new tables for the admin dashboard, user management,
content moderation, report system, security center, broadcast
notifications, and login-attempt tracking.

Index strategy
--------------
  * adminrole_user_role_idx  - "what roles does user X hold?"
  * usersess_active_idx      - "list active sessions for user X"
  * usersess_jti_idx         - JWT validate-by-jti lookup
  * bannedip_active_idx      - middleware block-list scan
  * ban_user_time_idx        - ban history per user
  * ban_until_idx            - janitor: lift expired bans
  * broadcast_active_idx     - "show active broadcast for user"
  * login_user_time_idx      - login history per user
  * login_ip_time_idx        - failed-login pattern per IP
  * login_success_idx        - security center: failed login count
  * report_target_idx        - moderation queue filter
  * report_status_idx        - moderation queue: open vs resolved
"""
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0017_part5_premium_features'),
    ]

    operations = [
        # 1. AdminRole ----------------------------------------------------
        migrations.CreateModel(
            name='AdminRole',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('role', models.CharField(
                    choices=[
                        ('super_admin', 'Super Administrator'),
                        ('admin', 'Administrator'),
                        ('moderator', 'Moderator'),
                        ('support', 'Support Agent'),
                        ('content_mod', 'Content Moderator'),
                        ('viewer', 'Viewer'),
                    ],
                    max_length=15,
                )),
                ('permissions', models.JSONField(blank=True, default=dict)),
                ('granted_at', models.DateTimeField(auto_now_add=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('reason', models.CharField(blank=True, default='', max_length=255)),
                ('granted_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='admin_roles_granted',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='admin_roles',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-granted_at']},
        ),
        migrations.AddConstraint(
            model_name='adminrole',
            constraint=models.UniqueConstraint(
                fields=('user', 'role'), name='unique_user_role',
            ),
        ),
        migrations.AddIndex(
            model_name='adminrole',
            index=models.Index(
                fields=['user', 'role'], name='adminrole_user_role_idx',
            ),
        ),

        # 2. UserSession --------------------------------------------------
        migrations.CreateModel(
            name='UserSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('jti', models.CharField(
                    help_text='JWT identifier (claim "jti"). Unique per token.',
                    max_length=64,
                )),
                ('device_label', models.CharField(blank=True, default='', max_length=120)),
                ('device_kind', models.CharField(blank=True, default='', max_length=20)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, default='', max_length=255)),
                ('is_active', models.BooleanField(default=True)),
                ('last_seen', models.DateTimeField(auto_now=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('revoked_reason', models.CharField(blank=True, default='', max_length=120)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='sessions',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-last_seen']},
        ),
        migrations.AddConstraint(
            model_name='usersession',
            constraint=models.UniqueConstraint(
                fields=('jti',), name='unique_session_jti',
            ),
        ),
        migrations.AddIndex(
            model_name='usersession',
            index=models.Index(
                fields=['user', 'is_active', '-last_seen'],
                name='usersess_active_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='usersession',
            index=models.Index(fields=['jti'], name='usersess_jti_idx'),
        ),

        # 3. BannedIP -----------------------------------------------------
        migrations.CreateModel(
            name='BannedIP',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('ip_address', models.GenericIPAddressField()),
                ('reason', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('banned_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='ips_banned',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='bannedip',
            constraint=models.UniqueConstraint(
                fields=('ip_address',), name='unique_banned_ip',
            ),
        ),
        migrations.AddIndex(
            model_name='bannedip',
            index=models.Index(
                fields=['is_active', '-created_at'],
                name='bannedip_active_idx',
            ),
        ),

        # 4. BannedUser ---------------------------------------------------
        migrations.CreateModel(
            name='BannedUser',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('reason', models.CharField(
                    choices=[
                        ('spam', 'Spam'),
                        ('abuse', 'Abusive language'),
                        ('impersonation', 'Impersonation'),
                        ('illegal', 'Illegal content'),
                        ('harassment', 'Harassment'),
                        ('csam', 'Child safety'),
                        ('other', 'Other'),
                    ],
                    max_length=15,
                )),
                ('details', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('banned_until', models.DateTimeField(blank=True, null=True)),
                ('lifted_at', models.DateTimeField(blank=True, null=True)),
                ('lift_reason', models.CharField(blank=True, default='', max_length=255)),
                ('banned_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='bans_issued',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('lifted_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='bans_lifted',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bans',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='banneduser',
            index=models.Index(
                fields=['user', '-created_at'],
                name='ban_user_time_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='banneduser',
            index=models.Index(
                fields=['banned_until'],
                name='ban_until_idx',
            ),
        ),

        # 5. AdminBroadcast ----------------------------------------------
        migrations.CreateModel(
            name='AdminBroadcast',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('severity', models.CharField(
                    choices=[
                        ('info', 'Info'),
                        ('warning', 'Warning'),
                        ('critical', 'Critical'),
                    ],
                    default='info',
                    max_length=10,
                )),
                ('message', models.TextField()),
                ('starts_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('ends_at', models.DateTimeField(blank=True, null=True)),
                ('audience', models.CharField(
                    choices=[
                        ('all', 'All users'),
                        ('staff', 'Staff / admin only'),
                        ('premium', 'Premium users only'),
                    ],
                    default='all',
                    max_length=10,
                )),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='broadcasts_created',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='adminbroadcast',
            index=models.Index(
                fields=['is_active', '-created_at'],
                name='broadcast_active_idx',
            ),
        ),

        # 6. LoginAttempt -------------------------------------------------
        migrations.CreateModel(
            name='LoginAttempt',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('username', models.CharField(max_length=150)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, default='', max_length=255)),
                ('success', models.BooleanField(default=False)),
                ('failure_reason', models.CharField(blank=True, default='', max_length=60)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='login_attempts',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='loginattempt',
            index=models.Index(
                fields=['user', '-created_at'],
                name='login_user_time_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='loginattempt',
            index=models.Index(
                fields=['ip_address', '-created_at'],
                name='login_ip_time_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='loginattempt',
            index=models.Index(
                fields=['success', '-created_at'],
                name='login_success_idx',
            ),
        ),

        # 7. Report -------------------------------------------------------
        migrations.CreateModel(
            name='Report',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('target_type', models.CharField(
                    choices=[
                        ('message', 'Message'),
                        ('image', 'Image'),
                        ('video', 'Video'),
                        ('voice', 'Voice message'),
                        ('profile', 'Profile'),
                        ('group', 'Group'),
                        ('call', 'Call'),
                    ],
                    max_length=10,
                )),
                ('target_id', models.BigIntegerField()),
                ('reason', models.CharField(
                    choices=[
                        ('spam', 'Spam'),
                        ('harassment', 'Harassment'),
                        ('fake_profile', 'Fake profile'),
                        ('violence', 'Violence'),
                        ('scam', 'Scam'),
                        ('illegal', 'Illegal content'),
                        ('copyright', 'Copyright'),
                        ('other', 'Other'),
                    ],
                    max_length=15,
                )),
                ('description', models.TextField(blank=True, default='')),
                ('resolved', models.BooleanField(default=False)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('resolution_note', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('reported_user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='reports_received',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('reporter', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='reports_filed',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('resolved_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='reports_resolved',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='report',
            constraint=models.UniqueConstraint(
                fields=('reporter', 'target_type', 'target_id', 'reason'),
                name='unique_report_per_target',
            ),
        ),
        migrations.AddIndex(
            model_name='report',
            index=models.Index(
                fields=['target_type', 'target_id'],
                name='report_target_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='report',
            index=models.Index(
                fields=['resolved', '-created_at'],
                name='report_status_idx',
            ),
        ),
    ]
