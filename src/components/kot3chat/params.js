/**
 * src/components/kot3chat/params.js
 *
 * Kot3Chat parameter module — appearance, theme, layout, identifier, and
 * routing constants + small helpers used by Kot3Chat.
 *
 * Why a separate kot3chat-scoped file: feature authors wiring up upcoming
 * Kot3Chat features (wallpaper sets, premium-badge tiers, transcript
 * layouts, theme accents) need a clearly-named home that does NOT collide
 * with any future constants.js in other parts of the app. The `params`
 * name keeps the kot3chat-specific knobs isolated.
 *
 * No React hooks, no JSX, no useState / useRef. Kot3Chat.jsx + the kot3chat
 * hooks (useResolvedTheme, useChatSocket) and the in-tab custom-theme editor
 * import everything from here.
 *
 * Side effect: sets `data-theme` on <html> AND applies the persisted custom
 * accent color (if any) to :root at module-evaluation time so the very first
 * paint already has the correct theme + accent (no flash of wrong colors).
 */

// ─────────── STATUS CREATOR PALETTE ───────────
// FB Messenger inspired gradient + solid swatches used by the custom-status
// creator. Each entry is a CSS background value; the picker just maps an
// index (`activeGradIdx`) into this list.
export const STATUS_PALETTE = [
  'linear-gradient(135deg, #ff8a00 0%, #e52e71 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)',
  'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
  'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
  'linear-gradient(135deg, #a8ff78 0%, #78ffd6 100%)',
  'linear-gradient(135deg, #434343 0%, #000000 100%)',
  'linear-gradient(135deg, #ff6a00 0%, #ee0979 100%)',
  'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
  'linear-gradient(135deg, #fdc830 0%, #f37335 100%)',
  'linear-gradient(135deg, #184e68 0%, #57ca85 100%)',
  '#0f172a', '#7c2d12', '#831843', '#1e3a8a', '#14532d', '#581c87',
];

