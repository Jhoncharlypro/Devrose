"""
Migration 0016 — Part 4 backend panels.

Adds five tables that back the premium panels built in Parts 1-3:

  * AuditLog       (actor, action, target_type, target_id, metadata,
                    ip_address, user_agent, created_at)
  * CallLog        (caller, callee, kind, status, duration, started_at,
                    ended_at)
  * ChatGroup      (name, description, avatar, is_public, created_by,
                    created_at, updated_at)
  * ChatGroupMember (group, user, role, joined_at)  -- UNIQUE(group,user)
  * PinnedMessage  (thread, message, pinned_by, pinned_at) UNIQUE(thread,message)

Why one migration?  Each table is brand-new (no ALTER, no
data back-fill) and they all land in the same release. Splitting
across 0017/0018 would force operators to wait on five sequential
DDL rollouts for no gain.

Forward path: all adds, no destructives. Safe to apply / re-apply
on a Postgres Transaction-mode pooler (PgBouncer accepts single-
statement DDL transactions without issue).

Backward path: drop the tables in reverse order to undo (PinnedMessage
→ ChatGroupMember → ChatGroup → CallLog → AuditLog). Cascade from
ChatGroup to ChatGroupMember has CASCADE, so a group drop also drops
memberships — expected behaviour.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        # 0015 is the most recent migration in the api app. Anything
        # earlier (auth_user, ChatThread, Message, User, Profile) is
        # transitively satisfied.
        ('api', '0015_media_to_supabase_storage'),
    ]

    operations = [
        # ── 1. AuditLog ─────────────────────────────────────────────
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(max_length=64)),
                ('target_type', models.CharField(blank=True, default='', max_length=32)),
                ('target_id', models.BigIntegerField(blank=True, null=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actor', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='audit_logs',
                    to='auth.user',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['action', '-created_at'], name='audit_action_time_idx'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['actor', '-created_at'], name='audit_actor_time_idx'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['target_type', 'target_id'], name='audit_target_idx'),
        ),

        # ── 2. CallLog ──────────────────────────────────────────────
        migrations.CreateModel(
            name='CallLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('audio', 'audio'), ('video', 'video')], default='audio', max_length=10)),
                ('status', models.CharField(choices=[
                    ('incoming', 'incoming'),
                    ('outgoing', 'outgoing'),
                    ('missed', 'missed'),
                    ('rejected', 'rejected'),
                    ('completed', 'completed'),
                    ('failed', 'failed'),
                ], default='outgoing', max_length=10)),
                ('duration', models.PositiveIntegerField(default=0)),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('ended_at', models.DateTimeField(blank=True, null=True)),
                ('caller', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='calls_initiated',
                    to='auth.user',
                )),
                ('callee', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='calls_received',
                    to='auth.user',
                )),
            ],
            options={
                'ordering': ['-started_at'],
            },
        ),
        migrations.AddIndex(
            model_name='calllog',
            index=models.Index(fields=['caller', '-started_at'], name='call_caller_time_idx'),
        ),
        migrations.AddIndex(
            model_name='calllog',
            index=models.Index(fields=['callee', '-started_at'], name='call_callee_time_idx'),
        ),
        migrations.AddIndex(
            model_name='calllog',
            index=models.Index(fields=['status', '-started_at'], name='call_status_time_idx'),
        ),

        # ── 3. ChatGroup ────────────────────────────────────────────
        migrations.CreateModel(
            name='ChatGroup',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('description', models.TextField(blank=True, default='')),
                ('avatar', models.TextField(blank=True, null=True)),
                ('is_public', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='groups_created',
                    to='auth.user',
                )),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),
        migrations.AddIndex(
            model_name='chatgroup',
            index=models.Index(fields=['-updated_at'], name='group_updated_idx'),
        ),
        migrations.AddIndex(
            model_name='chatgroup',
            index=models.Index(fields=['is_public'], name='group_public_idx'),
        ),

        # ── 4. ChatGroupMember ──────────────────────────────────────
        migrations.CreateModel(
            name='ChatGroupMember',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(
                    choices=[('owner', 'Owner'), ('admin', 'Admin'), ('mod', 'Moderator'), ('member', 'Member')],
                    default='member', max_length=10,
                )),
                ('joined_at', models.DateTimeField(auto_now_add=True)),
                ('group', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='memberships',
                    to='api.chatgroup',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='chat_group_memberships',
                    to='auth.user',
                )),
            ],
            options={
                'ordering': ['joined_at'],
                'unique_together': {('group', 'user')},
            },
        ),
        migrations.AddIndex(
            model_name='chatgroupmember',
            index=models.Index(fields=['group', 'role', 'joined_at'], name='groupmember_role_idx'),
        ),
        migrations.AddIndex(
            model_name='chatgroupmember',
            index=models.Index(fields=['user', 'group'], name='groupmember_user_idx'),
        ),

        # ── 5. PinnedMessage ────────────────────────────────────────
        migrations.CreateModel(
            name='PinnedMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('pinned_at', models.DateTimeField(auto_now_add=True)),
                ('thread', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='pinned_messages',
                    to='api.chatthread',
                )),
                ('message', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='pin_rows',
                    to='api.message',
                )),
                ('pinned_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='pinned_actions',
                    to='auth.user',
                )),
            ],
            options={
                'ordering': ['-pinned_at'],
                'unique_together': {('thread', 'message')},
            },
        ),
        migrations.AddIndex(
            model_name='pinnedmessage',
            index=models.Index(fields=['thread', '-pinned_at'], name='pin_thread_time_idx'),
        ),
    ]
