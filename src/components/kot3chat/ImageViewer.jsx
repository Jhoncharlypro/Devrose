/**
 * src/components/kot3chat/ImageViewer.jsx
 *
 * Fullscreen image lightbox overlay for chat messages.
 *
 * Visual model: a transparent dark backdrop with one large image centered,
 * a close button top-right, an info bar bottom showing sender name/timestamp,
 * and optional prev/next chevrons when multiple images are passed (gallery
 * mode). The component is intentionally small and pure: it takes the
 * already-loaded data-URL (or http URL) and just renders.
 *
 * Why a separate file?
 *   - Kot3Chat.jsx is already 144k chars. Putting the viewer inline would
 *     balloon it further per the user's "kenbe sa ki egziste intak" rule.
 *   - The viewer has its own state + ref logic (Esc key, focus trap) and
 *     benefits from being independently testable.
 *
 * Props
 * -----
 *   isOpen        : boolean. Renders nothing when false.
 *   imageUrl      : string. The src for the image (data-URL or http).
 *   senderUsername: string. Name shown in the bottom info bar.
 *   createdAt     : string (ISO). Shown as '3:42 PM' style timestamp.
 *   onClose       : () => void. Called on Esc, backdrop click, or X.
 *   images        : optional array of {@code {url, senderUsername, createdAt}}
 *                    objects. When provided AND length > 1, chevrons render.
 *   onPrev / onNext: optional callbacks for chevron nav (caller-owned
 *                    external index state). Receivers should call onClose
 *                    when navigating past the last image.
 */
import React, { useEffect, useRef } from 'react';

/**
 * Format an ISO timestamp for the bottom info bar. Same rendering style as
 * the bubble timestamp in Kot3Chat.jsx (HH:MM AM/PM in en, locale-aware).
 */
function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const ImageViewer = ({
  isOpen,
  imageUrl,
  senderUsername,
  createdAt,
  onClose,
  images,
  onPrev,
  onNext,
}) => {
  const closeBtnRef = useRef(null);

  // Esc key closes. We attach to `document` so it works regardless of
  // mount-internal focus state.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        e.stopPropagation();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.stopPropagation();
        onNext();
      }
    };
    document.addEventListener('keydown', onKey);
    // Auto-focus the close button for keyboard users / accessibility.
    closeBtnRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, onPrev, onNext]);

  if (!isOpen || !imageUrl) return null;

  const galleryEnabled = Array.isArray(images) && images.length > 1;
  const showPrev = galleryEnabled && typeof onPrev === 'function';
  const showNext = galleryEnabled && typeof onNext === 'function';

  // Backdrop click closes — but clicks ON the image itself should NOT
  // close. We compare e.target vs e.currentTarget on the backdrop.
  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      className="kot3-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={senderUsername ? `Image from ${senderUsername}` : 'Image preview'}
      onClick={onBackdropClick}
    >
      {/* Close button */}
      <button
        ref={closeBtnRef}
        type="button"
        className="kot3-image-viewer-close"
        aria-label="Close image viewer"
        onClick={() => onClose?.()}
      >
        <i className="fas fa-times" aria-hidden="true"></i>
      </button>

      {/* Optional prev/next chevrons */}
      {showPrev && (
        <button
          type="button"
          className="kot3-image-viewer-chevron kot3-image-viewer-prev"
          aria-label="Previous image"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
        >
          <i className="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
      )}
      {showNext && (
        <button
          type="button"
          className="kot3-image-viewer-chevron kot3-image-viewer-next"
          aria-label="Next image"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
        >
          <i className="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
      )}

      {/* The image itself */}
      <img
        className="kot3-image-viewer-img"
        src={imageUrl}
        alt={senderUsername ? `Shared by ${senderUsername}` : 'Shared image'}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* Info bar — sender + timestamp */}
      {(senderUsername || createdAt) && (
        <div className="kot3-image-viewer-info">
          {senderUsername && (
            <span className="kot3-image-viewer-sender">@{senderUsername}</span>
          )}
          {createdAt && (
            <span className="kot3-image-viewer-time">{formatTime(createdAt)}</span>
          )}
          {galleryEnabled && (
            <span className="kot3-image-viewer-hint">
              <i className="fas fa-arrow-left" aria-hidden="true"></i>
              <i className="fas fa-arrow-right" aria-hidden="true"></i>
              <span style={{ marginLeft: 6 }}>to navigate · Esc to close</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
