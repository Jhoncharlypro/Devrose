"""
0015 -- Media: base64-in-DB to Supabase Storage.

WHAT THIS MIGRATION DOES
------------------------
For every Profile/Messsage/UserStory row that still stores base64 payload
in ``avatar`` / ``cover_photo`` / ``image`` / ``audio`` / story content:

  1. Decode the base64 to raw bytes.
  2. POST the bytes to ``POST /storage/v1/object/{bucket}/{path}``.
  3. Replace the row's column with the constructed public URL.

Schema is untouched -- the existing ``TextField`` columns already
accept both base64 AND URLs (HTML5 ``<img src=...>`` supports both),
so this migration is a one-shot data sweep that does ``UPDATE``
statements rather than a destructive ``ALTER``.

IDEMPOTENCY
-----------
Rows whose value already ``startswith('http')`` (or ``https``) are
considered ALREADY MIGRATED and skipped. Re-running the migration on
a database that's already been swept is therefore a no-op. No schema
column gets added to track migration state -- the value itself is the
truth marker.

BATCHING
--------
UPDATEs are issued in chunks of ``BATCH_SIZE`` so we don't perform
N round-trips on a 10000-row sweep. Each (Model, Column) migration
pre-loads the rows whose values changed (in a single ``.iterator()``
sweep), then writes them back via Case/When in chunks of 500. The
per-row ``update()`` plumbing is replaced by a single SQL UPDATE per
batch where the new value is bound by ID via ``models.Case(When(pk=...,
then=Value(new)))``.

NO-OP IN DEV
------------
If ``SUPABASE_URL`` (or ``SUPABASE_SERVICE_KEY``) is unset, the
upload helper returns the row's value unchanged and the migration
becomes a no-op against SQLite / unset-env. The operator runs
``manage.py migrate media_to_supabase_storage`` again after Supabase
Storage is provisioned.
"""
import logging

from django.db import migrations

logger = logging.getLogger(__name__)

# Tunable: 500 rows/UPDATE keeps each round-trip reasonable on the
# supabase-pooler while bounding memory at under ~5MB of in-flight
# decoded bytes per (model, column).
_BATCH_SIZE = 500


def _is_already_url(value):
    """True when the value is an http/https URL. Idempotency predicate."""
    return bool(value) and isinstance(value, str) and value.lstrip().startswith(("http://", "https://"))


def _apply_with_race_guard(Model, column, pending_updates):
    """
    Apply (pk -> new_value) updates with a ``WHERE column = old_value``
    race guard so a concurrent user edit (e.g. profile.avatar replaced
    mid-migration) is NOT silently clobbered.

    ``pending_updates`` is a dict ``{int(pk): (str(new_value), str(old_value))}`` —
    ``old_value`` is whatever the row held when we walked it; if a
    user's saved value has drifted, the ``.filter(**{column: old_value})``
    guard returns 0 rows updated and we treat the row as a no-op.

    We trade batching for correctness here: per-row UPDATEs so each
    carries its 'still the old value?' predicate. The migration window
    is admin-only and brief (typically <5 min on a 10000-row sweep),
    so per-row UPDATEs are acceptable.
    """
    if not pending_updates:
        return 0
    total_applied = 0
    for pk, (new_value, _old_value) in pending_updates.items():
        updated = (
            Model.objects
            .filter(pk=pk, **{column: _old_value})
            .update(**{column: new_value})
        )
        if updated:
            total_applied += updated
    return total_applied


