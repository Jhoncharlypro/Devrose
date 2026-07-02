"""
0021 — Kot3 Profile privacy toggles (show_contact_info + allow_stranger_dms)

Adds two per-field privacy booleans to the Profile model that complement
the coarse-grained ``profile_visibility`` + ``last_seen_visibility``
enums added in migration 0011. The frontend in
``src/components/kot3/Kot3Profile.jsx`` reads and writes these fields
through ``PATCH /api/profile/me/``.

  * ``show_contact_info`` — when ``False``, the
    ``ProfileViewSet.retrieve`` redaction blanks the top-level
    ``email`` on the response so the About tab of the user's Kot3 chat
    profile never shows the address, even when the profile is
    ``public``. Defaults to ``True`` to preserve pre-0021 behavior
    (email was always shown unless the user set
    ``profile_visibility='private'``); users now opt OUT of contact
    visibility via the Kot3 Profile single-page privacy console.

  * ``allow_stranger_dms`` — when ``False``, non-mutual users can't DM
    the user. Defaults to ``True`` so the rollout is non-breaking; the
    chat consumer will filter new conversations from non-mutuals when
    this flips to ``False`` (future patch; the field is persisted
    today).

Defaults preserve existing behavior — users with rows predating this
migration get ``show_contact_info=True`` (email still shown by default,
matching the pre-migration behavior) and ``allow_stranger_dms=True``
(DMs remain open, matching the previous behavior).
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        # Phase 15 — picks up after 0023_auth_user_last_login_nullable
        # so the migration graph stays a single chain (avoids the
        # "multiple leaf nodes in migration graph" error from
        # ``makemigrations --check``). The original migration was
        # numbered 0021 and depended on 0020; that was correct in
        # isolation but the repo gained two more migrations
        # (0021_phase10_statuses_full, 0022_alter_chatfolder, 0023)
        # in parallel so the Phase 15 + 16 work had to be renumbered
        # to 0024 + 0025 to come AFTER the latest existing one.
        ('api', '0023_auth_user_last_login_nullable'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='show_contact_info',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='profile',
            name='allow_stranger_dms',
            field=models.BooleanField(default=True),
        ),
    ]
