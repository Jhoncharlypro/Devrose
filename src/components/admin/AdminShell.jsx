/**
 * AdminShell — Part 6/8 admin panel wrapper.
 *
 * Renders a left-sidebar nav (Dashboard | Moderation | Broadcasts | DevOps)
 * and a content area for the selected sub-page. RBAC gate: a non-staff
 * user gets the same lock panel AdminDashboard shows for 403, so the
 * forbidden state is consistent across the entire admin surface.
 *
 * Sub-pages are NOT children — they're mounted as the active component,
 * so each owns its own state lifecycle (data fetching, forms, error
 * boundaries). The shell only owns the active-tab state and the layout.
 */
import React, { useState } from 'react';
import AdminDashboard from './AdminDashboard';
import AdminModeration from './AdminModeration';
import AdminBroadcasts from './AdminBroadcasts';
import AdminDevOps from './AdminDevOps';
import './admin-shell.css';

const T = (en, ht) => ({ en, ht });

// Section registry. Order = display order. The component reference is
// resolved by key so the array is the single source of truth — adding
// a new admin page is a one-line append here + a new file.
const SECTIONS = [
  { key: 'dashboard',  label: T('Dashboard',  'Tablo'),    icon: 'fa-gauge-high',         Comp: AdminDashboard },
  { key: 'moderation', label: T('Moderation', 'Modèrasyon'), icon: 'fa-flag',             Comp: AdminModeration },
  { key: 'broadcasts', label: T('Broadcasts', 'Anons'),    icon: 'fa-bullhorn',           Comp: AdminBroadcasts },
  { key: 'devops',     label: T('DevOps',     'DevOps'),   icon: 'fa-screwdriver-wrench', Comp: AdminDevOps },
];

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

export default function AdminShell({ lang: langProp, user }) {
  const lang = langProp || detectLang();
  const [tab, setTab] = useState('dashboard');
  const Active = SECTIONS.find((s) => s.key === tab)?.Comp || AdminDashboard;

  // ── RBAC gate: staff OR superuser only. Each sub-page can still 403
  //    on its own endpoints (the BE checks ``user_has_permission``)
  //    — this gate just hides the entire shell from non-admins so we
  //    don't render an empty panel that 403s on first fetch.
  if (!user || (!user.is_staff && !user.is_superuser)) {
    return (
      <div className="admin-shell admin-shell--forbidden" role="alert">
        <div className="admin-shell__lock">
          <i className="fas fa-lock" aria-hidden="true"></i>
          <h2>{T('No admin permission', 'Ou pa gen otorizasyon admin')[lang]}</h2>
          <p>
            {T(
              'You need staff or super-admin role to access the admin panel.',
              'Ou bezwen wòl admin pou wè panèl sa a.'
            )[lang]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar" aria-label="Admin navigation">
        <div className="admin-shell__brand">
          <i className="fas fa-shield-halved" aria-hidden="true"></i>
          <span>{T('Admin Panel', 'Panèl Admin')[lang]}</span>
        </div>
        <nav className="admin-shell__nav">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`admin-shell__nav-item${tab === s.key ? ' is-active' : ''}`}
              onClick={() => setTab(s.key)}
              aria-current={tab === s.key ? 'page' : undefined}
            >
              <i className={`fas ${s.icon}`} aria-hidden="true"></i>
              <span>{s.label[lang]}</span>
            </button>
          ))}
        </nav>
        <div className="admin-shell__user">
          <i className="fas fa-user-shield" aria-hidden="true"></i>
          <span>{user.username}</span>
        </div>
      </aside>
      <main className="admin-shell__content">
        <Active lang={lang} user={user} />
      </main>
    </div>
  );
}