export const STATUS_FONTS = [
  { key: 'modern',  family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { key: 'bold',    family: 'Impact, "Arial Black", sans-serif' },
  { key: 'playful', family: '"Comic Sans MS", "Brush Script MT", cursive' },
];

// Backwards-compat alias used in legacy call sites — same array, different name.
export const GRADIENS = STATUS_PALETTE;

// ─────────── THEME REGISTRY ───────────
// Matches the `:root[data-theme="..."]` CSS blocks in src/styles/kot3chat.css +
// runtime `data-theme` overrides set by useResolvedTheme.
//
// Shape: { id, label, emoji, accent, bg, isLight,
//          isAmoled? , isSystem? , isCustom? }
//   * id          — theme registry key. Static ids map 1:1 to CSS blocks.
//   * isSystem    — true: render & track via window.matchMedia at runtime.
//                   No CSS block; the resolved theme id (dark/messenger-light)
//                   is what's actually written to data-theme.
//   * isCustom    — true: layered accent override via document.documentElement
//                   .style.setProperty('--primary-color', accent). The base
//                   palette is still resolved via matchMedia so a light-mode
//                   user can still pick a custom accent on top of light palette.
//   * isAmoled    — informational flag, no resolver behavior. Pure-black CSS
//                   block lives in kot3chat.css.
export const THEMES = [
  { id: 'dark',            label: 'DevRose Dark',     emoji: '🌙', accent: '#e91e63', bg: 'linear-gradient(135deg,#1e1e2f 0%,#12131a 50%,#e91e63 100%)', isLight: false },
  { id: 'messenger-light', label: 'Messenger Light',  emoji: '☀️', accent: '#0084ff', bg: 'linear-gradient(135deg,#ffffff 0%,#f0f2f5 50%,#0084ff 100%)', isLight: true  },
  { id: 'messenger-dark',  label: 'Messenger Dark',   emoji: '🌑', accent: '#0084ff', bg: 'linear-gradient(135deg,#242526 0%,#18191a 50%,#0084ff 100%)', isLight: false },
  { id: 'rose',            label: 'Rose',             emoji: '🌹', accent: '#ff4d6d', bg: 'linear-gradient(135deg,#2b161c 0%,#1a0f12 50%,#ff4d6d 100%)', isLight: false },
  { id: 'sunset',          label: 'Sunset',           emoji: '🌅', accent: '#ff8a00', bg: 'linear-gradient(135deg,#2d2117 0%,#1c1510 50%,#ff8a00 100%)', isLight: false },
  { id: 'forest',          label: 'Forest',           emoji: '🌲', accent: '#00b862', bg: 'linear-gradient(135deg,#192e22 0%,#0f1a14 50%,#00b862 100%)', isLight: false },
  { id: 'ocean',           label: 'Ocean',            emoji: '🌊', accent: '#00d4ff', bg: 'linear-gradient(135deg,#142436 0%,#09121a 50%,#00d4ff 100%)', isLight: false },
  { id: 'dusk',            label: 'Dusk Lavender',    emoji: '🌌', accent: '#b366ff', bg: 'linear-gradient(135deg,#201a30 0%,#13101c 50%,#b366ff 100%)', isLight: false },
  // ─── AMOLED: pure-black CSS block in kot3chat.css ──────────────────────
  { id: 'amoled',          label: 'AMOLED Black',     emoji: '⬛', accent: '#bb86fc', bg: 'linear-gradient(135deg,#000000 0%,#0a0a0a 50%,#bb86fc 100%)', isLight: false, isAmoled: true },
  // ─── Premium Messenger Home — 5 new themes (so we reach 16 visually distinct palettes) ───
  { id: 'whatsapp',        label: 'WhatsApp Green',      emoji: '🟢', accent: '#25d366', bg: 'linear-gradient(135deg,#0b141a 0%,#111b21 50%,#25d366 100%)', isLight: false },
  { id: 'instagram',       label: 'Instagram Gradient', emoji: '🟣', accent: '#e1306c', bg: 'linear-gradient(45deg,#f09433 0%,#dc2743 50%,#bc1888 100%)', isLight: true },
  { id: 'cyberpunk',       label: 'Cyberpunk Neon',     emoji: '⚡', accent: '#00f5d4', bg: 'linear-gradient(135deg,#0d0221 0%,#00f5d4 50%,#ff206e 100%)', isLight: false },
  { id: 'rose-pink',       label: 'Rose Pink',           emoji: '🌷', accent: '#ff4d8d', bg: 'linear-gradient(135deg,#fff5f8 0%,#ff4d8d 100%)', isLight: true },
  { id: 'minimal',         label: 'Minimal White',       emoji: '⬜', accent: '#111111', bg: 'linear-gradient(180deg,#ffffff,#ffffff)', isLight: true },
  // ─── System: sentinel — resolved at runtime via matchMedia ─────────────
  { id: 'system',          label: 'System',           emoji: '🖥️', accent: 'auto',     bg: 'linear-gradient(135deg,#242526 0%,#ffffff 50%,#0084ff 100%)',          isLight: 'auto', isSystem: true },
  // ─── Custom: sentinel — base palette resolved like System + accent overlay
  { id: 'custom',          label: 'Custom',           emoji: '🎨', accent: 'var(--custom-accent,#e91e63)', bg: 'linear-gradient(135deg,#242526 0%,#18191a 50%,var(--custom-accent,#e91e63) 100%)', isLight: false, isCustom: true },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));

// ─────────── LOCALSTORAGE KEYS ───────────
export const LEGACY_THEME_KEY = 'kot3_dark_mode';
export const ACTIVE_THEME_KEY = 'kot3_active_theme';
// Custom theme accent: hex string. Read on mount by both constants.js (pre-paint)
// and useResolvedTheme (post-paint, when active=custom).
export const CUSTOM_ACCENT_KEY = 'kot3_custom_accent';
// Default accent applied when user picks Custom without first choosing a color.
export const DEFAULT_CUSTOM_ACCENT = '#e91e63';

// Quick access — the chip-picker subset that should render as standard grid items.
export const STATIC_THEMES = THEMES.filter((t) => !t.isSystem && !t.isCustom);
export const SENTINEL_THEMES = THEMES.filter((t) => t.isSystem || t.isCustom);

