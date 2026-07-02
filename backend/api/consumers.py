import json
import time
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from asgiref.sync import sync_to_async
from api.models import ChatThread, Message, MessageReaction
from api.models.part4 import CallLog as Part4CallLog
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone
from api import presence

# ----------------------------------------------------------------------
# Presence: see ``api/presence.py`` for the storage layout and the
# Redis-vs-LocalMemory fallback. The dicts that used to live here
# (``online_users``, ``typing_users``, ``room_connections``,
# ``room_user_channels``) have moved there so multi-worker Daphne
# shares a single Redis ledger. When ``REDIS_URL`` is unset we still
# serve single-worker dev via LocalMemoryBackend.
# ----------------------------------------------------------------------

class ClassroomLiveConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'classroom_{self.room_name}'
        self.user = self.scope.get('user')

        user_info = {
            'user_id': self.user.id if self.user and self.user.is_authenticated else None,
            'username': self.user.username if self.user and self.user.is_authenticated else 'Anonymous',
            'is_staff': self.user.is_staff if self.user and self.user.is_authenticated else False
        }

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        # Record this channel_name in the Redis-backed room ledger. We
        # MUST do this BEFORE checking for an existing channel on the
        # same user_id, otherwise another worker (or the same worker on
        # the previous WS) might race past us and miss the replacement
        # signal.
        await presence.room_join_async(
            self.room_group_name, self.channel_name, user_info
        )

        # If the same user_id already has a live channel for this
        # room, kick the old one out via group_send to its channel_name
        # BEFORE we overwrite the (user_id -> channel_name) mapping.
        if user_info['user_id'] is not None:
            existing_channel = await presence.room_get_user_channel_async(
                self.room_group_name, user_info['user_id']
            )
            if existing_channel and existing_channel != self.channel_name:
                await self.channel_layer.send(
                    existing_channel,
                    {
                        'type': 'session_replaced',
                        'replacement_channel_name': self.channel_name
                    }
                )
                await presence.room_leave_async(
                    self.room_group_name, existing_channel
                )
            await presence.room_set_user_channel_async(
                self.room_group_name, user_info['user_id'], self.channel_name
            )

        # Pull the full peer roster for the welcome packet. We ask
        # Redis for the whole HASH at once and filter the new
        # channel_name client-side.
        all_peers = await presence.room_list_async(self.room_group_name)
        other_peers = {
            channel: info for channel, info in all_peers.items()
            if channel != self.channel_name
        }

        await self.accept()

        await self.send_json({
            'type': 'welcome',
            'channel_name': self.channel_name,
            'user': user_info,
            'active_peers': other_peers
        })

        await self.broadcast_viewer_count()

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'peer_joined',
                'sender_channel_name': self.channel_name,
                'user': user_info
            }
        )

    async def receive_json(self, content):
        msg_type = content.get('type')
        target = content.get('target')

        if msg_type == 'signal' and target:
            await self.channel_layer.send(
                target,
                {
                    'type': 'webrtc_signal',
                    'sender_channel_name': self.channel_name,
                    'signal': content.get('signal')
                }
            )
        elif msg_type == 'chat_message':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message_broadcast',
                    'sender_channel_name': self.channel_name,
                    'message': content.get('message'),
                    'username': self.user.username if self.user and self.user.is_authenticated else 'Anonymous'
                }
            )
        elif target:
            await self.channel_layer.send(
                target,
                {
                    'type': 'direct_message',
                    'sender_channel_name': self.channel_name,
                    'content': content
                }
            )
        else:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'group_broadcast',
                    'sender_channel_name': self.channel_name,
                    'content': content
                }
            )

    async def broadcast_viewer_count(self):
        count = await presence.room_count_async(self.room_group_name)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'viewer_count_update',
                'count': count
            }
        )

    async def viewer_count_update(self, event):
        await self.send_json({
            'type': 'viewer_count',
            'count': event['count']
        })

    async def peer_joined(self, event):
        if event['sender_channel_name'] != self.channel_name:
            await self.send_json({
                'type': 'peer_joined',
                'sender_channel_name': event['sender_channel_name'],
                'user': event['user']
            })

    async def peer_left(self, event):
        await self.send_json({
            'type': 'peer_left',
            'sender_channel_name': event['sender_channel_name']
        })

    async def session_replaced(self, event):
        if event.get('replacement_channel_name') != self.channel_name:
            await self.send_json({
                'type': 'session_replaced',
                'message': 'A newer connection opened for this room.'
            })
            await self.close()

    async def webrtc_signal(self, event):
        await self.send_json({
            'type': 'signal',
            'sender_channel_name': event['sender_channel_name'],
            'signal': event['signal']
        })

    async def chat_message_broadcast(self, event):
        await self.send_json({
            'type': 'chat',
            'sender_channel_name': event['sender_channel_name'],
            'message': event['message'],
            'username': event['username']
        })

    async def direct_message(self, event):
        content = event['content']
        content['sender_channel_name'] = event['sender_channel_name']
        await self.send_json(content)

    async def group_broadcast(self, event):
        if event['sender_channel_name'] != self.channel_name:
            content = event['content']
            content['sender_channel_name'] = event['sender_channel_name']
            await self.send_json(content)


