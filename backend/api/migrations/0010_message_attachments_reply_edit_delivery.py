# Generated for KOt3Chat Messenger overhaul — adds attachment / reply / edit / delivery state.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_liveroom_pinned_message_liveroom_theme'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='image',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='message',
            name='reply_to',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='replies', to='api.message'),
        ),
        migrations.AddField(
            model_name='message',
            name='is_edited',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='message',
            name='is_delivered',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='message',
            name='edited_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
