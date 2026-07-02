import React from 'react';

/**
 * FrostOverlay — Phase 17a (Garden Protocol: Saison Kaché)
 *
 * A silver/blue frost layer that covers the Jaden Woz during dormancy.
 * Pure CSS animation; no canvas, no JS animation. Mobile-friendly.
 *
 * The overlay renders ABOVE the plants (z-index: 5) but BELOW the topbar
 * (z-index: 50+). Pointer-events: none so the user can still click the
 * pot cards to navigate into a course while the frost is visible.
 *
 * When `isReviving` is true, the `is-reviving` modifier triggers a 1.5s
 * melt animation (opacity 1→0, blur 2px→0, grayscale 50%→0). After the
 * animation completes the parent should unmount the overlay by setting
 * `active={false}`.
 */
export function FrostOverlay({ active, isReviving }) {
  if (!active) return null;
  return (
    <div
      className={`jaden-frost-overlay${isReviving ? ' is-reviving' : ''}`}
      aria-hidden="true"
    />
  );
}

export default FrostOverlay;
