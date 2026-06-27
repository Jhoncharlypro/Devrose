/**
 * src/components/kot3chat/constants.js
 *
 * Pure constants + small helpers used by Kot3Chat. No React hooks, no JSX,
 * no useState / useRef. Kot3Chat.jsx imports everything from here.
 *
 * Side effect: sets `data-theme` on <html> at module-evaluation time so the
 * very first paint already has the correct theme (no flash of wrong theme).
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
// Matches the `:root[data-theme="..."]` CSS blocks in src/styles/kot3chat.css.
// Each theme is what KO3Chat renders in the picker + what it writes to
// localStorage / document root.
//
// Shape: { id, label, emoji, accent, bg, isLight }
export const THEMES = [
  { id: 'dark',            label: 'DevRose Dark',     emoji: '🌙', accent: '#e91e63', bg: 'linear-gradient(135deg,#1e1e2f 0%,#12131a 50%,#e91e63 100%)', isLight: false },
  { id: 'messenger-light', label: 'Messenger Light',  emoji: '☀️', accent: '#0084ff', bg: 'linear-gradient(135deg,#ffffff 0%,#f0f2f5 50%,#0084ff 100%)', isLight: true  },
  { id: 'messenger-dark',  label: 'Messenger Dark',   emoji: '🌑', accent: '#0084ff', bg: 'linear-gradient(135deg,#242526 0%,#18191a 50%,#0084ff 100%)', isLight: false },
  { id: 'rose',            label: 'Rose',             emoji: '🌹', accent: '#ff4d6d', bg: 'linear-gradient(135deg,#2b161c 0%,#1a0f12 50%,#ff4d6d 100%)', isLight: false },
  { id: 'sunset',          label: 'Sunset',           emoji: '🌅', accent: '#ff8a00', bg: 'linear-gradient(135deg,#2d2117 0%,#1c1510 50%,#ff8a00 100%)', isLight: false },
  { id: 'forest',          label: 'Forest',           emoji: '🌲', accent: '#00b862', bg: 'linear-gradient(135deg,#192e22 0%,#0f1a14 50%,#00b862 100%)', isLight: false },
  { id: 'ocean',           label: 'Ocean',            emoji: '🌊', accent: '#00d4ff', bg: 'linear-gradient(135deg,#142436 0%,#09121a 50%,#00d4ff 100%)', isLight: false },
  { id: 'dusk',            label: 'Dusk Lavender',    emoji: '🌌', accent: '#b366ff', bg: 'linear-gradient(135deg,#201a30 0%,#13101c 50%,#b366ff 100%)', isLight: false },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));

// ─────────── LOCALSTORAGE KEYS ───────────
export const LEGACY_THEME_KEY = 'kot3_dark_mode';
export const ACTIVE_THEME_KEY = 'kot3_active_theme';

// Module-scope flag so the documentElement data-theme side effect runs at
// most once per page load, even if this module is evaluated multiple times
// (e.g. imported from two distinct paths during HMR). MUST be `let`, not
// `const`, because we mutate it the first time the side-effect runs —
// assigning to a const would throw a TypeError and break the side effect.
let __KOT3_THEME_INITIALIZED__ = false;

// ─────────── THEME RESOLVER (used at startup + as useState init) ───────────
// Migrates the legacy boolean `kot3_dark_mode=false` storage entry to the new
// `kot3_active_theme='messenger-light'` scheme, then returns the active theme id.
// Returns 'dark' as a safe default if localStorage is unavailable.
export const resolveInitialTheme = () => {
  try {
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'false') {
      try { localStorage.removeItem(LEGACY_THEME_KEY); } catch {}
      try { localStorage.setItem(ACTIVE_THEME_KEY, 'messenger-light'); } catch {}
      return 'messenger-light';
    }
    const saved = localStorage.getItem(ACTIVE_THEME_KEY);
    if (saved && THEME_BY_ID[saved]) return saved;
  } catch {}
  return 'dark';
};

// Side effect: paint the document with the resolved theme before React even
// mounts, so there's no flash of the default theme. Idiempotent — wraps in a
// module-scope sentinel so accidental double-evaluation (e.g. via dual
// import paths during dev + HMR) does not re-write documentElement.
if (typeof document !== 'undefined') {
  try {
    if (!__KOT3_THEME_INITIALIZED__) {
      document.documentElement.setAttribute('data-theme', resolveInitialTheme());
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
