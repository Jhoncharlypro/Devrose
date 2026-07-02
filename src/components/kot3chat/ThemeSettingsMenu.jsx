/**
 * src/components/kot3chat/ThemeSettingsMenu.jsx
 *
 * Facebook-Messenger-style dropdown for swapping palettes. Pure
 * presentational component — receives the current theme id + an onChange
 * callback, renders the chips, and dispatches the swap on click.
 *
 * Why a separate file:
 *   * Kot3Chat.jsx bakes the legacy `kot3_dark_mode` toggle + 1 theme picker
 *     into the top-bar `kot3-top-settings-menu`. The picker was 60+ lines of
 *     JSX + 8 chip entries. Extracting it means future themes ( AMOLED,
 *     System, Custom ) can be added without growing Kot3Chat.jsx further.
 *   * The component owns its own pointerdown/Escape dismissal, so Kot3Chat
 *     no longer has to wire document-level listeners for "click outside".
 *
 * Props
 * -----
 *   isOpen           : boolean. Renders nothing when false.
 *   activeTheme      : string (theme id from THEMES registry).
 *   themes           : Array<{ id, label, emoji }>
 *   lang             : 'ht' | 'en' | …
 *   onClose          : () => void
 *   onSelect         : (themeId: string) => void   — picker dispatch
 *
 * Visual debt
 * -----------
 * The original CSS lives under `.kot3-top-settings-menu` +
 * `.kot3-theme-section-label` + `.kot3-theme-grid` + `.kot3-theme-chip`
 * + the `.kot3-theme-emoji`, `.kot3-theme-name`, `.kot3-theme-swatch`,
 * `.kot3-theme-check` subelements in src/styles/kot3chat.css. We DO NOT
 * rename those classes — the host menu still relies on them for its other
 * "New chat / settings" items. Renaming would be a separate PR.
 */
import React, { useEffect, useRef, useState } from 'react';
import './theme-settings-menu.css';
import { CustomThemeEditor } from './CustomThemeEditor';
import {
  KOT3CHAT_PARAMS,
  KOT3CHAT_PARAMS_LAYOUT_BY_ID,
  KOT3CHAT_PARAMS_SEND_TONE_BY_ID,
  KOT3CHAT_DENSITY_KEY,
  KOT3CHAT_SEND_TONE_KEY,
  kot3chatLabelFor,
  writeAppearanceChoice,
} from './params';

// localStorage key ChatWallpaperPicker already writes — shared with the
// in-tab wallpaper section so both pickers see the same selection.
const KOT3_WALLPAPER_KEY = 'kot3_chat_wallpaper';
// Read the current wallpaper id without throwing on disabled storage.
const readSavedWallpaper = () => {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(KOT3_WALLPAPER_KEY) : null;
    if (raw && KOT3CHAT_PARAMS.wallpapers.some((w) => w.id === raw)) return raw;
  } catch {}
  return 'classic';
};

