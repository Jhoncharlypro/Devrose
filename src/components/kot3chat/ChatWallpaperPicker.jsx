/**
 * src/components/kot3chat/ChatWallpaperPicker.jsx
 *
 * Chat-background wallpaper picker. Surfaces 8 preset wallpapers from the
 * spec (Classic / Dark / Gradient / Blur / Minimal / Nature / Gaming /
 * Custom Wallpaper). The host calls ``onChange(wallpaperId)`` whenever the
 * user picks a tile; the host is responsible for applying the wallpaper
 * by setting ``data-wallpaper`` on the chat-root element. We persist the
 * choice to ``localStorage['kot3_chat_wallpaper']`` so the selection
 * survives reloads.
 *
 * Custom upload path: tapping the "Custom" tile opens a file picker,
 * reads the chosen image into a base64 data URL via FileReader, persists
 * the URL, AND falls back through data-Wallpaper="custom" with the URL
 * stored separately for the host to apply as ``background-image: url(...)``.
 */
import React, { useEffect, useRef, useState } from 'react';

const WALLPAPERS = [
  { id: 'classic',  label: 'Classic',  bg: 'var(--bg-chat)' },
  { id: 'dark',     label: 'Dark',     bg: 'radial-gradient(circle at top, rgba(0,0,0,0.45), transparent 50%), radial-gradient(circle at bottom, rgba(0,0,0,0.55), transparent 50%), #050507' },
  { id: 'gradient', label: 'Gradient', bg: 'radial-gradient(circle at 30% 20%, rgba(233,30,99,0.55) 0%, transparent 40%), radial-gradient(circle at 70% 80%, rgba(109,80,246,0.45) 0%, transparent 40%), linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' },
  { id: 'blur',     label: 'Blur',     bg: 'radial-gradient(circle at 50% 50%, rgba(233,30,99,0.20) 0%, transparent 60%), linear-gradient(135deg, rgba(24,25,34,0.80) 0%, rgba(233,30,99,0.25) 100%)' },
  { id: 'minimal',  label: 'Minimal',  bg: 'repeating-linear-gradient(45deg, rgba(233,30,99,0.04) 0 1px, transparent 1px 16px), #1e1e2f' },
  { id: 'nature',   label: 'Nature',   bg: 'radial-gradient(circle at 20% 30%, rgba(34,197,94,0.30) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(132,204,22,0.30) 0%, transparent 45%), linear-gradient(180deg, #0f3a2a 0%, #052b1c 100%)' },
  { id: 'gaming',   label: 'Gaming',   bg: 'radial-gradient(circle at 50% 0%, rgba(255,0,122,0.35) 0%, transparent 50%), radial-gradient(circle at 50% 100%, rgba(0,255,174,0.35) 0%, transparent 50%), linear-gradient(180deg, #08080d 0%, #111122 100%)' },
  { id: 'custom',   label: 'Custom',   bg: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))', needsUpload: true },
];

const STORAGE_KEY = 'kot3_chat_wallpaper';
const CUSTOM_STORAGE_KEY = 'kot3_chat_wallpaper_custom';

export function ChatWallpaperPicker({ activeId, customUrl, onChange, lang = 'en', t = {} }) {
  const fileRef = useRef(null);

  // Local fallback while the host hasn't provided the active id.
  const [internal, setInternal] = useState(() => activeId || localStorage.getItem(STORAGE_KEY) || 'classic');
  const [internalCustom, setInternalCustom] = useState(() => customUrl || localStorage.getItem(CUSTOM_STORAGE_KEY) || null);

  useEffect(() => {
    if (activeId && activeId !== internal) setInternal(activeId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    if (customUrl !== undefined && customUrl !== internalCustom) setInternalCustom(customUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customUrl]);

  const pick = (id, needsUpload) => {
    if (id === 'custom' && needsUpload) {
      fileRef.current?.click();
      return; // Don't commit until user actually selects a file.
    }
    setInternal(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) { /* quota / disabled */ }
    onChange?.(id, internalCustom);
  };

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      // 6MB ceiling custom wallpapers are reasonable.
      onChange?.('classic', null);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try { localStorage.setItem(CUSTOM_STORAGE_KEY, reader.result); } catch (_) {}
      setInternalCustom(reader.result);
      try { localStorage.setItem(STORAGE_KEY, 'custom'); } catch (_) {}
      setInternal('custom');
      e.target.value = '';
      onChange?.('custom', reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      <div className="kot3-wallpaper-picker" role="radiogroup" aria-label={t?.msg_wallpaper_picker || 'Choose a wallpaper'}>
        {WALLPAPERS.map((w) => (
          <button
            type="button"
            key={w.id}
            role="radio"
            aria-checked={internal === w.id}
            className={`kot3-wallpaper-tile${internal === w.id ? ' active' : ''}`}
            onClick={() => pick(w.id, w.needsUpload)}
          >
            <div
              className="kot3-wallpaper-tile-bg"
              style={{
                background: w.id === 'custom' && internalCustom ? `url(${internalCustom})` : w.bg,
              }}
            />
            {internal === w.id && (
              <span className="check" aria-hidden="true">
                <i className="fas fa-check" />
              </span>
            )}
            <span className="kot3-wallpaper-tile-label">
              {t[`msg_wallpaper_${w.id}`] || w.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ChatWallpaperPicker;
