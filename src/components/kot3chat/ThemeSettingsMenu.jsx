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
import React, { useEffect, useRef } from 'react';
import './theme-settings-menu.css';
import { CustomThemeEditor } from './CustomThemeEditor';

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
      {/* Custom accent editor — only when the user picked 'custom'. Picker
          stays open after selection so the user can dial in their accent. */}
      {activeTheme === 'custom' && (
        <>
          <hr className="kot3-theme-section-divider" aria-hidden="true" />
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
