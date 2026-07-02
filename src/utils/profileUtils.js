/**
 * src/utils/profileUtils.js
 *
 * Shared profile helpers extracted from the various profile-bearing
 * components (MyProfile, Kot3Profile, JadenWoz, Settings) so the
 * codebase has a single source of truth. Pure functions only — no
 * React, no DOM access beyond the canvas inside resizeImage.
 *
 * Exports
 * -------
 *  hashHue(seed)
 *      Deterministic 0-359 hue from an arbitrary string. Used to pick
 *      a stable per-user color for the rose avatar + cover gradient.
 *      Same algorithm as JadenWoz so the visual language is unified.
 *
 *  resizeImage(file, maxW, maxH, quality)
 *      Async: reads a File, decodes to <img>, downsamples to fit
 *      maxW × maxH, returns a JPEG data URL. Used by every avatar
 *      picker in the app.
 *
 *  fieldVisibility(privacy, persona)
 *      Given a privacy shape { profile_visibility, last_seen_visibility,
 *      show_contact, allow_dms } and a persona ('self' | 'friend' |
 *      'stranger'), returns { phone, email, country, last_seen, blocked }
 *      so the Kot3 profile preview can redact fields in real-time.
 *      Mirrors the backend's ProfileViewSet.retrieve redaction.
 *
 *  PERSONA_LABELS
 *      4-language label object for the persona pill toggle.
 *
 *  bucketRelativeTime(iso, lang)
 *      Returns a human-friendly "5m ago" / "2h ago" / "Yesterday" /
 *      "3d ago" string. Used by the activity log timeline.
 */

// ─── 1. hashHue ────────────────────────────────────────────────────────────
/**
 * Deterministic 0-359 hue from an arbitrary string.
 * Uses the classic djb2-like 31-multiplier string hash and clamps to
 * the hue circle. Same algorithm as the previous inline copies so
 * the rose colors for existing users do NOT change on rollout.
 *
 * @param {string|number|null|undefined} seed
 * @returns {number} integer in [0, 359]
 */
export function hashHue(seed) {
  const s = String(seed == null ? '' : seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;  // keep in 32-bit unsigned
  }
  return h % 360;
}

// ─── 2. resizeImage ────────────────────────────────────────────────────────
/**
 * Resize an image File to fit inside maxW × maxH, preserving aspect
 * ratio. Returns a JPEG data URL (smaller than PNG for the same view).
 * Used by every avatar picker in the app (MyProfile, Settings, future
 * profile widgets).
 *
 * @param {File|Blob} file
 * @param {number} maxW
 * @param {number} maxH
 * @param {number} [quality=0.85]  JPEG quality in [0, 1]
 * @returns {Promise<string>} data URL
 */
export function resizeImage(file, maxW, maxH, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW || height > maxH) {
          const ratio = Math.min(maxW / width, maxH / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ─── 3. fieldVisibility ────────────────────────────────────────────────────
/**
 * Given a privacy shape and a persona, return which fields that
 * persona would actually see. Mirrors the backend
 * ``ProfileViewSet.retrieve`` redaction so the client-side persona
 * emulator shows exactly what the API would return.
 *
 * ``self`` is intentionally never blocked — viewing your own profile
 * must always show every field, even if the user has set their
 * profile to ``private``. This is what the user uses to verify
 * their own data.
 *
 * @param {{profile_visibility?: string, last_seen_visibility?: string,
 *          show_contact?: boolean, allow_dms?: boolean}} privacy
 * @param {'self'|'friend'|'stranger'} persona
 * @returns {{phone: boolean, email: boolean, country: boolean,
 *           last_seen: boolean, blocked: boolean}}
 */
export function fieldVisibility(privacy, persona) {
  const profileVis = privacy?.profile_visibility || 'public';
  const lastSeenVis = privacy?.last_seen_visibility || 'everyone';
  const showContact = !!privacy?.show_contact;

  if (persona === 'self') {
    return { phone: true, email: true, country: true, last_seen: true, blocked: false };
  }

  // Profile visibility gates the whole profile.
  const canSeeProfile =
    profileVis === 'public' ||
    (profileVis === 'friends' && persona === 'friend');

  if (!canSeeProfile) {
    return { phone: false, email: false, country: false, last_seen: false, blocked: true };
  }

  return {
    phone: showContact,
    email: showContact,
    country: true,
    last_seen:
      lastSeenVis === 'everyone' ||
      (lastSeenVis === 'friends' && persona === 'friend'),
    blocked: false,
  };
}

// ─── 4. PERSONA_LABELS ─────────────────────────────────────────────────────
/**
 * 4-language label set for the persona pill toggle. Kept in the
 * utils module so any future component (not just Kot3Profile) can
 * show the same labels.
 */
export const PERSONA_LABELS = {
  ht: { stranger: 'Nenpòt moun', friend: 'Zanmi Komen', you: 'Ou menm' },
  en: { stranger: 'Stranger',   friend: 'Mutual Friend', you: 'You' },
  es: { stranger: 'Cualquiera', friend: 'Amigo en común', you: 'Tú' },
  fr: { stranger: 'Inconnu',    friend: 'Ami commun',   you: 'Vous' },
};

// ─── 5. bucketRelativeTime ─────────────────────────────────────────────────
/**
 * Compact relative-time formatter for the activity log timeline.
 * Falls back to a localized short date for entries older than a week.
 *
 * Examples (now = 2026-07-02 12:00 UTC):
 *   bucketRelativeTime('2026-07-02T11:55:00Z', 'en') -> '5m ago'
 *   bucketRelativeTime('2026-07-02T09:00:00Z', 'en') -> '3h ago'
 *   bucketRelativeTime('2026-07-01T12:00:00Z', 'en') -> 'Yesterday'
 *   bucketRelativeTime('2026-06-28T12:00:00Z', 'en') -> '4d ago'
 *   bucketRelativeTime('2026-05-15T12:00:00Z', 'en') -> 'May 15'
 *
 * @param {string} iso  ISO-8601 timestamp
 * @param {string} lang  2-char language code (ht/en/es/fr)
 * @returns {string}
 */
export function bucketRelativeTime(iso, lang = 'en') {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60000);

  // Ultra-recent: minutes
  if (diffMin < 1) return lang === 'ht' ? 'kounye a' : 'now';
  if (diffMin < 60) return lang === 'ht' ? `${diffMin}m de sa` : `${diffMin}m ago`;

  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return lang === 'ht' ? `${diffH}h de sa` : `${diffH}h ago`;

  // Yesterday bucket
  const oneDayMs = 86_400_000;
  if (diffH < 48) return lang === 'ht' ? 'Yè' : 'Yesterday';

  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return lang === 'ht' ? `${diffD}j de sa` : `${diffD}d ago`;

  // Older: short month + day
  try {
    return new Date(iso).toLocaleDateString(
      lang === 'ht' ? 'fr-HT' : lang,
      { month: 'short', day: 'numeric' },
    );
  } catch (_) {
    return new Date(iso).toLocaleDateString();
  }
}
