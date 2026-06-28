"""
0011 — Profile privacy + email verification fields

Adds the four columns introduced by the auth/profile extension phase:
  * ``email_verified`` (Boolean, default False)
  * ``email_verified_at`` (DateTime, nullable)
  * ``profile_visibility`` (CharField, default 'public')
  * ``last_seen_visibility`` (CharField, default 'everyone')

Why a hand-rolled migration instead of letting ``manage.py makemigrations``
generate it?
  * The dev environment we ship in Vite + Docker doesn't always have the
    Django app fully bootstrapped, so it's safer to commit an explicit
    migration with a deterministic name so the diff is auditable.
  * Future devs can run ``manage.py makemigrations --dry-run --check`` and
    see that this migration is in sync with the model definitions.

No-op on existing rows: defaults ensure existing Profiles are valid
(non-null visibility, un-verified email).
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_message_attachments_reply_edit_delivery'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='email_verified',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='profile',
            name='email_verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='profile',
            name='profile_visibility',
            field=models.CharField(
                default='public',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='profile',
            name='last_seen_visibility',
            field=models.CharField(
                default='everyone',
                max_length=10,
            ),
        ),
    ]