// Module-scope flag so the documentElement data-theme side effect runs at
// most once per page load, even if this module is evaluated multiple times
// (e.g. imported from two distinct paths during HMR). MUST be `let`, not
// `const`, because we mutate it the first time the side-effect runs —
// assigning to a const would throw a TypeError and break the side effect.
let __KOT3_THEME_INITIALIZED__ = false;

// One-shot matchMedia read used by resolveInitialTheme to pre-resolve the
// sentinel themes ('system' / 'custom') at module-load time. Synchronous
// — runs at constants.js eval (before React mounts). Returns true on
// any error (preserves the historical "dark by default" behavior).
const _bootSystemPrefersDark = () => {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return true; }
};

// ─────────── THEME RESOLVER (used at startup + as useState init) ───────────
// Migrates the legacy boolean `kot3_dark_mode=false` storage entry to the new
// `kot3_active_theme='messenger-light'` scheme, then returns the active theme
// to render. For sentinels ('system' / 'custom') we one-shot read the OS
// preference AT MODULE LOAD so the very first paint of <html data-theme=…>
// already holds the resolved id. This is the belt-and-suspenders that closes
// the flicker window even if React's useLayoutEffect is delayed by an async
// mount (Suspense, lazy import, etc.) in the future.
//
// Returns 'dark' as a safe default if localStorage is unavailable.
//
// NOTE on storage vs paint attribute: the saved user choice
// ('kot3_active_theme') is still the literal sentinel string ('system'/
// 'custom') — we do NOT write the resolved id back to storage, because
// that would lose the user's sentinel intent across page reloads.
export const resolveInitialTheme = () => {
  try {
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'false') {
      try { localStorage.removeItem(LEGACY_THEME_KEY); } catch {}
      try { localStorage.setItem(ACTIVE_THEME_KEY, 'messenger-light'); } catch {}
      return 'messenger-light';
    }
    const saved = localStorage.getItem(ACTIVE_THEME_KEY);
    if (saved && THEME_BY_ID[saved]) {
      const t = THEME_BY_ID[saved];
      // Pre-resolve sentinels so first paint is correct.
      if (t.isSystem) {
        return _bootSystemPrefersDark() ? 'dark' : 'messenger-light';
      }
      if (t.isCustom) {
        // The base palette depends on OS preference. The accent is applied
        // separately via inline vars in the side-effect block below.
        return _bootSystemPrefersDark() ? 'messenger-dark' : 'messenger-light';
      }
      return saved;
    }
  } catch {}
  return 'dark';
};

// ─────────── HEX → RGB helper (for --primary-rgb var) ───────────
// Returns "R,G,B" string or null on malformed input. Used both at module-load
// (pre-paint) and by useResolvedTheme (post-paint). Kept small + dependency-free.
export const hexToRgb = (hex) => {
  if (typeof hex !== 'string') return null;
  const m = hex.trim().match(/^#?([a-f0-9]{3}|[a-f0-9]{6})$/i);
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const num = parseInt(v, 16);
  return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
};

// Read stored custom accent; fall back to default if missing or invalid.
export const readCustomAccent = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_ACCENT_KEY);
    if (raw && hexToRgb(raw)) return raw;
  } catch {}
  return DEFAULT_CUSTOM_ACCENT;
};

// Pre-paint side effect: paint the document with the resolved theme + custom
// accent BEFORE React even mounts, so there's no flash of the wrong color on
// first paint. Set the data-theme attribute to the stored id verbatim — once
// React mounts, useResolvedTheme will sync it to the live (maybe JS-resolved)
// theme if the stored id is 'system' or 'custom'.
if (typeof document !== 'undefined') {
  try {
    if (!__KOT3_THEME_INITIALIZED__) {
      const initialId = resolveInitialTheme();
      document.documentElement.setAttribute('data-theme', initialId);
      // Apply the persisted custom accent (if any) inline so the first paint
      // for users on 'custom' already shows their color — no flash of #e91e63.
      const accent = readCustomAccent();
      const rgb = hexToRgb(accent);
      if (rgb) {
        document.documentElement.style.setProperty('--primary-color', accent);
        document.documentElement.style.setProperty('--primary-rgb', rgb);
      }
      // Set the flag AFTER setAttribute succeeds so an exception (e.g. CSP
      // blocks setAttribute) leaves the flag false and HMR can retry.
      __KOT3_THEME_INITIALIZED__ = true;
    }
  } catch {}
}

