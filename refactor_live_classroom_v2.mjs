// Second-pass layout fix:
// 1. Hide STATIC avatar pills (only show count FAB) — replace with DYNAMIC
//    comment popups that float up from bottom-right when participant comments.
// 2. Each popup: avatar circle + username + chat bubble, with ~0.65 opacity so
//    the live video shows through.
// 3. Cap to ~5 active popups (older ones get filtered out of state).
// 4. Make leave room button more visible: add a text label next to the X icon.

import fs from 'fs';

const file = 'src/components/LiveClassroom.jsx';
let src = fs.readFileSync(file, 'utf-8');
const log = [];
const L = (m) => { log.push(m); console.log(m); };

// ============================================================
// STEP 1: Add chatPopups state + helper for spawnChatPopup.
// Insert near participantManagerOpen state.
// ============================================================
const stateMarker = "const [selectedParticipantForManage, setSelectedParticipantForManage] = useState(null); // [channel, participant] being managed";
if (!src.includes('chatPopups')) {
  src = src.replace(
    stateMarker,
    stateMarker + "\n  const [chatPopups, setChatPopups] = useState([]); // Floating ephemeral comment popups (avatar + message bubble); opacity ~0.65 so live shows through"
  );
  L('STEP 1: added chatPopups state.');
} else {
  L('STEP 1 already applied.');
}

// ============================================================
// STEP 2: Add spawnChatPopup helper function near spawnFloatingReaction.
// Look for the anchor: "// Spawn a floating emoji reaction that animates upward and fades out."
// ============================================================
const reactionAnchor = "// Spawn a floating emoji reaction that animates upward and fades out.";
if (!src.includes('spawnChatPopup')) {
  const newHelpers = `
  // Spawn a transient chat comment popup that floats up + fades. Each popup
  // is rendered at ~0.65 opacity so the live video shows through. Hard cap
  // at 5 active popups to keep the DOM light.
  const spawnChatPopup = ({ username, message, userId, isLocal }) => {
    const id = \`\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`;
    const color = isLocal ? '#e91e63' : getParticipantColor(userId);
    const initial = getParticipantInitials(isLocal ? user?.username : username);
    setChatPopups(prev => {
      const trimmed = prev.slice(-4); // max 5 with the new one appended
      return [...trimmed, { id, username, message, color, initial, isLocal }];
    });
    setTimeout(() => {
      setChatPopups(prev => prev.filter(p => p.id !== id));
    }, 4200);
  };

