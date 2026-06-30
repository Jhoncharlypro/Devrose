import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';

// ---------------------------------------------------------------------------
// SystemHealthIndicator
// ---------------------------------------------------------------------------
// Part 8 — Production / DevOps surface. A small status dot that
// shows the platform's overall health (ok / degraded / down) based
// on /api/healthz/. Polls every 60s so the badge stays fresh
// without putting load on the probe. The tooltip lists the
// individual component statuses so a curious operator can see
// whether it's the DB, the cache, or Supabase that's degraded.
//
// Why not WebSocket-only? /api/healthz/ is the canonical
// source-of-truth and a 60s poll is well under the load balancer's
// typical 30s probe cadence. Cheaper than a WS subscription and
// works on pages that haven't opened the chat socket yet.

const POLL_MS = 60_000;

const t = (en, ht) => ({ en, ht });

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

const STATUS_INFO = {
  ok: { label: t('All systems operational', 'Tout sistèm yo mache byen'), icon: 'fa-check-circle' },
  degraded: { label: t('Degraded performance', 'Pèfòmans degraded'), icon: 'fa-exclamation-triangle' },
  down: { label: t('Service disruption', 'Sèvis gen pwoblèm'), icon: 'fa-times-circle' },
  unknown: { label: t('Status unknown', 'Estati enkoni'), icon: 'fa-question-circle' },
};

function summarize(components) {
  if (!components || typeof components !== 'object') return null;
  const subs = Object.entries(components)
    .filter(([k, v]) => k !== 'pool_mode' && k !== 'redis_backend' && (v === 'ok' || v === 'down'));
  if (subs.length === 0) return null;
  const down = subs.filter(([, v]) => v === 'down').map(([k]) => k);
  return down;
}

export default function SystemHealthIndicator({
  apiClient = api,
  pollInterval = POLL_MS,
  className = '',
}) {
  const [status, setStatus] = useState('unknown'); // 'ok' | 'degraded' | 'down' | 'unknown'
  const [components, setComponents] = useState(null);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const lang = detectLang();

  const fetchHealth = useCallback(async () => {
    try {
      const resp = await apiClient.get('/healthz/');
      const data = resp.data || {};
      setStatus(data.status || 'unknown');
      setComponents(data.components || null);
      setError(null);
      setLastChecked(new Date());
    } catch (e) {
      setStatus('down');
      setError(e?.message || 'Health probe failed');
      setLastChecked(new Date());
    }
  }, [apiClient]);

  useEffect(() => {
    fetchHealth();
    timerRef.current = setInterval(fetchHealth, pollInterval);
    return () => clearInterval(timerRef.current);
  }, [fetchHealth, pollInterval]);

  const downSubs = summarize(components);
  const info = STATUS_INFO[status] || STATUS_INFO.unknown;

  return (
    <div className={`ops-health ${className}`} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={`ops-health__dot ops-health__dot--${status}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={info.label[lang]}
        title={info.label[lang]}
      >
        <i className={`fas ${info.icon}`} aria-hidden="true"></i>
        <span className="ops-health__sr">{info.label[lang]}</span>
      </button>
      {open && (
        <div className="ops-health__panel" role="dialog" aria-label={info.label[lang]}>
          <div className="ops-health__title">
            {info.label[lang]}
          </div>
          {components && (
            <ul className="ops-health__list">
              {Object.entries(components)
                .filter(([k]) => k !== 'pool_mode' && k !== 'redis_backend')
                .map(([k, v]) => (
                  <li key={k} data-ok={v === 'ok' ? '1' : v === 'down' ? '0' : ''}>
                    <span className="ops-health__name">{k}</span>
                    <span className="ops-health__value">{v}</span>
                  </li>
                ))}
            </ul>
          )}
          {downSubs && downSubs.length > 0 && (
            <div className="ops-health__warning">
              {t('Affected:', 'Afekte:')[lang]} {downSubs.join(', ')}
            </div>
          )}
          {error && (
            <div className="ops-health__error">{error}</div>
          )}
          {lastChecked && (
            <div className="ops-health__footer">
              {t('Last checked:', 'Dènye tchèk:')[lang]} {lastChecked.toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
