// v2 layout fix - simpler implementation avoiding template literal gotchas.
// All string replacements use plain strings without backtick nesting.

import fs from 'fs';

const file = 'src/components/LiveClassroom.jsx';
let src = fs.readFileSync(file, 'utf-8');
const log = [];
const L = (m) => { log.push(m); console.log(m); };

// =====================================================================
// STEP 1: Add chatPopups state near participantManagerOpen.
// =====================================================================
const stateMarker = 'const [selectedParticipantForManage, setSelectedParticipantForManage] = useState(null); // [channel, participant] being managed';
if (src.indexOf('chatPopups') < 0) {
  src = src.replace(
    stateMarker,
    stateMarker + "\n  const [chatPopups, setChatPopups] = useState([]); // Floating ephemeral comment popups (avatar + message bubble); opacity is intentionally translucent so live shows through"
  );
  L('STEP 1 ok.');
}

// =====================================================================
// STEP 2: Add spawnChatPopup helper near the spawnFloatingReaction comment.
// Use a plain string concatenation (no template literal backtick nesting).
// =====================================================================
const helperAnchor = '// Spawn a floating emoji reaction that animates upward and fades out.';
const helperBlock = [
  '  // Spawn a transient chat-comment popup at bottom-right with low opacity.',
  '  // Each popup carries the author avatar (initials + color), username and bubble.',
  '  // Hard cap at 5 active popups to keep the DOM lightweight.',
  '  const spawnChatPopup = (data) => {',
  '    if (!data || !data.message || !data.message.trim()) return;',
  '    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);',
  '    const color = data.isLocal ? "#e91e63" : getParticipantColor(data.userId);',
  '    const initial = getParticipantInitials(data.isLocal ? (user && user.username) : data.username);',
  '    setChatPopups(function (prev) {',
  '      const trimmed = prev.length > 4 ? prev.slice(-4) : prev;',
  '      const next = trimmed.slice();',
  '      next.push({ id: id, username: data.username || "anon", message: data.message, color: color, initial: initial, isLocal: !!data.isLocal });',
  '      return next;',
  '    });',
  '    setTimeout(function () {',
  '      setChatPopups(function (prev) { return prev.filter(function (p) { return p.id !== id; }); });',
  '    }, 4200);',
  '  };',
  ''
].join('\n');

if (src.indexOf('spawnChatPopup') < 0) {
  src = src.replace(helperAnchor, helperBlock + helperAnchor);
  L('STEP 2 ok.');
}

// =====================================================================
// STEP 3: Inside the chat case handler (peers), call spawnChatPopup.
// =====================================================================
const chatCaseOld =
  "        case 'chat':\n" +
  "          // If a peer sends a quick-reaction emoji, also spawn a floating\n" +
  "          // animation locally so it feels like a real live broadcast.\n" +
  "          if (typeof data.message === 'string' && QUICK_REACTIONS.includes(data.message.trim())) {\n" +
  "            spawnFloatingReaction(data.message.trim());\n" +
  "          }\n" +
  "          setChatMessages(prev => [...prev, {\n" +
  "            username: data.username,\n" +
  "            message: data.message\n" +
  "          }]);\n" +
  "          break;";

const chatCaseNew =
  "        case 'chat':\n" +
  "          // If a peer sends a quick-reaction emoji, also spawn a floating\n" +
  "          // animation locally so it feels like a real live broadcast.\n" +
  "          if (typeof data.message === 'string' && QUICK_REACTIONS.includes(data.message.trim())) {\n" +
  "            spawnFloatingReaction(data.message.trim());\n" +
  "          }\n" +
  "          // Always spawn a transparent comment popup with the speaker's\n" +
  "          // avatar too, so we can see WHO reacted/commented without\n" +
  "          // blocking the live.\n" +
  "          if (typeof data.message === 'string' && data.message.trim()) {\n" +
  "            spawnChatPopup({\n" +
  "              username: data.username || 'anon',\n" +
  "              message: data.message,\n" +
  "              userId: data.user_id ?? null,\n" +
  "              isLocal: data.username === (user && user.username)\n" +
  "            });\n" +
  "          }\n" +
  "          setChatMessages(prev => [...prev, {\n" +
  "            username: data.username,\n" +
  "            message: data.message\n" +
  "          }]);\n" +
  "          break;";

if (src.indexOf(chatCaseOld) >= 0) {
  src = src.replace(chatCaseOld, chatCaseNew);
  L('STEP 3 ok.');
} else {
  L('STEP 3 SKIPPED: chat case block did not match.');
}

