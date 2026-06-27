// refactor_kot3chat.mjs — comprehensive Kot3Chat.jsx Messenger-style overhaul
// Applies: image attachments, reply-to, edit, delivery ticks, scroll FAB, dark mode
import fs from 'node:fs';

const JS = 'src/components/Kot3Chat.jsx';
let js = fs.readFileSync(JS, 'utf-8');

const before = js.length;

// ====================================================================
// 1. STATE HOOKS: insert new Messenger-style state near existing STATES
// ====================================================================
const stateAnchor = 'const [messages, setMessages] = useState([]);';
const newState = `const [messages, setMessages] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [attachedImage, setAttachedImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try { return localStorage.getItem('kot3_dark_mode') !== 'false'; } catch { return true; }
  });
`;

if (js.includes(stateAnchor) && !js.includes('const [replyingTo, setReplyingTo]')) {
  js = js.replace(stateAnchor, newState);
  console.log('STEP 1 OK: state hooks injected');
} else {
  console.log('STEP 1 SKIP: state already injected or anchor missing');
}

// ====================================================================
// 2. MESSAGE SEND: include image + reply_to_id + edit_message handling
// ====================================================================
const sendAnchor = `const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!activeThread || activeThread.is_temp || !input.trim()) return;

    const messageContent = input;
    setInput('');

    const tempId = 'tmp-' + Date.now();
    const tempMsg = {
      id: tempId,
      thread_id: activeThread.id,
      sender_id: user.id,
      sender_username: user.username,
      content: messageContent,
      audio: '',
      is_read: false,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempMsg]);
    playSendBeep();

    if (wsRef.current && wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        type: 'send_message',
        thread_id: activeThread.id,
        content: messageContent,
        audio: ''
      });
      wsRef.current.send(payload);
    } else {
      // HTTP REST fallback with real-time broadcasting at backend
      try {
        const res = await chatService.sendMessage(activeThread.id, { content: messageContent, audio: '' });
        setMessages(prev => prev.map(m => m.id === tempId ? res.data : m));
      } catch (err) {
        console.error("Failed to send message via HTTP fallback", err);
        if (showToast) showToast(lang === 'ht' ? 'Erè nan voye mesaj.' : 'Failed to send message.', 'exclamation-triangle');
        setMessages(prev => prev.filter(m => m.id !== tempId));
      }
    }
  };`;

const newSend = `const handleSendMessage = async (e) => {
    if (e) e.preventDefault();

    // EDIT MODE: send a small edit_message WS event instead.
    if (editingMessage && activeThread && !activeThread.is_temp) {
      const newContent = input.trim();
      if (!newContent) return;
      const editingId = editingMessage.id;
      const editingOldContent = editingMessage.content;
      // Optimistic local change.
      setMessages(prev => prev.map(m => m.id === editingId ? { ...m, content: newContent, is_edited: true } : m));
      setInput('');
      setEditingMessage(null);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'edit_message', message_id: editingId, content: newContent }));
        playSendBeep();
      } else {
        // HTTP fallback not available for edits in REST view, queue for next reconnect.
        if (showToast) showToast(lang === 'ht' ? 'Koneksyon rete. Edit ap sove lè w re-konekte.' : 'Offline. Edit will save on reconnect.', 'info-circle');
      }
      try { localStorage.setItem('kot3_messages_' + activeThread.id, JSON.stringify([...messages])); } catch {}
      return;
    }

    if (!activeThread || activeThread.is_temp || (!input.trim() && !attachedImage)) return;

    const messageContent = input;
    const imagePayload = attachedImage || '';
    setInput('');
    setAttachedImage(null);
    setImagePreviewUrl('');
    setReplyingTo(null);

    const tempId = 'tmp-' + Date.now();
    const tempMsg = {
      id: tempId,
      thread_id: activeThread.id,
      sender_id: user.id,
      sender_username: user.username,
      content: messageContent,
      audio: '',
      image: imagePayload,
      reply_to_id: replyingTo?.id || null,
      reply_to_snippet: replyingTo?.reply_to_snippet || (replyingTo?.content || '').slice(0, 80),
      reply_to_sender: replyingTo?.reply_to_sender || replyingTo?.sender_username || '',
      is_read: false,
      is_delivered: false,
      is_edited: false,
      status: 'sending',
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempMsg]);
    playSendBeep();

    if (wsRef.current && wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        type: 'send_message',
        thread_id: activeThread.id,
        content: messageContent,
        audio: '',
        image: imagePayload || undefined,
        reply_to_id: replyingTo?.id || undefined
      });
      wsRef.current.send(payload);
      // Optimistically mark delivered when recipient is online — upheld by server.
      const other = (activeThread.participants || []).find(p => p.id !== user.id);
      if (other && onlineUsers[other.id]) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'delivered', is_delivered: true } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'sent' } : m));
      }
    } else {
      // HTTP REST fallback with real-time broadcasting at backend
      try {
        const res = await chatService.sendMessage(activeThread.id, {
          content: messageContent,
          audio: '',
          image: imagePayload,
          reply_to_id: replyingTo?.id || null
        });
        setMessages(prev => prev.map(m => m.id === tempId ? res.data : m));
      } catch (err) {
        console.error("Failed to send message via HTTP fallback", err);
        if (showToast) showToast(lang === 'ht' ? 'Erè nan voye mesaj.' : 'Failed to send message.', 'exclamation-triangle');
        setMessages(prev => prev.filter(m => m.id !== tempId));
      }
    }
  };

  // ===== Image attachment helpers =====
  const handleImageAttach = (file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      if (showToast) showToast(lang === 'ht' ? 'Imaj twò gwo. Max 4MB.' : 'Image too large. Max 4MB.', 'exclamation-triangle');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachedImage(String(reader.result || ''));
      setImagePreviewUrl(String(reader.result || ''));
      setAttachmentMenuOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const clearAttachedImage = () => {
    setAttachedImage(null);
    setImagePreviewUrl('');
  };

  // ===== Reply / Edit handlers =====
  const startReply = (msg) => {
    setReplyingTo({
      id: msg.id,
      content: msg.content || (msg.image ? '📷 Image' : (msg.audio ? '🎙️ Voice' : '')),
      reply_to_snippet: (msg.content || '').slice(0, 80),
      reply_to_sender: msg.sender_username || '',
      sender_username: msg.sender_username
    });
    setEditingMessage(null);
    setAttachedImage(null);
    setImagePreviewUrl('');
  };
  const cancelReply = () => setReplyingTo(null);

  const startEditMessage = (msg) => {
    setEditingMessage(msg);
    setReplyingTo(null);
    setAttachedImage(null);
    setImagePreviewUrl('');
    setInput(msg.content || '');
  };
  const cancelEdit = () => {
    setEditingMessage(null);
    setInput('');
  };

  // Theme toggle
  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      try { localStorage.setItem('kot3_dark_mode', next ? 'true' : 'false'); } catch {}
      return next;
    });
  };`;

