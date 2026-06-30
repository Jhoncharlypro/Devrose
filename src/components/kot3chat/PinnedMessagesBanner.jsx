/**
 * src/components/kot3chat/PinnedMessagesBanner.jsx
 *
 * Pinned messages banner — sits directly under the chat header and shows
 * the most-recent pinned message. Tapping the banner cycles to the next
 * pinned message and fires ``onJumpTo(messageId)`` so the message list
 * can scroll/highlight that row. The X button clears the banner (does
 * NOT unpin — that's a separate action inside the message options menu).
 */
import React from 'react';

export function PinnedMessagesBanner({ pinned, onDismiss, onJumpTo, t = {} }) {
  if (!pinned || pinned.length === 0) return null;

  // We display the last-pinned message first; tapping cycles to the
  // next-previous one. State is owned inside the banner for simplicity.
  const [cursor, setCursor] = React.useState(0);
  const safe = pinned[cursor] || pinned[0];

  const handleTap = () => {
    onJumpTo?.(safe?.id);
    setCursor((c) => (c + 1) % pinned.length);
  };

  return (
    <div
      className="kot3-pinned-banner"
      role="button"
      tabIndex={0}
      onClick={handleTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTap(); } }}
      aria-label={t.msg_pinned_banner || 'Pinned message'}
    >
      <span className="kot3-pinned-banner-icon" aria-hidden="true">
        <i className="fas fa-thumbtack" />
      </span>
      <div className="kot3-pinned-banner-meta">
        <div className="kot3-pinned-banner-label">{t.msg_pinned_banner || 'Pinned message'}</div>
        <div className="kot3-pinned-banner-sender">{safe?.sender_username || (t.msg_sender_default || 'Sender')}</div>
        <div className="kot3-pinned-banner-snippet">{safe?.content?.slice(0, 80) || (t.msg_pinned_image || 'Image / attachment')}</div>
      </div>
      {pinned.length > 1 && <span className="kot3-pinned-banner-count">{cursor + 1}/{pinned.length}</span>}
      <button
        type="button"
        className="kot3-pinned-banner-close"
        onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
        aria-label={t.common_close || 'Dismiss'}
      >
        <i className="fas fa-times" aria-hidden="true" />
      </button>
    </div>
  );
}

export default PinnedMessagesBanner;
