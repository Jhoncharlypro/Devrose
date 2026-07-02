/**
 * src/components/Kot3Chat.jsx
 *
 * Top-level React component for the messenger-style chat panel.
 *
 * Module-level constants (palettes, theme registry, ID helpers, story TTL,
 * WS URL builder) live in `./kot3chat/params.js`. Synthesized Web Audio
 * beeps live in `./kot3chat/audioUtils.js`. This file owns all React state,
 * refs, effects, and the rendered JSX.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api, { chatService } from '../services/api';
import { translations } from '../data/translations';
import '../styles/kot3chat.css';
import {
  STATUS_PALETTE, STATUS_FONTS, GRADIENS,
  THEMES, THEME_BY_ID, ACTIVE_THEME_KEY,
  resolveInitialTheme,
  sameId, isTempId, STORY_TTL_MS,
  buildChatSocketUrl,
} from './kot3chat/params';
import {
  playSendBeep, playReceiveBeep, playConnectedChime,
  startCallingSounds, stopCallingSounds,
} from './kot3chat/audioUtils';

const Kot3Chat = ({ lang, user, showToast }) => {
  // --- CORE CHAT STATES (from original Kot3Chat.jsx) ---
  const [threads, setThreads] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_threads');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [attachedImage, setAttachedImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [showScrollFab, setShowScrollFab] = useState(false);
  // Active theme (replaces the old binary isDarkMode). Initialized with migration from kot3_dark_mode.
  const [activeTheme, setActiveTheme] = useState(resolveInitialTheme);

  const [input, setInput] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [userPresenceSnapshot, setUserPresenceSnapshot] = useState({});
  const [search, setSearch] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState({ users: [], threads: [], messages: [], stories: [] });
  const [isGlobalSearchLoading, setIsGlobalSearchLoading] = useState(false);

  // Debounce search input to make typing instantaneous
  useEffect(() => {
    if (!localSearch) {
      setSearch('');
      setGlobalSearchResults({ users: [], threads: [], messages: [], stories: [] });
      return;
    }
    const timer = setTimeout(() => {
      setSearch(localSearch);
    }, 150); // 150ms debounce
    return () => clearTimeout(timer);
  }, [localSearch]);

  useEffect(() => {
    const run = async () => {
      const q = search.trim();
      if (!q) {
        setGlobalSearchResults({ users: [], threads: [], messages: [], stories: [] });
        return;
      }
      setIsGlobalSearchLoading(true);
      try {
        const res = await chatService.searchGlobal(q);
        setGlobalSearchResults(res.data);
      } catch (e) {
        console.error('Global search failed', e);
        setGlobalSearchResults({ users: [], threads: [], messages: [], stories: [] });
      } finally {
        setIsGlobalSearchLoading(false);
      }
    };
    run();
  }, [search]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_online_users');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);

  // --- PREMIUM EXTENDED STATES (New UI & simulation elements) ---
  const [activeTab, setActiveTab] = useState('chats'); // 'chats', 'status', 'calls'
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [openReactionDrawerId, setOpenReactionDrawerId] = useState(null);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(false);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  const [isTopSettingsOpen, setIsTopSettingsOpen] = useState(false);  // Custom Status/Stories states
  const [myStories, setMyStories] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_my_stories');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [statusCreatorText, setStatusCreatorText] = useState('');
  const [statusCreatorImage, setStatusCreatorImage] = useState('');
  const [activeGradIdx, setActiveGradIdx] = useState(0);
  // Messenger-style additions for creator modal
  const [statusCreatorTab, setStatusCreatorTab] = useState('text'); // 'text' | 'photo'
  const [statusCreatorFont, setStatusCreatorFont] = useState('modern'); // 'modern'|'bold'|'playful'
  const [statusCreatorPaletteType, setStatusCreatorPaletteType] = useState('gradient'); // 'gradient'|'solid'
  const [isStatusViewerPaused, setIsStatusViewerPaused] = useState(false);
  const [viewedStoryIds, setViewedStoryIds] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_viewed_stories');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [statusQuickReactions, setStatusQuickReactions] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_status_reactions');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  // Full screen status viewer state
  const [statusViewer, setStatusViewer] = useState({
    isOpen: false,
    contactId: null, // user ID or 'me'
    storyIndex: 0,
    progress: 0,
  });
  
  // Custom Call state
  const [activeCall, setActiveCall] = useState({
    isOpen: false,
    contactId: null,
    username: '',
    type: 'audio', // 'audio', 'video'
    status: 'Ringing...', // 'Ringing...', 'Connected'
    duration: 0,
  });

  // Call history state
  const [callLogs, setCallLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_call_logs');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Local reactions map to persist on UI
  const [reactionsMap, setReactionsMap] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_reactions');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  // Local deleted messages set
  const [deletedMsgIds, setDeletedMsgIds] = useState(() => {
    try {
      const saved = localStorage.getItem('kot3_deleted_msgs');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // --- REFS ---
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const moreMenuWrapRef = useRef(null);
  const contactInfoRef = useRef(null);
  const wsRef = useRef(null);
  const wsReadyRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const typingTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const audioRefs = useRef({});
  const activeThreadIdRef = useRef(null);
  const pendingContactRef = useRef(null);
  const joinSentRef = useRef({});
  const reconnectAttemptRef = useRef(0);

  // Audio context + oscillators live in ./kot3chat/audioUtils.js (module-scoped).
  // The remaining audio refs hold timer IDs returned from setInterval/setTimeout
  // — React refs survive across renders so we can clear them in a useEffect cleanup.
  const callDurationTimerRef = useRef(null);
  const callRingingTimeoutRef = useRef(null);
  const statusViewerTimerRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const callRoleRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingCallTargetRef = useRef(null);
  // Hold-to-pause ref for status viewer (clearInterval handle when paused)
  const statusViewStartRef = useRef(0);

  // Sync active thread ID ref
  useEffect(() => {
    activeThreadIdRef.current = activeThread?.id || null;
  }, [activeThread]);

  // Persist local custom configurations
  useEffect(() => {
    localStorage.setItem('kot3_my_stories', JSON.stringify(myStories));
  }, [myStories]);

  useEffect(() => {
    localStorage.setItem('kot3_call_logs', JSON.stringify(callLogs));
  }, [callLogs]);

  useEffect(() => {
    localStorage.setItem('kot3_reactions', JSON.stringify(reactionsMap));
  }, [reactionsMap]);

  useEffect(() => {
    localStorage.setItem('kot3_deleted_msgs', JSON.stringify(deletedMsgIds));
  }, [deletedMsgIds]);

  useEffect(() => {
    try { localStorage.setItem('kot3_viewed_stories', JSON.stringify(viewedStoryIds)); } catch {}
  }, [viewedStoryIds]);

  useEffect(() => {
    try { localStorage.setItem('kot3_status_reactions', JSON.stringify(statusQuickReactions)); } catch {}
  }, [statusQuickReactions]);

  useEffect(() => {
    try {
      localStorage.setItem('kot3_threads', JSON.stringify(threads));
    } catch {}
  }, [threads]);

  useEffect(() => {
    localStorage.setItem('kot3_active_thread_id', activeThread?.id ? String(activeThread.id) : '');
  }, [activeThread]);

  // Handle mobile resize
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isMoreMenuOpen) return;

    const handlePointerDown = (event) => {
      if (moreMenuWrapRef.current && !moreMenuWrapRef.current.contains(event.target)) {
        setIsMoreMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMoreMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (!isContactInfoOpen) return;

    const handlePointerDown = (event) => {
      if (contactInfoRef.current && !contactInfoRef.current.contains(event.target)) {
        setIsContactInfoOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsContactInfoOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isContactInfoOpen]);

  useEffect(() => {
    if (!isTopSettingsOpen) return;

    const handlePointerDown = (event) => {
      const wrap = document.querySelector('.kot3-top-settings-wrap');
      if (wrap && !wrap.contains(event.target)) setIsTopSettingsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsTopSettingsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTopSettingsOpen]);

  // Mount/sync theme attribute on <html> (= :root in CSS) AND on <body>.
  // CSS selectors listen on :root[data-theme="..."] (= <html>), so the html attribute is critical.
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', activeTheme);
      if (document.body) document.body.setAttribute('data-theme', activeTheme);
    } catch {}
  }, [activeTheme]);

  // Cleanup: remove data-theme on unmount to avoid bleeding into other parts of the app.
  useEffect(() => {
    return () => {
      try { document.documentElement.removeAttribute('data-theme'); } catch {}
      try { if (document.body) document.body.removeAttribute('data-theme'); } catch {}
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimerRef.current);
      clearTimeout(typingTimerRef.current);
      clearInterval(callDurationTimerRef.current);
      clearTimeout(callRingingTimeoutRef.current);
      clearInterval(statusViewerTimerRef.current);
      stopCallingSounds();
      stopWebRtcMedia();
      
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Forced logout (from axios interceptor after refresh-token rejection, or
  // manual user click elsewhere). Tear down the WebSocket so we don't keep
  // burning server-side presence/typing slots while the user is signed out.
  // (Follow-up to Reviewer MAJOR#5: WS teardown on forced logout.)
  useEffect(() => {
    const handleForcedLogout = () => {
      try {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
          wsRef.current.close(1000, 'Forced logout');
        }
      } catch { /* ignore */ }
      wsReadyRef.current = false;
      setWsConnected(false);
      wsRef.current = null;
    };
    window.addEventListener('devrose:auth:logout', handleForcedLogout);
    return () => window.removeEventListener('devrose:auth:logout', handleForcedLogout);
  }, []);

  // Scroll logic for chat pane
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  useEffect(() => {
    if (!activeThread) { setShowScrollFab(false); return; }
    const el = messagesContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 200;
      const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < threshold;
      setShowScrollFab(!atBottom);
    };
    el.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [activeThread]);

  // --- SOUND EFFECTS ---
  // playSendBeep / playReceiveBeep / playConnectedChime / startCallingSounds /
  // stopCallingSounds are imported from ./kot3chat/audioUtils.js. The audio
  // module manages its own AudioContext + oscillator state at module scope
  // (no React refs needed).

  // --- API DATA LOADS ---
  const loadThreads = async () => {
    try {
      const res = await chatService.getThreads();
      setThreads(res.data);
    } catch (e) {
      console.error('Failed to load threads', e);
    }
  };

  const stopWebRtcMedia = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop());
      remoteStreamRef.current = null;
    }
    pendingIceCandidatesRef.current = [];
    pendingOfferRef.current = null;
    callRoleRef.current = null;
    pendingCallTargetRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const sendWebRtcSignal = useCallback((targetUserId, signal) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !targetUserId) return;
    wsRef.current.send(JSON.stringify({
      type: 'webrtc_signal',
      target_user_id: targetUserId,
      signal
    }));
  }, []);

  const ensurePeerConnection = useCallback(async (role) => {
    if (peerConnectionRef.current) return peerConnectionRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    remoteStreamRef.current = new MediaStream();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => {
        remoteStreamRef.current?.addTrack(track);
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWebRtcSignal(pendingCallTargetRef.current || activeCall.contactId, { type: 'candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        stopWebRtcMedia();
      }
    };

    peerConnectionRef.current = pc;
    callRoleRef.current = role;
    return pc;
  }, [sendWebRtcSignal, stopWebRtcMedia, activeCall.contactId]);

  const attachLocalMedia = useCallback(async (kind = 'audio') => {
    if (localStreamRef.current) return localStreamRef.current;
    const constraints = {
      audio: true,
      video: kind === 'video'
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  const startOutgoingPeerCall = useCallback(async (kind) => {
    try {
      const pc = await ensurePeerConnection('caller');
      const stream = await attachLocalMedia(kind);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWebRtcSignal(pendingCallTargetRef.current, { type: 'offer', sdp: offer.sdp, sdpType: offer.type, kind });
    } catch (err) {
      console.error('Failed to start WebRTC call', err);
      if (showToast) showToast(lang === 'ht' ? 'Pa ka lanse apèl la.' : 'Unable to start call.', 'exclamation-triangle');
      stopWebRtcMedia();
    }
  }, [attachLocalMedia, ensurePeerConnection, lang, sendWebRtcSignal, showToast, stopWebRtcMedia]);

  const acceptPeerCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer) return;
    try {
      const pc = await ensurePeerConnection('receiver');
      const stream = await attachLocalMedia(activeCall.type);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      while (pendingIceCandidatesRef.current.length) {
        const candidate = pendingIceCandidatesRef.current.shift();
        await pc.addIceCandidate(candidate);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebRtcSignal(activeCall.contactId, { type: 'answer', sdp: answer.sdp, sdpType: answer.type, kind: activeCall.type });
      pendingOfferRef.current = null;
    } catch (err) {
      console.error('Failed to accept WebRTC call', err);
      if (showToast) showToast(lang === 'ht' ? 'Apèl la pa ka konekte.' : 'Unable to connect call.', 'exclamation-triangle');
      stopWebRtcMedia();
    }
  }, [activeCall.type, attachLocalMedia, ensurePeerConnection, lang, sendWebRtcSignal, showToast, stopWebRtcMedia]);

  const loadUsers = async () => {
    try {
      const res = await chatService.getUsers();
      setAllUsers(res.data);
      setUserPresenceSnapshot(prev => {
        const next = { ...prev };
        res.data.forEach(u => {
          next[u.id] = {
            username: u.username,
            avatar: u.avatar || null,
            bio: u.bio || '',
            status_text: u.status_text || '',
            last_seen: u.last_seen || null,
            is_online: !!u.is_online,
            stories: Array.isArray(u.stories) ? u.stories : []
          };
        });
        return next;
      });
    } catch (e) {
      console.error('Failed to load users', e);
    }
  };

  const loadMessages = async (threadId, background = false) => {
    if (!threadId || String(threadId).startsWith('temp-')) {
      setIsLoadingMessages(false);
      return;
    }

    if (!background) setIsLoadingMessages(true);
    try {
      const res = await chatService.getMessages(threadId);
      setMessages(res.data);
      const unreadIds = res.data.filter(m => !m.is_read && m.sender_id !== user.id).map(m => m.id);
      if (unreadIds.length) {
        chatService.markRead(threadId, unreadIds).catch(() => {});
      }
    } catch (e) {
      console.error('Failed to load messages', e);
      if (showToast) {
        showToast(lang === 'ht' ? 'Erè nan chaje mesaj yo.' : 'Failed to load messages.', 'exclamation-triangle');
      }
    } finally {
      if (!background) setIsLoadingMessages(false);
    }
  };

  const pruneStories = (stories = []) => {
    const now = Date.now();
    return stories.filter(story => {
      const createdAt = story.created_at ? new Date(story.created_at).getTime() : now;
      return Number.isFinite(createdAt) ? (now - createdAt) < STORY_TTL_MS : true;
    });
  };

  // --- WS WEBSOCKET CHANNELS ENGINE ---
  const connectWS = useCallback(() => {
    if (!user) return;
    clearTimeout(reconnectTimerRef.current);
    // Read from new JWT key, fall back to legacy DRF Token key during migration.
    const token = localStorage.getItem('access_token') || localStorage.getItem('token');
    if (!token) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = buildChatSocketUrl(token);
    
    console.log("Connecting WS to url:", url);
    const socket = new WebSocket(url);

    // Helper for the 4401 reconnect ladder. Declared WITH the `const`
    // keyword and BEFORE any caller so we (a) don't trigger a
    // ReferenceError in ESM strict mode (Vite is strict by default) via
    // bare-assignment, and (b) so the onclose handler can call it without
    // racing the temporal dead zone.
    //
    // The function RECURSIVELY calls `connectWS()` — that's fine because we
    // are inside the same closure and edit each render via `useCallback`.
    const tryRefreshThenReconnect = async () => {
      const refresh = localStorage.getItem('refresh_token');
      if (!refresh) {
        // No refresh left → force logout so the rest of the app can clear state.
        try { window.dispatchEvent(new CustomEvent('devrose:auth:logout')); } catch {}
        return;
      }
      try {
        const { data } = await api.post('refresh/', { refresh });
        if (data?.access) {
          localStorage.setItem('access_token', data.access);
          if (data?.refresh) localStorage.setItem('refresh_token', data.refresh);
          reconnectAttemptRef.current = 0;
          connectWS();
          return;
        }
      } catch (err) {
        console.warn('Kot3Chat WS: refresh failed after 4401', err);
      }
      // Refresh failed — propagate forced logout. We intentionally do NOT
      // auto-reconnect: without a valid token the consumer would close us
      // with 4401 again in a tight loop.
      try { window.dispatchEvent(new CustomEvent('devrose:auth:logout')); } catch {}
    };

    socket.onopen = () => {
      console.log('Kot3Chat WS connected successfully');
      reconnectAttemptRef.current = 0;
      wsReadyRef.current = true;
      setWsConnected(true);
      if (activeThreadIdRef.current) {
        socket.send(JSON.stringify({ type: 'join_thread', thread_id: activeThreadIdRef.current }));
        joinSentRef.current[activeThreadIdRef.current] = true;
      }
    };

    socket.onclose = (e) => {
      console.log('Kot3Chat WS closed', e.code, e.reason);
      wsReadyRef.current = false;
      setWsConnected(false);
      wsRef.current = null;
      if (user && e.code !== 1000) {
        // JWT-specific: the server closes with 4401 when the access token
        // is missing/expired (see api/middleware.py + api/consumers.py).
        // In that case we don't just back-off and retry — the old token is
        // dead. We need to refresh it first, then reconnect with the new one.
        if (e.code === 4401) {
          tryRefreshThenReconnect();
          return;
        }
        reconnectAttemptRef.current += 1;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 15000);
        reconnectTimerRef.current = setTimeout(connectWS, delay);
      }
    };

    socket.onerror = (err) => {
      console.error('Kot3Chat WS error', err);
      wsReadyRef.current = false;
      setWsConnected(false);
    };

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        switch (data.type) {
          case 'history':
            if (sameId(data.thread_id, activeThreadIdRef.current)) {
              setMessages(data.messages);
            }
            break;
          case 'new_message':
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
                  return updated.map(m => unreadIds.includes(m.id) ? { ...m, is_read: true } : m);
                }
              }
              return updated;
            });

            // Update thread list for EVERY message to keep it updated in real time!
            setThreads(prevT => {
              const existing = prevT.find(t => sameId(t.id, data.thread_id));
              const now = new Date().toISOString();
              const isCurrent = sameId(data.thread_id, activeThreadIdRef.current);
              
              if (existing) {
                return prevT.map(t => sameId(t.id, data.thread_id) ? { 
                  ...t, 
                  last_message: data.message, 
                  updated_at: now, 
                  unread_count: isCurrent ? 0 : (t.unread_count || 0) + (data.message.sender_id !== user.id ? 1 : 0)
                } : t).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
              }
              
              const other = data.message.sender_id === user.id ? data.other_user : {
                id: data.message.sender_id,
                username: data.message.sender_username,
                avatar: data.message.sender_avatar || null,
                is_online: false
              };
              
              return [{
                id: data.thread_id,
                participants: [
                  { id: user.id, username: user.username },
                  { id: other.id, username: other.username, avatar: other.avatar, is_online: other.is_online }
                ],
                last_message: data.message,
                unread_count: isCurrent ? 0 : 1,
                created_at: now,
                updated_at: now
              }, ...prevT];
            });

            if (data.message.audio_pending && sameId(data.thread_id, activeThreadIdRef.current)) {
              loadMessages(data.thread_id);
            }

            if (sameId(data.thread_id, activeThreadIdRef.current) && data.message.sender_id !== user.id) {
              playReceiveBeep();
            }
            break;

          case 'message_updated':
            setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, content: data.content, is_edited: true } : m));
            if (showToast) showToast(lang === 'ht' ? 'Mesaj modifye' : 'Message edited', 'info-circle');
            break;

          case 'message_deleted':
            // Phase 9 — soft-delete broadcast from BE (covers both
            // the REST DELETE path and the WS ``delete_message`` path;
            // idempotent because the reducer short-circuits on
            // duplicate IDs).  The chat pane renders tombstones via
            // ``getFilteredMessages`` which filters by ``deletedMsgIds``.
            setDeletedMsgIds(prev => prev.includes(data.message_id) ? prev : [...prev, data.message_id]);
            // If the deleted message was the thread's ``last_message``
            // preview, drop the preview so the sidebar shows the
            // "Say hello…" placeholder rather than content from a
            // tombstoned message.  The next ``new_message`` event
            // repopulates it.
            setThreads(prevT => prevT.map(t => {
              if (!sameId(t.id, data.thread_id)) return t;
              if (t.last_message?.id === data.message_id) {
                return { ...t, last_message: null };
              }
              return t;
            }));
            if (showToast) showToast(lang === 'ht' ? 'Mesaj efase' : 'Message deleted', 'info-circle');
            break;

          case 'message_delivered':
            setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, is_delivered: true, status: 'delivered' } : m));
            break;

          case 'message_read':
            setMessages(prev => prev.map(m => Array.isArray(data.message_ids) && data.message_ids.includes(m.id) ? { ...m, is_read: true, status: 'read' } : m));
            break;

          case 'typing':
            setTypingUsers(prev => {
              const next = { ...prev };
              if (data.is_typing) {
                next[data.thread_id] = data.username;
              } else {
                delete next[data.thread_id];
              }
              return next;
            });
            break;

          case 'notification':
            if (!sameId(data.thread_id, activeThreadIdRef.current)) {
              playReceiveBeep();
              setThreads(prevT => {
                const existing = prevT.find(t => sameId(t.id, data.thread_id));
                const now = new Date().toISOString();
                if (existing) {
                  return prevT.map(t => sameId(t.id, data.thread_id) ? { ...t, last_message: data.message, updated_at: now, unread_count: (t.unread_count || 0) + 1 } : t)
                             .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                }
                const other = data.other_user || {
                  id: data.message.sender_id,
                  username: data.message.sender_username,
                  avatar: data.message.sender_avatar || null,
                  is_online: false
                };
                return [{
                  id: data.thread_id,
                  participants: [
                    { id: user.id, username: user.username },
                    { id: other.id, username: other.username, avatar: other.avatar, is_online: other.is_online }
                  ],
                  last_message: data.message,
                  unread_count: 1,
                  created_at: now,
                  updated_at: now
                }, ...prevT];
              });
            }
            break;

          case 'presence_update':
          case 'presence_broadcast':
            setOnlineUsers(prev => {
              const next = { ...prev };
              if (data.status === 'online') {
                next[data.user_id] = { username: data.username, status: 'online', last_seen: null };
              } else {
                next[data.user_id] = { username: data.username, status: 'offline', last_seen: data.last_seen || new Date().toISOString() };
              }
              return next;
            });
            setUserPresenceSnapshot(prev => ({
              ...prev,
              [data.user_id]: {
                ...(prev[data.user_id] || {}),
                username: data.username,
                last_seen: data.last_seen || prev[data.user_id]?.last_seen || null,
                is_online: data.status === 'online'
              }
            }));
            break;

          case 'thread_setting_updated':
            // Phase 9 — per-user thread prefs (pin / archive / mute /
            // request-ignore) synced from the BE to all THIS user's
            // devices.  BE only includes keys that actually changed
            // (see ``update_thread_setting`` in consumers.py) so we
            // patch conditionally to avoid clobbering untouched
            // fields.  ``is_muted`` and ``is_request`` come pre-
            // computed from the BE (muted_hours → boolean, request-
            // ignored → is_request = not ignored).
            setThreads(prevT => prevT.map(t => {
              if (!sameId(t.id, data.thread_id)) return t;
              const next = { ...t };
              const u = data.updates || {};
              if ('is_pinned'   in u) next.is_pinned   = !!u.is_pinned;
              if ('is_archived' in u) next.is_archived = !!u.is_archived;
              if ('is_muted'    in u) next.is_muted    = !!u.is_muted;
              if ('is_request'  in u) next.is_request  = !!u.is_request;
              return next;
            }));
            break;

          case 'new_story':
            if (data.story.user_id === user.id) {
              setMyStories(prev => {
                const hasStory = prev.some(s => s.id === data.story.id);
                if (hasStory) return prev;
                return [...prev, {
                  id: data.story.id,
                  type: data.story.type,
                  content: data.story.content,
                  background: data.story.background,
                  timestamp: new Date(data.story.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }];
              });
              if (showToast) showToast(lang === 'ht' ? 'Status pibliye ak siksè!' : 'Status published successfully!', 'check-circle');
            } else {
              setAllUsers(prevUsers => prevUsers.map(u => {
                if (u.id === data.story.user_id) {
                  const stories = u.stories || [];
                  const hasStory = stories.some(s => s.id === data.story.id);
                  if (hasStory) return u;
                  return {
                    ...u,
                    stories: [...stories, {
                      id: data.story.id,
                      type: data.story.type,
                      content: data.story.content,
                      background: data.story.background,
                      created_at: data.story.created_at
                    }]
                  };
                }
                return u;
              }));
              if (showToast) showToast(lang === 'ht' ? `@${data.story.username} pibliye yon nouvo status!` : `@${data.story.username} published a new status!`, 'image');
            }
            break;

          case 'incoming_call':
            setActiveCall({
              isOpen: true,
              contactId: data.caller_id,
              username: data.caller_username,
              type: data.call_type,
              status: 'Incoming',
              duration: 0
            });
            setCallLogs(prev => [
              { id: Date.now(), username: data.caller_username, type: data.call_type, status: 'incoming', timestamp: 'Just now' },
              ...prev
            ]);
            playReceiveBeep();
            startCallingSounds();
            break;

          case 'call_connected':
            stopCallingSounds();
            playConnectedChime();
            setActiveCall(prev => ({ ...prev, status: 'Connected' }));
            setCallLogs(prev => prev.map(log => log.username === activeCall.username && log.status === 'incoming'
              ? { ...log, status: 'connected', timestamp: 'Just now' }
              : log));
            clearInterval(callDurationTimerRef.current);
            clearTimeout(callRingingTimeoutRef.current);
            let count = 0;
            callDurationTimerRef.current = setInterval(() => {
              count++;
              setActiveCall(prev => ({ ...prev, duration: count }));
            }, 1000);
            break;

          case 'call_hungup':
            stopCallingSounds();
            clearTimeout(callRingingTimeoutRef.current);
            clearInterval(callDurationTimerRef.current);
            stopWebRtcMedia();
            setCallLogs(prev => prev.map(log => log.username === activeCall.username && (log.status === 'outgoing' || log.status === 'incoming')
              ? { ...log, status: 'missed', timestamp: 'Just now' }
              : log));
            setActiveCall({
              isOpen: false,
              contactId: null,
              username: '',
              type: 'audio',
              status: 'Ringing...',
              duration: 0
            });
            if (showToast) showToast(lang === 'ht' ? 'Apèl la fini' : 'Call ended', 'info-circle');
            break;

          case 'webrtc_signal':
            if (data.signal?.type === 'offer') {
              pendingOfferRef.current = { type: data.signal.sdpType || 'offer', sdp: data.signal.sdp };
            } else if (data.signal?.type === 'answer' && peerConnectionRef.current) {
              peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription({
                type: data.signal.sdpType || 'answer',
                sdp: data.signal.sdp
              })).catch(console.error);
            } else if (data.signal?.type === 'candidate' && peerConnectionRef.current) {
              const candidate = new RTCIceCandidate(data.signal.candidate);
              if (peerConnectionRef.current.remoteDescription) {
                peerConnectionRef.current.addIceCandidate(candidate).catch(console.error);
              } else {
                pendingIceCandidatesRef.current.push(candidate);
              }
            }
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('WS message parsing error', err);
      }
    };

    wsRef.current = socket;
  }, [user]);

  // Run hooks for setup
  useEffect(() => {
    if (!user) return;
    loadThreads();
    loadUsers();
    connectWS();

    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Unmount');
        wsRef.current = null;
        wsReadyRef.current = false;
      }
    };
  }, [user, connectWS]);

  useEffect(() => {
    if (!threads.length || activeThread) return;
    try {
      const savedThreadId = localStorage.getItem('kot3_active_thread_id');
      if (!savedThreadId) return;
      const restored = threads.find(t => sameId(t.id, savedThreadId));
      if (restored) {
        setActiveThread(restored);
      }
    } catch {}
  }, [threads, activeThread]);

  // Sync current user stories from backend
  useEffect(() => {
    if (user && user.stories) {
      setMyStories(pruneStories(user.stories).map(s => ({
        id: s.id,
        type: s.type,
        content: s.content,
        background: s.background,
        created_at: s.created_at,
        timestamp: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })));
    }
  }, [user]);

  // Load chat on thread selected
  useEffect(() => {
    if (!activeThread) return;
    if (activeThread.is_temp) {
      setMessages([]);
      setIsLoadingMessages(false);
      return;
    }
    
    // Optimistic cache load
    let hadCache = false;
    try {
      const saved = localStorage.getItem(`kot3_messages_${activeThread.id}`);
      if (saved) {
        setMessages(JSON.parse(saved));
        hadCache = true;
      } else {
        setMessages([]);
      }
    } catch { setMessages([]); }

    setIsLoadingMessages(!hadCache);
    loadMessages(activeThread.id, hadCache);

    // Notify WS of thread join
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join_thread', thread_id: activeThread.id }));
      joinSentRef.current[activeThread.id] = true;
    }

    if (hadCache) {
      const refreshTimer = setTimeout(() => {
        if (activeThreadIdRef.current && sameId(activeThreadIdRef.current, activeThread.id)) {
          loadMessages(activeThread.id, true);
        }
      }, 250);
      return () => clearTimeout(refreshTimer);
    }
  }, [activeThread]);

  // Backup active messages
  useEffect(() => {
    if (!activeThread || messages.length === 0) return;
    try {
      localStorage.setItem(`kot3_messages_${activeThread.id}`, JSON.stringify(messages));
    } catch {}
  }, [messages, activeThread]);

  // --- ACTIONS HANDLERS ---
  const handleSendMessage = async (e) => {
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

  // Theme setter used by picker. Persists to localStorage and updates document attributes.
  // CSS listens on :root[data-theme="..."] (= <html>), so we MUST set that, plus body as fallback.
  const setTheme = (themeId) => {
    if (!THEME_BY_ID[themeId]) return;
    setActiveTheme(themeId);
    try { localStorage.setItem(ACTIVE_THEME_KEY, themeId); } catch {}
    try { document.documentElement.setAttribute('data-theme', themeId); } catch {}
    try { if (document.body) document.body.setAttribute('data-theme', themeId); } catch {}
  };


  // Typing state sender — also auto-clears remote typing indicator after 3.5s
  // as a safety net for dropped `is_typing: false` payloads.
  const typingAutoClearRef = useRef({});
  const sendTypingNotification = () => {
    if (!wsRef.current || !activeThread || !wsReadyRef.current) return;
    wsRef.current.send(JSON.stringify({
      type: 'typing',
      thread_id: activeThread.id,
      is_typing: true
    }));
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      wsRef.current?.send(JSON.stringify({
        type: 'typing',
        thread_id: activeThread.id,
        is_typing: false
      }));
    }, 2000);

    // Fallback: clear local typingUsers entry after 3.5s even if WS signal drops.
    const activeTid = activeThread.id;
    clearTimeout(typingAutoClearRef.current[activeTid]);
    typingAutoClearRef.current[activeTid] = setTimeout(() => {
      setTypingUsers(prev => {
        if (!prev[activeTid]) return prev;
        const next = { ...prev };
        delete next[activeTid];
        return next;
      });
    }, 3500);
  };

  // Audio mic recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mime });
        const reader = new FileReader();
        reader.onloadend = () => {
          sendVoiceMessage(reader.result);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setIsRecording(true);

      // Auto stop after 15s max
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, 15000);

    } catch (err) {
      console.error(err);
      if (showToast) showToast(lang === 'ht' ? 'Pa ka ouvri mikwofòn nan.' : 'Cannot open microphone.', 'exclamation-triangle');
    }
  };

  const stopRecordingAndSend = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendVoiceMessage = async (base64Audio) => {
    if (!activeThread || activeThread.is_temp) return;

    const tempId = 'tmp-' + Date.now();
    const tempMsg = {
      id: tempId,
      thread_id: activeThread.id,
      sender_id: user.id,
      sender_username: user.username,
      content: '',
      audio: base64Audio,
      is_read: false,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempMsg]);
    playSendBeep();

    try {
      const res = await chatService.sendMessage(activeThread.id, { content: '', audio: base64Audio });
      setMessages(prev => prev.map(m => m.id === tempId ? res.data : m));
    } catch (err) {
      console.error("Failed to send voice note", err);
      if (showToast) showToast(lang === 'ht' ? 'Erè nan voye vokal.' : 'Failed to send voice note.', 'exclamation-triangle');
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  const toggleAudioPlayback = (msgId) => {
    const audio = audioRefs.current[msgId];
    if (!audio) return;
    if (playingAudioId === msgId) {
      audio.pause();
      setPlayingAudioId(null);
    } else {
      if (playingAudioId && audioRefs.current[playingAudioId]) {
        audioRefs.current[playingAudioId].pause();
      }
      audio.play().catch(() => {});
      setPlayingAudioId(msgId);
    }
  };

  // Open direct chat thread with a searched contact or online user
  const openChatWithUser = async (targetPerson) => {
    const inferredOnline = targetPerson.is_online !== undefined
      ? targetPerson.is_online
      : onlineUsers[targetPerson.id]?.status === 'online';
    const normalizedTarget = {
      id: targetPerson.id,
      username: targetPerson.username,
      avatar: targetPerson.avatar || null,
      first_name: targetPerson.first_name || '',
      last_name: targetPerson.last_name || '',
      is_online: inferredOnline
    };
    // Check if thread already exists in state
    const existing = threads.find(t => t.participants.some(p => p.id === normalizedTarget.id));
    if (existing) {
      openSelectedThread(existing);
      setLocalSearch('');
      setSearch('');
      return;
    }

    // Create optimistic thread to open the chat window INSTANTLY without losing contact identity
    const tempThread = {
      id: `temp-${normalizedTarget.id}`,
      participants: [
        { id: user.id, username: user.username },
        normalizedTarget
      ],
      is_temp: true
    };
    
    setActiveThread(tempThread);
    setMessages([]);
    setIsLoadingMessages(false);
    setLocalSearch('');
    setSearch('');
    setActiveTab('chats');

    try {
      const res = await chatService.createThread(targetPerson.id);
      setUserPresenceSnapshot(prev => ({
        ...prev,
        [normalizedTarget.id]: {
          ...(prev[normalizedTarget.id] || {}),
          ...normalizedTarget
        }
      }));
      setActiveThread(res.data);
      joinSentRef.current[res.data.id] = false;
      setThreads(prev => prev.some(t => sameId(t.id, res.data.id)) ? prev : [res.data, ...prev]);
      
      // Join the WS room for the new thread
      if (wsRef.current && wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'join_thread', thread_id: res.data.id }));
      }
    } catch (err) {
      console.error("Failed to create thread", err);
      if (showToast) showToast(lang === 'ht' ? 'Erè nan louvri chat.' : 'Failed to open chat.', 'exclamation-triangle');
      setActiveThread(null);
      setIsLoadingMessages(false);
    }
  };

  // Open selected thread
  const openSelectedThread = (thread) => {
    setActiveThread(thread);
    joinSentRef.current[thread.id] = false;
    setThreads(prev => {
      const others = prev.filter(t => t.id !== thread.id);
      return [{ ...thread, unread_count: 0 }, ...others];
    });
  };

  // local reactions
  const reactToMessage = (msgId, emoji) => {
    setReactionsMap(prev => {
      const list = prev[msgId] || [];
      const index = list.indexOf(emoji);
      let updated = [];
      if (index === -1) {
        updated = [...list, emoji];
      } else {
        updated = list.filter(e => e !== emoji);
      }
      return { ...prev, [msgId]: updated };
    });
    playSendBeep();
    setOpenReactionDrawerId(null);
  };

  // local delete message
  const deleteMessage = (msgId) => {
    setDeletedMsgIds(prev => [...prev, msgId]);
  };

  // Stories come from backend data only.
  const mockStoriesData = useMemo(() => {
    const stories = {};
    
    // Populate from allUsers from DB who have active stories
    allUsers.forEach(u => {
      if (u.stories && u.stories.length > 0) {
        stories[u.id] = {
          name: u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username,
          avatar: u.avatar || '',
          updates: u.stories.map(s => ({
            id: s.id,
            type: s.type,
            content: s.content,
            background: s.background,
            created_at: s.created_at,
            timestamp: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          })).filter(story => {
            const createdAt = new Date(story.created_at).getTime();
            return Number.isFinite(createdAt) && (Date.now() - createdAt) < STORY_TTL_MS;
          })
        };
      }
    });

    return stories;
  }, [allUsers]);

  // Publish a custom status
  const publishMyStatus = () => {
    if (!statusCreatorText.trim() && !statusCreatorImage) return;
    const storyType = statusCreatorImage ? 'image' : 'text';
    const storyContent = statusCreatorImage || statusCreatorText.trim();
    const payload = {
      story_type: storyType,
      content: storyContent,
      background: storyType === 'text' ? GRADIENS[activeGradIdx] : ''
    };

    const finishPublish = (story) => {
      const normalized = {
        id: story.id || Date.now(),
        type: story.type || storyType,
        content: story.content || storyContent,
        background: story.background || '',
        created_at: story.created_at || new Date().toISOString(),
        timestamp: story.timestamp || 'Just now'
      };
      setMyStories(prev => pruneStories([...prev, normalized]));
      setStatusCreatorText('');
      setStatusCreatorImage('');
      setIsEditingStatus(false);
      playSendBeep();
      if (showToast) showToast(lang === 'ht' ? 'Status pibliye!' : 'Status published!', 'check-circle');
    };

    chatService.publishStory(payload)
      .then(res => finishPublish(res.data))
      .catch(err => {
        console.error('Failed to publish story', err);
        if (showToast) showToast(lang === 'ht' ? 'Erè nan pibliye status.' : 'Failed to publish status.', 'exclamation-triangle');
      });
  };

  const handleStatusImageUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setStatusCreatorImage(String(reader.result || ''));
      setStatusCreatorText('');
    };
    reader.readAsDataURL(file);
  };

  // Status Viewer Controls
  const openStatusViewer = (contactId) => {
    setStatusViewer({
      isOpen: true,
      contactId,
      storyIndex: 0,
      progress: 0,
    });
  };

  const closeStatusViewer = () => {
    clearInterval(statusViewerTimerRef.current);
    setStatusViewer({
      isOpen: false,
      contactId: null,
      storyIndex: 0,
      progress: 0,
    });
  };

  const getStatusListForId = (cid) => {
    if (cid === 'me') return pruneStories(myStories);
    return (mockStoriesData[cid]?.updates || []).filter(story => {
      const createdAt = new Date(story.created_at).getTime();
      return Number.isFinite(createdAt) && (Date.now() - createdAt) < STORY_TTL_MS;
    });
  };

  const getStatusUserMeta = (cid) => {
    if (cid === 'me') return { name: 'Mwen Menm', avatar: user?.profile?.avatar || user?.avatar || '' };
    return mockStoriesData[cid] || { name: 'User', avatar: '' };
  };

  const showNextStatus = useCallback(() => {
    setStatusViewer(prev => {
      const list = getStatusListForId(prev.contactId);
      if (prev.storyIndex < list.length - 1) {
        return { ...prev, storyIndex: prev.storyIndex + 1, progress: 0 };
      } else {
        // Go to next contact with stories or close
        const activeIds = ['me', ...Object.keys(mockStoriesData)].filter(id => getStatusListForId(id).length > 0);
        const nextIdIdx = activeIds.indexOf(prev.contactId) + 1;
        if (nextIdIdx < activeIds.length) {
          return { ...prev, contactId: activeIds[nextIdIdx], storyIndex: 0, progress: 0 };
        } else {
          clearInterval(statusViewerTimerRef.current);
          return { ...prev, isOpen: false };
        }
      }
    });
  }, [myStories, mockStoriesData]);

  const showPrevStatus = () => {
    setStatusViewer(prev => {
      if (prev.storyIndex > 0) {
        return { ...prev, storyIndex: prev.storyIndex - 1, progress: 0 };
      } else {
        const activeIds = ['me', ...Object.keys(mockStoriesData)].filter(id => getStatusListForId(id).length > 0);
        const prevIdIdx = activeIds.indexOf(prev.contactId) - 1;
        if (prevIdIdx >= 0) {
          const prevId = activeIds[prevIdIdx];
          const prevList = getStatusListForId(prevId);
          return { ...prev, contactId: prevId, storyIndex: prevList.length - 1, progress: 0 };
        }
        return { ...prev, progress: 0 }; // Restart
      }
    });
  };

  // Story Viewer Timer effect — respects pause + records viewed stories
  useEffect(() => {
    if (!statusViewer.isOpen) return;
    if (isStatusViewerPaused) return;

    clearInterval(statusViewerTimerRef.current);
    let elapsed = 0;
    const duration = 5000;
    const step = 100;

    // Mark current story as viewed locally so its ring turns gray.
    const list = getStatusListForId(statusViewer.contactId);
    const currentStory = list[statusViewer.storyIndex];
    if (currentStory?.id && statusViewer.contactId !== 'me') {
      setViewedStoryIds(prev => prev[currentStory.id] ? prev : ({ ...prev, [currentStory.id]: Date.now() }));
    }

    statusViewerTimerRef.current = setInterval(() => {
      elapsed += step;
      setStatusViewer(prev => {
        const p = (elapsed / duration) * 100;
        if (elapsed >= duration) {
          clearInterval(statusViewerTimerRef.current);
          setTimeout(showNextStatus, 0);
          return { ...prev, progress: 100 };
        }
        return { ...prev, progress: p };
      });
    }, step);

    return () => clearInterval(statusViewerTimerRef.current);
  }, [statusViewer.isOpen, statusViewer.contactId, statusViewer.storyIndex, isStatusViewerPaused, showNextStatus]);

  // Reply to status and convert to chat message
  const handleStatusReply = (replyText) => {
    if (!replyText.trim() || !statusViewer.contactId) return;

    const list = getStatusListForId(statusViewer.contactId);
    const story = list[statusViewer.storyIndex];
    if (!story) return;

    const userMeta = getStatusUserMeta(statusViewer.contactId);
    const quote = story.type === 'text' ? `"${story.content}"` : '[Imaj Status]';

    // If we have an active thread with this username or user ID, we send it there. 
    // We search the threads list for a participant matching the username.
    const cleanUsername = userMeta.name.split(' ')[0].toLowerCase();
    const thread = threads.find(t => {
      const other = t.participants.find(p => p.id !== user.id);
      return other?.username.toLowerCase().includes(cleanUsername);
    });

    if (thread) {
      // Send real message quoting status
      const msgContent = `📲 *Status reponn:* ${quote}\n\n${replyText}`;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'send_message',
          thread_id: thread.id,
          content: msgContent
        }));
        playSendBeep();
      }
      // Set active
      setActiveThread(thread);
      setActiveTab('chats');
    } else {
      if (showToast) showToast(lang === 'ht' ? 'Kòmanse chat la anvan ou reponn.' : 'Start a chat before replying.', 'info-circle');
    }
    
    closeStatusViewer();
  };

  // Dialing out triggers
  const startCallingUser = (contactId, type) => {
    // Check contact
    const thread = threads.find(t => sameId(t.id, activeThread?.id));
    const participant = thread?.participants.find(p => p.id !== user.id) || allUsers.find(u => u.id === contactId);
    const username = participant ? participant.username : 'User';

    setActiveCall({
      isOpen: true,
      contactId,
      username,
      type,
      status: 'Ringing...',
      duration: 0
    });
    pendingCallTargetRef.current = contactId;

    // Start synthetic ringing tone
    startCallingSounds();

    // Log to call history
    setCallLogs(prev => [
      { id: Date.now(), username, type, status: 'outgoing', timestamp: 'Just now' },
      ...prev
    ]);

    // Check if the recipient is online to make a real WebSocket call.
    // NOTE: must be ``?.status === 'online'`` (not ``!== undefined``) — the
    // Phase 9 presence_snapshot REPLACES the onlineUsers map with the
    // server's current online set, so users who went offline are no
    // longer in the map at all. ``!== undefined`` would only be true
    // for users we have *seen* in presence; the new contract is that
    // the presence map is "currently online" only.
    const isReceiverOnline = onlineUsers[contactId]?.status === 'online';
    if (wsRef.current?.readyState === WebSocket.OPEN && isReceiverOnline) {
      wsRef.current.send(JSON.stringify({
        type: 'call_user',
        target_user_id: contactId,
        call_type: type
      }));
      startOutgoingPeerCall(type);
      // Set a 30s timeout if they don't answer
      callRingingTimeoutRef.current = setTimeout(() => {
        hangUpActiveCall();
        if (showToast) showToast(lang === 'ht' ? 'Pa gen repons' : 'No answer', 'exclamation-circle');
      }, 30000);
    } else {
      // Real-life behavior: cannot call offline users
      stopCallingSounds();
      setActiveCall({
        isOpen: false,
        contactId: null,
        username: '',
        type: 'audio',
        status: 'Ringing...',
        duration: 0
      });
      if (showToast) {
        showToast(lang === 'ht' ? 'Moun sa a pa sou liy kounye a.' : 'This user is offline right now.', 'exclamation-triangle');
      }
    }
  };

  const hangUpActiveCall = () => {
    clearTimeout(callRingingTimeoutRef.current);
    clearInterval(callDurationTimerRef.current);
    stopCallingSounds();
    stopWebRtcMedia();

    // If we were in a real call, notify the other party
    if (wsRef.current?.readyState === WebSocket.OPEN && activeCall.contactId) {
      wsRef.current.send(JSON.stringify({
        type: 'call_declined',
        target_user_id: activeCall.contactId
      }));
    }

    setCallLogs(prev => prev.map(log => log.username === activeCall.username && log.status === 'outgoing'
      ? { ...log, status: 'missed', timestamp: 'Just now' }
      : log));

    setActiveCall({
      isOpen: false,
      contactId: null,
      username: '',
      type: 'audio',
      status: 'Ringing...',
      duration: 0
    });
  };

  const acceptIncomingCall = () => {
    stopCallingSounds();
    playConnectedChime();
    setActiveCall(prev => ({ ...prev, status: 'Connected' }));
    if (wsRef.current?.readyState === WebSocket.OPEN && activeCall.contactId) {
      wsRef.current.send(JSON.stringify({
        type: 'call_accepted',
        caller_id: activeCall.contactId
      }));
    }
    acceptPeerCall();
    
    clearInterval(callDurationTimerRef.current);
    let count = 0;
    callDurationTimerRef.current = setInterval(() => {
      count++;
      setActiveCall(prev => ({ ...prev, duration: count }));
    }, 1000);
  };

  const declineIncomingCall = () => {
    stopCallingSounds();
    stopWebRtcMedia();
    
    if (wsRef.current?.readyState === WebSocket.OPEN && activeCall.contactId) {
      wsRef.current.send(JSON.stringify({
        type: 'call_declined',
        target_user_id: activeCall.contactId
      }));
    }

    setCallLogs(prev => prev.map(log => log.username === activeCall.username && log.status === 'incoming'
      ? { ...log, status: 'missed', timestamp: 'Just now' }
      : log));

    setActiveCall({
      isOpen: false,
      contactId: null,
      username: '',
      type: 'audio',
      status: 'Ringing...',
      duration: 0
    });
  };

  useEffect(() => {
    if (!statusViewer.isOpen) return;
    if (isEditingStatus) return;
  }, [statusViewer.isOpen, isEditingStatus]);

  // Helper getters
  const otherUser = useCallback((thread) => {
    const base = thread.participants.find(p => p.id !== user?.id) || thread.participants[0];
    const live = onlineUsers[base?.id];
    const snapshot = userPresenceSnapshot[base?.id] || {};
    const status = live ? live.status : (snapshot.is_online ? 'online' : 'offline');
    return {
      ...snapshot,
      ...base,
      ...live,
      is_online: status === 'online'
    };
  }, [user?.id, onlineUsers, userPresenceSnapshot]);

  const filteredUsers = useMemo(() => {
    if (!search) return [];
    const query = search.toLowerCase();
    return allUsers.filter(u => 
      u.username.toLowerCase().includes(query) ||
      (u.first_name && u.first_name.toLowerCase().includes(query)) ||
      (u.last_name && u.last_name.toLowerCase().includes(query))
    );
  }, [allUsers, search]);

  const activeContact = activeThread ? otherUser(activeThread) : null;
  const selectedContactMeta = activeContact?.id ? (userPresenceSnapshot[activeContact.id] || {}) : {};
  const activeContactName = activeContact?.first_name || activeContact?.last_name
    ? `${activeContact?.first_name || ''} ${activeContact?.last_name || ''}`.trim()
    : activeContact?.username;
  const activeContactAvatar = selectedContactMeta.avatar || activeContact?.avatar || '';
  const activeContactIsOnline = onlineUsers[activeContact?.id]?.status === 'online' || activeContact?.is_online || selectedContactMeta.is_online;
  const activeContactStories = activeContact?.id ? mockStoriesData[activeContact.id]?.updates || [] : [];
  const activeContactDisplayName = selectedContactMeta.first_name || selectedContactMeta.last_name
    ? `${selectedContactMeta.first_name || ''} ${selectedContactMeta.last_name || ''}`.trim()
    : (activeContactName || activeContact?.username || 'User');

  const getFilteredMessages = () => {
    const visibleMessages = messages.filter(m => !deletedMsgIds.includes(m.id));
    const query = chatSearch.trim().toLowerCase();
    if (!query) return visibleMessages;
    return visibleMessages.filter(m => (m.content || '').toLowerCase().includes(query));
  };

  // --- RENDER SECTIONS ---

  // Sidebar dynamic item list based on activeTab
  const renderSidebarList = () => {
    const query = search.toLowerCase();    if (activeTab === 'chats') {
      const latestMyStory = myStories.length > 0 ? myStories[myStories.length - 1] : null;
      // 1. Stories top row (Messenger-style: My story + Recent + Viewed)
      let storiesHtml = [];
      const isMyStoryExpiring = latestMyStory
        ? (STORY_TTL_MS - (Date.now() - new Date(latestMyStory.created_at || Date.now()).getTime())) < 2 * 60 * 60 * 1000
        : false;

      // Separator between recent & viewed stories in the row
      const allOthers = Object.keys(mockStoriesData);
      const recentCids = allOthers.filter(cid =>
        !(mockStoriesData[cid]?.updates || []).every(u => viewedStoryIds[u.id])
      );
      const viewedCids = allOthers.filter(cid =>
        (mockStoriesData[cid]?.updates || []).length > 0 &&
        (mockStoriesData[cid]?.updates || []).every(u => viewedStoryIds[u.id])
      );

      // User's own story circle (always first, with add badge)
      storiesHtml.push(
        <div key="me" className="kot3-story-circle me" onClick={() => myStories.length > 0 ? openStatusViewer('me') : setIsEditingStatus(true)}>
          <div className="kot3-story-avatar-wrapper">
            <div className={`kot3-story-avatar-ring ${myStories.length === 0 ? 'viewed' : ''}`}></div>
            {user?.profile?.avatar || user?.avatar ? (
              <img className="kot3-story-avatar" src={user.profile.avatar || user.avatar} alt="" />
            ) : (
              <div className="kot3-story-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>{(user?.username || '?').slice(0, 1).toUpperCase()}</div>
            )}
            {myStories.length > 0 ? (
              isMyStoryExpiring ? (
                <div className="kot3-story-expiring-badge" title={lang === 'ht' ? 'Ap ekspire benter' : 'Expiring soon'}><i className="fas fa-hourglass-half"></i></div>
              ) : (
                <div className="kot3-story-add-badge" style={{ background: 'var(--status-read)' }}><i className="fas fa-eye"></i></div>
              )
            ) : (
              <div className="kot3-story-add-badge"><i className="fas fa-plus"></i></div>
            )}
          </div>
          <span className="kot3-story-name">{lang === 'ht' ? 'Mete pa w' : 'Your story'}</span>
        </div>
      );

      // Recent (unviewed) stories - gradient ring
      recentCids.forEach(cid => {
        const item = mockStoriesData[cid];
        const lastStory = item.updates[item.updates.length - 1];
        const expiringSoon = (STORY_TTL_MS - (Date.now() - new Date(lastStory.created_at || Date.now()).getTime())) < 2 * 60 * 60 * 1000;
        storiesHtml.push(
          <div key={`r-${cid}`} className="kot3-story-circle" onClick={() => openStatusViewer(cid)}>
            <div className="kot3-story-avatar-wrapper">
              <div className="kot3-story-avatar-ring"></div>
              {item.avatar
                ? <img className="kot3-story-avatar" src={item.avatar} alt="" />
                : <div className="kot3-story-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>{(item.name || '?').slice(0, 1).toUpperCase()}</div>}
              {expiringSoon && (
                <div className="kot3-story-expiring-badge" title={lang === 'ht' ? 'Ap ekspire benter' : 'Expiring soon'}><i className="fas fa-hourglass-half"></i></div>
              )}
            </div>
            <span className="kot3-story-name bold">{item.name.split(' ')[0]}</span>
          </div>
        );
      });

      // Separator dot between recent and viewed circles
      if (viewedCids.length > 0 && recentCids.length > 0) {
        storiesHtml.push(
          <div key="sep" aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--border-color)', alignSelf: 'center', marginTop: '-18px' }}></div>
        );
      }

      // Viewed stories - gray ring (smaller, faded)
      viewedCids.forEach(cid => {
        const item = mockStoriesData[cid];
        storiesHtml.push(
          <div key={`v-${cid}`} className="kot3-story-circle" onClick={() => openStatusViewer(cid)}>
            <div className="kot3-story-avatar-wrapper">
              <div className="kot3-story-avatar-ring viewed"></div>
              {item.avatar
                ? <img className="kot3-story-avatar" src={item.avatar} alt="" style={{ opacity: 0.78 }} />
                : <div className="kot3-story-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700, opacity: 0.78 }}>{(item.name || '?').slice(0, 1).toUpperCase()}</div>}
            </div>
            <span className="kot3-story-name" style={{ opacity: 0.78 }}>{item.name.split(' ')[0]}</span>
          </div>
        );
      });

      const filteredThreads = threads.filter(t => otherUser(t)?.username.toLowerCase().includes(query));

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {latestMyStory && (
            <div className="kot3-my-status-card">
              <div className="kot3-my-status-label">{lang === 'ht' ? 'Dènye status ou' : 'Your latest status'}</div>
              <div className="kot3-my-status-content">
                <span className="kot3-my-status-dot"></span>
                <span>{latestMyStory.content || (lang === 'ht' ? 'Imaj status' : 'Status image')}</span>
              </div>
            </div>
          )}
          <div className="kot3-stories-shell">
            <div className="kot3-stories-shell-header">
              <span className="kot3-stories-shell-title">{lang === 'ht' ? 'Estati' : 'Stories'}</span>
              <button
                type="button"
                className="kot3-stories-shell-add"
                onClick={() => setIsEditingStatus(true)}
              >
                <i className="fas fa-plus"></i>
                <span>{lang === 'ht' ? 'Ajoute pa w' : 'Add yours'}</span>
              </button>
            </div>
            <div className="kot3-stories-quick-row">
              {storiesHtml}
            </div>
          </div>
          <div className="kot3-tab-content">
            {filteredThreads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-secondary)' }}>
                <i className="far fa-paper-plane" style={{ fontSize: '2rem', marginBottom: '10px', color: 'var(--border-color)' }}></i>
                <p style={{ fontSize: '0.82rem' }}>{lang === 'ht' ? 'Pa gen diskisyon ankò.' : 'No conversations yet.'}</p>
              </div>
            ) : (
              filteredThreads.map(thread => {
                const other = otherUser(thread);
                const last = thread.last_message;
                const unread = thread.unread_count || 0;
                const isSelected = sameId(activeThread?.id, thread.id);
                const isTyping = typingUsers[thread.id];

                return (
                  <div
                    key={thread.id}
                    onClick={() => openSelectedThread(thread)}
                    className={`kot3-list-item ${isSelected ? 'active' : ''} ${unread > 0 ? 'unread' : ''}`}
                  >
                    <div 
                      className="kot3-list-item-avatar-wrapper"
                      style={{ position: 'relative' }}
                      onClick={(e) => {
                        if (other?.id && mockStoriesData[other.id]) {
                          e.stopPropagation();
                          openStatusViewer(other.id);
                        }
                      }}
                    >
                      {other?.id && mockStoriesData[other.id] && (
                        <div className="kot3-list-item-avatar-ring" style={{
                          position: 'absolute',
                          top: '-3px',
                          left: '-3px',
                          right: '-3px',
                          bottom: '-3px',
                          borderRadius: '50%',
                          border: '2px solid var(--pink-primary)',
                          boxShadow: '0 0 5px var(--pink-primary)',
                          animation: 'pulseGlow 2s infinite',
                          zIndex: 1
                        }}></div>
                      )}
                      {other?.avatar ? (
                        <img className="kot3-list-item-avatar" src={other.avatar} alt="" style={{ position: 'relative', zIndex: 2 }} />
                      ) : (
                        <div className="kot3-list-item-avatar" style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                          {(other?.username || '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      {(other?.is_online || onlineUsers[other?.id]?.status === 'online') && <div className="kot3-online-badge" style={{ zIndex: 3 }}></div>}
                    </div>
                    <div className="kot3-list-item-info">
                      <div className="kot3-list-item-header">
                        <span className="kot3-list-item-name">@{other?.username}</span>
                        <span className="kot3-list-item-time">
                          {last ? new Date(last.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <div className="kot3-list-item-preview">
                        <span className="kot3-list-item-msg" style={isTyping ? { color: 'var(--primary-color)', fontWeight: '600' } : {}}>
                          {isTyping ? (lang === 'ht' ? 'ap ekri...' : 'typing...') : (last ? (last.sender_id === user.id ? 'You: ' : '') + (last.content || '🎙️ Audio') : (lang === 'ht' ? 'Di kòman w ye...' : 'Say hello...'))}
                        </span>
                        {unread > 0 && <span className="kot3-unread-badge">{unread}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'status') {
      return (
        <div className="kot3-tab-content" style={{ padding: '10px 0' }}>
          <div style={{ padding: '8px 20px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
            {lang === 'ht' ? 'Status mwen' : 'My Status'}
          </div>
          
          <div className="kot3-list-item" onClick={() => setIsEditingStatus(true)}>
            <div className="kot3-list-item-avatar-wrapper">
              {user?.profile?.avatar || user?.avatar ? (
                <img className="kot3-list-item-avatar" src={user.profile.avatar || user.avatar} alt="" />
              ) : (
                <div className="kot3-list-item-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                  {(user?.username || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="kot3-story-add-badge" style={{ bottom: 0, right: 0, width: 16, height: 16, fontSize: '9px' }}><i className="fas fa-plus"></i></div>
            </div>
            <div className="kot3-list-item-info" style={{ marginLeft: '4px' }}>
              <span className="kot3-list-item-name" style={{ display: 'block' }}>{lang === 'ht' ? 'Mete yon status' : 'Add to status'}</span>
              <span className="kot3-list-item-time">{myStories.length > 0 ? `${myStories.length} status pibliye` : (lang === 'ht' ? 'Pataje tèks ak zanmi w' : 'Share text status')}</span>
            </div>
          </div>

          <div style={{ padding: '16px 20px 6px 20px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
            {lang === 'ht' ? 'Dènye Status yo' : 'Recent Updates'}
          </div>

          {Object.keys(mockStoriesData).map(cid => {
            const item = mockStoriesData[cid];
            return (
              <div key={cid} className="kot3-list-item" onClick={() => openStatusViewer(cid)}>
                <div className="kot3-list-item-avatar-wrapper">
                  <div className="kot3-story-avatar-ring" style={{ width: '52px', height: '52px', top: '-3px', left: '-3px' }}></div>
                  <img className="kot3-list-item-avatar" src={item.avatar} alt="" />
                </div>
                <div className="kot3-list-item-info" style={{ marginLeft: '6px' }}>
                  <span className="kot3-list-item-name" style={{ display: 'block' }}>{item.name}</span>
                  <span className="kot3-list-item-time">{item.updates[item.updates.length - 1].timestamp}</span>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (activeTab === 'calls') {
      return (
        <div className="kot3-tab-content" style={{ padding: '10px 0' }}>
          <div style={{ padding: '8px 20px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
            {lang === 'ht' ? 'Apèl Dènyèman' : 'Call History'}
          </div>

          {callLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)', fontSize: '12px' }}>
              {lang === 'ht' ? 'Pa gen okenn istwa apèl.' : 'No calls history yet.'}
            </div>
          ) : (
            callLogs.map(log => {
              const contactPerson = allUsers.find(u => u.username === log.username.replace('@', ''));
              const avatar = contactPerson?.avatar || '';
              let statusIconClass = 'fas fa-arrow-down-left call-log-icon';
              let statusColor = '#00ff88'; // green
              if (log.status === 'missed') {
                statusIconClass = 'fas fa-arrow-down-left call-log-icon';
                statusColor = '#ff2d55';
              } else if (log.status === 'connected') {
                statusIconClass = 'fas fa-phone-volume call-log-icon';
                statusColor = '#00ff88';
              } else if (log.status === 'outgoing') {
                statusIconClass = 'fas fa-arrow-up-right call-log-icon';
                statusColor = 'var(--primary-color)';
              }

              return (
                <div key={log.id} className="kot3-list-item">
                  {avatar ? (
                    <img className="kot3-list-item-avatar" src={avatar} alt="" />
                  ) : (
                    <div className="kot3-list-item-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                      {(log.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="kot3-list-item-info">
                    <span className="kot3-list-item-name" style={{ display: 'block' }}>{log.username}</span>
                    <div className="kot3-list-item-preview" style={{ marginTop: '2px' }}>
                      <span className="kot3-list-item-msg" style={{ fontSize: '11px' }}>
                        <i className={statusIconClass} style={{ color: statusColor, marginRight: '4px' }}></i>
                        {log.status === 'missed' ? (lang === 'ht' ? 'Manpe' : 'Missed') : (log.status === 'incoming' ? (lang === 'ht' ? 'Antran' : 'Incoming') : (log.status === 'connected' ? (lang === 'ht' ? 'Konekte' : 'Connected') : (lang === 'ht' ? 'Soti' : 'Outgoing')))}
                      </span>
                      <span className="kot3-list-item-time">{log.timestamp}</span>
                    </div>
                  </div>
                  <button className="kot3-call-btn-trigger" onClick={() => startCallingUser(contactPerson?.id || 1, log.type)}>
                    <i className={log.type === 'video' ? 'fas fa-video' : 'fas fa-phone'}></i>
                  </button>
                </div>
              );
            })
          )}
        </div>
      );
    }
  };

  // Contacts search rendering overlay when search textbox has characters
  const renderSearchResults = () => {
    const query = search.trim().toLowerCase();
    const storyResults = (globalSearchResults.stories || []).filter(s => {
      const hay = `${s.content || ''} ${s.user?.username || ''} ${s.user?.first_name || ''} ${s.user?.last_name || ''}`.toLowerCase();
      return hay.includes(query);
    });
    return (
      <div className="kot3-tab-content" style={{ padding: '10px 0' }}>
        <div style={{ padding: '8px 20px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
          {lang === 'ht' ? 'Rezilta rechèch' : 'Search Results'}
        </div>
        {isGlobalSearchLoading ? (
          <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {lang === 'ht' ? 'Ap chèche...' : 'Searching...'}
          </div>
        ) : (
          <>
            <div style={{ padding: '8px 20px 4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
              {lang === 'ht' ? 'Kontak' : 'People'}
            </div>
            {(globalSearchResults.users || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 30px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {lang === 'ht' ? 'Pa gen kontak.' : 'No people found.'}
              </div>
            ) : globalSearchResults.users.map(u => (
              <div key={`user-${u.id}`} className="kot3-list-item" onClick={() => openChatWithUser(u)}>
                <div className="kot3-list-item-avatar-wrapper">
                  {u.avatar ? (
                    <img className="kot3-list-item-avatar" src={u.avatar} alt="" />
                  ) : (
                    <div className="kot3-list-item-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                      {(u.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  {u.is_online && <div className="kot3-online-badge"></div>}
                </div>
                <div className="kot3-list-item-info">
                  <span className="kot3-list-item-name" style={{ display: 'block' }}>@{u.username}</span>
                  <span className="kot3-list-item-time">
                    {u.status_text || (u.is_online ? (lang === 'ht' ? 'Active kounye a' : 'Active now') : (lang === 'ht' ? 'Deploge' : 'Offline'))}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ padding: '14px 20px 4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
              {lang === 'ht' ? 'Konvèsasyon' : 'Threads'}
            </div>
            {(globalSearchResults.threads || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 30px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {lang === 'ht' ? 'Pa gen konvèsasyon.' : 'No conversations found.'}
              </div>
            ) : globalSearchResults.threads.map(thread => (
              <div key={`thread-${thread.id}`} className="kot3-list-item" onClick={() => openSelectedThread(thread)}>
                <div className="kot3-list-item-avatar-wrapper">
                  {otherUser(thread)?.avatar ? (
                    <img className="kot3-list-item-avatar" src={otherUser(thread).avatar} alt="" />
                  ) : (
                    <div className="kot3-list-item-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                      {(otherUser(thread)?.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="kot3-list-item-info">
                  <span className="kot3-list-item-name" style={{ display: 'block' }}>@{otherUser(thread)?.username}</span>
                  <span className="kot3-list-item-time">
                    {thread.last_message?.content ? thread.last_message.content.slice(0, 34) : ''}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ padding: '14px 20px 4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
              {lang === 'ht' ? 'Mesaj' : 'Messages'}
            </div>
            {(globalSearchResults.messages || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 30px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {lang === 'ht' ? 'Pa gen mesaj.' : 'No messages found.'}
              </div>
            ) : globalSearchResults.messages.map(msg => (
              <div key={`msg-${msg.id}`} className="kot3-list-item" onClick={() => {
                const thread = threads.find(t => sameId(t.id, msg.thread)) || globalSearchResults.threads.find(t => sameId(t.id, msg.thread));
                if (thread) openSelectedThread(thread);
              }}>
                <div className="kot3-list-item-avatar-wrapper">
                  <div className="kot3-list-item-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                    {(msg.sender_username || '?').slice(0, 1).toUpperCase()}
                  </div>
                </div>
                <div className="kot3-list-item-info">
                  <span className="kot3-list-item-name" style={{ display: 'block' }}>@{msg.sender_username}</span>
                  <span className="kot3-list-item-time">{(msg.content || '').slice(0, 50)}</span>
                </div>
              </div>
            ))}

            <div style={{ padding: '14px 20px 4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
              {lang === 'ht' ? 'Status' : 'Status'}
            </div>
            {(storyResults || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 30px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {lang === 'ht' ? 'Pa gen status.' : 'No statuses found.'}
              </div>
            ) : storyResults.map(story => (
              <div key={`story-${story.id}`} className="kot3-list-item" onClick={() => openStatusViewer(story.user.id)}>
                <div className="kot3-list-item-avatar-wrapper">
                  {story.user?.avatar ? (
                    <img className="kot3-list-item-avatar" src={story.user.avatar} alt="" />
                  ) : (
                    <div className="kot3-list-item-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                      {(story.user?.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="kot3-list-item-info">
                  <span className="kot3-list-item-name" style={{ display: 'block' }}>@{story.user.username}</span>
                  <span className="kot3-list-item-time">{(story.content || '').slice(0, 50)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  // Accent selector triggers
  const handleCustomStatusReplySubmit = (e) => {
    if (e.key === 'Enter') {
      handleStatusReply(e.target.value);
    }
  };

  return (
    <div className={`kot3-container ${activeThread ? 'chat-active' : ''}`} data-theme={activeTheme}>
      
      {/* 1. SIDEBAR AREA */}
      <aside className={`kot3-sidebar ${activeThread ? 'collapsed' : ''}`}>
        
        {/* Header Profile */}
        <div className="kot3-sidebar-header">
          <div className="kot3-header-top">
            <div className="kot3-profile-area" style={{ display: 'flex', alignItems: 'center' }}>
              {user?.profile?.avatar || user?.avatar ? (
                <img className="kot3-profile-avatar" src={user.profile.avatar || user.avatar} alt="" />
              ) : (
                <div className="kot3-logo-avatar" style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--pink-primary), #a18cd1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '18px',
                  boxShadow: '0 2px 10px rgba(216, 27, 96, 0.3)',
                  marginRight: '12px',
                  flexShrink: 0
                }}>
                  <i className="fas fa-graduation-cap"></i>
                </div>
              )}
              <div className="kot3-profile-info">
                <h3>{user.username}</h3>
                <p>Nivo: Kreyatè</p>
              </div>
            </div>
              <div className="kot3-header-actions"></div>
          </div>

          <div className={`kot3-search-wrapper ${localSearch ? 'has-text' : ''}`}>
            <i className="fas fa-search kot3-search-leading-icon"></i>
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder={lang === 'ht' ? 'Chache moun oswa chat...' : 'Search on Messenger…'}
              className="kot3-search-input"
              aria-label={lang === 'ht' ? 'Chache' : 'Search'}
            />
            {localSearch && (
              <>
                <button
                  type="button"
                  className="kot3-search-clear"
                  onClick={() => setLocalSearch('')}
                  title={lang === 'ht' ? 'Efase rechèch la' : 'Clear search'}
                  aria-label={lang === 'ht' ? 'Efase rechèch la' : 'Clear search'}
                >
                  <i className="fas fa-circle-xmark"></i>
                </button>
                <button
                  type="button"
                  className="kot3-search-cancel"
                  onClick={() => { setLocalSearch(''); setSearch(''); }}
                >
                  {lang === 'ht' ? 'Anile' : 'Cancel'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Scroll list */}
        {search ? renderSearchResults() : renderSidebarList()}

      </aside>

      {/* 2. CHAT VIEWPORT */}
      <main className="kot3-chat-window">
        {activeThread ? (
          <>
            {/* Header info */}
            <div className="kot3-chat-header">
              <div className="kot3-chat-header-left">
                <button
                  className="kot3-back-btn"
                  onClick={() => {
                    setActiveThread(null);
                    setIsContactPanelOpen(false);
                    setIsChatSearchOpen(false);
                    setIsMoreMenuOpen(false);
                  }}
                  title={lang === 'ht' ? 'Retounen' : 'Back'}
                >
                  <i className="fas fa-chevron-left"></i>
                </button>
                <div
                  className="kot3-active-profile-trigger"
                  role="button"
                  tabIndex={0}
                  onClick={() => setIsContactPanelOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setIsContactPanelOpen(true);
                  }}
                  title={lang === 'ht' ? 'Wè pwofil' : 'View profile'}
                >
                  <div
                    className="kot3-active-avatar-wrapper"
                    style={{ position: 'relative' }}
                  >
                    {activeContact?.id && mockStoriesData[activeContact.id] && (
                      <div className="kot3-active-avatar-ring" style={{
                        position: 'absolute',
                        top: '-3px',
                        left: '-3px',
                        right: '-3px',
                        bottom: '-3px',
                        borderRadius: '50%',
                        border: '2px solid var(--primary-color)',
                        boxShadow: '0 0 5px var(--primary-color)',
                        animation: 'pulseGlow 2s infinite',
                        zIndex: 1
                      }}></div>
                    )}
                    {activeContactAvatar ? (
                      <img className="kot3-active-avatar" src={activeContactAvatar} alt="" style={{ display: 'block', position: 'relative', zIndex: 2 }} />
                    ) : (
                      <div className="kot3-active-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2, background: 'linear-gradient(135deg, var(--primary-color), #111)', color: '#fff', fontWeight: 700 }}>
                        {(activeContactDisplayName || activeContact?.username || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="kot3-active-profile-meta">
                    <div className="kot3-active-name-row">
                      <div className="kot3-active-name">@{activeContactDisplayName}</div>
                      <div className="kot3-more-menu-wrap" ref={moreMenuWrapRef}>
                        <button
                          type="button"
                          className={`kot3-action-btn kot3-inline-menu-btn ${isMoreMenuOpen ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsMoreMenuOpen(prev => !prev);
                          }}
                          title={lang === 'ht' ? 'Plis opsyon' : 'More options'}
                        >
                          <i className="fas fa-ellipsis-vertical"></i>
                        </button>
                        {isMoreMenuOpen && (
                          <div className="kot3-more-menu kot3-more-menu-inline" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setIsContactPanelOpen(true); setIsMoreMenuOpen(false); }}>
                              <i className="fas fa-user"></i>
                              <span>{lang === 'ht' ? 'Pwofil kontak' : 'Contact profile'}</span>
                            </button>
                            <button onClick={() => { setIsChatSearchOpen(true); setIsMoreMenuOpen(false); }}>
                              <i className="fas fa-magnifying-glass"></i>
                              <span>{lang === 'ht' ? 'Chache mesaj' : 'Search messages'}</span>
                            </button>
                            <button onClick={() => { loadMessages(activeThread.id); setIsMoreMenuOpen(false); }}>
                              <i className="fas fa-arrows-rotate"></i>
                              <span>{lang === 'ht' ? 'Rafrechi' : 'Refresh'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`kot3-active-status ${activeContactIsOnline ? 'online' : ''} ${typingUsers[activeThread.id] ? 'typing' : ''}`}>
                      {typingUsers[activeThread.id] 
                        ? (lang === 'ht' ? 'ap ekri...' : 'typing...')
                        : (activeContactIsOnline ? (lang === 'ht' ? 'Sou liy' : 'Online') : (lang === 'ht' ? 'Pa sou liy' : 'Offline'))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="kot3-chat-header-actions">
                <button className={`kot3-action-btn ${isChatSearchOpen ? 'active' : ''}`} onClick={() => setIsChatSearchOpen(prev => !prev)} title={lang === 'ht' ? 'Chache nan chat' : 'Search chat'}>
                  <i className="fas fa-search"></i>
                </button>
                <button className="kot3-action-btn" onClick={() => loadMessages(activeThread.id)} title={lang === 'ht' ? 'Rafrechi mesaj yo' : 'Refresh messages'}>
                  <i className="fas fa-rotate-right"></i>
                </button>
                <div className="kot3-top-settings-wrap">
                  <button className={`kot3-action-btn ${isTopSettingsOpen ? 'active' : ''}`} onClick={() => setIsTopSettingsOpen(prev => !prev)} title={lang === 'ht' ? 'Paramèt' : 'Settings'}>
                    <i className="fas fa-gear"></i>
                  </button>
                  {isTopSettingsOpen && (
                      <div className="kot3-top-settings-menu">
                      <button onClick={() => { setIsContactPanelOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-user"></i>
                        <span>{lang === 'ht' ? 'Pwofil kontak' : 'Contact profile'}</span>
                      </button>
                      <button onClick={() => { setIsChatSearchOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-magnifying-glass"></i>
                        <span>{lang === 'ht' ? 'Chache' : 'Search'}</span>
                      </button>
                      <button onClick={() => { setIsContactInfoOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-circle-info"></i>
                        <span>{lang === 'ht' ? 'Enfòmasyon' : 'Info'}</span>
                      </button>
                      <button onClick={() => { loadMessages(activeThread.id); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-rotate-right"></i>
                        <span>{lang === 'ht' ? 'Rafrechi' : 'Refresh'}</span>
                      </button>

                      <div className="kot3-settings-divider"></div>

                      <div className="kot3-theme-section-label">
                        <i className="fas fa-palette"></i>
                        <span>{(translations && translations[lang] && translations[lang].theme_section) || 'Theme'}</span>
                      </div>
                      <div className="kot3-theme-grid" role="radiogroup" aria-label="Theme">
                        {THEMES.map((t) => {
                          const isActive = activeTheme === t.id;
                          const meta = THEME_BY_ID[t.id] || {};
                                                    const trForLang = (translations && translations[lang]) || {};
                          // Existing translations expose per-language `theme_<id>` keys (theme_dark, theme_messenger_light, ...).
                          const themeName = trForLang['theme_' + t.id] || t.label;
                          const applyLabel = trForLang.theme_apply || ('Apply ' + t.label);
                          const swatchStyle = {
                            background: meta.bg || ('linear-gradient(135deg,' + t.accent + ',#111)'),
                            borderColor: meta.isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'
                          };
                          return (
                            <button
                              key={t.id}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              className={'kot3-theme-chip' + (isActive ? ' active' : '')}
                              onClick={() => setTheme(t.id)}
                              title={'Apply ' + t.label}
                              data-theme-id={t.id}
                            >
                              <span className="kot3-theme-emoji" aria-hidden="true">{t.emoji}</span>
                              <span className="kot3-theme-swatch" aria-hidden="true" style={swatchStyle}></span>
                              <span className="kot3-theme-name">{themeName}</span>
                              {isActive && <i className="fas fa-check kot3-theme-check" aria-hidden="true"></i>}
                            </button>
                          );
                        })}
                      </div>
                      </div>
                  )}
                </div>
              </div>
            </div>

            {isChatSearchOpen && (
              <div className="kot3-chat-search-bar">
                <i className="fas fa-search"></i>
                <input
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder={lang === 'ht' ? 'Chache tèks nan konvèsasyon an...' : 'Search text in this conversation...'}
                  autoFocus
                />
                {chatSearch && (
                  <button onClick={() => setChatSearch('')} title={lang === 'ht' ? 'Efase rechèch' : 'Clear search'}>
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>
            )}

            {isContactInfoOpen && (
              <div className="kot3-contact-info-popover" ref={contactInfoRef}>
                <div className="kot3-contact-info-head">
                  <div>
                    <strong>{lang === 'ht' ? 'Enfòmasyon kontak' : 'Contact info'}</strong>
                    <span>@{activeContactDisplayName}</span>
                  </div>
                  <button type="button" onClick={() => setIsContactInfoOpen(false)} title={lang === 'ht' ? 'Fèmen' : 'Close'}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
                <div className="kot3-contact-info-grid">
                  <div>
                    <label>{lang === 'ht' ? 'Estati' : 'Status'}</label>
                    <span>{activeContactIsOnline ? (lang === 'ht' ? 'Sou liy' : 'Online') : (lang === 'ht' ? 'Pa sou liy' : 'Offline')}</span>
                  </div>
                  <div>
                    <label>{lang === 'ht' ? 'Mesaj' : 'Messages'}</label>
                    <span>{messages.filter(m => !deletedMsgIds.includes(m.id)).length}</span>
                  </div>
                  <div>
                    <label>{lang === 'ht' ? 'Status' : 'Stories'}</label>
                    <span>{activeContactStories.length}</span>
                  </div>
                  <div>
                    <label>{lang === 'ht' ? 'Nòt' : 'Note'}</label>
                    <span>{selectedContactMeta.status_text || (lang === 'ht' ? 'Pa gen nòt' : 'No note')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable messages */}
            <div ref={messagesContainerRef} className="kot3-messages-container">
              {isLoadingMessages && messages.length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.8 }}>
                  <div className="kot3-loading-spinner"></div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {lang === 'ht' ? 'Ap chaje mesaj yo...' : 'Loading messages...'}
                  </p>
                </div>
              ) : getFilteredMessages().length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.6 }}>
                  <i className="far fa-comments" style={{ fontSize: '2.5rem', marginBottom: '8px', color: 'var(--primary-color)' }}></i>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{lang === 'ht' ? 'Konvèsasyon vid.' : 'No messages here.'}</p>
                </div>
              ) : (
                <>
                  {isLoadingMessages && (
                    <div style={{ position: 'sticky', top: 0, alignSelf: 'center', marginBottom: '6px', fontSize: '11px', color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--bg-chat) 82%, transparent)', padding: '4px 10px', borderRadius: '999px', border: '1px solid var(--border-color)' }}>
                      {lang === 'ht' ? 'Ap rafrechi mesaj yo...' : 'Refreshing messages...'}
                    </div>
                  )}
                  {getFilteredMessages().map(msg => {
                  const isMe = msg.sender_id === user.id;
                  const reactions = reactionsMap[msg.id] || [];

                  return (
                    <div key={msg.id} data-msg-id={msg.id} className={`kot3-message-row ${isMe ? 'sent' : 'received'}`}>
                      <div className="kot3-bubble-wrapper">
                        <div className="kot3-bubble">
                          {/* Reply quote preview ABOVE the bubble if this message replies to another */}
                          {msg.reply_to_id && (
                            <div
                              className="kot3-msg-reply-quote"
                              onClick={(e) => { e.stopPropagation(); try {
                                const messagesContainer = messagesContainerRef.current;
                                if (!messagesContainer) return;
                                const targetEl = messagesContainer.querySelector('[data-msg-id="' + msg.reply_to_id + '"]');
                                if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              } catch {} }}
                              title={lang === 'ht' ? 'Ale nan mesaj orijinal la' : 'Jump to original message'}
                            >
                              <span className="kot3-reply-bar"></span>
                              <div className="kot3-reply-content">
                                <span className="kot3-reply-author">@{msg.reply_to_sender || 'user'}</span>
                                <span className="kot3-reply-snippet">{msg.reply_to_snippet || (lang === 'ht' ? '...' : '...')}</span>
                              </div>
                            </div>
                          )}

                          {msg.audio || msg.audio_pending ? (
                            <div className="kot3-audio-row">
                              <button onClick={() => !msg.audio_pending && toggleAudioPlayback(msg.id)} className="kot3-audio-play-btn">
                                <i className={msg.audio_pending ? 'fas fa-spinner fa-spin' : (playingAudioId === msg.id ? 'fas fa-pause' : 'fas fa-play')}></i>
                              </button>
                              <div className="kot3-audio-meta">
                                <span>🎙️ {lang === 'ht' ? 'Not Vokal' : 'Voice note'}</span>
                                <span className="kot3-audio-sub">{msg.audio_pending ? (lang === 'ht' ? 'Ap chaje...' : 'Loading...') : (lang === 'ht' ? 'Klike pou koute' : 'Tap to play')}</span>
                              </div>
                              {msg.audio && (
                                <audio
                                  ref={el => { if (el) audioRefs.current[msg.id] = el; }}
                                  src={msg.audio}
                                  onEnded={() => setPlayingAudioId(null)}
                                />
                              )}
                            </div>
                          ) : msg.image ? (
                            <img
                              src={msg.image}
                              alt="attachment"
                              className="kot3-msg-image"
                              loading="lazy"
                              onLoad={() => { try { scrollToBottom(); } catch {} }}
                              onClick={() => msg.image && window.open && window.open(msg.image, '_blank')}
                            />
                          ) : (
                            msg.content
                          )}

                          {msg.is_edited && (
                            <span className="kot3-edited-tag">
                              {lang === 'ht' ? '· modifye' : '· edited'}
                            </span>
                          )}

                          {/* Reactions display overlay */}
                          {reactions.length > 0 && (
                            <div className="kot3-reaction-container" onClick={() => reactToMessage(msg.id, reactions[0])}>
                              {reactions.map((r, i) => <span key={i}>{r}</span>)}
                            </div>
                          )}
                        </div>

                        <div className="kot3-message-meta">
                          <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isMe && (() => {
                            const ms = msg.status;
                            if (ms === 'sending') return <i className="fas fa-clock kot3-delivery-clock" title={lang === 'ht' ? 'Ap voye...' : 'Sending...'}></i>;
                            if (ms === 'sent' || (msg.is_delivered === false && !msg.is_read)) return <i className="fas fa-check" title={lang === 'ht' ? 'Voye' : 'Sent'}></i>;
                            if ((ms === 'delivered' || msg.is_delivered) && !msg.is_read) return <i className="fas fa-check-double" title={lang === 'ht' ? 'Livre' : 'Delivered'}></i>;
                            if (msg.is_read || ms === 'read') return <i className={`fas fa-check-double read ${msg.is_read ? 'read' : ''}`} title={lang === 'ht' ? 'Li' : 'Read'}></i>;
                            return <i className={`fas fa-check-double ${msg.is_read ? 'read' : ''}`}></i>;
                          })()}
                        </div>

                        {/* Reaction drawer picker */}
                        {openReactionDrawerId === msg.id && (
                          <div className="kot3-reaction-drawer">
                            {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                              <span key={emoji} onClick={() => reactToMessage(msg.id, emoji)}>{emoji}</span>
                            ))}
                          </div>
                        )}

                        {/* Hover Actions options */}
                        <div className="kot3-msg-actions-overlay">
                          <button className="kot3-msg-action-btn" title={lang === 'ht' ? 'Reponn' : 'Reply'} onClick={(e) => { e.stopPropagation(); startReply(msg); }}>
                            <i className="fas fa-reply"></i>
                          </button>
                          <button className="kot3-msg-action-btn" title={lang === 'ht' ? 'Reaji' : 'React'} onClick={(e) => { e.stopPropagation(); setOpenReactionDrawerId(openReactionDrawerId === msg.id ? null : msg.id); }}>
                            <i className="far fa-smile"></i>
                          </button>
                          {isMe && <button className="kot3-msg-action-btn" title={lang === 'ht' ? 'Modifye' : 'Edit'} onClick={(e) => { e.stopPropagation(); startEditMessage(msg); }}>
                            <i className="fas fa-pen"></i>
                          </button>}
                          <button className="kot3-msg-action-btn kot3-msg-action-danger" title={lang === 'ht' ? 'Efase' : 'Delete'} onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); }}>
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </>
              )}

              {typingUsers[activeThread.id] && (
                <div className="kot3-typing-bubble">
                  <div className="kot3-typing-dot"></div>
                  <div className="kot3-typing-dot"></div>
                  <div className="kot3-typing-dot"></div>
                </div>
              )}
              <div ref={messagesEndRef} />
              {showScrollFab && (
                <button
                  type="button"
                  className="kot3-scroll-fab"
                  onClick={scrollToBottom}
                  title={lang === 'ht' ? 'Desann' : 'Jump to bottom'}
                >
                  <i className="fas fa-chevron-down"></i>
                </button>
              )}
            </div>

            {/* Reply/Edit/Attachment banners */}
            {replyingTo && (
              <div className="kot3-context-banner kot3-reply-banner">
                <div className="kot3-context-banner-icon"><i className="fas fa-reply"></i></div>
                <div className="kot3-context-banner-text">
                  <span className="kot3-context-banner-title">{lang === 'ht' ? 'Reponn a' : 'Replying to'} @{replyingTo.reply_to_sender || replyingTo.sender_username || 'user'}</span>
                  <span className="kot3-context-banner-snippet">{(replyingTo.content || '').slice(0, 80) || (lang === 'ht' ? '...' : '...')}</span>
                </div>
                <button type="button" className="kot3-context-banner-close" onClick={cancelReply} title={lang === 'ht' ? 'Anile' : 'Cancel'}>
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}
            {editingMessage && (
              <div className="kot3-context-banner kot3-edit-banner">
                <div className="kot3-context-banner-icon"><i className="fas fa-pen"></i></div>
                <div className="kot3-context-banner-text">
                  <span className="kot3-context-banner-title">{lang === 'ht' ? 'Modifye mesaj' : 'Editing message'}</span>
                  <span className="kot3-context-banner-snippet">{lang === 'ht' ? 'Sove oswa anile' : 'Save or cancel'}</span>
                </div>
                <button type="button" className="kot3-context-banner-close" onClick={cancelEdit} title={lang === 'ht' ? 'Anile' : 'Cancel'}>
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}
            {imagePreviewUrl && (
              <div className="kot3-image-preview">
                <img src={imagePreviewUrl} alt="preview" />
                <button type="button" className="kot3-image-preview-close" onClick={clearAttachedImage} title={lang === 'ht' ? 'Retire imaj la' : 'Remove image'}>
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}

            {/* Message input footer */}
            <div className="kot3-chat-footer">
              <div className="kot3-input-wrapper">
                {isRecording ? (
                  <div className="kot3-recording-wave" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '0 10px',
                    height: '35px',
                    flexGrow: 1
                  }}>
                    <span style={{ fontSize: '12px', color: '#ff2d55', fontWeight: 'bold', marginRight: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', backgroundColor: '#ff2d55', borderRadius: '50%', display: 'inline-block', animation: 'kot3-pulse-ring 1.5s infinite' }}></span>
                      {lang === 'ht' ? 'Ap anrejistre...' : 'Recording...'}
                    </span>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => {
                      const heights = [12, 24, 8, 18, 28, 14, 22, 10, 26, 16];
                      const speeds = [0.8, 0.6, 0.7, 0.5, 0.9, 0.6, 0.8, 0.5, 0.7, 0.6];
                      const delays = [0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.5, 0.1, 0.4];
                      return (
                        <div key={i} className="kot3-wave-bar" style={{
                          width: '3px',
                          height: `${heights[i-1]}px`,
                          backgroundColor: '#ff2d55',
                          borderRadius: '3px',
                          animation: `kot3-bounce-bar ${speeds[i-1]}s ease-in-out infinite alternate ${delays[i-1]}s`,
                          transformOrigin: 'bottom'
                        }}></div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => { setInput(e.target.value); sendTypingNotification(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                      placeholder={lang === 'ht' ? 'Ekri mesaj pa w...' : 'Type a message...'}
                      className="kot3-chat-input"
                    />
                    <button className="kot3-emoji-trigger" onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}>😀</button>
                    
                    {emojiPickerOpen && (
                      <div className="kot3-emoji-picker">
                        {['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '❤️', '😭', '👀', '👏', '💯'].map(emoji => (
                          <span key={emoji} onClick={() => { setInput(prev => prev + emoji); setEmojiPickerOpen(false); }}>{emoji}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecordingAndSend}
                onMouseLeave={cancelRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecordingAndSend}
                style={{
                  background: isRecording ? '#e91e63' : 'transparent',
                  border: isRecording ? 'none' : '1px solid var(--border-color)',
                  width: '40px', height: '40px', borderRadius: '50%',
                  color: isRecording ? 'white' : 'var(--text-secondary)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isRecording ? '0 0 15px #e91e63' : 'none',
                  transition: 'all 0.2s', margin: '0 4px',
                  flexShrink: 0
                }}
                title="Hold mic to record voice note"
              >
                <i className="fas fa-microphone"></i>
              </button>
              <button className="kot3-send-btn" onClick={handleSendMessage}>
                <i className="fas fa-paper-plane"></i>
              </button>
            </div>
          </>
        ) : (
          <div className="kot3-welcome-screen">
            <i className="fab fa-facebook-messenger kot3-welcome-logo"></i>
            <h2>Kolektif Messenger</h2>
            <p>Chwazi yon moun pou kòmanse koze, gade dènye status yo oswa pase apèl fasilman.</p>
          </div>
        )}
      </main>

      {/* 3. STORIES VIEWER FULLSCREEN OVERLAY (FB Messenger style: 9:16 device frame, segmented bars, tap left/right, hold-to-pause, quick reactions) */}
      {statusViewer.isOpen && (() => {
        const statusListForViewer = getStatusListForId(statusViewer.contactId);
        const currentStory = statusListForViewer[statusViewer.storyIndex];
        const userMeta = getStatusUserMeta(statusViewer.contactId);
        const storyKey = currentStory ? (currentStory.id ? `${statusViewer.contactId}-${currentStory.id}` : `${statusViewer.contactId}-${statusViewer.storyIndex}`) : null;
        const autoFont = (currentStory && currentStory.font) || 'modern';
        return (
          <div
            className="kot3-status-viewer"
            onPointerDown={() => { clearInterval(statusViewerTimerRef.current); setIsStatusViewerPaused(true); }}
            onPointerUp={() => { setIsStatusViewerPaused(false); setStatusViewer(prev => ({ ...prev })); }}
            onPointerCancel={() => { setIsStatusViewerPaused(false); setStatusViewer(prev => ({ ...prev })); }}
          >
            <div className="kot3-status-frame portrait">
              <div className="kot3-status-header">
                <div className="kot3-status-progress-bar">
                  {statusListForViewer.map((s, idx) => (
                    <div key={(s && s.id) || idx} className="kot3-progress-segment">
                      <div
                        className="kot3-progress-filler"
                        style={{
                          width: idx < statusViewer.storyIndex ? '100%' : (idx === statusViewer.storyIndex ? `${statusViewer.progress}%` : '0%'),
                        }}
                      ></div>
                    </div>
                  ))}
                </div>
                <div className="kot3-status-user-info">
                  <div className="kot3-status-user-details">
                    {userMeta.avatar ? (
                      <img className="kot3-status-user-avatar" src={userMeta.avatar} alt="" />
                    ) : (
                      <div className="kot3-status-user-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: 700 }}>{(userMeta.name || '?').slice(0, 1).toUpperCase()}</div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="kot3-status-user-name">{userMeta.name}</div>
                      <div className="kot3-status-time-passed">{(currentStory && currentStory.timestamp) || ''}</div>
                    </div>
                  </div>
                  <button className="kot3-status-close-btn" onClick={(e) => { e.stopPropagation(); closeStatusViewer(); }} aria-label={lang === 'ht' ? 'Fèmen' : 'Close'}><i className="fas fa-times"></i></button>
                </div>
              </div>

              <div className="kot3-status-content">
                {currentStory && currentStory.type === 'text' ? (
                  <div className={`kot3-status-text-wrap font-${autoFont}`} style={{ background: currentStory.background }}>
                    {currentStory.content}
                  </div>
                ) : (currentStory && currentStory.content) ? (
                  <img className="kot3-status-media" src={currentStory.content} alt="" />
                ) : null}

                <button className="kot3-status-tap-zone prev" onClick={(e) => { e.stopPropagation(); showPrevStatus(); }} aria-label={lang === 'ht' ? 'Anvan' : 'Previous'}></button>
                <button className="kot3-status-tap-zone next" onClick={(e) => { e.stopPropagation(); showNextStatus(); }} aria-label={lang === 'ht' ? 'Apre' : 'Next'}></button>

                {isStatusViewerPaused && (
                  <div className="kot3-pause-overlay"><i className="fas fa-pause"></i></div>
                )}
              </div>

              {statusViewer.contactId !== 'me' && (
                <div className="kot3-status-footer" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  <div className="kot3-status-quick-reactions">
                    {['❤️', '🔥', '👍', '😂'].map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        className={statusQuickReactions[storyKey] === emoji ? 'active' : ''}
                        onClick={() => {
                          setStatusQuickReactions(prev => Object.prototype.hasOwnProperty.call(prev, storyKey) && prev[storyKey] === emoji ? Object.keys(prev).reduce((acc, k) => { if (k !== storyKey) acc[k] = prev[k]; return acc; }, {}) : ({ ...prev, [storyKey]: emoji }));
                        }}
                        aria-label={'React ' + emoji}
                      >{emoji}</button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder={lang === 'ht' ? 'Reponn...' : 'Reply...'}
                    className="kot3-status-reply-input"
                    onKeyDown={handleCustomStatusReplySubmit}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <button className="kot3-status-reply-send" onClick={(e) => { e.stopPropagation(); }} aria-label={lang === 'ht' ? 'Voye' : 'Send'}>
                    <i className="fas fa-paper-plane"></i>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {/* 4. STATUS CREATOR DIALOG OVERLAY (FB Messenger style: TEXT/PHOTO tabs, font picker, 16-color palette) */}
      {isEditingStatus && (
        <div className="kot3-creator-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) { setIsEditingStatus(false); setStatusCreatorText(''); setStatusCreatorImage(''); setStatusCreatorTab('text'); } }}>
          <div className="kot3-creator-card" onClick={(e) => e.stopPropagation()}>
            <div className="kot3-creator-header">
              <h3>{lang === 'ht' ? 'Kreye yon status' : 'Create story'}</h3>
              <button
                type="button"
                className="kot3-action-btn"
                onClick={() => { setIsEditingStatus(false); setStatusCreatorText(''); setStatusCreatorImage(''); setStatusCreatorTab('text'); }}
                aria-label="Close"
              ><i className="fas fa-times"></i></button>
            </div>

            <div className="kot3-creator-tabs" role="tablist">
              <button
                type="button"
                className={'kot3-creator-tab-btn ' + (statusCreatorTab === 'text' ? 'active' : '')}
                onClick={() => {
                            if (statusCreatorImage && !window.confirm(lang === 'ht' ? 'Sa ap efase foto a, ou vlè konsève lè?' : 'This will discard your photo. Continue?')) return;
                            setStatusCreatorTab('text');
                            setStatusCreatorImage('');
                          }}
                role="tab"
                aria-selected={statusCreatorTab === 'text'}
              >{lang === 'ht' ? 'TEKS' : 'TEXT'}</button>
              <button
                type="button"
                className={'kot3-creator-tab-btn ' + (statusCreatorTab === 'photo' ? 'active' : '')}
                onClick={() => setStatusCreatorTab('photo')}
                role="tab"
                aria-selected={statusCreatorTab === 'photo'}
              >{lang === 'ht' ? 'FOTO' : 'PHOTO'}</button>
            </div>

            <div className="kot3-creator-body">
              {statusCreatorTab === 'text' && (
                <>
              <div
                className="kot3-preview-box"
                style={{ background: statusCreatorImage ? '#000' : STATUS_PALETTE[activeGradIdx] }}
              >
                {statusCreatorImage ? (
                  <div className="kot3-preview-photo-wrap">
                    <img
                      src={statusCreatorImage}
                      alt={lang === 'ht' ? 'Aperççu foto' : 'Photo preview'}
                      className="kot3-preview-photo"
                    />
                    <button
                      type="button"
                      className="kot3-preview-photo-remove"
                      onClick={() => setStatusCreatorImage('')}
                      title={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                      aria-label={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                    >
                      <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={statusCreatorText}
                    onChange={(e) => setStatusCreatorText(e.target.value)}
                    placeholder={lang === 'ht' ? 'Ekri mesaj...' : 'Type a message...'}
                    className={'kot3-preview-input font-' + statusCreatorFont}
                    maxLength={120}
                    rows={4}
                    style={{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family }}
                  />
                )}
              </div>
                  <div className="kot3-creator-tool-row">
                    <span className="kot3-creator-tool-label">{lang === 'ht' ? 'Koulè' : 'Colors'}:</span>
                    <div className="kot3-color-palette">
                      {STATUS_PALETTE.map((bg, idx) => (
                        <div
                          key={idx}
                          className={'kot3-color-dot ' + (idx === activeGradIdx ? 'active' : '')}
                          style={{ background: bg }}
                          onClick={() => setActiveGradIdx(idx)}
                          title={'Palette ' + (idx + 1)}
                        ></div>
                      ))}
                    </div>
                  </div>
                  <div className="kot3-creator-tool-row">
                    <span className="kot3-creator-tool-label">Aa:</span>
                    <div className="kot3-font-picker">
                      {STATUS_FONTS.map(f => (
                        <button
                          key={f.key}
                          type="button"
                          className={'kot3-font-chip ' + (statusCreatorFont === f.key ? 'active' : '')}
                          onClick={() => setStatusCreatorFont(f.key)}
                          style={{ fontFamily: f.family }}
                        >{lang === 'ht' ? (f.key === 'modern' ? 'Modèn' : f.key === 'bold' ? 'Fò' : 'Jwè') : (f.key.charAt(0).toUpperCase() + f.key.slice(1))}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {statusCreatorTab === 'photo' && (
                <div className="kot3-photo-tab-body">
                  <div className="kot3-photo-tab-preview">
                    {statusCreatorImage ? (
                      <img src={statusCreatorImage} alt="status preview" />
                    ) : (
                      <>
                        <i className="fas fa-camera"></i>
                        <div style={{ fontSize: '12px', textAlign: 'center' }}>{lang === 'ht' ? 'Pataje yon foto ak zanmi w.' : 'Share a photo with your friends.'}</div>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: 'var(--primary-color)', color: 'white', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}>
                          <i className="fas fa-image"></i>
                          <span>{lang === 'ht' ? 'Chwazi foto' : 'Choose photo'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) handleStatusImageUpload(f); }}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  {statusCreatorImage && (
                    <button
                      type="button"
                      className="btn-cancel"
                      style={{ padding: '8px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', border: 'none', fontSize: '12px', cursor: 'pointer' }}
                      onClick={() => setStatusCreatorImage('')}
                    >{lang === 'ht' ? 'Retire foto' : 'Remove photo'}</button>
                  )}
                </div>
              )}

              <div className="kot3-creator-actions">
                <button
                  className="btn-cancel"
                  onClick={() => { setIsEditingStatus(false); setStatusCreatorText(''); setStatusCreatorImage(''); setStatusCreatorTab('text'); }}
                >{lang === 'ht' ? 'Anile' : 'Cancel'}</button>
                <button
                  className="btn-publish"
                  disabled={!statusCreatorText.trim() && !statusCreatorImage}
                  onClick={publishMyStatus}
                >{lang === 'ht' ? 'Pataje' : 'Share Story'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 5. CALLING OVERLAY MODAL */}
      {activeCall.isOpen && (
        <div className="kot3-call-modal">
          <div className="kot3-call-info">
              {(activeCall.type === 'video' || activeCall.status === 'Connected') && (
                <div className="kot3-call-video-grid">
                  <video ref={remoteVideoRef} autoPlay playsInline className="kot3-call-remote-video" />
                  <video ref={localVideoRef} autoPlay playsInline muted className="kot3-call-local-video" />
                </div>
              )}
              <div className="kot3-call-avatar-wrapper">
                <div className="kot3-call-pulse"></div>
              {activeContactAvatar ? (
                <img
                  className="kot3-call-avatar"
                  src={activeContactAvatar}
                  alt=""
                />
              ) : (
                <div className="kot3-call-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', fontWeight: 700 }}>
                  {(activeCall.username || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              </div>
            <h2 className="kot3-call-name">@{activeCall.username}</h2>
            <div className="kot3-call-status-label">
              <i className="fas fa-phone-volume"></i>
              <span>
                {activeCall.status === 'Ringing...' ? (lang === 'ht' ? 'Ap rele...' : 'Ringing...') : ''}
                {activeCall.status === 'Incoming' ? (lang === 'ht' ? 'Apèl k ap antre...' : 'Incoming call...') : ''}
                {activeCall.status === 'Connected' ? (
                  `${lang === 'ht' ? 'Konekte' : 'Connected'} (${String(Math.floor(activeCall.duration / 60)).padStart(2, '0')}:${String(activeCall.duration % 60).padStart(2, '0')})`
                ) : ''}
              </span>
            </div>
          </div>

          <div className="kot3-call-controls">
            {activeCall.status === 'Incoming' ? (
              <>
                <button className="kot3-call-ctrl-btn accept" onClick={acceptIncomingCall} title={lang === 'ht' ? 'Reponn' : 'Answer'} style={{ backgroundColor: '#25d366' }}>
                  <i className="fas fa-phone"></i>
                </button>
                <button className="kot3-call-ctrl-btn decline" onClick={declineIncomingCall} title={lang === 'ht' ? 'Refize' : 'Decline'}>
                  <i className="fas fa-phone-slash"></i>
                </button>
              </>
            ) : (
              <>
                <button className="kot3-call-ctrl-btn" title="Koupe mikwo" onClick={(e) => e.currentTarget.classList.toggle('muted')}>
                  <i className="fas fa-microphone"></i>
                </button>
                <button className="kot3-call-ctrl-btn" title="Koupe kamera" onClick={(e) => e.currentTarget.classList.toggle('muted')}>
                  <i className="fas fa-video"></i>
                </button>
                <button className="kot3-call-ctrl-btn decline" onClick={hangUpActiveCall} title="Hang up">
                  <i className="fas fa-phone-slash"></i>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 6. CONTACT PROFILE OVERLAY */}
      {isContactPanelOpen && activeThread && activeContact && (
        <div className="kot3-contact-panel-backdrop" onClick={() => setIsContactPanelOpen(false)}>
          <div className="kot3-contact-panel" onClick={(e) => e.stopPropagation()}>
            <div className="kot3-contact-panel-header">
              <button className="kot3-back-btn" onClick={() => setIsContactPanelOpen(false)} title={lang === 'ht' ? 'Fèmen' : 'Close'}>
                <i className="fas fa-chevron-left"></i>
              </button>
              <span>{lang === 'ht' ? 'Pwofil kontak' : 'Contact profile'}</span>
              <button className="kot3-action-btn" onClick={() => { setIsContactPanelOpen(false); setIsMoreMenuOpen(true); }} title={lang === 'ht' ? 'Plis' : 'More'}>
                <i className="fas fa-ellipsis-vertical"></i>
              </button>
            </div>

            <div className="kot3-contact-panel-hero">
              <div className="kot3-contact-panel-avatar-wrap">
                {activeContactStories.length > 0 && <div className="kot3-contact-panel-ring"></div>}
                <img src={activeContactAvatar} alt="" className="kot3-contact-panel-avatar" />
                {activeContactIsOnline && <div className="kot3-online-badge"></div>}
              </div>
              <h3>@{activeContact.username}</h3>
              {activeContactName && activeContactName !== activeContact.username && <p>{activeContactName}</p>}
              <div className={`kot3-contact-panel-status ${activeContactIsOnline ? 'online' : ''}`}>
                <i className="fas fa-circle"></i>
                <span>{activeContactIsOnline ? (lang === 'ht' ? 'Sou liy kounye a' : 'Online now') : (lang === 'ht' ? 'Pa sou liy' : 'Offline')}</span>
              </div>
            </div>

            <div className="kot3-contact-quick-actions">
              <button onClick={() => setActiveTab('chats')}>
                <i className="fas fa-message"></i>
                <span>{lang === 'ht' ? 'Mesaj' : 'Message'}</span>
              </button>
              <button onClick={() => startCallingUser(activeContact?.id, 'audio')}>
                <i className="fas fa-phone"></i>
                <span>{lang === 'ht' ? 'Odyo' : 'Audio'}</span>
              </button>
              <button onClick={() => startCallingUser(activeContact?.id, 'video')}>
                <i className="fas fa-video"></i>
                <span>{lang === 'ht' ? 'Videyo' : 'Video'}</span>
              </button>
              <button
                disabled={activeContactStories.length === 0}
                onClick={() => {
                  setIsContactPanelOpen(false);
                  openStatusViewer(activeContact.id);
                }}
              >
                <i className="fas fa-circle-notch"></i>
                <span>Status</span>
              </button>
            </div>

            <div className="kot3-contact-detail-list">
              <div>
                <i className="fas fa-comments"></i>
                <span>{messages.filter(m => !deletedMsgIds.includes(m.id)).length} {lang === 'ht' ? 'mesaj nan chat sa a' : 'messages in this chat'}</span>
              </div>
              <div>
                <i className="fas fa-circle-notch"></i>
                <span>{activeContactStories.length > 0 ? `${activeContactStories.length} ${lang === 'ht' ? 'status aktif' : 'active statuses'}` : (lang === 'ht' ? 'Pa gen status' : 'No status yet')}</span>
              </div>
              <div>
                <i className="fas fa-wifi"></i>
                <span>{wsConnected ? (lang === 'ht' ? 'Realtime konekte' : 'Realtime connected') : (lang === 'ht' ? 'Realtime ap rekonekte' : 'Realtime reconnecting')}</span>
              </div>
              {activeContactStories.length > 0 && (
                <div className="kot3-contact-stories-list">
                  {activeContactStories.slice().reverse().map((story, idx) => (
                    <button key={story.id || idx} type="button" onClick={() => openStatusViewer(activeContact.id)} className="kot3-contact-story-pill">
                      <i className="fas fa-circle-notch"></i>
                      <span>{story.type === 'text' ? (story.content || '').slice(0, 24) : (lang === 'ht' ? 'Imaj status' : 'Status image')}</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => loadMessages(activeThread.id)}>
                <i className="fas fa-rotate-right"></i>
                <span>{lang === 'ht' ? 'Rafrechi mesaj yo' : 'Refresh messages'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Kot3Chat;
