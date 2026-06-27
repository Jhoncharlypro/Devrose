// v2 CSS: floating chat-comment popups (low opacity) + better leave button + animated online dot.
// Also patch JS for STEP 8 reset in disconnectClassroom.

import fs from 'fs';

// =====================================================================
// PATCH 1: Add chatPopups reset in disconnectClassroom (STEP 8 retry).
// =====================================================================
const jsFile = 'src/components/LiveClassroom.jsx';
let js = fs.readFileSync(jsFile, 'utf-8');
const resetMarker = 'setFloatingReactions([]); // Reset on disconnect so stale state doesn\'t mutate after teardown.';
if (js.indexOf(resetMarker) >= 0 && js.indexOf('setChatPopups([])') < 0) {
  js = js.replace(
    resetMarker,
    resetMarker + '\n    setChatPopups([]); // Clear active comment popups so they don\'t outlive the room.'
  );
  fs.writeFileSync(jsFile, js, 'utf-8');
  console.log('JS PATCH 1 ok: chatPopups reset added in disconnect.');
} else {
  console.log('JS PATCH 1 skipped (already applied or anchor missing).');
}

// =====================================================================
// PATCH 2: CSS for the new comment popups + leave button + animated dot.
// Append a single CSS block at the end of the file.
// =====================================================================
const cssFile = 'src/styles/index.css';
let css = fs.readFileSync(cssFile, 'utf-8');

const cssBlock = `

/* ===== Live Classroom v2: ephemeral comment popups (low opacity, Avatar + bubble) ===== */
@keyframes live-comment-popup-rise {
  0% {
    transform: translate3d(0, 14px, 0) scale(0.85);
    opacity: 0;
  }
  10% {
    transform: translate3d(0, 0, 0) scale(1);
    opacity: 0.78;
  }
  70% {
    transform: translate3d(0, -180px, 0) scale(0.96);
    opacity: 0.55;
  }
  100% {
    transform: translate3d(0, -340px, 0) scale(0.85);
    opacity: 0;
  }
}

.live-comment-popups-layer {
  position: fixed;
  right: 16px;
  bottom: 100px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  max-width: 320px;
  /* Container itself stays at 1.0; individual popups are translucent so live shows through */
}

.live-comment-popup {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px 8px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.40);
  opacity: 0.78; /* intentionally translucent so live video shows through */
  animation: live-comment-popup-rise 4.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  will-change: transform, opacity;
  pointer-events: auto;
  max-width: 320px;
}

.live-comment-popup.is-local {
  background: rgba(233, 30, 99, 0.30);
  border: 1px solid rgba(233, 30, 99, 0.42);
  opacity: 0.78;
}

.live-comment-popup-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  font-weight: 800;
  font-size: 0.72rem;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  border: 2px solid rgba(255, 255, 255, 0.18);
}

.live-comment-popup-bubble {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.live-comment-popup-name {
  font-size: 0.68rem;
  font-weight: 800;
  color: #ffd6e7;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-comment-popup-msg {
  font-size: 0.85rem;
  color: #f4f7fb;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
  max-width: 260px;
}

@media (max-width: 768px) {
  .live-comment-popups-layer {
    right: 10px;
    bottom: 80px;
    max-width: calc(100vw - 110px);
  }
  .live-comment-popup {
    padding: 6px 10px 6px 6px;
    gap: 8px;
  }
  .live-comment-popup-avatar {
    width: 26px;
    height: 26px;
    font-size: 0.66rem;
  }
  .live-comment-popup-msg {
    font-size: 0.80rem;
    max-width: 200px;
  }
}

/* Reduced-motion: animations off, opacity still translucent so live shows through */
@media (prefers-reduced-motion: reduce) {
  .live-comment-popup {
    animation: none;
    transition: opacity 0.25s ease;
  }
}

/* Strip is now just a count FAB with an animated online dot (static avatar pills removed) */
.live-participant-strip-online-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4caf50;
  margin-left: 6px;
  box-shadow: 0 0 6px rgba(76, 175, 80, 0.75);
  animation: live-participant-pulse 1.6s ease-in-out infinite;
}

/* Leave button gets a label and a halo on hover for stronger affordance */
.live-leave-btn {
  transition: transform 0.18s ease, box-shadow 0.22s ease, padding 0.18s ease;
}

.live-leave-btn:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 14px 28px rgba(244,67,54,0.55), 0 0 0 6px rgba(244,67,54,0.20) !important;
  padding: 0 22px !important;
}

.live-leave-btn:active {
  transform: scale(0.95);
}

.live-leave-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}

@media (max-width: 768px) {
  /* Mobile collapses label so the leave button is icon-only */
  .live-leave-btn-label, .live-leave-btn-x { display: none !important; }
  .live-leave-btn { padding: 0 !important; min-width: 44px !important; }
}
`;

if (css.indexOf('live-comment-popup-rise') < 0) {
  css = css + cssBlock;
  fs.writeFileSync(cssFile, css, 'utf-8');
  console.log('CSS PATCH 2 ok: comment popup + leave button CSS injected.');
} else {
  console.log('CSS PATCH 2 already applied.');
}

console.log('Done.');