// ─────────── SMALL HELPERS ───────────
// Loose-equality string id compare (handles string↔number and 'tmp-…' temps).
export const sameId = (left, right) => String(left) === String(right);
// True for client-side optimistic messages that haven't been assigned a real id.
export const isTempId = (id) => typeof id === 'string' && id.startsWith('tmp-');

// 24h — stories older than this are filtered out (FB-Messenger parity).
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────── WEB SOCKET URL ───────────
// Browser WebSocket APIs cannot set custom headers, so the auth token rides
// in the query string (see backend/api/middleware.py for the server side).
export const buildChatSocketUrl = (token) => {
  const loc = window.location;
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.KOT3_WS_HOST || loc.host;
  return `${protocol}//${host}/ws/chat/?token=${encodeURIComponent(token)}`;
};

// ─────────── KOT3CHAT_APPEARANCE PARAMS ───────────
//
// Single kot3chat-scoped home for upcoming feature appearance knobs —
// wallpaper registry, premium-badge tiers, transcript layouts, and
// send-button tone variants. Read by the in-tab pickers
// (ThemeSettingsMenu + CustomThemeEditor) and applied pre-paint by
// the side-effect block at the bottom of this section.
//
// Why this lives next to THEMES: every entry is per-feature and
// per-tier — neither a "constant" nor a "translation" — so a
// dedicated ``KOT3CHAT_PARAMS`` table keeps them isolated from the
// 16-theme palette grid that ThemeSettingsMenu already renders. The
// picker JSX just imports this module and iterates over the
// sub-arrays. New appearance knobs added later (lock-screen packs,
// premium-only sticker sets, transcript accent edges) get appended
// here without touching THEMES or STATUS_PALETTE.
//
// VERSIONING: bump ``version`` on any breaking shape change. The
// migrator at the bottom of this section writes the resolved version
// to localStorage so future migrations can detect stale payloads.
export const KOT3CHAT_PARAMS = {
  version: '1.0.0',
  defaultDensityId: 'comfortable',
  defaultSendToneId: 'round',

  // Transcript / message-bubble density variants. Maps 1:1 to
  // ``data-kot3-message-density`` on the chat-root element. We chose
  // 3 fixed options so the UI picker stays a clean radio rather than
  // a continuous slider; each entry's ``vars`` is the CSS custom
  // property values that will be set on the chat-root for that
  // density.
  layouts: [
    {
      id: 'compact',
      labelEn: 'Compact',
      labelHt: 'Konpakte',
      vars: { lineHeight: '1.30', paddingBlock: '4px', messageGap: '2px', fontSizeStep: '-1px' },
    },
    {
      id: 'comfortable',
      labelEn: 'Comfortable',
      labelHt: 'Konfòtab',
      vars: { lineHeight: '1.50', paddingBlock: '8px', messageGap: '8px', fontSizeStep: '0' },
    },
    {
      id: 'roomy',
      labelEn: 'Roomy',
      labelHt: 'Laj',
      vars: { lineHeight: '1.60', paddingBlock: '12px', messageGap: '16px', fontSizeStep: '+1px' },
    },
  ],

  // Send-button shape variants. Applied via ``data-kot3-send-tone``
  // on <html> at pre-paint; the matching CSS rules live in
  // src/components/kot3chat/composer.css.
  sendTones: [
    { id: 'round',  labelEn: 'Round',  labelHt: 'Wonn',    borderRadius: '50%',    surface: 'solid' },
    { id: 'pill',   labelEn: 'Pill',   labelHt: 'Gren',    borderRadius: '16px',   surface: 'gradient' },
    { id: 'square', labelEn: 'Square', labelHt: 'Kare',    borderRadius: '8px',    surface: 'solid' },
    { id: 'glass',  labelEn: 'Glass',  labelHt: 'Vè',      borderRadius: '50%',    surface: 'glass' },
  ],

  // Premium-badge tiers. Each tier carries the FontAwesome icon +
  // accent + `perks` unlock list. PremiumBadge.jsx already
  // destructures these fields from props, so a future migration just
  // forwards ``tier = KOT3CHAT_PARAMS_TIER_BY_ID[plan]`` instead of
  // hardcoding icon/accent. The CustomThemeEditor picks up this
  // same array to render an in-tab "tier preview" footer so users
  // can see what each tier's crown looks like against their custom
  // accent before committing.
  premiumTiers: [
    { id: 'free',     labelEn: 'Free',                  labelHt: 'Gratis',          icon: 'fa-user',        family: 'fas', accent: '#8a8d93', perks: [] },
    { id: 'plus',     labelEn: 'Plus',                  labelHt: 'Plis',            icon: 'fa-star',        family: 'fas', accent: '#0084ff', perks: ['custom_accents'] },
    { id: 'pro',      labelEn: 'Pro',                   labelHt: 'Pwo',             icon: 'fa-crown',       family: 'fas', accent: '#e91e63', perks: ['custom_accents', 'premium_wallpapers', 'premium_send_tones'] },
    { id: 'studio',   labelEn: 'Studio',                labelHt: 'Estidyo',         icon: 'fa-gem',         family: 'far', accent: '#b366ff', perks: ['all'] },
    { id: 'verified', labelEn: 'Verified Business',     labelHt: 'Biznis Verifye',  icon: 'fa-certificate', family: 'fas', accent: '#00b862', perks: ['all', 'verification_badge'] },
  ],

  // Wallpaper registry — larger than the 8-entry ChatWallpaperPicker
  // can show at once, so the in-tab picker renders the FIRST few
  // (Classic + Gradient groups are always free) and the rest
  // (Nature + Gaming) stay available for upcoming preset-bundle /
  // lock-screen / cross-device sync features. ``isCustomOnly: true``
  // marks wallpapers that are gated behind a premium tier; the
  // picker fades those chips until the user upgrades.
  wallpapers: [
    // ─── Classic (always free) ─────────────────────────────────────
    { id: 'classic',     labelEn: 'Classic',       labelHt: 'Klasik',         group: 'Classic',  isCustomOnly: false, bg: 'var(--bg-chat)' },
    { id: 'dark',        labelEn: 'Dark',          labelHt: 'Fènwa',          group: 'Classic',  isCustomOnly: false, bg: 'radial-gradient(circle at top, rgba(0,0,0,0.45), transparent 50%), radial-gradient(circle at bottom, rgba(0,0,0,0.55), transparent 50%), #050507' },
    { id: 'minimal',     labelEn: 'Minimal',       labelHt: 'Minim',          group: 'Classic',  isCustomOnly: false, bg: 'repeating-linear-gradient(45deg, rgba(233,30,99,0.04) 0 1px, transparent 1px 16px), #1e1e2f' },
    { id: 'blur',        labelEn: 'Blur',          labelHt: 'Flou',           group: 'Classic',  isCustomOnly: false, bg: 'radial-gradient(circle at 50% 50%, rgba(233,30,99,0.20) 0%, transparent 60%), linear-gradient(135deg, rgba(24,25,34,0.80) 0%, rgba(233,30,99,0.25) 100%)' },
    // ─── Gradient (always free) ───────────────────────────────────
    { id: 'gradient',    labelEn: 'Gradient',      labelHt: 'Gradyan',        group: 'Gradient', isCustomOnly: false, bg: 'radial-gradient(circle at 30% 20%, rgba(233,30,99,0.55) 0%, transparent 40%), radial-gradient(circle at 70% 80%, rgba(109,80,246,0.45) 0%, transparent 40%), linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' },
    { id: 'sunset-g',    labelEn: 'Sunset',        labelHt: 'Solèy kouche',   group: 'Gradient', isCustomOnly: false, bg: 'radial-gradient(circle at 30% 30%, rgba(255,138,0,0.45) 0%, transparent 45%), radial-gradient(circle at 70% 70%, rgba(255,77,109,0.45) 0%, transparent 45%), linear-gradient(135deg, #2d2117 0%, #1c1510 100%)' },
    { id: 'ocean-g',     labelEn: 'Ocean',         labelHt: 'Oseyan',         group: 'Gradient', isCustomOnly: false, bg: 'radial-gradient(circle at 30% 30%, rgba(0,212,255,0.45) 0%, transparent 45%), radial-gradient(circle at 70% 70%, rgba(0,184,98,0.35) 0%, transparent 45%), linear-gradient(135deg, #142436 0%, #09121a 100%)' },
    { id: 'rose-g',      labelEn: 'Rose Petals',   labelHt: 'Woz',            group: 'Gradient', isCustomOnly: false, bg: 'radial-gradient(circle at 50% 0%, rgba(255,77,141,0.40) 0%, transparent 60%), linear-gradient(180deg, #2b161c 0%, #1a0f12 100%)' },
    // ─── Nature (premium tiers) ────────────────────────────────────
    { id: 'nature',      labelEn: 'Forest',        labelHt: 'Forest',         group: 'Nature',   isCustomOnly: true,  bg: 'radial-gradient(circle at 20% 30%, rgba(34,197,94,0.30) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(132,204,22,0.30) 0%, transparent 45%), linear-gradient(180deg, #0f3a2a 0%, #052b1c 100%)' },
    { id: 'aurora',      labelEn: 'Aurora',        labelHt: 'Owora',          group: 'Nature',   isCustomOnly: true,  bg: 'radial-gradient(circle at 20% 30%, rgba(0,255,200,0.30) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(179,102,255,0.30) 0%, transparent 50%), linear-gradient(180deg, #0a1d2a 0%, #06121a 100%)' },
    { id: 'dusk-n',      labelEn: 'Lavender Dusk', labelHt: 'Aswè lavann',    group: 'Nature',   isCustomOnly: true,  bg: 'radial-gradient(circle at 30% 30%, rgba(179,102,255,0.40) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(255,77,109,0.30) 0%, transparent 50%), linear-gradient(180deg, #201a30 0%, #13101c 100%)' },
    // ─── Gaming (premium tiers) ────────────────────────────────────
    { id: 'gaming',      labelEn: 'Gaming',        labelHt: 'Jwèt',           group: 'Gaming',   isCustomOnly: true,  bg: 'radial-gradient(circle at 50% 0%, rgba(255,0,122,0.35) 0%, transparent 50%), radial-gradient(circle at 50% 100%, rgba(0,255,174,0.35) 0%, transparent 50%), linear-gradient(180deg, #08080d 0%, #111122 100%)' },
    { id: 'cyber-neon',  labelEn: 'Cyber Neon',    labelHt: 'Neyon',          group: 'Gaming',   isCustomOnly: true,  bg: 'radial-gradient(circle at 30% 50%, rgba(0,245,212,0.45) 0%, transparent 45%), radial-gradient(circle at 70% 50%, rgba(255,32,110,0.45) 0%, transparent 45%), linear-gradient(180deg, #0d0221 0%, #1a0530 100%)' },
    { id: 'matrix',      labelEn: 'Matrix Code',   labelHt: 'Kòd Matris',     group: 'Gaming',   isCustomOnly: true,  bg: 'repeating-linear-gradient(0deg, rgba(0,255,0,0.15) 0 1px, transparent 1px 8px), linear-gradient(180deg, #000000 0%, #001a00 100%)' },
    // ─── Custom slot (always available — host handles file upload) ─
    { id: 'custom',      labelEn: 'Custom',        labelHt: 'Pèsonalize',     group: 'Custom',   isCustomOnly: false, bg: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))', needsUpload: true },
  ],
};

