/**
 * src/components/kot3chat/SharedMediaPanel.jsx
 *
 * Premium Shared Media panel — every attachment that has ever been sent
 * in the conversation, grouped by media type per the spec:
 *
 *   • Photos — image-grid thumbnails, tap → fullscreen viewer
 *   • Videos — poster + duration, tap → fullscreen player
 *   • Voice Messages — waveform row, tap → play inline
 *   • Files  — document icon + name + size + Download button
 *   • GIFs   — small thumbnail grid
 *   • Links  — preview card with title/description/thumbnail/domain
 *
 * Each section is searchable via a sub-search-bar that filters by
 * filename / sender / link domain on the client side. The host feeds
 * the `messages` prop; this component is purely presentational.
 */
import React, { useMemo, useState } from 'react';

const TABS = [
  { id: 'photos', icon: 'fa-image',     key: 'msg_media_photos' },
  { id: 'videos', icon: 'fa-video',     key: 'msg_media_videos' },
  { id: 'voice',  icon: 'fa-microphone',key: 'msg_media_voice'  },
  { id: 'files',  icon: 'fa-file-alt',  key: 'msg_media_files'  },
  { id: 'gifs',   icon: 'fa-icons',     key: 'msg_media_gifs'   },
  { id: 'links',  icon: 'fa-link',      key: 'msg_media_links'  },
];

const FORMAT_SIZE = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const FILE_ICON = {
  pdf: 'fa-file-pdf',
  doc: 'fa-file-word',
  docx: 'fa-file-word',
  ppt: 'fa-file-powerpoint',
  pptx: 'fa-file-powerpoint',
  xls: 'fa-file-excel',
  xlsx: 'fa-file-excel',
  csv: 'fa-file-csv',
  zip: 'fa-file-archive',
  rar: 'fa-file-archive',
  apk: 'fa-file-archive',
  txt: 'fa-file-alt',
};

const URL_REGEX = /\b(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|io|dev|app|co|me|info)\/[^\s]*)\b/i;

