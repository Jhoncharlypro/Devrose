/**
 * src/components/kot3chat/StoriesModal.jsx
 *
 * Self-contained, controlled modal for the Messenger-style "Stories" feature.
 * It holds BOTH the viewer (full-screen tap-through slideshow) and the
 * creator (palette+font+text|photo editor) so the host component doesn't
 * need to know which mode is active.
 *
 * UX model: only one of viewer/creator is open at a time. We expose this
 * via `mode` ('viewer' | 'creator' | null). The host passes derived state
 * (story list, viewing progress, draft text/image, palette, font) and
 * callbacks for every user action — this component does NOT own any state
 * itself so it stays trivially testable.
 *
 * Why a combined component
 * ------------------------
 * The original Kot3Chat.jsx inlined BOTH modals under the same React tree,
 * sharing derived helpers (getStatusListForId, pruneStories) and effects.
 * Splitting them into separate files would force us to pass that derived
 * surface across module boundaries, increasing prop surface area without
 * buying meaningful re-usability (Stories is unique to Kot3Chat).
 *
 * What this drops from the original module
 * ----------------------------------------
 * * The five-second ticker state — Kot3Chat stored `statusViewerTimerRef`
 *   and `statusViewStartRef` inside the host. We surface only the current
 *   progress as a derived prop (`viewerProgress` 0–100). The host owns the
 *   timer/interval; this component is pure presentational.
 * * localStorage persistence for `myStories` / `viewedStoryIds` / etc. —
 *   the host still owns those since they're domain state.
 *
 * Props (full reference)
 * -----------------------
 *
 * Common:
 *   isOpen      : boolean      (no render when false)
 *   mode        : 'viewer' | 'creator' | null
 *   onClose     : () => void
 *   lang        : 'ht' | 'en' | …
 *
 * Viewer mode:
 *   isPaused          : boolean          (hold-to-pause press)
 *   currentContactId  : string | number | 'me'
 *   contactMeta       : { name, avatar }
 *   stories           : Array<{ id, type, content, background, created_at }>
 *   storyIndex        : number           (0-based)
 *   progress          : number           (0..100, host-owned timer)
 *   viewedIds         : Set<id>          (turns the avatar ring grey)
 *   onNext            : () => void       (forward nav or cross-contact)
 *   onPrev            : () => void       (backward nav or cross-contact)
 *   onReply           : (text: string) => void
 *   onTogglePause     : (paused: boolean) => void
 *
 * Creator mode:
 *   draft           : { text, image, fontKey, paletteIdx, paletteType }
 *   fonts           : Array<{ key, family }>
 *   palette         : Array<string>    (CSS background values)
 *   supportedTypes  : Array<'text' | 'photo'>
 *   fileInputRef    : React.RefObject<HTMLInputElement>
 *   onChangeDraft   : (next: Partial<draft>) => void
 *   onPickImage     : (file: File) => void
 *   onPublish       : () => void
 *   isPublishable   : boolean
 */
import React, { useEffect } from 'react';
import './stories-modal.css';

