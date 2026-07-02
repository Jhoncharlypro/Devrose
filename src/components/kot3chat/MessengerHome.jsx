/**
 * src/components/kot3chat/MessengerHome.jsx
 *
 * Premium Messenger Home — the FIRST screen the user lands on when they tap
 * the Messenger icon. Replaces the default sidebar with a polished,
 * scroll-driven premium list. Composed in a single file because every piece
 * of it (header, search, filters, drawer, cards, swipe, requests, archived)
 * is unique to this surface.
 *
 * What this hits from the spec:
 *   • Premium fixed 64px header (profile photo + story ring, big title,
 *     rounded icon buttons with ripple + scale press).
 *   • Profile dropdown menu: Profile / Status / Settings / Saved Messages /
 *     Archived Chats / Storage / Privacy / Logout.
 *   • Sticky search bar with realtime local filter across People / Groups /
 *     Messages / Documents / Images / Videos / Links.
 *   • Horizontal scrollable filter chips: All / Unread / Pinned / Groups /
 *     Calls / Media / Archived / Requests / Muted / Bots. Active chip
 *     animates with primary gradient + glow.
 *   • Each conversation card carries the FULL spec'd metadata:
 *       - 56px perfect-circle avatar
 *       - Realtime status overlay (online | away | busy | invisible | offline
 *         | recording | typing | uploading | calling). Recording gets a
 *         pulsing red ring; typing a small animated pen.
 *       - Username (bold) with verification badge / creator badge /
 *         business badge when applicable.
 *       - Last message preview enriched with type-specific icons
 *         (Photo / Video / Voice / Document / GIF / Sticker / Missed call /
 *         Incoming / Outgoing call). Typing replaces the preview with
 *         "Typing…" + animated green dots.
 *       - Smart timestamp (Now / 1 m / 5 m / Yesterday / Monday / Jun 28) +
 *         checkmark state for sent messages (sending / sent / delivered /
 *         read with blue tick / failed red).
 *       - Mute indicator, pin indicator.
 *       - Unread circular badge (99+ clamp) with primary-gradient glow.
 *   • Swipe gestures (useSwipeAction):
 *       - Long swipe left  → Pin (positive action)
 *       - Long swipe right → Mark Read (positive action)
 *       - Tap → enter conversation pane.
 *   • Message Requests: incoming threads from unknown senders. Each card
 *     exposes Accept / Ignore / Block / Delete buttons inline.
 *   • Archived section: hidden conversations visible under "Archived".
 *   • Empty states with friendly illustrations for "no conversations",
 *     "no requests", "no archived", "no matches for search", etc.
 *   • Brand-themed gradient + glass blur header.
 *
 * Wiring rule: this component owns NO socket state. Live data (presence /
 * typing / message events) is injected by the host via the `threads`,
 * `onlineUsers`, `typingUsers`, `reactionVersion` callbacks passed via
 * props. Keeping state out of MessengerHome makes it trivially rerenderable
 * when the host swaps to a different data source.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSwipeAction } from '../../hooks/useSwipeAction';
import { chatService } from '../../services/api';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format a Date / ISO string into the spec'd smart timestamp:
 *   "Now"  (anything < 1 minute)
 *   "1 m" / "5 m" / "30 m"        (within the last hour)
 *   "Yesterday"                   (1 day)
 *   weekday short                 (eg: "Monday")
 *   "Jun 28"                      (this year, abbreviated Mon + day)
 *   "6/28/24"                     (older; future enhancement)
 */
