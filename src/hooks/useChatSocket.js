/**
 * src/hooks/useChatSocket.js
 *
 * Custom React hook owning the Kot3Chat WebSocket connection lifecycle.
 *
 * This is the foundation for the Kot3Chat refactor: it pulls the entire
 * connect / reconnect ladder out of Kot3Chat.jsx WITHOUT changing the wire
 * protocol or the message-routing semantics. The host component (Kot3Chat)
 * still owns threads + messages + UI state; this hook just gives it a
 * stable `wsRef`-style API plus a curated set of typed send helpers.
 *
 * Why a hook (and not a class or imperative factory)?
 *   * React 18 functional-component route makes the cleanup story a one-line
 *     `useEffect(() => () => {...}, [])` instead of explicit unwire.
 *   * The 4401-refresh-token replay needs `await import('../services/api')`
 *     to dodge circular imports with the axios client. Centralizing it here
 *     keeps the deferred-load dance in one place.
 *   * The audio-side effects (send/receive/connected chimes) belong in
 *     `audioUtils.js`; we import them here so callers don't have to wire
 *     them up themselves when WS events fire.
 *
 * Send helpers exposed
 * --------------------
 * Each helper returns `true` if the message went out, `false` if the
 * socket wasn't open (so the caller can fall back to REST where it exists).
 *
 *   sendJoinThread(threadId)
 *   sendLeaveThread()
 *   sendMessage(threadId, { content, audio, image, reply_to_id })
 *   sendEditMessage(messageId, newContent)
 *   sendTyping(threadId, isTyping)
 *   sendMarkRead(threadId, messageIds)
 *   sendReaction(messageId, emoji)
 *   sendForward(forwardedFromId, targetThreadId)
 *   sendCallUser(targetUserId, callType)
 *   sendCallAccepted(callerId)
 *   sendCallDeclined(targetUserId)
 *   sendWebRtcSignal(targetUserId, signal)
 *   sendPublishStory({ story_type, content, background })
 *
 * Live state returned
 * -------------------
 *   wsConnected           — boolean (set on socket.onopen, cleared on close)
 *   onlineUsers           — { [userId]: { username, status, last_seen } }
 *   lastSeenById          — { [userId]: ISO string } (snapshot for badges)
 *   typingUsers           — { [threadId]: username }  (one typist per thread)
 *   reactionVersion       — incremented on every reaction_update push so
 *                            consumers can re-render the chip row cheaply
 *
 * Mutation API exposed via the returned object
 * ---------------------------------------------
 *   markOnline(userId, username)         — caller-driven online notice
 *   markOffline(userId, username)        — caller-driven offline notice
 *   reset()                              — wipe all in-memory presence rows
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { chatService } from '../services/api';
import { buildChatSocketUrl, sameId, isTempId } from '../components/kot3chat/constants';
import {
  playSendBeep,
  playReceiveBeep,
  playConnectedChime,
} from '../components/kot3chat/audioUtils';

/**
 * @param {Object} opts
 * @param {Object|null} opts.user          — current user. WS does not connect until truthy.
 * @param {string|number|null} opts.activeThreadId — thread the chat pane has open.
 * @param {Function} opts.onMessage        — (msg) => void  new-message handler.
 * @param {Function} opts.onThreadBump     — ({threadId, message}) => void
 * @param {Function} opts.onMessageUpdated — ({messageId, content, is_edited, edited_at}) => void
 * @param {Function} opts.onMessageDelivered — ({messageId}) => void
 * @param {Function} opts.onMessageRead   — ({messageIds, readerId, readerUsername}) => void
 * @param {Function} opts.onTyping         — ({threadId, username, isTyping}) => void
 * @param {Function} opts.onStory          — (story) => void
 * @param {Function} opts.onPresenceOnline — ({userId, username}) => void
 * @param {Function} opts.onPresenceOffline — ({userId, username, lastSeen}) => void
 * @param {Function} opts.onIncomingCall   — ({callerId, callerUsername, callType}) => void
 * @param {Function} opts.onCallConnected  — ({receiverId}) => void
 * @param {Function} opts.onCallHungup     — ({senderId}) => void
 * @param {Function} opts.onWebRtcSignal   — ({senderId, senderUsername, signal}) => void
 * @param {Function} opts.onReactionUpdate — ({messageId, emoji, userId, action}) => void
 * @param {Function} opts.onHistory        — ({threadId, messages}) => void
 * @param {Function} opts.onError          — (message) => void
 * @param {Function} opts.onConnected      — ({userId, username}) => void
 * @param {Function} [opts.onJoinedThread] — ({threadId}) => void
 * @param {Function} [opts.onLeftThread]   — () => void
 * @param {Function} [opts.toast]          — (text, icon) => void  for UX messages
 * @param {string}    [opts.lang]          — 'ht' | 'en' | …     for toast localization
 */