// Lookup helpers — same BY_ID pattern used by THEMES. Future code
// needing a single entry should read from these maps instead of
// re-scanning KOT3CHAT_PARAMS arrays. Pre-built at module load so
// the picker hot-path is O(1).
export const KOT3CHAT_PARAMS_LAYOUT_BY_ID =
  Object.fromEntries(KOT3CHAT_PARAMS.layouts.map((l) => [l.id, l]));
export const KOT3CHAT_PARAMS_SEND_TONE_BY_ID =
  Object.fromEntries(KOT3CHAT_PARAMS.sendTones.map((t) => [t.id, t]));
export const KOT3CHAT_PARAMS_TIER_BY_ID =
  Object.fromEntries(KOT3CHAT_PARAMS.premiumTiers.map((p) => [p.id, p]));
export const KOT3CHAT_PARAMS_WALLPAPER_BY_ID =
  Object.fromEntries(KOT3CHAT_PARAMS.wallpapers.map((w) => [w.id, w]));

// Localize a registry entry's label based on lang. Per-entry label
// fields (labelEn/labelHt) is the agreed shape — keeps the registry
// self-contained and matches the codebase's existing pattern of
// ``lang === 'ht' ? ht : en``.
export const kot3chatLabelFor = (entry, lang) =>
  (lang === 'ht' && entry.labelHt) ? entry.labelHt : entry.labelEn;