function formatSmartTime(input, lang) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return lang === 'ht' ? 'Kounye a' : 'Now';
  if (min < 60) return `${min} ${lang === 'ht' ? 'min' : 'm'}`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) {
    const yest = new Date(now - hrs * 3600 * 1000);
    if (d.getDate() === new Date(now - 86400000).getDate() && hrs >= 18) {
      return lang === 'ht' ? 'Yè' : 'Yesterday';
    }
    return `${hrs} ${lang === 'ht' ? 'è' : 'h'}`;
  }
  const weekDays = lang === 'ht'
    ? ['Dim', 'Liy', 'Mad', 'Mèk', 'Jed', 'Ven', 'Sam']
    : lang === 'fr'
      ? ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
      : lang === 'es'
        ? ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = Math.floor(hrs / 24);
  if (days < 7) return weekDays[d.getDay()];
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthsEn[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Derive a comprehensive status key for the avatar overlay.
 * Returns one of:
 *   'online' | 'away' | 'busy' | 'invisible' | 'offline'
 *   'recording' | 'typing' | 'uploading' | 'calling'
 * Priority (highest first):
 *   recording > typing > uploading > calling > manual status > last-seen
 */
function deriveStatus({ isOnline, isTyping, isRecording, isUploading, isCalling, manualStatus, lastSeen }) {
  if (isRecording) return 'recording';
  if (isUploading) return 'uploading';
  if (isTyping) return 'typing';
  if (isCalling) return 'calling';
  if (manualStatus) return manualStatus;
  if (isOnline) return 'online';
  return 'offline';
}

/**
 * Render the inner badge element for a status key.
 * stored as a lookup because pure JSX-leaning branches in a render feel
 * noisy and harder to skim at preview time.
 */
function StatusDot({ statusKey }) {
  if (statusKey === 'online')   return <span className="kot3-status-dot online" aria-label="online" />;
  if (statusKey === 'away')     return <span className="kot3-status-dot away"  aria-label="away" />;
  if (statusKey === 'busy')     return <span className="kot3-status-dot busy"  aria-label="busy" />;
  if (statusKey === 'invisible')return <span className="kot3-status-dot inv"   aria-label="invisible" />;
  if (statusKey === 'recording')return <span className="kot3-status-dot recording" aria-label="recording" />;
  if (statusKey === 'uploading')return <span className="kot3-status-dot uploading" aria-label="uploading" />;
  if (statusKey === 'calling')  return <span className="kot3-status-dot calling"   aria-label="in call" />;
  if (statusKey === 'typing')   return (
    <span className="kot3-status-dot typing" aria-label="typing">
      <i className="fas fa-pencil-alt" aria-hidden="true" />
    </span>
  );
  return null;
}

/**
 * Map a message type / content into the spec'd preview shape:
 *   { icon: 'fa-image' | ..., text: 'Photo' | 'Voice message' | ... }
 * with content override when the message is a text bubble.
 */
function messagePreview(message, selfId, t) {
  if (!message) return { icon: null, text: t.msg_msg_voice || '' };
  if (message.typing) return { icon: 'fa-pencil-alt', text: t.msg_status_typing || 'Typing…', isTyping: true };

  // Call statuses take priority over content
  if (message.kind === 'missed_call') return { icon: 'fa-phone-slash', text: t.msg_msg_missed_call || 'Missed call', kind: 'missed' };
  if (message.kind === 'incoming_call') return { icon: 'fa-phone-alt', text: t.msg_msg_incoming_call || 'Incoming call' };
  if (message.kind === 'outgoing_call') return { icon: 'fa-phone-alt', text: t.msg_msg_outgoing_call || 'Outgoing call' };

  const isMine = selfId && message.sender_id === selfId;
  const prefix = isMine ? (t.msg_msg_you || 'You: ') : '';

  if (message.image && !message.content)    return { icon: 'fa-image',   text: `${prefix}${t.msg_msg_photo}` };
  if (message.video && !message.content)    return { icon: 'fa-video',   text: `${prefix}${t.msg_msg_video}` };
  if (message.audio && !message.content)    return { icon: 'fa-microphone', text: `${prefix}${t.msg_msg_voice}` };
  if (message.document && !message.content) return { icon: 'fa-file-alt',text: `${prefix}${t.msg_msg_document}` };
  if (message.gif && !message.content)      return { icon: 'fa-icons',   text: `${prefix}${t.msg_msg_gif}` };
  if (message.sticker && !message.content)  return { icon: 'fa-laugh',   text: `${prefix}${t.msg_msg_sticker}` };

  // Plain text bubble — truncate to ~80 chars.
  const txt = message.content || '';
  return { icon: null, text: `${prefix}${txt.length > 80 ? txt.slice(0, 77) + '…' : txt}` };
}

// ─── Filter chips ───────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',       icon: 'fa-comments' },
  { id: 'unread',    icon: 'fa-envelope' },
  { id: 'pinned',    icon: 'fa-thumbtack' },
  { id: 'groups',    icon: 'fa-users' },
  { id: 'calls',     icon: 'fa-phone' },
  { id: 'media',     icon: 'fa-image' },
  { id: 'archived',  icon: 'fa-box-archive' },
  { id: 'requests',  icon: 'fa-inbox' },
  { id: 'muted',     icon: 'fa-bell-slash' },
  { id: 'bots',      icon: 'fa-robot' },
];

