import React, { useState, useEffect, useRef } from 'react';
import { aiService, liveRoomService } from '../services/api';

// AI calls are proxied through the Django backend (aiService). The Gemini API
// key never leaves the server. See backend/api/views/ai.py + backend/.env
// (GEMINI_API_KEY). If the server isn't configured, aiService.generate() returns
// 501 and the AI helpers catch it with a user-friendly toast.


const LiveClassroom = ({ lang, translations, user, showToast, onActiveRoomChange }) => {
  const t = translations[lang] || translations['ht'];
  
  const [activeRoom, setActiveRoom] = useState(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  
  // Custom room states
  const [roomNameInput, setRoomNameInput] = useState('');
  const [isRoomHost, setIsRoomHost] = useState(false);

  // Audio / Video control toggles
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isRemoteVideoActive, setIsRemoteVideoActive] = useState(false);

  // Participants list and WebRTC state
  const [participants, setParticipants] = useState({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [hostChannel, setHostChannel] = useState(null);
  const [myChannelName, setMyChannelName] = useState(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'participants' | 'ai'

  // Student guest speak permissions
  const [isSpeakGranted, setIsSpeakGranted] = useState(false);
  const [isGuestSpeaking, setIsGuestSpeaking] = useState(false);
  const [guestVideoEnabled, setGuestVideoEnabled] = useState(false);
  const [guestAudioEnabled, setGuestAudioEnabled] = useState(true);
  const [isRequestPending, setIsRequestPending] = useState(false);

  // DevRose AI Live Classroom States
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiQuiz, setAiQuiz] = useState(null);
  const [selectedQuizOption, setSelectedQuizOption] = useState(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizVerdict, setQuizVerdict] = useState('');
  const [recentRooms, setRecentRooms] = useState([]);
  const [activeRooms, setActiveRooms] = useState([]);
  const [roomSyncing, setRoomSyncing] = useState(false);
  const [hostAccessCode, setHostAccessCode] = useState('');
  const [roomLookupMessage, setRoomLookupMessage] = useState('');
  const [roomTheme, setRoomTheme] = useState('neon');
  const [pinnedMessage, setPinnedMessage] = useState('');
  const [composerMode, setComposerMode] = useState('text');
  const [chatNotice, setChatNotice] = useState('');
  const [floatingReactions, setFloatingReactions] = useState([]); // Live floating emoji reactions (TikTok/IG style)
  const [isChatOpen, setIsChatOpen] = useState(false); // Side chat panel visibility (closed by default so video is not covered)
  const [participantManagerOpen, setParticipantManagerOpen] = useState(false); // Floating manager sheet for one participant
  const [selectedParticipantForManage, setSelectedParticipantForManage] = useState(null); // [channel, participant] being managed
  const [chatPopups, setChatPopups] = useState([]); // Floating ephemeral comment popups (avatar + message bubble); opacity is intentionally translucent so live shows through

  const wsRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // { channel_name: RTCPeerConnection }
  const localVideoRef = useRef(null);
  const chatEndRef = useRef(null);
  const pendingRoomRef = useRef(null);
  const hasProcessedInitialRoomRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const manualLeaveRef = useRef(false);
  const roomRoleRef = useRef(false);
  const pendingAutoStartRef = useRef(null);
  const bodyOverflowOriginal = useRef(null); // cache body overflow for clean restore on rapid room switches
  const lastRoomKey = 'devrose_live_last_room';
  const lastRoomHostKey = 'devrose_live_last_room_is_host';

  // Auto-join if room param is in URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      hasProcessedInitialRoomRef.current = true;
      setIsRoomHost(false); // Joining via link makes them a participant
      enterClassroom(roomParam);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    liveRoomService.getRecent().then(res => setRecentRooms(res.data || [])).catch(() => {});
    liveRoomService.getActive().then(res => setActiveRooms(res.data || [])).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user || hasProcessedInitialRoomRef.current) return;
    const savedHostKey = localStorage.getItem('devrose_live_last_host_key');
    if (savedHostKey) {
      liveRoomService.restore({ private_host_key: savedHostKey })
        .then(res => {
          if (res.data?.room_id && !activeRoom) {
            hasProcessedInitialRoomRef.current = true;
            setIsRoomHost(true);
            setRoomTheme(res.data.theme || 'neon');
            setPinnedMessage(res.data.pinned_message || '');
            enterClassroom(res.data.public_code || res.data.room_id, true);
            if (res.data.is_active) {
              setTimeout(() => {
                startStreaming(res.data.mode !== 'audio');
              }, 700);
            }
          }
        })
        .catch(() => {});
    }
  }, [user, activeRoom]);

  useEffect(() => {
    if (activeRoom && isRoomHost) {
      roomRoleRef.current = true;
      const hostKey = `devrose_live_host_${activeRoom}`;
      let code = localStorage.getItem(hostKey);
      if (!code) {
        code = `host-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
        localStorage.setItem(hostKey, code);
      }
      localStorage.setItem('devrose_live_last_host_key', code);
      setHostAccessCode(code);
    } else {
      if (!activeRoom) {
        roomRoleRef.current = false;
        setHostAccessCode('');
      }
    }
  }, [activeRoom, isRoomHost]);

  
const AVATAR_COLORS = ['#e91e63', '#9c27b0', '#3f51b5', '#009688', '#ff5722', '#607d8b', '#795548'];
const getParticipantColor = (userId) => {
  const id = typeof userId === 'number' ? userId : 0;
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
};
const getParticipantInitials = (username) => {
  if (!username) return '?';
  const cleaned = String(username).trim().slice(0, 2).toUpperCase();
  return cleaned || '?';
};

const themePalette = {
    neon: {
      name: 'Neon Pulse',
      shell: 'linear-gradient(180deg, rgba(18, 19, 28, 0.98), rgba(28, 29, 42, 0.96))',
      accent: '#e91e63'
    },
    aurora: {
      name: 'Aurora',
      shell: 'linear-gradient(180deg, rgba(6, 14, 26, 0.98), rgba(7, 32, 46, 0.96))',
      accent: '#00d4ff'
    },
    ember: {
      name: 'Ember',
      shell: 'linear-gradient(180deg, rgba(28, 10, 12, 0.98), rgba(42, 18, 10, 0.96))',
      accent: '#ff8f00'
    }
  };

  useEffect(() => {
    if (activeRoom) {
      localStorage.setItem(lastRoomKey, activeRoom);
      localStorage.setItem(lastRoomHostKey, String(roomRoleRef.current || isRoomHost));
    }
  }, [activeRoom, isRoomHost]);

  useEffect(() => {
    if (!activeRoom) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') !== activeRoom) {
      url.searchParams.set('room', activeRoom);
      window.history.replaceState({}, '', url.toString());
    }
  }, [activeRoom]);

  useEffect(() => {
    return () => {
      disconnectClassroom();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [chatMessages, activeTab]);

  useEffect(() => {
    if (!activeRoom) return;
    // Cache the body's ORIGINAL overflow only on the first mount of the
    // fullscreen stage. If a user flips activeRoom on -> off -> on -> off
    // fast, the second cleanup would have stomped a previously captured
    // '' value (since hidden is now the live value), permanently locking
    // the page scroll. Capturing once-and-only-when-original fixes that.
    if (bodyOverflowOriginal.current === null) {
      bodyOverflowOriginal.current = {
        x: window.getComputedStyle(document.body).overflowX,
        y: window.getComputedStyle(document.body).overflowY
      };
    }
    document.body.style.overflowX = 'hidden';
    document.body.style.overflowY = 'hidden';
    return () => {
      if (bodyOverflowOriginal.current) {
        document.body.style.overflowX = bodyOverflowOriginal.current.x;
        document.body.style.overflowY = bodyOverflowOriginal.current.y;
      }
    };
  }, [activeRoom]);

  const createPeerConnection = (peerChannel) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWsMessage({
          type: 'signal',
          target: peerChannel,
          signal: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track from:', peerChannel);
      const remoteStream = event.streams[0];
      setRemoteStreams(prev => ({
        ...prev,
        [peerChannel]: remoteStream
      }));
    };

    return pc;
  };

  const attachLocalStreamToPeer = async (peerChannel) => {
    if (!localStreamRef.current) return;

    let pc = peerConnectionsRef.current[peerChannel];
    if (!pc) {
      pc = createPeerConnection(peerChannel);
      peerConnectionsRef.current[peerChannel] = pc;
    }

    const senders = pc.getSenders();
    localStreamRef.current.getTracks().forEach(track => {
      if (!senders.some(sender => sender.track === track)) {
        pc.addTrack(track, localStreamRef.current);
      }
    });

    const offer = await pc.createOffer({
      offerToReceiveVideo: false,
      offerToReceiveAudio: false,
      iceRestart: false
    });

    // Modify SDP for ultra-low latency (~3s like TikTok Live)
    let sdp = offer.sdp;
    if (sdp) {
      // Set max bitrate and keyframe interval for low latency
      const targetBitrate = 2000000; // 2 Mbps for 720p
      sdp = sdp.replace(
        /a=fmtp:(\d+) /g,
        `a=fmtp:$1 x-google-start-bitrate=${Math.floor(targetBitrate / 1000)},x-google-min-bitrate=${Math.floor(targetBitrate / 2000)},x-google-max-bitrate=${targetBitrate}; `
      );
      // Add rid for simulcast and low latency
      if (!sdp.includes('a=rid:')) {
        sdp = sdp.replace(
          /a=mid:([0-9]+)/g,
          'a=rid:$1 low\r\na=rep fmt:$1*'
        );
      }
      offer.sdp = sdp;
    }

    await pc.setLocalDescription(offer);
    sendWsMessage({
      type: 'signal',
      target: peerChannel,
      signal: { sdp: pc.localDescription }
    });
  };

  const renegotiateAllPeers = async () => {
    const peerIds = Object.keys(participants).filter(ch => ch !== myChannelName);
    await Promise.all(peerIds.map(peerChannel => attachLocalStreamToPeer(peerChannel)));
  };

  const upsertParticipant = (prev, channelName, userInfo) => {
    const next = { ...prev };
    const userId = userInfo?.user_id ?? null;

    if (userId !== null) {
      Object.keys(next).forEach(existingChannel => {
        if (existingChannel !== channelName && next[existingChannel]?.user_id === userId) {
          delete next[existingChannel];
          if (peerConnectionsRef.current[existingChannel]) {
            peerConnectionsRef.current[existingChannel].close();
            delete peerConnectionsRef.current[existingChannel];
          }
          if (remoteStreams[existingChannel]) {
            setRemoteStreams(prevStreams => {
              const copy = { ...prevStreams };
              delete copy[existingChannel];
              return copy;
            });
          }
        }
      });
    }

    next[channelName] = {
      ...(next[channelName] || {}),
      ...userInfo,
      isSpeaking: userInfo?.isSpeaking ?? next[channelName]?.isSpeaking ?? false,
      isPermissionRequested: userInfo?.isPermissionRequested ?? next[channelName]?.isPermissionRequested ?? false
    };
    return next;
  };

  const enterClassroom = (roomId, forceHost = null) => {
    // Sanitize room ID
    const sanitizedId = roomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!sanitizedId) return;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    manualLeaveRef.current = false;
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }
    Object.keys(peerConnectionsRef.current).forEach(key => {
      try {
        peerConnectionsRef.current[key].close();
      } catch (e) {}
    });
    peerConnectionsRef.current = {};
    setParticipants({});
    setRemoteStreams({});
    setChatMessages([]);
    setViewerCount(1);
    setIsSpeakGranted(false);
    setIsGuestSpeaking(false);
    setGuestVideoEnabled(false);
    setIsRequestPending(false);

    pendingRoomRef.current = sanitizedId;
    setActiveRoom(sanitizedId);
    if (onActiveRoomChange) {
      onActiveRoomChange(true);
    }
    if (forceHost !== null) {
      setIsRoomHost(forceHost);
    }
    if (forceHost === true) {
      pendingAutoStartRef.current = true;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', sanitizedId);
    window.history.replaceState({}, '', url.toString());
    
    const token = localStorage.getItem('token');
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const socketUrl = `${protocol}${window.location.host}/ws/live/${sanitizedId}/?token=${token}`;
    
    wsRef.current = new WebSocket(socketUrl);

    wsRef.current.onopen = () => {
      console.log('Connected to Classroom WebSocket.');
      pendingRoomRef.current = null;
      reconnectAttemptRef.current = 0;
      syncRoomState(sanitizedId, { is_active: true, mode: isBroadcasting ? 'video' : 'audio' });
      if (showToast) showToast(lang === 'ht' ? 'Ou konekte nan klas la!' : 'Connected to live class!', 'check-circle');
      if (pendingAutoStartRef.current && forceHost === true) {
        pendingAutoStartRef.current = null;
        setTimeout(() => startStreaming(true), 400);
      }
    };

    wsRef.current.onclose = () => {
      // Exponential backoff with jitter (max 30s), 10 attempts total.
      // Reads role from roomRoleRef instead of the React state captured
      // at onclose time so the reconnect keeps the same role on rapid
      // tight reconnections. ~3 minutes of cumulative retry budget.
      if (manualLeaveRef.current) return;
      if (reconnectAttemptRef.current >= 10) return;
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      const baseDelay = Math.min(30000, Math.pow(2, attempt) * 700);
      const jitter = Math.floor(Math.random() * 500);
      const delay = baseDelay + jitter;
      reconnectTimerRef.current = setTimeout(() => {
        enterClassroom(activeRoom, roomRoleRef.current);
      }, delay);
    };

    wsRef.current.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      switch (data.type) {
        case 'welcome':
          console.log('Connected as channel:', data.channel_name);
          setMyChannelName(data.channel_name);
          if (isRoomHost) {
            setHostChannel(data.channel_name);
          }
          // Set participants
          const initialParticipants = {};
          let foundHost = null;
          if (data.active_peers) {
            Object.keys(data.active_peers).forEach(ch => {
              initialParticipants[ch] = {
                ...data.active_peers[ch],
                isSpeaking: false,
                isPermissionRequested: false
              };
              if (data.active_peers[ch].is_staff) {
                foundHost = ch;
              }
            });
          }
          setParticipants(initialParticipants);
          if (foundHost) {
            setHostChannel(foundHost);
          }
          break;
        case 'viewer_count':
          setViewerCount(data.count);
          break;
        case 'peer_joined':
          const joiningChannel = data.sender_channel_name;
          setParticipants(prev => upsertParticipant(prev, joiningChannel, { ...data.user, isSpeaking: false, isPermissionRequested: false }));
          if (data.user.is_staff) {
            setHostChannel(joiningChannel);
          }

          if (showToast) showToast(`${data.user.username} ${lang === 'ht' ? 'antre nan klas la' : 'joined the class'}`, 'user-plus');
          
          // If we are currently broadcasting (host or guest), initiate WebRTC offer
          if (localStreamRef.current) {
            await attachLocalStreamToPeer(joiningChannel);
          }
          break;
        case 'duplicate_session':
          if (showToast) showToast(lang === 'ht' ? 'Nou ranplase ansyen koneksyon an.' : 'Replacing the old connection.', 'sync-alt');
          break;
        case 'session_replaced':
          if (showToast) showToast(lang === 'ht' ? 'Sesyon an rekonekte.' : 'Session reconnected.', 'sync-alt');
          break;
        case 'peer_left':
          const leavingCh = data.sender_channel_name;
          if (peerConnectionsRef.current[leavingCh]) {
            peerConnectionsRef.current[leavingCh].close();
            delete peerConnectionsRef.current[leavingCh];
          }
          setParticipants(prev => {
            const copy = { ...prev };
            delete copy[leavingCh];
            return copy;
          });
          setRemoteStreams(prev => {
            const copy = { ...prev };
            delete copy[leavingCh];
            return copy;
          });
          if (leavingCh === hostChannel) {
            setHostChannel(null);
          }
          break;
        case 'signal':
          await handleIncomingSignal(data.sender_channel_name, data.signal);
          break;
        case 'chat':
          // If a peer sends a quick-reaction emoji, also spawn a floating
          // animation locally so it feels like a real live broadcast.
          if (typeof data.message === 'string' && QUICK_REACTIONS.includes(data.message.trim())) {
            spawnFloatingReaction(data.message.trim());
          }
          // Always spawn a transparent comment popup with the speaker's
          // avatar too, so we can see WHO reacted/commented without
          // blocking the live.
          if (typeof data.message === 'string' && data.message.trim()) {
            spawnChatPopup({
              username: data.username || 'anon',
              message: data.message,
              userId: data.user_id ?? null,
              isLocal: data.username === (user && user.username)
            });
          }
          setChatMessages(prev => [...prev, {
            username: data.username,
            message: data.message
          }]);
          break;
        case 'video_status':
        case 'video_status_broadcast':
          setIsRemoteVideoActive(data.enabled);
          break;
        
        // Custom message handlers
        case 'invite_speak_request':
          setIsSpeakGranted(true);
          if (showToast) showToast(lang === 'ht' ? 'Pwofesè a envite w pale!' : 'Teacher invited you to speak!', 'microphone');
          break;
        case 'grant_speak_permission':
          setIsSpeakGranted(true);
          setIsRequestPending(false);
          if (showToast) showToast(lang === 'ht' ? 'Aksè pou w pale aksepte!' : 'Speaking access granted!', 'check-circle');
          break;
        case 'revoke_speak_permission':
          setIsSpeakGranted(false);
          setIsRequestPending(false);
          stopSpeaking();
          if (showToast) showToast(lang === 'ht' ? 'Aksè pou w pale anile.' : 'Speaking access revoked.', 'exclamation-triangle');
          break;
        case 'request_speak':
          setParticipants(prev => {
            if (!prev[data.sender_channel_name]) return prev;
            return {
              ...prev,
              [data.sender_channel_name]: {
                ...prev[data.sender_channel_name],
                isPermissionRequested: true
              }
            };
          });
          if (isRoomHost && showToast) {
            showToast(`${data.username} ${lang === 'ht' ? 'vle pale' : 'wants to speak'}`, 'hand-paper');
          }
          break;
        case 'speaking_status':
          const speakingCh = data.sender_channel_name;
          setParticipants(prev => {
            if (!prev[speakingCh]) return prev;
            return {
              ...prev,
              [speakingCh]: {
                ...prev[speakingCh],
                isSpeaking: data.speaking,
                hasVideo: data.hasVideo
              }
            };
          });
          if (!data.speaking) {
            setRemoteStreams(prev => {
              const copy = { ...prev };
              delete copy[speakingCh];
              return copy;
            });
          }
          break;
        default:
          break;
      }
    };
  };

  const resolveRoom = async (roomCode) => {
    const sanitizedCode = roomCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!sanitizedCode) return null;
    try {
      const res = await liveRoomService.resolve({ public_code: sanitizedCode });
      return res.data;
    } catch (e) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!roomNameInput.trim()) return;
    setIsRoomHost(true); // Creator is the host
    enterClassroom(roomNameInput, true);
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!roomNameInput.trim()) return;
    setRoomLookupMessage('');
    resolveRoom(roomNameInput)
      .then(room => {
        if (!room) {
          setRoomLookupMessage(lang === 'ht' ? 'Room sa a pa egziste.' : 'This room does not exist.');
          if (showToast) showToast(lang === 'ht' ? 'Room sa a pa egziste.' : 'This room does not exist.', 'exclamation-triangle');
          return;
        }
        setIsRoomHost(false);
        enterClassroom(room.public_code || room.room_id, false);
      })
      .catch(() => {
        setRoomLookupMessage(lang === 'ht' ? 'Pa t ka verifye room lan.' : 'Could not verify the room.');
      });
  };

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${activeRoom}&view=live`;
    navigator.clipboard.writeText(inviteUrl)
      .then(() => {
        if (showToast) showToast(lang === 'ht' ? 'Lyen kopye nan clipboard!' : 'Invite link copied to clipboard!', 'copy');
      })
      .catch(err => {
        console.error('Failed to copy link', err);
      });
  };

  const syncRoomState = async (roomId, extra = {}) => {
    if (!user || !roomId || roomSyncing) return;
    setRoomSyncing(true);
    try {
      const hostKey = localStorage.getItem(`devrose_live_host_${roomId}`) || localStorage.getItem('devrose_live_last_host_key') || '';
      const payload = {
        room_id: roomId,
        public_code: roomId,
        private_host_key: hostKey,
        title: roomId.replace(/-/g, ' '),
        theme: roomTheme,
        pinned_message: pinnedMessage,
        last_url: `${window.location.origin}${window.location.pathname}?room=${roomId}&view=live`,
        share_url: `${window.location.origin}${window.location.pathname}?room=${roomId}&view=live`,
        participant_count: Object.keys(participants || {}).length || 1,
        ...extra
      };
      const res = await liveRoomService.sync(payload);
      setRecentRooms(prev => {
        const next = [res.data, ...prev.filter(r => r.room_id !== res.data.room_id)];
        return next.slice(0, 12);
      });
      if (payload.is_active) {
        setActiveRooms(prev => {
          const next = [res.data, ...prev.filter(r => r.room_id !== res.data.room_id)];
          return next.slice(0, 20);
        });
      }
    } catch (e) {
      console.error('Room sync failed', e);
    } finally {
      setRoomSyncing(false);
    }
  };

  useEffect(() => {
    if (!activeRoom) return;
    syncRoomState(activeRoom, {
      is_active: isBroadcasting || isRoomHost,
      mode: isBroadcasting ? 'video' : 'audio'
    });
  }, [participants, isBroadcasting, activeRoom, isRoomHost]);

  const reconnectLastRoom = () => {
    const savedRoom = localStorage.getItem(lastRoomKey);
    if (!savedRoom) return;
    const savedHost = localStorage.getItem(lastRoomHostKey) === 'true';
    if (savedHost) {
      liveRoomService.restore({ private_host_key: localStorage.getItem('devrose_live_last_host_key') || '' })
        .then(res => {
          if (res.data?.room_id) {
            setIsRoomHost(true);
            setRoomTheme(res.data.theme || 'neon');
            setPinnedMessage(res.data.pinned_message || '');
            enterClassroom(res.data.public_code || res.data.room_id, true);
            if (res.data.is_active) {
              setTimeout(() => {
                startStreaming(res.data.mode !== 'audio');
              }, 600);
            }
          }
        })
        .catch(() => {});
    } else {
      resolveRoom(savedRoom).then(room => {
        if (room) enterClassroom(room.public_code || room.room_id, false);
      });
    }
  };

  const applyTheme = async (themeKey) => {
    setRoomTheme(themeKey);
    setChatNotice(`Theme set to ${themePalette[themeKey]?.name || themeKey}`);
    if (activeRoom) {
      await syncRoomState(activeRoom, { theme: themeKey, pinned_message: pinnedMessage });
    }
  };

  const pinAnnouncement = async () => {
    const text = (chatInput || '').trim();
    if (!text) {
      setChatNotice(lang === 'ht' ? 'Tape yon mesaj pou pin li.' : 'Type a message to pin it.');
      return;
    }
    setPinnedMessage(text);
    setChatInput('');
    setChatNotice(lang === 'ht' ? 'Mesaj la pin.' : 'Message pinned.');
    if (activeRoom) {
      await syncRoomState(activeRoom, { theme: roomTheme, pinned_message: text });
    }
  };

  const clearLastRoom = () => {
    localStorage.removeItem(lastRoomKey);
    localStorage.removeItem(lastRoomHostKey);
    localStorage.removeItem('devrose_live_last_host_key');
  };

  const restoreHostSession = async () => {
    const savedHostKey = localStorage.getItem('devrose_live_last_host_key');
    if (!savedHostKey) {
      setRoomLookupMessage(lang === 'ht' ? 'Pa gen sesyon host ki sove.' : 'No saved host session.');
      return;
    }
    try {
      const res = await liveRoomService.restore({ private_host_key: savedHostKey });
      if (!res.data?.room_id) {
        setRoomLookupMessage(lang === 'ht' ? 'Pa gen room host pou reprann.' : 'No host room to restore.');
        return;
      }
      setRoomLookupMessage('');
      hasProcessedInitialRoomRef.current = true;
      setIsRoomHost(true);
      enterClassroom(res.data.public_code || res.data.room_id, true);
      if (res.data.is_active) {
        setTimeout(() => startStreaming(res.data.mode !== 'audio'), 800);
      }
    } catch (e) {
      setRoomLookupMessage(lang === 'ht' ? 'Pa t ka retabli sesyon host la.' : 'Could not restore host session.');
    }
  };

  const sanitizedRoomIdFromState = () => activeRoom || pendingRoomRef.current || '';

  const startStreaming = async (withVideo) => {
    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
          latency: 0.016
        },
        video: withVideo ? {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, max: 30 },
          latencyMode: 'low'
        } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setIsBroadcasting(true);
      setVideoEnabled(withVideo);
      setIsRemoteVideoActive(withVideo);

      // Build offers for everyone already in the room and everyone who joins later.
      await renegotiateAllPeers();
      await syncRoomState(sanitizedRoomIdFromState() || activeRoom, { is_active: true, mode: withVideo ? 'video' : 'audio' });

      sendWsMessage({ type: 'chat_message', message: `[HOST STARTED LIVE SESSION (${withVideo ? 'VIDEO + AUDIO' : 'AUDIO ONLY'})]` });
      
      setTimeout(() => {
        sendWsMessage({ type: 'video_status_broadcast', enabled: withVideo });
      }, 500);

      if (showToast) showToast(
        withVideo 
          ? (lang === 'ht' ? 'Klas videyo an dirèk kòmanse!' : 'Live video stream started!')
          : (lang === 'ht' ? 'Klas odyo an dirèk kòmanse!' : 'Live audio stream started!'),
        withVideo ? 'video' : 'microphone'
      );
    } catch (err) {
      if (showToast) showToast(lang === 'ht' ? 'Tanpri pèmèt aksè mikwofòn ak kamera pou w ka fè klas la.' : 'Please allow camera and microphone access to stream.', 'exclamation-triangle');
      console.error(err);
    }
  };

  const handleIncomingSignal = async (senderChannelName, signal) => {
    let pc = peerConnectionsRef.current[senderChannelName];

    if (!pc) {
      pc = createPeerConnection(senderChannelName);
      peerConnectionsRef.current[senderChannelName] = pc;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }
    }

    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        if (localStreamRef.current) {
          const senders = pc.getSenders();
          localStreamRef.current.getTracks().forEach(track => {
            if (!senders.some(s => s.track === track)) {
              pc.addTrack(track, localStreamRef.current);
            }
          });
        }
        const answer = await pc.createAnswer({
          offerToReceiveVideo: true,
          offerToReceiveAudio: true
        });
        await pc.setLocalDescription(answer);
        sendWsMessage({
          type: 'signal',
          target: senderChannelName,
          signal: { sdp: pc.localDescription }
        });
      }
    } else if (signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
        if (showToast) showToast(audioTrack.enabled ? 'Mikwofòn limen' : 'Mikwofòn koupe', audioTrack.enabled ? 'microphone' : 'microphone-slash');
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
        setIsRemoteVideoActive(videoTrack.enabled);
        sendWsMessage({ type: 'video_status_broadcast', enabled: videoTrack.enabled });
        if (showToast) showToast(videoTrack.enabled ? 'Kamera limen' : 'Kamera koupe', videoTrack.enabled ? 'video' : 'video-slash');
      } else {
        startVideoDynamically();
      }
    }
  };

  const startVideoDynamically = async () => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = newStream.getVideoTracks()[0];
      if (videoTrack && localStreamRef.current) {
        localStreamRef.current.addTrack(videoTrack);
        setVideoEnabled(true);
        setIsRemoteVideoActive(true);

        await renegotiateAllPeers();

        sendWsMessage({ type: 'video_status_broadcast', enabled: true });
      }
    } catch (e) {
      console.log('Error adding video track dynamically', e);
    }
  };

  const stopBroadcasting = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setIsBroadcasting(false);
    setVideoEnabled(false);
    setIsRemoteVideoActive(false);

    // Stop tracks on all peer connections
    Object.keys(peerConnectionsRef.current).forEach(key => {
      const pc = peerConnectionsRef.current[key];
      const senders = pc.getSenders();
      senders.forEach(sender => {
        try {
          pc.removeTrack(sender);
        } catch (err) {
          console.log('error removing track during stop broadcasting', err);
        }
      });
      // renegotiate
      pc.createOffer().then(async offer => {
        await pc.setLocalDescription(offer);
        sendWsMessage({
          type: 'signal',
          target: key,
          signal: { sdp: pc.localDescription }
        });
      }).catch(e => console.log('renegotiate error on stop broadcasting', e));
    });

    sendWsMessage({ type: 'chat_message', message: `[HOST ENDED LIVE SESSION]` });
    sendWsMessage({ type: 'video_status_broadcast', enabled: false });

    if (showToast) showToast(lang === 'ht' ? 'Live la fini!' : 'Live broadcast ended!', 'video-slash');
  };

  const requestToSpeak = () => {
    sendWsMessage({
      type: 'request_speak',
      username: user.username
    });
    setIsRequestPending(true);
    if (showToast) showToast(lang === 'ht' ? 'Demann voye bay pwofesè a!' : 'Request sent to the teacher!', 'paper-plane');
  };

  const grantSpeakPermission = (studentChannelName) => {
    sendWsMessage({
      type: 'grant_speak_permission',
      target: studentChannelName
    });
    setParticipants(prev => ({
      ...prev,
      [studentChannelName]: {
        ...prev[studentChannelName],
        isSpeakGranted: true,
        isPermissionRequested: false
      }
    }));
  };

  const revokeSpeakPermission = (studentChannelName) => {
    sendWsMessage({
      type: 'revoke_speak_permission',
      target: studentChannelName
    });
    setParticipants(prev => ({
      ...prev,
      [studentChannelName]: {
        ...prev[studentChannelName],
        isSpeakGranted: false,
        isSpeaking: false
      }
    }));
  };

  const startSpeaking = async (withVideo) => {
    try {
      const constraints = { audio: true, video: withVideo };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setIsGuestSpeaking(true);
      setGuestVideoEnabled(withVideo);

      // Add tracks to existing peer connections
      for (const ch of Object.keys(peerConnectionsRef.current)) {
        const pc = peerConnectionsRef.current[ch];
        const senders = pc.getSenders();
        stream.getTracks().forEach(track => {
          if (!senders.some(s => s.track === track)) {
            pc.addTrack(track, stream);
          }
        });

        // Renegotiate
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWsMessage({
          type: 'signal',
          target: ch,
          signal: { sdp: pc.localDescription }
        });
      }

      // If we don't have peer connections with some participants, create them
      for (const ch of Object.keys(participants)) {
        if (ch !== myChannelName && !peerConnectionsRef.current[ch]) {
          const pc = createPeerConnection(ch);
          peerConnectionsRef.current[ch] = pc;
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
          });
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendWsMessage({
            type: 'signal',
            target: ch,
            signal: { sdp: pc.localDescription }
          });
        }
      }

      sendWsMessage({
        type: 'speaking_status',
        speaking: true,
        hasVideo: withVideo,
        username: user.username
      });

      if (showToast) showToast(lang === 'ht' ? 'Ou kòmanse pale!' : 'You are now speaking!', 'microphone');
    } catch (err) {
      console.error(err);
      if (showToast) showToast(lang === 'ht' ? 'Echwe jwenn aksè nan kamera/mikwofòn' : 'Failed to access camera/microphone', 'exclamation-triangle');
    }
  };

  const stopSpeaking = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setIsGuestSpeaking(false);
    setGuestVideoEnabled(false);

    for (const ch of Object.keys(peerConnectionsRef.current)) {
      const pc = peerConnectionsRef.current[ch];
      const senders = pc.getSenders();
      senders.forEach(sender => {
        pc.removeTrack(sender);
      });
      pc.createOffer().then(async offer => {
        await pc.setLocalDescription(offer);
        sendWsMessage({
          type: 'signal',
          target: ch,
          signal: { sdp: pc.localDescription }
        });
      }).catch(e => console.log('renegotiate error on stop speaking', e));
    }

    sendWsMessage({
      type: 'speaking_status',
      speaking: false,
      username: user.username
    });

    if (showToast) showToast(lang === 'ht' ? 'Ou sispann pale' : 'You stopped speaking', 'microphone-slash');
  };

  const toggleGuestAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setGuestAudioEnabled(audioTrack.enabled);
        if (showToast) showToast(audioTrack.enabled ? 'Mikwofòn limen' : 'Mikwofòn koupe', audioTrack.enabled ? 'microphone' : 'microphone-slash');
      }
    }
  };

  const toggleGuestVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setGuestVideoEnabled(videoTrack.enabled);
        
        // Broadcast video status update
        sendWsMessage({
          type: 'speaking_status',
          speaking: true,
          hasVideo: videoTrack.enabled,
          username: user.username
        });
        
        if (showToast) showToast(videoTrack.enabled ? 'Kamera limen' : 'Kamera koupe', videoTrack.enabled ? 'video' : 'video-slash');
      } else {
        startGuestVideoDynamically();
      }
    }
  };

  const startGuestVideoDynamically = async () => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = newStream.getVideoTracks()[0];
      if (videoTrack && localStreamRef.current) {
        localStreamRef.current.addTrack(videoTrack);
        setGuestVideoEnabled(true);

        await renegotiateAllPeers();

        sendWsMessage({
          type: 'speaking_status',
          speaking: true,
          hasVideo: true,
          username: user.username
        });
      }
    } catch (e) {
      console.log('Error adding guest video track dynamically', e);
    }
  };

  const sendWsMessage = (msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const sendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const textToSend = chatInput;
    sendWsMessage({
      type: 'chat_message',
      message: textToSend
    });
    if (textToSend.trim()) {
      if (QUICK_REACTIONS.includes(textToSend.trim())) {
        spawnFloatingReaction(textToSend.trim());
      }
      spawnChatPopup({
        username: (user && user.username) || 'me',
        message: textToSend,
        userId: (user && (user.id || user.user_id)) || null,
        isLocal: true
      });
    }
    setChatInput('');
  };

  const QUICK_REACTIONS = ['🔥', '👏', '😂', '💜', '⚡'];

    // Spawn a transient chat-comment popup at bottom-right with low opacity.
  // Each popup carries the author avatar (initials + color), username and bubble.
  // Hard cap at 5 active popups to keep the DOM lightweight.
  const spawnChatPopup = (data) => {
    if (!data || !data.message || !data.message.trim()) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const color = data.isLocal ? "#e91e63" : getParticipantColor(data.userId);
    const initial = getParticipantInitials(data.isLocal ? (user && user.username) : data.username);
    setChatPopups(function (prev) {
      const trimmed = prev.length > 4 ? prev.slice(-4) : prev;
      const next = trimmed.slice();
      next.push({ id: id, username: data.username || "anon", message: data.message, color: color, initial: initial, isLocal: !!data.isLocal });
      return next;
    });
    setTimeout(function () {
      setChatPopups(function (prev) { return prev.filter(function (p) { return p.id !== id; }); });
    }, 4200);
  };
