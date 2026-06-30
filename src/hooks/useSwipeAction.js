/**
 * src/hooks/useSwipeAction.js
 *
 * Touch + mouse drag swipe hook for the premium Messenger Home
 * conversation cards. Powers the spec's:
 *
 *   Swipe left  → Archive / Mute / Pin (action long-press)
 *   Swipe right → Read / Delete / Block (action long-press)
 *
 * The hook is intentionally minimal:
 *
 *   • Tracks a 1-dimensional horizontal drag offset via
 *     `pointerdown → pointermove → pointerup` (so it works on
 *     trackpads, mouse, and touchscreens identically).
 *   • Caps the visual drag at MAX_DRAG (px) so a panicked swipe
 *     can never push the card off-screen.
 *   • Distinguishes "swipe" (commits the action) from "tap" (host
 *     treats as a normal card click) by an OFFSET+TIME threshold.
 *   • Calls back into the host with `{ direction: 'left' | 'right',
 *     kind: 'swipe' | 'click' }` so the host can fire actions or
 *     just navigate.
 *
 * Returns the props the host spreads on the card container plus the
 * background-classification hints for the swipe action layer
 * ("kot3-card-swipe-action.left/right visible").
 *
 * Anti-NOTEs:
 *
 *   • We deliberately do NOT use the Pointer Events API for the
 *     `pointerleave` cleanup path on a cancelled gesture (e.g. user
 *     drags beyond the card row) — `pointercancel` is delivered by
 *     the browser the moment a real-world interruption happens
 *     (incoming notification, drag-drop GIF in OS, etc) and we
 *     reset on either of `pointerup | pointercancel`.
 *   • We attach the event listeners at the document level on
 *     `pointerdown` so a drag that starts INSIDE the card continues
 *     correctly even if the user's pointer exits the card bounds
 *     mid-swipe (otherwise pointermove would stop firing).
 */
import { useEffect, useRef, useState, useCallback } from 'react'; // useCallback retained for potential future host callback memoization

const MAX_DRAG = 86;          // visual arrow swipe distance cap
const COMMIT_THRESHOLD = 72;   // distance at which a swipe commits the action
const TAP_MAX_DISTANCE = 6;    // pointer moved < this → considered a tap
const TAP_MAX_TIME = 350;      // pointer was held < this → considered a tap

export function useSwipeAction({
  enabled = true,
  onSwipeLeft,   // () => void
  onSwipeRight,  // () => void
  onClick,       // () => void
} = {}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Refs (don't trigger re-renders). pointerId tracks which pointer
  // owns the current gesture so a second finger landing mid-gesture
  // doesn't hijack it.
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTRef = useRef(0);
  const pointerIdRef = useRef(null);
  const movedRef = useRef(false);

  // Element ref the host attaches to the card. Listener attachment
  // is anchored on the document though, so the move events continue
  // when the pointer leaves the card bounds.
  const cardRef = useRef(null);

  // Ref-mirrored callback surfaces so the document-level listeners we
  // attach on mount can read the latest host intent (onSwipeLeft, etc.)
  // WITHOUT rebuilding on every render. Listener attachment runs once
  // per `enabled` flip instead of every drag frame — the prior version
  // rebuilt `endGesture` on every `offset` change and tore down + re-added
  // 3 document listeners per frame, which surfaced as measurable hitch.
  const handlersRef = useRef({});
  handlersRef.current = { onSwipeLeft, onSwipeRight, onClick };

  useEffect(() => {
    if (!enabled) return undefined;

    const onMove = (e) => {
      if (pointerIdRef.current == null || e.pointerId !== pointerIdRef.current) return;
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;
      // Latch into "this is a drag" once we cross a small dead-zone.
      if (!movedRef.current && Math.hypot(dx, dy) > 6) movedRef.current = true;

      // Horizontal-only gestural drag. If the user starts vertical
      // (page scroll), bail out and let the page scroll instead.
      if (Math.abs(dy) > Math.abs(dx) + 8 && !movedRef.current) {
        pointerIdRef.current = null;
        setOffset(0);
        return;
      }

      // Clamp the visual travel so the underlying action area always
      // remains visible.
      const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
      setOffset(clamped);
    };

    const onUp = (e) => {
      if (pointerIdRef.current == null || e.pointerId !== pointerIdRef.current) return;
      // Read latest committed offset from React state at pointerup.
      // (The setState in onMove is async, so we read what was committed
      // last; this matches what the browser shipped.)
      // We compute the current offset from clientX here so a stale
      // state value doesn't trigger a wrong action.
      const finalDx = e.clientX - startXRef.current;
      const dt = Date.now() - startTRef.current;
      const wasTap = !movedRef.current && dt < TAP_MAX_TIME && Math.abs(finalDx) < TAP_MAX_DISTANCE;

      setDragging(false);
      if (Math.abs(finalDx) >= COMMIT_THRESHOLD) {
        if (finalDx > 0) handlersRef.current.onSwipeLeft?.();
        else            handlersRef.current.onSwipeRight?.();
      } else if (wasTap) {
        // It was a tap, not a swipe → fire the click action.
        handlersRef.current.onClick?.();
      }
      // Snap back to 0 (CSS transition handles the animation).
      setOffset(0);
      pointerIdRef.current = null;
      movedRef.current = false;
    };

    const onCancel = (e) => {
      if (pointerIdRef.current == null || e.pointerId !== pointerIdRef.current) return;
      // User started a drag but the OS interrupted (incoming call,
      // dragenter). Snap back without firing any action.
      setOffset(0);
      setDragging(false);
      pointerIdRef.current = null;
      movedRef.current = false;
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }, [enabled]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    // Only the primary mouse button or a single-finger touch starts
    // a swipe. Right-click is reserved for the host's context menu.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startTRef.current = Date.now();
    movedRef.current = false;
    setDragging(true);
    // Don't preventDefault — we want passive listeners + the page to
    // still scroll vertically when the user begins a vertical drag.
  }, [enabled]);

  return {
    cardRef,
    bind: {
      ref: cardRef,
      onPointerDown,
    },
    style: {
      transform: dragging || offset ? `translateX(${offset}px)` : undefined,
      transition: dragging ? 'none' : 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
    state: {
      offset,
      dragging,
      direction: offset > TAP_MAX_DISTANCE ? 'left'
                : offset < -TAP_MAX_DISTANCE ? 'right'
                : 'none',
    },
  };
}

export default useSwipeAction;
