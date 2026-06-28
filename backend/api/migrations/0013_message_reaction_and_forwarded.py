"""
0013 — Chat module hardening: reactions + forwarding

Additive migration. Two changes:

  1. New ``api_message_reaction`` table (MessageReaction model).
     One row per (user, message, emoji) tuple. The unique_together
     constraint keeps toggling idempotent at the DB layer.

  2. Two new columns on ``api_message``:
       * ``forwarded_from``   — nullable FK to self, on_delete=SET_NULL.
         If the original message is later deleted the forwarded copy
         survives with a NULL provenance (and the human-readable
         ``forward_sender_name`` denorm below).
       * ``forward_sender_name`` — CharField snapshot of the original
         sender username. Lets the bubble render "Forwarded from @bob"
         even after the original row is gone.

Why we ship a hand-rolled migration instead of
``makemigrations --check`` output?
  * Keeps the diff auditable: anyone reviewing the PR can see the new
    table layout without running Django locally.
  * On SQLite the new column ALTER TABLEs are cheap (NULL default),
    so the migration is safe to run against the dev DB and against any
    existing data that was created before this commit.
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0012_profile_extended_modules'),
    ]

    operations = [
        # 1. Create the MessageReaction table.
        migrations.CreateModel(
            name='MessageReaction',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False)),
                ('emoji', models.CharField(max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('message', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reactions', to='api.message')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='message_reactions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='messagereaction',
            constraint=models.UniqueConstraint(fields=('message', 'user', 'emoji'), name='unique_usr_msg_emoji'),
        ),
        migrations.AddIndex(
            model_name='messagereaction',
            index=models.Index(fields=['message', '-created_at'], name='react_msg_created_idx'),
        ),

        # 2. Add the forward-provenance fields onto Message.
        migrations.AddField(
            model_name='message',
            name='forwarded_from',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='forwards', to='api.message'),
        ),
        migrations.AddField(
            model_name='message',
            name='forward_sender_name',
            field=models.CharField(blank=True, default='', max_length=150),
        ),
    ]
