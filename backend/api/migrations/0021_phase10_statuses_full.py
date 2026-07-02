"""
Phase 10 — Status (Stories) full schema.

Single migration that delivers:

  • ``UserStory.caption`` + ``extra_data`` + ``expires_at`` + ``privacy``
  • ``UserStory`` index pair (user, -created_at) + (-created_at)
  • New tables ``StatusMedia``, ``StatusView``, ``StatusReaction``,
    ``StatusPrivacyOverride`` — each with its own UniqueConstraint
    mirroring the Message-side pattern (see 0013 for the precedent).
  • New ``Message.reply_to_story`` FK + composite index.

All operations use postgres-safe + sqlite-safe defaults so the same
migration runs cleanly on dev (SQLite) and prod (supabase Postgres).
Forward operations are split into five dependency-respecting blocks so
a mid-migration error leaves the DB in a recoverable state when running
``migrate`` one operation at a time.

Forward operations
  1. UserStory column additions (caption, extra_data, expires_at, privacy)
  2. UserStory composite indexes
  3. CreateModel for 4 new tables + their UniqueConstraints + indexes
  4. Message.reply_to_story FK + composite index

Reverse operations are the exact inverse.
"""
from django.conf import settings
from django.db import migrations, models


# Literal copy of ``api.models.STATUS_PRIVACY_CHOICES``. Django serializes
# migration ``choices`` as a literal list, so the migration cannot import
# from the model module — the values MUST be duplicated here. If you
# rename a key on the model, mirror it here so migration reversibility
# stays intact. ADR-004 documents the rationale.
#
# Allowed keys (alphabetical — DO NOT REORDER; the order mirrors
# the surface grammar in chat.py ``STATUS_PRIVACY_CHOICES``):
#   contacts_only, everyone_except, hidden, only_share_with, public
STATUS_PRIVACY_CHOICES = [
    ('public',          'Public — everyone (who is not blocked)'),
    ('contacts_only',   'Contacts only'),
    ('everyone_except', 'Everyone except…'),
    ('only_share_with', 'Only share with…'),
    ('hidden',          'Hidden — explicitly only listed viewers'),
]


