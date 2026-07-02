"""
Phase 9 — Real features bring-up.

Single migration that delivers every schema change for the four-feature
bundle selected in the alignment session:

  • Delete-for-everyone (soft delete)
  • Disappearing messages UI (already had expires_at/is_ephemeral)
  • CallLog model (server-side author of call history)
  • ChatThread.is_group + .name (group chat support)
  • UserThreadSetting (per-user pinned/archived/muted_until)
  • Message.document / document_name (file attachments)
  • Message.location_lat / location_lng / location_name (geo pin)

All operations use postgres-safe + sqlite-safe defaults so the same
migration runs cleanly on dev (SQLite) and prod (Supabase Postgres).
The whole migration is split into ordered ``operations`` blocks so a
mid-migration error leaves the DB in a recoverable state when running
``migrate`` one operation at a time.

Forward operations
  1. Add per-thread prefs model ``UserThreadSetting``
  2. Add ``is_group`` + ``name`` to ChatThread
  3. Add ``deleted_at`` + ``deleted_by`` to Message
  4. Add ``document`` + ``document_name`` to Message
  5. Add lat/lng/name location to Message

Reverse operations are the exact inverse.
"""
from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0019_part8_production'),
    ]

    operations = [
        # ──────────────────────────────────────────────────────────
        # 1. New model: UserThreadSetting (per-user thread preferences)
        # ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='UserThreadSetting',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('is_pinned', models.BooleanField(default=False)),
                ('is_archived', models.BooleanField(default=False)),
                ('muted_until', models.DateTimeField(blank=True, null=True)),
                ('is_request_ignored', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='thread_settings',
                    to='auth.user',
                )),
                ('thread', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='settings',
                    to='api.chatthread',
                )),
            ],
            options={},
        ),
        migrations.AddConstraint(
            model_name='userthreadsetting',
            constraint=models.UniqueConstraint(
                fields=('user', 'thread'),
                name='unique_user_thread_setting',
            ),
        ),
        migrations.AddIndex(
            model_name='userthreadsetting',
            index=models.Index(fields=['user', 'is_pinned'], name='usrthread_pin_idx'),
        ),
        migrations.AddIndex(
            model_name='userthreadsetting',
            index=models.Index(fields=['user', 'is_archived'], name='usrthread_arch_idx'),
        ),

        # NOTE: CallLog already lives in part4 (api.models.part4.CallLog) with
        # ``kind`` / ``duration`` / ``status`` enums and was migrated earlier.
        # We REUSE that table — a second CreateModel with the same name would
        # collide on SQLite's name resolution and crash ``migrate``. The
        # CallLogSerializer, CallLogViewSet, and the WS consumer's
        # ``_persist_call_attempt`` helper all read from ``part4.CallLog``.

        # ──────────────────────────────────────────────────────────
        # 2. ChatThread.is_group + .name
        # ──────────────────────────────────────────────────────────
        migrations.AddField(
            model_name='chatthread',
            name='is_group',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='chatthread',
            name='name',
            field=models.CharField(blank=True, default='', max_length=100),
        ),

        # ──────────────────────────────────────────────────────────
        # 4. Message.deleted_at + .deleted_by (soft delete)
        # ──────────────────────────────────────────────────────────
        migrations.AddField(
            model_name='message',
            name='deleted_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='deleted_by',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=models.SET_NULL,
                related_name='deleted_messages',
                to='auth.user',
            ),
        ),
        migrations.AddIndex(
            model_name='message',
            index=models.Index(fields=['thread', 'deleted_at'], name='msg_thread_visible_idx'),
        ),

        # ──────────────────────────────────────────────────────────
        # 5. Message.document + document_name
        # ──────────────────────────────────────────────────────────
        migrations.AddField(
            model_name='message',
            name='document',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='message',
            name='document_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),

        # ──────────────────────────────────────────────────────────
        # 6. Message location: lat/lng/name
        # ──────────────────────────────────────────────────────────
        migrations.AddField(
            model_name='message',
            name='location_lat',
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='location_lng',
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='location_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
    ]
