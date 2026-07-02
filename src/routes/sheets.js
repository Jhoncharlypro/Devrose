export const SHEETS = Object.freeze({
  DEMO: '/sheet/demo',
  ATELIER: '/sheet/atelier',
  PROFILE: '/sheet/profile',
  PRIVACY: '/sheet/privacy',
  // Settings — bare-rendered route so the cog icon in the global
  // Header no longer relies on `setIsSettingsOpen(true)` state; the
  // page itself is now addressable (deep-linkable, browser-back-able)
  // and lives behind the same /sheet/* element-replacement boundary
  // that already keeps Atelier / PrivacySpace / Kot3Profile bleed-free.
  SETTINGS: '/sheet/settings',
  // Auth — bare-rendered route so the Login / Signup button inside
  // /sheet/settings (or any future caller) can navigate to a dedicated
  // URL instead of relying on App.jsx's isAuthOpen state. Single Auth
  // mount inside the /sheet/* fragment; the regular App branches no
  // longer need their own copy because there is no in-tab Login trigger
  // left — the only one was Settings, which is now a route.
  AUTH: '/sheet/auth',
});
