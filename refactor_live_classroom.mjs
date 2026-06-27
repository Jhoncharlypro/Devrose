// LiveClassroom layout refactor:
// 1. Slim chat panel from 440 to 360 + new CSS
// 2. Remove participants tab from chat panel (replaced by floating avatar strip + manager modal)
// 3. Add floating avatar pill strip on the live video (Instagram Live style)
// 4. Add click-to-manage participant modal
//
// This script does surgical replacements with verified line ranges.

import fs from 'fs';

const file = 'src/components/LiveClassroom.jsx';
let src = fs.readFileSync(file, 'utf-8');
const lines = src.split('\n');

const log = [];
function L(m) { log.push(m); console.log(m); }

// ============================================================
// STEP 1: Add new state `participantManagerOpen` and `selectedParticipantForManage`
// near isChatOpen state.
// ============================================================
const stateMarker = "const [isChatOpen, setIsChatOpen] = useState(false); // Side chat panel visibility (closed by default so video is not covered)";
const stateReplacement = stateMarker + "\n  const [participantManagerOpen, setParticipantManagerOpen] = useState(false); // Floating manager sheet for one participant\n  const [selectedParticipantForManage, setSelectedParticipantForManage] = useState(null); // [channel, participant] being managed";
if (src.includes(stateReplacement)) {
  L('STEP 1 already applied.');
} else {
  src = src.replace(stateMarker, stateReplacement);
  L('STEP 1: added participant manager state.');
}

// ============================================================
// STEP 2: Add a small helper for participant initials (can sit alongside colorPalette)
// ============================================================
const paletteMarker = "const themePalette = {";
const helperBlock = `
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

`;
if (src.includes('const getParticipantInitials')) {
  L('STEP 2 already applied.');
} else {
  src = src.replace(paletteMarker, helperBlock + paletteMarker);
  L('STEP 2: added avatar helpers.');
}

// ============================================================
// STEP 3: Replace participants tab content with `null` so tab no longer renders.
// We targeted the span from the trigger phrase to the closing paren on 2684.
// Because we know end-line index, we can do a substring replace by line range.
// ============================================================
const updatedLines = src.split('\n');
let startIdx = -1, endIdx = -1;
for (let i = 0; i < updatedLines.length; i++) {
  if (updatedLines[i].includes("{activeTab === 'participants' && (")) {
    startIdx = i;
    break;
  }
}
if (startIdx < 0) { L('STEP 3 ABORT: start marker missing.'); }

// Find matching close '(' balance
{
  let depth = 1;
  for (let i = startIdx + 1; i < updatedLines.length; i++) {
    const s = updatedLines[i];
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (depth === 0) break;
  }
}
if (endIdx < 0) { L('STEP 3 ABORT: end marker missing.'); }

if (startIdx >= 0 && endIdx >= 0 && !src.includes('// participants-tab-section-removed-by-refactor')) {
  // Replace the range of lines (inclusive) with a comment + null
  const replacementLines = [
    "            {/* participants-tab-section-removed-by-refactor: replaced by floating participant strip + manager modal below */}",
    "            {false && (",
    "              <div/>",
    "            )}"
  ];
  updatedLines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines);
  src = updatedLines.join('\n');
  L(`STEP 3: replaced participants tab (was lines ${startIdx + 1}-${endIdx + 1}) with empty stub.`);
}

// ============================================================
// STEP 4: Replace the participants TAB BUTTON in the tabs row with a tiny "open manager" pill
// (or remove it from tabs entirely, since avatar strip already exposes participants).
// Cleaner: remove the participants button and rebalance the row to use flex:1 for chat + AI only.
// ============================================================
const oldParticipantsButton = `              <button 
                onClick={() => setActiveTab('participants')}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: activeTab === 'participants' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'participants' ? '3px solid var(--pink-primary)' : 'none',
                  color: activeTab === 'participants' ? 'white' : '#b5bbcc',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  position: 'relative',
                  transition: 'all 0.3s ease'
                }}
              >
                <i className="fas fa-users"></i> {lang === 'ht' ? 'Patisipan' : 'Participants'}
                {isRoomHost && Object.values(participants).some(p => p.isPermissionRequested) && (
                  <span style={{
                    position: 'absolute',
                    top: '12px',
                    right: '18px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#ff5722',
                    boxShadow: '0 0 8px #ff5722'
                  }} />
                )}
              </button>`;

if (src.includes(oldParticipantsButton)) {
  src = src.replace(oldParticipantsButton, '');
  L('STEP 4: removed participants tab button from tabs row.');
} else {
  L('STEP 4 SKIPPED: participants button string not found verbatim; will skip silently.');
}

// ============================================================
// STEP 5: Inject floating avatar strip + manager modal markup right before
// the chat-panel JSX block. We use a stable landmark: the comment
// `{/* Live Chat Drawer (slide-in side panel, closed by default) */}`.
// ============================================================
const chatDrawerMarker = "{/* Live Chat Drawer (slide-in side panel, closed by default) */}";
const floatingStripAndModal = `
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
              <div className="live-participant-strip-list">
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
              </div>
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
                        border: \`1px solid \${selected ? 'rgba(233,30,99,0.45)' : 'rgba(255,255,255,0.06)'}\`,
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

`;

if (src.includes('Floating Participant Avatars Strip (Instagram Live style)')) {
  L('STEP 5 already applied.');
} else {
  src = src.replace(chatDrawerMarker, floatingStripAndModal + '\n          ' + chatDrawerMarker);
  L('STEP 5: injected floating avatar strip + manager modal.');
}

fs.writeFileSync(file, src, 'utf-8');
console.log('Done. Total log entries:', log.length);
console.log(new Date().toISOString());