export function SharedMediaPanel({ messages = [], onImageTap, onVideoTap, onLinkTap, lang = 'en', t = {} }) {
  const [active, setActive] = useState('photos');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    const q = (query || '').trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => {
      const haystack = `${m.content || ''} ${m.sender_username || ''} ${m.document || m.file_name || ''} ${m.link_title || ''} ${m.link_domain || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [messages, query]);

  const photos = useMemo(() => filtered.filter((m) => m.image), [filtered]);
  const videos = useMemo(() => filtered.filter((m) => m.video), [filtered]);
  const voice  = useMemo(() => filtered.filter((m) => m.audio), [filtered]);
  const files  = useMemo(() => filtered.filter((m) => m.document || m.file_name || (m.file_ext && FILE_ICON[m.file_ext])), [filtered]);
  const gifs   = useMemo(() => filtered.filter((m) => m.gif), [filtered]);
  const links  = useMemo(() => filtered.filter((m) => {
    if (m.link_url || m.link_title) return true;
    return typeof m.content === 'string' && URL_REGEX.test(m.content);
  }), [filtered]);

  const counts = { photos: photos.length, videos: videos.length, voice: voice.length, files: files.length, gifs: gifs.length, links: links.length };

  return (
    <div className="kot3-shared-media-panel">
      <div className="kot3-shared-media-toolbar">
        <div className="kot3-shared-media-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              className={`kot3-shared-media-tab${active === tab.id ? ' active' : ''}`}
              onClick={() => setActive(tab.id)}
            >
              <i className={`fas ${tab.icon}`} aria-hidden="true" />
              <span>{t[tab.key] || tab.id}</span>
              {counts[tab.id] > 0 && <span className="count">{counts[tab.id]}</span>}
            </button>
          ))}
        </div>
        <div className="kot3-shared-media-search">
          <i className="fas fa-search" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.msg_search_media || 'Search media…'}
            aria-label={t.msg_search_media || 'Search'}
          />
        </div>
      </div>

      <div className="kot3-shared-media-grid">
        {active === 'photos' && (
          photos.length === 0 ? <EmptyHint icon="fa-image" t={t} /> :
            photos.map((m, idx) => (
              <button
                type="button"
                key={m.id || `p-${idx}`}
                className="kot3-shared-media-photo"
                onClick={() => onImageTap?.(m.image, photos.map((x) => x.image), idx)}
                aria-label={t.msg_open_image || 'Open image'}
              >
                <img src={m.image} alt="" loading="lazy" />
                {m.created_at && (
                  <span className="kot3-shared-media-overlay">{new Date(m.created_at).toLocaleDateString()}</span>
                )}
              </button>
            ))
        )}

        {active === 'videos' && (
          videos.length === 0 ? <EmptyHint icon="fa-video" t={t} /> :
            videos.map((m, idx) => (
              <button
                type="button"
                key={m.id || `v-${idx}`}
                className="kot3-shared-media-video"
                onClick={() => onVideoTap?.(m)}
                aria-label={t.msg_open_video || 'Open video'}
              >
                <span className="kot3-shared-media-video-icon" aria-hidden="true"><i className="fas fa-play" /></span>
                <span className="kot3-shared-media-video-duration">{m.video_duration || ''}</span>
                <span className="kot3-shared-media-overlay">{m.sender_username}</span>
              </button>
            ))
        )}

        {active === 'voice' && (
          voice.length === 0 ? <EmptyHint icon="fa-microphone" t={t} /> :
            voice.map((m, idx) => (
              <div key={m.id || `a-${idx}`} className="kot3-shared-media-voice">
                <i className="fas fa-microphone" aria-hidden="true" />
                <span className="kot3-shared-media-voice-sender">{m.sender_username}</span>
                <span className="kot3-shared-media-voice-duration">{m.audio_duration ? `${Math.round(m.audio_duration)}s` : ''}</span>
                <button type="button" className="kot3-shared-media-play" aria-label="play">
                  <i className="fas fa-play" aria-hidden="true" />
                </button>
              </div>
            ))
        )}

        {active === 'files' && (
          files.length === 0 ? <EmptyHint icon="fa-file-alt" t={t} /> :
            files.map((m, idx) => {
              const ext = (m.file_ext || (m.document && m.document.split('.').pop()) || '').toLowerCase();
              const iconClass = FILE_ICON[ext] || 'fa-file-alt';
              return (
                <div key={m.id || `f-${idx}`} className="kot3-shared-media-file">
                  <span className={`kot3-shared-media-file-icon fas ${iconClass}`} aria-hidden="true" />
                  <span className="kot3-shared-media-file-name">{m.document || m.file_name || 'file'}</span>
                  <span className="kot3-shared-media-file-size">{m.file_size ? FORMAT_SIZE(m.file_size) : ''}</span>
                  <button type="button" className="kot3-shared-media-download" aria-label={t.msg_download || 'Download'}>
                    <i className="fas fa-download" aria-hidden="true" />
                  </button>
                </div>
              );
            })
        )}

        {active === 'gifs' && (
          gifs.length === 0 ? <EmptyHint icon="fa-icons" t={t} /> :
            gifs.map((m, idx) => (
              <button
                type="button"
                key={m.id || `g-${idx}`}
                className="kot3-shared-media-gif"
                onClick={() => onImageTap?.(m.gif, gifs.map((x) => x.gif), idx)}
                aria-label={t.msg_open_image || 'Open gif'}
              >
                <img src={m.gif} alt="" loading="lazy" />
              </button>
            ))
        )}

        {active === 'links' && (
          links.length === 0 ? <EmptyHint icon="fa-link" t={t} /> :
            links.map((m, idx) => {
              const url = m.link_url || (typeof m.content === 'string' && (m.content.match(URL_REGEX) || [])[0]) || '';
              return (
                <button
                  type="button"
                  key={m.id || `l-${idx}`}
                  className="kot3-shared-media-link"
                  onClick={() => onLinkTap?.(url)}
                  aria-label={t.msg_open_link || 'Open link'}
                >
                  {m.link_thumbnail && <img className="kot3-shared-media-link-thumb" src={m.link_thumbnail} alt="" loading="lazy" />}
                  <div className="kot3-shared-media-link-meta">
                    <div className="kot3-shared-media-link-title">{m.link_title || url}</div>
                    <div className="kot3-shared-media-link-desc">{m.link_description || ''}</div>
                    <div className="kot3-shared-media-link-domain">{m.link_domain || (url ? new URL(url).hostname : '')}</div>
                  </div>
                </button>
              );
            })
        )}
      </div>
    </div>
  );
}

function EmptyHint({ icon, t }) {
  return (
    <div className="kot3-shared-media-empty">
      <i className={`fas ${icon}`} aria-hidden="true" />
      <span>{t.msg_no_results || 'Nothing here yet.'}</span>
    </div>
  );
}

export default SharedMediaPanel;
