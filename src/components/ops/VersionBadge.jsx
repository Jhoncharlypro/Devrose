import React, { useEffect, useState } from 'react';
import api from '../../services/api';

// ---------------------------------------------------------------------------
// VersionBadge
// ---------------------------------------------------------------------------
// Part 8 — Production / DevOps surface. Renders the app version +
// short git SHA + environment, sourced from /api/version/ on mount.
// The badge is intentionally subtle (small mono-font text) so it
// doesn't dominate the header but stays visible to operators. In
// dev it shows the live commit; in prod it confirms the deploy
// pipeline wrote the right SHA.

const t = (en, ht) => ({ en, ht });

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

const ENV_TONE = {
  development: 'dev',
  staging: 'staging',
  production: 'prod',
};

export default function VersionBadge({
  apiClient = api,
  fallbackVersion = null,
}) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const lang = detectLang();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiClient.get('/version/');
        if (!cancelled) setInfo(resp.data || null);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'version fetch failed');
          // Fall back to a build-time constant so the badge still
          // renders something in offline / hard-fail situations.
          if (fallbackVersion) {
            setInfo({ version: fallbackVersion, environment: 'unknown', git_sha: '' });
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [apiClient, fallbackVersion]);

  if (error && !info) {
    return (
      <span className="ops-version ops-version--error" title={error}>
        v? · {t('offline', 'dekonekte')[lang]}
      </span>
    );
  }
  if (!info) {
    return <span className="ops-version ops-version--loading">…</span>;
  }

  const tone = ENV_TONE[info.environment] || 'unknown';
  const sha = (info.git_sha || '').slice(0, 7);

  return (
    <span
      className={`ops-version ops-version--${tone}`}
      title={`v${info.version}${sha ? ' · ' + sha : ''}\nPython ${info.python}\nDjango ${info.django}\nUptime ${Math.round((info.uptime_seconds || 0) / 60)}m`}
      aria-label={`Version ${info.version}, environment ${info.environment}`}
    >
      <span className="ops-version__env">{info.environment}</span>
      <span className="ops-version__sep">·</span>
      <span className="ops-version__ver">v{info.version}</span>
      {sha && (
        <>
          <span className="ops-version__sep">·</span>
          <span className="ops-version__sha">{sha}</span>
        </>
      )}
    </span>
  );
}
