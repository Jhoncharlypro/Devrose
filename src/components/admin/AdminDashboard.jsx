import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import './admin.css';

// ---------------------------------------------------------------------------
// AdminDashboard
// ---------------------------------------------------------------------------
// Part 6 — Enterprise Admin surface. Shows the 12 stat cards the
// spec calls for, each with its own icon, accent color, and live
// "last updated" timestamp. Auto-refreshes every 30 seconds (matches
// the backend's DASHBOARD_CACHE_TTL — the first request after expiry
// pays the full query cost; subsequent in-window loads are O(1)).
//
// Backed by GET /api/admin/dashboard/ which returns:
//   { total_users, online_users, active_conversations, messages_today,
//     voice_calls_today, video_calls_today, groups_created,
//     reports_pending, banned_users, storage_bytes,
//     server_health: { db, presence_ledger, cache_layer },
//     api_health: boolean, generated_at, cached }
//
// Failure modes:
//   * 401 / 403 → show a friendly "no admin permission" panel.
//   * 5xx / network → show inline retry + a red banner above the grid.
//   * individual card failure (e.g. count_online() returned -1) → show
//     a "—" placeholder so the rest of the dashboard stays usable.

const REFRESH_INTERVAL_MS = 30_000;

const T = (en, ht) => ({ en, ht }); // tiny inline i18n stub — replace with useTranslation if added.

const CARDS = [
  { key: 'total_users',          label: T('Total Users',          'Total Itilizatè'),          icon: 'fa-users',            accent: 'indigo' },
  { key: 'online_users',         label: T('Online Users',         'Itilizatè sou entènèt'),    icon: 'fa-signal',           accent: 'emerald' },
  { key: 'active_conversations', label: T('Active Conversations', 'Konvèsasyon aktif'),        icon: 'fa-comments',         accent: 'sky' },
  { key: 'messages_today',       label: T('Messages Today',       'Mesaj jodi a'),             icon: 'fa-message',          accent: 'violet' },
  { key: 'voice_calls_today',    label: T('Voice Calls Today',    'Apèl vwa jodi a'),          icon: 'fa-phone',            accent: 'amber' },
  { key: 'video_calls_today',    label: T('Video Calls Today',    'Apèl videyo jodi a'),       icon: 'fa-video',            accent: 'pink' },
  { key: 'groups_created',       label: T('Groups Created',       'Gwoup kreye'),              icon: 'fa-people-group',     accent: 'cyan' },
  { key: 'reports_pending',      label: T('Reports Pending',      'Rapò an atant'),            icon: 'fa-flag',             accent: 'orange' },
  { key: 'banned_users',         label: T('Banned Users',         'Itilizatè entèdi'),         icon: 'fa-ban',              accent: 'red' },
  { key: 'storage_bytes',        label: T('Storage Usage',        'Itilizasyon estokaj'),      icon: 'fa-hard-drive',       accent: 'slate', formatter: 'bytes' },
  { key: 'server_health',        label: T('Server Health',        'Sante sèvè'),               icon: 'fa-server',           accent: 'teal',  formatter: 'health' },
  { key: 'api_health',           label: T('API Health',           'Sante API'),                icon: 'fa-plug',             accent: 'lime',  formatter: 'api_health' },
];

