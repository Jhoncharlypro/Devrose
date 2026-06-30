/**
 * src/components/kot3chat/PremiumBadge.jsx
 *
 * Tiny premium-status chip. Renders a gold crown + "Premium" label
 * with three size variants. The host owns the `isPremium` boolean
 * (sourced from /api/premium/status/ on mount). When the user is
 * not premium, the badge renders nothing — by design, we don't
 * nag free users with a "Get Premium" upsell from the badge slot
 * itself; that's the job of <PremiumUpsellModal/>.
 *
 * Accessibility:
 *   - role="status" with aria-live="polite" so screen readers
 *     announce the premium state when the chip appears.
 *   - `aria-label` localised so the i18n fallback works even when
 *     the calling context doesn't pass a translator.
 */
import React from 'react';

export function PremiumBadge({
  isPremium = false,
  size = 'sm',
  plan = null,
  lang = 'en',
  t = {},
}) {
  if (!isPremium) return null;
  const label = t.premium_badge_label || 'Premium';
  const planSuffix = plan ? ` · ${plan}` : '';
  return (
    <span
      className={`kot3-premium-badge kot3-premium-badge--${size}`}
      role="status"
      aria-live="polite"
      aria-label={`${label}${planSuffix}`}
      title={plan ? `${label} (${plan})` : label}
    >
      <i className="fas fa-crown" aria-hidden="true" />
      <span className="kot3-premium-badge-text">
        {label}{plan ? <em className="kot3-premium-badge-plan"> · {plan}</em> : null}
      </span>
    </span>
  );
}

export default PremiumBadge;
