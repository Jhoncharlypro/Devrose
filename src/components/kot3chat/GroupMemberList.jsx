/**
 * src/components/kot3chat/GroupMemberList.jsx
 *
 * Premium group member list. Each row shows:
 *   • 48px avatar with online dot
 *   • Username (bold) + role pill (Owner/Admin/Moderator/Member)
 *   • Join date subtitle
 *   • Action menu (per-row) for Owner/Admin: Promote / Demote / Remove
 *     (Moderator can be promoted to Admin; Admin can be demoted to
 *     Member; Member can be promoted to Moderator).
 *
 * Data shape:
 *   {
 *     id, username, avatar, role: 'owner'|'admin'|'mod'|'member',
 *     joined_at: ISO, is_online: boolean
 *   }
 *
 * The host wires the promote/demote/remove callbacks to backend endpoints
 * (`/api/groups/<id>/members/<uid>/` PATCH/DELETE). This component is
 * presentational; it does not own the network layer.
 */
import React, { useMemo, useState } from 'react';

const ROLE_COLORS = {
  owner:  { bg: 'rgba(255, 215, 0, 0.20)', fg: '#b8860b', icon: 'fa-crown' },
  admin:  { bg: 'rgba(233, 30, 99, 0.20)', fg: '#e91e63', icon: 'fa-shield-alt' },
  mod:    { bg: 'rgba(0, 132, 255, 0.20)', fg: '#0084ff', icon: 'fa-gavel' },
  member: { bg: 'rgba(0, 0, 0, 0.06)',   fg: '#90949c', icon: 'fa-user' },
};

const formatDate = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return lang === 'ht' ? `${monthsEn[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : `${monthsEn[d.getMonth()]} ${d.getDate()}`;
};

export function GroupMemberList({
  members = [],
  myUserId,
  myRole,
  onPromote,
  onDemote,
  onRemove,
  onMessage,
  onCall,
  lang = 'en',
  t = {},
}) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const filtered = useMemo(() => {
    let out = members.slice();
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((m) => (m.username || '').toLowerCase().includes(q));
    }
    if (activeTab === 'admins') out = out.filter((m) => m.role === 'owner' || m.role === 'admin');
    if (activeTab === 'online') out = out.filter((m) => m.is_online);
    // Sort: owner first, then admins, then alphabetic
    const order = { owner: 0, admin: 1, mod: 2, member: 3 };
    out.sort((a, b) => (order[a.role] ?? 99) - (order[b.role] ?? 99) || (a.username || '').localeCompare(b.username || ''));
    return out;
  }, [members, query, activeTab]);

  // Permission helpers — only Owner/Admin can act on members.
  const canActOn = (member) => {
    if (!member || member.id === myUserId) return false;
    if (member.role === 'owner') return false;
    if (myRole === 'owner') return true;
    if (myRole === 'admin' && (member.role === 'member' || member.role === 'mod')) return true;
    return false;
  };

  const canPromote = (member) => {
    if (!canActOn(member)) return false;
    if (member.role === 'mod' || member.role === 'admin') return false;
    return true;
  };
  const canDemote = (member) => {
    if (!canActOn(member)) return false;
    if (member.role !== 'admin') return false;
    return true;
  };

  return (
    <div className="kot3-group-member-list">
      <div className="kot3-group-member-toolbar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.msg_search_people || 'Search people…'}
          className="kot3-group-member-search"
          aria-label={t.msg_search_people || 'Search'}
        />
        <div className="kot3-group-member-tabs" role="tablist">
          {[
            { id: 'all', label: t.msg_filter_all || 'All' },
            { id: 'admins', label: t.msg_group_admins_tab || 'Admins' },
            { id: 'online', label: t.msg_group_online_tab || 'Online' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`kot3-group-member-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="kot3-group-member-rows">
        {filtered.map((m) => {
          const rc = ROLE_COLORS[m.role] || ROLE_COLORS.member;
          const actions = (
            <div className="kot3-group-member-actions">
              {onMessage && (
                <button type="button" onClick={() => onMessage?.(m)} title={t.common_send || 'Message'} aria-label="message">
                  <i className="fas fa-comment" aria-hidden="true" />
                </button>
              )}
              {onCall && m.id !== myUserId && (
                <button type="button" onClick={() => onCall?.(m)} title={t.msg_call_voice || 'Call'} aria-label="call">
                  <i className="fas fa-phone" aria-hidden="true" />
                </button>
              )}
              {canPromote(m) && (
                <button type="button" onClick={() => onPromote?.(m)} title={t.msg_promote || 'Promote'} aria-label="promote">
                  <i className="fas fa-arrow-up" aria-hidden="true" />
                </button>
              )}
              {canDemote(m) && (
                <button type="button" onClick={() => onDemote?.(m)} title={t.msg_demote || 'Demote'} aria-label="demote">
                  <i className="fas fa-arrow-down" aria-hidden="true" />
                </button>
              )}
              {canActOn(m) && (
                <button type="button" className="danger" onClick={() => onRemove?.(m)} title={t.common_remove || 'Remove'} aria-label="remove">
                  <i className="fas fa-user-minus" aria-hidden="true" />
                </button>
              )}
            </div>
          );
          return (
            <div key={m.id} className="kot3-group-member-row">
              <div className="kot3-group-member-avatar-col">
                <img
                  className="kot3-group-member-avatar"
                  src={m.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.username || '?')}&background=e91e63&color=fff`}
                  alt={m.username || ''}
                />
                {m.is_online && <span className="kot3-status-dot online" aria-hidden="true" />}
              </div>
              <div className="kot3-group-member-meta">
                <div className="kot3-group-member-name">{m.username}</div>
                <div className="kot3-group-member-row2">
                  <span
                    className="kot3-group-role-pill"
                    style={{ background: rc.bg, color: rc.fg }}
                  >
                    <i className={`fas ${rc.icon}`} aria-hidden="true" /> {t[`msg_role_${m.role}`] || m.role}
                  </span>
                  <span className="kot3-group-member-joined">
                    {t.msg_joined_on || 'Joined'} {formatDate(m.joined_at, lang)}
                  </span>
                </div>
              </div>
              {actions}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            {t.msg_no_results || 'No members.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default GroupMemberList;
