"""
0012 — PROFILE module expansion

Additive change to extend the Profile model with the metadata fields
the messenger needs beyond the auth-extension phase (0010–0011):

  * ``Profile.cover_photo``        — base64 data URL for a wide banner.
  * ``Profile.interests``          — JSON list of lowercase tags.
  * ``Profile.social_links``       — JSON dict {platform: url}.
  * ``Profile.notification_prefs`` — JSON dict per-channel toggles.
  * ``Profile.country``            — ISO-3166 shortname (CharField).

Plus two new self-referencing through-models for user-to-user
moderation, each with distinct ``related_name`` so reverse accessors
don't clash on the built-in ``User`` table:

  * ``BlockedUser`` (actor→blocked, optional reason)
  * ``MutedUser``  (actor→muted, optional mute_until)

Defaults use *callables* (``list`` / ``dict``) rather than the literal
``[]`` or ``{}``. This avoids the "shared mutable default across rows"
failure older SQLite bindings would exhibit when Django reuses the
same reference. The full plan is documented in
``backend/api/models/profile.py``.
"""
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_profile_privacy_and_email_verified'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ----- Profile field additions -------------------------------------
        migrations.AddField(
            model_name='profile',
            name='cover_photo',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='profile',
            name='interests',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='profile',
            name='social_links',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='profile',
            name='notification_prefs',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='profile',
            name='country',
            field=models.CharField(blank=True, default='', max_length=60),
        ),

        # ----- BlockedUser ----------------------------------------------
        migrations.CreateModel(
            name='BlockedUser',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('reason', models.CharField(blank=True, default='', max_length=255)),
                ('actor', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='blocks_created',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('blocked', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='blocked_by',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'unique_together': {('actor', 'blocked')},
            },
        ),

        # ----- MutedUser ------------------------------------------------
        migrations.CreateModel(
            name='MutedUser',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('mute_until', models.DateTimeField(blank=True, null=True)),
                ('actor', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='mutes_created',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('muted', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='muted_by',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'unique_together': {('actor', 'muted')},
            },
        ),
    ]
