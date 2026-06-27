import json
import time
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from asgiref.sync import sync_to_async
from api.models import ChatThread, Message
from django.contrib.auth.models import User
from django.utils import timezone

online_users = {}  # user_id -> set of channel_names
typing_users = {}  # thread_id -> {user_id: timestamp}
room_connections = {}  # room_group_name -> {channel_name: user_info}
room_user_channels = {}  # room_group_name -> {user_id: channel_name}

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

        if self.room_group_name not in room_connections:
            room_connections[self.room_group_name] = {}
        if self.room_group_name not in room_user_channels:
            room_user_channels[self.room_group_name] = {}
        room_connections[self.room_group_name][self.channel_name] = user_info

        existing_channel = None
        if user_info['user_id'] is not None:
            existing_channel = room_user_channels[self.room_group_name].get(user_info['user_id'])
            if existing_channel and existing_channel != self.channel_name:
                await self.channel_layer.send(
                    existing_channel,
                    {
                        'type': 'session_replaced',
                        'replacement_channel_name': self.channel_name
                    }
                )
                room_connections[self.room_group_name].pop(existing_channel, None)
            room_user_channels[self.room_group_name][user_info['user_id']] = self.channel_name

        other_peers = {
            channel: info 
            for channel, info in room_connections[self.room_group_name].items() 
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
        count = len(room_connections.get(self.room_group_name, {}))
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
        
        if self.user.id not in online_users:
            online_users[self.user.id] = set()
        online_users[self.user.id].add(self.channel_name)

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

    async def disconnect(self, close_code):
        self.connected = False
        if getattr(self, 'room_group_name', None):
            if self.room_group_name in room_connections:
                room_connections[self.room_group_name].pop(self.channel_name, None)
                if not room_connections[self.room_group_name]:
                    del room_connections[self.room_group_name]
            if self.room_group_name in room_user_channels and getattr(self, 'user', None) and self.user and self.user.is_authenticated:
                current_channel = room_user_channels[self.room_group_name].get(self.user.id)
                if current_channel == self.channel_name:
                    room_user_channels[self.room_group_name].pop(self.user.id, None)
                    if not room_user_channels[self.room_group_name]:
                        del room_user_channels[self.room_group_name]
            await self.channel_layer.group_send(
                self.room_group_name,
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

        if self.user.id in online_users:
            online_users[self.user.id].discard(self.channel_name)
            if not online_users[self.user.id]:
                del online_users[self.user.id]
                await self.broadcast_presence_to_threads('offline')

        for thread_id in list(typing_users.keys()):
            if self.user.id in typing_users.get(thread_id, {}):
                del typing_users[thread_id][self.user.id]
                if not typing_users[thread_id]:
                    del typing_users[thread_id]

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
                if is_typing:
                    if thread_id not in typing_users:
                        typing_users[thread_id] = {}
                    typing_users[thread_id][self.user.id] = time.time()
                else:
                    if thread_id in typing_users and self.user.id in typing_users[thread_id]:
                        del typing_users[thread_id][self.user.id]
                        if not typing_users[thread_id]:
                            del typing_users[thread_id]
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
            await self.channel_layer.group_send(
                f'kot3_user_{caller_id}',
                {
                    'type': 'call_connected_broadcast',
                    'receiver_id': self.user.id
                }
            )

        elif msg_type == 'call_declined':
            target_user_id = content.get('target_user_id')
            await self.channel_layer.group_send(
                f'kot3_user_{target_user_id}',
                {
                    'type': 'call_hungup_broadcast',
                    'sender_id': self.user.id
                }
            )

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

                from ..serializers.chat import MessageSerializer as MsgSerializer
                msg_data = MsgSerializer(message).data

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
                        'is_online': other_user.id in online_users
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
            delivered_now = any(uid in online_users for uid in result['recipients'])
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

    async def clean_old_typing(self):
        now = time.time()
        for thread_id in list(typing_users.keys()):
            for user_id in list(typing_users[thread_id].keys()):
                if now - typing_users[thread_id][user_id] > 4:
                    del typing_users[thread_id][user_id]
            if not typing_users[thread_id]:
                del typing_users[thread_id]

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
