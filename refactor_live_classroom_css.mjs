// Inject CSS for slim chat panel + floating participant strip + manager modal.
import fs from 'fs';

const file = 'src/styles/index.css';
let src = fs.readFileSync(file, 'utf-8');

const marker = '.live-toolbar-btn.active {\n  background: linear-gradient(135deg, #e91e63, #9c27b0) !important;\n  border-color: rgba(255, 255, 255, 0.25) !important;\n}';

const slimCss = `
.live-toolbar-btn.active {
  background: linear-gradient(135deg, #e91e63, #9c27b0) !important;
  border-color: rgba(255, 255, 255, 0.25) !important;
}

/* === Slim chat panel: 440 → 360 so video gets more breathing room === */
.live-chat-panel {
  width: 360px !important;
}

@media (min-width: 768px) {
  .live-classroom-video-surface.chat-open {
    right: 360px !important;
  }
  .pip-overlay.pip-chat-open {
    left: 20px !important;
  }
}

/* === Floating Participant Avatar Strip (Instagram Live / live broadcast style) === */
@keyframes live-participant-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(76,175,80,0.45); }
  50% { box-shadow: 0 0 0 8px rgba(76,175,80,0); }
}

.live-participant-strip {
  position: fixed;
  top: 50%;
  left: 16px;
  transform: translateY(-50%);
  z-index: 24;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-start;
  gap: 10px;
  pointer-events: none; /* let only children capture */
  max-height: 70vh;
}

.live-participant-strip-fab,
.live-participant-strip .live-participant-pill {
  pointer-events: auto;
}

.live-participant-strip-fab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(0,0,0,0.62);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.16);
  backdrop-filter: blur(14px);
  padding: 8px 14px;
  border-radius: 999px;
  font-weight: 800;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(0,0,0,0.42);
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.live-participant-strip-fab:hover {
  transform: translateY(-2px) scale(1.04);
  background: linear-gradient(135deg, rgba(233,30,99,0.78), rgba(156,39,176,0.78));
  border-color: rgba(255,255,255,0.32);
}

.live-participant-strip-fab:active {
  transform: scale(0.94);
}

.live-participant-strip-fab:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.live-participant-strip-count {
  background: rgba(255,255,255,0.16);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  min-width: 18px;
  text-align: center;
}

.live-participant-strip-list {
  display: flex;
  flex-direction: column-reverse;
  gap: 6px;
  pointer-events: auto;
}

.live-participant-pill {
  --avatar-color: #e91e63;
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--avatar-color);
  border: 2px solid rgba(255,255,255,0.20);
  box-shadow: 0 6px 14px rgba(0,0,0,0.36);
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  font-size: 0.78rem;
  overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.live-participant-pill:hover {
  transform: translateY(-2px) scale(1.08);
  border-color: rgba(255,255,255,0.55);
  box-shadow: 0 10px 22px rgba(0,0,0,0.55);
}

.live-participant-pill:active {
  transform: scale(0.95);
}

.live-participant-pill:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.live-participant-pill-initials {
  text-shadow: 0 1px 2px rgba(0,0,0,0.45);
}

.live-participant-pill.more {
  background: rgba(0,0,0,0.62);
  color: #fff;
  font-size: 0.72rem;
  border-color: rgba(255,255,255,0.16);
  backdrop-filter: blur(12px);
}

.live-participant-pill.speaking {
  border-color: rgba(76,175,80,0.85);
  animation: live-participant-pulse 1.4s ease-in-out infinite;
}

.live-participant-pill-live {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #4caf50;
  border: 2px solid #0a0c12;
  box-shadow: 0 0 6px rgba(76,175,80,0.7);
}

/* Auto-collapse strip on mobile to just the count badge */
@media (max-width: 768px) {
  .live-participant-strip {
    top: auto;
    left: 12px;
    bottom: 24px;
    transform: none;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    max-height: 50px;
  }
  .live-participant-strip-list {
    flex-direction: row;
    max-width: calc(100vw - 200px);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .live-participant-strip-list::-webkit-scrollbar { display: none; }
  .live-participant-pill {
    width: 32px;
    height: 32px;
    font-size: 0.72rem;
  }
}

/* === Participant Manager Sheet (replaces the removed participants tab) === */
.live-participants-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.52);
  backdrop-filter: blur(3px);
  z-index: 33;
  animation: live-backdrop-fade-in 220ms ease-out forwards;
}

.live-participants-manager {
  position: fixed;
  left: 16px;
  bottom: 16px;
  width: 360px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  background: linear-gradient(180deg, rgba(20,21,31,0.96), rgba(14,15,22,0.96));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 20px 50px rgba(0,0,0,0.55);
  border-radius: 24px;
  z-index: 34;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: live-panel-slide-in 280ms cubic-bezier(0.22,1,0.36,1) forwards;
  transform-origin: bottom left;
}

@keyframes live-participants-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.live-participants-manager {
  animation: live-participants-slide-up 220ms cubic-bezier(0.22,1,0.36,1) forwards;
}

.live-participants-manager-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 16px 0;
  scrollbar-width: thin;
}

.live-participants-manager-list::-webkit-scrollbar { width: 6px; }
.live-participants-manager-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 4px; }

@media (max-width: 768px) {
  .live-participants-manager {
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    max-height: 70vh;
  }
}
`;

if (src.includes('Floating Participant Avatar Strip')) {
  console.log('CSS already injected.');
} else {
  src = src.replace(marker, slimCss);
  fs.writeFileSync(file, src, 'utf-8');
  console.log('CSS injected.');
}