export function ThemeSettingsMenu({
  isOpen,
  activeTheme,
  themes,
  lang,
  onClose,
  onSelect,
  // ── NEW (sentinel-themes support) ────────────────────────────────
  resolvedTheme,    // string — id actually being rendered (changes for
                    // sentinel themes when OS preference flips). Used to
                    // label System/Custom chips with the current direction.
  onPickAccent,     // (hex: string) => void — forwarded to CustomThemeEditor
  currentAccent,    // string — current custom accent for the swatch row
}) {
  const wrapRef = useRef(null);

  // Hoist the storage reads into React state so re-renders update the
  // chip's ``active`` + ``aria-checked`` consistently when the user
  // picks a different chip.  ``readSavedX`` would otherwise be called
  // inside ``.map()`` on every render, returning the same value AND
  // never reacting to localStorage changes until a parent re-render
  // happened to fire.  The pickers write + re-render this component by
  // calling ``onSelect?.(activeTheme)`` so state stays in sync.
  const [activeDensityId, setActiveDensityId] = useState(KOT3CHAT_PARAMS.defaultDensityId);
  const [activeSendToneId, setActiveSendToneId] = useState(KOT3CHAT_PARAMS.defaultSendToneId);
  const [activeWallpaperId, setActiveWallpaperId] = useState('classic');

  // One-shot sync from storage on mount + on the legacy 'storage' event
  // so a sibling ChatWallpaperPicker click (which writes to the same
  // key) reflects immediately if both pickers are open simultaneously.
  useEffect(() => {
    try {
      setActiveDensityId(readSavedFromStorage(KOT3CHAT_DENSITY_KEY) || KOT3CHAT_PARAMS.defaultDensityId);
      setActiveSendToneId(readSavedFromStorage(KOT3CHAT_SEND_TONE_KEY) || KOT3CHAT_PARAMS.defaultSendToneId);
      setActiveWallpaperId(readSavedWallpaper());
    } catch {}
    const onStorage = (e) => {
      if (!e || !e.key) return;
      if (e.key === KOT3CHAT_DENSITY_KEY)    setActiveDensityId(e.newValue || KOT3CHAT_PARAMS.defaultDensityId);
      if (e.key === KOT3CHAT_SEND_TONE_KEY)  setActiveSendToneId(e.newValue || KOT3CHAT_PARAMS.defaultSendToneId);
      if (e.key === KOT3_WALLPAPER_KEY)      setActiveWallpaperId(e.newValue || 'classic');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Click-outside dismissal + Escape key closing — mirrored from Kot3Chat's
  // original `useEffect` for `isTopSettingsOpen`. We attach to document so
  // keyboard / mouse outside the wrapper both close the menu.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose?.();
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={wrapRef} className="kot3-theme-picker-standalone">
      <label className="kot3-theme-section-label">
        <i className="fas fa-palette" aria-hidden="true" />
        {lang === 'ht' ? 'Tèm' : 'Theme'}
      </label>
      <div className="kot3-theme-grid" role="radiogroup" aria-label={lang === 'ht' ? 'Chwazi yon tèm' : 'Choose a theme'}>
        {themes.map((theme) => {
          const isActive = theme.id === activeTheme;
          // Sentinel subtitles: System/Custom chips get an extra small line
          // ("Light" or "Dark") so the user can see what the OS is currently
          // doing without having to confirm via the OS settings panel.
          // We derive the subtitle from ``resolvedTheme`` — the host passes the
          // id that useResolvedTheme just decided to render — so a runtime
          // matchMedia flip immediately re-labels the chip without us needing
          // a local listener.
          const sentinelLabel = (() => {
            if (theme.isSystem) {
              return resolvedTheme === 'messenger-light'
                ? (lang === 'ht' ? 'Limyè OS' : 'Light OS')
                : (lang === 'ht' ? 'Fènwa OS' : 'Dark OS');
            }
            if (theme.isCustom) {
              return resolvedTheme === 'messenger-light'
                ? (lang === 'ht' ? 'Limyè + Aksan' : 'Light + Accent')
                : (lang === 'ht' ? 'Fènwa + Aksan' : 'Dark + Accent');
            }
            return null;
          })();
          // For 'custom' the chip swatch shows the user's current accent
          // rather than a neutral palette — gives visual confirmation that
          // the value persisted.
          const swatchBg = theme.isCustom
            ? (currentAccent || '#e91e63')
            : (theme.bg || theme.accent || '#888');
          return (
            <button
              type="button"
              key={theme.id}
              role="radio"
              aria-checked={isActive}
              className={`kot3-theme-chip ${isActive ? 'active' : ''}`}
              onClick={() => {
                onSelect?.(theme.id);
                // Do not auto-close for 'custom' — the editor below needs to
                // remain visible so they can pick an accent.
                if (!theme.isCustom) onClose?.();
              }}
            >
              {theme.emoji && <span className="kot3-theme-emoji" aria-hidden="true">{theme.emoji}</span>}
              <span
                className="kot3-theme-swatch"
                style={{ background: swatchBg }}
                aria-hidden="true"
              />
              <span className="kot3-theme-name">
                {theme.label}
                {sentinelLabel && (
                  <span
                    className="kot3-theme-chipsublabel"
                    style={{
                      display: 'block',
                      fontSize: 9.5,
                      fontWeight: 500,
                      color: 'var(--text-secondary)',
                      opacity: 0.75,
                      marginTop: 1,
                    }}
                  >
                    {sentinelLabel}
                  </span>
                )}
              </span>
              {isActive && <i className="fas fa-check kot3-theme-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/* ── KOT3CHAT appearance sections (walls / density / send-tone) ──
          Each section renders one chip-row from KOT3CHAT_PARAMS. Click
          writes the choice to localStorage AND applies the matching data-
          attribute to <html> so the renderer picks the chip up immediately.
          The picker stays open after each click so the user can audition
          multiple options without re-opening the menu.                             */}
      <hr className="kot3-theme-section-divider" aria-hidden="true" />

      <label className="kot3-theme-section-label">
        <i className="fas fa-image" aria-hidden="true" />
        {lang === 'ht' ? 'Fon' : 'Wallpaper'}
      </label>
      <div
        className="kot3-params-section kot3-params-wallpapers"
        role="radiogroup"
        aria-label={lang === 'ht' ? 'Chwazi yon fon' : 'Choose a wallpaper'}
      >
        {KOT3CHAT_PARAMS.wallpapers
          .filter((w) => !w.needsUpload)
          .slice(0, 8)
          .map((w) => {
            const isActive = w.id === activeWallpaperId;
            // Tier-locked chips are ``disabled`` so the click is a
            // true no-op (reviewer's #3) rather than a silent write
            // of a wallpaper the user can't actually use.
            return (
              <button
                type="button"
                key={w.id}
                role="radio"
                aria-checked={isActive}
                disabled={w.isCustomOnly}
                className={`kot3-params-chip kot3-params-wallpaper-chip${isActive ? ' active' : ''}${w.isCustomOnly ? ' kot3-params-chip--locked' : ''}`}
                onClick={() => {
                  if (w.isCustomOnly) return;
                  writeAppearanceChoice(KOT3_WALLPAPER_KEY, w.id, 'data-kot3-wallpaper');
                  setActiveWallpaperId(w.id);
                  onSelect?.(activeTheme);
                }}
                title={kot3chatLabelFor(w, lang) + (w.isCustomOnly
                  ? (lang === 'ht' ? ' · Premium' : ' · Premium')
                  : '')}
              >
                <span
                  className="kot3-params-chip-preview"
                  style={{ background: w.bg }}
                  aria-hidden="true"
                />
                <span className="kot3-params-chip-label">
                  {kot3chatLabelFor(w, lang)}
                  {w.isCustomOnly && (
                    <i className="fas fa-lock kot3-params-chip-lockicon" aria-hidden="true" />
                  )}
                </span>
              </button>
            );
          })}
      </div>

      <label className="kot3-theme-section-label">
        <i className="fas fa-arrows-alt-v" aria-hidden="true" />
        {lang === 'ht' ? 'Dansite' : 'Density'}
      </label>
      <div
        className="kot3-params-section kot3-params-density"
        role="radiogroup"
        aria-label={lang === 'ht' ? 'Chwazi yon dansite' : 'Choose a transcript density'}
      >
        {KOT3CHAT_PARAMS.layouts.map((l) => {
          const isActive = l.id === activeDensityId;
          return (
            <button
              type="button"
              key={l.id}
              role="radio"
              aria-checked={isActive}
              className={`kot3-params-chip kot3-params-density-chip${isActive ? ' active' : ''}`}
              onClick={() => {
                writeAppearanceChoice(KOT3CHAT_DENSITY_KEY, l.id, 'data-kot3-message-density');
                setActiveDensityId(l.id);
                onSelect?.(activeTheme);
              }}
            >
              <span
                className="kot3-params-chip-densitypreview"
                aria-hidden="true"
                style={{
                  // Visual mock: the more rows, the more padding — gives
                  // the user a density preview without re-rendering the
                  // actual transcript.  ``idx`` picks the visual density.
                  '--kot3-density-mock-gap': l.vars.messageGap,
                  '--kot3-density-mock-pad': l.vars.paddingBlock,
                }}
              >
                <i /><i /><i /><i />
              </span>
              <span className="kot3-params-chip-label">
                {kot3chatLabelFor(l, lang)}
              </span>
            </button>
          );
        })}
      </div>

      <label className="kot3-theme-section-label">
        <i className="fas fa-paper-plane" aria-hidden="true" />
        {lang === 'ht' ? 'Style bouton' : 'Send tone'}
      </label>
      <div
        className="kot3-params-section kot3-params-sendtones"
        role="radiogroup"
        aria-label={lang === 'ht' ? 'Chwazi yon style bouton' : 'Choose a send-button tone'}
      >
        {KOT3CHAT_PARAMS.sendTones.map((t) => {
          const isActive = t.id === activeSendToneId;
          return (
            <button
              type="button"
              key={t.id}
              role="radio"
              aria-checked={isActive}
              className={`kot3-params-chip kot3-params-send-chip${isActive ? ' active' : ''}`}
              onClick={() => {
                writeAppearanceChoice(KOT3CHAT_SEND_TONE_KEY, t.id, 'data-kot3-send-tone');
                setActiveSendToneId(t.id);
                onSelect?.(activeTheme);
              }}
            >
              <span
                className={`kot3-params-chip-sendwatch kot3-params-chip-sendwatch--${t.id}`}
                aria-hidden="true"
                style={{
                  borderRadius: t.borderRadius,
                  background: t.surface === 'gradient'
                    ? 'linear-gradient(135deg, #00c8ff, var(--primary-color))'
                    : (t.surface === 'glass'
                      ? 'rgba(var(--primary-rgb), 0.30)'
                      : 'var(--primary-color)'),
                  border: t.surface === 'glass' ? '1px solid rgba(var(--primary-rgb), 0.55)' : 'none',
                }}
              />
              <span className="kot3-params-chip-label">
                {kot3chatLabelFor(t, lang)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom accent editor — only when the user picked 'custom'. Picker
          stays open after selection so the user can dial in their accent. */}
      {activeTheme === 'custom' && (
        <>
          <CustomThemeEditor
            currentAccent={currentAccent}
            lang={lang}
            onPickAccent={onPickAccent}
          />
        </>
      )}
    </div>
  );
}

export default ThemeSettingsMenu;

// Small inline reader (separate from params.js so ThemeSettingsMenu owns
// its own mount-time storage read — keeping the pre-paint side-effect the
// single source of truth for the FIRST PAINT while letting React catch up
// on hydration). Returns null on disabled storage / unmounted window.
function readSavedFromStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw || null;
  } catch { return null; }
}
