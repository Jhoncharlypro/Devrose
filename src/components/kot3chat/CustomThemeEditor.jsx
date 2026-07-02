/**
 * src/components/kot3chat/CustomThemeEditor.jsx
 *
 * Sub-component rendered INSIDE ThemeSettingsMenu when the user has picked
 * the 'custom' sentinel theme. Provides:
 *   * 8 preset accent swatches (one-click apply).
 *   * A native <input type="color"> for arbitrary color picking.
 *   * A "Reset to default" link that restores DEFAULT_CUSTOM_ACCENT.
 *
 * All changes are persisted to localStorage immediately and applied inline via
 * document.documentElement.style.setProperty('--primary-color', …). The host's
 * useResolvedTheme hook reads from storage on its next render so the
 * surrounding UI re-flows with the new accent automatically — we don't
 * need to push the new color back up.
 *
 * Props
 * -----
 *   currentAccent   : string  (hex, e.g. '#b366ff')
 *   lang            : 'ht' | 'en' | …
 *   onPickAccent    : (hex: string) => void   — fired on every change
 *                                              (covers preset click, native
 *                                              picker, and reset)
 *
 * Visual
 * ------
 * Light styling only — it lives inside the same dropdown menu as the chips,
 * so we use small ring/glow accents that read on either dark or light menus.
 * No external CSS required; everything is inline-style or className shared
 * with the existing theme chip pattern.
 */
import React from 'react';
import {
  CUSTOM_ACCENT_KEY,
  DEFAULT_CUSTOM_ACCENT,
  KOT3CHAT_PARAMS,
  KOT3CHAT_TIER_KEY,
  kot3chatLabelFor,
  hexToRgb,
  writeAppearanceChoice,
} from './params';

// 8 default accent presets. Chosen for high contrast on both dark and light
// chrome backgrounds. Order = most-used to least-used; reset puts the user
// back at the first entry.
const PRESET_ACCENTS = [
  '#e91e63', // rose / brand pink
  '#b366ff', // lavender
  '#0084ff', // messenger blue
  '#00d4ff', // cyan
  '#00b862', // lime
  '#ff8a00', // orange
  '#ffcc00', // gold
  '#7c2d12', // burnt brown
];

function writeAccent(hex) {
  try {
    localStorage.setItem(CUSTOM_ACCENT_KEY, hex);
  } catch {}
  if (typeof document === 'undefined') return;
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  try {
    document.documentElement.style.setProperty('--primary-color', hex);
    document.documentElement.style.setProperty('--primary-rgb', rgb);
  } catch {}
}

