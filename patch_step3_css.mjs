// patch_step3_css.mjs — append CSS rules for all the new Messenger-style UI
import fs from 'node:fs';

const CSS = 'src/styles/kot3chat.css';
let css = fs.readFileSync(CSS, 'utf-8');

const insertionPoint = '/* Responsive transitions for screen sizes */';
if (!css.includes('kot3-msg-reply-quote')) {
  const block = `
/* ===== Messenger-style reply quote inside message bubble ===== */
.kot3-msg-reply-quote {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  margin: -2px 0 6px 0;
  background: rgba(var(--primary-rgb), 0.08);
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid rgba(var(--primary-rgb), 0.16);
  transition: background-color 0.18s;
  min-width: 0;
  max-width: 100%;
}
.kot3-msg-reply-quote:hover {
  background: rgba(var(--primary-rgb), 0.14);
}
.kot3-msg-reply-quote .kot3-reply-bar {
  flex-shrink: 0;
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--primary-color), #9c27b0);
}
.kot3-msg-reply-quote .kot3-reply-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.kot3-msg-reply-quote .kot3-reply-author {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--primary-color);
}
.kot3-msg-reply-quote .kot3-reply-snippet {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kot3-message-row.sent .kot3-msg-reply-quote {
  background: rgba(255,255,255,0.10);
  border-color: rgba(255,255,255,0.18);
}
.kot3-message-row.sent .kot3-msg-reply-quote .kot3-reply-author {
  color: rgba(255,255,255,0.92);
}
.kot3-message-row.sent .kot3-msg-reply-quote .kot3-reply-snippet {
  color: rgba(255,255,255,0.78);
}
.kot3-message-row.sent .kot3-msg-reply-quote .kot3-reply-bar {
  background: linear-gradient(180deg, #ffffff, rgba(255,255,255,0.4));
}

/* ===== Inline chat image attachment ===== */
.kot3-msg-image {
  display: block;
  max-width: 100%;
  width: auto;
  height: auto;
  max-height: 240px;
  border-radius: 12px;
  cursor: zoom-in;
  margin: 2px 0;
  object-fit: cover;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.06);
  transition: transform 0.18s, box-shadow 0.18s;
}
.kot3-msg-image:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 18px rgba(0,0,0,0.35);
}

/* ===== Audio row inside bubble ===== */
.kot3-audio-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
}
.kot3-audio-play-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.20);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.kot3-audio-play-btn:hover { background: rgba(255,255,255,0.30); transform: scale(1.05); }
.kot3-audio-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.kot3-audio-meta > span:first-child {
  font-size: 12px;
  font-weight: 600;
}
.kot3-audio-sub {
  font-size: 10px;
  opacity: 0.75;
}

/* ===== Edited tag ===== */
.kot3-edited-tag {
  display: inline-block;
  margin-top: 4px;
  font-size: 9.5px;
  font-style: italic;
  font-weight: 600;
  color: rgba(255,255,255,0.62);
  letter-spacing: 0.02em;
}
.kot3-message-row.received .kot3-edited-tag {
  color: var(--text-secondary);
  opacity: 0.78;
}

/* ===== Delivery state ticks ===== */
.kot3-message-meta .fas {
  font-size: 10px;
  margin-left: 2px;
  color: var(--text-secondary);
  transition: color 0.2s;
}
.kot3-message-meta .fa-clock {
  color: var(--text-secondary);
  font-size: 9px;
}
.kot3-message-meta .fa-check {
  color: var(--text-secondary);
}
.kot3-message-meta .fa-check-double {
  color: var(--text-secondary);
}
.kot3-message-meta .fa-check-double.read {
  color: #00c8ff;
}

/* ===== Context banner (reply/edit) above input ===== */
.kot3-context-banner {
  margin: 0 14px 8px;
  padding: 10px 14px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(var(--primary-rgb), 0.18);
  background: color-mix(in srgb, var(--bg-sidebar) 92%, transparent);
  backdrop-filter: blur(14px);
  animation: kot3-context-slide-in 0.18s ease-out;
  box-shadow: 0 4px 12px rgba(0,0,0,0.10);
}
@keyframes kot3-context-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.kot3-context-banner-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(var(--primary-rgb), 0.14);
  color: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.kot3-context-banner-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kot3-context-banner-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kot3-context-banner-snippet {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kot3-context-banner-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  flex-shrink: 0;
  transition: all 0.15s;
}
.kot3-context-banner-close:hover {
  background: var(--primary-color);
  color: white;
}

/* ===== Image preview before send ===== */
.kot3-image-preview {
  margin: 0 14px 8px;
  position: relative;
  display: inline-flex;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(var(--primary-rgb), 0.18);
  box-shadow: var(--shadow-sm);
  max-width: 220px;
}
.kot3-image-preview img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 180px;
  object-fit: cover;
}
.kot3-image-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.72);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  transition: all 0.15s;
}
.kot3-image-preview-close:hover { background: var(--primary-color); }

/* ===== Attachment menu + button ===== */
.kot3-attach-trigger {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  background: rgba(var(--primary-rgb), 0.06);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.kot3-attach-trigger:hover {
  background: rgba(var(--primary-rgb), 0.14);
  transform: scale(1.04);
}
.kot3-attach-trigger.active {
  background: var(--primary-color);
  color: white;
}
.kot3-attachment-menu {
  position: absolute;
  bottom: 52px;
  left: 0;
  width: 220px;
  background: var(--bg-sidebar);
  border: 1px solid rgba(var(--primary-rgb), 0.18);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 70;
  animation: kot3-pop-in 0.16s ease-out;
}
@keyframes kot3-pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.kot3-attach-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  border-radius: 10px;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}
.kot3-attach-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.10);
  color: var(--primary-color);
}
.kot3-attach-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.kot3-attach-btn i {
  width: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--primary-color);
}

/* ===== Edit-mode send button ===== */
.kot3-send-btn-edit {
  background: linear-gradient(135deg, #00c8ff, var(--primary-color));
}
.kot3-send-btn-edit:hover {
  background: linear-gradient(135deg, var(--primary-color), #00c8ff);
}

/* ===== Scroll-to-bottom FAB ===== */
.kot3-scroll-fab {
  position: absolute;
  right: 18px;
  bottom: 20px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: var(--primary-color);
  color: white;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.4);
  transition: all 0.2s;
  z-index: 40;
  animation: kot3-fab-pop 0.22s ease-out;
}
@keyframes kot3-fab-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.85); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.kot3-scroll-fab:hover {
  background: rgba(var(--primary-rgb), 0.85);
  transform: translateY(-2px);
}

/* ===== Settings menu divider + dark mode toggle ===== */
.kot3-settings-divider {
  height: 1px;
  background: var(--border-color);
  margin: 6px 4px;
  border-radius: 1px;
}

/* ===== Hover-actions overlay extended for Reply + Edit ===== */
.kot3-msg-action-btn.kot3-msg-action-danger:hover {
  color: #ff2d55;
  background: rgba(255,45,85,0.10);
}

/* ===== Light-mode refinements ===== */
.light-mode-chat .kot3-recording-wave { color: #1c1e21; }
.light-mode-chat .kot3-context-banner {
  background: color-mix(in srgb, #ffffff 92%, transparent);
}
.light-mode-chat .kot3-attachment-menu {
  background: #ffffff;
}
.light-mode-chat .kot3-msg-image {
  background: #f0f2f5;
}

`;
  css = css.replace(insertionPoint, block + '\n' + insertionPoint);
  console.log('CSS BLOCK injected before "' + insertionPoint + '"');
} else {
  console.log('CSS block already present; SKIP.');
}

fs.writeFileSync(CSS, css);
console.log('CSS length now:', css.length);
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
console.log('CSS braces: open=' + open + ' close=' + close + ' balanced=' + (open === close));
