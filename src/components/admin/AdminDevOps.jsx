/**
 * AdminDevOps — Part 8 production / DevOps / monitoring surface.
 *
 * Five sections in a single scrollable page (per the design plan —
 * sub-tabs would bury the most-used controls). Each section is an
 * independent <section> card; failures in one don't poison the rest.
 *
 *   1. Maintenance  — current state + toggle ON / OFF.
 *   2. Queue        — stats (5 cards) + list + enqueue form.
 *   3. Alerts       — unresolved list + resolve / sweep.
 *   4. Deployments  — recent log + log-a-new-event form.
 *   5. Rate limits  — bucket inspection (recent + by_bucket aggregation).
 *
 * Fetch strategy: parallel Promise.all for the initial load so the
 * first paint shows everything at once; refresh button hits all five
 * again. 5 round-trips on a click is fine — these are all admin-only
 * endpoints with no rate-limit risk.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

const T = (en, ht) => ({ en, ht });

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const SEVERITY_PILL = {
  info: 'admin-pill--info', warning: 'admin-pill--warning',
  critical: 'admin-pill--danger', high: 'admin-pill--danger', medium: 'admin-pill--warning', low: 'admin-pill--info',
};

const RESOLVED_PILL = {
  true:  { cls: 'admin-pill--success', label: { en: 'Resolved', ht: 'Rezoud' } },
  false: { cls: 'admin-pill--warning', label: { en: 'Open',     ht: 'Ouvri' } },
};

const JOB_STATUS_PILL = {
  pending: 'admin-pill--muted', running: 'admin-pill--info',
  done: 'admin-pill--success', failed: 'admin-pill--danger', dead: 'admin-pill--danger',
};

export default function AdminDevOps({ lang: langProp }) {
  const lang = langProp || detectLang();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // One state slot per section — keeps failures isolated.
  const [maintenance, setMaintenance] = useState([]);
  const [queue, setQueue] = useState({ items: [], stats: null });
  const [alerts, setAlerts] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [rateLimits, setRateLimits] = useState({ recent: [], by_bucket: [] });

  // Enqueue form
  const [enqForm, setEnqForm] = useState({ name: '', payload: '', max_attempts: 3 });
  const [enqErr, setEnqErr] = useState(null);
  const [enqBusy, setEnqBusy] = useState(false);

  // Maintenance toggle form
  const [maintScope, setMaintScope] = useState('read_only');
  const [maintMessage, setMaintMessage] = useState('');
  const [maintEnds, setMaintEnds] = useState('');
  const [maintBusy, setMaintBusy] = useState(false);

  // Deployment log form
  const [depForm, setDepForm] = useState({ kind: 'deploy', environment: 'production', status: 'success', commit_sha: '', notes: '' });
  const [depBusy, setDepBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, q, qs, a, d, r] = await Promise.all([
        api.get('/maintenance/').catch(() => ({ data: [] })),
        api.get('/queue/').catch(() => ({ data: [] })),
        api.get('/queue/stats/').catch(() => ({ data: null })),
        api.get('/security/alerts/?resolved=false').catch(() => ({ data: [] })),
        api.get('/deployments/').catch(() => ({ data: [] })),
        api.get('/rate-limits/').catch(() => ({ data: { recent: [], by_bucket: [] } })),
      ]);
      setMaintenance(Array.isArray(m.data) ? m.data : []);
      setQueue({ items: Array.isArray(q.data) ? q.data : [], stats: qs.data });
      setAlerts(Array.isArray(a.data) ? a.data : []);
      setDeployments(Array.isArray(d.data) ? d.data : []);
      setRateLimits(r.data || { recent: [], by_bucket: [] });
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401 || status === 403) {
        setError(T('You do not have permission to view the DevOps surface.', 'Ou pa gen pèmisyon pou wè DevOps.')[lang]);
      } else {
        setError(e?.response?.data?.error || e?.message || 'Failed to load DevOps data.');
      }
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Maintenance ────────────────────────────────────────────────────────
  async function handleMaintenanceStart(e) {
    e.preventDefault();
    setMaintBusy(true);
    try {
      const payload = { scope: maintScope, message: maintMessage };
      if (maintEnds) {
        try { payload.ends_at = new Date(maintEnds).toISOString(); } catch { /* BE will reject */ }
      }
      await api.post('/maintenance/', payload);
      setMaintMessage('');
      setMaintEnds('');
      await fetchAll();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Maintenance start failed.');
    } finally {
      setMaintBusy(false);
    }
  }
  async function handleMaintenanceEnd(id) {
    if (!window.confirm(T('End this maintenance window?', 'Fini fenèt antretyen sa a?')[lang])) return;
    try {
      await api.delete(`/maintenance/${id}/`);
      await fetchAll();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Maintenance end failed.');
    }
  }

  // ── Queue ──────────────────────────────────────────────────────────────
  async function handleEnqueue(e) {
    e.preventDefault();
    setEnqErr(null);
    const name = (enqForm.name || '').trim();
    if (!name) { setEnqErr(T('Job name is required.', 'Non travay obligatwa.')[lang]); return; }
    setEnqBusy(true);
    try {
      let payload = {};
      const raw = (enqForm.payload || '').trim();
      if (raw) {
        try { payload = JSON.parse(raw); }
        catch { setEnqErr(T('Payload must be valid JSON.', 'Payload dwe JSON valid.')[lang]); setEnqBusy(false); return; }
      }
      const max = Math.max(1, Math.min(parseInt(enqForm.max_attempts, 10) || 3, 10));
      await api.post('/queue/', { name, payload, max_attempts: max });
      setEnqForm({ name: '', payload: '', max_attempts: 3 });
      await fetchAll();
    } catch (e) {
      setEnqErr(e?.response?.data?.error || e?.message || 'Enqueue failed.');
    } finally {
      setEnqBusy(false);
    }
  }

  // ── Alerts ─────────────────────────────────────────────────────────────
  async function handleResolveAlert(id) {
    try {
      await api.post(`/security/alerts/${id}/resolve/`, { note: '' });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Resolve failed.');
    }
  }
  async function handleSweep() {
    try {
      const r = await api.get('/security/alerts/sweep/');
      // The sweep endpoint returns the recent unresolved alerts. Merge.
      setAlerts(Array.isArray(r.data?.recent_alerts) ? r.data.recent_alerts : []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Sweep failed.');
    }
  }

  // ── Deployments ────────────────────────────────────────────────────────
  async function handleLogDeployment(e) {
    e.preventDefault();
    setDepBusy(true);
    try {
      await api.post('/deployments/', depForm);
      setDepForm({ kind: 'deploy', environment: 'production', status: 'success', commit_sha: '', notes: '' });
      await fetchAll();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Log failed.');
    } finally {
      setDepBusy(false);
    }
  }

  return (
    <div className="admin-devops">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">
            <i className="fas fa-screwdriver-wrench" aria-hidden="true"></i>
            {' '}{T('DevOps', 'DevOps')[lang]}
          </h1>
          <p className="admin-page__subtitle">
            {T('Maintenance, queue, alerts, deployments, and rate limits.', 'Antretyen, liy, alèt, deplwaman, ak limit vitès.')[lang]}
          </p>
        </div>
        <div className="admin-page__actions">
          <button type="button" className="admin-btn" onClick={fetchAll} disabled={loading} aria-label="Refresh">
            <i className={loading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'} aria-hidden="true"></i>
            {' '}{T('Refresh all', 'Rafrechi tout')[lang]}
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-error" role="alert">
          <i className="fas fa-triangle-exclamation" aria-hidden="true"></i> {error}
        </div>
      )}

      {/* ── 1. MAINTENANCE ─────────────────────────────────────────────── */}
      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-wrench" aria-hidden="true"></i> {T('Maintenance', 'Antretyen')[lang]}
        </h2>
        {maintenance.length > 0 && maintenance[0].is_active && (
          <div className="admin-error" style={{ background: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>{' '}
            {T('Maintenance is currently ACTIVE.', 'Antretyen aktif kounye a.')[lang]}
            <button
              type="button"
              className="admin-btn admin-btn--warning"
              style={{ marginLeft: 12 }}
              onClick={() => handleMaintenanceEnd(maintenance[0].id)}
            >
              {T('End it', 'Fini l')[lang]}
            </button>
          </div>
        )}
        <form className="admin-form" onSubmit={handleMaintenanceStart} style={{ marginTop: '0.75rem' }}>
          <div className="admin-form__row">
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="m-scope">{T('Scope', 'Skòp')[lang]}</label>
              <select
                id="m-scope"
                className="admin-form__select"
                value={maintScope}
                onChange={(e) => setMaintScope(e.target.value)}
              >
                <option value="read_only">{T('Read-only (banner only)', 'Li sèlman (banyè sèlman)')[lang]}</option>
                <option value="full_lockout">{T('Full lockout (503)', 'Bloke konplè (503)')[lang]}</option>
              </select>
            </div>
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="m-ends">{T('End at (optional)', 'Fini nan (opsyonèl)')[lang]}</label>
              <input id="m-ends" type="datetime-local" className="admin-form__input" value={maintEnds} onChange={(e) => setMaintEnds(e.target.value)} />
            </div>
          </div>
          <div className="admin-form__field">
            <label className="admin-form__label" htmlFor="m-msg">{T('Message', 'Mesaj')[lang]}</label>
            <input
              id="m-msg"
              type="text"
              className="admin-form__input"
              value={maintMessage}
              onChange={(e) => setMaintMessage(e.target.value)}
              maxLength={2000}
              placeholder={T('Shown to users in the maintenance banner.', 'Montre bay itilizatè yo nan banyè antretyen.')[lang]}
            />
          </div>
          <div>
            <button type="submit" className="admin-btn admin-btn--warning" disabled={maintBusy}>
              {maintBusy
                ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {T('Starting…', 'Ap kòmanse…')[lang]}</>
                : <><i className="fas fa-play" aria-hidden="true"></i> {T('Start maintenance', 'Kòmanse antretyen')[lang]}</>}
            </button>
          </div>
        </form>
        {maintenance.length > 0 && (
          <div className="admin-table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Scope', 'Skòp')[lang]}</th>
                  <th>{T('Message', 'Mesaj')[lang]}</th>
                  <th>{T('Started', 'Kòmanse')[lang]}</th>
                  <th>{T('Ends', 'Fini')[lang]}</th>
                  <th>{T('Status', 'Estati')[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {maintenance.slice(0, 10).map((m) => (
                  <tr key={m.id}>
                    <td><span className="admin-pill admin-pill--muted">{m.scope}</span></td>
                    <td>{m.message || '—'}</td>
                    <td>{formatDate(m.starts_at)}</td>
                    <td>{formatDate(m.ends_at)}</td>
                    <td>
                      {m.is_active
                        ? <span className="admin-pill admin-pill--warning">{T('Active', 'Aktif')[lang]}</span>
                        : <span className="admin-pill admin-pill--muted">{T('Ended', 'Fini')[lang]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 2. QUEUE ───────────────────────────────────────────────────── */}
      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-list-check" aria-hidden="true"></i> {T('Job queue', 'Liy travay')[lang]}
        </h2>
        {queue.stats && (
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: '0.85rem' }}>
            {[
              { v: queue.stats.pending,         l: T('Pending',     'An atant') },
              { v: queue.stats.running,         l: T('Running',     'Ap kouri') },
              { v: queue.stats.done,            l: T('Done',        'Fini') },
              { v: queue.stats.failed,          l: T('Failed',      'Echwe') },
              { v: queue.stats.dead,            l: T('Dead',        'Mouri') },
              { v: queue.stats.enqueued_24h,    l: T('Enq 24h',     'Anre 24h') },
              { v: queue.stats.completed_24h,   l: T('Done 24h',    'Fini 24h') },
            ].map((c) => (
              <div key={c.l} style={{ background: 'var(--bg-hover, #f8fafc)', padding: '0.55rem 0.7rem', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{c.v ?? 0}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.l[lang]}</div>
              </div>
            ))}
          </div>
        )}
        <form className="admin-form" onSubmit={handleEnqueue}>
          <div className="admin-form__row">
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="q-name">{T('Name', 'Non')[lang]}</label>
              <input id="q-name" className="admin-form__input" value={enqForm.name} onChange={(e) => setEnqForm({ ...enqForm, name: e.target.value })} maxLength={64} required />
            </div>
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="q-attempts">{T('Max attempts', 'Kantite maks')[lang]}</label>
              <input id="q-attempts" type="number" min={1} max={10} className="admin-form__input" value={enqForm.max_attempts} onChange={(e) => setEnqForm({ ...enqForm, max_attempts: e.target.value })} />
            </div>
          </div>
          <div className="admin-form__field">
            <label className="admin-form__label" htmlFor="q-payload">{T('Payload (JSON)', 'Payload (JSON)')[lang]}</label>
            <textarea
              id="q-payload"
              className="admin-form__textarea"
              value={enqForm.payload}
              onChange={(e) => setEnqForm({ ...enqForm, payload: e.target.value })}
              placeholder='{"key": "value"}'
              rows={3}
            />
          </div>
          {enqErr && <div className="admin-error" role="alert">{enqErr}</div>}
          <div>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={enqBusy}>
              {enqBusy
                ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {T('Enqueuing…', 'Anre…')[lang]}</>
                : <><i className="fas fa-plus" aria-hidden="true"></i> {T('Enqueue job', 'Anre travay')[lang]}</>}
            </button>
          </div>
        </form>
        {queue.items.length > 0 && (
          <div className="admin-table-wrap" style={{ marginTop: '0.85rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Name', 'Non')[lang]}</th>
                  <th>{T('Status', 'Estati')[lang]}</th>
                  <th>{T('Attempts', 'Kantite')[lang]}</th>
                  <th>{T('Run at', 'Kouri nan')[lang]}</th>
                  <th>{T('Last error', 'Dènye erè')[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {queue.items.slice(0, 20).map((j) => (
                  <tr key={j.id}>
                    <td><code style={{ fontSize: '0.78rem' }}>{j.name}</code></td>
                    <td><span className={`admin-pill ${JOB_STATUS_PILL[j.status] || 'admin-pill--muted'}`}>{j.status}</span></td>
                    <td>{j.attempts} / {j.max_attempts}</td>
                    <td>{formatDate(j.run_at)}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{j.last_error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. ALERTS ──────────────────────────────────────────────────── */}
      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-bell" aria-hidden="true"></i> {T('Security alerts', 'Alèt sekirite')[lang]}
        </h2>
        <div className="admin-page__actions" style={{ marginBottom: '0.5rem' }}>
          <button type="button" className="admin-btn" onClick={handleSweep}>
            <i className="fas fa-broom" aria-hidden="true"></i> {T('Run sweep', 'Fè yon balayaj')[lang]}
          </button>
        </div>
        {alerts.length === 0 ? (
          <div className="admin-empty">
            <i className="fas fa-shield-check" aria-hidden="true"></i>
            {T('No open alerts.', 'Pa gen alèt ouvri.')[lang]}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Kind', 'Kalite')[lang]}</th>
                  <th>{T('Severity', 'Gravite')[lang]}</th>
                  <th>{T('User', 'Itilizatè')[lang]}</th>
                  <th>{T('IP', 'IP')[lang]}</th>
                  <th>{T('Created', 'Kreye')[lang]}</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const pill = RESOLVED_PILL[String(a.resolved)] || RESOLVED_PILL.false;
                  return (
                    <tr key={a.id}>
                      <td><span className="admin-pill admin-pill--muted">{a.kind}</span></td>
                      <td><span className={`admin-pill ${SEVERITY_PILL[a.severity] || 'admin-pill--muted'}`}>{a.severity}</span></td>
                      <td>{a.user_username || '—'}</td>
                      <td>{a.ip_address || '—'}</td>
                      <td>{formatDate(a.created_at)}</td>
                      <td>
                        {!a.resolved && (
                          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => handleResolveAlert(a.id)}>
                            <i className="fas fa-check" aria-hidden="true"></i> {T('Resolve', 'Rezoud')[lang]}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 4. DEPLOYMENTS ─────────────────────────────────────────────── */}
      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-rocket" aria-hidden="true"></i> {T('Deployments', 'Deplwaman')[lang]}
        </h2>
        <form className="admin-form" onSubmit={handleLogDeployment}>
          <div className="admin-form__row">
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="d-kind">{T('Kind', 'Kalite')[lang]}</label>
              <input id="d-kind" className="admin-form__input" value={depForm.kind} onChange={(e) => setDepForm({ ...depForm, kind: e.target.value })} maxLength={16} />
            </div>
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="d-env">{T('Environment', 'Anviwònman')[lang]}</label>
              <input id="d-env" className="admin-form__input" value={depForm.environment} onChange={(e) => setDepForm({ ...depForm, environment: e.target.value })} maxLength={16} />
            </div>
          </div>
          <div className="admin-form__row">
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="d-status">{T('Status', 'Estati')[lang]}</label>
              <input id="d-status" className="admin-form__input" value={depForm.status} onChange={(e) => setDepForm({ ...depForm, status: e.target.value })} maxLength={16} />
            </div>
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="d-sha">{T('Commit SHA', 'SHA commit')[lang]}</label>
              <input id="d-sha" className="admin-form__input" value={depForm.commit_sha} onChange={(e) => setDepForm({ ...depForm, commit_sha: e.target.value })} maxLength={64} />
            </div>
          </div>
          <div className="admin-form__field">
            <label className="admin-form__label" htmlFor="d-notes">{T('Notes', 'Nòt')[lang]}</label>
            <textarea id="d-notes" className="admin-form__textarea" value={depForm.notes} onChange={(e) => setDepForm({ ...depForm, notes: e.target.value })} maxLength={4000} rows={2} />
          </div>
          <div>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={depBusy}>
              {depBusy
                ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {T('Logging…', 'Anrejistre…')[lang]}</>
                : <><i className="fas fa-plus" aria-hidden="true"></i> {T('Log event', 'Anrejistre evènman')[lang]}</>}
            </button>
          </div>
        </form>
        {deployments.length > 0 && (
          <div className="admin-table-wrap" style={{ marginTop: '0.85rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Kind', 'Kalite')[lang]}</th>
                  <th>{T('Env', 'Anviwònman')[lang]}</th>
                  <th>{T('Status', 'Estati')[lang]}</th>
                  <th>{T('SHA', 'SHA')[lang]}</th>
                  <th>{T('Actor', 'Aktè')[lang]}</th>
                  <th>{T('When', 'Kilè')[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {deployments.slice(0, 20).map((d) => (
                  <tr key={d.id}>
                    <td>{d.kind}</td>
                    <td>{d.environment}</td>
                    <td><span className={`admin-pill ${d.status === 'success' ? 'admin-pill--success' : d.status === 'failed' ? 'admin-pill--danger' : 'admin-pill--muted'}`}>{d.status}</span></td>
                    <td><code style={{ fontSize: '0.78rem' }}>{(d.commit_sha || '').slice(0, 7)}</code></td>
                    <td>{d.actor}</td>
                    <td>{formatDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 5. RATE LIMITS ─────────────────────────────────────────────── */}
      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-gauge-simple-high" aria-hidden="true"></i> {T('Rate limits', 'Limit vitès')[lang]}
        </h2>
        {rateLimits.by_bucket.length > 0 && (
          <div className="admin-table-wrap" style={{ marginBottom: '0.85rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Bucket', 'Bokit')[lang]}</th>
                  <th>{T('Entries', 'Antre')[lang]}</th>
                  <th>{T('Total count', 'Konte total')[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {rateLimits.by_bucket.map((b) => (
                  <tr key={b.bucket}>
                    <td><code style={{ fontSize: '0.8rem' }}>{b.bucket}</code></td>
                    <td>{b.total}</td>
                    <td>{b.total_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rateLimits.recent.length === 0 ? (
          <div className="admin-empty">
            <i className="fas fa-gauge-simple" aria-hidden="true"></i>
            {T('No active rate-limit buckets.', 'Pa gen bokit limit aktif.')[lang]}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Bucket', 'Bokit')[lang]}</th>
                  <th>{T('Key', 'kle')[lang]}</th>
                  <th>{T('Count', 'Konte')[lang]}</th>
                  <th>{T('Expires', 'Ekspire')[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {rateLimits.recent.slice(0, 30).map((r) => (
                  <tr key={r.id}>
                    <td><code style={{ fontSize: '0.8rem' }}>{r.bucket}</code></td>
                    <td><code style={{ fontSize: '0.78rem' }}>{r.key}</code></td>
                    <td>{r.count}</td>
                    <td>{formatDate(r.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