// ------------------ formatters ------------------
function fmtNumber(n) {
  if (n === null || n === undefined || n === -1) return '—';
  if (typeof n !== 'number') return String(n);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000)        return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtBytes(n) {
  if (n === null || n === undefined || n === -1) return '—';
  if (typeof n !== 'number') return String(n);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function fmtHealth(health) {
  if (!health || typeof health !== 'object') return '—';
  const subs = ['db', 'presence_ledger', 'cache_layer'];
  const down = subs.filter(k => !health[k]);
  if (down.length === 0) return 'OK';
  return `${down.length}/${subs.length} down`;
}

function fmtApiHealth(v) { return v ? 'OK' : 'DEGRADED'; }

function formatCardValue(card, raw) {
  if (raw === null || raw === undefined) return '—';
  switch (card.formatter) {
    case 'bytes':     return fmtBytes(raw);
    case 'health':    return fmtHealth(raw);
    case 'api_health':return fmtApiHealth(raw);
    default:          return fmtNumber(raw);
  }
}

// ------------------ language hook (cheap) ------------------
function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

// ------------------ main component ------------------
export default function AdminDashboard({ lang: langProp }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tickIn, setTickIn] = useState(REFRESH_INTERVAL_MS / 1000);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);
  const lang = langProp || detectLang();

  const fetchStats = useCallback(async () => {
    try {
      const resp = await api.get('/admin/dashboard/');
      setData(resp.data || {});
      setError(null);
      setForbidden(false);
      setLastUpdated(new Date());
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401 || status === 403) {
        setForbidden(true);
        setError(null);
      } else {
        setError(
          e?.response?.data?.error ||
          e?.message ||
          'Failed to load dashboard stats. Will retry on the next tick.'
        );
      }
    } finally {
      setLoading(false);
      setTickIn(REFRESH_INTERVAL_MS / 1000);
    }
  }, []);

  // initial + interval
  useEffect(() => {
    fetchStats();
    timerRef.current = setInterval(fetchStats, REFRESH_INTERVAL_MS);
    countdownRef.current = setInterval(() => {
      setTickIn(t => (t > 0 ? t - 1 : REFRESH_INTERVAL_MS / 1000));
    }, 1_000);
    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [fetchStats]);

  // expose a tiny derived overall status
  const overall = useMemo(() => {
    if (!data) return 'unknown';
    if (data.api_health && (data.server_health?.db)) return 'healthy';
    if (data.api_health === false) return 'critical';
    return 'warning';
  }, [data]);

  if (forbidden) {
    return (
      <div className="admin-dashboard admin-dashboard--forbidden" role="alert">
        <div className="admin-dashboard__lock">
          <i className="fas fa-lock" aria-hidden="true"></i>
          <h2>{T('No admin permission', 'Ou pa gen otorizasyon admin')[lang]}</h2>
          <p>{T(
            'You need the Administrator or Super Administrator role to view this dashboard.',
            'Ou bezwen wòl Admin oswa Super Admin pou wè tablo sa a.'
          )[lang]}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard" data-overall={overall}>
      <header className="admin-dashboard__header">
        <div className="admin-dashboard__title">
          <h1>
            <i className="fas fa-gauge-high" aria-hidden="true"></i>
            {' '}{T('Admin Dashboard', 'Tablo Admin')[lang]}
          </h1>
          <p className="admin-dashboard__subtitle">
            {T('Realtime platform statistics — auto-refresh every 30s.', 'Estatistik platfòm an tan reyèl — rafrechi chak 30 segond.')[lang]}
          </p>
        </div>
        <div className="admin-dashboard__actions" role="group" aria-label="Dashboard actions">
          <button
            type="button"
            className="admin-dashboard__btn"
            onClick={fetchStats}
            disabled={loading}
            aria-label={T('Refresh now', 'Rafrechi kounye a')[lang]}
          >
            <i className={loading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'} aria-hidden="true"></i>
            {' '}{T('Refresh', 'Rafrechi')[lang]}
          </button>
          <span className="admin-dashboard__countdown" aria-live="polite">
            <i className="fas fa-clock" aria-hidden="true"></i>
            {' '}{T('Next:', 'Pwochain:')[lang]} {tickIn}s
          </span>
        </div>
      </header>

      {error && (
        <div className="admin-dashboard__error" role="alert">
          <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
          {' '}{error}
          {' '}<button type="button" onClick={fetchStats}>{T('Retry', 'Eseye ankò')[lang]}</button>
        </div>
      )}

      {data?.cached && (
        <div className="admin-dashboard__cached" aria-live="polite">
          <i className="fas fa-database" aria-hidden="true"></i>
          {' '}{T('Showing cached data from', 'Ap montre done nan kachè ki soti nan')[lang]}{' '}
          {data?.__cached_at ? new Date(data.__cached_at).toLocaleTimeString() : '—'}
        </div>
      )}

      <div className="admin-dashboard__grid">
        {CARDS.map(card => {
          const raw = data ? data[card.key] : null;
          const value = formatCardValue(card, raw);
          const health =
            card.key === 'server_health' && raw && typeof raw === 'object'
              ? (Object.values(raw).every(Boolean) ? 'ok' : 'down')
              : (card.key === 'api_health' ? (raw ? 'ok' : 'down') : null);
          return (
            <article
              key={card.key}
              className={`admin-card admin-card--${card.accent}${health ? ` admin-card--${health}` : ''}`}
              aria-label={`${card.label[lang]}: ${value}`}
            >
              <div className="admin-card__icon" aria-hidden="true">
                <i className={`fas ${card.icon}`}></i>
              </div>
              <div className="admin-card__body">
                <div className="admin-card__label">{card.label[lang]}</div>
                <div className="admin-card__value">{value}</div>
              </div>
              {card.key === 'server_health' && raw && typeof raw === 'object' && (
                <ul className="admin-card__sub">
                  <li data-ok={raw.db ? '1' : '0'}>{T('DB', 'DB')[lang]}</li>
                  <li data-ok={raw.presence_ledger ? '1' : '0'}>{T('Presence', 'Prezans')[lang]}</li>
                  <li data-ok={raw.cache_layer ? '1' : '0'}>{T('Cache', 'Kachè')[lang]}</li>
                </ul>
              )}
            </article>
          );
        })}
      </div>

      <footer className="admin-dashboard__footer">
        <span>
          {T('Last updated:', 'Dènye mizajou:')[lang]}{' '}
          {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
        </span>
        <span>
          {T('Generated at:', 'Jenere nan:')[lang]}{' '}
          {data?.generated_at ? new Date(data.generated_at).toLocaleString() : '—'}
        </span>
      </footer>
    </div>
  );
}
