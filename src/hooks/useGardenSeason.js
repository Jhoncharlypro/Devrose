import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * useGardenSeason — Phase 17a (Garden Protocol: Saison Kaché)
 *
 * Replaces the Phase 12 "isThirsty" state with a calmer, philosophical
 * dormancy model. The user's garden can be in one of three states:
 *   - 'active'   — recent activity (< 14 days). Normal growth season.
 *   - 'dormant'  — 14+ days of inactivity. Garden rests under frost.
 *   - 'reviving' — user returned, frost is melting. Auto-transitions to
 *                  'active' after the 1.5s melt animation.
 *
 * After revival, a 7-day +2x XP multiplier is granted. The multiplier
 * is purely client-side in this Phase 17a pass — server-side
 * persistence is Phase 17b (would need Profile.dormant_since +
 * Profile.revival_multiplier_until + a Django migration).
 *
 * localStorage schema:
 *   - kot3_jaden_visit   (string timestamp)  — replaces jadenWoz_lastVisit
 *   - kot3_jaden_revived (string timestamp)  — when the last revival happened
 *
 * Migration: on first read, if the new `kot3_jaden_visit` key is missing
 * but the legacy `jadenWoz_lastVisit` key exists, copy the legacy value
 * to the new key and delete the legacy one. Idempotent.
 *
 * Returns:
 *   - seasonState: 'active' | 'dormant' | 'reviving'
 *   - multiplierActive: boolean
 *   - multiplierTimeRemaining: number | null  (ms until expiry)
 *   - triggerRevival: () => void  — call from the first user interaction
 *   - multiplierText: string — formatted "6j 23h" for the banner
 */
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MULTIPLIER_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_VISIT_KEY = 'jadenWoz_lastVisit';
const VISIT_KEY = 'kot3_jaden_visit';
const REVIVED_KEY = 'kot3_jaden_revived';

function readVisitTimestamp() {
  try {
    let raw = localStorage.getItem(VISIT_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_VISIT_KEY);
      if (legacy) {
        // Migrate: copy legacy to new key, then remove legacy.
        localStorage.setItem(VISIT_KEY, legacy);
        localStorage.removeItem(LEGACY_VISIT_KEY);
        raw = legacy;
      } else {
        // Brand-new user: stamp "now" so the next 14 days count.
        raw = String(Date.now());
        localStorage.setItem(VISIT_KEY, raw);
      }
    }
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : Date.now();
  } catch (_) {
    return Date.now();
  }
}

function readRevivedTimestamp() {
  try {
    const raw = localStorage.getItem(REVIVED_KEY);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch (_) {
    return null;
  }
}

function writeRevivedTimestamp() {
  try {
    localStorage.setItem(REVIVED_KEY, String(Date.now()));
  } catch (_) {
    /* ignore quota / private mode */
  }
}

function writeVisitTimestamp() {
  try {
    localStorage.setItem(VISIT_KEY, String(Date.now()));
  } catch (_) {
    /* ignore */
  }
}

function formatRemaining(ms) {
  if (ms <= 0) return '';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}j ${hours}h`;
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function useGardenSeason() {
  const [seasonState, setSeasonState] = useState('active');
  const [multiplierActive, setMultiplierActive] = useState(false);
  const [multiplierTimeRemaining, setMultiplierTimeRemaining] = useState(null);
  const revivalTimerRef = useRef(null);
  const wateredOnceRef = useRef(false);

  // 1) On mount: read timestamps, decide state.
  useEffect(() => {
    const lastVisit = readVisitTimestamp();
    const isDormant = Date.now() - lastVisit > FOURTEEN_DAYS_MS;
    setSeasonState(isDormant ? 'dormant' : 'active');

    // 2) Check the multiplier state.
    const revivedAt = readRevivedTimestamp();
    if (revivedAt) {
      const elapsed = Date.now() - revivedAt;
      if (elapsed < MULTIPLIER_DURATION_MS) {
        setMultiplierActive(true);
        setMultiplierTimeRemaining(MULTIPLIER_DURATION_MS - elapsed);
      }
    }
  }, []);

  // 3) On unmount: stamp the visit timestamp so the next visit can
  //    compute the dormant-vs-active boundary correctly.
  useEffect(() => {
    return () => writeVisitTimestamp();
  }, []);

  // 4) Tick the multiplier countdown every minute so the banner
  //    stays accurate without forcing a re-render every second.
  useEffect(() => {
    if (!multiplierActive) return undefined;
    const id = setInterval(() => {
      const revivedAt = readRevivedTimestamp();
      if (!revivedAt) {
        setMultiplierActive(false);
        setMultiplierTimeRemaining(null);
        return;
      }
      const elapsed = Date.now() - revivedAt;
      const remaining = MULTIPLIER_DURATION_MS - elapsed;
      if (remaining <= 0) {
        setMultiplierActive(false);
        setMultiplierTimeRemaining(null);
      } else {
        setMultiplierTimeRemaining(remaining);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [multiplierActive]);

  // 5) Cross-tab sync: if another tab triggers a revival while we're
  //    open, pick up the multiplier state via the `storage` event.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === REVIVED_KEY && e.newValue) {
        const ts = parseInt(e.newValue, 10);
        if (Number.isFinite(ts)) {
          const elapsed = Date.now() - ts;
          if (elapsed < MULTIPLIER_DURATION_MS) {
            setMultiplierActive(true);
            setMultiplierTimeRemaining(MULTIPLIER_DURATION_MS - elapsed);
            setSeasonState('active');
          }
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 6) Trigger the Spring Revival animation. One-shot per mount; safe
  //    to call from any event handler. Sets the state machine into
  //    'reviving' for 1.5s, then transitions to 'active' and grants
  //    the 7-day multiplier.
  const triggerRevival = useCallback(() => {
    if (wateredOnceRef.current) return;
    wateredOnceRef.current = true;
    // Mark the revival timestamp + start the 1.5s melt animation.
    writeRevivedTimestamp();
    writeVisitTimestamp();
    setSeasonState('reviving');
    if (revivalTimerRef.current) clearTimeout(revivalTimerRef.current);
    revivalTimerRef.current = setTimeout(() => {
      setSeasonState('active');
      setMultiplierActive(true);
      setMultiplierTimeRemaining(MULTIPLIER_DURATION_MS);
      revivalTimerRef.current = null;
    }, 1500);
  }, []);

  const multiplierText = multiplierTimeRemaining != null
    ? formatRemaining(multiplierTimeRemaining)
    : '';

  return {
    seasonState,
    multiplierActive,
    multiplierTimeRemaining,
    triggerRevival,
    multiplierText,
  };
}