// Spawn a floating emoji reaction that animates upward and fades out.
  // Bounded to 15 active emojis (hard cap) to keep the DOM lightweight even
  // under peer spam.
  const spawnFloatingReaction = (emoji) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const offset = Math.floor(Math.random() * 80) - 40; // -40px..+40px X jitter
    const uid = (user?.id ?? user?.user_id ?? 'me').toString();
    setFloatingReactions(prev => {
      // Hard cap to 14 existing + 1 new = 15 max in the DOM at any time.
      // Local self-emojis get one extra slot relative to peers via the
      // -1 slice on `mine` to keep visual focus on the sender.
      const fromOthers = prev.filter(r => r.ownerId !== uid);
      const mine = prev.filter(r => r.ownerId === uid);
      const trimmedOthers = fromOthers.slice(-13);
      const trimmedMine = mine.slice(-1);
      return [...trimmedOthers, ...trimmedMine, { id, emoji, offset, ownerId: uid }];
    });
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id));
    }, 2600);
  };

  const sendReaction = (emoji) => {
    sendWsMessage({
      type: 'chat_message',
      message: `${emoji}`,
    });
    spawnFloatingReaction(emoji);
    setChatNotice(lang === 'ht' ? 'Reyaksyon voye.' : 'Reaction sent.');
  };

  const disconnectClassroom = () => {
    manualLeaveRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.keys(peerConnectionsRef.current).forEach(key => {
      peerConnectionsRef.current[key].close();
    });
    peerConnectionsRef.current = {};

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setActiveRoom(null);
    if (onActiveRoomChange) {
      onActiveRoomChange(false);
    }
    setIsBroadcasting(false);
    setChatMessages([]);
    setFloatingReactions([]);
    setChatPopups([]);
    setIsChatOpen(false);
    setViewerCount(1);
    setAudioEnabled(true);
    setVideoEnabled(true);
    setIsRemoteVideoActive(false);
    setIsRoomHost(false);

    // Reset our states
    setParticipants({});
    setRemoteStreams({});
    setHostChannel(null);
    setMyChannelName(null);
    setIsSpeakGranted(false);
    setIsGuestSpeaking(false);
    setGuestVideoEnabled(false);
    setIsRequestPending(false);
    pendingRoomRef.current = null;
    syncRoomState(activeRoom, { is_active: false, mode: isBroadcasting ? 'video' : 'audio' });
    roomRoleRef.current = roomRoleRef.current || isRoomHost;
  };

  const leaveRoom = () => {
    if (isRoomHost) {
      // Non-blocking flow: broadcast a goodbye message so other viewers
      // see the host has intentionally ended the session and skip the
      // browser-blocking window.confirm.
      if (showToast) showToast(
        lang === 'ht'
          ? 'Sesyon an ap sispann kounye a...'
          : 'Ending the live session...',
        'exclamation-triangle'
      );
      try { sendWsMessage({ type: 'chat_message', message: lang === 'ht' ? '[Sesyon an fini — mèt la soti.]' : '[Session ended — host has left.]' }); } catch (_) {}
    }
    disconnectClassroom();
  };

  const askAiCopilot = async (e) => {
    e.preventDefault();
    if (!aiQuestion.trim() || isAiThinking) return;

    setIsAiThinking(true);
    setAiAnswer('');
    
    const context = `You are DevRose AI, the intelligent Copilot for the live classroom "${activeRoom}" at DevRose Academy.
    The host of this classroom is staff.
    Answer the user's question about the topic of this room.
    Keep your answer concise, engaging, and professional. Use bullet points if necessary.
    Respond in Haitian Creole (lang: 'ht') if the student asks in Creole, otherwise match their language.`;

    try {
      const res = await aiService.generate({
        prompt: `Current chat messages for context: ${JSON.stringify(chatMessages)}\n\nQuestion: ${aiQuestion}`,
        system_instruction: context,
        model: 'gemini-1.5-flash',
      });
      setAiAnswer(res.data.text);
    } catch (err) {
      console.error(err);
      setAiAnswer(lang === 'ht' ? "Erè nan koneksyon ak AI." : "Error communicating with AI.");
    } finally {
      setIsAiThinking(false);
    }
  };

  const generateLiveSummary = async () => {
    if (isAiThinking) return;
    setIsAiThinking(true);
    setAiSummary('');

    const context = `You are DevRose AI. Generate a concise, bulleted summary of this live classroom session based on the room name "${activeRoom}" and the chat log.
    If the chat log is empty, explain what this class topic usually covers and summarize the prerequisites.
    Format your response beautifully using markdown. Keep it under 150 words.
    Respond in ${lang === 'ht' ? 'Haitian Creole' : 'English'}.`;

    try {
      const res = await aiService.generate({
        prompt: `Chat log: ${JSON.stringify(chatMessages)}`,
        system_instruction: context,
        model: 'gemini-1.5-flash',
      });
      setAiSummary(res.data.text);
    } catch (err) {
      console.error(err);
      setAiSummary(lang === 'ht' ? "Erè nan jenerasyon rezime a." : "Error generating summary.");
    } finally {
      setIsAiThinking(false);
    }
  };

  const generateAiQuiz = async () => {
    if (isAiThinking) return;
    setIsAiThinking(true);
    setAiQuiz(null);
    setSelectedQuizOption(null);
    setQuizSubmitted(false);
    setQuizVerdict('');

    const prompt = `You are DevRose AI. Generate a single multiple-choice question for a live quiz inside a classroom about "${activeRoom}".
    The question must have exactly 3 options.
    Format the output as a clean JSON object with fields:
    "question": "the question text",
    "options": ["option A", "option B", "option C"],
    "answer": "the exact string of the correct option matching one in the options list"
    Do not wrap the JSON in markdown code blocks like \`\`\`json. Just return raw JSON.
    Language: ${lang === 'ht' ? 'Haitian Creole' : 'English'}.`;

    try {
      const res = await aiService.generate({
        prompt,
        system_instruction: context,
        model: 'gemini-1.5-flash',
      });
      const text = (res.data.text || '').trim();
      
      const cleanedJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanedJson);
      setAiQuiz(parsed);
    } catch (err) {
      console.error(err);
      if (showToast) showToast(lang === 'ht' ? "Echwe jenerasyon tès la." : "Failed to generate quiz.", 'exclamation-triangle');
    } finally {
      setIsAiThinking(false);
    }
  };

  const submitQuizAnswer = () => {
    if (!aiQuiz || !selectedQuizOption) return;
    setQuizSubmitted(true);
    if (selectedQuizOption === aiQuiz.answer) {
      setQuizVerdict(lang === 'ht' ? "🎉 Kòrèk! Bravo!" : "🎉 Correct! Well done!");
    } else {
      setQuizVerdict((lang === 'ht' ? "❌ Pa kòrèk. Repons la se: " : "❌ Incorrect. The answer is: ") + aiQuiz.answer);
    }
  };

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }} className="fade-in-up">
        <i className="fas fa-lock" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '20px' }}></i>
        <h3>Seksyon sa a pwoteje</h3>
        <p>{lang === 'ht' ? 'Ou dwe konekte pou w ka antre nan klas an dirèk la.' : 'You must log in to join the live classroom.'}</p>
      </div>
    );
  }

  const savedRoom = localStorage.getItem(lastRoomKey);
  const savedRoomWasHost = localStorage.getItem(lastRoomHostKey) === 'true';
  const speakingGuestChannel = Object.keys(participants).find(ch => participants[ch]?.isSpeaking);
  const speakingGuest = speakingGuestChannel ? participants[speakingGuestChannel] : null;
  const guestStream = speakingGuestChannel ? remoteStreams[speakingGuestChannel] : null;
  const hostStream = hostChannel ? remoteStreams[hostChannel] : null;
  const activeViewerStream = hostStream || (speakingGuest?.hasVideo ? guestStream : null);
  const isReconnecting = !!wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING;
  const isStreamLive = isRoomHost ? isBroadcasting : Boolean(activeViewerStream);
  const roomStatus = isReconnecting
    ? (lang === 'ht' ? 'Rekonekte...' : 'Reconnecting...')
    : isStreamLive
      ? (lang === 'ht' ? 'Live' : 'Live')
      : (isRoomHost
        ? (lang === 'ht' ? 'Room ouvè' : 'Room open')
        : (lang === 'ht' ? 'Poz' : 'Paused'));
  const uniqueParticipants = Object.entries(participants).reduce((acc, entry) => {
    const [channelName, participant] = entry;
    if (!acc.some(([, existing]) => (existing?.user_id ?? null) === (participant?.user_id ?? null))) {
      acc.push([channelName, participant]);
    }
    return acc;
  }, []);
  const audienceMembers = uniqueParticipants.filter(([ch, p]) => ch !== myChannelName && !p?.is_staff);
  const activeTheme = themePalette[roomTheme] || themePalette.neon;
  const liveBackdrop = activeTheme.shell;

  return (
    <div id="live-classroom-container" className="fade-in-up live-classroom-shell" style={{ width: '100%', minWidth: 0 }}>
      {!activeRoom ? (
        <div className="live-classroom-entry-card" style={{
          width: '100%',
          maxWidth: '1180px',
          padding: '24px',
          background: 'linear-gradient(180deg, rgba(20, 21, 31, 0.98), rgba(14, 15, 22, 0.98))',
          borderRadius: '28px',
          color: 'white',
          boxShadow: '0 18px 60px rgba(0, 0, 0, 0.42)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '15px' }}><i className="fas fa-chalkboard-teacher"></i></div>
          <h2>{t.live_classroom_title}</h2>
          <p style={{ maxWidth: '600px', margin: '0 auto 25px auto', fontSize: '1.15rem', opacity: 0.95, lineHeight: '1.5' }}>
            {lang === 'ht' ? 'Kreye oswa antre nan yon sal klas pèsonalize epi envite moun koute w an dirèk sou WebRTC.' : 'Create or join a custom classroom and invite others to watch/listen to your stream live.'}
          </p>
          
          {/* Custom Room Forms */}
          <div style={{ 
            display: 'flex', 
            gap: '20px', 
            justifyContent: 'center', 
            flexWrap: 'wrap',
            maxWidth: '700px',
            margin: '0 auto'
          }}>
            {savedRoom && (
              <div style={{
                width: '100%',
                marginBottom: '10px',
                padding: '14px 16px',
                borderRadius: '18px',
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap'
              }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 800, color: '#fff' }}>
                    {lang === 'ht' ? 'Nou jwenn dènye room ou a' : 'Last room found'}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.92rem' }}>
                    {savedRoom} {savedRoomWasHost ? (lang === 'ht' ? '(ou te host)' : '(you were host)') : (lang === 'ht' ? '(ou te moun k ap gade)' : '(you were a viewer)')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-action"
                    onClick={reconnectLastRoom}
                    style={{ background: 'white', color: 'var(--pink-primary)', width: 'auto', borderRadius: '30px', fontWeight: 'bold' }}
                  >
                    <i className="fas fa-rotate-right"></i> {lang === 'ht' ? 'Antre ankò' : 'Rejoin'}
                  </button>
                  {savedRoomWasHost && (
                    <button
                      type="button"
                      className="btn-action"
                      onClick={restoreHostSession}
                      style={{ background: 'linear-gradient(135deg, #e91e63, #9c27b0)', color: 'white', width: 'auto', borderRadius: '30px', fontWeight: 'bold' }}
                    >
                      <i className="fas fa-rocket"></i> {lang === 'ht' ? 'Restore Host Session' : 'Restore Host Session'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-action"
                    onClick={clearLastRoom}
                    style={{ background: 'rgba(0,0,0,0.15)', color: 'white', width: 'auto', borderRadius: '30px', fontWeight: 'bold' }}
                  >
                    {lang === 'ht' ? 'Efase memwa' : 'Forget'}
                  </button>
                </div>
              </div>
            )}
            <div style={{
              width: '100%',
              marginBottom: '12px',
              padding: '14px 16px',
              borderRadius: '18px',
              background: 'rgba(0,0,0,0.16)',
              border: '1px solid rgba(255,255,255,0.10)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 800 }}>{lang === 'ht' ? 'Rooms aktif ak resan' : 'Active and recent rooms'}</div>
                  <div style={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.9rem' }}>
                    {lang === 'ht' ? 'Chwazi room ou vle retounen ladan l oswa pataje li.' : 'Pick a room to rejoin or share it.'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-action"
                  onClick={() => {
                    liveRoomService.getRecent().then(res => setRecentRooms(res.data || [])).catch(() => {});
                    liveRoomService.getActive().then(res => setActiveRooms(res.data || [])).catch(() => {});
                  }}
                  style={{ width: 'auto', borderRadius: '999px', background: 'rgba(255,255,255,0.12)', color: 'white' }}
                >
                  <i className="fas fa-rotate"></i> {lang === 'ht' ? 'Rafrechi' : 'Refresh'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '12px' }}>
                {[...activeRooms.slice(0, 3), ...recentRooms.slice(0, 3)]
                  .filter((room, index, arr) => arr.findIndex(r => r.room_id === room.room_id) === index)
                  .slice(0, 6)
                  .map(room => (
                    <button
                      key={room.room_id}
                      type="button"
                      onClick={() => enterClassroom(room.room_id)}
                      style={{
                        textAlign: 'left',
                        padding: '12px 14px',
                        borderRadius: '16px',
                        border: '1px solid rgba(255,255,255,0.10)',
                        background: 'rgba(255,255,255,0.05)',
                        color: 'white',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontWeight: 800, textTransform: 'capitalize' }}>{room.title}</div>
                      <div style={{ fontSize: '0.8rem', color: '#cdd6e6', marginTop: '4px' }}>
                        @{room.public_code || room.room_id} · {room.host_username || 'host'}
                      </div>
                      {isRoomHost && room.private_host_key && (
                        <div style={{ fontSize: '0.74rem', color: '#ffd6e7', marginTop: '4px' }}>
                          {lang === 'ht' ? 'Private key' : 'Private key'}: {room.private_host_key}
                        </div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: room.is_active ? '#7CFC98' : '#ffca28', marginTop: '6px' }}>
                        {room.is_active ? (lang === 'ht' ? 'Aktif' : 'Active') : (lang === 'ht' ? 'Resan' : 'Recent')}
                        {' · '}
                        {room.participant_count || 0} {lang === 'ht' ? 'moun' : 'people'}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
            <form onSubmit={handleCreateRoom} style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="text" 
                placeholder={lang === 'ht' ? 'Eg: python-bootcamp' : 'e.g. math-class'} 
                value={roomNameInput}
                onChange={(e) => setRoomNameInput(e.target.value)}
                required
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '30px', padding: '10px 20px', textAlign: 'center' }}
              />
              <button type="submit" className="btn-action" style={{ background: 'white', color: 'var(--pink-primary)', width: '100%', borderRadius: '30px', fontWeight: 'bold' }}>
                <i className="fas fa-plus-circle"></i> {lang === 'ht' ? 'Kreye Klas' : 'Create & Host'}
              </button>
            </form>

            <form onSubmit={handleJoinRoom} style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="text" 
                placeholder={lang === 'ht' ? 'Mete kòd sal la...' : 'Enter room code...'} 
                value={roomNameInput}
                onChange={(e) => setRoomNameInput(e.target.value)}
                required
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '30px', padding: '10px 20px', textAlign: 'center' }}
              />
              <button type="submit" className="btn-action" style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid white', color: 'white', width: '100%', borderRadius: '30px', fontWeight: 'bold' }}>
                <i className="fas fa-sign-in-alt"></i> {lang === 'ht' ? 'Antre nan Klas' : 'Join Room'}
              </button>
              {roomLookupMessage && (
                <div style={{ color: '#ffcc80', fontSize: '0.95rem', fontWeight: 800, padding: '10px 12px', borderRadius: '12px', background: 'rgba(255, 193, 7, 0.12)', border: '1px solid rgba(255, 193, 7, 0.28)' }}>
                  {roomLookupMessage}
                </div>
              )}
            </form>
          </div>
        </div>
      ) : (
        <div className="live-classroom-stage" style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          background: '#05070b',
        zIndex: 40
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: liveBackdrop,
            opacity: 0.35,
            pointerEvents: 'none'
          }} />
          {/* Active Live Deck */}
            <div className="live-classroom-stage-inner" style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              padding: '16px',
              boxSizing: 'border-box'
            }}>
            <div style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              zIndex: 22,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              maxWidth: 'calc(100vw - 32px)',
              pointerEvents: 'none'
            }}>
              <span style={{
                padding: '7px 11px',
                borderRadius: '999px',
                background: 'rgba(0,0,0,0.48)',
                color: '#fff',
                fontSize: '0.76rem',
                fontWeight: 800,
                backdropFilter: 'blur(12px)'
              }}>
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: isBroadcasting ? '#4caf50' : '#9e9e9e',
                  boxShadow: isBroadcasting ? '0 0 12px #4caf50' : 'none',
                  marginRight: '8px'
                }} />
                {roomStatus}
              </span>
              <span style={{
                padding: '7px 11px',
                borderRadius: '999px',
                background: 'rgba(0,0,0,0.48)',
                color: '#fff',
                fontSize: '0.76rem',
                fontWeight: 800,
                backdropFilter: 'blur(12px)'
              }}>
                {viewerCount} {lang === 'ht' ? 'Sou liy' : 'Online'}
              </span>
            </div>

            {/* Top-right toolbar: chat toggle, leave room. Sits above chat panel (z-35 > z-30). */}
            <div className="live-top-right-toolbar" style={{
              position: 'fixed',
              top: '16px',
              right: '16px',
              zIndex: 35,
              display: 'flex',
              gap: '10px',
              alignItems: 'center'
            }}>
              <button
                type="button"
                onClick={() => setIsChatOpen(prev => !prev)}
                aria-label={lang === 'ht' ? 'Louvri/Fèmen chat la' : 'Toggle chat panel'}
                title={isChatOpen ? (lang === 'ht' ? 'Fèmen chat la' : 'Close chat') : (lang === 'ht' ? 'Louvri chat la' : 'Open chat')}
                aria-pressed={isChatOpen}
                className={`live-toolbar-btn ${isChatOpen ? 'active' : ''}`}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: isChatOpen ? 'rgba(233,30,99,0.92)' : 'rgba(0,0,0,0.62)',
                  color: 'white',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(12px)',
                  border: `1px solid ${isChatOpen ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)'}`,
                  cursor: 'pointer',
                  position: 'relative',
                  boxShadow: '0 10px 24px rgba(0,0,0,0.32)'
                }}
              >
                <i className={`fas ${isChatOpen ? 'fa-comment-slash' : 'fa-comments'}`} style={{ fontSize: '1.1rem' }}></i>
                {chatMessages.length > 0 && !isChatOpen && (
                  <span style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    background: '#ff1744',
                    color: 'white',
                    fontSize: '0.6rem',
                    fontWeight: 800,
                    borderRadius: '999px',
                    minWidth: '18px',
                    height: '18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 5px',
                    border: '2px solid #0a0c12',
                    boxShadow: '0 0 10px rgba(255,23,68,0.5)'
                  }}>
                    {chatMessages.length > 99 ? '99+' : chatMessages.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={leaveRoom}
                aria-label={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}
                title={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}
                className="live-toolbar-btn live-leave-btn"
                style={{
                  minWidth: '44px',
                  height: '44px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, rgba(244,67,54,0.95), rgba(229,57,53,0.92))',
                  color: 'white',
                  padding: '0 16px',
                  gap: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  cursor: 'pointer',
                  boxShadow: '0 10px 24px rgba(244,67,54,0.45), 0 0 0 4px rgba(244,67,54,0.18)',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  letterSpacing: '0.02em'
                }}
              >
                <i className="fas fa-door-open" style={{ fontSize: '1rem' }}></i>
                <span className="live-leave-btn-label" style={{ marginLeft: '4px' }}>
                  {lang === 'ht' ? 'Kite' : 'Leave'}
                </span>
                <i className="fas fa-times live-leave-btn-x" style={{ fontSize: '0.78rem', marginLeft: '6px', opacity: 0.65 }}></i>
              </button>
            </div>

            {/* Video Player Display Container */}
            <div className={`live-classroom-video-surface ${isChatOpen ? 'chat-open' : ''}`} style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              borderRadius: 0,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              boxShadow: 'none',
              background: 'radial-gradient(circle at top, rgba(233,30,99,0.18), rgba(8,9,16,1) 58%)'
            }}>
              {isRoomHost ? (
                // Host's main video: Guest's stream if active, otherwise Host's local camera
                guestStream ? (
                  <video
                    ref={(el) => {
                      if (el && el.srcObject !== guestStream) {
                        el.srcObject = guestStream;
                        el.play().catch(e => console.log('Guest stream play err', e));
                      }
                    }}
                    autoPlay
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  (isBroadcasting && videoEnabled) ? (
                    <video 
                      ref={(el) => {
                        if (el && el.srcObject !== localStreamRef.current) {
                          el.srcObject = localStreamRef.current;
                          el.play().catch(e => console.log('Local stream play err', e));
                        }
                      }}
                      id="classroom-local-video" 
                      autoPlay 
                      muted 
                      playsInline 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#999', padding: '10px' }}>
                      <div style={{
                        width: '5rem',
                        height: '5rem',
                        borderRadius: '50%',
                        border: '3px solid var(--pink-primary)',
                        boxShadow: '0 0 20px rgba(233, 30, 99, 0.4)',
                        margin: '0 auto 1rem auto',
                        animation: isBroadcasting ? 'pulse-live 1.2s ease-in-out infinite alternate' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <i className={isBroadcasting ? 'fas fa-microphone' : 'fas fa-microphone-slash'} style={{ fontSize: '2rem', color: 'var(--pink-primary)' }}></i>
                      </div>
                      {isBroadcasting ? (
                        <p style={{ color: '#4caf50', fontWeight: 'bold' }}>{lang === 'ht' ? 'Odyo sèlman ap emèt...' : 'Audio-only stream broadcasting...'}</p>
                      ) : (
                        <p>{lang === 'ht' ? 'Kamera w la ap parèt la a lè w kòmanse klas la.' : 'Your camera feed will show here once you start the class.'}</p>
                      )}
                    </div>
                  )
                )
              ) : (
                // Student's View: Host stream first, then any active video speaker, otherwise visualizer placeholder
                activeViewerStream ? (
                  <video 
                    ref={(el) => {
                      if (el && el.srcObject !== activeViewerStream) {
                        el.srcObject = activeViewerStream;
                        el.play().catch(e => console.log('Viewer stream play err', e));
                      }
                    }}
                    id="classroom-remote-video" 
                    autoPlay 
                    playsInline 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  // Student Audio-only Visualizer View
                  <div style={{ textAlign: 'center', color: '#999', padding: '10px' }}>
                    <div style={{
                      width: '5rem',
                      height: '5rem',
                      borderRadius: '50%',
                      border: '3px solid var(--pink-primary)',
                      boxShadow: '0 0 20px rgba(233, 30, 99, 0.4)',
                      margin: '0 auto 1rem auto',
                      animation: 'pulse-live 1.2s ease-in-out infinite alternate',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <i className="fas fa-microphone" style={{ fontSize: '2rem', color: 'var(--pink-primary)' }}></i>
                    </div>
                    <p style={{ color: '#4caf50', fontWeight: 'bold' }}>
                      {lang === 'ht' ? 'Klas Odyo an dirèk ap jwe... (Kamera pwofesè a etenn)' : 'Live Audio-only stream playing... (Host camera off)'}
                    </p>
                  </div>
                )
              )}

              {/* Status Badge overlay */}
              {isStreamLive && (
                <div style={{
                  position: 'absolute',
                  top: '15px',
                  left: '15px',
                  background: 'linear-gradient(135deg, #e91e63, #ff7043)',
                  color: 'white',
                  padding: '7px 14px',
                  borderRadius: '999px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  boxShadow: '0 10px 24px rgba(0,0,0,0.24)',
                  zIndex: 5
                }}>
                  {roomStatus}
                </div>
              )}

              {!isRoomHost && activeViewerStream && (
                <div style={{
                  position: 'absolute',
                  top: '15px',
                  right: '15px',
                  padding: '7px 12px',
                  borderRadius: '999px',
                  background: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  border: '1px solid rgba(255,255,255,0.12)',
                  zIndex: 5
                }}>
                  {speakingGuest?.hasVideo
                    ? `${lang === 'ht' ? 'Videyo an dirèk' : 'Live video'} @${speakingGuest?.username}`
                    : (lang === 'ht' ? 'Odyo an dirèk' : 'Live audio')}
                </div>
              )}

              {/* Bottom social overlay */}
              <div style={{
                position: 'absolute',
                left: '20px',
                right: '20px',
                bottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                zIndex: 12,
                pointerEvents: 'none'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap'
                }}>
                  <div style={{
                    padding: '12px 14px',
                    borderRadius: '18px',
                    background: 'rgba(0,0,0,0.45)',
                    color: 'white',
                    maxWidth: '520px',
                    backdropFilter: 'blur(10px)'
                  }}>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ffd6e7', fontWeight: 700 }}>
                      {lang === 'ht' ? 'Live link' : 'Live link'}
                    </div>
                    <div style={{ marginTop: '4px', fontWeight: 700, lineHeight: 1.4 }}>
                      {window.location.origin}{window.location.pathname}?room={activeRoom}&view=live
                    </div>
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                    pointerEvents: 'auto'
                  }}>
                    <button className="btn-action" onClick={copyInviteLink} style={{ width: 'auto', padding: '10px 14px', borderRadius: '999px', background: 'rgba(0,0,0,0.5)', color: 'white' }}>
                      <i className="far fa-copy"></i> {lang === 'ht' ? 'Share' : 'Share'}
                    </button>
                    {isRoomHost && (
                      <button className="btn-action" onClick={toggleVideo} style={{ width: 'auto', padding: '10px 14px', borderRadius: '999px', background: 'rgba(233,30,99,0.85)', color: 'white' }}>
                        <i className={videoEnabled ? 'fas fa-video' : 'fas fa-video-slash'}></i> {videoEnabled ? (lang === 'ht' ? 'Hide Video' : 'Hide Video') : (lang === 'ht' ? 'Show Video' : 'Show Video')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Picture-in-Picture (PIP) floating camera preview */}
              {isRoomHost ? (
                // Host PIP: show host's camera if guest stream is active and host has video enabled
                (guestStream && isBroadcasting && videoEnabled && localStreamRef.current) && (
                  <div className={`pip-overlay ${isChatOpen ? 'pip-chat-open' : ''}`} style={{
                    position: 'absolute',
                    top: '70px',
                    right: '15px',
                    width: '150px',
                    aspectRatio: '16/9',
                    borderRadius: '12px',
                    border: '2px solid var(--pink-primary)',
                    boxShadow: '0 8px 25px rgba(233, 30, 99, 0.4)',
                    overflow: 'hidden',
                    zIndex: 12,
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(5px)'
                  }}>
                    <video
                      ref={(el) => {
                        if (el && el.srcObject !== localStreamRef.current) {
                          el.srcObject = localStreamRef.current;
                          el.play().catch(e => console.log('Host PIP play err', e));
                        }
                      }}
                      autoPlay
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', fontSize: '0.65rem', borderRadius: '3px' }}>
                      {lang === 'ht' ? 'Ou menm' : 'You'}
                    </div>
                  </div>
                )
              ) : (
                // Student PIP:
                // 1. If current student is speaking with video, show their local stream
                // 2. Otherwise, if another student is speaking with video, show that student's remote stream
                (isGuestSpeaking && guestVideoEnabled && localStreamRef.current) ? (
                  <div className={`pip-overlay ${isChatOpen ? 'pip-chat-open' : ''}`} style={{
                    position: 'absolute',
                    top: '70px',
                    right: '15px',
                    width: '150px',
                    aspectRatio: '16/9',
                    borderRadius: '12px',
                    border: '2px solid var(--pink-primary)',
                    boxShadow: '0 8px 25px rgba(233, 30, 99, 0.4)',
                    overflow: 'hidden',
                    zIndex: 12,
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(5px)'
                  }}>
                    <video
                      ref={(el) => {
                        if (el && el.srcObject !== localStreamRef.current) {
                          el.srcObject = localStreamRef.current;
                          el.play().catch(e => console.log('Student local PIP play err', e));
                        }
                      }}
                      autoPlay
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', fontSize: '0.65rem', borderRadius: '3px' }}>
                      {lang === 'ht' ? 'Ou menm' : 'You'}
                    </div>
                  </div>
                ) : (
                  (guestStream && speakingGuest?.hasVideo) && (              <div className={`pip-overlay ${isChatOpen ? 'pip-chat-open' : ''}`} style={{
                    position: 'absolute',
                    top: '70px',
                    right: '15px',
                    width: '150px',
                    aspectRatio: '16/9',
                    borderRadius: '12px',
                    border: '2px solid var(--pink-primary)',
                    boxShadow: '0 8px 25px rgba(233, 30, 99, 0.4)',
                    overflow: 'hidden',
                    zIndex: 12,
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(5px)'
                  }}>
                    <video
                      ref={(el) => {
                        if (el && el.srcObject !== guestStream) {
                          el.srcObject = guestStream;
                          el.play().catch(e => console.log('Remote guest PIP play err', e));
                        }
                      }}
                      autoPlay
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                      <div style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', fontSize: '0.65rem', borderRadius: '3px', textTransform: 'capitalize' }}>
                        @{speakingGuest?.username}
                      </div>
                    </div>
                  )
                )
              )}
            </div>

            {/* Stream Action Controls */}
            <div style={{
              position: 'absolute',
              left: '12px',
              bottom: '12px',
              textAlign: 'center',
              zIndex: 20
            }}>
              {isRoomHost ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
                  {!isBroadcasting ? (
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                      <button className="btn-action" onClick={() => startStreaming(true)} style={{ width: 'auto', padding: '10px 18px', borderRadius: '999px' }}>
                        <i className="fas fa-video"></i> <span>📹 Videyo + Odyo</span>
                      </button>
                      <button className="btn-action" onClick={() => startStreaming(false)} style={{ width: 'auto', padding: '10px 18px', borderRadius: '999px', background: '#3f51b5' }}>
                        <i className="fas fa-microphone"></i> <span>🎤 Odyo Sèlman</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                      <button 
                        onClick={toggleAudio} 
                        style={{
                          background: audioEnabled ? 'rgba(255,255,255,0.1)' : '#e91e63',
                          border: '1px solid rgba(255,255,255,0.2)',
                          color: 'white',
                          width: '2.7rem',
                          height: '2.7rem',
                          borderRadius: '50%',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.1rem',
                          flexShrink: 0
                        }}
                        title={audioEnabled ? 'Mute Mic' : 'Unmute Mic'}
                      >
                        <i className={audioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash'}></i>
                      </button>
                      <button 
                        onClick={toggleVideo} 
                        style={{
                          background: videoEnabled ? 'rgba(255,255,255,0.1)' : '#e91e63',
                          border: '1px solid rgba(255,255,255,0.2)',
                          color: 'white',
                          width: '2.7rem',
                          height: '2.7rem',
                          borderRadius: '50%',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.1rem',
                          flexShrink: 0
                        }}
                        title={videoEnabled ? 'Stop Video' : 'Start Video'}
                      >
                        <i className={videoEnabled ? 'fas fa-video' : 'fas fa-video-slash'}></i>
                      </button>
                      <button 
                        onClick={stopBroadcasting} 
                        style={{
                          background: '#f44336',
                          border: '1px solid rgba(255,255,255,0.2)',
                          color: 'white',
                          width: '2.7rem',
                          height: '2.7rem',
                          borderRadius: '50%',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.1rem',
                          flexShrink: 0
                        }}
                        title={lang === 'ht' ? 'Fèmen Live' : 'End Live'}
                      >
                        <i className="fas fa-stop"></i>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#999', fontSize: '0.95rem' }}>
                  {lang === 'ht' ? 'Ap resevwa odyo ak videyo nan men pwofesè a.' : 'Receiving high-quality video and audio feed from the classroom host.'}
                </div>
              )}
            </div>
          </div>

          {/* Backdrop shown only when chat panel is open (mobile only mostly) */}
          {isChatOpen && (
            <div className="live-chat-backdrop" onClick={() => setIsChatOpen(false)} aria-hidden="true"></div>
          )}

          
                    {/* Floating Chat Comment Popups (TikTok / IG Live style, very translucent) */}
          {chatPopups.length > 0 && (
            <div className="live-comment-popups-layer" aria-live="polite" aria-relevant="additions">
              {chatPopups.map(function (p) {
                return (
                  <div key={p.id} className={p.isLocal ? 'live-comment-popup is-local' : 'live-comment-popup'}>
                    <span className="live-comment-popup-avatar" style={{ background: p.color }} aria-hidden="true">
                      {p.initial}
                    </span>
                    <div className="live-comment-popup-bubble">
                      <span className="live-comment-popup-name">@{p.username}</span>
                      <span className="live-comment-popup-msg">{p.message}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Floating Participant Avatars Strip (Instagram Live style) */}
          {uniqueParticipants.length > 0 && (
            <div className="live-participant-strip" aria-label={lang === 'ht' ? 'Patisipan Live yo' : 'Live participants'}>
              <button
                type="button"
                className="live-participant-strip-fab"
                onClick={() => {
                  setSelectedParticipantForManage(null);
                  setParticipantManagerOpen(true);
                }}
                aria-label={lang === 'ht' ? 'Ouvri manadjè patisipan yo' : 'Open participants manager'}
                title={lang === 'ht' ? 'Wè tout patisipan yo' : 'See all participants'}
              >
                <i className="fas fa-users" style={{ fontSize: '0.95rem' }} />
                <span className="live-participant-strip-count">{uniqueParticipants.length}</span>
              </button>
              <span className="live-participant-strip-online-dot" aria-hidden="true" />
            </div>
          )}

          {/* Participant Manager Backdrop + Sheet (replaces old tab content) */}
          {participantManagerOpen && (
            <>
              <div
                className="live-participants-backdrop"
                onClick={() => setParticipantManagerOpen(false)}
                aria-hidden="true"
              />
              <div
                className="live-participants-manager"
                role="dialog"
                aria-label={lang === 'ht' ? 'Manadjè patisipan yo' : 'Participants manager'}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderBottom: '1px solid rgba(255,255,255,0.08)'
                }}>
                  <h4 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>
                    <i className="fas fa-users" style={{ marginRight: '8px' }} />
                    {lang === 'ht' ? 'Patisipan nan klas la' : 'Participants in class'}
                    <span style={{ marginLeft: '8px', fontSize: '0.78rem', color: '#9aa3b2' }}>({uniqueParticipants.length})</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setParticipantManagerOpen(false)}
                    aria-label={lang === 'ht' ? 'Fèmen manadjè a' : 'Close participants manager'}
                    style={{
                      background: 'rgba(255,255,255,0.08)', color: '#fff',
                      width: '34px', height: '34px', borderRadius: '50%',
                      border: '1px solid rgba(255,255,255,0.18)',
                      cursor: 'pointer', display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    <i className="fas fa-times" style={{ fontSize: '0.85rem' }} />
                  </button>
                </div>
                <div className="live-participants-manager-list">
                  {/* Local user row */}
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    padding: '10px 14px', borderRadius: '14px',
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.10)',
                    margin: '8px'
                  }}>
                    <span style={{
                      width: '38px', height: '38px', borderRadius: '50%',
                      background: '#e91e63', color: '#fff', flexShrink: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: '0.85rem', marginRight: '12px'
                    }}>
                      {getParticipantInitials(user?.username)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 800, fontSize: '0.92rem' }}>
                        @{user?.username} <span style={{ opacity: 0.7, fontWeight: 600 }}>({lang === 'ht' ? 'Ou' : 'You'})</span>
                      </div>
                      <div style={{ color: '#aab1c5', fontSize: '0.72rem' }}>
                        {isRoomHost ? (lang === 'ht' ? 'Pwofesè' : 'Host') : (lang === 'ht' ? 'Elèv' : 'Student')}
                        {isRequestPending ? ' · ' + (lang === 'ht' ? 'Demann ap tann' : 'Request pending') : ''}
                      </div>
                    </div>
                    {isRoomHost && <span className="badge" style={{ background: 'rgba(233,30,99,0.20)', color: '#ffd6e7', padding: '4px 9px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 800 }}>{lang === 'ht' ? 'HOST' : 'HOST'}</span>}
                  </div>
                  {/* Detailed remote-participant cards with management */}
                  {uniqueParticipants.filter(([ch]) => ch !== myChannelName).map(([ch, p]) => {
                    const color = getParticipantColor(p?.user_id);
                    const selected = selectedParticipantForManage && selectedParticipantForManage[0] === ch;
                    const isAudience = !p?.is_staff && ch !== hostChannel;
                    return (
                      <div key={ch} style={{
                        display: 'flex', flexDirection: 'column', gap: '8px',
                        padding: '10px 14px', borderRadius: '14px',
                        background: selected ? 'rgba(233,30,99,0.10)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${selected ? 'rgba(233,30,99,0.45)' : 'rgba(255,255,255,0.06)'}`,
                        margin: '0 8px 8px 8px',
                        transition: 'background 180ms ease, border-color 180ms ease'
                      }} onClick={() => setSelectedParticipantForManage([ch, p])}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{
                            width: '38px', height: '38px', borderRadius: '50%',
                            background: color, color: '#fff', flexShrink: 0,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 800, fontSize: '0.85rem'
                          }}>
                            {getParticipantInitials(p?.username)}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              @{p?.username || 'anon'}
                              {p?.is_staff && <span style={{ marginLeft: '6px', fontSize: '0.65rem', background: 'rgba(233,30,99,0.20)', color: '#ffd6e7', padding: '2px 6px', borderRadius: '999px', fontWeight: 800 }}>{lang === 'ht' ? 'HOST' : 'HOST'}</span>}
                            </div>
                            <div style={{ color: '#aab1c5', fontSize: '0.7rem' }}>
                              {p?.is_staff ? (lang === 'ht' ? 'Pwofesè' : 'Host') : (lang === 'ht' ? 'Elèv' : 'Student')}
                              {p?.isSpeaking ? ' · 🎙️ ' + (lang === 'ht' ? 'ap pale' : 'speaking') : ''}
                              {p?.isPermissionRequested ? ' · ✋ ' + (lang === 'ht' ? 'vle pale' : 'wants to speak') : ''}
                            </div>
                          </div>
                          {isRoomHost && isAudience && (
                            <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                              {p?.isSpeakGranted ? (
                                <button
                                  type="button"
                                  onClick={() => revokeSpeakPermission(ch)}
                                  aria-label={lang === 'ht' ? 'Anile aksè pale' : 'Revoke speaking access'}
                                  style={{
                                    background: 'rgba(244,67,54,0.20)', color: '#ff8a80',
                                    border: '1px solid rgba(244,67,54,0.35)',
                                    borderRadius: '999px', padding: '5px 10px',
                                    fontSize: '0.72rem', fontWeight: 800,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <i className="fas fa-microphone-slash" style={{ marginRight: '4px' }} />
                                  {lang === 'ht' ? 'Anile' : 'Revoke'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => grantSpeakPermission(ch)}
                                  aria-label={lang === 'ht' ? 'Bay aksè pale' : 'Grant speaking access'}
                                  style={{
                                    background: 'linear-gradient(135deg, #4caf50, #2e7d32)', color: '#fff',
                                    border: 'none', borderRadius: '999px', padding: '5px 11px',
                                    fontSize: '0.72rem', fontWeight: 800,
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 10px rgba(76,175,80,0.30)'
                                  }}
                                >
                                  <i className="fas fa-microphone" style={{ marginRight: '4px' }} />
                                  {lang === 'ht' ? 'Bay aksè' : 'Grant'}
                                </button>
                              )}
                              {p?.isSpeaking && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Force-stop this participant's stream via WebRTC renegotiation.
                                    sendWsMessage({ type: 'revoke_speak_permission', target: ch });
                                  }}
                                  aria-label={lang === 'ht' ? 'Fè sispann pale' : 'Force stop speaking'}
                                  style={{
                                    background: 'rgba(244,67,54,0.20)', color: '#ff8a80',
                                    border: '1px solid rgba(244,67,54,0.35)',
                                    borderRadius: '999px', padding: '5px 10px',
                                    fontSize: '0.72rem', fontWeight: 800,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <i className="fas fa-stop" style={{ marginRight: '4px' }} />
                                  {lang === 'ht' ? 'Fè sispann' : 'Force stop'}
                                </button>
                              )}
                            </div>
                          )}
                          {!isRoomHost && ch !== myChannelName && p?.is_staff && (
                            <span className="badge" style={{ background: 'rgba(0,212,255,0.18)', color: '#80deea', padding: '4px 9px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 800 }}>
                              <i className="fas fa-shield-halved" style={{ marginRight: '4px' }} />
                              {lang === 'ht' ? 'Pwofesè' : 'Teacher'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {uniqueParticipants.filter(([ch]) => ch !== myChannelName).length === 0 && (
                    <div style={{ padding: '20px', color: '#9aa3b2', textAlign: 'center', fontSize: '0.9rem' }}>
                      {lang === 'ht' ? 'Poko gen lòt patisipan.' : 'No other participants yet.'}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}


          {/* Live Chat Drawer (slide-in side panel, closed by default) */}
          <div className={`live-chat-panel ${isChatOpen ? 'open' : 'closed'}`} style={{
            background: activeTheme.shell,
            borderColor: 'rgba(255,255,255,0.08)'
          }}>
            {/* Tabs Selector */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'linear-gradient(135deg, rgba(233, 30, 99, 0.12), rgba(255,255,255,0.03))'
            }}>
              <button 
                onClick={() => setActiveTab('chat')}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: activeTab === 'chat' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'chat' ? '3px solid var(--pink-primary)' : 'none',
                  color: activeTab === 'chat' ? 'white' : '#b5bbcc',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.3s ease'
                }}
              >
                <i className="far fa-comments"></i> Chat
              </button>

              <button 
                onClick={() => setActiveTab('ai')}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: activeTab === 'ai' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'ai' ? '3px solid var(--pink-primary)' : 'none',
                  color: activeTab === 'ai' ? 'white' : '#b5bbcc',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.3s ease'
                }}
              >
                <i className="fas fa-robot"></i> DevRose AI
              </button>
            </div>

            {activeTab === 'chat' && (
              <>
                {pinnedMessage && (
                  <div style={{
                    margin: '12px 18px 0 18px',
                    padding: '12px 14px',
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, rgba(233,30,99,0.16), rgba(156,39,176,0.12))',
                    border: `1px solid ${activeTheme.accent}33`,
                    color: 'white'
                  }}>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ffd6e7', fontWeight: 700 }}>
                      {lang === 'ht' ? 'Mesaj pin' : 'Pinned'}
                    </div>
                    <div style={{ marginTop: '4px', fontWeight: 700, lineHeight: 1.4 }}>{pinnedMessage}</div>
                  </div>
                )}
                <div style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}>
                  <h5 style={{ margin: 0, color: '#fff', fontSize: '0.92rem', letterSpacing: '0.01em' }}><i className="fas fa-comment-dots"></i> Klas Chat</h5>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="badge" style={{ background: 'rgba(76,175,80,0.18)', color: '#d7ffd9', border: '1px solid rgba(76,175,80,0.22)', borderRadius: '999px', fontSize: '0.75rem', padding: '5px 10px' }}>
                      👥 {viewerCount} {lang === 'ht' ? 'Elèv' : 'Students'}
                    </span>
                    <span className="badge" style={{ background: `rgba(255,255,255,0.06)`, color: '#fff', border: `1px solid ${activeTheme.accent}55`, borderRadius: '999px', fontSize: '0.72rem', padding: '5px 10px' }}>
                      {themePalette[roomTheme]?.name || 'Neon Pulse'}
                    </span>
                  </div>
                </div>

                {/* Chat Message Box */}
                <div style={{
                  flexGrow: 1,
                  padding: '18px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  scrollBehavior: 'smooth'
                }}>
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      alignSelf: msg.username === user.username ? 'flex-end' : 'flex-start',
                      maxWidth: '88%'
                    }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#ff87b8' }}>@{msg.username}</span>
                      <span style={{
                        background: msg.username === user.username ? 'linear-gradient(135deg, rgba(233,30,99,0.32), rgba(156,39,176,0.24))' : 'rgba(255,255,255,0.05)',
                        padding: '10px 12px',
                        borderRadius: '14px',
                        fontSize: '0.88rem',
                        color: '#f4f7fb',
                        border: '1px solid rgba(255,255,255,0.06)',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
                        lineHeight: 1.45
                      }}>{msg.message}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                  {chatMessages.length === 0 && (
                    <p style={{ color: '#9aa3b2', textAlign: 'center', margin: 'auto', fontSize: '0.9rem', lineHeight: 1.5 }}>
                      Pa gen mesaj nan klas la ankò. Poze premye keksyon an!
                    </p>
                  )}
                </div>

                {/* Live Floating Emoji Reactions Layer (TikTok/IG style) */}
                {floatingReactions.length > 0 && (
                  <div className="live-reactions-layer" style={{
                    position: 'absolute',
                    right: '24px',
                    bottom: '156px',
                    height: '260px',
                    width: '80px',
                    pointerEvents: 'none',
                    zIndex: 25,
                    overflow: 'hidden'
                  }}>
                    {floatingReactions.map(r => (
                      <div
                        key={r.id}
                        className="live-floating-emoji"
                        style={{ right: `${40 + r.offset}px` }}
                      >
                        {r.emoji}
                      </div>
                    ))}
                  </div>
                )}

                {/* Row 1: Quick reactions (emojis only, circular, centered) */}
                <div style={{
                  padding: '10px 16px 4px 16px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255,255,255,0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px'
                }}>
                  <span style={{
                    fontSize: '0.68rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: '#9aa3b2',
                    fontWeight: 700,
                    flexShrink: 0
                  }}>
                    <i className="far fa-smile" style={{ marginRight: '6px' }}></i>
                    {lang === 'ht' ? 'Reyaksyon rapid' : 'Quick react'}
                  </span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {QUICK_REACTIONS.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => sendReaction(emoji)}
                        aria-label={`Send ${emoji} reaction`}
                        className="live-quick-reaction-btn"
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          color: 'white',
                          border: `1px solid ${activeTheme.accent}55`,
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          padding: 0,
                          cursor: 'pointer',
                          fontSize: '1rem',
                          lineHeight: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Row 2: Pin (host) + Input + Send */}
                <form onSubmit={sendChatMessage} style={{
                  padding: '8px 12px 12px 12px',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.02)'
                }}>
                  {isRoomHost && (
                    <button
                      type="button"
                      onClick={pinAnnouncement}
                      title={lang === 'ht' ? 'Pinye mesaj nan chat' : 'Pin announcement in chat'}
                      aria-label={lang === 'ht' ? 'Pinye mesaj' : 'Pin announcement'}
                      className="live-pin-btn"
                      style={{
                        background: `linear-gradient(135deg, ${activeTheme.accent}, #9c27b0)`,
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '38px',
                        height: '38px',
                        cursor: 'pointer',
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 6px 16px rgba(233,30,99,0.35)'
                      }}
                    >
                      <i className="fas fa-thumbtack"></i>
                    </button>
                  )}
                  <input
                    type="text"
                    placeholder={lang === 'ht' ? 'Ekri yon mesaj...' : 'Type a message...'}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="live-chat-input"
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      background: 'rgba(0,0,0,0.28)',
                      color: 'white',
                      border: '1px solid rgba(255,255,255,0.10)',
                      borderRadius: '999px',
                      padding: '10px 16px',
                      outline: 'none',
                      fontSize: '0.9rem'
                    }}
                  />
                  <button
                    type="submit"
                    aria-label="Send message"
                    className="live-chat-send-btn"
                    style={{
                      background: 'linear-gradient(135deg, #e91e63, #9c27b0)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '50%',
                      width: '40px',
                      height: '40px',
                      flexShrink: 0,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 8px 20px rgba(233,30,99,0.35)',
                      opacity: chatInput.trim() ? 1 : 0.55,
                      transition: 'opacity 0.18s ease, transform 0.18s ease'
                    }}
                  >
                    <i className="fas fa-paper-plane" style={{ fontSize: '0.95rem' }}></i>
                  </button>
                </form>
                {chatNotice && (
                  <div style={{
                    width: '100%',
                    padding: '0 16px 10px 16px',
                    color: '#cfd8dc',
                    fontSize: '0.72rem',
                    background: 'rgba(255,255,255,0.02)',
                    borderBottomLeftRadius: '24px',
                    borderBottomRightRadius: '24px'
                  }}>{chatNotice}</div>
                )}
              </>
            )}

            {/* participants-tab-section-removed-by-refactor: replaced by floating participant strip + manager modal below */}
            {false && (
              <div/>
            )}

            {activeTab === 'ai' && (
              // DevRose AI Tab
              <div style={{
                flexGrow: 1,
                padding: '20px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px'
              }}>
                <div style={{
                  paddingBottom: '10px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h5 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fas fa-robot" style={{ color: 'var(--pink-primary)' }}></i> 
                    <span>DevRose AI Copilot</span>
                  </h5>
                </div>

                {/* AI Q&A Form */}
                <form onSubmit={askAiCopilot} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.8rem', color: '#aaa', fontWeight: 'bold' }}>
                    {lang === 'ht' ? 'Poze AI yon keksyon sou klas la:' : 'Ask AI about the class:'}
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="text"
                      placeholder={lang === 'ht' ? 'Eg: Kisa ki React Hooks?' : 'e.g. What is React hooks?'}
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      style={{ flexGrow: 1, background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '30px', padding: '8px 15px', fontSize: '0.85rem' }}
                    />
                    <button type="submit" className="btn-action" style={{ width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                      <i className="fas fa-paper-plane"></i>
                    </button>
                  </div>
                </form>

                {/* AI Answer display */}
                {(aiAnswer || isAiThinking) && (
                  <div style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px',
                    padding: '12px',
                    fontSize: '0.85rem',
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    {isAiThinking && !aiAnswer ? (
                      <span style={{ color: '#aaa' }}><i className="fas fa-spinner fa-spin"></i> {lang === 'ht' ? 'AI ap ekri...' : 'AI is thinking...'}</span>
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap', color: '#e0e0e0' }}>{aiAnswer}</div>
                    )}
                  </div>
                )}

                {/* AI Summary Section */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button 
                    onClick={generateLiveSummary}
                    disabled={isAiThinking}
                    className="btn-action" 
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.1)',
                      color: 'white',
                      borderRadius: '30px',
                      padding: '8px 15px',
                      fontSize: '0.85rem',
                      fontWeight: 'bold',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    🤖 {lang === 'ht' ? 'Jenerè Rezime Klas la' : 'Generate Class Summary'}
                  </button>

                  {aiSummary && (
                    <div style={{
                      background: 'rgba(216, 27, 96, 0.05)',
                      border: '1px solid rgba(216, 27, 96, 0.2)',
                      borderRadius: '10px',
                      padding: '12px',
                      fontSize: '0.85rem',
                      whiteSpace: 'pre-wrap',
                      color: '#eee',
                      maxHeight: '150px',
                      overflowY: 'auto'
                    }}>
                      {aiSummary}
                    </div>
                  )}
                </div>

                {/* AI Live Quiz Section */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button 
                    onClick={generateAiQuiz}
                    disabled={isAiThinking}
                    className="btn-action" 
                    style={{
                      width: '100%',
                      background: 'linear-gradient(45deg, var(--pink-primary), #9c27b0)',
                      color: 'white',
                      borderRadius: '30px',
                      padding: '8px 15px',
                      fontSize: '0.85rem',
                      fontWeight: 'bold',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    🎯 {lang === 'ht' ? 'Tès AI (AI Live Quiz)' : 'Generate AI Live Quiz'}
                  </button>

                  {aiQuiz && (
                    <div style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}>
                      <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'white' }}>{aiQuiz.question}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {aiQuiz.options.map((opt, i) => (
                          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', cursor: 'pointer', color: '#ccc' }}>
                            <input 
                              type="radio" 
                              name="quiz-option" 
                              value={opt} 
                              checked={selectedQuizOption === opt}
                              onChange={() => !quizSubmitted && setSelectedQuizOption(opt)}
                              disabled={quizSubmitted}
                            />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>

                      {!quizSubmitted ? (
                        <button 
                          onClick={submitQuizAnswer}
                          disabled={!selectedQuizOption}
                          className="btn-action"
                          style={{
                            width: 'auto',
                            alignSelf: 'start',
                            padding: '5px 15px',
                            fontSize: '0.75rem',
                            borderRadius: '5px',
                            background: selectedQuizOption ? 'var(--pink-primary)' : 'rgba(255,255,255,0.1)',
                            border: 'none',
                            cursor: selectedQuizOption ? 'pointer' : 'not-allowed'
                          }}
                        >
                          {lang === 'ht' ? 'Voye Repons' : 'Submit Answer'}
                        </button>
                      ) : (
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: selectedQuizOption === aiQuiz.answer ? '#4caf50' : '#ff5722', marginTop: '5px' }}>
                          {quizVerdict}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <style>{`
            @media (max-width: 980px) {
              #live-classroom-container > div[style*="grid-template-columns"] {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default LiveClassroom;
