/**
 * AdminBroadcasts — Part 6 announcement system.
 *
 * Two halves:
 *   1. Composer — pick severity + audience + message, POST to /api/admin/broadcasts/.
 *      BE publishes to the global 'system_broadcast' Channels group on success,
 *      so any connected MaintenanceBanner / chat session lights up.
 *   2. List — every prior broadcast (active + deactivated), with a Deactivate
 *      action (DELETE → soft-deactivate).
 *
 * Auto-refresh every 30s: the BE's create endpoint pushes to Channels, but
 * a second device or a different admin shouldn't have to wait for an event
 * — a 30s poll is cheap (single list endpoint) and keeps the panel honest.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

const T = (en, ht) => ({ en, ht });

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

const SEVERITY_PILL = {
  info:        'admin-pill--info',
  warning:     'admin-pill--warning',
  critical:    'admin-pill--danger',
  maintenance: 'admin-pill--muted',
};

const SEVERITY_OPTIONS = [
  { value: 'info',     label: { en: 'Info',         ht: 'Enfòmasyon' } },
  { value: 'warning',  label: { en: 'Warning',      ht: 'Avètisman' } },
  { value: 'critical', label: { en: 'Critical',     ht: 'Kritik' } },
];

const AUDIENCE_OPTIONS = [
  { value: 'all',     label: { en: 'All users',          ht: 'Tout itilizatè yo' } },
  { value: 'staff',   label: { en: 'Staff / admin only', ht: 'Eksepte admin' } },
  { value: 'premium', label: { en: 'Premium users only', ht: 'Itilizatè premium' } },
];

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const REFRESH_MS = 30_000;

export default function AdminBroadcasts({ lang: langProp }) {
  const lang = langProp || detectLang();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [form, setForm] = useState({ message: '', severity: 'info', audience: 'all', ends_at: '' });

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.get('/admin/broadcasts/');
      setItems(Array.isArray(resp.data) ? resp.data : []);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401 || status === 403) {
        setError(T('You do not have permission to view broadcasts.', 'Ou pa gen pèmisyon pou wè anons yo.')[lang]);
      } else {
        setError(e?.response?.data?.error || e?.message || 'Failed to load broadcasts.');
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    fetchList();
    const t = setInterval(fetchList, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchList]);

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const message = (form.message || '').trim();
    if (!message) {
      setFormError(T('Message is required.', 'Mesaj obligatwa.')[lang]);
      return;
    }
    if (message.length > 2000) {
      setFormError(T('Message is too long (max 2000 chars).', 'Mesaj twò long (max 2000 karaktè).')[lang]);
      return;
    }
    setSubmitting(true);
    try {
      const payload = { message, severity: form.severity, audience: form.audience };
      if (form.ends_at) {
        // Convert datetime-local string to ISO; the BE uses parse_datetime.
        try {
          payload.ends_at = new Date(form.ends_at).toISOString();
        } catch {
          // fall through — BE will reject on its own
        }
      }
      await api.post('/admin/broadcasts/', payload);
      setForm({ message: '', severity: 'info', audience: 'all', ends_at: '' });
      await fetchList();
    } catch (e) {
      setFormError(e?.response?.data?.error || e?.message || 'Broadcast failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id) {
    if (!window.confirm(T('Deactivate this broadcast?', 'Deaktive anons sa a?')[lang])) return;
    try {
      await api.delete(`/admin/broadcasts/${id}/`);
      // Optimistic local update.
      setItems((prev) => prev.map((b) => b.id === id ? { ...b, is_active: false } : b));
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Deactivate failed.');
    }
  }

  return (
    <div className="admin-broadcasts">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">
            <i className="fas fa-bullhorn" aria-hidden="true"></i>
            {' '}{T('Broadcasts', 'Anons')[lang]}
          </h1>
          <p className="admin-page__subtitle">
            {T('Send in-app announcements to all users or a segment.', 'Voye anons nan aplikasyon an bay tout moun oswa yon segment.')[lang]}
          </p>
        </div>
        <div className="admin-page__actions">
          <button type="button" className="admin-btn" onClick={fetchList} disabled={loading} aria-label="Refresh">
            <i className={loading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'} aria-hidden="true"></i>
            {' '}{T('Refresh', 'Rafrechi')[lang]}
          </button>
        </div>
      </header>

      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-pen" aria-hidden="true"></i> {T('New broadcast', 'Nouvo anons')[lang]}
        </h2>
        <p className="admin-section__subtitle">
          {T('A Channels message is published to every connected client on success.', 'Yon mesaj Channels ap pibliye bay tout kliyan ki konekte.')[lang]}
        </p>
        <form className="admin-form" onSubmit={handleSubmit}>
          <div className="admin-form__field">
            <label className="admin-form__label" htmlFor="bc-message">{T('Message', 'Mesaj')[lang]}</label>
            <textarea
              id="bc-message"
              className="admin-form__textarea"
              value={form.message}
              onChange={(e) => updateForm({ message: e.target.value })}
              maxLength={2000}
              required
              rows={3}
              placeholder={T('What do you want to tell your users?', 'Kisa ou vle di itilizatè ou yo?')[lang]}
            />
          </div>
          <div className="admin-form__row">
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="bc-severity">{T('Severity', 'Gravite')[lang]}</label>
              <select
                id="bc-severity"
                className="admin-form__select"
                value={form.severity}
                onChange={(e) => updateForm({ severity: e.target.value })}
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label[lang]}</option>
                ))}
              </select>
            </div>
            <div className="admin-form__field">
              <label className="admin-form__label" htmlFor="bc-audience">{T('Audience', 'Odyans')[lang]}</label>
              <select
                id="bc-audience"
                className="admin-form__select"
                value={form.audience}
                onChange={(e) => updateForm({ audience: e.target.value })}
              >
                {AUDIENCE_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label[lang]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="admin-form__field">
            <label className="admin-form__label" htmlFor="bc-ends">{T('End at (optional)', 'Fini nan (opsyonèl)')[lang]}</label>
            <input
              id="bc-ends"
              type="datetime-local"
              className="admin-form__input"
              value={form.ends_at}
              onChange={(e) => updateForm({ ends_at: e.target.value })}
            />
          </div>
          {formError && <div className="admin-error" role="alert">{formError}</div>}
          <div>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={submitting}>
              {submitting
                ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {T('Sending…', 'Ap voye…')[lang]}</>
                : <><i className="fas fa-paper-plane" aria-hidden="true"></i> {T('Send broadcast', 'Voye anons')[lang]}</>}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-section">
        <h2 className="admin-section__title">
          <i className="fas fa-list" aria-hidden="true"></i> {T('Past broadcasts', 'Anons ki pase yo')[lang]}
        </h2>
        {error && <div className="admin-error" role="alert">{error}</div>}
        {loading ? (
          <div className="admin-empty">
            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
            {T('Loading…', 'Chajman…')[lang]}
          </div>
        ) : items.length === 0 ? (
          <div className="admin-empty">
            <i className="fas fa-bell-slash" aria-hidden="true"></i>
            {T('No broadcasts yet.', 'Pa gen anons poko.')[lang]}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{T('Severity', 'Gravite')[lang]}</th>
                  <th>{T('Audience', 'Odyans')[lang]}</th>
                  <th>{T('Message', 'Mesaj')[lang]}</th>
                  <th>{T('Starts', 'Kòmanse')[lang]}</th>
                  <th>{T('Ends', 'Fini')[lang]}</th>
                  <th>{T('Status', 'Estati')[lang]}</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className={`admin-pill ${SEVERITY_PILL[b.severity] || 'admin-pill--muted'}`}>
                        {b.severity}
                      </span>
                    </td>
                    <td>
                      <span className="admin-pill admin-pill--muted">{b.audience}</span>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div style={{ fontWeight: 600 }}>{b.message}</div>
                      {b.created_by_username && (
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary, #94a3b8)' }}>
                          {T('by', 'pa')[lang]} {b.created_by_username}
                        </div>
                      )}
                    </td>
                    <td>{formatDate(b.starts_at)}</td>
                    <td>{formatDate(b.ends_at)}</td>
                    <td>
                      {b.is_active ? (
                        <span className="admin-pill admin-pill--success">{T('Active', 'Aktif')[lang]}</span>
                      ) : (
                        <span className="admin-pill admin-pill--muted">{T('Inactive', 'Inaktif')[lang]}</span>
                      )}
                    </td>
                    <td>
                      {b.is_active && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost"
                          onClick={() => handleDeactivate(b.id)}
                        >
                          <i className="fas fa-power-off" aria-hidden="true"></i> {T('Deactivate', 'Deaktive')[lang]}
                        </button>
                      )}
                    </td>
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