// ─────────── APPEARANCE STORAGE KEYS ───────────
//
// DISTINCT keys (one per surface), not a combined JSON blob, for two
// reasons:
//   * Each picker is independent; combining forces a parse/stringify
//     round-trip on every read and creates a write-race window where
//     reading one surface's value could surface another's stale state.
//   * The pre-paint migrator reads each key individually.
export const KOT3CHAT_DENSITY_KEY = 'kot3_chat_density';
export const KOT3CHAT_SEND_TONE_KEY = 'kot3_chat_send_tone';
export const KOT3CHAT_TIER_KEY = 'kot3_premium_tier';
export const KOT3CHAT_VERSION_KEY = 'kot3_appearance_version';

// Resolve the user-saved id OR fall back to the default. Returns
// 'comfortable' / 'round' on malformed input / unfamiliar id.
export const readSavedDensity = () => {
  try {
    const raw = localStorage.getItem(KOT3CHAT_DENSITY_KEY);
    if (raw && KOT3CHAT_PARAMS_LAYOUT_BY_ID[raw]) return raw;
  } catch {}
  return KOT3CHAT_PARAMS.defaultDensityId;
};
export const readSavedSendTone = () => {
  try {
    const raw = localStorage.getItem(KOT3CHAT_SEND_TONE_KEY);
    if (raw && KOT3CHAT_PARAMS_SEND_TONE_BY_ID[raw]) return raw;
  } catch {}
  return KOT3CHAT_PARAMS.defaultSendToneId;
};
export const readSavedTier = () => {
  try {
    const raw = localStorage.getItem(KOT3CHAT_TIER_KEY);
    if (raw && KOT3CHAT_PARAMS_TIER_BY_ID[raw]) return raw;
  } catch {}
  return KOT3CHAT_PARAMS.premiumTiers[0].id; // 'free'
};

