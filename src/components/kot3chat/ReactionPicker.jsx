/**
 * src/components/kot3chat/ReactionPicker.jsx
 *
 * Long-press reaction picker. Renders the spec's 10-emoji palette
 * (❤️ 👍 😂 😮 😢 🔥 👏 😍 👎) plus a small action bar (Copy / Reply /
 * Forward). Closes on backdrop tap or Escape. The host wires long-press
 * detection on a message bubble → opens this picker → onPick(emoji)
 * routes to the message-update WS protocol already in place.
 */
import React, { useEffect } from 'react';

const EMOJIS = ['❤️','👍','😂','😮','😢','🔥','👏','😍','👎'];

export function ReactionPicker({ isOpen, onClose, onPick, onCopy, onReply, onForward, t = {} }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="kot3-reaction-picker-overlay" onClick={onClose}>
      <div className="kot3-reaction-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.msg_reactions || 'Reactions'}>
        {EMOJIS.map((e) => (
          <button
            type="button"
            key={e}
            aria-label={`React with ${e}`}
            onClick={() => { onPick?.(e); onClose?.(); }}
          >
            {e}
          </button>
        ))}
        <div className="kot3-reaction-picker-actions">
          {onCopy && (
            <button type="button" onClick={() => { onCopy?.(); onClose?.(); }} title={t.msg_action_copy || 'Copy'} aria-label={t.msg_action_copy || 'Copy'}>
              <i className="fas fa-copy" aria-hidden="true" />
            </button>
          )}
          {onReply && (
            <button type="button" onClick={() => { onReply?.(); onClose?.(); }} title={t.msg_action_reply || 'Reply'} aria-label={t.msg_action_reply || 'Reply'}>
              <i className="fas fa-reply" aria-hidden="true" />
            </button>
          )}
          {onForward && (
            <button type="button" onClick={() => { onForward?.(); onClose?.(); }} title={t.msg_action_forward || 'Forward'} aria-label={t.msg_action_forward || 'Forward'}>
              <i className="fas fa-share" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReactionPicker;
