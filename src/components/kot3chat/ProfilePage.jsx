/**
 * src/components/kot3chat/ProfilePage.jsx
 *
 * Premium Profile Page — the user-data view that opens when you tap a
 * username / avatar (excluding your own, which goes to Settings).
 *
 * Layout:
 *   • Cover photo banner (16:7) with gradient overlay.
 *   • Centered 110px circular avatar overlapping the cover.
 *   • Username heading + verified badge + role badge.
 *   • Display name (if different from username) + bio + status.
 *   • Action toolbar: Message / Voice Call / Video Call / Block / Report.
 *   • Detail strip: Phone, Email, Country, Joined date.
 *   • Shared Groups list (optional, lazy-loaded).
 *   • Mutual Friends list (optional, lazy-loaded).
 *
 * Pure presentational. The host provides the user object and handlers.
 */
import React, { useState } from 'react';

const ROLE_LABEL = {
  owner:    { label: 'Owner',    icon: 'fa-crown',      bg: 'rgba(255, 215, 0, 0.20)',  fg: '#b8860b' },
  admin:    { label: 'Admin',    icon: 'fa-shield-alt', bg: 'rgba(233, 30, 99, 0.20)',  fg: '#e91e63' },
  mod:      { label: 'Moderator',icon: 'fa-gavel',      bg: 'rgba(0, 132, 255, 0.20)', fg: '#0084ff' },
  verified: { label: 'Verified', icon: 'fa-check',      bg: 'rgba(29, 161, 242, 0.20)', fg: '#1da1f2' },
  creator:  { label: 'Creator',  icon: 'fa-star',       bg: 'rgba(240, 147, 251, 0.20)',fg: '#c9183b' },
  business: { label: 'Business', icon: 'fa-briefcase',  bg: 'rgba(79, 172, 254, 0.20)', fg: '#4facfe' },
};