export function useChatSocket(opts) {
  const {
    user,
    activeThreadId,
    onMessage,
    onThreadBump,
    onMessageUpdated,
    onMessageDelivered,
    onMessageRead,
    onTyping,
    onStory,
    onPresenceOnline,
    onPresenceOffline,
    onIncomingCall,
    onCallConnected,
    onCallHungup,
    onWebRtcSignal,
    onReactionUpdate,
    onHistory,
    onError,
    onConnected,
    onJoinedThread,
    onLeftThread,
    toast,
    lang,
  } = opts || {};

  // ─────────── live state returned to the caller ───────────
  const [wsConnected, setWsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('kot3_online_users') || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  });
  const [lastSeenById, setLastSeenById] = useState({});
  const [typingUsers, setTypingUsers] = useState({});
  const [reactionVersion, setReactionVersion] = useState(0);

  // ─────────── internal refs (do NOT trigger re-renders) ───────────
  const wsRef = useRef(null);
  const wsReadyRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const activeThreadIdRef = useRef(null);

  // Persist the active thread so any auto-reconnect can rejoin the room.
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId || null;
  }, [activeThreadId]);

  // Persist online snapshot so a hot-reload doesn't blank the badges.
  useEffect(() => {
    try { localStorage.setItem('kot3_online_users', JSON.stringify(onlineUsers)); } catch {}
  }, [onlineUsers]);

  // Force-logout listener — the axios interceptor fires `devrose:auth:logout`
  // on a refresh-token rejection. We MUST close the socket so we don't keep
  // burning server-side presence slots while the user is signed out. Same
  // behavior as Kot3Chat currently has; lifted verbatim into the hook.
  useEffect(() => {
    const handler = () => {
      try {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
          wsRef.current.close(1000, 'Forced logout');
        }
      } catch { /* ignore */ }
      wsReadyRef.current = false;
      wsRef.current = null;
      setWsConnected(false);
    };
    window.addEventListener('devrose:auth:logout', handler);
    return () => window.removeEventListener('devrose:auth:logout', handler);
  }, []);

  // ─────────── reconnect ladder ───────────
  // The 4401 path fetches a fresh access token via the axios default export
  // (deferred import to avoid a circular dep) and replays connectWS().
  const tryRefreshThenReconnect = useCallback(async () => {
    const refresh = localStorage.getItem('refresh_token');
    if (!refresh) {
      try { window.dispatchEvent(new CustomEvent('devrose:auth:logout')); } catch {}
      return;
    }
    try {
      const axios = (await import('../services/api')).default;
      const { data } = await axios.post('refresh/', { refresh });
      if (data?.access) {
        localStorage.setItem('access_token', data.access);
        if (data?.refresh) localStorage.setItem('refresh_token', data.refresh);
        reconnectAttemptRef.current = 0;
        connect();
        return;
      }
    } catch (e) {
      console.warn('useChatSocket: refresh failed after 4401', e);
    }
    try { window.dispatchEvent(new CustomEvent('devrose:auth:logout')); } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    if (!user) return;
    clearTimeout(reconnectTimerRef.current);
    const token = localStorage.getItem('access_token') || localStorage.getItem('token');
    if (!token) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(buildChatSocketUrl(token));
    const ws = socket;
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('useChatSocket: ws open');
      reconnectAttemptRef.current = 0;
      wsReadyRef.current = true;
      setWsConnected(true);
      if (activeThreadIdRef.current) {
        ws.send(JSON.stringify({ type: 'join_thread', thread_id: activeThreadIdRef.current }));
      }
      onConnected?.({ userId: user.id, username: user.username });
    };

    ws.onclose = (e) => {
      console.log('useChatSocket: ws closed', e.code, e.reason);
      wsReadyRef.current = false;
      wsRef.current = null;
      setWsConnected(false);
      if (!user || e.code === 1000) return;
      if (e.code === 4401) {
        tryRefreshThenReconnect();
        return;
      }
      reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, 10);
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 15000);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error('useChatSocket: ws error', err);
      wsReadyRef.current = false;
      setWsConnected(false);
    };

    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (err) {
        console.error('useChatSocket: parse error', err);
        return;
      }
      switch (data.type) {
        case 'connected':
          // server-side hello envelope; nothing to do here, but leave a hook.
          break;
        case 'joined_thread':
          onJoinedThread?.({ threadId: data.thread_id });
          break;
        case 'left_thread':
          onLeftThread?.();
          break;
        case 'history':
          onHistory?.({ threadId: data.thread_id, messages: data.messages });
          break;
        case 'new_message': {
          onMessage?.(data.message);
          onThreadBump?.({ threadId: data.thread_id, message: data.message });
          if (data.message?.sender_id !== user.id && sameId(data.thread_id, activeThreadIdRef.current)) {
            playReceiveBeep();
          }
          break;
        }
        case 'message_updated':
          onMessageUpdated?.({
            messageId: data.message_id,
            content: data.content,
            is_edited: data.is_edited,
            edited_at: data.edited_at,
          });
          break;
        case 'message_delivered':
          onMessageDelivered?.({ messageId: data.message_id });
          break;
        case 'message_read':
          onMessageRead?.({
            messageIds: data.message_ids,
            readerId: data.reader_id,
            readerUsername: data.reader_username,
          });
          break;
        case 'typing': {
          setTypingUsers(prev => {
            const next = { ...prev };
            if (data.is_typing) next[data.thread_id] = data.username;
            else delete next[data.thread_id];
            return next;
          });
          onTyping?.({ threadId: data.thread_id, username: data.username, isTyping: data.is_typing });
          break;
        }
        case 'reaction_update':
          setReactionVersion(v => (v + 1) % 1e9);
          onReactionUpdate?.({
            messageId: data.message_id,
            emoji: data.emoji,
            userId: data.user_id,
            username: data.username,
            action: data.action,
          });
          break;
        case 'presence_update':
        case 'presence_broadcast': {
          setOnlineUsers(prev => {
            const next = { ...prev };
            if (data.status === 'online') {
              next[data.user_id] = { username: data.username, status: 'online', last_seen: null };
              onPresenceOnline?.({ userId: data.user_id, username: data.username });
            } else {
              next[data.user_id] = {
                username: data.username,
                status: 'offline',
                last_seen: data.last_seen || new Date().toISOString(),
              };
              setLastSeenById(prev => ({ ...prev, [data.user_id]: data.last_seen || null }));
              onPresenceOffline?.({
                userId: data.user_id,
                username: data.username,
                lastSeen: data.last_seen,
              });
            }
            return next;
          });
          break;
        }
        case 'new_story':
          onStory?.(data.story);
          break;
        case 'incoming_call':
          playReceiveBeep();
          onIncomingCall?.({
            callerId: data.caller_id,
            callerUsername: data.caller_username,
            callType: data.call_type,
          });
          break;
        case 'call_connected':
          playConnectedChime();
          onCallConnected?.({ receiverId: data.receiver_id });
          break;
        case 'call_hungup':
          onCallHungup?.({ senderId: data.sender_id });
          break;
        case 'webrtc_signal':
          onWebRtcSignal?.({
            senderId: data.sender_id,
            senderUsername: data.sender_username,
            signal: data.signal,
          });
          break;
        case 'error':
          onError?.(data.message);
          if (toast) toast(lang === 'ht' ? 'Erè nan chat.' : data.message || 'Chat error', 'exclamation-triangle');
          break;
        default:
          break;
      }
    };
  }, [
    user, tryRefreshThenReconnect,
    onMessage, onThreadBump, onMessageUpdated, onMessageDelivered, onMessageRead,
    onTyping, onStory, onPresenceOnline, onPresenceOffline,
    onIncomingCall, onCallConnected, onCallHungup, onWebRtcSignal,
    onReactionUpdate, onHistory, onError, onConnected, onJoinedThread, onLeftThread,
    toast, lang,
  ]);

  // Top-level connect/disconnect lifecycle driven by `user`.
  useEffect(() => {
    if (!user) return undefined;
    connect();
    return () => {
      try {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
          wsRef.current.close(1000, 'Unmount');
        }
      } catch {}
      wsRef.current = null;
      wsReadyRef.current = false;
      setWsConnected(false);
      clearTimeout(reconnectTimerRef.current);
    };
  }, [user, connect]);

  // ─────────── send helpers (return true on success, false if not open) ───────────
  const safeSend = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !wsReadyRef.current) return false;
    try { ws.send(JSON.stringify(payload)); return true; } catch { return false; }
  }, []);

  const sendJoinThread = useCallback((threadId) => {
    return safeSend({ type: 'join_thread', thread_id: threadId });
  }, [safeSend]);
  const sendLeaveThread = useCallback(() => safeSend({ type: 'leave_thread' }), [safeSend]);

  const sendMessage = useCallback((threadId, payload) => {
    const ok = safeSend({
      type: 'send_message',
      thread_id: threadId,
      content: payload.content || '',
      audio: payload.audio || '',
      image: payload.image || '',
      reply_to_id: payload.reply_to_id || null,
    });
    if (ok) playSendBeep();
    return ok;
  }, [safeSend]);

  const sendEditMessage = useCallback((messageId, newContent) => {
    const ok = safeSend({ type: 'edit_message', message_id: messageId, content: newContent });
    if (ok) playSendBeep();
    return ok;
  }, [safeSend]);

  // Typing sender. Auto-clears after 2s and falls back to clearing the local
  // typingUsers entry at 3.5s even if the remote "is_typing:false" payload
  // gets dropped (matches Kot3Chat's safety net).
  const typingTimerRef = useRef(null);
  const typingAutoClearRef = useRef({});
  const sendTyping = useCallback((threadId, isTyping) => {
    if (!isTyping) {
      safeSend({ type: 'typing', thread_id: threadId, is_typing: false });
      return;
    }
    safeSend({ type: 'typing', thread_id: threadId, is_typing: true });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      safeSend({ type: 'typing', thread_id: threadId, is_typing: false });
    }, 2000);
    clearTimeout(typingAutoClearRef.current[threadId]);
    typingAutoClearRef.current[threadId] = setTimeout(() => {
      setTypingUsers(prev => {
        if (!prev[threadId]) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
    }, 3500);
  }, [safeSend]);

  const sendMarkRead = useCallback((threadId, messageIds) => {
    return safeSend({ type: 'mark_read', thread_id: threadId, message_ids: messageIds });
  }, [safeSend]);

  const sendReaction = useCallback((messageId, emoji) => {
    return safeSend({ type: 'add_reaction', message_id: messageId, emoji });
  }, [safeSend]);

  const sendForward = useCallback((forwardedFromId, targetThreadId) => {
    return safeSend({
      type: 'forward_message',
      forwarded_from_id: forwardedFromId,
      target_thread_id: targetThreadId,
    });
  }, [safeSend]);

  const sendCallUser = useCallback((targetUserId, callType) => {
    return safeSend({ type: 'call_user', target_user_id: targetUserId, call_type: callType });
  }, [safeSend]);

  const sendCallAccepted = useCallback((callerId) => {
    return safeSend({ type: 'call_accepted', caller_id: callerId });
  }, [safeSend]);

  const sendCallDeclined = useCallback((targetUserId) => {
    return safeSend({ type: 'call_declined', target_user_id: targetUserId });
  }, [safeSend]);

  const sendWebRtcSignal = useCallback((targetUserId, signal) => {
    return safeSend({ type: 'webrtc_signal', target_user_id: targetUserId, signal });
  }, [safeSend]);

  const sendPublishStory = useCallback((payload) => {
    return safeSend({
      type: 'publish_story',
      story_type: payload.story_type,
      content: payload.content,
      background: payload.background || '',
    });
  }, [safeSend]);

  // ─────────── caller-driven presence helpers ───────────
  const markOnline = useCallback((userId, username) => {
    setOnlineUsers(prev => ({ ...prev, [userId]: { username, status: 'online', last_seen: null } }));
  }, []);
  const markOffline = useCallback((userId, username) => {
    setOnlineUsers(prev => ({
      ...prev,
      [userId]: { username, status: 'offline', last_seen: new Date().toISOString() },
    }));
  }, []);
  const reset = useCallback(() => {
    setOnlineUsers({});
    setLastSeenById({});
    setTypingUsers({});
    setReactionVersion(0);
  }, []);

  return {
    wsConnected,
    wsRef,
    wsReadyRef,
    onlineUsers,
    lastSeenById,
    typingUsers,
    reactionVersion,
    sendJoinThread,
    sendLeaveThread,
    sendMessage,
    sendEditMessage,
    sendTyping,
    sendMarkRead,
    sendReaction,
    sendForward,
    sendCallUser,
    sendCallAccepted,
    sendCallDeclined,
    sendWebRtcSignal,
    sendPublishStory,
    markOnline,
    markOffline,
    reset,
  };
}

/**
 * Re-export chatService for the few places that need to fall back to REST
 * (sendMessage HTTP fallback, getMessages, markRead REST, etc.). Keeps the
 * import surface flat for the consumer: `import { chatService, useChatSocket }`.
 */
export { chatService };

// Helper used inside the host component (when it needs optimistic temp-id
// reconciliation). Not exported by default — host pulls it from `./constants`
// directly. Re-export here for convenience in callers that prefer one-stop.
export { sameId, isTempId };