def _resolve_updates(apps, model_name, column, kind):
    """
    Walk historical rows, run ``ensure_url`` for each non-URL value,
    return ``{pk: (new_value, old_value)}`` so the applier can
    race-guard each UPDATE.
    """
    Model = apps.get_model("api", model_name)
    # ``iterator(chunk_size=_BATCH_SIZE)`` keeps memory bounded; we
    # still need the ``user_id`` FK join for ensure_url so we use
    # select_related where the target column depends on the sender.
    if column in ("audio", "image") and model_name == "Message":
        qs = (
            Model.objects
            .exclude(**{f"{column}__isnull": True})
            .exclude(**{column: ""})
            .select_related("sender")
            .iterator(chunk_size=_BATCH_SIZE)
        )
    elif column in ("avatar", "cover_photo") and model_name == "Profile":
        qs = (
            Model.objects
            .exclude(**{f"{column}__isnull": True})
            .exclude(**{column: ""})
            .select_related("user")
            .iterator(chunk_size=_BATCH_SIZE)
        )
    else:
        qs = (
            Model.objects
            .exclude(**{f"{column}__isnull": True})
            .exclude(**{column: ""})
            .iterator(chunk_size=_BATCH_SIZE)
        )

    from api.storage_utils import ensure_url

    pending_updates = {}
    kept = skipped = 0
    for row in qs:
        old = getattr(row, column)
        if _is_already_url(old):
            skipped += 1
            continue
        # Pick the actor: Profile has FK ``user``, Message has ``sender``,
        # UserStory has ``user``. Default to the row itself for safety.
        actor = getattr(row, "user", None) or getattr(row, "sender", None) or row
        new = ensure_url(actor, kind, old)
        if new and new != old:
            # Capture *both* values so the applier can race-guard the
            # UPDATE. If the user has replaced their avatar/image
            # mid-migration, the ``WHERE column = old_value`` clause
            # in ``_apply_with_race_guard`` will match zero rows and
            # we won't overwrite their fresh edit.
            pending_updates[row.pk] = (new, old)
        else:
            kept += 1
    return pending_updates, kept, skipped


# ----------------------------------------------------------------------
# Per-(Model, Column) migration operations.
# ----------------------------------------------------------------------
def _migrate_profile_avatar(apps, schema_editor):
    pending, kept, skipped = _resolve_updates(apps, "Profile", "avatar", "avatar")
    applied = _apply_with_race_guard(apps.get_model("api", "Profile"), "avatar", pending)
    logger.info(
        "0015 profile.avatar: applied=%d pending=%d kept=%d already_url=%d",
        applied, len(pending), kept, skipped,
    )


def _migrate_profile_cover(apps, schema_editor):
    pending, kept, skipped = _resolve_updates(apps, "Profile", "cover_photo", "cover")
    applied = _apply_with_race_guard(apps.get_model("api", "Profile"), "cover_photo", pending)
    logger.info(
        "0015 profile.cover_photo: applied=%d pending=%d kept=%d already_url=%d",
        applied, len(pending), kept, skipped,
    )


def _migrate_message_image(apps, schema_editor):
    pending, kept, skipped = _resolve_updates(apps, "Message", "image", "image")
    applied = _apply_with_race_guard(apps.get_model("api", "Message"), "image", pending)
    logger.info(
        "0015 message.image: applied=%d pending=%d kept=%d already_url=%d",
        applied, len(pending), kept, skipped,
    )


def _migrate_message_audio(apps, schema_editor):
    pending, kept, skipped = _resolve_updates(apps, "Message", "audio", "audio")
    applied = _apply_with_race_guard(apps.get_model("api", "Message"), "audio", pending)
    logger.info(
        "0015 message.audio: applied=%d pending=%d kept=%d already_url=%d",
        applied, len(pending), kept, skipped,
    )


def _migrate_story_images(apps, schema_editor):
    Model = apps.get_model("api", "UserStory")
    qs = (
        Model.objects
        .filter(type="image")
        .exclude(content__isnull=True)
        .exclude(content="")
        .select_related("user")
        .iterator(chunk_size=_BATCH_SIZE)
    )
    from api.storage_utils import ensure_url
    pending = {}
    kept = skipped = 0
    for story in qs:
        if _is_already_url(story.content):
            skipped += 1
            continue
        new = ensure_url(story.user, "image", story.content)
        if new and new != story.content:
            pending[story.pk] = (new, story.content)
        else:
            kept += 1
    applied = _apply_with_race_guard(Model, "content", pending)
    logger.info(
        "0015 userstory.image: applied=%d pending=%d kept=%d already_url=%d",
        applied, len(pending), kept, skipped,
    )


def _noop_reverse(apps, schema_editor):
    """Reverse migration would lose data; log loudly instead."""
    logger.warning(
        "0015 reverse: this migration is destructive of base64 payloads. "
        "Consider restoring rows from a Postgres backup rather than reversing.",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0014_alter_blockeduser_id_alter_messagereaction_emoji_and_more"),
    ]

    operations = [
        migrations.RunPython(_migrate_profile_avatar, _noop_reverse),
        migrations.RunPython(_migrate_profile_cover, _noop_reverse),
        migrations.RunPython(_migrate_message_image, _noop_reverse),
        migrations.RunPython(_migrate_message_audio, _noop_reverse),
        migrations.RunPython(_migrate_story_images, _noop_reverse),
    ]
