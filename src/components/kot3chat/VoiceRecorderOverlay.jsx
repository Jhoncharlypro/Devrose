/**
 * src/components/kot3chat/VoiceRecorderOverlay.jsx
 *
 * Premium voice-message recorder with three gestures:
 *
 *   • Hold mic icon to start recording.
 *   • Slide LEFT during recording → cancel (delete the media recorder
 *     buffer, snap back, no audio sent).
 *   • Slide UP during recording → LOCK recording (release the button
 *     and keep recording); tap-on-screen then disappears and the
 *     lock UI shows a send/cancel pair.
 *
 * During recording we drive a 24-bar live waveform via Web Audio
 * AnalyserNode.getByteTimeDomainData. Animation is CSS-driven
 * (`kot3-waveform-pulse`) so we don't accumulate additional requestAnimationFrame
 * ticks — the bars only "react" via inline `height` percentage.
 *
 * Output
 * ------
 * Either:
 *   onCancel()              → user dragged-release to cancel
 *   onSend({ blob, duration_seconds, waveform_data })
 *                            → user released without cancel, or hit send on the locked UI
 *
 * The `waveform_data` is a normalized 0..1 array per bar (24 entries) so the
 * bubble player can replay the same waveform visually without re-decoding audio.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

const MAX_DURATION_SECONDS = 120;     // 2min soft cap to discourage abusive recordings
const CANCEL_THRESHOLD_PX = 90;       // slide this far left to commit cancel
const LOCK_THRESHOLD_PX = 70;         // slide this far up to commit lock
const WAVEFORM_BARS = 24;

const formatDuration = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export function VoiceRecorderOverlay({ onCancel, onSend, t = {} }) {
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [cancelNear, setCancelNear] = useState(false);
  const [lockNear, setLockNear] = useState(false);

  // Internal refs (don't drive renders)
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const barHeightsRef = useRef(new Array(WAVEFORM_BARS).fill(0.30)); // rolling buffer
  const rotateIndexRef = useRef(0);
  const startedAtRef = useRef(0);
  const intervalRef = useRef(null);
  const pointerIdRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const currentPosRef = useRef({ x: 0, y: 0 });
  const cancelledRef = useRef(false);
  const lockedReleasedRef = useRef(false);
  // Synchronous race guard: the host fires ``kot3:voice:start`` events from
  // a click handler that can fire twice faster than React commits the
  // ``recording === true`` state. ``startedRef`` is flipped to ``true``
  // synchronously inside ``startRecording`` so a second invocation sees the
  // updated ref and bails BEFORE the second ``getUserMedia`` runs. Without
  // this, two parallel MediaRecorder chains would push to the same
  // ``chunksRef`` array and ship a 2x-length blob.
  const startedRef = useRef(false);

  // Drive the 24-bar waveform visualization. We push the new amplitude
  // into a rotating slot and the rendered DOM reads .kot3-voice-waveform
  // span heights via a refs callback.
  const waveformRefs = useRef([]);

  const setBarAt = useCallback((idx, height) => {
    barHeightsRef.current[idx] = height;
    const el = waveformRefs.current[idx];
    if (el) el.style.height = `${Math.max(8, Math.min(100, height * 100))}%`;
  }, []);

  const teardown = useCallback(() => {
    try { intervalRef.current && clearInterval(intervalRef.current); } catch (_) {}
    intervalRef.current = null;
    try { audioContextRef.current?.close?.(); } catch (_) {}
    audioContextRef.current = null;
    analyserRef.current = null;
    try { streamRef.current?.getTracks?.().forEach(t => t.stop()); } catch (_) {}
    streamRef.current = null;
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop?.(); } catch (_) {}
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setLocked(false);
  }, []);

  // Stop the stream if the overlay unmounts (route change, logout).
  useEffect(() => teardown, [teardown]);

  // Reset startedRef whenever the overlay transitions back to idle so a
  // future press can allocate a new MediaStream. Without this, the ref
  // stays true after the FIRST completed recording and the
  // ``if (recording || startedRef.current) return`` guard permanently
  // rejects every subsequent mic-press until a page reload.
  useEffect(() => {
    if (!recording && !locked) startedRef.current = false;
  }, [recording, locked]);

  const startRecording = useCallback(async () => {
    if (recording || startedRef.current) return; // guard against double-tap
    startedRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Sample once per animation frame for the rolling waveform.
      const bufferLength = analyser.frequencyBinCount;
      const dataArr = new Uint8Array(bufferLength);
      let raf;

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArr);
        // Mean abs deviation from 128 (silence baseline).
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = Math.abs(dataArr[i] - 128);
          sum += v;
        }
        const avg = sum / bufferLength;
        // Map to 0..1 amplitude (capped roughly at 0.6 normalisation).
        const amp = Math.min(1, avg / 60);
        setBarAt(rotateIndexRef.current, amp);
        rotateIndexRef.current = (rotateIndexRef.current + 1) % WAVEFORM_BARS;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      // Clean up RAF on stop.
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        cancelAnimationFrame(raf);
        if (cancelledRef.current) {
          cancelledRef.current = false;
          teardown();
          onCancel?.();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const waveform_data = [...barHeightsRef.current];
        const duration_seconds = (Date.now() - startedAtRef.current) / 1000;
        teardown();
        onSend?.({ blob, duration_seconds, waveform_data });
      };

      // Set duration tick — but running at every 250ms instead of every 1ms so
      // the React rerender cost stays sane for long recordings.
      startedAtRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        if (elapsed >= MAX_DURATION_SECONDS) {
          try { recorder.stop(); } catch (_) {}
        } else {
          setDuration(elapsed);
        }
      }, 250);

      recorder.start();
      setRecording(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('VoiceRecorderOverlay: getUserMedia failed', err);
      startedRef.current = false;
      teardown();
      onCancel?.();
    }
  }, [recording, teardown, onCancel, onSend, setBarAt]);

  // Pointer events on the overlay surface for slide-to-cancel / slide-up-to-lock.
  const onPointerDown = (e) => {
    if (locked) return; // locked UI ignores pointer events on the wave area
    startPosRef.current = { x: e.clientX, y: e.clientY };
    currentPosRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
  };
  const onPointerMove = (e) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (locked) return; // ignore move once locked — user has committed
    currentPosRef.current = { x: e.clientX, y: e.clientY };
    const dx = e.clientX - startPosRef.current.x;
    const dy = startPosRef.current.y - e.clientY; // flip: positive = upward
    setCancelNear(dx <= -CANCEL_THRESHOLD_PX);
    setLockNear(dy >= LOCK_THRESHOLD_PX);
    // Slide visual hint — semantic only; visual handled via CSS.
  };
  const onPointerUp = (e) => {
    if (pointerIdRef.current !== e.pointerId) return;
    // Locked-mode guard: once we commit to "lock" we don't auto-send on
    // release — the user must explicitly tap Send / Trash on the
    // rendered lock UI. Without this, every natural finger-up after a
    // slide-up-to-lock silently commits a Send.
    if (locked) {
      pointerIdRef.current = null;
      setCancelNear(false);
      setLockNear(false);
      return;
    }
    const dx = e.clientX - startPosRef.current.x;
    const dy = startPosRef.current.y - e.clientY;
    pointerIdRef.current = null;
    setCancelNear(false);
    setLockNear(false);
    if (dx <= -CANCEL_THRESHOLD_PX) {
      cancelledRef.current = true;
      try { recorderRef.current?.stop(); } catch (_) {}
      return;
    }
    if (dy >= LOCK_THRESHOLD_PX) {
      setLocked(true);
      lockedReleasedRef.current = false;
      // Clear the gesture pipeline immediately so continuous finger-down
      // events don't accidentally re-fire commit logic on tiny movements.
      pointerIdRef.current = null;
      return;
    }
    // Released normally — send.
    try { recorderRef.current?.stop(); } catch (_) {}
  };

  const handleCancelButton = () => {
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch (_) {}
  };

  const handleSendButton = () => {
    try { recorderRef.current?.stop(); } catch (_) {}
  };

  return (
    <>
      {/* Always-mounted container so the host can show this whenever it
          wants. When not recording, renders `null` so the regular composer
          remains visible. */}
      {recording && (
        <div
          className="kot3-voice-recorder"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { cancelledRef.current = true; try { recorderRef.current?.stop(); } catch (_) {} }}
        >
          <span className="kot3-voice-recording-pulse" aria-hidden="true" />
          <span className="kot3-voice-recording-duration" aria-live="polite">
            {formatDuration(duration)}
          </span>
          <div className="kot3-voice-waveform" aria-hidden="true">
            {new Array(WAVEFORM_BARS).fill(0).map((_, i) => (
              <span
                key={i}
                ref={(el) => { waveformRefs.current[i] = el; }}
                style={{ height: '30%' }}
              />
            ))}
          </div>
          <span className={`kot3-voice-lock-hint${lockNear ? ' near' : ''}`} title={t.msg_voice_lock_hint || 'Slide up to lock'}>
            <i className="fas fa-lock" aria-hidden="true" />
            <span style={{ display: locked ? 'none' : undefined }}>{t.msg_voice_lock_hint || 'Lock'}</span>
          </span>
          <span className={`kot3-voice-cancel-hint${cancelNear ? ' near' : ''}`} title={t.msg_voice_cancel_hint || 'Slide left to cancel'}>
            <i className="fas fa-undo" aria-hidden="true" />
            <span style={{ display: locked ? 'none' : undefined }}>{t.msg_voice_cancel_hint || 'Cancel'}</span>
          </span>

          {locked ? (
            <div className="kot3-voice-recorder-actions">
              <button type="button" className="kot3-voice-icon-btn danger" onClick={handleCancelButton} aria-label={t.msg_voice_delete || 'Delete recording'}>
                <i className="fas fa-trash" aria-hidden="true" />
              </button>
              <button type="button" className="kot3-voice-icon-btn success" onClick={handleSendButton} aria-label={t.common_send || 'Send recording'}>
                <i className="fas fa-paper-plane" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      )}
      {!recording && null}
      {/* On hold-to-record start, the host calls startRecording() externally
          via the imperative start signal below. */}
      <RecorderStarter onTrigger={startRecording} recording={recording} />
    </>
  );
}

// Imperative-style trigger: listens for a global 'kot3:voice:start' event
// so the parent composer can fire it from a press handler without
// prop-drilling through MessageList → Chat → Composer → Recorder.
function RecorderStarter({ onTrigger, recording }) {
  useEffect(() => {
    const h = () => { if (!recording) onTrigger(); };
    window.addEventListener('kot3:voice:start', h);
    return () => window.removeEventListener('kot3:voice:start', h);
  }, [onTrigger, recording]);
  return null;
}

export default VoiceRecorderOverlay;