// =====================================================================
// STEP 4: Wire spawnChatPopup into local sendChatMessage.
// =====================================================================
const sendOld =
  "  const sendChatMessage = (e) => {\n" +
  "    e.preventDefault();\n" +
  "    if (!chatInput.trim()) return;\n" +
  "    sendWsMessage({\n" +
  "      type: 'chat_message',\n" +
  "      message: chatInput\n" +
  "    });\n" +
  "    setChatInput('');\n" +
  "  };";

const sendNew =
  "  const sendChatMessage = (e) => {\n" +
  "    e.preventDefault();\n" +
  "    if (!chatInput.trim()) return;\n" +
  "    const textToSend = chatInput;\n" +
  "    sendWsMessage({\n" +
  "      type: 'chat_message',\n" +
  "      message: textToSend\n" +
  "    });\n" +
  "    if (textToSend.trim()) {\n" +
  "      if (QUICK_REACTIONS.includes(textToSend.trim())) {\n" +
  "        spawnFloatingReaction(textToSend.trim());\n" +
  "      }\n" +
  "      spawnChatPopup({\n" +
  "        username: (user && user.username) || 'me',\n" +
  "        message: textToSend,\n" +
  "        userId: (user && (user.id || user.user_id)) || null,\n" +
  "        isLocal: true\n" +
  "      });\n" +
  "    }\n" +
  "    setChatInput('');\n" +
  "  };";

if (src.indexOf(sendOld) >= 0) {
  src = src.replace(sendOld, sendNew);
  L('STEP 4 ok.');
} else {
  L('STEP 4 SKIPPED: sendChatMessage signature did not match.');
}

// =====================================================================
// STEP 5: Replace the static avatar-pill list with a tiny online dot only
// (full participant list remains accessible via the manager FAB).
// =====================================================================
const stripListAnchor = '<div className="live-participant-strip-list">';
const stripListOldSnippet = 'live-participant-strip-list';

if (src.indexOf('live-participant-strip-list') >= 0) {
  // Find the opening div of the strip list and the matching closing </div>.
  // Use a simple balanced-brace replace by tracking <div...</div> depth.
  const startIdx = src.indexOf('<div className="live-participant-strip-list">');
  if (startIdx >= 0) {
    let depth = 0;
    let endIdx = -1;
    let i = startIdx;
    // Walk forward over JSX-ish tokens to find the matching </div>.
    while (i < src.length) {
      // Simple heuristic: look for next 'div' opening token or closing token
      const nextOpen = src.indexOf('<div', i + 1);
      const nextClose = src.indexOf('</div>', i + 1);
      if (nextClose < 0) { break; }
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++;
        i = nextOpen;
      } else {
        if (depth === 0) { endIdx = nextClose + '</div>'.length; break; }
        depth--;
        i = nextClose;
      }
    }
    if (endIdx > 0) {
      const replacement = '<span className="live-participant-strip-online-dot" aria-hidden="true" />';
      src = src.slice(0, startIdx) + replacement + src.slice(endIdx);
      L('STEP 5 ok.');
    } else {
      L('STEP 5 PARTIAL: could not find closing tag for strip list.');
    }
  }
}

// =====================================================================
// STEP 6: Inject the floating chat-comment popups layer JSX above
// the existing floating participant strip.
// =====================================================================
const stripMarker = '{/* Floating Participant Avatars Strip (Instagram Live style) */}';
const popupLayer = [
  "          {/* Floating Chat Comment Popups (TikTok / IG Live style, very translucent) */}",
  "          {chatPopups.length > 0 && (",
  "            <div className=\"live-comment-popups-layer\" aria-live=\"polite\" aria-relevant=\"additions\">",
  "              {chatPopups.map(function (p) {",
  "                return (",
  "                  <div key={p.id} className={p.isLocal ? 'live-comment-popup is-local' : 'live-comment-popup'}>",
  "                    <span className=\"live-comment-popup-avatar\" style={{ background: p.color }} aria-hidden=\"true\">",
  "                      {p.initial}",
  "                    </span>",
  "                    <div className=\"live-comment-popup-bubble\">",
  "                      <span className=\"live-comment-popup-name\">@{p.username}</span>",
  "                      <span className=\"live-comment-popup-msg\">{p.message}</span>",
  "                    </div>",
  "                  </div>",
  "                );",
  "              })}",
  "            </div>",
  "          )}",
  ""
].join("\n");

if (src.indexOf('Floating Chat Comment Popups') < 0) {
  src = src.replace(stripMarker, popupLayer + "\n          " + stripMarker);
  L('STEP 6 ok.');
} else {
  L('STEP 6 already applied.');
}