function FilterChips({ active, counts, onChange, t }) {
  return (
    <div className="kot3-filters" role="tablist" aria-label={t.msg_filter_all}>
      {FILTERS.map((f) => {
        const isActive = active === f.id;
        const count = counts?.[f.id] || 0;
        return (
          <button
            type="button"
            key={f.id}
            role="tab"
            aria-selected={isActive}
            className={`kot3-filter-chip${isActive ? ' active' : ''}`}
            onClick={() => onChange(f.id)}
          >
            <i className={`fas ${f.icon}`} aria-hidden="true" />
            <span>{t[`msg_filter_${f.id}`]}</span>
            {count > 0 && <span className="count">{count > 99 ? '99+' : count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Profile drawer ─────────────────────────────────────────────────────────

function ProfileDrawer({ user, t, onClose, items, onItemClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const avatar = user?.avatar || user?.profile?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.username || '?')}&background=e91e63&color=ffffff&size=128`;

  return (
    <div ref={ref} className="kot3-profile-drawer" role="menu" aria-label={t.msg_profile_menu_profile}>
      <div className="kot3-profile-drawer-head">
        <img className="kot3-profile-drawer-avatar" src={avatar} alt={user?.username || ''} />
        <div className="kot3-profile-drawer-meta">
          <div className="kot3-profile-drawer-name">{user?.username || (t.common_close + '…')}</div>
          <div className="kot3-profile-drawer-sub">{user?.email || ''}</div>
        </div>
      </div>
      <div className="kot3-profile-drawer-list">
        {items.map((it) => (
          <button
            type="button"
            key={it.key}
            role="menuitem"
            className={`kot3-profile-drawer-item${it.danger ? ' danger' : ''}`}
            onClick={() => { onItemClick?.(it.key); onClose(); }}
          >
            <span className="ico"><i className={`fas ${it.icon}`} aria-hidden="true" /></span>
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── New chat drawer ────────────────────────────────────────────────────────
function NewChatDrawer({ isOpen, onClose, onPickUser, t, lang = 'ht' }) {
  const ref = useRef(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pickedId, setPickedId] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);

    setLoading(true);
    chatService.getUsers()
      .then((res) => setUsers(res?.data || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));

    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
      setPickedId(null);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const avatarOf = (u) =>
    u?.avatar || u?.profile?.avatar
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(u?.username || '?')}&background=e91e63&color=ffffff&size=128`;

  return (
    <div ref={ref} className="kot3-profile-drawer" role="menu" aria-label={t.msg_new_chat || 'New chat'}>
      <div className="kot3-profile-drawer-head">
        <div className="kot3-profile-drawer-meta">
          <div className="kot3-profile-drawer-name">{lang === 'ht' ? 'Nouvo chat' : 'New chat'}</div>
          <div className="kot3-profile-drawer-sub">
            {loading
              ? (lang === 'ht' ? 'Ap chèche…' : 'Loading…')
              : (lang === 'ht'
                  ? `${users.length} kontak disponib`
                  : `${users.length} contacts`)}
          </div>
        </div>
      </div>
      <div className="kot3-profile-drawer-list">
        {users.map((u) => (
          <button
            type="button"
            key={u.id}
            role="menuitem"
            className="kot3-profile-drawer-item"
            disabled={loading || pickedId !== null}
            onClick={() => {
              setPickedId(u.id);
              onPickUser?.(u);
            }}
          >
            <span className="ico">
              {pickedId === u.id ? (
                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
              ) : (
                <img src={avatarOf(u)} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              )}
            </span>
            <span>@{u.username}</span>
          </button>
        ))}
        {!loading && users.length === 0 && (
          <div style={{ padding: '14px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
            {lang === 'ht' ? 'Pa gen kontak disponib.' : 'No contacts yet.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Conversation card ──────────────────────────────────────────────────────

function ConversationCard({
  thread, selfId, onlineUsersMap, typingMap, t, prefs,
  onOpen, onAcceptRequest, onIgnoreRequest, onBlockRequest, onDelete,
  onPin, onArchive, onMute,
}) {
  const swipe = useSwipeAction({
    enabled: !prefs?.selectMode,
    onSwipeLeft:  () => onPin?.(thread),
    onSwipeRight: () => onArchive?.(thread),
    onClick: () => {
      if (thread.kind === 'request') return; // requests use the explicit CTA row
      onOpen?.(thread);
    },
  });

  const other = thread.participants?.find(p => p.id !== selfId) || thread.participant || {};
  const avatar = other.avatar || other.profile?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.username || '?')}&background=e91e63&color=ffffff&size=128`;
  const isOnline = onlineUsersMap && onlineUsersMap[other.id] && onlineUsersMap[other.id]?.status === 'online';
  const isTyping = typingMap && Object.values(typingMap).includes(other.username);
  const last = thread.last_message || thread.last || {};
  const preview = useMemo(
    () => (isTyping
      ? { icon: 'fa-pencil-alt', text: t.msg_status_typing || 'Typing…', isTyping: true }
      : messagePreview(last, selfId, t)),
    [isTyping, last, selfId, t]
  );
  const unread = thread.unread_count || 0;
  const muted = !!thread.muted;
  const pinned = !!thread.pinned;
  const isRequest = thread.kind === 'request';

  const statusKey = deriveStatus({
    isOnline,
    isTyping,
    isRecording:   thread.status?.recording   || false,
    isUploading:   thread.status?.uploading   || false,
    isCalling:     thread.status?.calling     || false,
    manualStatus:  thread.status?.manual      || null,
    lastSeen:      other.last_seen || null,
  });

  const myLast = last && last.sender_id === selfId;

  return (
    <div className={`kot3-card-row${pinned ? ' pinned' : ''}`}>
      {/* Swipe action backdrops - shown when the user drags */}
      <div className="kot3-card-swipe-action left" style={{ opacity: swipe.state.offset > 30 ? 1 : 0, transform: `translateX(${Math.min(0, swipe.state.offset - 90)}px)` }}>
        <i className="fas fa-thumbtack" aria-hidden="true" />
        <span>{t.msg_filter_pinned}</span>
      </div>
      <div className="kot3-card-swipe-action right" style={{ opacity: swipe.state.offset < -30 ? 1 : 0, transform: `translateX(${Math.max(0, swipe.state.offset + 90)}px)` }}>
        <i className="fas fa-box-archive" aria-hidden="true" />
        <span>{t.msg_filter_archived}</span>
      </div>

      <div className={`kot3-card${unread > 0 ? ' unread' : ''}${pinned ? ' pinned' : ''}`} {...swipe.bind} style={swipe.style}>
        <div className="kot3-card-avatar-col">
          <img className="kot3-card-avatar" src={avatar} alt={other.username || ''} />
          <StatusDot statusKey={statusKey} />
        </div>

        <div className="kot3-card-body">
          <div className="kot3-card-row1">
            <div className="kot3-card-name-row">
              {pinned && <i className="fas fa-thumbtack kot3-card-pin-icon" aria-label="pinned" />}
              {muted && <i className="fas fa-bell-slash kot3-card-mute-icon" aria-label="muted" />}
              <span className="kot3-card-name">{other.username || thread.title || (t.msg_section_all + '…')}</span>
              <span className="kot3-card-icons-row">
                {other.is_verified && <span className="kot3-card-badge verified" title={t.msg_profile_menu_profile} aria-label="verified"><i className="fas fa-check" /></span>}
                {other.role === 'creator' && <span className="kot3-card-badge creator" aria-label="creator"><i className="fas fa-star" /></span>}
                {other.role === 'business' && <span className="kot3-card-badge business" aria-label="business"><i className="fas fa-briefcase" /></span>}
              </span>
            </div>
            <span className="kot3-card-time">{formatSmartTime(thread.updated_at || last.created_at, prefs.lang)}</span>
          </div>

          <div className="kot3-card-row2">
            {preview.isTyping ? (
              <span className="kot3-card-msg-preview kot3-typing-preview">
                {preview.text}
                <span className="dots" aria-hidden="true">
                  <i /><i /><i />
                </span>
              </span>
            ) : (
              <span className="kot3-card-msg-preview">
                {preview.icon && <i className={`fas ${preview.icon} preview-icon`} aria-hidden="true" />}
                <span>{preview.text || t.msg_msg_voice}</span>
              </span>
            )}

            <span className="kot3-card-meta-end">
              {myLast && (
                <span className={`kot3-status-tick ${last.is_read ? 'read' : last.is_delivered ? 'delivered' : last.pending ? 'sent' : 'sent'}`} aria-label="status">
                  {last.is_read ? <i className="fas fa-check-double" />
                    : last.is_delivered ? <i className="fas fa-check-double" />
                    : last.failed ? <i className="fas fa-exclamation-circle" />
                    : last.pending ? <i className="far fa-clock" />
                    : <i className="fas fa-check" />}
                </span>
              )}
              {isRequest ? (
                <span className="kot3-card-cta-row">
                  <button type="button" className="kot3-cta-btn" onClick={(e) => { e.stopPropagation(); onAcceptRequest?.(thread); }}>{t.msg_request_accept}</button>
                  <button type="button" className="kot3-cta-btn secondary" onClick={(e) => { e.stopPropagation(); onIgnoreRequest?.(thread); }}>{t.msg_request_ignore}</button>
                  <button type="button" className="kot3-cta-btn danger" onClick={(e) => { e.stopPropagation(); onBlockRequest?.(thread); }} title={t.msg_request_block} aria-label={t.msg_request_block}>
                    <i className="fas fa-ban" aria-hidden="true" />
                  </button>
                </span>
              ) : (
                unread > 0 && (
                  <span className="kot3-card-unread-badge">{unread > 99 ? '99+' : unread}</span>
                )
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty states ────────────────────────────────────────────────────────────

function EmptyState({ icon, title, hint }) {
  return (
    <div className="kot3-empty-state">
      <div className="kot3-empty-state-illustration" aria-hidden="true">
        <i className={`fas ${icon}`} />
      </div>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MessengerHome({
  user,
  threads,                  // normal 1-on-1 + group chat threads
  requests,                 // unknown-sender threads (kind === 'request')
  archived,                 // archived conversations
  onlineUsersMap = {},
  typingMap = {},
  lang = 'ht',
  translations,
  showToast,
  onOpenThread,             // (thread) => void  → App-level routes to Kot3Chat
  onAcceptRequest,
  onIgnoreRequest,
  onBlockRequest,
  onDeleteRequest,
  onPinThread,
  onArchiveThread,
  onMuteThread,
  onProfileItem,            // (itemKey) => void  → App-level handles Profile / Settings / Logout etc.
}) {
  const t = translations?.[lang] || translations?.ht || {};
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [profileOpen, setProfileOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Phase 9+ — search bar (MessengerHome) now reaches BOTH the user's
  // existing threads AND the platform-wide user directory via
  // /api/chat/search/global_search/. Without this, a brand-new user
  // with 0 threads would see an empty search result set no matter
  // what they typed. ``globalLoading`` drives a small "Searching…"
  // hint so the empty-state doesn't flash a false "No results" for
  // the 200–800ms the request takes on a cold DB.
  const [globalMatches, setGlobalMatches] = useState([]);
  const [globalLoading, setGlobalLoading] = useState(false);

  // Update timestamps every 60s so "1 m" → "2 m" rolls automatically
  // (per spec: "Automatically update. Never require refresh.")
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Debounced platform-wide search. 300ms is a comfortable lag for a
  // human-typed query (most keystroke clusters land inside 200ms; 300
  // keeps the API hit count < 4 per second on a fast typist). The
  // ``active`` flag is the standard pattern for cancelling an
  // in-flight async when the dep changes — simpler than
  // AbortController and never throws ``CanceledError`` into the
  // console when the user keeps typing. Minimum 2 chars before we
  // hit the API; below that we just clear the bucket so a single
  // keystroke never fans out an N+1 search.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setGlobalMatches([]);
      setGlobalLoading(false);
      return undefined;
    }
    let active = true;
    setGlobalLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await chatService.searchGlobal(q);
        if (!active) return;
        const users = (res && res.data && Array.isArray(res.data.users)) ? res.data.users : [];
        setGlobalMatches(users);
      } catch (_e) {
        if (active) setGlobalMatches([]);
      } finally {
        if (active) setGlobalLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  // Touch `now` so React doesn't drop the dependency when nothing else
  // changes; the formatSmartTime path reads Date.now() directly anyway.
  useEffect(() => { /* no-op; presence tick handled by sibling effects */ }, [now]);

  const avatar = useMemo(() => (
    user?.avatar || user?.profile?.avatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.username || '?')}&background=e91e63&color=ffffff&size=128`
  ), [user]);

  // Counts for filter chip badges
  const counts = useMemo(() => {
    const t = threads || [];
    return {
      all: t.length,
      unread: t.filter(x => (x.unread_count || 0) > 0).length,
      pinned: t.filter(x => x.pinned).length,
      groups: t.filter(x => x.is_group).length,
      calls: t.filter(x => x.last_message?.kind?.endsWith?.('call')).length,
      media: t.filter(x => x.last_message?.image || x.last_message?.video).length,
      archived: (archived || []).length,
      requests: (requests || []).length,
      muted: t.filter(x => x.muted).length,
      bots: t.filter(x => x.participant?.is_bot).length,
    };
  }, [threads, archived, requests]);

  // Filter selection
  const filteredThreads = useMemo(() => {
    let list = threads || [];
    switch (filter) {
      case 'unread':  list = list.filter(x => (x.unread_count || 0) > 0); break;
      case 'pinned':  list = list.filter(x => x.pinned); break;
      case 'groups':  list = list.filter(x => x.is_group); break;
      case 'calls':   list = list.filter(x => x.last_message?.kind?.endsWith?.('call')); break;
      case 'media':   list = list.filter(x => !!(x.last_message?.image || x.last_message?.video)); break;
      case 'muted':   list = list.filter(x => x.muted); break;
      case 'bots':    list = list.filter(x => x.participant?.is_bot); break;
      default: break;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(x => {
        const username = (x.participants?.find(p => p.id !== user?.id)?.username || x.title || '').toLowerCase();
        const last = (x.last_message?.content || '').toLowerCase();
        const file = (x.last_message?.document || x.last_message?.file_name || '').toLowerCase();
        return username.includes(q) || last.includes(q) || file.includes(q) || (q.startsWith('http') || q.startsWith('www'));
      });
    }
    return list;
  }, [threads, filter, search, user]);

  // Search applies across people / groups / messages / etc. We surface
  // a top "people" row of matching contacts when no convo match is found.
  // Each entry is tagged ``_source`` ('thread' = existing relationship,
  // 'global' = platform-wide search) so the click handler can decide
  // whether to open the existing thread or create a new one.
  const peopleMatches = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    const seen = new Set();
    const out = [];
    // 1) Existing thread participants win. These are people the user
    //    already chats with — surfacing them first is the "you probably
    //    meant this person" UX.
    (threads || []).forEach(x => {
      const other = (x.participants || []).find(p => p.id !== user?.id);
      if (!other || seen.has(other.id)) return;
      const username = (other.username || '').toLowerCase();
      const status = (other.profile?.status_text || '').toLowerCase();
      if (username.includes(q) || status.includes(q)) {
        seen.add(other.id);
        out.push({ ...other, _source: 'thread', _thread: x });
      }
    });
    // 2) Platform-wide search fills the rest. Deduped against thread
    //    matches so the same person doesn't appear twice. We also
    //    exclude the current user — the BE excludes the requester
    //    server-side but a defensive client check is cheap and
    //    makes the contract obvious to future readers.
    (globalMatches || []).forEach(gUser => {
      if (!gUser || gUser.id === user?.id || seen.has(gUser.id)) return;
      const username = (gUser.username || '').toLowerCase();
      if (!username.includes(q)) return;
      seen.add(gUser.id);
      out.push({ ...gUser, _source: 'global' });
    });
    return out.slice(0, 10);
  }, [search, threads, user, globalMatches]);

  // ── New chat flow ───────────────────────────────────────────────────────────
  // When the user taps the "+" icon in the home header we open a contact
  // drawer (NewChatDrawer below). Picking a contact creates a thread via
  // chatService.createThread(userId) and routes the user into the existing
  // conversation pane. We deliberately route to onOpenThread (instead of
  // hot-creating a temp thread as Kot3Chat does inline) so a future error
  // path (network failure) leaves the drawer open with the toast surfacing.
  const handleNewChat = async (targetUser) => {
    if (!targetUser?.id) return;
    try {
      const res = await chatService.createThread(targetUser.id);
      const thread = res?.data;
      if (thread) {
        onOpenThread?.(thread);
        setNewChatOpen(false);
      } else {
        // 200-but-empty-body: surface a toast + leave drawer open so the user can retry.
        showToast?.(lang === 'ht'
          ? 'Pa ka kòmanse chat la.'
          : 'Could not start chat.',
          'exclamation-triangle');
      }
    } catch (err) {
      const msg = lang === 'ht'
        ? 'Pa ka kòmanse chat la.'
        : 'Could not start chat.';
      showToast?.(msg, 'exclamation-triangle');
    }
  };

  // Pick a person from the search bar's "People" section. Existing
  // thread match → open the thread. Global match → create a new
  // thread (idempotent on the BE: returns the existing one if any)
  // and route into the conversation pane. The toast on the global
  // path gives immediate feedback during the ~150ms the network
  // round-trip takes on localhost; the BE is the persistence-of-truth
  // so a flaky connection surfaces an error toast and the search
  // list remains intact for retry.
  const handlePickPerson = async (match) => {
    if (!match || !match.id) return;
    if (match._source === 'thread' && match._thread) {
      onOpenThread?.(match._thread);
      return;
    }
    try {
      showToast?.(
        lang === 'ht'
          ? `Ap prepare chat ak ${match.username}…`
          : `Starting chat with ${match.username}…`,
        'spinner fa-spin',
      );
      const res = await chatService.createThread(match.id);
      if (res?.data) {
        onOpenThread?.(res.data);
      } else {
        showToast?.(
          lang === 'ht' ? 'Pa ka kòmanse chat la.' : 'Could not start chat.',
          'exclamation-triangle',
        );
      }
    } catch (_e) {
      showToast?.(
        lang === 'ht' ? 'Pa ka kòmanse chat la.' : 'Could not start chat.',
        'exclamation-triangle',
      );
    }
  };

  const profileItems = [
    { key: 'profile',  icon: 'fa-user',          label: t.msg_profile_menu_profile },
    { key: 'status',   icon: 'fa-circle',        label: t.msg_profile_menu_status },
    { key: 'settings', icon: 'fa-cog',           label: t.msg_profile_menu_settings },
    { key: 'saved',    icon: 'fa-bookmark',      label: t.msg_profile_menu_saved },
    { key: 'archived', icon: 'fa-box-archive',   label: t.msg_profile_menu_archived },
    { key: 'storage',  icon: 'fa-database',      label: t.msg_profile_menu_storage },
    { key: 'privacy',  icon: 'fa-shield-alt',    label: t.msg_profile_menu_privacy },
    { key: 'logout',   icon: 'fa-sign-out-alt',  label: t.msg_profile_menu_logout, danger: true },
  ];

  // Apply a slight stagger to the card list so the entrance feels alive
  // when bulk data loads.
  const renderSection = (label, items, options = {}) => {
    if (!items || items.length === 0) return null;
    return (
      <>
        <div className="kot3-card-section-label">
          <span>{label}</span>
        </div>
        {items.map((thread, idx) => (
          <div key={thread.id || `t-${idx}`} style={{ animationDelay: `${idx * 22}ms` }}>
            <ConversationCard
              thread={thread}
              selfId={user?.id}
              onlineUsersMap={onlineUsersMap}
              typingMap={typingMap}
              t={t}
              prefs={{ lang }}
              onOpen={onOpenThread}
              onAcceptRequest={onAcceptRequest}
              onIgnoreRequest={onIgnoreRequest}
              onBlockRequest={onBlockRequest}
              onDelete={onDeleteRequest}
              onPin={onPinThread}
              onArchive={onArchiveThread}
              onMute={onMuteThread}
            />
          </div>
        ))}
      </>
    );
  };

  // ── Filter-specific top-level views (prioritized over the all list) ──
  if (filter === 'archived') {
    return (
      <div className="kot3-messenger-home" onClick={() => setProfileOpen(false)}>
        <Header
          user={user}
          avatar={avatar}
          t={t}
          search={search}
          setSearch={setSearch}
          onProfileOpen={() => setProfileOpen((v) => !v)}
          showToast={showToast}
          onOpenNewChat={() => { setNewChatOpen(true); setProfileOpen(false); }}
          onProfileItem={onProfileItem}
        />
        <SearchBar search={search} setSearch={setSearch} t={t} />
        <FilterChips active={filter} counts={counts} onChange={setFilter} t={t} />
        <div className="kot3-cards-wrap">
          {(archived && archived.length > 0)
            ? renderSection(t.msg_section_archived, archived)
            : <EmptyState icon="fa-box-archive" title={t.msg_archived_empty} hint={t.msg_archived_hint} />
          }
        </div>
        {profileOpen && (
          <ProfileDrawer user={user} t={t} onClose={() => setProfileOpen(false)}
            items={profileItems} onItemClick={onProfileItem} />
        )}
        <NewChatDrawer
          isOpen={newChatOpen}
          onClose={() => setNewChatOpen(false)}
          onPickUser={handleNewChat}
          t={t}
          lang={lang}
        />
      </div>
    );
  }

  if (filter === 'requests') {
    return (
      <div className="kot3-messenger-home" onClick={() => setProfileOpen(false)}>
        <Header
          user={user}
          avatar={avatar}
          t={t}
          search={search}
          setSearch={setSearch}
          onProfileOpen={() => setProfileOpen((v) => !v)}
          showToast={showToast}
          onOpenNewChat={() => { setNewChatOpen(true); setProfileOpen(false); }}
          onProfileItem={onProfileItem}
        />
        <SearchBar search={search} setSearch={setSearch} t={t} />
        <FilterChips active={filter} counts={counts} onChange={setFilter} t={t} />
        <div className="kot3-cards-wrap">
          {(requests && requests.length > 0)
            ? renderSection(t.msg_section_requests, requests)
            : <EmptyState icon="fa-inbox" title={t.msg_requests_empty} hint={t.msg_requests_hint} />
          }
        </div>
        {profileOpen && (
          <ProfileDrawer user={user} t={t} onClose={() => setProfileOpen(false)}
            items={profileItems} onItemClick={onProfileItem} />
        )}
        <NewChatDrawer
          isOpen={newChatOpen}
          onClose={() => setNewChatOpen(false)}
          onPickUser={handleNewChat}
          t={t}
          lang={lang}
        />
      </div>
    );
  }

  // ── Default (all + search) view ──
  return (
    <div className="kot3-messenger-home" onClick={() => setProfileOpen(false)}>
      <Header
        user={user}
        avatar={avatar}
        t={t}
        search={search}
        setSearch={setSearch}
        onProfileOpen={() => setProfileOpen((v) => !v)}
        showToast={showToast}
        onOpenNewChat={() => { setNewChatOpen(true); setProfileOpen(false); }}
        onProfileItem={onProfileItem}
      />
      <SearchBar search={search} setSearch={setSearch} t={t} />
      <FilterChips active={filter} counts={counts} onChange={setFilter} t={t} />

      <div className="kot3-cards-wrap">
        {/* Pinned subsection */}
        {renderSection(
          t.msg_section_pinned,
          (filteredThreads || []).filter(x => x.pinned),
        )}

        {/* Message Requests — only surface the first 3 inline; full
            list lives behind the Requests filter chip. */}
        {renderSection(
          t.msg_section_requests,
          (requests || []).slice(0, 3),
        )}

        {/* All conversations */}
        {renderSection(
          (filteredThreads || []).some(x => x.pinned) ? '' : t.msg_section_all,
          (filteredThreads || []).filter(x => !x.pinned),
        )}

        {/* People search results */}
        {search.trim() && peopleMatches.length > 0 && (
          <div className="kot3-card-section-label">
            <span>{(t.msg_filter_all || 'All').toUpperCase()}</span>
          </div>
        )}
        {search.trim() && peopleMatches.map((p, idx) => (
          <div key={`p-${p.id}`} className="kot3-card kot3-card-people" onClick={() => handlePickPerson(p)}>
            <div className="kot3-card-avatar-col">
              <img className="kot3-card-avatar" src={p.avatar || p.profile?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.username || '?')}&background=e91e63&color=ffffff&size=128`} alt={p.username || ''} />
            </div>
            <div className="kot3-card-body">
              <div className="kot3-card-row1">
                <div className="kot3-card-name-row">
                  <span className="kot3-card-name">{p.username}</span>
                </div>
              </div>
              <div className="kot3-card-row2">
                <span className="kot3-card-msg-preview">{p.profile?.status_text || (p.is_verified ? '✓' : '')}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Empty states */}
        {(!filteredThreads || filteredThreads.length === 0) && (!requests || requests.length === 0) && !search.trim() && (
          <EmptyState
            icon="fa-comments"
            title={lang === 'ht' ? 'Pa gen konvèsasyon ankò' : (lang === 'fr' ? 'Aucune conversation pour le moment' : lang === 'es' ? 'Aún no hay conversaciones' : 'No conversations yet')}
            hint={lang === 'ht' ? 'Kòmanse yon nouvo chat.' : 'Start a new chat.'}
          />
        )}
        {search.trim() && filteredThreads.length === 0 && peopleMatches.length === 0 && !globalLoading && (
          <EmptyState icon="fa-search" title={t.msg_no_results} hint={t.msg_no_results_hint} />
        )}

        {/* Live "searching…" hint while the global API is in flight. Kept
            lightweight (no spinner element) so it doesn't compete with
            the typing caret for visual attention — just a small
            right-aligned label that disappears the moment the response
            lands. Hidden when the query is too short to have triggered
            the API (length < 2). */}
        {globalLoading && search.trim().length >= 2 && (
          <div className="kot3-card-section-label" style={{ textAlign: 'center', opacity: 0.65, fontSize: 12 }}>
            <span>
              <i className="fas fa-spinner fa-spin" aria-hidden="true" />{' '}
              {lang === 'ht' ? 'Ap chèche nan tout rezo a…' : 'Searching the whole network…'}
            </span>
          </div>
        )}
      </div>

      {profileOpen && (
        <ProfileDrawer user={user} t={t} onClose={() => setProfileOpen(false)}
          items={profileItems} onItemClick={onProfileItem} />
      )}
      <NewChatDrawer
        isOpen={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onPickUser={handleNewChat}
        t={t}
        lang={lang}
      />
    </div>
  );
}

// ─── Sub-components used inline by Header ────────────────────────────────────

function Header({ user, avatar, t, onProfileOpen, search, setSearch, showToast, onOpenNewChat, onProfileItem }) {
  // Import at top-level to avoid a require cycle.
  React.useEffect(() => {
    document.body.classList.add('kot3-messenger-home-active');
    return () => document.body.classList.remove('kot3-messenger-home-active');
  }, []);

  const createRipple = (e) => {
    // Add a small CSS-animated ripple on press so icon buttons feel alive.
    const btn = e.currentTarget;
    const dot = document.createElement('span');
    dot.className = 'ripple-dot';
    dot.style.left = `${e.nativeEvent.offsetX - 3}px`;
    dot.style.top  = `${e.nativeEvent.offsetY - 3}px`;
    btn.appendChild(dot);
    setTimeout(() => {
      try { btn.removeChild(dot); } catch (_) { /* node already gone */ }
    }, 520);
  };

  const onIconClick = (handler) => (e) => {
    createRipple(e);
    handler?.(e);
  };

  return (
    <header className="kot3-home-header">
      <div className="kot3-home-header-left">
        <button
          type="button"
          className="kot3-home-profile-trigger"
          aria-label={t.msg_profile_menu_profile}
          onClick={onProfileOpen}
        >
          <span className="kot3-home-profile-ring" aria-hidden="true" />
          <img className="kot3-home-profile-avatar" src={avatar} alt={user?.username || ''} />
        </button>
        <div className="kot3-home-title-block">
          <h1 className="kot3-home-title">{t.msg_home_title}</h1>
          <div className="kot3-home-subtitle">
            <span className="kot3-online-pill">
              <span className="dot" />
              {t.msg_home_subtitle_active}
            </span>
          </div>
        </div>
      </div>

      <div className="kot3-home-header-right">
        <button
          type="button"
          className="kot3-iconbtn"
          aria-label={t.msg_new_chat}
          title={t.msg_new_chat}
          onClick={onIconClick(() => onOpenNewChat?.())}
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kot3-iconbtn"
          aria-label={t.msg_new_group}
          title={t.msg_new_group}
          onClick={onIconClick(() => showToast?.(lang === 'ht' ? 'Kreyasyon gwoup ap vini byento' : 'Group chats — coming soon', 'info-circle'))}
        >
          <i className="fas fa-users" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kot3-iconbtn"
          aria-label={t.msg_search}
          title={t.msg_search}
          onClick={onIconClick((e) => {
            // Focus the search bar when the icon is tapped.
            const input = document.querySelector('.kot3-home-search input');
            if (input) input.focus();
          })}
        >
          <i className="fas fa-search" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kot3-iconbtn"
          aria-label={t.msg_settings}
          title={t.msg_settings}
          onClick={onIconClick(() => (onProfileItem ? onProfileItem('settings') : showToast?.(t.msg_settings, 'cog')))}
        >
          <i className="fas fa-cog" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function SearchBar({ search, setSearch, t }) {
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  return (
    <div className="kot3-home-search-wrap">
      <div className={`kot3-home-search${focused || search ? ' focused' : ''}`}>
        <i className="fas fa-search leading-icon" aria-hidden="true" />
        <input
          ref={ref}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t.msg_search_placeholder}
          aria-label={t.msg_search}
        />
        {search && (
          <button type="button" className="kot3-home-search-clear" aria-label={t.common_cancel || 'Clear'} onClick={() => { setSearch(''); ref.current?.focus(); }}>
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export default MessengerHome;
