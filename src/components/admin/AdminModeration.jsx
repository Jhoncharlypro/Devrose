/**
 * AdminModeration — Part 6 reports queue.
 *
 * Lists Report rows with optional filter (Pending | Resolved | All),
 * inline resolve form (note + remove_message toggle), and a Ban
 * action that creates a BannedUser row + force-logs the user out.
 *
 * Inline double-click confirm: a Ban click reveals "Confirm?" / "No"
 * for 4 seconds. A second click commits. This avoids modal-state
 * overhead for a single-step destructive action — see design-plan.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';

const T = (en, ht) => ({ en, ht });
const CONFIRM_WINDOW_MS = 4000;

function detectLang() {
  try {
    return (typeof window !== 'undefined' && (window.localStorage.getItem('lang') || 'en')) || 'en';
  } catch { return 'en'; }
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const REASON_LABELS = {
  spam:         { en: 'Spam',          ht: 'Spam' },
  harassment:   { en: 'Harassment',    ht: 'Relasyon' },
  fake_profile: { en: 'Fake profile',  ht: 'Fo pwofil' },
  violence:     { en: 'Violence',      ht: 'Vyolans' },
  scam:         { en: 'Scam',          ht: 'Escroquerie' },
  illegal:      { en: 'Illegal',       ht: 'Illegal' },
  copyright:    { en: 'Copyright',     ht: 'Dwa otè' },
  other:        { en: 'Other',         ht: 'Lòt' },
};

const TARGET_LABELS = {
  message: { en: 'Message',  ht: 'Mesaj' },
  image:   { en: 'Image',    ht: 'Imaj' },
  video:   { en: 'Video',    ht: 'Videyo' },
  voice:   { en: 'Voice',    ht: 'Vwa' },
  profile: { en: 'Profile',  ht: 'Pwofil' },
  group:   { en: 'Group',    ht: 'Gwoup' },
  call:    { en: 'Call',     ht: 'Apèl' },
};

export default function AdminModeration({ lang: langProp }) {
  const lang = langProp || detectLang();
  const [filter, setFilter] = useState('pending'); // 'pending' | 'resolved' | 'all'
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [resolveDrafts, setResolveDrafts] = useState({}); // { [id]: { note, remove_message } }
  const [pendingAction, setPendingAction] = useState(null); // { id, kind: 'ban', until }
  const [acting, setActing] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (filter === 'pending') params.resolved = 'false';
      else if (filter === 'resolved') params.resolved = 'true';
      const resp = await api.get('/admin/reports/', { params });
      setReports(Array.isArray(resp.data) ? resp.data : []);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401 || status === 403) {
        setError(T('You do not have permission to view the moderation queue.', 'Ou pa gen pèmisyon pou wè liy modèrasyon an.')[lang]);
      } else {
        setError(e?.response?.data?.error || e?.message || 'Failed to load reports.');
      }
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [filter, lang]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Inline confirm — auto-cancel after the window expires.
  useEffect(() => {
    if (!pendingAction) return;
    const t = setTimeout(() => setPendingAction(null), CONFIRM_WINDOW_MS);
    return () => clearTimeout(t);
  }, [pendingAction]);

  const setDraft = (id, patch) =>
    setResolveDrafts((prev) => ({ ...prev, [id]: { note: '', remove_message: false, ...prev[id], ...patch } }));

  async function handleResolve(report) {
    setActing(true);
    try {
      const draft = resolveDrafts[report.id] || {};
      await api.post(`/admin/reports/${report.id}/resolve/`, {
        note: draft.note || '',
        remove_message: !!draft.remove_message,
      });
      // Refresh locally without re-hitting the list (optimistic).
      setReports((prev) => prev.map((r) => r.id === report.id ? { ...r, resolved: true } : r));
      setExpandedId(null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Resolve failed.');
    } finally {
      setActing(false);
    }
  }

  async function handleBan(report) {
    setActing(true);
    try {
      await api.post(`/admin/reports/${report.id}/ban_user/`, { permanent: true });
      setReports((prev) => prev.map((r) => r.id === report.id ? { ...r, resolved: true } : r));
      setPendingAction(null);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Ban failed.');
    } finally {
      setActing(false);
    }
  }

  const tabs = useMemo(() => ([
    { key: 'pending',  label: T('Pending',  'An atant') },
    { key: 'resolved', label: T('Resolved', 'Rezoud') },
    { key: 'all',      label: T('All',      'Tout') },
  ]), [lang]);

  return (
    <div className="admin-moderation">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">
            <i className="fas fa-flag" aria-hidden="true"></i>
            {' '}{T('Moderation Queue', 'Liy Modèrasyon')[lang]}
          </h1>
          <p className="admin-page__subtitle">
            {T('Review user reports and take action.', 'Revize rapò itilizatè yo epi pran aksyon.')[lang]}
          </p>
        </div>
        <div className="admin-page__actions">
          <button type="button" className="admin-btn" onClick={fetchReports} disabled={loading} aria-label="Refresh">
            <i className={loading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'} aria-hidden="true"></i>
            {' '}{T('Refresh', 'Rafrechi')[lang]}
          </button>
        </div>
      </header>

      <div className="admin-tabs" role="tablist" aria-label="Report filter">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            className={`admin-tab${filter === t.key ? ' is-active' : ''}`}
            onClick={() => setFilter(t.key)}
          >
            {t.label[lang]}
          </button>
        ))}
      </div>

      {error && (
        <div className="admin-error" role="alert">
          <i className="fas fa-triangle-exclamation" aria-hidden="true"></i> {error}
        </div>
      )}

      {loading ? (
        <div className="admin-empty">
          <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
          {T('Loading reports…', 'Chajman rapò…')[lang]}
        </div>
      ) : reports.length === 0 ? (
        <div className="admin-empty">
          <i className="fas fa-check-circle" aria-hidden="true"></i>
          {T('No reports match this filter.', 'Pa gen rapò ki matche ak filtè sa a.')[lang]}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table" aria-label="Reports">
            <thead>
              <tr>
                <th>{T('Reason', 'Rezon')[lang]}</th>
                <th>{T('Target', 'Sib')[lang]}</th>
                <th>{T('Reporter', 'Moun ki rapòte')[lang]}</th>
                <th>{T('Reported user', 'Moun ki rapòte')[lang]}</th>
                <th>{T('Created', 'Kreye')[lang]}</th>
                <th>{T('Status', 'Estati')[lang]}</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const isExpanded = expandedId === r.id;
                const isConfirming = pendingAction?.id === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td>
                        <span className="admin-pill admin-pill--warning">
                          {REASON_LABELS[r.reason]?.[lang] || r.reason}
                        </span>
                      </td>
                      <td>
                        {TARGET_LABELS[r.target_type]?.[lang] || r.target_type} #{r.target_id}
                      </td>
                      <td>{r.reporter_username || `#${r.reporter}`}</td>
                      <td>{r.reported_username || `#${r.reported_user}`}</td>
                      <td>{formatDate(r.created_at)}</td>
                      <td>
                        {r.resolved ? (
                          <span className="admin-pill admin-pill--success">
                            {T('Resolved', 'Rezoud')[lang]}
                          </span>
                        ) : (
                          <span className="admin-pill admin-pill--warning">
                            {T('Pending', 'An atant')[lang]}
                          </span>
                        )}
                      </td>
                      <td>
                        {!r.resolved && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost"
                            onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          >
                            {isExpanded ? T('Close', 'Fèmen')[lang] : T('Review', 'Revize')[lang]}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && !r.resolved && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--bg-hover, #f8fafc)' }}>
                          <div className="admin-form" style={{ maxWidth: '100%' }}>
                            {r.description && (
                              <div className="admin-form__field">
                                <span className="admin-form__label">{T('Description', 'Deskripsyon')[lang]}</span>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary, #1f2937)' }}>
                                  {r.description}
                                </p>
                              </div>
                            )}
                            <div className="admin-form__field">
                              <label className="admin-form__label" htmlFor={`note-${r.id}`}>
                                {T('Resolution note', 'Nòt rezolisyon')[lang]}
                              </label>
                              <input
                                id={`note-${r.id}`}
                                type="text"
                                className="admin-form__input"
                                placeholder={T('Optional note for the audit log.', 'Nòt opsyonèl pou jounal audit.')[lang]}
                                value={(resolveDrafts[r.id]?.note) || ''}
                                onChange={(e) => setDraft(r.id, { note: e.target.value })}
                                maxLength={255}
                              />
                            </div>
                            {r.target_type === 'message' && (
                              <label className="admin-form__check">
                                <input
                                  type="checkbox"
                                  checked={!!resolveDrafts[r.id]?.remove_message}
                                  onChange={(e) => setDraft(r.id, { remove_message: e.target.checked })}
                                />
                                {T('Also remove the offending message', 'Efase mesaj la tou')[lang]}
                              </label>
                            )}
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="admin-btn admin-btn--primary"
                                onClick={() => handleResolve(r)}
                                disabled={acting}
                              >
                                <i className="fas fa-check" aria-hidden="true"></i> {T('Mark resolved', 'Make rezoud')[lang]}
                              </button>
                              {isConfirming ? (
                                <>
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--danger"
                                    onClick={() => handleBan(r)}
                                    disabled={acting}
                                  >
                                    <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
                                    {' '}{T('Confirm ban', 'Konfime entèdi')[lang]}
                                  </button>
                                  <button
                                    type="button"
                                    className="admin-btn"
                                    onClick={() => setPendingAction(null)}
                                    disabled={acting}
                                  >
                                    {T('Cancel', 'Anile')[lang]}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--danger"
                                  onClick={() => setPendingAction({ id: r.id, kind: 'ban' })}
                                  disabled={acting}
                                >
                                  <i className="fas fa-gavel" aria-hidden="true"></i> {T('Ban reported user', 'Entèdi itilizatè a')[lang]}
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