export function StoriesModal({
  isOpen, mode, onClose, lang,
  // viewer
  isPaused, currentContactId, contactMeta, stories, storyIndex, progress, viewedIds,
  onNext, onPrev, onReply, onTogglePause,
  // creator
  draft, fonts, palette, supportedTypes, fileInputRef,
  onChangeDraft, onPickImage, onPublish, isPublishable,
}) {
  // Esc closes everything. We attach to document so the hotkey works no
  // matter which element owns focus inside the modal.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (mode === 'viewer' && e.key === 'ArrowRight') onNext?.();
      else if (mode === 'viewer' && e.key === 'ArrowLeft') onPrev?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, mode, onClose, onNext, onPrev]);

  if (!isOpen) return null;

  // ─────────── Viewer mode ───────────
  if (mode === 'viewer') {
    const safeIndex = Math.max(0, Math.min(storyIndex || 0, (stories?.length || 1) - 1));
    const story = stories?.[safeIndex];
    if (!story) {
      // Empty state — the host shouldn't normally pass stories=[], but if
      // the user opens their own status while it's empty we close cleanly.
      onClose?.();
      return null;
    }
    const meta = contactMeta || { name: 'User', avatar: '' };
    const isTextStory = (story.type || 'text') === 'text';

    return (
      <div
        className="kot3-status-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={lang === 'ht' ? 'Gade yon estati' : 'View status'}
        onMouseDown={() => onTogglePause?.(true)}
        onMouseUp={() => onTogglePause?.(false)}
        onMouseLeave={() => onTogglePause?.(false)}
        onTouchStart={() => onTogglePause?.(true)}
        onTouchEnd={() => onTogglePause?.(false)}
      >
        <div className="kot3-status-container">
          <div className="kot3-status-header">
            <div className="kot3-status-progress-bar">
              {(stories || []).map((_, idx) => (
                <div key={idx} className="kot3-progress-segment">
                  <div
                    className="kot3-progress-filler"
                    style={{
                      width: idx < safeIndex ? '100%' : idx === safeIndex ? `${Math.max(0, Math.min(100, progress || 0))}%` : '0%',
                      transition: isPaused ? 'none' : 'width 0.1s linear',
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="kot3-status-user-info">
              <div className="kot3-status-user-details">
                {meta.avatar ? (
                  <img className="kot3-status-user-avatar" src={meta.avatar} alt="" />
                ) : (
                  <div
                    className="kot3-status-user-avatar"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255,255,255,0.20)', fontWeight: 800,
                    }}
                  >
                    {(meta.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="kot3-status-user-name">
                    {currentContactId === 'me'
                      ? (lang === 'ht' ? 'Mwen Menm' : 'You')
                      : `@${meta.name}`}
                  </div>
                  <div className="kot3-status-time-passed">
                    {story.created_at ? new Date(story.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="kot3-status-close-btn"
                onClick={onClose}
                aria-label={lang === 'ht' ? 'Fème estati' : 'Close status'}
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="kot3-status-content">
            {isTextStory ? (
              <div
                className="kot3-status-text-wrap"
                style={story.background
                  ? { background: story.background }
                  : { background: 'linear-gradient(135deg, #ff8a00, #e52e71)' }}
              >
                {story.content}
              </div>
            ) : (
              <img
                className="kot3-status-media"
                src={story.content}
                alt=""
                draggable={false}
              />
            )}

            <button
              type="button"
              className="kot3-status-nav-btn prev"
              aria-label={lang === 'ht' ? 'Estati anvan' : 'Previous status'}
              onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
            >
              <i className="fas fa-chevron-left" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="kot3-status-nav-btn next"
              aria-label={lang === 'ht' ? 'Pwochen estati' : 'Next status'}
              onClick={(e) => { e.stopPropagation(); onNext?.(); }}
            >
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </button>
          </div>

          {currentContactId !== 'me' && (
            <form
              className="kot3-status-footer"
              onSubmit={(e) => {
                e.preventDefault();
                const value = e.currentTarget.elements.namedItem('replyText')?.value;
                if (value && value.trim()) onReply?.(value);
              }}
            >
              <input
                name="replyText"
                className="kot3-status-reply-input"
                placeholder={lang === 'ht' ? 'Reponn...' : 'Reply...'}
                aria-label={lang === 'ht' ? 'Reponn' : 'Reply'}
              />
              <button
                type="submit"
                className="kot3-status-reply-send"
                aria-label={lang === 'ht' ? 'Voye repons' : 'Send reply'}
              >
                <i className="fas fa-paper-plane" aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ─────────── Creator mode ───────────
  const draftSafe = draft || { text: '', image: '', fontKey: 'modern', paletteIdx: 0, paletteType: 'gradient' };
  const fontCfg = (fonts || []).find(f => f.key === draftSafe.fontKey) || (fonts || [])[0];
  const bgStyle = draftSafe.image
    ? undefined
    : { background: (palette || [])[draftSafe.paletteIdx] || '' || draftSafe.paletteIdx };

  return (
    <div
      className="kot3-creator-modal"
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'ht' ? 'Kreye yon estati' : 'Create status'}
    >
      <div className="kot3-creator-card">
        <header className="kot3-creator-header">
          <h3>{lang === 'ht' ? 'Kreye yon estati' : 'Create status'}</h3>
          <button
            type="button"
            className="kot3-status-close-btn"
            onClick={onClose}
            aria-label={lang === 'ht' ? 'Fème' : 'Close'}
            style={{ color: 'var(--text-primary)' }}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </header>

        <div className="kot3-creator-body">
          {/* ───── tabs for creator type ───── */}
          <div role="tablist" style={{ display: 'flex', gap: 8 }}>
            {(supportedTypes || ['text', 'photo']).map((t) => (
              <button
                type="button"
                role="tab"
                aria-selected={draftSafe.paletteType === t || (t === 'photo' && !!draftSafe.image)}
                key={t}
                className="kot3-creator-tab-btn"
                style={{
                  flex: 1, padding: '8px 10px',
                  borderRadius: 10, border: '1px solid var(--border-color)',
                  background: (draftSafe.paletteType === t || (t === 'photo' && !!draftSafe.image))
                    ? 'rgba(var(--primary-rgb), 0.16)'
                    : 'transparent',
                  color: 'var(--text-primary)',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                }}
                onClick={() => onChangeDraft?.({ paletteType: t })}
              >
                {t === 'text' ? <><i className="fas fa-font" aria-hidden="true" /> {lang === 'ht' ? 'Tèks' : 'Text'}</> : <><i className="fas fa-image" aria-hidden="true" /> {lang === 'ht' ? 'Foto' : 'Photo'}</>}
              </button>
            ))}
          </div>

          {/* ───── live preview ───── */}
          <div className="kot3-preview-box" style={bgStyle}>
            {draftSafe.image ? (
              <div className="kot3-preview-photo-wrap">
                <img src={draftSafe.image} className="kot3-preview-photo" alt="" />
                <button
                  type="button"
                  className="kot3-preview-photo-remove"
                  aria-label={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                  onClick={() => onChangeDraft?.({ image: '' })}
                >
                  <i className="fas fa-times" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={draftSafe.text || ''}
                onChange={(e) => onChangeDraft?.({ text: e.target.value })}
                placeholder={lang === 'ht' ? 'Ekri yon status...' : 'Type a status...'}
                className="kot3-preview-input"
                style={{ fontFamily: fontCfg?.family }}
                aria-label={lang === 'ht' ? 'Tèks estati' : 'Status text'}
                maxLength={140}
              />
            )}
          </div>

          {/* ───── photo picker (only when image is selected) ───── */}
          {draftSafe.image ? null : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onPickImage?.(file);
                  // Allow same file to be re-selected.
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn-cancel"
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border-color)',
                  background: 'rgba(var(--primary-rgb), 0.06)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 12, fontWeight: 600,
                }}
                onClick={() => fileInputRef?.current?.click()}
              >
                <i className="fas fa-camera" aria-hidden="true" /> {lang === 'ht' ? 'Chwazi yon foto' : 'Pick a photo'}
              </button>
            </>
          )}

          {/* ───── font picker ───── */}
          {!draftSafe.image && (
            <div className="kot3-creator-tool-row">
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {lang === 'ht' ? 'Polis' : 'Font'}
              </span>
              <div className="kot3-gradient-selector">
                {(fonts || []).slice(0, 3).map((f) => (
                  <button
                    type="button"
                    key={f.key}
                    className={`kot3-grad-dot ${draftSafe.fontKey === f.key ? 'active' : ''}`}
                    style={{
                      background: 'rgba(var(--primary-rgb), 0.20)',
                      color: 'var(--text-primary)',
                      width: 32, height: 24,
                      fontFamily: f.family,
                      fontWeight: 700, fontSize: 12,
                      border: '2px solid transparent',
                      borderColor: draftSafe.fontKey === f.key ? 'var(--text-primary)' : 'transparent',
                      cursor: 'pointer', borderRadius: 999,
                    }}
                    onClick={() => onChangeDraft?.({ fontKey: f.key })}
                    aria-pressed={draftSafe.fontKey === f.key}
                  >
                    Aa
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ───── palette ───── */}
          {!draftSafe.image && (
            <div className="kot3-creator-tool-row">
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {lang === 'ht' ? 'Koulè' : 'Palette'}
              </span>
              <div className="kot3-gradient-selector">
                {(palette || []).map((bg, idx) => (
                  <button
                    type="button"
                    key={`${idx}-${bg}`}
                    className={`kot3-grad-dot ${draftSafe.paletteIdx === idx ? 'active' : ''}`}
                    style={{ background: bg, width: 22, height: 22, borderRadius: '50%' }}
                    aria-label={`Palette ${idx + 1}`}
                    onClick={() => onChangeDraft?.({ paletteIdx: idx })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ───── actions ───── */}
          <div className="kot3-creator-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              {lang === 'ht' ? 'Anile' : 'Cancel'}
            </button>
            <button
              type="button"
              className="btn-publish"
              onClick={onPublish}
              disabled={!isPublishable}
            >
              {lang === 'ht' ? 'Pibliye' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StoriesModal;