class Kot3ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or not self.user.is_authenticated:
            await self.close()
            return

        self.user_room_name = f'kot3_user_{self.user.id}'
        self.current_thread_room = None
        self.connected = True

        await self.channel_layer.group_add(
            self.user_room_name,
            self.channel_name
        )

        await self.update_last_seen()

        # Record this WS as one of ``self.user.id``'s open tabs. The
        # backend (Redis or LocalMemory) deduplicates by channel_name.
        await presence.mark_online_async(
            self.user.id, self.channel_name, self.user.username,
        )

        await self.channel_layer.group_send(
            'kot3_presence',
            {
                'type': 'user_presence',
                'user_id': self.user.id,
                'username': self.user.username,
                'status': 'online'
            }
        )

        # Notify all user threads about online status
        await self.broadcast_presence_to_threads('online')

        await self.accept()
        await self.channel_layer.group_add('kot3_presence', self.channel_name)
        await self.send_json({
            'type': 'connected',
            'user_id': self.user.id,
            'username': self.user.username
        })

        # Send an initial presence snapshot so the FE can reconcile
        # its localStorage map on every (re)connect — fixes the
        # "stale onlineUsers" bug where a user marked online in
        # localStorage stays green after they actually went offline.
        # Without this, a user who closes their tab while the server
        # stays up keeps showing as online forever.
        await self._send_presence_snapshot()

    async def disconnect(self, close_code):
        self.connected = False
        # Note: Kot3ChatConsumer never joins a ClassroomLiveConsumer room
        # (it never sets self.room_group_name), so the room cleanup below is
        # defensive — only ClassroomLiveConsumer ever populates it.
        room_group_name = getattr(self, 'room_group_name', None)
        if room_group_name:
            await presence.room_leave_async(room_group_name, self.channel_name)
            if getattr(self, 'user', None) and self.user and self.user.is_authenticated:
                # Clear the (user_id -> channel_name) mapping ONLY if
                # it still points at this channel. A newer connection
                # taken over via ``session_replaced`` will have already
                # rewritten it to a different channel_name and we don't
                # want to clobber that.
                current = await presence.room_get_user_channel_async(
                    room_group_name, self.user.id,
                )
                if current == self.channel_name:
                    await presence.room_clear_user_channel_async(
                        room_group_name, self.user.id,
                    )
            await self.channel_layer.group_send(
                room_group_name,
                {
                    'type': 'peer_left',
                    'sender_channel_name': self.channel_name
                }
            )
        if self.current_thread_room:
            await self.channel_layer.group_discard(
                self.current_thread_room,
                self.channel_name
            )
        await self.channel_layer.group_discard(
            self.user_room_name,
            self.channel_name
        )

        await self.update_last_seen()

        # Detach this channel_name from the user's online SET. ``mark_offline_async``
        # returns the remaining channel count so we know whether the
        # user is "fully offline" (count == 0) or just lost one tab.
        remaining_channels = await presence.mark_offline_async(
            self.user.id, self.channel_name,
        )
        if remaining_channels == 0:
            await self.broadcast_presence_to_threads('offline')

        # Cleanup: remove this user's typing indicator from every
        # thread they're a participant in. Iterating the user's
        # threads is cheap (one M2M query) and avoids the old
        # ``for tid in list(typing_users.keys()):`` leak that walked
        # threads the user had never typed in.
        thread_ids = await sync_to_async(list)(
            ChatThread.objects.filter(participants=self.user).values_list('id', flat=True)
        )
        for thread_id in thread_ids:
            await presence.stop_typing_async(thread_id, self.user.id)

        await self.channel_layer.group_send(
            'kot3_presence',
            {
                'type': 'user_presence',
                'user_id': self.user.id,
                'username': self.user.username,
                'status': 'offline',
                'last_seen': timezone.now().isoformat()
            }
        )

    async def broadcast_presence_to_threads(self, status):
        thread_ids = await sync_to_async(list)(
            ChatThread.objects.filter(participants=self.user).values_list('id', flat=True)
        )
        for thread_id in thread_ids:
            await self.channel_layer.group_send(
                f'kot3_thread_{thread_id}',
                {
                    'type': 'presence_broadcast',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'status': status
                }
            )

    @sync_to_async
    def update_last_seen(self):
        try:
            profile = self.user.profile
            profile.last_seen = timezone.now()
            profile.save(update_fields=['last_seen'])
        except Exception:
            pass

    async def _build_presence_snapshot(self):
        """
        Return a ``{user_id: {username, last_seen}}`` dict of every
        user currently online (across all Daphne workers — backed by
        Redis SMEMBERS). Used by the ``connected`` envelope and the
        ``get_presence_snapshot`` WS handler so the FE can reconcile
        stale localStorage entries on every (re)connect.

        One batched query: ``User.objects.filter(id__in=online_set)``,
        so cost is O(1) Redis round-trip + one indexed SELECT.
        """
        from django.contrib.auth.models import User
        from asgiref.sync import sync_to_async

        online_set = await presence.online_user_ids_async()
        if not online_set:
            return {}

        def fetch_users():
            rows = (
                User.objects
                .filter(id__in=online_set)
                .values('id', 'username', 'profile__last_seen')
            )
            return {
                r['id']: {
                    'username': r['username'],
                    'last_seen': (
                        r['profile__last_seen'].isoformat()
                        if r['profile__last_seen'] else None
                    ),
                }
                for r in rows
            }

        return await sync_to_async(fetch_users)()

    async def _send_presence_snapshot(self):
        """Send the FE a ``presence_snapshot`` envelope with the current
        online set. The hook handler REPLACES its localStorage map
        with this — so users who actually went offline drop from the
        dot map on every (re)connect.
        """
        snapshot = await self._build_presence_snapshot()
        await self.send_json({
            'type': 'presence_snapshot',
            'online': snapshot,
            'ts': timezone.now().isoformat(),
        })

    async def presence_snapshot(self, event):
        """Server-side group_send fanout (a future "force-refresh all"
        path could use this). Today only the per-connection
        ``_send_presence_snapshot`` path is used, but registering the
        channel-layer handler keeps the contract symmetric with the
        other fanout events so we don't have to rewrite consumers if
        the broadcast path is added later."""
        await self.send_json({
            'type': 'presence_snapshot',
            'online': event.get('online', {}),
            'ts': event.get('ts') or timezone.now().isoformat(),
        })

    async def receive_json(self, content):
        msg_type = content.get('type')

        if msg_type == 'join_thread':
            thread_id = content.get('thread_id')
            if self.current_thread_room:
                await self.channel_layer.group_discard(
                    self.current_thread_room,
                    self.channel_name
                )
            self.current_thread_room = f'kot3_thread_{thread_id}'
            await self.channel_layer.group_add(
                self.current_thread_room,
                self.channel_name
            )
            await self.send_json({'type': 'joined_thread', 'thread_id': thread_id})

        elif msg_type == 'leave_thread':
            if self.current_thread_room:
                await self.channel_layer.group_discard(
                    self.current_thread_room,
                    self.channel_name
                )
                self.current_thread_room = None
                await self.send_json({'type': 'left_thread'})

        elif msg_type == 'send_message':
            thread_id = content.get('thread_id')
            message_content = content.get('content', '')
            audio = content.get('audio', '')
            image = content.get('image', '')
            reply_to_id = content.get('reply_to_id')
            await self.save_and_broadcast(thread_id, message_content, audio, image, reply_to_id)

        elif msg_type == 'edit_message':
            message_id = content.get('message_id')
            new_content = (content.get('content') or '').strip()
            if not message_id or not str(message_id).isdigit() or not new_content:
                return
            def edit_sync():
                try:
                    m = Message.objects.get(id=int(message_id))
                    if m.sender_id != self.user.id:
                        return {'error': 'You can only edit your own messages.'}
                    from django.utils import timezone as _tz
                    Message.objects.filter(id=m.id).update(content=new_content, is_edited=True, edited_at=_tz.now())
                    m.refresh_from_db()
                    return {'thread_id': m.thread_id, 'message_id': m.id, 'content': m.content, 'edited': True, 'edited_at': m.edited_at.isoformat() if m.edited_at else None}
                except Message.DoesNotExist:
                    return {'error': 'Message not found'}
            result = await sync_to_async(edit_sync)()
            if 'error' in result:
                await self.send_json({'type': 'error', 'message': result['error']})
                return
            await self.channel_layer.group_send(
                f'kot3_thread_{result["thread_id"]}',
                {
                    'type': 'message_updated',
                    'thread_id': result['thread_id'],
                    'message_id': result['message_id'],
                    'content': result['content'],
                    'is_edited': True,
                    'edited_at': result['edited_at']
                }
            )

        elif msg_type == 'typing':
            thread_id = content.get('thread_id')
            is_typing = content.get('is_typing', False)
            if self.current_thread_room and thread_id:
                # Record / clear in the Redis-backed ZSET so peers on
                # another Daphne worker also see the indicator fan-out
                # via the channel-layer group.
                if is_typing:
                    await presence.mark_typing_async(thread_id, self.user.id)
                else:
                    await presence.stop_typing_async(thread_id, self.user.id)
                await self.channel_layer.group_send(
                    f'kot3_thread_{thread_id}',
                    {
                        'type': 'typing_indicator',
                        'thread_id': thread_id,
                        'user_id': self.user.id,
                        'username': self.user.username,
                        'is_typing': is_typing
                    }
                )

        elif msg_type == 'mark_read':
            thread_id = content.get('thread_id')
            message_ids = content.get('message_ids', [])
            await self.mark_messages_read(thread_id, message_ids)

        elif msg_type == 'get_history':
            await self.load_history(content.get('thread_id'))

        elif msg_type == 'call_user':
            target_user_id = content.get('target_user_id')
            call_type = content.get('call_type', 'audio')
            # Phase 9: persist CallLog row so the history survives logouts
            # + multi-device consistency. The thread is the most-recent 1-on-1
            # thread between the two participants, when present.
            await self._persist_call_attempt(target_user_id, call_type, status='ringing')
            await self.channel_layer.group_send(
                f'kot3_user_{target_user_id}',
                {
                    'type': 'incoming_call_broadcast',
                    'caller_id': self.user.id,
                    'caller_username': self.user.username,
                    'call_type': call_type
                }
            )

        elif msg_type == 'call_accepted':
            caller_id = content.get('caller_id')
            await self._mark_call_connected(caller_id)
            await self.channel_layer.group_send(
                f'kot3_user_{caller_id}',
                {
                    'type': 'call_connected_broadcast',
                    'receiver_id': self.user.id
                }
            )

        elif msg_type == 'call_declined':
            target_user_id = content.get('target_user_id')
            await self._finalize_call_with_peer(target_user_id, status='declined')
            await self.channel_layer.group_send(
                f'kot3_user_{target_user_id}',
                {
                    'type': 'call_hungup_broadcast',
                    'sender_id': self.user.id
                }
            )

        elif msg_type == 'add_reaction':
            # Step 3 (chat module additions): toggle a reaction. Payloads:
            #   {type: 'add_reaction', thread_id, message_id, emoji}
            # If the same (user, message, emoji) tuple already exists, we
            # REMOVE it (Messenger-style toggle). This keeps the FE logic
            # simple: "click again to undo".
            message_id = content.get('message_id')
            emoji = (content.get('emoji') or '').strip()
            if message_id and str(message_id).isdigit() and emoji:
                await self.toggle_reaction(int(message_id), emoji)

        elif msg_type == 'forward_message':
            # Step 4 (chat module additions): post a "forward" copy of an
            # existing message into the *target* thread. Body (verbatim):
            #   content / audio / image are copied from the original.
            #   ``forwarded_from_id`` is the original message id.
            #   ``target_thread_id`` is the destination thread.
            target_thread_id = content.get('target_thread_id')
            forwarded_from_id = content.get('forwarded_from_id')
            if target_thread_id and forwarded_from_id and str(forwarded_from_id).isdigit():
                await self.forward_message(int(forwarded_from_id), target_thread_id)

        elif msg_type == 'delete_message':
            # Phase 9 — soft-delete broadcast. We mirror the REST DELETE
            # behaviour so the WS path is the live sync layer; the REST
            # endpoint is the persistence-of-truth.
            message_id = content.get('message_id')
            if message_id and str(message_id).isdigit():
                await self.delete_message_for_everyone(int(message_id))

        elif msg_type == 'thread_setting':
            # Phase 9 — client can sync per-user thread flags (pinned,
            # archived, muted_duration, is_request_ignored) over WS for
            # snappier UX. The user-visible pre-flight POST to REST is
            # preferred for safety, but this path lets the FE hand off
            # optimistic updates without round-tripping.
            thread_id = content.get('thread_id')
            updates = content.get('updates') or {}
            if thread_id and isinstance(updates, dict) and updates:
                await self.update_thread_setting(thread_id, updates)

        elif msg_type == 'get_presence_snapshot':
            # Phase 9 — FE can ask for a fresh presence snapshot at
            # any time. The hook calls this on ws.onopen and after a
            # 4401 reconnect to reconcile stale localStorage entries.
            await self._send_presence_snapshot()

        elif msg_type == 'heartbeat':
            # Phase 9 — client heartbeat. Updates ``last_seen`` on
            # the profile so other devices see an accurate "last seen
            # X m ago" badge, and returns a fresh presence snapshot
            # so the client doesn't drift from server truth.
            # Recommended cadence: 60s.
            await self.update_last_seen()
            await self._send_presence_snapshot()

        elif msg_type == 'webrtc_signal':
            target_user_id = content.get('target_user_id')
            signal = content.get('signal', {})
            if target_user_id and signal:
                await self.channel_layer.group_send(
                    f'kot3_user_{target_user_id}',
                    {
                        'type': 'webrtc_signal_broadcast',
                        'sender_id': self.user.id,
                        'sender_username': self.user.username,
                        'signal': signal
                    }
                )

        elif msg_type == 'publish_story':
            story_type = content.get('story_type', 'text')
            story_content = content.get('content', '')
            background = content.get('background', '')
            await self.save_and_broadcast_story(story_type, story_content, background)

    async def load_history(self, thread_id):
        def get_history_sync():
            try:
                thread = ChatThread.objects.get(id=thread_id)
                if self.user not in thread.participants.all():
                    return {'error': 'Not a participant'}
                messages = list(thread.messages.select_related('sender').order_by('-created_at')[:100])
                formatted = []
                for msg in reversed(messages):
                    formatted.append({
                        'id': msg.id,
                        'thread_id': msg.thread_id,
                        'sender_id': msg.sender_id,
                        'sender_username': msg.sender.username,
                        'content': msg.content,
                        'audio': msg.audio,
                        'is_read': msg.is_read,
                        'created_at': msg.created_at.isoformat()
                    })
                return {'thread_id': thread_id, 'messages': formatted}
            except ChatThread.DoesNotExist:
                return {'error': 'Thread not found'}

        result = await sync_to_async(get_history_sync)()
        if 'error' in result:
            await self.send_json({'type': 'error', 'message': result['error']})
        else:
            await self.send_json({'type': 'history', **result})

    async def save_and_broadcast(self, thread_id, content, audio, image='', reply_to_id=None):
        def save_sync():
            try:
                thread = ChatThread.objects.get(id=thread_id)
                if self.user not in thread.participants.all():
                    return {'error': 'Not a participant'}
                reply_obj = None
                if reply_to_id and str(reply_to_id).isdigit():
                    try:
                        reply_obj = Message.objects.get(id=int(reply_to_id))
                    except Message.DoesNotExist:
                        reply_obj = None
                message = Message.objects.create(
                    thread=thread,
                    sender=self.user,
                    content=content,
                    audio=audio,
                    image=image,
                    reply_to=reply_obj,
                    is_read=False
                )
                thread.updated_at = message.created_at
                thread.save(update_fields=['updated_at'])

                # Pre-aggregate reaction rows so the inner
                # MessageSerializer doesn't issue a per-row query for
                # an N+1 fan-out on every send_message event.
                from api.serializers.chat import (
                    MessageSerializer as MsgSerializer,
                    _build_reactions_context,
                )
                rxn_ctx = _build_reactions_context([message], self.user)
                msg_data = MsgSerializer(message, context=rxn_ctx).data

                # Notification payload strips heavy image so inbox is light
                notification_payload = {**msg_data}
                if message.audio:
                    notification_payload['audio'] = ''
                    notification_payload['audio_pending'] = True

                recipients = list(thread.participants.exclude(id=self.user.id))
                other_user = thread.participants.exclude(id=self.user.id).first()
                other_data = None
                if other_user:
                    other_data = {
                        'id': other_user.id,
                        'username': other_user.username,
                        'avatar': other_user.profile.avatar if (hasattr(other_user, 'profile') and other_user.profile.avatar) else None,
                        'is_online': presence.is_online(other_user.id),
                    }
                return {
                    'thread_id': thread_id,
                    'message': msg_data,
                    'notification_payload': notification_payload,
                    'recipients': [p.id for p in recipients],
                    'other_user': other_data
                }
            except ChatThread.DoesNotExist:
                return {'error': 'Thread not found'}

        result = await sync_to_async(save_sync)()
        if 'error' in result:
            await self.send_json({'type': 'error', 'message': result['error']})
            return

        for uid in result['recipients']:
            await self.channel_layer.group_send(
                f'kot3_user_{uid}',
                {
                    'type': 'new_message_notification',
                    'thread_id': thread_id,
                    'message': result['notification_payload'],
                    'other_user': result['other_user']
                }
            )

        await self.channel_layer.group_send(
            f'kot3_thread_{thread_id}',
            {
                'type': 'new_message',
                'thread_id': thread_id,
                'message': result['message']
            }
        )

        # Mark message as delivered immediately if recipient is online
        try:
            # One Redis SMEMBERS round-trip instead of N ``is_online``
            # calls. The ``recipients`` list is small (typical N=1 for
            # a 1-on-1 thread), but a group chat scales this.
            online_set = await presence.online_user_ids_async()
            delivered_now = any(uid in online_set for uid in result['recipients'])
            if delivered_now:
                await sync_to_async(Message.objects.filter(id=result['message']['id']).update)(is_delivered=True)
                result['message']['is_delivered'] = True
                await self.channel_layer.group_send(
                    f'kot3_thread_{thread_id}',
                    {
                        'type': 'message_delivered',
                        'thread_id': thread_id,
                        'message_id': result['message']['id']
                    }
                )
        except Exception:
            pass

    async def mark_messages_read(self, thread_id, message_ids):
        try:
            valid_ids = [int(mid) for mid in message_ids if str(mid).isdigit()]
            if not valid_ids:
                return
            thread = await sync_to_async(ChatThread.objects.get)(id=thread_id)
            is_participant = await sync_to_async(lambda u, t: u in t.participants.all())(self.user, thread)
            if not is_participant:
                return
            updated = await sync_to_async(Message.objects.filter(id__in=valid_ids, thread=thread).exclude(sender=self.user).update)(is_read=True)
            if updated:
                # Notify senders that their messages are now read.
                sender_ids = await sync_to_async(list)(
                    Message.objects.filter(id__in=valid_ids, thread=thread).values_list('sender_id', flat=True).distinct()
                )
                for sid in sender_ids:
                    if sid == self.user.id:
                        continue
                    await self.channel_layer.group_send(
                        f'kot3_user_{sid}',
                        {
                            'type': 'message_read',
                            'thread_id': thread_id,
                            'message_ids': valid_ids,
                            'reader_id': self.user.id,
                            'reader_username': self.user.username
                        }
                    )
        except ChatThread.DoesNotExist:
            pass

    async def new_message(self, event):
        await self.send_json({
            'type': 'new_message',
            'thread_id': event['thread_id'],
            'message': event['message']
        })

    async def message_updated(self, event):
        await self.send_json({
            'type': 'message_updated',
            'thread_id': event['thread_id'],
            'message_id': event['message_id'],
            'content': event['content'],
            'is_edited': event.get('is_edited', True),
            'edited_at': event.get('edited_at')
        })

    async def message_delivered(self, event):
        await self.send_json({
            'type': 'message_delivered',
            'thread_id': event['thread_id'],
            'message_id': event['message_id']
        })

    async def message_read(self, event):
        await self.send_json({
            'type': 'message_read',
            'thread_id': event['thread_id'],
            'message_ids': event['message_ids'],
            'reader_id': event['reader_id'],
            'reader_username': event['reader_username']
        })

    async def typing_indicator(self, event):
        if event['user_id'] != self.user.id:
            await self.send_json({
                'type': 'typing',
                'thread_id': event['thread_id'],
                'user_id': event['user_id'],
                'username': event['username'],
                'is_typing': event['is_typing']
            })

    async def new_message_notification(self, event):
        await self.send_json({
            'type': 'notification',
            'thread_id': event['thread_id'],
            'message': event['message'],
            'other_user': event.get('other_user')
        })

    async def user_presence(self, event):
        await self.send_json({
            'type': 'presence_update',
            'user_id': event['user_id'],
            'username': event['username'],
            'status': event['status'],
            'last_seen': event.get('last_seen')
        })

    async def presence_broadcast(self, event):
        if event['user_id'] != self.user.id:
            await self.send_json({
                'type': 'presence_broadcast',
                'user_id': event['user_id'],
                'username': event['username'],
                'status': event['status']
            })

    async def incoming_call_broadcast(self, event):
        await self.send_json({
            'type': 'incoming_call',
            'caller_id': event['caller_id'],
            'caller_username': event['caller_username'],
            'call_type': event['call_type']
        })

    async def call_connected_broadcast(self, event):
        await self.send_json({
            'type': 'call_connected',
            'receiver_id': event['receiver_id']
        })

    async def call_hungup_broadcast(self, event):
        await self.send_json({
            'type': 'call_hungup',
            'sender_id': event['sender_id']
        })

    async def webrtc_signal_broadcast(self, event):
        await self.send_json({
            'type': 'webrtc_signal',
            'sender_id': event['sender_id'],
            'sender_username': event['sender_username'],
            'signal': event['signal']
        })

    async def save_and_broadcast_story(self, story_type, content, background):
        def save_story_sync():
            from api.models import UserStory
            story = UserStory.objects.create(
                user=self.user,
                type=story_type,
                content=content,
                background=background
            )
            return {
                'id': story.id,
                'user_id': self.user.id,
                'username': self.user.username,
                'type': story.type,
                'content': story.content,
                'background': story.background,
                'created_at': story.created_at.isoformat()
            }

        story_data = await sync_to_async(save_story_sync)()
        await self.channel_layer.group_send(
            'kot3_presence',
            {
                'type': 'story_broadcast',
                'story': story_data
            }
        )

    async def story_broadcast(self, event):
        await self.send_json({
            'type': 'new_story',
            'story': event['story']
        })

    # ------------------------------------------------------------------
    # Reactions (chat module Step 3)
    # ------------------------------------------------------------------
    async def toggle_reaction(self, message_id, emoji):
        """
        Toggle a (user, message, emoji) reaction row and broadcast a
        ``reaction_update`` event on the thread group.

        Why we send ``action: 'add'|'remove'`` instead of just the new
        aggregate state: the FE can apply it incrementally (cheap) and
        doesn't need to re-fetch the message; the existing reactions
        chip just shows/hides the user's own entry.
        """
        def toggle_sync():
            try:
                msg = Message.objects.select_related('thread').get(id=message_id)
            except Message.DoesNotExist:
                return {'error': 'Message not found'}
            if self.user not in msg.thread.participants.all():
                return {'error': 'Not a participant'}
            # Race-safe toggle (Reviewer MED #2). The whole read+write
            # runs inside ``transaction.atomic`` so two concurrent
            # toggles from the same user cannot both pass the
            # existence check + create path. ``IntegrityError`` is the
            # final fallback if a concurrent create races past the
            # atomic block on a parallel channel.
            from django.db import IntegrityError, transaction
            action = None
            with transaction.atomic():
                # Use a plain .filter().first() (NO select_for_update)
                # because SQLite — the dev fallback DB — raises
                # ``NotSupportedError: SELECT FOR UPDATE is not supported``
                # inside an atomic block. The race window is bounded by
                # the schema-level ``UniqueConstraint(fields=('message',
                # 'user', 'emoji'))`` so the ``except IntegrityError``
                # branch below still catches the concurrent insert.
                existing = MessageReaction.objects.filter(
                    message=msg, user=self.user, emoji=emoji,
                ).first()
                if existing:
                    existing.delete()
                    action = 'remove'
                else:
                    try:
                        MessageReaction.objects.create(message=msg, user=self.user, emoji=emoji)
                        action = 'add'
                    except IntegrityError:
                        # A peer raced ahead of us. The row will end up
                        # persisted either way; report 'add' so the FE
                        # state stays consistent.
                        action = 'add'
            return {
                'message_id': msg.id,
                'thread_id': msg.thread_id,
                'emoji': emoji,
                'user_id': self.user.id,
                'username': self.user.username,
                'action': action,
            }

        result = await sync_to_async(toggle_sync)()
        if 'error' in result:
            await self.send_json({'type': 'error', 'message': result['error']})
            return

        await self.channel_layer.group_send(
            f'kot3_thread_{result["thread_id"]}',
            {
                'type': 'reaction_update_broadcast',
                'message_id': result['message_id'],
                'emoji': result['emoji'],
                'user_id': result['user_id'],
                'username': result['username'],
                'action': result['action'],
            }
        )

    async def reaction_update_broadcast(self, event):
        await self.send_json({
            'type': 'reaction_update',
            'message_id': event['message_id'],
            'emoji': event['emoji'],
            'user_id': event['user_id'],
            'username': event['username'],
            'action': event['action'],
        })

    async def message_deleted(self, event):
        await self.send_json({
            'type': 'message_deleted',
            'thread_id': event['thread_id'],
            'message_id': event['message_id'],
            'deleted_by_id': event.get('deleted_by_id'),
            'deleted_at': event.get('deleted_at'),
        })

    async def thread_setting_updated(self, event):
        await self.send_json({
            'type': 'thread_setting_updated',
            'thread_id': event['thread_id'],
            'user_id': event['user_id'],
            'updates': event['updates'],
        })

    async def delete_message_for_everyone(self, message_id: int):
        """Phase 9 — soft-delete. Sender-only authorization performed via REST
        endpoint; this WS handler exists to keep clients in sync when the
        caller used REST (REST already broadcast, so receiving the same
        event twice is idempotent because the bubble is already a tombstone).
        """
        def soft_delete_sync():
            from django.utils import timezone as _tz
            from api.models import Message
            try:
                msg = Message.objects.select_related('thread').get(id=message_id)
            except Message.DoesNotExist:
                return {'error': 'Message not found'}
            if self.user not in msg.thread.participants.all():
                return {'error': 'Not a participant'}
            if msg.sender_id != self.user.id:
                return {'error': 'Only the author may delete.'}
            if msg.deleted_at:
                return {'already': True,
                        'thread_id': msg.thread_id,
                        'deleted_by_id': msg.deleted_by_id,
                        'deleted_at': msg.deleted_at.isoformat()}
            msg.deleted_at = _tz.now()
            msg.deleted_by = self.user
            msg.save(update_fields=['deleted_at', 'deleted_by'])
            return {
                'thread_id': msg.thread_id,
                'deleted_by_id': msg.deleted_by_id,
                'deleted_at': msg.deleted_at.isoformat(),
            }
        result = await sync_to_async(soft_delete_sync)()
        if 'error' in result:
            await self.send_json({'type': 'error', 'message': result['error']})
            return
        # Broadcast to every device in the thread room so the bubble collapses.
        await self.channel_layer.group_send(
            f'kot3_thread_{result["thread_id"]}',
            {
                'type': 'message_deleted',
                'thread_id': result['thread_id'],
                'message_id': message_id,
                'deleted_by_id': result['deleted_by_id'],
                'deleted_at': result['deleted_at'],
            },
        )

    async def update_thread_setting(self, thread_id, updates):
        """Sync per-user thread flags over WS. Mirrors the REST actions so a
        second device can apply the same change instantly."""
        from api.models import UserThreadSetting, ChatThread
        from django.utils import timezone as _tz
        from datetime import timedelta

        def sync():
            try:
                thread = ChatThread.objects.get(id=thread_id)
            except ChatThread.DoesNotExist:
                return {'error': 'Thread not found'}
            if self.user not in thread.participants.all():
                return {'error': 'Not a participant'}
            s, _ = UserThreadSetting.objects.get_or_create(user=self.user, thread=thread)
            applied = {}
            if 'is_pinned' in updates:
                s.is_pinned = bool(updates['is_pinned'])
                applied['is_pinned'] = s.is_pinned
            if 'is_archived' in updates:
                s.is_archived = bool(updates['is_archived'])
                applied['is_archived'] = s.is_archived
            if 'muted_hours' in updates:
                hours = int(updates['muted_hours'] or 0)
                hours = max(0, min(hours, 24 * 30))
                s.muted_until = (_tz.now() + timedelta(hours=hours)) if hours else None
                applied['is_muted'] = bool(s.muted_until)
            if 'is_request_ignored' in updates:
                s.is_request_ignored = bool(updates['is_request_ignored'])
                applied['is_request'] = not s.is_request_ignored
            s.save()
            return {
                'thread_id': thread.id,
                'updates': applied,
            }
        result = await sync_to_async(sync)()
        if 'error' in result:
            await self.send_json({'type': 'error', 'message': result['error']})
            return
        # Send back ONLY to this user (per-user pref — not the room).
        await self.channel_layer.group_send(
            f'kot3_user_{self.user.id}',
            {
                'type': 'thread_setting_updated',
                'thread_id': result['thread_id'],
                'user_id': self.user.id,
                'updates': result['updates'],
            },
        )

    # ------------------------------------------------------------------
    # Phase 9 — server-side CallLog persistence.
    #
    # The WS ``call_user`` / ``call_accepted`` / ``call_declined`` branches
    # in ``receive_json`` call these three helpers to write a row in
    # ``api.models.part4.CallLog``. We use the part4 model (kind / duration
    # / status enums) rather than a duplicate model — it was already
    # migrated by part4 and powers the FE's CallHistoryPanel.
    #
    # ``self.last_call_log_id`` is stashed on the consumer instance so
    # subsequent state transitions can resolve the row we just created
    # without a re-query. The id is intentionally per-consumer (per
    # channel) so two parallel calls from the same user don't collide
    # across tabs/devices.
    # ------------------------------------------------------------------
    async def _persist_call_attempt(self, target_user_id, call_type, status='outgoing'):
        def persist_sync():
            from api.models.part4 import CallLog
            from api.models import ChatThread
            from django.contrib.auth.models import User
            valid_kind = call_type if call_type in ('audio', 'video') else 'audio'
            try:
                target = User.objects.get(id=target_user_id)
            except User.DoesNotExist:
                return {'error': 'Target user not found'}
            # Look up the 1-on-1 thread (if any) so the CallLog row links
            # into the same conversation the user is staring at.
            shared_thread = (
                ChatThread.objects
                .filter(participants=self.user, is_group=False)
                .filter(participants=target)
                .first()
            )
            log = CallLog.objects.create(
                caller=self.user, callee=target, kind=valid_kind,
                status=status, duration=0, thread=shared_thread,
            )
            self.last_call_log_id = log.id
            self.last_callee_id = target.id
            return {'id': log.id, 'kind': log.kind, 'status': log.status}

        result = await sync_to_async(persist_sync)()
        return result

    async def _mark_call_connected(self, caller_id):
        def mark_sync():
            from api.models.part4 import CallLog
            from django.utils import timezone as _tz
            qs = (
                CallLog.objects
                .filter(caller_id=caller_id, callee=self.user,
                        status__in=('outgoing', 'incoming'))
                .order_by('-started_at')
            )
            log = qs.first()
            if not log:
                return {'error': 'No active call to mark'}
            log.status = 'completed'
            log.ended_at = _tz.now()
            log.save(update_fields=['status', 'ended_at'])
            self.last_call_log_id = log.id
            self.last_callee_id = caller_id
            return {'id': log.id, 'status': log.status}

        return await sync_to_async(mark_sync)()

    async def _finalize_call_with_peer(self, target_user_id, status='rejected'):
        """Close out a CallLog row. ``status`` is mapped to the part4 enum:
        ``declined`` → ``rejected``, ``missed`` → ``missed`` (callee never
        answered), ``completed`` → ``completed`` (caller hung up normally)."""
        valid_statuses = {c[0] for c in Part4CallLog.STATUS_CHOICES}
        mapped = 'rejected' if status == 'declined' else (
            status if status in valid_statuses else 'completed'
        )
        def finalize_sync():
            from django.utils import timezone as _tz
            # Build a Q-expression so we can OR caller-side / callee-side
            # without falling back to two separate queries.
            if target_user_id:
                call_filter = (
                    Q(caller=self.user, callee_id=target_user_id)
                    | Q(caller_id=target_user_id, callee=self.user)
                )
            else:
                call_filter = Q(caller=self.user) | Q(callee=self.user)
            log = (
                Part4CallLog.objects
                .filter(status__in=('outgoing', 'incoming', 'completed'))
                .filter(call_filter)
                .order_by('-started_at')
                .first()
            )
            if not log:
                return {'noop': True}
            duration = max(0, int((_tz.now() - log.started_at).total_seconds()))
            log.status = mapped
            log.duration = duration
            log.ended_at = _tz.now()
            log.save(update_fields=['status', 'duration', 'ended_at'])
            return {'id': log.id, 'status': log.status, 'duration': log.duration}

        return await sync_to_async(finalize_sync)()

    # ------------------------------------------------------------------
    # Forward (chat module Step 4)
    # ------------------------------------------------------------------
    async def forward_message(self, forwarded_from_id, target_thread_id):
        """
        Copy an existing message into ``target_thread_id`` as a new
        Message row with ``forwarded_from`` pointing back to the
        original. The original's sender name is snapshotted into
        ``forward_sender_name`` so the bubble can still render the
        "Forwarded from @bob" badge even if the original row is later
        deleted.

        We copy content + image + audio verbatim. We do NOT forward
        read/delivery/edited state — those reset on the new copy.
        """
        def forward_sync():
            try:
                original = Message.objects.select_related('sender', 'thread').get(id=forwarded_from_id)
            except Message.DoesNotExist:
                return {'error': 'Original message not found'}
            try:
                target = ChatThread.objects.get(id=target_thread_id)
            except ChatThread.DoesNotExist:
                return {'error': 'Target thread not found'}
            if self.user not in target.participants.all():
                return {'error': 'Not a participant in target thread'}
            new = Message.objects.create(
                thread=target,
                sender=self.user,
                content=original.content,
                audio=original.audio,
                image=original.image,
                forwarded_from=original,
                # ``original.sender`` was loaded via select_related('sender'),
                # so it cannot be None on a row that exists. Collapse
                # the dead-branch defensive check (Reviewer LOW #5).
                forward_sender_name=original.sender.username,
            )
            target.updated_at = new.created_at
            target.save(update_fields=['updated_at'])
            from api.serializers.chat import (
                MessageSerializer as MsgSerializer,
                _build_reactions_context,
            )
            rxn_ctx = _build_reactions_context([new], self.user)
            payload = MsgSerializer(new, context=rxn_ctx).data
            recipients = list(target.participants.exclude(id=self.user.id))
            # Build the "other_user" view so the FE doesn't need a
            # second round-trip to render the thread card on a forward
            # (Reviewer LOW #3). Mirrors save_and_broadcast() shape.
            other_user = target.participants.exclude(id=self.user.id).first()
            other_data = None
            if other_user:
                other_data = {
                    'id': other_user.id,
                    'username': other_user.username,
                    'avatar': other_user.profile.avatar if (hasattr(other_user, 'profile') and other_user.profile.avatar) else None,
                    'is_online': presence.is_online(other_user.id),
                }
            return {
                'thread_id': target.id,
                'message': payload,
                'recipients': [r.id for r in recipients],
                'other_user': other_data,
            }

        result = await sync_to_async(forward_sync)()
        if 'error' in result:
            await self.send_json({'type': 'error', 'message': result['error']})
            return

        # Notify recipients (notification payload strips heavy media bytes).
        # Mirrors save_and_broadcast() so the FE inbox look is consistent
        # whether the message was sent directly or forwarded.
        notification_payload = {**result['message']}
        if result['message'].get('image'):
            notification_payload['image'] = ''  # keep inbox light
        if result['message'].get('audio'):
            notification_payload['audio'] = ''
            notification_payload['audio_pending'] = True
        for uid in result['recipients']:
            await self.channel_layer.group_send(
                f'kot3_user_{uid}',
                {
                    'type': 'new_message_notification',
                    'thread_id': result['thread_id'],
                    'message': notification_payload,
                    # other_user mirrors save_and_broadcast so the FE
                    # renders the thread card with sender info (Reviewer
                    # LOW #3).
                    'other_user': result['other_user'],
                }
            )

        # Broadcast to the thread room (everyone active in it sees it).
        await self.channel_layer.group_send(
            f'kot3_thread_{result["thread_id"]}',
            {
                'type': 'new_message',
                'thread_id': result['thread_id'],
                'message': result['message'],
            }
        )