const formatDate = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const monthsEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return lang === 'ht' ? `${monthsEn[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : `${monthsEn[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

export function ProfilePage({ user, myUserId, onClose, onMessage, onVoiceCall, onVideoCall, onBlock, onReport, onMute, lang = 'en', t = {} }) {
  const [activeTab, setActiveTab] = useState('about');

  if (!user) {
    return (
      <div className="kot3-profile-page-empty">
        <i className="fas fa-user-slash" aria-hidden="true" />
        <span>{t.msg_profile_not_found || 'Profile not found.'}</span>
      </div>
    );
  }

  const isMe = user.id === myUserId;
  const role = user.role;
  const roleCfg = ROLE_LABEL[role] || null;

  return (
    <div className="kot3-profile-page">
      <header className="kot3-profile-page-cover">
        {user.cover_photo ? (
          <img src={user.cover_photo} alt="" />
        ) : (
          <div className="kot3-profile-page-cover-gradient" />
        )}
        <div className="kot3-profile-page-cover-overlay" />
        <button
          type="button"
          className="kot3-profile-page-close"
          onClick={onClose}
          aria-label={t.common_close || 'Close'}
        >
          <i className="fas fa-arrow-left" aria-hidden="true" />
        </button>
      </header>

      <section className="kot3-profile-page-hero">
        <div className="kot3-profile-page-avatar-wrap">
          <img
            className="kot3-profile-page-avatar"
            src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username || '?')}&background=e91e63&color=fff&size=256`}
            alt={user.username || ''}
          />
          {user.is_online && <span className="kot3-status-dot online" aria-label="online" />}
        </div>
        <h1 className="kot3-profile-page-name">
          {user.username}
          {user.is_verified && <i className="fas fa-check-circle" style={{ color: '#1da1f2', marginLeft: 8 }} aria-label="verified" />}
        </h1>
        {user.display_name && user.display_name !== user.username && (
          <div className="kot3-profile-page-display">{user.display_name}</div>
        )}
        {roleCfg && (
          <span className="kot3-profile-page-role" style={{ background: roleCfg.bg, color: roleCfg.fg }}>
            <i className={`fas ${roleCfg.icon}`} aria-hidden="true" /> {roleCfg.label}
          </span>
        )}
        {user.bio && <div className="kot3-profile-page-bio">{user.bio}</div>}
        {user.status_text && <div className="kot3-profile-page-status">{user.status_text}</div>}

        {!isMe && (
          <div className="kot3-profile-page-actions">
            <button type="button" className="primary" onClick={() => onMessage?.(user)} aria-label="message">
              <i className="fas fa-comment" aria-hidden="true" /> <span>{t.msg_action_message || 'Message'}</span>
            </button>
            <button type="button" onClick={() => onVoiceCall?.(user)} aria-label="voice call">
              <i className="fas fa-phone" aria-hidden="true" /> <span>{t.msg_call_voice || 'Voice'}</span>
            </button>
            <button type="button" onClick={() => onVideoCall?.(user)} aria-label="video call">
              <i className="fas fa-video" aria-hidden="true" /> <span>{t.msg_call_video || 'Video'}</span>
            </button>
            <button type="button" onClick={() => onMute?.(user)} aria-label="mute">
              <i className="fas fa-bell-slash" aria-hidden="true" /> <span>{t.msg_mute || 'Mute'}</span>
            </button>
            <button type="button" className="danger" onClick={() => onBlock?.(user)} aria-label="block">
              <i className="fas fa-ban" aria-hidden="true" /> <span>{t.msg_block_user || 'Block'}</span>
            </button>
            <button type="button" className="danger-ghost" onClick={() => onReport?.(user)} aria-label="report">
              <i className="fas fa-flag" aria-hidden="true" /> <span>{t.msg_report_user || 'Report'}</span>
            </button>
          </div>
        )}
      </section>

      <div className="kot3-profile-page-tabs" role="tablist">
        {[
          { id: 'about',  label: t.msg_profile_tab_about  || 'About' },
          { id: 'groups', label: t.msg_profile_tab_groups || 'Groups', count: (user.shared_groups || []).length },
          { id: 'mutual', label: t.msg_profile_tab_mutual || 'Mutual', count: (user.mutual_friends || []).length },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`kot3-profile-page-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 && <span className="count">{tab.count}</span>}
          </button>
        ))}
      </div>

      <section className="kot3-profile-page-body">
        {activeTab === 'about' && (
          <div className="kot3-profile-page-about">
            {(user.phone || user.email || user.country || user.joined_at) ? (
              <div className="kot3-profile-page-fields">
                {user.phone && (
                  <div className="kot3-profile-page-field">
                    <i className="fas fa-phone" aria-hidden="true" />
                    <div>
                      <label>{t.msg_profile_phone || 'Phone'}</label>
                      <span>{user.phone}</span>
                    </div>
                  </div>
                )}
                {user.email && (
                  <div className="kot3-profile-page-field">
                    <i className="fas fa-envelope" aria-hidden="true" />
                    <div>
                      <label>{t.msg_profile_email || 'Email'}</label>
                      <span>{user.email}</span>
                    </div>
                  </div>
                )}
                {user.country && (
                  <div className="kot3-profile-page-field">
                    <i className="fas fa-globe" aria-hidden="true" />
                    <div>
                      <label>{t.msg_profile_country || 'Country'}</label>
                      <span>{user.country}</span>
                    </div>
                  </div>
                )}
                {user.joined_at && (
                  <div className="kot3-profile-page-field">
                    <i className="fas fa-calendar" aria-hidden="true" />
                    <div>
                      <label>{t.msg_profile_joined || 'Joined'}</label>
                      <span>{formatDate(user.joined_at, lang)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="kot3-profile-page-empty-tab">{t.msg_no_more_data || 'No public info.'}</div>
            )}
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="kot3-profile-page-groups">
            {(user.shared_groups || []).length === 0 ? (
              <div className="kot3-profile-page-empty-tab">{t.msg_no_shared_groups || 'No shared groups.'}</div>
            ) : (
              user.shared_groups.map((g) => (
                <div key={g.id} className="kot3-profile-page-group-row">
                  <img src={g.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(g.name || '?')}&background=0084ff&color=fff&size=64`} alt="" />
                  <div>
                    <div className="kot3-profile-page-group-name">{g.name}</div>
                    <div className="kot3-profile-page-group-meta">{g.member_count || 0} members</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'mutual' && (
          <div className="kot3-profile-page-mutual">
            {(user.mutual_friends || []).length === 0 ? (
              <div className="kot3-profile-page-empty-tab">{t.msg_no_mutual_friends || 'No mutual friends.'}</div>
            ) : (
              user.mutual_friends.map((u) => (
                <div key={u.id} className="kot3-profile-page-mutual-row">
                  <img src={u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username || '?')}&background=e91e63&color=fff&size=64`} alt="" />
                  <span>{u.username}</span>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default ProfilePage;