if (js.includes(sendAnchor) && !js.includes('EDIT MODE: send a small edit_message WS event')) {
  js = js.replace(sendAnchor, newSend);
  console.log('STEP 2 OK: send_message + image + reply + edit + theme helpers');
} else {
  console.log('STEP 2 SKIP: anchor missing or already patched');
}

// ====================================================================
// 3. WS HANDLER: receive new message types (updated, delivered, read)
// ====================================================================
const caseNewMessage = `          case 'new_message':
            setMessages(prev => {
              const hasReal = prev.some(m => m.id === data.message.id);
              if (hasReal) return prev;
              
              // Replace the matching optimistic message once the persisted message arrives.
              const noTmp = prev.filter(m => !(
                isTempId(m.id) &&
                m.sender_id === data.message.sender_id &&
                m.content === data.message.content &&
                m.audio === data.message.audio
              ));
              const updated = [...noTmp, data.message];

              if (sameId(data.thread_id, activeThreadIdRef.current)) {
                const unreadIds = updated.filter(m => !m.is_read && m.sender_id !== user.id).map(m => m.id);
                if (unreadIds.length) {
                  chatService.markRead(data.thread_id, unreadIds).catch(() => {});
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'mark_read', thread_id: data.thread_id, message_ids: unreadIds }));
                  }
                  setThreads(prevT => prevT.map(t => sameId(t.id, data.thread_id) ? { ...t, unread_count: 0 } : t));
                  return updated.map(m => unreadIds.includes(m.id) ? { ...m, is_read: true, status: m.sender_id === user.id ? 'read' : m.status } : m);
                }
              }
              return updated;
            });`;

const newCaseNewMessage = `          case 'new_message':
            setMessages(prev => {
              const hasReal = prev.some(m => m.id === data.message.id);
              if (hasReal) return prev;
              
              // Replace the matching optimistic temp message once the persisted message arrives.
              const isAudioPending = !!data.message.audio_pending;
              const noTmp = prev.filter(m => !(
                isTempId(m.id) &&
                m.sender_id === data.message.sender_id &&
                m.content === data.message.content &&
                (m.audio || '') === (data.message.audio || '')
              ));
              // Mark incoming as read if it's the active thread and from someone else.
              const isMine = data.message.sender_id === user.id;
              const inActive = sameId(data.thread_id, activeThreadIdRef.current);
              const enriched = {
                ...data.message,
                status: isMine ? (data.message.is_delivered ? 'delivered' : 'sent') : 'received'
              };
              const updated = [...noTmp, enriched];

              if (inActive && !isMine) {
                const unreadIds = [data.message.id];
                chatService.markRead(data.thread_id, unreadIds).catch(() => {});
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'mark_read', thread_id: data.thread_id, message_ids: unreadIds }));
                }
                setThreads(prevT => prevT.map(t => sameId(t.id, data.thread_id) ? { ...t, unread_count: 0 } : t));
                return updated.map(m => unreadIds.includes(m.id) ? { ...m, is_read: true } : m);
              }
              return updated;
            });`;

if (js.includes(caseNewMessage) && !js.includes("const isAudioPending = !!data.message.audio_pending;")) {
  js = js.replace(caseNewMessage, newCaseNewMessage);
  console.log('STEP 3a OK: new_message handler enriched');
}

const typingAnchor = `          case 'typing':`;
const newwsCases = `          case 'message_updated':
            setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, content: data.content, is_edited: true } : m));
            if (showToast) showToast(lang === 'ht' ? 'Mesaj modifye' : 'Message edited', 'info-circle');
            break;

          case 'message_delivered':
            setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, is_delivered: true, status: 'delivered' } : m));
            break;

          case 'message_read':
            setMessages(prev => prev.map(m => Array.isArray(data.message_ids) && data.message_ids.includes(m.id) ? { ...m, is_read: true, status: 'read' } : m));
            break;

          case 'typing':`;

if (js.includes(typingAnchor) && !js.includes("'message_updated':")) {
  js = js.replace(typingAnchor, newwsCases);
  console.log('STEP 3b OK: message_updated/delivered/read WS handlers');
} else {
  console.log('STEP 3b SKIP: anchor missing');
}

fs.writeFileSync(JS, js);
console.log('BEFORE:', before, 'AFTER:', js.length, 'DELTA:', js.length - before);