// Bundle-write helper for picker click handlers — keeps the
// click-to-persist contract in one place so the picker JSX stays
// presentational. Returns the resolved id (handy for immediate
// state updates without re-reading storage).
export const writeAppearanceChoice = (key, id, attrName) => {
  try {
    localStorage.setItem(key, id);
    if (typeof document !== 'undefined' && attrName) {
      document.documentElement.setAttribute(attrName, id);
    }
  } catch {}
  return id;
};

// ─────────── PRE-PAINT APPLY (density + send-tone data-attrs) ───────────
//
// Apply the user's saved density + send-tone overrides to <html
// data-kot3-message-density=…> and <html data-kot3-send-tone=…>
// BEFORE React mounts, mirroring the earlier documentElement
// data-theme side-effect.  Falls back to the registry's defaults so
// the first paint always has consistent dimensions; absence of the
// attribute would otherwise collapse layouts to whatever the last
// caller set.
//
// Also writes the resolved KOT3CHAT_PARAMS.version to a localStorage
// key so future migrations can detect a stale localStorage payload
// and run their migration before applying.
if (typeof document !== 'undefined') {
  try {
    const _density = readSavedDensity();
    document.documentElement.setAttribute('data-kot3-message-density', _density);
    const _tone = readSavedSendTone();
    document.documentElement.setAttribute('data-kot3-send-tone', _tone);
    // KOT3CHAT_VERSION_KEY is intentionally NOT written yet — no migrator
    // reads it; once a shape-breaking change lands in params.js this block
    // becomes the migrator entry-point (read persisted, diff version,
    // rewrite).  See KOT3CHAT_VERSION_KEY above.
  } catch {}
}
