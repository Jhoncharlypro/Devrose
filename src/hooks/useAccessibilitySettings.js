/**
 * src/hooks/useAccessibilitySettings.js
 *
 * Single hook for all client-side accessibility preferences. Persists
 * each flag to localStorage AND applies the appropriate class to
 * <body> so the global CSS can patch the active theme without a
 * theme switch.
 *
 * Why one hook (not useReducedMotion + useHighContrast separately)?
 *   * One localStorage read per render instead of two.
 *   * A single React state update when either toggles → no double
 *     re-render of consumers that depend on both.
 *   * Adding future a11y flags (font-size, color-blind palette,
 *     voice nav) is one new key + one new <body> class.
 *
 * Returns
 * -------
 *   {
 *     reduceMotion: boolean,
 *     highContrast: boolean,
 *     setReduceMotion: (boolean) => void,
 *     setHighContrast: (boolean) => void,
 *     toggleReduceMotion: () => void,
 *     toggleHighContrast: () => void,
 *   }
 *
 * The <body> classes applied:
 *   - 'kot3-reduce-motion' when reduceMotion is true
 *   - 'kot3-high-contrast' when highContrast is true
 * Both are sticky (set / removed) so they're independent — a user
 * can have one without the other.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'kot3_accessibility';
const DEFAULT = { reduceMotion: false, highContrast: false };

function readSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return {
      reduceMotion: !!parsed.reduceMotion,
      highContrast: !!parsed.highContrast,
    };
  } catch {
    return DEFAULT;
  }
}

function applyClass(name, on) {
  if (typeof document === 'undefined') return;
  try {
    if (on) document.body.classList.add(name);
    else document.body.classList.remove(name);
  } catch {}
}

function persist(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function useAccessibilitySettings() {
  const [settings, setSettings] = useState(() => readSettings());

  // Side-effect: keep <body> in sync with state.
  useEffect(() => {
    applyClass('kot3-reduce-motion', settings.reduceMotion);
    applyClass('kot3-high-contrast', settings.highContrast);
  }, [settings.reduceMotion, settings.highContrast]);

  const setReduceMotion = useCallback((value) => {
    setSettings((prev) => {
      const next = { ...prev, reduceMotion: !!value };
      persist(next);
      return next;
    });
  }, []);

  const setHighContrast = useCallback((value) => {
    setSettings((prev) => {
      const next = { ...prev, highContrast: !!value };
      persist(next);
      return next;
    });
  }, []);

  const toggleReduceMotion = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, reduceMotion: !prev.reduceMotion };
      persist(next);
      return next;
    });
  }, []);

  const toggleHighContrast = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, highContrast: !prev.highContrast };
      persist(next);
      return next;
    });
  }, []);

  return {
    reduceMotion: settings.reduceMotion,
    highContrast: settings.highContrast,
    setReduceMotion,
    setHighContrast,
    toggleReduceMotion,
    toggleHighContrast,
  };
}

export default useAccessibilitySettings;
