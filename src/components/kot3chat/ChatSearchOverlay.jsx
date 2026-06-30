/**
 * src/components/kot3chat/ChatSearchOverlay.jsx
 *
 * In-thread search. Filters the user-supplied messages by case-insensitive
 * substring match against `content`, `sender_username`, and `document`/
 * `file_name` if present. The snippet for each hit is the content with
 * every match wrapped in `<mark>` for highlight; the host's list view
 * will brighten match colour via CSS (`mark { ... }`).
 *
 * Steps: user types query → debounce isn't necessary (the filter is on
 * already-loaded message history). We display ALL hits up-front and let
 * the user navigate with prev/next; clicking a hit jumps the message
 * list via ``onJumpTo(messageId)``.
 */
import React, { useMemo, useState } from 'react';

const MAX_HITS = 60;

const renderSnippet = (content, q) => {
  if (!content) return '';
  if (!q) return content.length > 140 ? content.slice(0, 137) + '…' : content;
  const lower = content.toLowerCase();
  const lq = q.toLowerCase();
  const out = [];
  let i = 0;
  while (i < content.length) {
    const idx = lower.indexOf(lq, i);
    if (idx < 0) {
      out.push(content.slice(i, i + 240));
      break;
    }
    out.push(content.slice(i, idx));
    out.push(<mark key={idx}>{content.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
    if (out.join('').length > 240) {
      out.push('…');
      break;
    }
  }
  return out;
};

export function ChatSearchOverlay({ isOpen, onClose, messages = [], onJumpTo, t = {} }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const hits = useMemo(() => {
    if (!isOpen || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    const list = [];
    for (const m of messages) {
      const text = ((m.content || '') + ' ' + (m.sender_username || '') + ' ' + (m.document || '') + ' ' + (m.file_name || '')).toLowerCase();
      if (text.includes(q)) {
        list.push(m);
        if (list.length >= MAX_HITS) break;
      }
    }
    return list;
  }, [isOpen, query, messages]);

  if (!isOpen) return null;

  const goPrev = () => setActiveIdx((i) => Math.max(0, i - 1));
  const goNext = () => setActiveIdx((i) => Math.min(hits.length - 1, i + 1));

  return (
    <div className="kot3-chat-search-overlay">
      <div className="kot3-chat-search-top">
        <button type="button" className="kot3-iconbtn" onClick={onClose} aria-label={t.common_close || 'Close'}>
          <i className="fas fa-arrow-left" aria-hidden="true" />
        </button>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          placeholder={t.msg_search_placeholder || 'Search messages'}
          aria-label={t.msg_search || 'Search'}
        />
        <button
          type="button"
          className="kot3-iconbtn"
          onClick={goPrev}
          disabled={hits.length === 0 || activeIdx <= 0}
          aria-label={t.msg_prev || 'Previous'}
        >
          <i className="fas fa-chevron-up" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="kot3-iconbtn"
          onClick={goNext}
          disabled={hits.length === 0 || activeIdx >= hits.length - 1}
          aria-label={t.msg_next || 'Next'}
        >
          <i className="fas fa-chevron-down" aria-hidden="true" />
        </button>
      </div>
      <div className="kot3-chat-search-meta">
        {query.trim()
          ? (hits.length === 0
              ? (t.msg_no_results || 'No results')
              : `${activeIdx + 1} / ${hits.length}`)
          : (t.msg_search_hint || 'Type to search messages')}
      </div>
      <div className="kot3-chat-search-results">
        {hits.map((m, idx) => (
          <div
            key={m.id}
            className={`kot3-chat-search-result${idx === activeIdx ? ' active' : ''}`}
            onClick={() => { setActiveIdx(idx); onJumpTo?.(m.id); }}
          >
            <div className="kot3-chat-search-result-sender">{m.sender_username || (t.msg_sender_default || 'Sender')}</div>
            <div className="kot3-chat-search-result-snippet">{renderSnippet(m.content || '', query)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ChatSearchOverlay;