def _backfill_status_expires_at(apps, schema_editor):
    """
    One-shot data op: ``expires_at = created_at + 24h`` for every
    pre-Phase-10 UserStory row whose ``expires_at IS NULL``. Lets the
    janitor's ``WHERE expires_at < now()`` filter correctly sweep
    legacy rows on its next pass.

    Idempotent: re-running after a partial pass picks up remaining
    NULLs safely. Chunked iteration so a million-row table doesn't
    lock the DB on the first run.

    ``apps.get_model('api', 'userstory')`` returns the historical
    migration model — save() therefore matches the migration-state
    schema (no schema mismatch risks during the data backfill).
    """
    from datetime import timedelta
    UserStory = apps.get_model('api', 'userstory')
    TARGET_CHUNK = 5000
    total = 0
    while True:
        # ``values_list('id')`` doesn't materialize full rows; we re-fetch
        # per-row so concurrent workers / WS broadcasts racing the
        # backfill don't cause update_fields clobbers.
        chunk_ids = list(
            UserStory.objects.filter(expires_at__isnull=True)
            .values_list('id', flat=True)[:TARGET_CHUNK]
        )
        if not chunk_ids:
            break
        for story_id in chunk_ids:
            try:
                s = UserStory.objects.get(id=story_id, expires_at__isnull=True)
                s.expires_at = s.created_at + timedelta(hours=24)
                s.save(update_fields=['expires_at'])
                total += 1
            except UserStory.DoesNotExist:
                # raced: another worker / consumer filled expires_at first.
                pass
    if total:
        print(f'[0021] Backfilled expires_at on {total} pre-Phase-10 UserStory rows.')


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0020_phase9_real_features'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ──────────────────────────────────────────────────────────
        # 1. UserStory column additions
        #    Order is dictated by the migration's attribute-creation
        #    contract — Django doesn't depend on column-ad order, but
        #    logging readability matters. Newest at the bottom.
        # ──────────────────────────────────────────────────────────
        migrations.AddField(
            model_name='userstory',
            name='caption',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='userstory',
            name='extra_data',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='userstory',
            name='expires_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='userstory',
            name='privacy',
            field=models.CharField(
                choices=STATUS_PRIVACY_CHOICES,
                default='public',
                max_length=20,
            ),
        ),
        # Migration 0006 declared ``type`` as ``max_length=10``. Phase 10
        # widens to 16 so future content kinds ('document', 'carousel',
        # 'slideshow', 'voice_clip', ...) fit without another migration.
        # ``ALTER COLUMN`` is backward-compatible — no row rewrite.
        migrations.AlterField(
            model_name='userstory',
            name='type',
            field=models.CharField(default='text', max_length=16),
        ),

        # ──────────────────────────────────────────────────────────
        # 1b. Backfill ``expires_at`` for legacy rows.
        #     Without this, the janitor's ``WHERE expires_at < now()``
        #     filter skips pre-Phase-10 rows forever. We set
        #     ``expires_at = created_at + 24h`` so the next sweep
        #     normalises the cleanup timeline.
        # ──────────────────────────────────────────────────────────
        migrations.RunPython(
            code=_backfill_status_expires_at,
            reverse_code=migrations.RunPython.noop,
        ),

        # ──────────────────────────────────────────────────────────
        # 2. UserStory composite indexes
        #    (user, -created_at) → primary Home feed access path.
        #    (-created_at)        → cross-user recent feed.
        #    expires_at already has db_index=True from the column decl.
        #    Naming: ``status_*`` prefix chosen for parity with the side
        #    tables (statusmedia_* / statusview_* / statusreact_* /
        #    statusprivoverride_*) so the migration history is grammatically
        #    unified.
        # ──────────────────────────────────────────────────────────
        migrations.AddIndex(
            model_name='userstory',
            index=models.Index(
                fields=['user', '-created_at'],
                name='status_user_created_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='userstory',
            index=models.Index(
                fields=['-created_at'],
                name='status_recent_idx',
            ),
        ),

        # ──────────────────────────────────────────────────────────
        # 3a. StatusMedia — per-Status media attachment (carousel prep)
        # ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='StatusMedia',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('position', models.PositiveSmallIntegerField(default=0)),
                ('media_type', models.CharField(max_length=16)),
                ('url', models.TextField()),
                ('thumbnail_url', models.TextField(blank=True, default='')),
                ('duration_ms', models.PositiveIntegerField(blank=True, null=True)),
                ('width', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('height', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('story', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='media',
                    to='api.userstory',
                )),
            ],
            options={
                'ordering': ['position', 'id'],
            },
        ),
        migrations.AddConstraint(
            model_name='statusmedia',
            constraint=models.UniqueConstraint(
                fields=('story', 'position'),
                name='uniq_story_media_position',
            ),
        ),
        migrations.AddIndex(
            model_name='statusmedia',
            index=models.Index(
                fields=['story', 'position'],
                name='statusmedia_story_pos_idx',
            ),
        ),

        # ──────────────────────────────────────────────────────────
        # 3b. StatusView — per-(story, viewer) read-receipt.
        #     ``UniqueConstraint`` makes INSERT-ON-CONFLICT-DO-NOTHING
        #     a no-op race-loser retry without a hand-coded lock.
        # ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='StatusView',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('viewed_at', models.DateTimeField(auto_now_add=True)),
                ('device_kind', models.CharField(blank=True, default='', max_length=32)),
                ('story', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='views',
                    to='api.userstory',
                )),
                ('viewer', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='status_views',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-viewed_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='statusview',
            constraint=models.UniqueConstraint(
                fields=('story', 'viewer'),
                name='uniq_status_view_story_viewer',
            ),
        ),
        migrations.AddIndex(
            model_name='statusview',
            index=models.Index(
                fields=['story', '-viewed_at'],
                name='statusview_story_viewed_idx',
            ),
        ),

        # ──────────────────────────────────────────────────────────
        # 3c. StatusReaction — mirror of MessageReaction.
        #     Same 32-char emoji cap, same UNIQUE(story, user, emoji)
        #     dedupe semantics so FE toggles are idempotent.
        # ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='StatusReaction',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('emoji', models.CharField(max_length=32)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('story', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='reactions',
                    to='api.userstory',
                )),
                ('user', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='status_reactions',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='statusreaction',
            constraint=models.UniqueConstraint(
                fields=('story', 'user', 'emoji'),
                name='uniq_status_react_story_user_emoji',
            ),
        ),
        migrations.AddIndex(
            model_name='statusreaction',
            index=models.Index(
                fields=['story', '-created_at'],
                name='statusreact_story_created_idx',
            ),
        ),

        # ──────────────────────────────────────────────────────────
        # 3d. StatusPrivacyOverride — only populated when
        #     ``UserStory.privacy`` ∈ {everyone_except, only_share_with,
        #     hidden}. Two single-column indexes because the dominant
        #     access path is "list this viewer's overrides" + "list this
        #     story's overrides".
        # ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='StatusPrivacyOverride',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('story', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='privacy_overrides',
                    to='api.userstory',
                )),
                ('viewer', models.ForeignKey(
                    on_delete=models.CASCADE,
                    related_name='status_privacy_overrides',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={},
        ),
        migrations.AddConstraint(
            model_name='statusprivacyoverride',
            constraint=models.UniqueConstraint(
                fields=('story', 'viewer'),
                name='uniq_status_priv_override_story_viewer',
            ),
        ),
        migrations.AddIndex(
            model_name='statusprivacyoverride',
            index=models.Index(
                fields=['story'],
                name='statusprivoverride_story_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='statusprivacyoverride',
            index=models.Index(
                fields=['viewer'],
                name='statusprivoverride_viewer_idx',
            ),
        ),

        # ──────────────────────────────────────────────────────────
        # 4. Message.reply_to_story FK + composite index
        #    Reply-to-status bubbles route through the existing
        #    ChatThread (1-on-1) and surface the status snippet header
        #    via ``MessageSerializer``. ``on_delete=SET_NULL`` keeps
        #    the chat history intact after the janitor sweep.
        # ──────────────────────────────────────────────────────────
        migrations.AddField(
            model_name='message',
            name='reply_to_story',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name='chat_replies',
                to='api.userstory',
            ),
        ),
        migrations.AddIndex(
            model_name='message',
            index=models.Index(
                fields=['reply_to_story', '-created_at'],
                name='msg_reply_to_story_idx',
            ),
        ),
    ]