export function CustomThemeEditor({ currentAccent, lang, onPickAccent }) {
  const t = (en, ht) => (lang === 'ht' ? ht : en);

  const apply = (hex) => {
    writeAccent(hex);
    onPickAccent?.(hex);
  };

  return (
    <div className="kot3-custom-theme-editor" style={{ padding: '6px 4px 10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 10px',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        <i className="fas fa-droplet" aria-hidden="true" style={{ color: 'var(--primary-color)', fontSize: 11 }} />
        {t('Accent Color', 'Koulè Aksan')}
      </div>

      {/* 8 preset swatches */}
      <div
        role="group"
        aria-label={t('Accent presets', 'Presets aksan')}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 6,
          padding: '4px 8px 8px',
        }}
      >
        {PRESET_ACCENTS.map((hex) => {
          const isActive = (currentAccent || '').toLowerCase() === hex.toLowerCase();
          return (
            <button
              type="button"
              key={hex}
              className={`kot3-theme-custom-dot ${isActive ? 'active' : ''}`}
              aria-label={`Accent ${hex}`}
              aria-pressed={isActive}
              onClick={() => apply(hex)}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                borderRadius: 6,
                background: hex,
                border: isActive ? '2px solid var(--text-primary)' : '2px solid transparent',
                outline: isActive ? '1px solid var(--primary-color)' : 'none',
                outlineOffset: 1,
                cursor: 'pointer',
                transition: 'transform 0.15s',
                padding: 0,
                boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              }}
            />
          );
        })}
      </div>

      {/* Native color input row + reset */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px 6px',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          <i className="fas fa-eye-dropper" aria-hidden="true" style={{ color: 'var(--primary-color)', fontSize: 11 }} />
          {t('Custom…', 'Pèsonalize…')}
          <input
            type="color"
            value={currentAccent || DEFAULT_CUSTOM_ACCENT}
            onChange={(e) => apply(e.target.value)}
            aria-label={t('Pick a custom accent color', 'Pran yon koulè pèsonalize')}
            style={{
              width: 30,
              height: 22,
              padding: 0,
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => apply(DEFAULT_CUSTOM_ACCENT)}
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 6px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
          aria-label={t('Reset accent to default', 'Retabli koulè a default')}
          title={t('Reset', 'Retabli')}
        >
          <i className="fas fa-rotate-left" aria-hidden="true" /> {t('Reset', 'Retabli')}
        </button>
      </div>

      {/* ── Premium-Tier preview footer ─────────────────────────────
          Iterates KOT3CHAT_PARAMS.premiumTiers + renders a horizontal
          mini-card per tier showing the tier's crown + label + accent
          stripe. Clicking a tier persists it via ``writeAppearanceChoice``
          so future work (a server-side tier upgrade, the
          <PremiumBadge/> component reading the active tier from storage,
          a tier-locked wallpaper affordance) can read the choice from
          one place. Free-tier click is allowed because there's no
          server-side check — the registry accent is rendered, the chip
          doesn't actually unlock perks.                                       */}
      <hr className="kot3-theme-section-divider" aria-hidden="true" />
      <div
        className="kot3-custom-theme-tier-preview"
        role="group"
        aria-label={t('Premium tier preview', 'Apèsi nivo premium')}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '6px 10px',
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          <i className="fas fa-crown" aria-hidden="true" style={{ color: 'var(--primary-color)', fontSize: 11 }} />
          {t('Premiums', 'Premyòm')}
        </div>
        <div className="kot3-custom-theme-tier-row">
          {KOT3CHAT_PARAMS.premiumTiers.map((tier) => {
            // The "current accent" stripe warms up the tier's accent on
            // the user's chosen background — so a user with a
            // pink-accent + a lavender Studio tier shows a lavender-core
            // tint inside the pink halo.  Future PRs can pull the
            // actual mixed color from a CSS color-mix helper.
            const haloColor = currentAccent || DEFAULT_CUSTOM_ACCENT;
            return (
              <button
                type="button"
                key={tier.id}
                className={`kot3-custom-theme-tier-chip${tier.id === 'free' ? ' is-default' : ''}`}
                aria-label={`${tier.labelEn} tier`}
                title={tier.perks.length
                  ? `${tier.labelEn} · ${tier.perks.join(', ')}`
                  : tier.labelEn
                }
                onClick={() => writeAppearanceChoice(KOT3CHAT_TIER_KEY, tier.id, 'data-kot3-tier')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '8px 6px 6px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  flex: 1,
                  minWidth: 0,
                  position: 'relative',
                  overflow: 'hidden',
                  // Soft halo: a faint accent glow behind the icon so the
                  // user can tell their accent affects the tier highlight.
                  boxShadow: tier.id !== 'free'
                    ? `inset 0 0 0 1px ${haloColor}33, 0 0 12px ${haloColor}22`
                    : 'none',
                }}
              >
                <span
                  className={`${tier.family} ${tier.icon} kot3-custom-theme-tier-crown`}
                  aria-hidden="true"
                  style={{
                    fontSize: 16,
                    color: tier.id === 'free' ? 'var(--text-secondary)' : tier.accent,
                    textShadow: tier.id === 'free'
                      ? 'none'
                      : `0 1px 4px ${haloColor}aa`,
                  }}
                />
                <span
                  className="kot3-custom-theme-tier-label"
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                    color: tier.id === 'free'
                      ? 'var(--text-secondary)'
                      : 'var(--text-primary)',
                  }}
                >
                  {kot3chatLabelFor(tier, lang)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CustomThemeEditor;
