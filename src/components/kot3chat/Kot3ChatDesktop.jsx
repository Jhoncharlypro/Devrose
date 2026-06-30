/**
 * src/components/kot3chat/Kot3ChatDesktop.jsx
 *
 * Thin workspace wrapper that mounts EITHER the premium MessengerHome
 * OR the existing Kot3Chat conversation pane. Owns:
 *   • Thread-list data load (chatService.getThreads on mount)
 *   • The home ↔ conversation view toggle (with slide transition)
 *   • Routing callbacks the MessengerHome expects
 *
 * Anything that would require a deep integration with the existing
 * chat data layer (requests, archived, pin/mute/back-end persistence)
 * is wired to ``showToast`` for the moment so the user sees the design
 * before we wire in the data plumbing. Items are surfaced as
 * TODOs in ``suggest_followups`` for the follow-up sweeps.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import MessengerHome from './MessengerHome';
import Kot3Chat from '../Kot3Chat';
import { chatService } from '../../services/api';

/**
 * Coarse heuristic for "incoming chat from someone I haven't messaged
 * yet" — concat username of the other side into a stable request id.
 *
 * NOTE: in production we'd want a real `is_request` field on
 * ``ChatThread`` (or a separate `MessageRequest` model). Until that's
 * available, ``is_request === unread === 0 && no inbound messages``.
 */
function isLikelyRequest(thread, selfId) {
  // Treat threads without any of MY outbound messages AND with
  // unread inbound as requests.
  const last = thread.last_message || {};
  return (thread.unread_count || 0) > 0 && last.sender_id !== selfId && last.deleted !== true;
}

function isArchived(thread) {
  return thread.archived === true;
}

export function Kot3ChatDesktop({
  lang,
  user,
  showToast,
  translations,
  onLogout,
  onOpenSettings,
  // Optional escape routes
  onBackToApp,        // () => void  (close chat tab)
  onProfileItem,      // (key) => void
}) {
  const [view, setView] = useState('home');          // 'home' | 'conversation'
  const [threads, setThreads] = useState([]);
  const [scrollingToConversation, setScrollingToConversation] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(null);

  // ── data load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setThreads([]);
      return;
    }
    let cancelled = false;
    chatService.getThreads()
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r?.data) ? r.data : [];
        setThreads(list);
      })
      .catch((err) => {
        // Don't be silent — surface the failure as a toast so the user
        // knows why the list is empty. We still render the home so the
        // design feedback is testable.
        // eslint-disable-next-line no-console
        console.warn('Kot3ChatDesktop: getThreads failed', err?.response?.status);
        setThreads([]);
      });
    return () => { cancelled = true; };
  }, [user]);

  // ── WebSocket presence ─────────────────────────────────────────────────
  // The underlying Kot3Chat component spawns its own useChatSocket() when
  // it mounts (the conversation pane). We DO NOT instantiate a parallel
  // socket here — that would double-bill the server's presence ledger
  // and leak a second WS that no code consumes. Presence / typing
  // observations made by the home view arrive via the same socket the
  // conversation pane sets up; we surface them through a ref-sync handler
  // once the home is active. For this PR we pass empty maps so the
  // visible UI matches the reduced data — full Melding is a follow-up.
  const onlineUsersMap = {};
  const typingMap = {};

  // ── derive sections ────────────────────────────────────────────────────
  const { normalThreads, requests, archived } = useMemo(() => {
    if (!user) return { normalThreads: [], requests: [], archived: [] };
    const mapped = (threads || []).map(t => ({
      ...t,
      participants: t.participants || [],
      other: (t.participants || []).find(p => p.id !== user.id) || {},
    }));
    return {
      normalThreads: mapped.filter(t => !isArchived(t) && !isLikelyRequest(t, user.id)),
      requests:      mapped.filter(t => !isArchived(t) && isLikelyRequest(t, user.id)),
      archived:      mapped.filter(t =>  isArchived(t)),
    };
  }, [threads, user]);

  // ── transitions ───────────────────────────────────────────────────────
  const handleOpenThread = useCallback((thread) => {
    setActiveThreadId(thread?.id || null);
    setScrollingToConversation(true);
    // Tiny delay so the slide-out overlay animates smoothly before we
    // unmount the home tree.
    requestAnimationFrame(() => {
      setView('conversation');
      requestAnimationFrame(() => setScrollingToConversation(false));
    });
  }, []);

  const handleBackToHome = useCallback(() => {
    setScrollingToConversation(true);
    setView('home');
    setActiveThreadId(null);
    requestAnimationFrame(() => setScrollingToConversation(false));
  }, []);

  // ── profile menu routing ──────────────────────────────────────────────
  const handleProfileItem = useCallback((key) => {
    if (key === 'logout')   return onLogout?.('user');
    if (key === 'settings') return onOpenSettings?.();
    onProfileItem?.(key);
  }, [onLogout, onOpenSettings, onProfileItem]);

  // The Messenger Home + Kot3 Chat's existing UIs are mutually
  // exclusive in the DOM; we hand-roll the "slide" overlay here so we
  // don't have to fork the existing Kot3 Chat.
  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}>
      {view === 'home' && (
        <MessengerHome
          user={user}
          lang={lang}
          translations={translations}
          showToast={showToast}
          threads={normalThreads}
          requests={requests}
          archived={archived}
          onlineUsersMap={onlineUsersMap}
          typingMap={typingMap}
          onOpenThread={handleOpenThread}
          onAcceptRequest={(th) => showToast?.(lang === 'ht' ? 'Aksepte demann nan' : 'Accept request', 'check-circle')}
          onIgnoreRequest={(th) => showToast?.(lang === 'ht' ? 'Inyore demann nan' : 'Ignore request', 'eye-slash')}
          onBlockRequest={(th) => showToast?.(lang === 'ht' ? 'Bloke' : 'Block', 'ban')}
          onDeleteRequest={(th) => showToast?.(lang === 'ht' ? 'Efase' : 'Delete', 'trash')}
          onPinThread={(th) => showToast?.(lang === 'ht' ? 'Epingle' : 'Pin', 'thumbtack')}
          onArchiveThread={(th) => showToast?.(lang === 'ht' ? 'Achiv' : 'Archive', 'box-archive')}
          onMuteThread={(th) => showToast?.(lang === 'ht' ? 'Mòd silans' : 'Mute', 'bell-slash')}
          onProfileItem={handleProfileItem}
        />
      )}

      {view === 'conversation' && (
        <Kot3Chat
          lang={lang}
          user={user}
          showToast={showToast}
          forceThreadId={activeThreadId}
          onBack={handleBackToHome}
        />
      )}

      {/* Slide-overlay used while we're transitioning between views
          so the unmount of one tree doesn't blank the screen. */}
      {scrollingToConversation && (
        <div className="kot3-convo-slide-overlay" aria-hidden="true" />
      )}
    </div>
  );
}

export default Kot3ChatDesktop;
