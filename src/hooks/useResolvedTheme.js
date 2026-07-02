/**
 * src/hooks/useResolvedTheme.js
 *
 * Custom hook that resolves the application's *active theme id* (the value
 * stored in localStorage under kot3_active_theme) into the *rendered theme id*
 * (the value written to <html data-theme>).
 *
 * Most themes pass through 1:1 (dark → dark, ocean → ocean). But 'system' and
 * 'custom' are sentinels — they need an active resolution pass:
 *
 *   system  — tracks window.matchMedia('(prefers-color-scheme: dark)').
 *             Renders 'dark' if the OS prefers dark, else 'messenger-light'.
 *             Subscribes to 'change' events so a user toggling their OS at
 *             runtime causes a re-render and the chat surface moves themes
 *             WITHOUT a page refresh.
 *
 *   custom  — picks a base palette via matchMedia (so light-mode users still
 *             see a light palette below their custom accent) and overlays a
 *             user-chosen accent by writing inline CSS vars:
 *               --primary-color  (e.g. #b366ff)
 *               --primary-rgb    (e.g. "179,102,255")
 *             The accent is persisted in localStorage under 'kot3_custom_accent'
 *             so the constants.js pre-paint side effect can apply it before
 *             React mounts (no flash of default pink on first paint).
 *
 * Returns
 * -------
 *   { resolvedTheme, isDark }
 *     resolvedTheme  — string; the theme id currently rendered (e.g. 'dark'
 *                       for system on dark OS, 'messenger-light' for custom
 *                       on light OS).
 *     isDark         — boolean; convenience read for callers that want a
 *                       quick light/dark flip.
 *
 * The hook does NOT own localStorage writes for the active id — that is the
 * host's responsibility. We exclusively WRITE data-theme + inline CSS vars.
 *
 * Anti-flicker note
 * -----------------
 * The DOM write runs in useLayoutEffect (not useEffect). This closes the
 * window where a sentinel user would otherwise see data-theme='system' or
 * 'custom' for one frame (no matching CSS block → fall-through to default
 * palette) before the hook commits a resolved id. useLayoutEffect fires
 * synchronously after the React commit phase but before the browser paints,
 * so the initial CSS state is correct on the very first paint.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  THEME_BY_ID,
  hexToRgb,
  readCustomAccent,
} from '../components/kot3chat/params';

// Resolve "is the OS currently in dark mode?" without React subscription —
// pure synchronous read. Result is a stable boolean per OS eval.
const systemPrefersDark = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

// Resolve a static theme id to isDark without matchMedia — used for the
// non-sentinel branches where the answer is already known from the registry.
const staticIsDark = (themeId) => {
  const t = THEME_BY_ID[themeId];
  if (!t) return true;
  if (t.isLight === true)  return false;
  if (t.isLight === false) return true;
  return null; // sentinel — fall through to matchMedia path
};

/**
 * Apply the resolved palette + (optional) custom accent to <html>.
 *
 * Params
 *   resolvedBaseId  — the id we want data-theme to bear (e.g. 'dark',
 *                     'messenger-light', 'messenger-dark'). Always set.
 *   customAccent    — if non-null AND hex-valid, write --primary-color +
 *                     --primary-rgb inline overrides. If null, REMOVE any
 *                     inline overrides from a previous 'custom' session so
 *                     the :root[data-theme=…] CSS block pixels win.
 *
 * The branch on truthiness of ``customAccent`` (not on a sentinel check)
 * keeps the call site simple — the hook caller passes an accent exactly
 * when activeTheme === 'custom'.
 */
const applyResolved = (resolvedBaseId, customAccent) => {
  if (typeof document === 'undefined') return;
  try {
    document.documentElement.setAttribute('data-theme', resolvedBaseId);
    if (customAccent && hexToRgb(customAccent)) {
      document.documentElement.style.setProperty('--primary-color', customAccent);
      document.documentElement.style.setProperty('--primary-rgb', hexToRgb(customAccent));
    } else {
      // Clear any inline overrides so the CSS block for data-theme wins.
      document.documentElement.style.removeProperty('--primary-color');
      document.documentElement.style.removeProperty('--primary-rgb');
    }
  } catch {}
};

export function useResolvedTheme(activeTheme) {
  // systemPref state drives re-renders when the OS flips scheme at runtime.
  // Initial value is computed once on mount; useEffect keeps it fresh.
  const [systemPref, setSystemPref] = useState(() => systemPrefersDark());

  // Subscribe only when sentinel is active. We use the standard
  // addEventListener API; Safari 14+ supports it and the legacy addListener
  // pair has been deprecation-warned for years — not worth carrying.
  useEffect(() => {
    if (activeTheme !== 'system' && activeTheme !== 'custom') return undefined;
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemPref(!!e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [activeTheme]);

  // Compute the resolved palette id + accent for the current `(activeTheme,
  // systemPref)` tuple. Memoize so we don't re-read localStorage on every
  // effect; the inputs are stable for the whole render and the accent
  // cannot change unless the user actively picks a new accent (which then
  // triggers another state change in the host and re-renders us anyway).
  const { resolvedBaseId, accent } = useMemo(() => {
    const t = THEME_BY_ID[activeTheme];
    if (!t || (!t.isSystem && !t.isCustom)) {
      return { resolvedBaseId: activeTheme, accent: null };
    }
    if (t.isSystem) {
      return { resolvedBaseId: systemPref ? 'dark' : 'messenger-light', accent: null };
    }
    // isCustom
    return {
      resolvedBaseId: systemPref ? 'messenger-dark' : 'messenger-light',
      accent: readCustomAccent(),
    };
  }, [activeTheme, systemPref]);

  // Apply the resolved theme + (if 'custom') accent to <html>. useLayoutEffect
  // runs synchronously after React commits but BEFORE the browser paints, so
  // there is no flicker window where the wrong palette is visible.
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    applyResolved(resolvedBaseId, accent);
  }, [resolvedBaseId, accent]);

  // Return the rendered id + isDark for callers (e.g. ThemeSettingsMenu uses
  // resolvedTheme to label System/Custom chips with the OS direction).
  const t = THEME_BY_ID[activeTheme];
  if (!t) {
    return { resolvedTheme: activeTheme, isDark: true };
  }
  if (t.isSystem) {
    const resolved = systemPref ? 'dark' : 'messenger-light';
    return { resolvedTheme: resolved, isDark: systemPref };
  }
  if (t.isCustom) {
    const resolved = systemPref ? 'messenger-dark' : 'messenger-light';
    return { resolvedTheme: resolved, isDark: systemPref };
  }
  return {
    resolvedTheme: activeTheme,
    isDark: staticIsDark(activeTheme),
  };
}

export default useResolvedTheme;