`;
  src = src.replace(reactionAnchor, newHelpers + reactionAnchor);
  L('STEP 2: added spawnChatPopup helper.');
} else {
  L('STEP 2 already applied.');
}

// ============================================================
// STEP 3: Wire spawnChatPopup into the chat message handler.
// We modify the `case 'chat':` block to also push a popup (already does
// floating emoji when message is a quick reaction; we add avatar+message popup
// for ANY chat message).
// ============================================================
const chatCaseOld = `        case 'chat':
          // If a peer sends a quick-reaction emoji, also spawn a floating
          // animation locally so it feels like a real live broadcast.
          if (typeof data.message === 'string' && QUICK_REACTIONS.includes(data.message.trim())) {
            spawnFloatingReaction(data.message.trim());
          }
          setChatMessages(prev => [...prev, {
            username: data.username,
            message: data.message
          }]);
          break;`;
const chatCaseNew = `        case 'chat':
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
              isLocal: data.username === user?.username
            });
          }
          setChatMessages(prev => [...prev, {
            username: data.username,
            message: data.message
          }]);
          break;`;
if (src.includes(chatCaseOld)) {
  src = src.replace(chatCaseOld, chatCaseNew);
  L('STEP 3: wired spawnChatPopup into chat handler.');
} else {
  L('STEP 3 SKIPPED: chat case string didn\\'t match exactly.');
}

// ============================================================
// STEP 4: Wire spawnChatPopup into local message send (sendChatMessage)
// so the sender also sees their comment float up.
// ============================================================
const sendChatOld = `  const sendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendWsMessage({
      type: 'chat_message',
      message: chatInput
    });
    setChatInput('');
  };`;
const sendChatNew = `  const sendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const textToSend = chatInput;
    sendWsMessage({
      type: 'chat_message',
      message: textToSend
    });
    // Spawn local popup so the sender sees their comment float up too.
    if (textToSend.trim()) {
      if (QUICK_REACTIONS.includes(textToSend.trim())) {
        spawnFloatingReaction(textToSend.trim());
      }
      spawnChatPopup({
        username: user?.username || 'me',
        message: textToSend,
        userId: user?.id ?? user?.user_id ?? null,
        isLocal: true
      });
    }
    setChatInput('');
  };`;
if (src.includes(sendChatOld)) {
  src = src.replace(sendChatOld, sendChatNew);
  L('STEP 4: wired spawnChatPopup into local sendChatMessage.');
} else {
  L('STEP 4 SKIPPED: sendChatMessage signature didn\\'t match exactly.');
}

// ============================================================
// STEP 5: Replace the static avatar-pills list with a "count only" FAB.
// We strip the `.live-participant-pill` items from the strip LIST and leave
// only the FAB with the count. Find a unique 12-line block.
// ============================================================
const stripListOld = `              <div className="live-participant-strip-list">
                {uniqueParticipants.slice(0, 6).map(([ch, p]) => {
                  const isMe = ch === myChannelName;
                  const initial = isMe ? getParticipantInitials(user?.username) : getParticipantInitials(p?.username);
                  const color = isMe ? '#e91e63' : getParticipantColor(p?.user_id);
                  const speaking = !!p?.isSpeaking;
                  return (
                    <button
                      key={ch}
                      type="button"
                      className={\`live-participant-pill \${speaking ? 'speaking' : ''}\`}
                      style={{ '--avatar-color': color }}
                      onClick={() => {
                        setSelectedParticipantForManage([ch, p]);
                        setParticipantManagerOpen(true);
                      }}
                      aria-label={\`\${p?.username || 'Anon'} \${speaking ? (lang === 'ht' ? 'ap pale' : 'is speaking') : ''}\`}
                      title={\`@\${p?.username || 'anon'}\${speaking ? ' 🎙️' : ''}\`}
                    >
                      <span className="live-participant-pill-initials">{initial}</span>
                      {speaking && <span className="live-participant-pill-live" aria-hidden="true" />}
                    </button>
                  );
                })}
                {uniqueParticipants.length > 6 && (
                  <button
                    type="button"
                    className="live-participant-pill more"
                    onClick={() => {
                      setSelectedParticipantForManage(null);
                      setParticipantManagerOpen(true);
                    }}
                    aria-label={lang === 'ht' ? \`Gwosè patisipan yo: \${uniqueParticipants.length}\` : \`\${uniqueParticipants.length} participants total\`}
                    title={lang === 'ht' ? 'Wè tout patisipan yo' : 'See all participants'}
                  >
                    +\${uniqueParticipants.length - 6}
                  </button>
                )}
              </div>`;
const stripListNew = `              <span
                className="live-participant-strip-online-dot"
                aria-hidden="true"
              />`;

if (src.includes(stripListOld)) {
  src = src.replace(stripListOld, stripListNew);
  L('STEP 5: replaced static pills with single online dot.');
} else {
  L('STEP 5 SKIPPED: strip list block didn\\'t match exactly.');
}

// ============================================================
// STEP 6: Add the new floating comment-popups layer markup, positioned at
// bottom-right of the live video. It should NOT block the live (low opacity,
// anchored to right side so the center of the video is always clear).
// ============================================================
const floatingStripMarker = "{/* Floating Participant Avatars Strip (Instagram Live style) */}";
const popupLayerAddition = `
          {/* === Floating Chat Comment Popups (TikTok IG Live style, low-opacity) === */}
          {chatPopups.length > 0 && (
            <div
              className="live-comment-popups-layer"
              aria-live="polite"
              aria-relevant="additions"
            >
              {chatPopups.map(p => (
                <div
                  key={p.id}
                  className={\`live-comment-popup \${p.isLocal ? 'is-local' : ''}\`}
                >
                  <span
                    className="live-comment-popup-avatar"
                    style={{ background: p.color }}
                    aria-hidden="true"
                  >
                    {p.initial}
                  </span>
                  <div className="live-comment-popup-bubble">
                    <span className="live-comment-popup-name">@{p.username}</span>
                    <span className="live-comment-popup-msg">{p.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

`;

if (src.includes('Floating Chat Comment Popups (TikTok IG Live style')) {
  L('STEP 6 already applied.');
} else {
  src = src.replace(floatingStripMarker, popupLayerAddition + floatingStripMarker);
  L('STEP 6: injected floating comment popups layer.');
}

// ============================================================
// STEP 7: Make leave room button more visible — add a translated label
// next to the X icon (visible on desktop ≥ 768px), mobile stays as icon-only.
// ============================================================
const leaveButtonOld = `              <button
                type="button"
                onClick={leaveRoom}
                aria-label={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}
                title={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}
                className="live-toolbar-btn"
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: 'rgba(244,67,54,0.85)',
                  color: 'white',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  cursor: 'pointer',
                  boxShadow: '0 10px 24px rgba(244,67,54,0.32)'
                }}
              >
                <i className="fas fa-times" style={{ fontSize: '1.15rem' }}></i>
              </button>`;
const leaveButtonNew = `              <button
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
                  padding: '0 18px',
                  gap: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  cursor: 'pointer',
                  boxShadow: '0 10px 24px rgba(244,67,54,0.45), 0 0 0 4px rgba(244,67,54,0.18)',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  letterSpacing: '0.02em'
                }}
              >
                <i className="fas fa-door-open" style={{ fontSize: '1rem' }}></i>
                <span className="live-leave-btn-label" style={{ marginLeft: '6px' }}>
                  {lang === 'ht' ? 'Kite' : 'Leave'}
                </span>
                <i className="fas fa-times live-leave-btn-x" style={{ fontSize: '0.85rem', marginLeft: '6px', opacity: 0.7 }}></i>
              </button>`;

if (src.includes(leaveButtonOld)) {
  src = src.replace(leaveButtonOld, leaveButtonNew);
  L('STEP 7: leave button redesigned with icon + label.');
} else {
  L('STEP 7 SKIPPED: leave button block didn\\'t match exactly.');
}

// ============================================================
// STEP 8: Reset chatPopups in disconnectClassroom.
// ============================================================
const disconnectResetMarker = "setFloatingReactions([]);\\n    setIsChatOpen(false);";
const disconnectResetNew = "setFloatingReactions([]);\\n    setChatPopups([]);\\n    setIsChatOpen(false);";
if (src.includes(disconnectResetMarker) && !src.includes('setChatPopups([])')) {
  src = src.replace(disconnectResetMarker, disconnectResetNew);
  L('STEP 8: reset chatPopups on disconnect.');
} else {
  L('STEP 8 SKIPPED or already applied.');
}

fs.writeFileSync(file, src, 'utf-8');
L('Total log entries: ' + log.length);
console.log(new Date().toISOString());
