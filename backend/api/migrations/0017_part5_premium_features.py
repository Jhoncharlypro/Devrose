"""
Part 5 — premium messenger features.

Adds 7 new tables (smart-reply cache, scheduled messages, chat
folders + memberships, premium subscription history, spam reports,
backup archives) and 4 new fields on existing models:

  Message (chat.Message):
    expires_at    - DateTimeField, NULL by default. Swept by
                    ``cleanup_expired`` management command.
    is_ephemeral  - Boolean, denormalized flag so the FE can render
                    a "disappearing" badge without a NULL check.

  Profile (profile.Profile):
    is_premium    - Boolean, hot-path flag for every "show premium
                    badge?" decision.
    premium_until - DateTimeField, NULL by default. Flipped in
                    ``PremiumSubscriptionViewSet`` activation/cancel.

Index strategy:
  * ``msg_ephemeral_idx`` (is_ephemeral, expires_at) — janitor sweep
    is O(matches), not a full table scan.
  * ``smartreply_ttl_idx`` on expires_at — cache eviction is a
    one-shot DELETE.
  * ``sched_status_time_idx`` (status, send_at) — the worker's hot
    scan for "pending sends whose time has come" is a single B-tree
    walk.
  * ``premium_user_time_idx`` (user, -started_at) — subscription
    history pagination.
  * ``spamreport_target_idx`` / ``spamreport_status_idx`` — both
    moderation query paths.
  * ``backup_user_time_idx`` — backup list pagination.
"""
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0016_part4_panel_backends'),
    ]

    operations = [
        # ------------------------------------------------------------------
        # 1. Extend Message with disappearing-message fields
        # ------------------------------------------------------------------
        migrations.AddField(
            model_name='message',
            name='expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='is_ephemeral',
            field=models.BooleanField(
                default=False,
                help_text='True for messages with an expires_at deadline. Lets the '
                          'FE show a "disappearing" badge without a NULL check.',
            ),
        ),
        migrations.AddIndex(
            model_name='message',
            index=models.Index(
                fields=['is_ephemeral', 'expires_at'],
                name='msg_ephemeral_idx',
            ),
        ),

        # ------------------------------------------------------------------
        # 2. Extend Profile with premium flags
        # ------------------------------------------------------------------
        migrations.AddField(
            model_name='profile',
            name='is_premium',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='profile',
            name='premium_until',
            field=models.DateTimeField(blank=True, null=True),
        ),

        # ------------------------------------------------------------------
        # 3. SmartReplyCache
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='SmartReplyCache',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('suggestions', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(
                    help_text='After this time, regenerate on next request.',
                )),
                ('for_user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='smart_reply_cache',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('source_message', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='smart_reply_rows',
                    to='api.message',
                )),
                ('thread', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='smart_reply_cache',
                    to='api.chatthread',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='smartreplycache',
            constraint=models.UniqueConstraint(
                fields=('thread', 'source_message', 'for_user'),
                name='unique_smart_reply_per_user',
            ),
        ),
        migrations.AddIndex(
            model_name='smartreplycache',
            index=models.Index(fields=['expires_at'], name='smartreply_ttl_idx'),
        ),

        # ------------------------------------------------------------------
        # 4. ScheduledMessage
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ScheduledMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('content', models.TextField(blank=True, default='')),
                ('audio', models.TextField(blank=True, default='')),
                ('image', models.TextField(blank=True, default='')),
                ('send_at', models.DateTimeField(
                    help_text='UTC timestamp when the worker should promote this '
                              'to a real Message row.',
                )),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'pending'),
                        ('sent', 'sent'),
                        ('cancelled', 'cancelled'),
                        ('failed', 'failed'),
                    ],
                    default='pending',
                    max_length=10,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('promoted_message', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='promoted_from_schedules',
                    to='api.message',
                )),
                ('reply_to', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='scheduled_replies',
                    to='api.message',
                )),
                ('sender', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='scheduled_messages',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('thread', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='scheduled_messages',
                    to='api.chatthread',
                )),
            ],
            options={
                'ordering': ['send_at'],
            },
        ),
        migrations.AddIndex(
            model_name='scheduledmessage',
            index=models.Index(
                fields=['status', 'send_at'],
                name='sched_status_time_idx',
            ),
        ),

        # ------------------------------------------------------------------
        # 5. ChatFolder
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ChatFolder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=60)),
                ('color', models.CharField(blank=True, default='', max_length=20)),
                ('sort_order', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='chat_folders',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['sort_order', 'name'],
            },
        ),
        migrations.AddConstraint(
            model_name='chatfolder',
            constraint=models.UniqueConstraint(
                fields=('user', 'name'),
                name='unique_folder_per_user',
            ),
        ),
        migrations.AddIndex(
            model_name='chatfolder',
            index=models.Index(
                fields=['user', 'sort_order'],
                name='folder_user_order_idx',
            ),
        ),

        # ------------------------------------------------------------------
        # 6. ChatFolderMembership
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ChatFolderMembership',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('added_at', models.DateTimeField(auto_now_add=True)),
                ('folder', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='memberships',
                    to='api.chatfolder',
                )),
                ('thread', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='folder_memberships',
                    to='api.chatthread',
                )),
            ],
            options={
                'ordering': ['added_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='chatfoldermembership',
            constraint=models.UniqueConstraint(
                fields=('folder', 'thread'),
                name='unique_folder_thread',
            ),
        ),
        migrations.AddIndex(
            model_name='chatfoldermembership',
            index=models.Index(fields=['thread'], name='folderthread_thread_idx'),
        ),

        # ------------------------------------------------------------------
        # 7. PremiumSubscription
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='PremiumSubscription',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('plan', models.CharField(
                    choices=[
                        ('monthly', 'Monthly'),
                        ('quarterly', 'Quarterly'),
                        ('yearly', 'Yearly'),
                        ('lifetime', 'Lifetime'),
                    ],
                    max_length=10,
                )),
                ('status', models.CharField(
                    choices=[
                        ('active', 'active'),
                        ('cancelled', 'cancelled'),
                        ('expired', 'expired'),
                        ('refunded', 'refunded'),
                    ],
                    default='active',
                    max_length=10,
                )),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('payment_ref', models.CharField(blank=True, default='', max_length=40)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='premium_subscriptions',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-started_at'],
            },
        ),
        migrations.AddIndex(
            model_name='premiumsubscription',
            index=models.Index(
                fields=['user', '-started_at'],
                name='premium_user_time_idx',
            ),
        ),

        # ------------------------------------------------------------------
        # 8. SpamReport
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='SpamReport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('reason', models.CharField(
                    choices=[
                        ('spam', 'Spam'),
                        ('scam', 'Scam / phishing'),
                        ('abuse', 'Abusive language'),
                        ('impersonation', 'Impersonation / fake account'),
                        ('mass_message', 'Mass / bot messaging'),
                        ('other', 'Other'),
                    ],
                    max_length=15,
                )),
                ('description', models.TextField(blank=True, default='')),
                ('heuristic_score', models.PositiveIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('resolved', models.BooleanField(default=False)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('resolution_note', models.CharField(blank=True, default='', max_length=255)),
                ('message', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='spam_reports',
                    to='api.message',
                )),
                ('reporter', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='spam_reports_filed',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('reported_user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='spam_reports_received',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='spamreport',
            constraint=models.UniqueConstraint(
                fields=('reporter', 'message', 'reason'),
                name='unique_spam_report_per_user',
            ),
        ),
        migrations.AddIndex(
            model_name='spamreport',
            index=models.Index(
                fields=['reported_user', '-created_at'],
                name='spamreport_target_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='spamreport',
            index=models.Index(
                fields=['resolved', '-created_at'],
                name='spamreport_status_idx',
            ),
        ),

        # ------------------------------------------------------------------
        # 9. BackupArchive
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='BackupArchive',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('payload_hash', models.CharField(max_length=64)),
                ('payload_summary', models.JSONField(blank=True, default=dict)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('payload_bytes', models.PositiveIntegerField(default=0)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='backup_archives',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='backuparchive',
            index=models.Index(
                fields=['user', '-created_at'],
                name='backup_user_time_idx',
            ),
        ),
    ]
