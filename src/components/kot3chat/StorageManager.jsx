/**
 * src/components/kot3chat/StorageManager.jsx
 *
 * Premium Storage Manager. Bars showing per-category footprint
 * (Images / Videos / Voice / Documents / Cache), with "Clear Cache",
 * "Delete Downloads", and "Manage Storage" buttons.
 *
 * The host provides `usage` and `onClearCache` / `onDeleteDownloads` /
 * `onManageStorage` callbacks. The component is purely presentational;
 * the host's callbacks route to the actual storage backend
 * (`localStorage` for cache, CacheStorage API for downloaded media).
 */
import React from 'react';

const LABELS = {
  images:    { label: 'msg_storage_images',    icon: 'fa-image',     accent: '#e91e63' },
  videos:    { label: 'msg_storage_videos',    icon: 'fa-video',     accent: '#0084ff' },
  voice:     { label: 'msg_storage_voice',     icon: 'fa-microphone',accent: '#9c27b0' },
  documents: { label: 'msg_storage_documents', icon: 'fa-file-alt',  accent: '#ff9500' },
  cache:     { label: 'msg_storage_cache',     icon: 'fa-bolt',      accent: '#34c759' },
  other:     { label: 'msg_storage_other',     icon: 'fa-database',  accent: '#90949c' },
};

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B','KB','MB','GB'];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
};

export function StorageManager({
  usage = {},
  total = 0,
  onClearCache,
  onDeleteDownloads,
  onManageStorage,
  t = {},
}) {
  const limit = usage.limit || 5 * 1024 * 1024 * 1024; // 5GB default
  const used = usage.used || total || Object.values(usage).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const pct = Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="kot3-storage-manager">
      <section className="kot3-storage-meter">
        <div className="kot3-storage-meter-ring">
          <svg viewBox="0 0 100 100" aria-label="Storage usage">
            <circle cx="50" cy="50" r="44" className="kot3-storage-ring-track" />
            <circle
              cx="50"
              cy="50"
              r="44"
              className="kot3-storage-ring-progress"
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${2 * Math.PI * 44 * (1 - pct / 100)}`}
            />
          </svg>
          <div className="kot3-storage-meter-label">
            <div className="kot3-storage-meter-pct">{pct}%</div>
            <div className="kot3-storage-meter-usage">
              {formatSize(used)} / {formatSize(limit)}
            </div>
          </div>
        </div>
      </section>

      <section className="kot3-storage-bars">
        {Object.entries(usage).filter(([k]) => LABELS[k] && k !== 'limit' && k !== 'used').map(([k, bytes]) => {
          const cfg = LABELS[k];
          const portion = used > 0 ? Math.min(1, bytes / used) : 0;
          return (
            <div key={k} className="kot3-storage-bar">
              <div className="kot3-storage-bar-row1">
                <span className="kot3-storage-bar-name">
                  <i className={`fas ${cfg.icon}`} style={{ color: cfg.accent }} aria-hidden="true" />
                  {t[cfg.label] || k}
                </span>
                <span className="kot3-storage-bar-size">{formatSize(bytes)}</span>
              </div>
              <div className="kot3-storage-bar-track">
                <div
                  className="kot3-storage-bar-fill"
                  style={{ width: `${portion * 100}%`, background: cfg.accent }}
                />
              </div>
            </div>
          );
        })}
      </section>

      <section className="kot3-storage-actions">
        <button type="button" className="primary" onClick={onClearCache}>
          <i className="fas fa-broom" aria-hidden="true" />
          <span>{t.msg_storage_clear_cache || 'Clear Cache'}</span>
        </button>
        <button type="button" onClick={onDeleteDownloads}>
          <i className="fas fa-trash" aria-hidden="true" />
          <span>{t.msg_storage_delete_downloads || 'Delete Downloads'}</span>
        </button>
        <button type="button" className="ghost" onClick={onManageStorage}>
          <i className="fas fa-cog" aria-hidden="true" />
          <span>{t.msg_storage_manage || 'Manage Storage'}</span>
        </button>
      </section>
    </div>
  );
}

export default StorageManager;
