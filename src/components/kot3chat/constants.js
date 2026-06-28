/**
 * src/components/kot3chat/constants.js
 *
 * Pure constants + small helpers used by Kot3Chat. No React hooks, no JSX,
 * no useState / useRef. Kot3Chat.jsx imports everything from here.
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
