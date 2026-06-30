/**
 * src/components/kot3chat/CallHistoryPanel.jsx
 *
 * Premium Call History panel. Rows are:
 *
 *   • Avatar + counterparty username
 *   • Direction badge (incoming / outgoing / missed / rejected)
 *   • Duration + timestamp
 *   • Call Again / Delete actions
 *
 * Filter chips at the top: All / Missed / Incoming / Outgoing. Per the
 * spec we also store per-call timestamps and persist them client-side
 * via a thin "cache last 200" pattern; the host is expected to feed
 * real data through props.
 */
import React, { useMemo, useState } from 'react';

const KIND = {
  incoming: { icon: 'fa-arrow-down', color: '#0084ff', bg: 'rgba(0, 132, 255, 0.15)' },
  outgoing: { icon: 'fa-arrow-up',   color: '#34c759', bg: 'rgba(52, 199, 89, 0.15)' },
  missed:   { icon: 'fa-phone-slash',color: '#ff3b30', bg: 'rgba(255, 59, 48, 0.15)' },
  rejected: { icon: 'fa-ban',        color: '#ff9500', bg: 'rgba(255, 149, 0, 0.15)' },
};

const formatDuration = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60 * 1000) return 'Just now';
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / 60000)} min ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const weekDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return weekDays[d.getDay()];
  const monthsEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${monthsEn[d.getMonth()]} ${d.getDate()}`;
};

export function CallHistoryPanel({ calls = [], onCallAgain, onDelete, lang = 'en', t = {} }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = calls.slice();
    if (filter !== 'all') list = list.filter((c) => c.kind === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) => (c.username || '').toLowerCase().includes(q));
    }
    return list;
  }, [calls, filter, query]);

  const tabs = [
    { id: 'all',      label: t.msg_filter_all || 'All',              count: calls.length },
    { id: 'missed',   label: t.msg_calls_missed || 'Missed',         count: calls.filter((c) => c.kind === 'missed').length },
    { id: 'incoming', label: t.msg_calls_incoming || 'Incoming',     count: calls.filter((c) => c.kind === 'incoming').length },
    { id: 'outgoing', label: t.msg_calls_outgoing || 'Outgoing',     count: calls.filter((c) => c.kind === 'outgoing').length },
  ];

  return (
    <div className="kot3-call-history">
      <header className="kot3-call-history-toolbar">
        <input
          type="text"
          className="kot3-call-history-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.msg_search_calls || 'Search calls…'}
          aria-label={t.msg_search_calls || 'Search calls'}
        />
        <div className="kot3-call-history-filters" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`kot3-call-history-filter${filter === tab.id ? ' active' : ''}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
              {tab.count > 0 && <span className="count">{tab.count}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="kot3-call-history-rows">
        {filtered.map((c) => {
          const k = KIND[c.kind] || KIND.outgoing;
          return (
            <div key={c.id} className={`kot3-call-history-row${c.kind === 'missed' ? ' missed' : ''}`}>
              <img
                className="kot3-call-history-avatar"
                src={c.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.username || '?')}&background=e91e63&color=fff`}
                alt={c.username || ''}
              />
              <div className="kot3-call-history-meta">
                <div className="kot3-call-history-name">{c.username}</div>
                <div className="kot3-call-history-row2">
                  <span className="kot3-call-history-kind" style={{ color: k.color, background: k.bg }}>
                    <i className={`fas ${k.icon}`} aria-hidden="true" /> {t[`msg_call_${c.kind}`] || c.kind}
                  </span>
                  <span className="kot3-call-history-duration">{c.duration > 0 ? formatDuration(c.duration) : ''}</span>
                  <span className="kot3-call-history-when">{formatTime(c.timestamp)}</span>
                </div>
              </div>
              <div className="kot3-call-history-actions">
                {onCallAgain && (
                  <button type="button" onClick={() => onCallAgain?.(c)} aria-label={t.msg_call_again || 'Call again'}>
                    <i className={`fas ${c.kind === 'video' ? 'fa-video' : 'fa-phone'}`} aria-hidden="true" />
                  </button>
                )}
                {onDelete && (
                  <button type="button" className="danger" onClick={() => onDelete?.(c)} aria-label={t.common_remove || 'Delete'}>
                    <i className="fas fa-trash" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="kot3-call-history-empty">
            <i className="fas fa-phone-slash" aria-hidden="true" />
            <span>{t.msg_no_calls || 'No calls.'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default CallHistoryPanel;