// =====================================================================
// STEP 7: Improve leave room button (add text label, glowing ring).
// =====================================================================
const leaveOld =
  "              <button\n" +
  "                type=\"button\"\n" +
  "                onClick={leaveRoom}\n" +
  "                aria-label={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}\n" +
  "                title={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}\n" +
  "                className=\"live-toolbar-btn\"\n" +
  "                style={{\n" +
  "                  width: '44px',\n" +
  "                  height: '44px',\n" +
  "                  borderRadius: '50%',\n" +
  "                  background: 'rgba(244,67,54,0.85)',\n" +
  "                  color: 'white',\n" +
  "                  padding: 0,\n" +
  "                  display: 'inline-flex',\n" +
  "                  alignItems: 'center',\n" +
  "                  justifyContent: 'center',\n" +
  "                  backdropFilter: 'blur(12px)',\n" +
  "                  border: '1px solid rgba(255,255,255,0.10)',\n" +
  "                  cursor: 'pointer',\n" +
  "                  boxShadow: '0 10px 24px rgba(244,67,54,0.32)'\n" +
  "                }}\n" +
  "              >\n" +
  "                <i className=\"fas fa-times\" style={{ fontSize: '1.15rem' }}></i>\n" +
  "              </button>";

const leaveNew =
  "              <button\n" +
  "                type=\"button\"\n" +
  "                onClick={leaveRoom}\n" +
  "                aria-label={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}\n" +
  "                title={lang === 'ht' ? 'Kite klas la' : 'Leave the live class'}\n" +
  "                className=\"live-toolbar-btn live-leave-btn\"\n" +
  "                style={{\n" +
  "                  minWidth: '44px',\n" +
  "                  height: '44px',\n" +
  "                  borderRadius: '999px',\n" +
  "                  background: 'linear-gradient(135deg, rgba(244,67,54,0.95), rgba(229,57,53,0.92))',\n" +
  "                  color: 'white',\n" +
  "                  padding: '0 16px',\n" +
  "                  gap: '8px',\n" +
  "                  display: 'inline-flex',\n" +
  "                  alignItems: 'center',\n" +
  "                  justifyContent: 'center',\n" +
  "                  backdropFilter: 'blur(12px)',\n" +
  "                  border: '1px solid rgba(255,255,255,0.18)',\n" +
  "                  cursor: 'pointer',\n" +
  "                  boxShadow: '0 10px 24px rgba(244,67,54,0.45), 0 0 0 4px rgba(244,67,54,0.18)',\n" +
  "                  fontWeight: 800,\n" +
  "                  fontSize: '0.82rem',\n" +
  "                  letterSpacing: '0.02em'\n" +
  "                }}\n" +
  "              >\n" +
  "                <i className=\"fas fa-door-open\" style={{ fontSize: '1rem' }}></i>\n" +
  "                <span className=\"live-leave-btn-label\" style={{ marginLeft: '4px' }}>\n" +
  "                  {lang === 'ht' ? 'Kite' : 'Leave'}\n" +
  "                </span>\n" +
  "                <i className=\"fas fa-times live-leave-btn-x\" style={{ fontSize: '0.78rem', marginLeft: '6px', opacity: 0.65 }}></i>\n" +
  "              </button>";

if (src.indexOf(leaveOld) >= 0) {
  src = src.replace(leaveOld, leaveNew);
  L('STEP 7 ok.');
} else {
  L('STEP 7 SKIPPED: leave button did not match.');
}

// =====================================================================
// STEP 8: Reset chatPopups in disconnectClassroom.
// =====================================================================
const resetAnchor = "setFloatingReactions([]);\n";
const resetNew = "setFloatingReactions([]);\n    setChatPopups([]);\n";
if (src.indexOf('setChatPopups([])') < 0) {
  // Try a simple markers
  if (src.indexOf(resetAnchor) >= 0) {
    // Use a more specific anchor that we know exists
    const anchor = "setFloatingReactions([]); // Reset on disconnect so stale state doesn't mutate after teardown.\n";
    if (src.indexOf(anchor) >= 0) {
      src = src.replace(anchor, anchor + "    setChatPopups([]);\n");
      L('STEP 8 ok.');
    } else {
      L('STEP 8 SKIPPED: reset anchor not found verbatim.');
    }
  }
}

fs.writeFileSync(file, src, 'utf-8');
L('Total log entries: ' + log.length);
console.log(new Date().toISOString());
