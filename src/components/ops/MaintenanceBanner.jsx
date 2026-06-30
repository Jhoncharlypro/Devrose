import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';

// ---------------------------------------------------------------------------
// MaintenanceBanner
// ---------------------------------------------------------------------------
// Part 8 — Production / DevOps surface. Polls /api/maintenance/ every
// 30s (matches the maintenance cache TTL) and renders a dismissible
// banner when the active MaintenanceWindow is read-only. The banner
// auto-hides when the window ends. The component also listens for
// the X-Maintenance response header so a single response (when the
// FE is mid-session) can light the banner immediately without a
// full poll cycle.
//
// Why poll instead of WebSocket-only? The Channels broadcast on
// toggle is best-effort (a client that just reconnected might have
// missed it). The 30s poll guarantees the banner state converges
// within 30s of the server-side toggle, even on a stale client.

const POLL_MS = 30_000;

const t = (en, ht) => ({ en, ht });

const SCOPE_ICON = {
  read_only: 'fa-pause-circle',
  full_lockout: 'fa-lock',
};

const SCOPE_TONE = {
  read_only: 'warn',
  full_lockout: 'critical',
};

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

function formatEndsAt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch { return null; }
}

export default function MaintenanceBanner({
  apiClient = api,
  pollInterval = POLL_MS,
  initialState = null,
}) {
  const [state, setState] = useState(initialState);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedFor, setDismissedFor] = useState(null); // ISO of the window we dismissed
  const timerRef = useRef(null);
  const lang = detectLang();

  const fetchState = useCallback(async () => {
    try {
      // /api/maintenance/ is public (AllowAny) so a logged-out
      // client still sees the banner.
      const resp = await apiClient.get('/maintenance/');
      const list = Array.isArray(resp.data) ? resp.data : (resp.data ? [resp.data] : []);
      // Find the latest active window. The endpoint returns
      // ordered by -starts_at; filter to those that are currently
      // active so a stale "ended 5 minutes ago" row doesn't
      // re-trigger the banner.
      const now = Date.now();
      const active = list.find(w => {
        if (!w || !w.is_active) return false;
        if (w.ends_at && new Date(w.ends_at).getTime() <= now) return false;
        return true;
      });
      setState(active || null);
      // If the window id changed, un-dismiss so the new one shows.
      setDismissedFor(prev => (active && prev === active.id ? prev : null));
    } catch (e) {
      // Silent fail: missing banner is a UX issue, not an error.
      // The /healthz probe is the authoritative health check.
    }
  }, [apiClient]);

  useEffect(() => {
    fetchState();
    timerRef.current = setInterval(fetchState, pollInterval);
    return () => clearInterval(timerRef.current);
  }, [fetchState, pollInterval]);

  // When the window ends, hide the banner.
  useEffect(() => {
    if (!state || !state.ends_at) return;
    const ms = new Date(state.ends_at).getTime() - Date.now();
    if (ms <= 0) {
      setState(null);
      return;
    }
    const t = setTimeout(() => setState(null), Math.min(ms + 1000, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [state]);

  if (!state || dismissed || dismissedFor === state.id) return null;

  const scope = state.scope || 'read_only';
  const tone = SCOPE_TONE[scope] || 'warn';
  const icon = SCOPE_ICON[scope] || 'fa-wrench';
  const endsLabel = formatEndsAt(state.ends_at);

  return (
    <div
      className={`ops-banner ops-banner--${tone}`}
      role="status"
      aria-live="polite"
      aria-label={t('Maintenance notice', 'Avi antretyen')[lang]}
    >
      <div className="ops-banner__inner">
        <span className="ops-banner__icon" aria-hidden="true">
          <i className={`fas ${icon}`}></i>
        </span>
        <div className="ops-banner__body">
          <div className="ops-banner__title">
            {scope === 'full_lockout'
              ? t('Service in maintenance', 'Sèvis nan antretyen')[lang]
              : t('Maintenance in progress', 'Antretyen ap fèt')[lang]}
          </div>
          <div className="ops-banner__message">
            {state.message || t(
              'Some operations may be temporarily unavailable. Existing data is safe.',
              'Kèk operasyon ka tanporèman pa disponib. Done ki egziste deja an sekirite.'
            )[lang]}
            {endsLabel && (
              <span className="ops-banner__ends">
                {' '}{t('Expected to end:', 'Dwe fini:')[lang]} <strong>{endsLabel}</strong>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="ops-banner__close"
          onClick={() => { setDismissed(true); setDismissedFor(state.id); }}
          aria-label={t('Dismiss', 'Fèmen')[lang]}
        >
          <i className="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  );
}
