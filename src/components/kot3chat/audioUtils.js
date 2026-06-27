/**
 * src/components/kot3chat/audioUtils.js
 *
 * Short Web Audio API tones for chat events (send beep, receive beep, ringing,
 * call-connected chime). State (AudioContext, oscillators, gain node) lives
 * at module scope so callers in Kot3Chat do not have to manage refs.
 *
 * The tones are intentionally tiny and synthesized — we have a single audio
 * file dependency budget and the UX calls for instant feedback so we cannot
 * round-trip to a static asset.
 */

// Module-level audio state. Package-private; only the helper functions below
// touch these. They are reset by stopCallingSounds().
let callAudioCtx = null;
let callOscillators = [];
let callGainNode = null;
// Handle for the pending ramp-down setTimeout inside playRing(). Stored so
// stopCallingSounds() can cancel it — otherwise a quick start → stop → start
// cycle would leave the previous ring's ramp-down callback firing against
// the NEW gain node and producing audible glitches.
let callRampTimer = null;

// Brief, earpiece-friendly sweep on outgoing chat message (0.12s).
export const playSendBeep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {}
};

// Two-tone ascending beep on incoming chat message (0.15s + 0.20s with 75ms gap).
export const playReceiveBeep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(650, ctx.currentTime);
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.15);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(850, ctx.currentTime);
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.2);
    }, 75);
  } catch {}
};

// Dual 440Hz+480Hz carrier with 1.5s on / 3s off cadence. Idempotent:
// any previous tone is silently torn down before a new one starts so callers
// can safely re-invoke this on every state transition without leaking
// oscillators or accumulating cadence timers.
export const startCallingSounds = () => {
  // Defensive idempotency: stop any in-flight cadence first so calling this
  // twice in a row does not stack two oscillators and two ring intervals.
  stopCallingSounds();
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    callAudioCtx = ctx;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, ctx.currentTime);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(480, ctx.currentTime);

    gain.gain.setValueAtTime(0, ctx.currentTime);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();

    callOscillators = [osc1, osc2];
    callGainNode = gain;

    // Cadence: 1.5s on, 3s off. The ramp-down setTimeout writes to module-
    // scope callRampTimer so stopCallingSounds() can cancel it cleanly.
    const playRing = () => {
      if (!callGainNode || ctx.state === 'closed') return;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.1);
      if (callRampTimer !== null) clearTimeout(callRampTimer);
      callRampTimer = setTimeout(() => {
        callRampTimer = null;
        if (callGainNode) {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
        }
      }, 1500);
    };

    playRing();
    const ringInterval = setInterval(playRing, 4500);
    // Stash the interval handle in the same array so stopCallingSounds can
    // clear both oscillators AND the cadence timer in one loop.
    callOscillators.push({ interval: ringInterval });
  } catch (e) {
    console.warn('Failed to generate dialing tone', e);
  }
};

// Idempotent. Cancels the ramp-down timer, clears the cadence interval, stops
// oscillators, closes the context.
export const stopCallingSounds = () => {
  try {
    // Cancel any pending ramp-down so it can't fire against a re-acquired
    // gain node after a subsequent startCallingSounds() call.
    if (callRampTimer !== null) {
      clearTimeout(callRampTimer);
      callRampTimer = null;
    }
    callOscillators.forEach(item => {
      if (item?.interval) clearInterval(item.interval);
      else if (typeof item?.stop === 'function') item.stop();
    });
    callOscillators = [];
    callGainNode = null;
    if (callAudioCtx) {
      // close() returns a Promise — fire-and-forget is acceptable here since
      // the new AudioContext we'll create on the next start also engages the
      // audio device independently.
      const closing = callAudioCtx.close();
      if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      callAudioCtx = null;
    }
  } catch {}
};

// Rising tone confirming a call was accepted (0.20s).
export const playConnectedChime = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.setValueAtTime(800, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {}
};
