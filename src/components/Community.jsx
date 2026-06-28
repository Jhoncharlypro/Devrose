import React, { useState, useEffect, useRef } from 'react';

const Community = ({ lang, translations, user, showToast, onAuthOpen }) => {
  const [status, setStatus] = useState(localStorage.getItem('devrose_status') || 'M ap aprann kode sou DevRose Academy!');
  const [statusTimestamp, setStatusTimestamp] = useState(parseInt(localStorage.getItem('devrose_status_timestamp')) || Date.now());
  const [isPublic, setIsPublic] = useState(localStorage.getItem('devrose_is_public') === 'true');
  const [publicUsers, setPublicUsers] = useState({}); // { channel_name: { username, status, statusTimestamp } }
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  
  // Messenger state: 'lobby' or peer channel name or null (welcome screen)
  const [activeChatId, setActiveChatId] = useState(null); 
  const [privateMessages, setPrivateMessages] = useState({}); // { channel_name: [messages] }
  const [privateInput, setPrivateInput] = useState('');

  // Audio recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Status Edit modal state
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [newStatusInput, setNewStatusInput] = useState(status);

  // Responsive state
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const chatEndRef = useRef(null);

  // Responsive listener
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync status changes
  const updateStatus = (newStatus) => {
    const now = Date.now();
    setStatus(newStatus);
    setStatusTimestamp(now);
    localStorage.setItem('devrose_status', newStatus);
    localStorage.setItem('devrose_status_timestamp', now.toString());

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'presence_update',
        username: user?.username || 'Anonymous',
        status: newStatus,
        statusTimestamp: now,
        isPublic: isPublic
      }));
    }
  };

  // Sync visibility and broadcast presence
  useEffect(() => {
    localStorage.setItem('devrose_is_public', isPublic);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'presence_update',
        username: user?.username || 'Anonymous',
        status: status,
        statusTimestamp: statusTimestamp,
        isPublic: isPublic
      }));
    }
  }, [isPublic]);

  // Clean timers
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-scroll inside active chat window
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, privateMessages, activeChatId]);

  // Initialize WebSocket community room lobby
  useEffect(() => {
    if (!user) return;

    // Read from new JWT key, fall back to legacy DRF Token key during migration.
    const token = localStorage.getItem('access_token') || localStorage.getItem('token');
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const socketUrl = `${protocol}${window.location.host}/ws/live/community/?token=${token}`;

    wsRef.current = new WebSocket(socketUrl);

    wsRef.current.onopen = () => {
      console.log('Connected to Community Chat Lobby');
      wsRef.current.send(JSON.stringify({
        type: 'presence_update',
        username: user.username,
        status: status,
        statusTimestamp: statusTimestamp,
        isPublic: isPublic
      }));
    };

    wsRef.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      switch (data.type) {
        case 'welcome':
          break;
        case 'peer_joined':
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'presence_update',
              username: user.username,
              status: status,
              statusTimestamp: statusTimestamp,
              isPublic: isPublic
            }));
          }
          break;
        case 'peer_left':
          const leavingCh = data.sender_channel_name;
          setPublicUsers(prev => {
            const copy = { ...prev };
            delete copy[leavingCh];
            return copy;
          });
          if (activeChatId === leavingCh) {
            setActiveChatId(null);
            if (showToast) showToast(lang === 'ht' ? 'Zanmi an dekonekte' : 'Friend disconnected', 'exclamation-circle');
          }
          break;
        case 'presence_update':
          const peerCh = data.sender_channel_name;
          if (peerCh === wsRef.current?.channel_name) return; // Skip self

          if (data.isPublic) {
            setPublicUsers(prev => ({
              ...prev,
              [peerCh]: {
                username: data.username,
                status: data.status,
                statusTimestamp: data.statusTimestamp || Date.now()
              }
            }));

            if (data.reply_requested !== false) {
              wsRef.current.send(JSON.stringify({
                type: 'presence_update',
                target: peerCh,
                username: user.username,
                status: status,
                statusTimestamp: statusTimestamp,
                isPublic: isPublic,
                reply_requested: false
              }));
            }
          } else {
            setPublicUsers(prev => {
              const copy = { ...prev };
              delete copy[peerCh];
              return copy;
            });
            if (activeChatId === peerCh) {
              setActiveChatId(null);
            }
          }
          break;
        case 'chat_message':
          setMessages(prev => [...prev, {
            username: data.username,
            message: data.message,
            audio: data.audio,
            sender: data.sender_channel_name
          }]);
          break;
        case 'private_message':
          const senderCh = data.sender_channel_name;
          setPrivateMessages(prev => ({
            ...prev,
            [senderCh]: [...(prev[senderCh] || []), {
              username: data.username,
              message: data.message,
              audio: data.audio,
              isMe: false
            }]
          }));

          if (showToast && activeChatId !== senderCh) {
            showToast(`${lang === 'ht' ? 'Nouvo mesaj nan men' : 'New message from'} @${data.username}`, 'comment');
          }
          break;
        default:
          break;
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [user, status, isPublic, activeChatId]);

  // Audio note recorder functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendAudioMessage(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Mic access error:', err);
      if (showToast) showToast(lang === 'ht' ? 'Echwe pou jwenn mikwofòn' : 'Failed to access microphone', 'microphone-slash');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        const stream = mediaRecorderRef.current.stream;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
      if (showToast) showToast(lang === 'ht' ? 'Mesaj odyo anile' : 'Audio message canceled', 'times');
    }
  };

  const sendAudioMessage = (blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Audio = reader.result;
      if (!wsRef.current) return;

      if (activeChatId && activeChatId !== 'lobby') {
        wsRef.current.send(JSON.stringify({
          type: 'private_message',
          target: activeChatId,
          username: user.username,
          audio: base64Audio
        }));
        setPrivateMessages(prev => ({
          ...prev,
          [activeChatId]: [...(prev[activeChatId] || []), {
            username: user.username,
            audio: base64Audio,
            isMe: true
          }]
        }));
      } else {
        wsRef.current.send(JSON.stringify({
          type: 'chat_message',
          username: user.username,
          audio: base64Audio
        }));
      }
    };
    reader.readAsDataURL(blob);
  };

  const sendPublicMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      type: 'chat_message',
      username: user.username,
      message: chatInput
    }));
    setChatInput('');
  };

  const sendPrivateMessage = (e) => {
    e.preventDefault();
    if (!privateInput.trim() || !activeChatId || activeChatId === 'lobby' || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      type: 'private_message',
      target: activeChatId,
      username: user.username,
      message: privateInput
    }));
    setPrivateMessages(prev => ({
      ...prev,
      [activeChatId]: [...(prev[activeChatId] || []), {
        username: user.username,
        message: privateInput,
        isMe: true
      }]
    }));
    setPrivateInput('');
  };

  if (!user) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '20px',
        textAlign: 'center',
        background: 'var(--pink-bg)'
      }} className="fade-in-up">
        <i className="fas fa-lock" style={{ fontSize: '3.5rem', color: '#ccc', marginBottom: '20px' }}></i>
        <h3 style={{ color: 'white', marginBottom: '10px' }}>{lang === 'ht' ? 'Zòn Chat Pwoteje' : 'Protected Chat Zone'}</h3>
        <p style={{ color: '#aaa', maxWidth: '300px', marginBottom: '20px', fontSize: '0.9rem' }}>
          {lang === 'ht' ? 'Ou dwe konekte pou w ka wè zanmi epi diskite ak yo.' : 'You must log in to view friends and chat.'}
        </p>
        <button 
          className="btn-action" 
          onClick={onAuthOpen} 
          style={{ width: 'auto', padding: '10px 30px', borderRadius: '30px' }}
        >
          {lang === 'ht' ? 'Konekte kounye a' : 'Login Now'}
        </button>
      </div>
    );
  }

  // Filter active statuses (less than 24h old)
  const now = Date.now();
  const activeStatuses = Object.keys(publicUsers)
    .map(ch => ({ channel: ch, ...publicUsers[ch] }))
    .filter(peer => {
      const ts = peer.statusTimestamp ? parseInt(peer.statusTimestamp) : now;
      return now - ts < 24 * 60 * 60 * 1000;
    });

  const activeFriend = activeChatId && activeChatId !== 'lobby' ? publicUsers[activeChatId] : null;

  return (
    <div className="fade-in-up" style={{ height: '100%', width: '100%' }}>
      
      {/* Messenger Container */}
      <div style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        background: 'var(--card-bg, rgba(255, 255, 255, 0.05))',
        border: 'none',
        borderRadius: '0px',
        overflow: 'hidden',
        boxShadow: 'none',
        position: 'relative'
      }}>
        
        {/* SIDEBAR: Rendered on Desktop, or on Mobile ONLY if activeChatId is null */}
        {(!isMobile || activeChatId === null) && (
          <div style={{
            width: isMobile ? '100%' : '320px',
            borderRight: isMobile ? 'none' : '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(0, 0, 0, 0.15)'
          }}>
            
            {/* Header: Title and Visibility Toggle */}
            <div style={{ padding: '20px 20px 10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: '800', fontSize: '1.2rem', color: 'white' }}>Chats</span>
              <button 
                onClick={() => setIsPublic(!isPublic)}
                style={{
                  background: isPublic ? 'rgba(216, 27, 96, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: isPublic ? '1px solid var(--pink-primary)' : '1px solid rgba(255,255,255,0.1)',
                  color: isPublic ? 'var(--pink-primary)' : '#ccc',
                  padding: '5px 12px',
                  borderRadius: '20px',
                  fontSize: '0.72rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: '0.3s'
                }}
              >
                <i className={isPublic ? "fas fa-eye" : "fas fa-eye-slash"}></i> {isPublic ? (lang === 'ht' ? 'Piblik' : 'Public') : (lang === 'ht' ? 'Kache' : 'Hidden')}
              </button>
            </div>

            {/* HORIZONTAL STATUS SECTION (Stories) */}
            <div className="stories-container">
              
              {/* Self Status Bubble */}
              <div 
                onClick={() => {
                  setNewStatusInput(status);
                  setIsEditingStatus(true);
                }}
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  minWidth: '55px'
                }}
              >
                <div style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #e91e63, #9c27b0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '1rem',
                  position: 'relative',
                  border: '2px solid rgba(255, 255, 255, 0.2)'
                }}>
                  {user.username.substring(0, 2).toUpperCase()}
                  <div style={{
                    position: 'absolute',
                    bottom: '-2px',
                    right: '-2px',
                    background: 'var(--pink-primary)',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.65rem',
                    border: '2px solid #1e1e1e'
                  }}>
                    <i className="fas fa-plus"></i>
                  </div>
                </div>
                <span style={{ fontSize: '0.68rem', color: '#ccc', marginTop: '6px', textAlign: 'center', maxWidth: '55px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lang === 'ht' ? 'Status mwen' : 'My Status'}</span>
              </div>

              {/* Active Statuses from public users (<24h) */}
              {activeStatuses.map(peer => (
                <div 
                  key={peer.channel}
                  onClick={() => {
                    setActiveChatId(peer.channel);
                    if (showToast) showToast(`@${peer.username}: "${peer.status}"`, 'info-circle');
                  }}
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    cursor: 'pointer',
                    minWidth: '55px'
                  }}
                >
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    position: 'relative',
                    border: '2px solid var(--pink-primary)',
                    boxShadow: '0 0 8px rgba(216, 27, 96, 0.3)'
                  }}>
                    {peer.username.substring(0, 2).toUpperCase()}
                    <div style={{
                      position: 'absolute',
                      bottom: '0',
                      right: '0',
                      background: '#4caf50',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      border: '2px solid #1e1e1e',
                      boxShadow: '0 0 6px #4caf50'
                    }}></div>
                  </div>
                  <span style={{ fontSize: '0.68rem', color: '#fff', marginTop: '6px', textAlign: 'center', maxWidth: '55px', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{peer.username}</span>
                </div>
              ))}
            </div>

            {/* CONVERSATIONS LIST */}
            <div style={{ flexGrow: 1, overflowY: 'auto', padding: '10px 0' }}>
              
              {/* Group Lobby Chat Room */}
              <div 
                onClick={() => setActiveChatId('lobby')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 20px',
                  cursor: 'pointer',
                  background: activeChatId === 'lobby' ? 'rgba(216, 27, 96, 0.12)' : 'none',
                  borderLeft: activeChatId === 'lobby' ? '4px solid var(--pink-primary)' : '4px solid transparent',
                  transition: '0.2s'
                }}
              >
                <div style={{
                  width: '45px',
                  height: '45px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--pink-primary), #9c27b0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '1.2rem'
                }}>
                  <i className="fas fa-users"></i>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '0.88rem', color: 'white' }}>Sal Kominote (Lobby)</span>
                    <span style={{ fontSize: '0.6rem', background: 'var(--pink-primary)', color: 'white', padding: '1px 5px', borderRadius: '4px', fontWeight: 'bold' }}>GROUP</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '2px', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '200px', whiteSpace: 'nowrap' }}>
                    {messages.length > 0 ? `${messages[messages.length-1].username}: ${messages[messages.length-1].message || '🎙️ Mesaj odyo'}` : (lang === 'ht' ? 'Chat piblik ak tout moun' : 'Public chat lobby')}
                  </span>
                </div>
              </div>

              {/* Online Friends List (Direct Messages) */}
              {Object.keys(publicUsers).map(peerCh => {
                const peer = publicUsers[peerCh];
                const activePMs = privateMessages[peerCh] || [];
                const lastMsg = activePMs.length > 0 ? activePMs[activePMs.length - 1] : null;

                return (
                  <div 
                    key={peerCh}
                    onClick={() => setActiveChatId(peerCh)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 20px',
                      cursor: 'pointer',
                      background: activeChatId === peerCh ? 'rgba(216, 27, 96, 0.12)' : 'none',
                      borderLeft: activeChatId === peerCh ? '4px solid var(--pink-primary)' : '4px solid transparent',
                      transition: '0.2s'
                    }}
                  >
                    <div style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '1rem',
                      position: 'relative',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      {peer.username.substring(0, 2).toUpperCase()}
                      <div style={{
                        position: 'absolute',
                        bottom: '0',
                        right: '0',
                        background: '#4caf50',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        border: '2px solid #1e1e1e'
                      }}></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                      <span style={{ fontWeight: 'bold', fontSize: '0.88rem', color: 'white' }}>@{peer.username}</span>
                      <span style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '2px', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '200px', whiteSpace: 'nowrap' }}>
                        {lastMsg ? (lastMsg.isMe ? 'Ou: ' : '') + (lastMsg.message || '🎙️ Mesaj odyo') : `"${peer.status}"`}
                      </span>
                    </div>
                  </div>
                );
              })}

              {Object.keys(publicUsers).length === 0 && (
                <p style={{ padding: '20px', color: '#999', fontSize: '0.8rem', textAlign: 'center' }}>
                  {lang === 'ht' ? 'Pa gen lòt moun piblik an liy kounye a.' : 'No other public students online right now.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* CHAT PANE: Rendered on Desktop, or on Mobile ONLY if activeChatId is NOT null */}
        {(!isMobile || activeChatId !== null) && (
          <div style={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(0, 0, 0, 0.05)'
          }}>
            
            {activeChatId ? (
              // ACTIVE CHAT SCREEN
              <>
                {/* Header of Chat Pane */}
                <div style={{
                  padding: '15px 20px',
                  borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: 'rgba(0, 0, 0, 0.1)'
                }}>
                  {isMobile && (
                    <button 
                      onClick={() => setActiveChatId(null)}
                      style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.1rem', marginRight: '5px' }}
                    >
                      <i className="fas fa-arrow-left"></i>
                    </button>
                  )}
                  
                  {activeChatId === 'lobby' ? (
                    <>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--pink-primary), #9c27b0)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', color: 'white' }}>
                        <i className="fas fa-users"></i>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 'bold', color: 'white', fontSize: '0.92rem' }}>Sal Kominote (Lobby)</span>
                        <span style={{ fontSize: '0.72rem', color: '#aaa' }}>{lang === 'ht' ? 'Tout elèv yo ansanm' : 'All students together'}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.1)' }}>
                        {activeFriend?.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 'bold', color: 'white', fontSize: '0.92rem' }}>@{activeFriend?.username}</span>
                        <span style={{ fontSize: '0.72rem', color: '#4caf50', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4caf50' }} /> {lang === 'ht' ? 'an liy' : 'online'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Messages Body */}
                <div style={{
                  flexGrow: 1,
                  padding: '20px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  {activeChatId === 'lobby' ? (
                    // LOBBY MESSAGES
                    messages.map((msg, i) => {
                      const isMe = msg.username === user.username;
                      return (
                        <div key={i} style={{
                          alignSelf: isMe ? 'flex-end' : 'flex-start',
                          maxWidth: '70%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isMe ? 'flex-end' : 'flex-start'
                        }}>
                          {!isMe && <span style={{ fontSize: '0.68rem', color: 'var(--pink-primary)', fontWeight: 'bold', marginBottom: '2px' }}>@{msg.username}</span>}
                          <div style={{
                            background: isMe ? 'var(--pink-primary)' : 'rgba(255, 255, 255, 0.08)',
                            color: 'white',
                            padding: '10px 14px',
                            borderRadius: isMe ? '18px 18px 0 18px' : '18px 18px 18px 0',
                            fontSize: '0.85rem',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                          }}>
                            {msg.audio ? (
                              <audio src={msg.audio} controls className="modern-audio-player" />
                            ) : (
                              msg.message
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    // PRIVATE MESSAGES
                    (privateMessages[activeChatId] || []).map((msg, i) => (
                      <div key={i} style={{
                        alignSelf: msg.isMe ? 'flex-end' : 'flex-start',
                        maxWidth: '70%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: msg.isMe ? 'flex-end' : 'flex-start'
                      }}>
                        <div style={{
                          background: msg.isMe ? 'var(--pink-primary)' : 'rgba(255, 255, 255, 0.08)',
                          color: 'white',
                          padding: '10px 14px',
                          borderRadius: msg.isMe ? '18px 18px 0 18px' : '18px 18px 18px 0',
                          fontSize: '0.85rem',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                        }}>
                          {msg.audio ? (
                            <audio src={msg.audio} controls className="modern-audio-player" />
                          ) : (
                            msg.message
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {((activeChatId === 'lobby' ? messages : (privateMessages[activeChatId] || [])).length === 0) && (
                    <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.5 }}>
                      <i className="far fa-comments" style={{ fontSize: '2.5rem', marginBottom: '10px', color: 'var(--pink-primary)' }}></i>
                      <p style={{ fontSize: '0.85rem' }}>{lang === 'ht' ? 'Kòmanse konvèsasyon an!' : 'Start the conversation!'}</p>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Form Input Section */}
                <div style={{ background: 'rgba(0, 0, 0, 0.1)' }}>
                  {activeChatId === 'lobby' ? (
                    // Lobby Chat Form
                    <form onSubmit={sendPublicMessage} style={{
                      padding: '15px 20px',
                      borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      {isRecording ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexGrow: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="pulse-dot" style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff3b30' }}></span>
                            <span style={{ fontSize: '0.85rem', color: '#ff3b30', fontWeight: 'bold' }}>
                              {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: '#aaa', fontStyle: 'italic' }}>
                            {lang === 'ht' ? 'M ap anrejistre odyo...' : 'Recording voice note...'}
                          </span>
                          <button type="button" onClick={cancelRecording} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.2rem', marginLeft: 'auto' }}>
                            <i className="fas fa-trash-alt"></i>
                          </button>
                          <button type="button" onClick={stopRecording} className="btn-action" style={{ width: 'auto', padding: '6px 15px', borderRadius: '30px', background: '#4caf50' }}>
                            <i className="fas fa-paper-plane"></i> {lang === 'ht' ? 'Voye' : 'Send'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button 
                            type="button" 
                            onClick={startRecording}
                            style={{ background: 'none', border: 'none', color: 'var(--pink-primary)', cursor: 'pointer', fontSize: '1.2rem' }}
                            title={lang === 'ht' ? 'Voye mesaj odyo' : 'Send voice message'}
                          >
                            <i className="fas fa-microphone"></i>
                          </button>
                          <input 
                            type="text" 
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder={lang === 'ht' ? 'Ekri yon mesaj nan lobby a...' : 'Type a message in lobby...'}
                            style={{ flexGrow: 1, background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '30px', padding: '8px 15px', fontSize: '0.85rem' }}
                          />
                          <button type="submit" className="btn-action" style={{ width: 'auto', padding: '8px 20px', borderRadius: '30px' }}>
                            Send
                          </button>
                        </>
                      )}
                    </form>
                  ) : (
                    // Private Chat Form
                    <form onSubmit={sendPrivateMessage} style={{
                      padding: '15px 20px',
                      borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      {isRecording ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexGrow: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="pulse-dot" style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff3b30' }}></span>
                            <span style={{ fontSize: '0.85rem', color: '#ff3b30', fontWeight: 'bold' }}>
                              {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: '#aaa', fontStyle: 'italic' }}>
                            {lang === 'ht' ? 'M ap anrejistre odyo...' : 'Recording voice note...'}
                          </span>
                          <button type="button" onClick={cancelRecording} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.2rem', marginLeft: 'auto' }}>
                            <i className="fas fa-trash-alt"></i>
                          </button>
                          <button type="button" onClick={stopRecording} className="btn-action" style={{ width: 'auto', padding: '6px 15px', borderRadius: '30px', background: '#4caf50' }}>
                            <i className="fas fa-paper-plane"></i> {lang === 'ht' ? 'Voye' : 'Send'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button 
                            type="button" 
                            onClick={startRecording}
                            style={{ background: 'none', border: 'none', color: 'var(--pink-primary)', cursor: 'pointer', fontSize: '1.2rem' }}
                            title={lang === 'ht' ? 'Voye mesaj odyo' : 'Send voice message'}
                          >
                            <i className="fas fa-microphone"></i>
                          </button>
                          <input 
                            type="text" 
                            value={privateInput}
                            onChange={(e) => setPrivateInput(e.target.value)}
                            placeholder={lang === 'ht' ? 'Ekri yon mesaj prive...' : 'Type a private message...'}
                            style={{ flexGrow: 1, background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '30px', padding: '8px 15px', fontSize: '0.85rem' }}
                          />
                          <button type="submit" className="btn-action" style={{ width: 'auto', padding: '8px 20px', borderRadius: '30px' }}>
                            Send
                          </button>
                        </>
                      )}
                    </form>
                  )}
                </div>
              </>
            ) : (
              // WELCOME / EMPTY STATE SCREEN
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flexGrow: 1,
                opacity: 0.7
              }}>
                <div style={{
                  width: '100px',
                  height: '100px',
                  borderRadius: '50%',
                  background: 'rgba(216, 27, 96, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '3rem',
                  color: 'var(--pink-primary)',
                  marginBottom: '20px',
                  boxShadow: '0 0 20px rgba(216, 27, 96, 0.15)'
                }}>
                  <i className="fab fa-facebook-messenger"></i>
                </div>
                <h3 style={{ color: 'white' }}>{lang === 'ht' ? 'Messenger DevRose' : 'DevRose Messenger'}</h3>
                <p style={{ fontSize: '0.85rem', color: '#ccc', textAlign: 'center', maxWidth: '300px' }}>
                  {lang === 'ht' ? 'Seleksyone yon konvèsasyon oswa yon zanmi pou kòmanse ekri ak voye mesaj odyo an tan reyèl.' : 'Select a conversation or a friend to start typing and sending real-time voice notes.'}
                </p>
              </div>
            )}
          </div>
        )}

      </div>

      {/* DIALOG: Edit Status Modal */}
      {isEditingStatus && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000,
          backdropFilter: 'blur(5px)'
        }}>
          <div style={{
            background: '#252525',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '20px',
            width: '90%',
            maxWidth: '400px',
            padding: '25px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            animation: 'fadeInUp 0.3s ease-out'
          }}>
            <h4 style={{ margin: '0 0 15px 0', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fas fa-edit" style={{ color: 'var(--pink-primary)' }}></i> {lang === 'ht' ? 'Chanje Status ou' : 'Update your Status'}
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              <label style={{ fontSize: '0.78rem', color: '#aaa' }}>{lang === 'ht' ? 'Kisa k ap pase ete sa a?' : 'What is happening this summer?'}</label>
              <input 
                type="text"
                value={newStatusInput}
                onChange={(e) => setNewStatusInput(e.target.value)}
                maxLength={80}
                style={{
                  background: 'rgba(0,0,0,0.2)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '30px',
                  padding: '10px 20px',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
                placeholder="e.g. M ap kode sou Linux!"
              />
              <span style={{ fontSize: '0.68rem', color: '#888', textAlign: 'right' }}>
                {lang === 'ht' ? 'Estatu an ap dire 24h tan' : 'Status will last 24h'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button 
                type="button" 
                onClick={() => setIsEditingStatus(false)}
                style={{ background: 'rgba(255,255,255,0.05)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '30px', cursor: 'pointer' }}
              >
                {lang === 'ht' ? 'Anile' : 'Cancel'}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  updateStatus(newStatusInput);
                  setIsEditingStatus(false);
                  if (showToast) showToast(lang === 'ht' ? 'Status mete ajou!' : 'Status updated!', 'check-circle');
                }}
                className="btn-action" 
                style={{ width: 'auto', padding: '8px 20px', borderRadius: '30px' }}
              >
                {lang === 'ht' ? 'Sove' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Community;
