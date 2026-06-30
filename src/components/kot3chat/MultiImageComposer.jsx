/**
 * src/components/kot3chat/MultiImageComposer.jsx
 *
 * Multi-image attachment queue. The host feeds this component an
 * `items` array shaped as:
 *
 *   { id, dataUrl, filename, size, progress: 0..100, status: 'pending'|'uploading'|'failed' }
 *
 * The host updates `progress` over time (e.g. via XHR progress events
 * from a Supabase upload). The host is responsible for calling
 * onSend() with the queue when the user hits send, and onRemove(id)
 * to drop an entry.
 *
 * This component is purely presentational; the upload pipeline lives in
 * the host.
 */
import React from 'react';

export function MultiImageComposer({ items = [], onRemove, onSend, sending = false, t = {} }) {
  if (!items || items.length === 0) return null;

  const total = items.length;
  const fullSize = items.reduce((sum, x) => sum + (x.size || 0), 0);
  const ready = items.filter((x) => x.status === 'pending' || x.status === 'uploading' || x.progress >= 100).length;

  return (
    <div className="kot3-multi-image-composer-wrap">
      <div className="kot3-multi-image-queue" role="list" aria-label={t.msg_images || 'Images'}>
        {items.map((it) => (
          <div className="kot3-multi-image-tile" role="listitem" key={it.id}>
            {it.dataUrl ? <img src={it.dataUrl} alt="" /> : <div style={{ background: 'var(--bg-app)', width: '100%', height: '100%' }} />}
            {typeof it.progress === 'number' && it.progress < 100 && (
              <>
                <div className="kot3-multi-image-progress-bar"><i style={{ width: `${it.progress}%` }} /></div>
                <div className="kot3-multi-image-progress">{Math.round(it.progress)}%</div>
              </>
            )}
            {it.status === 'failed' && (
              <div className="kot3-multi-image-progress" style={{ background: 'rgba(255,59,48,0.65)' }}>{t.msg_image_failed || 'Failed'}</div>
            )}
            <button type="button" className="kot3-multi-image-remove" onClick={() => onRemove?.(it.id)} aria-label={t.common_remove || 'Remove'}>
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 14px',
        background: 'color-mix(in srgb, var(--bg-sidebar) 60%, transparent)',
        borderTop: '1px solid rgba(var(--primary-rgb), 0.10)',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-secondary)',
      }}>
        <span>{ready}/{total} ready · {(fullSize / 1024 / 1024).toFixed(1)} MB</span>
        <button
          type="button"
          disabled={sending || ready < total}
          onClick={() => onSend?.()}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: sending || ready < total
              ? 'rgba(var(--primary-rgb), 0.20)'
              : 'var(--primary-gradient)',
            color: sending || ready < total ? 'var(--text-secondary)' : '#ffffff',
            fontSize: 12,
            fontWeight: 700,
            cursor: sending || ready < total ? 'not-allowed' : 'pointer',
            boxShadow: sending || ready < total ? 'none' : '0 4px 10px rgba(var(--primary-rgb), 0.30)',
          }}
        >
          {sending ? (t.common_send + '…') : (t.common_send || 'Send')}
        </button>
      </div>
    </div>
  );
}

export default MultiImageComposer;
