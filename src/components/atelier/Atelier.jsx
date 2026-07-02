/**
 * src/components/atelier/Atelier.jsx
 *
 * Inventor's Atelier — 4 novel Settings features that don't exist on any
 * other platform. Each feature demonstrates a concrete algorithm the user
 * can FEEL working (HSL math, force simulation, weighted sum, sigmoid,
 * date diff, keystroke standard-deviation, cubic-bezier interpolation).
 *
 * Opened from Settings via the bottom "🧪 Inventor's Atelier" button.
 * Visual: dark lab, monospace, neon pink/cyan, SVG wireframe borders.
 *
 * The 4 inventions + 1 bonus:
 *
 *  1. Aura Synthesizer (SHOWCASE) — 3 dials (Time, Energy, Temperature)
 *     compose into a 5-color HSL palette via weighted blend. The output
 *     hex is "Commit to Profile"-able so it overrides the global
 *     `--pink-primary` CSS variable.
 *
 *  2. Cognitive Pulse — Brain budget widget. Inputs: Sleep hours, Time
 *     of day, Caffeine intake. Math: Circadian Wave (cosine bi-modal) +
 *     Sleep Deprivation Penalty (sigmoid) + Caffeine Decay (exponential).
 *     Output: 0-100 capacity score with a live SVG wave graph.
 *
 *  3. Chrono-Capsule — Letter to your future self, locked until a
 *     reveal timestamp. Visualized as 3 concentric SVG rings using
 *     `stroke-dasharray`. Inner text is encrypted with random
 *     `String.fromCharCode(33+Math.random()*90)` until reveal.
 *
 *  4. Typographic DNA (Cadence Lock) — Type a phrase; the algorithm
 *     measures the standard deviation σ of your inter-keystroke timings
 *     and translates that into live UI asymmetry (border-radius, font
 *     weight, letter-spacing). Your "rhythm signature" is your DNA.
 *
 *  5. Digital Friction (BONUS) — Single 0-1 slider that modifies the
 *     global `--transition-speed` and `--ease-curve` so every modal,
 *     hover, and route transition slows down or snaps instantly.
 *
 * Persistence: every feature writes to `localStorage` so the experience
 * is sticky across reloads. No backend changes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

// ─── Atelier i18n (inline; kept here so the component is self-contained
//                    — also mirrored in src/data/translations.js so the
//                    Tabs/header copy stays consistent).
const ATELIER_I18N = {
  ht: {
    title: '🧪 Atelye Envantè',
    subtitle: 'Zouti ki pa egziste okenn lòt kote — algoritm ou ka santil li travay.',
    close: 'Fèmen',
    tab_aura: 'Aura',
    tab_pulse: 'Pòls Kognitif',
    tab_capsule: 'Kapsil Tan',
    tab_dna: 'ADN Tipografik',
    tab_friction: 'Friksyon',
    /* Aura */
    aura_title: 'Sentèzè Aura',
    aura_desc: 'Konpoze yon palèt 5-koulè inik ou. Deziyen tan, enèji, tanperati — wè matematik la vivan.',
    aura_time: 'Lè nan jounen an',
    aura_energy: 'Nivo enèji',
    aura_temp: 'Tanperati',
    aura_palette: 'Palèt ou',
    aura_commit: 'Konsakre sou profil',
    aura_reset: 'Retounen nan pink DevRose',
    aura_hex: 'Egzagonal:',
    /* Pulse */
    pulse_title: 'Pòls Kognitif',
    pulse_desc: 'Konbyen enèji mantal ou genyen kounye a? Algoritm nan melanje ri circadyen + dòmi + kafein.',
    pulse_sleep: 'Lè dòmi dènye nuit',
    pulse_when: 'Lè kounye a',
    pulse_caffeine: 'Kafein nan sistèm',
    pulse_score: 'Kapasite mantal',
    pulse_recommend: 'Rekòmandasyon',
    pulse_recommend_high: 'Ou nan zòn flow. Kenbe travay la.',
    pulse_recommend_mid: 'Bon rit. Pran yon ti poz nan 30 min.',
    pulse_recommend_low: 'Èske w pran yon ti repo? 15 min ka ede w anpil.',
    /* Capsule */
    capsule_title: 'Kapsil Tan',
    capsule_desc: 'Ekri yon mesaj pou lavni w. Li ap rete fèmen jiskaske dat ou chwazi a.',
    capsule_compose: 'Konpoze mesaj ou',
    capsule_reveal: 'Dat revelasyon',
    capsule_save: 'Sove kapsil',
    capsule_sealed: 'Fèmen',
    capsule_count: '{n} kapsil',
    capsule_revealed: 'Revele!',
    capsule_reveal_now: 'Revele kounye a',
    capsule_delete: 'Efase',
    capsule_no_capsules: 'Ou poko gen kapsil. Ekri youn!',
    /* DNA */
    dna_title: 'ADN Tipografik',
    dna_desc: 'Tape yon fraz. Algoritm nan mezire rit sou li (σ/μ) epi aplike l nan UI ou an tan reyèl.',
    dna_placeholder: 'Tape yon fraz ou renmen...',
    dna_rhythm: 'Ritm:',
    dna_signature: 'Siyati ou:',
    dna_chaotic: 'Chaotik',
    dna_moderate: 'Modere',
    dna_metronomic: 'Metronomik',
    /* Friction */
    friction_title: 'Friksyon Dijital',
    friction_desc: 'Chanje inès tout animasyon nan UI. 0 = vit, 1 = dousè.',
    friction_label: 'Friksyon',
    friction_instant: 'Enstantane',
    friction_honey: 'Siwo',
  },
  en: {
    title: '🧪 Inventor\'s Atelier',
    subtitle: 'Tools that exist nowhere else — algorithms you can feel working.',
    close: 'Close',
    tab_aura: 'Aura',
    tab_pulse: 'Cognitive Pulse',
    tab_capsule: 'Time Capsule',
    tab_dna: 'Typographic DNA',
    tab_friction: 'Friction',
    /* Aura */
    aura_title: 'Aura Synthesizer',
    aura_desc: 'Compose a unique 5-color palette. Tune time, energy, temperature — feel the math live.',
    aura_time: 'Time of day',
    aura_energy: 'Energy level',
    aura_temp: 'Temperature',
    aura_palette: 'Your palette',
    aura_commit: 'Commit to profile',
    aura_reset: 'Reset to DevRose pink',
    aura_hex: 'Hex:',
    /* Pulse */
    pulse_title: 'Cognitive Pulse',
    pulse_desc: 'How much mental energy do you have right now? The algorithm blends circadian rhythm + sleep + caffeine.',
    pulse_sleep: 'Last night sleep (hours)',
    pulse_when: 'Time of day',
    pulse_caffeine: 'Caffeine in system',
    pulse_score: 'Mental capacity',
    pulse_recommend: 'Recommendation',
    pulse_recommend_high: "You're in the flow zone. Keep going.",
    pulse_recommend_mid: 'Good rhythm. Take a micro break in 30 min.',
    pulse_recommend_low: 'Could you take a break? 15 min will help a lot.',
    /* Capsule */
    capsule_title: 'Time Capsule',
    capsule_desc: 'Write a message to your future self. It stays locked until the date you choose.',
    capsule_compose: 'Compose your message',
    capsule_reveal: 'Reveal date',
    capsule_save: 'Save capsule',
    capsule_sealed: 'Sealed',
    capsule_count: '{n} capsules',
    capsule_revealed: 'Revealed!',
    capsule_reveal_now: 'Reveal now',
    capsule_delete: 'Delete',
    capsule_no_capsules: 'No capsules yet. Write one!',
    /* DNA */
    dna_title: 'Typographic DNA',
    dna_desc: 'Type a phrase. The algorithm measures your typing rhythm (σ/μ) and applies it to the UI in real time.',
    dna_placeholder: 'Type a phrase you love...',
    dna_rhythm: 'Rhythm:',
    dna_signature: 'Your signature:',
    dna_chaotic: 'Chaotic',
    dna_moderate: 'Moderate',
    dna_metronomic: 'Metronomic',
    /* Friction */
    friction_title: 'Digital Friction',
    friction_desc: 'Change the inertia of every animation in the UI. 0 = instant, 1 = honey.',
    friction_label: 'Friction',
    friction_instant: 'Instant',
    friction_honey: 'Honey',
  },
  es: {
    title: '🧪 Atelier del Inventor',
    subtitle: 'Herramientas que no existen en ningún otro lugar: algoritmos que puedes sentir funcionando.',
    close: 'Cerrar',
    tab_aura: 'Aura',
    tab_pulse: 'Pulso Cognitivo',
    tab_capsule: 'Cápsula del Tiempo',
    tab_dna: 'ADN Tipográfico',
    tab_friction: 'Fricción',
    /* Aura */
    aura_title: 'Sintetizador de Aura',
    aura_desc: 'Compón una paleta única de 5 colores. Ajusta tiempo, energía, temperatura — siente las matemáticas en vivo.',
    aura_time: 'Hora del día',
    aura_energy: 'Nivel de energía',
    aura_temp: 'Temperatura',
    aura_palette: 'Tu paleta',
    aura_commit: 'Aplicar al perfil',
    aura_reset: 'Restablecer rosa DevRose',
    aura_hex: 'Hex:',
    /* Pulse */
    pulse_title: 'Pulso Cognitivo',
    pulse_desc: '¿Cuánta energía mental tienes ahora? El algoritmo mezcla ritmo circadiano + sueño + cafeína.',
    pulse_sleep: 'Horas de sueño anoche',
    pulse_when: 'Hora del día',
    pulse_caffeine: 'Cafeína en el sistema',
    pulse_score: 'Capacidad mental',
    pulse_recommend: 'Recomendación',
    pulse_recommend_high: 'Estás en zona de flow. Sigue así.',
    pulse_recommend_mid: 'Buen ritmo. Toma un micro-descanso en 30 min.',
    pulse_recommend_low: '¿Podrías descansar? 15 min te ayudarían mucho.',
    /* Capsule */
    capsule_title: 'Cápsula del Tiempo',
    capsule_desc: 'Escribe un mensaje a tu yo futuro. Permanece cerrado hasta la fecha que elijas.',
    capsule_compose: 'Compón tu mensaje',
    capsule_reveal: 'Fecha de revelado',
    capsule_save: 'Guardar cápsula',
    capsule_sealed: 'Sellada',
    capsule_count: '{n} cápsulas',
    capsule_revealed: '¡Revelada!',
    capsule_reveal_now: 'Revelar ahora',
    capsule_delete: 'Eliminar',
    capsule_no_capsules: 'Sin cápsulas aún. ¡Escribe una!',
    /* DNA */
    dna_title: 'ADN Tipográfico',
    dna_desc: 'Escribe una frase. El algoritmo mide tu ritmo de escritura (σ/μ) y lo aplica a la UI en tiempo real.',
    dna_placeholder: 'Escribe una frase que ames...',
    dna_rhythm: 'Ritmo:',
    dna_signature: 'Tu firma:',
    dna_chaotic: 'Caótico',
    dna_moderate: 'Moderado',
    dna_metronomic: 'Metronómico',
    /* Friction */
    friction_title: 'Fricción Digital',
    friction_desc: 'Cambia la inercia de cada animación en la UI. 0 = instantáneo, 1 = miel.',
    friction_label: 'Fricción',
    friction_instant: 'Instantáneo',
    friction_honey: 'Miel',
  },
  fr: {
    title: '🧪 Atelier de l\'Inventeur',
    subtitle: 'Des outils qui n\'existent nulle part ailleurs — des algorithmes que vous pouvez sentir fonctionner.',
    close: 'Fermer',
    tab_aura: 'Aura',
    tab_pulse: 'Pouls Cognitif',
    tab_capsule: 'Capsule Temporelle',
    tab_dna: 'ADN Typographique',
    tab_friction: 'Friction',
    /* Aura */
    aura_title: 'Synthétiseur d\'Aura',
    aura_desc: 'Composez une palette unique de 5 couleurs. Réglez l\'heure, l\'énergie, la température — ressentez les maths en direct.',
    aura_time: 'Heure du jour',
    aura_energy: 'Niveau d\'énergie',
    aura_temp: 'Température',
    aura_palette: 'Votre palette',
    aura_commit: 'Appliquer au profil',
    aura_reset: 'Réinitialiser le rose DevRose',
    aura_hex: 'Hex :',
    /* Pulse */
    pulse_title: 'Pouls Cognitif',
    pulse_desc: 'Combien d\'énergie mentale avez-vous maintenant ? L\'algorithme mélange rythme circadien + sommeil + caféine.',
    pulse_sleep: 'Heures de sommeil la nuit dernière',
    pulse_when: 'Heure du jour',
    pulse_caffeine: 'Caféine dans le système',
    pulse_score: 'Capacité mentale',
    pulse_recommend: 'Recommandation',
    pulse_recommend_high: 'Vous êtes en zone de flow. Continuez.',
    pulse_recommend_mid: 'Bon rythme. Prenez une micro-pause dans 30 min.',
    pulse_recommend_low: 'Pourriez-vous faire une pause ? 15 min aideraient beaucoup.',
    /* Capsule */
    capsule_title: 'Capsule Temporelle',
    capsule_desc: 'Écrivez un message à votre vous futur. Il reste verrouillé jusqu\'à la date que vous choisissez.',
    capsule_compose: 'Composez votre message',
    capsule_reveal: 'Date de révélation',
    capsule_save: 'Enregistrer la capsule',
    capsule_sealed: 'Scellée',
    capsule_count: '{n} capsules',
    capsule_revealed: 'Révélée !',
    capsule_reveal_now: 'Révéler maintenant',
    capsule_delete: 'Supprimer',
    capsule_no_capsules: 'Aucune capsule pour l\'instant. Écrivez-en une !',
    /* DNA */
    dna_title: 'ADN Typographique',
    dna_desc: 'Tapez une phrase. L\'algorithme mesure votre rythme de frappe (σ/μ) et l\'applique à l\'UI en temps réel.',
    dna_placeholder: 'Tapez une phrase que vous aimez...',
    dna_rhythm: 'Rythme :',
    dna_signature: 'Votre signature :',
    dna_chaotic: 'Chaotique',
    dna_moderate: 'Modéré',
    dna_metronomic: 'Métronomique',
    /* Friction */
    friction_title: 'Friction Numérique',
    friction_desc: 'Changez l\'inertie de chaque animation de l\'UI. 0 = instantané, 1 = miel.',
    friction_label: 'Friction',
    friction_instant: 'Instantané',
    friction_honey: 'Miel',
  },
};

// ─────────────────────────────────────────────────────────────────────
//  1. AURA SYNTHESIZER (showcase)
//  Math:
//   Hue = (T/24 × 360 + E × 0.5 + C × 1.5) mod 360
//   Saturation = 40 + (E × 0.6)
//   Lightness = 30 + 40 × sin(π × T / 24)   (peaks at noon)
//   5-color palette = master HSL + 4 neighbours walking hue ±30°
// ─────────────────────────────────────────────────────────────────────
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function AuraSynthesizer({ t, lang, onCommit, showToast }) {
  const [time, setTime] = useState(() => new Date().getHours() + new Date().getMinutes() / 60);
  const [energy, setEnergy] = useState(60);
  const [temp, setTemp] = useState(50);

  // Pure-function synthesis — the user can FEEL the math by dragging.
  const palette = useMemo(() => {
    const T = time;
    const E = energy;
    const C = temp;
    const H = ((T / 24) * 360 + E * 0.5 + C * 1.5) % 360;
    const S = 40 + (E * 0.6);
    const L = 30 + 40 * Math.sin((Math.PI * T) / 24);
    // 5-color palette walks the hue circle in 30° steps.
    const colors = [];
    for (let i = 0; i < 5; i++) {
      const h = (H + (i - 2) * 30 + 360) % 360;
      colors.push({ hex: hslToHex(h, S, L), hsl: { h, s: S, l: L } });
    }
    return { colors, master: { h: H, s: S, l: L } };
  }, [time, energy, temp]);

  const handleCommit = () => {
    const cssVar = palette.colors[2].hex.toLowerCase();
    document.documentElement.style.setProperty('--pink-primary', cssVar);
    // Derive a soft tint for the cards.
    const { h, s, l } = palette.master;
    document.documentElement.style.setProperty('--pink-light', `hsl(${h}, ${s * 0.4}%, ${Math.min(95, l + 30)}%)`);
    try { localStorage.setItem('devrose_theme_color', cssVar); } catch (_) {}
    try { localStorage.setItem('devrose_aura_signature', JSON.stringify(palette.master)); } catch (_) {}
    onCommit?.(cssVar);
    showToast?.(lang === 'ht' ? `Aura ou konsakre: ${cssVar}` : `Aura committed: ${cssVar}`, 'palette');
  };

  const handleReset = () => {
    document.documentElement.style.setProperty('--pink-primary', '#d81b60');
    document.documentElement.style.setProperty('--pink-light', 'rgba(216, 27, 96, 0.1)');
    try {
      localStorage.removeItem('devrose_theme_color');
      localStorage.removeItem('devrose_aura_signature');
    } catch (_) {}
    showToast?.(lang === 'ht' ? 'Pink DevRose retounen' : 'DevRose pink restored', 'rotate-left');
  };

  return (
    <div className="atelier-pane atelier-aura">
      <header className="atelier-pane-head">
        <h3>{t.aura_title}</h3>
        <p>{t.aura_desc}</p>
      </header>

      <div className="atelier-aura-grid">
        <div className="atelier-aura-dials">
          <Dial
            label={t.aura_time}
            value={time}
            min={0} max={24} step={0.25}
            onChange={setTime}
            format={v => `${Math.floor(v).toString().padStart(2, '0')}:${Math.floor((v % 1) * 60).toString().padStart(2, '0')}`}
            icon="fa-clock"
            unit="h"
          />
          <Dial
            label={t.aura_energy}
            value={energy}
            min={0} max={100} step={1}
            onChange={setEnergy}
            format={v => `${Math.round(v)}`}
            icon="fa-bolt"
            unit="%"
          />
          <Dial
            label={t.aura_temp}
            value={temp}
            min={0} max={100} step={1}
            onChange={setTemp}
            format={v => v < 33 ? '❄️' : v < 67 ? '🌿' : '🔥'}
            icon="fa-temperature-half"
            unit="°"
          />
        </div>

        <div className="atelier-aura-preview">
          <div
            className="atelier-aura-sphere"
            style={{
              background: `radial-gradient(circle at 30% 30%,
                hsl(${palette.master.h}, ${palette.master.s}%, ${Math.min(85, palette.master.l + 25)}%),
                hsl(${palette.master.h}, ${palette.master.s}%, ${palette.master.l}%),
                hsl(${palette.master.h}, ${palette.master.s * 0.7}%, ${Math.max(15, palette.master.l - 25)}%))`,
              boxShadow: `0 0 60px hsla(${palette.master.h}, ${palette.master.s}%, ${palette.master.l}%, 0.5),
                          inset 0 0 30px hsla(${palette.master.h}, ${palette.master.s}%, ${palette.master.l}%, 0.4)`,
            }}
          />
          <div className="atelier-aura-palette">
            <span className="atelier-aura-palette-label">{t.aura_palette}</span>
            <div className="atelier-aura-palette-row">
              {palette.colors.map((c, i) => (
                <div
                  key={i}
                  className="atelier-aura-swatch"
                  style={{ background: c.hex }}
                  title={c.hex}
                >
                  <span className="atelier-aura-swatch-hex">{c.hex}</span>
                </div>
              ))}
            </div>
            <div className="atelier-aura-readout">
              <span className="atelier-readout-label">H</span><span className="atelier-readout-val">{Math.round(palette.master.h)}°</span>
              <span className="atelier-readout-label">S</span><span className="atelier-readout-val">{Math.round(palette.master.s)}%</span>
              <span className="atelier-readout-label">L</span><span className="atelier-readout-val">{Math.round(palette.master.l)}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="atelier-aura-actions">
        <button type="button" className="atelier-btn atelier-btn-primary" onClick={handleCommit}>
          <i className="fas fa-vial-circle-check" /> {t.aura_commit}
        </button>
        <button type="button" className="atelier-btn atelier-btn-ghost" onClick={handleReset}>
          <i className="fas fa-rotate-left" /> {t.aura_reset}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Reusable Dial — vertical draggable knob with live numeric readout
// ─────────────────────────────────────────────────────────────────────
function Dial({ label, value, min, max, step, onChange, format, icon, unit }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="atelier-dial">
      <div className="atelier-dial-label">
        <i className={`fas ${icon}`} /> {label}
      </div>
      <div
        className="atelier-dial-knob"
        style={{
          background: `conic-gradient(from -90deg,
            var(--atelier-neon) 0%,
            var(--atelier-neon) ${pct}%,
            rgba(255,255,255,0.06) ${pct}%,
            rgba(255,255,255,0.06) 100%)`,
        }}
      >
        <div className="atelier-dial-knob-inner">
          <span className="atelier-dial-value">{format(value)}{unit !== '°' ? unit : ''}</span>
        </div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="atelier-dial-slider"
        aria-label={label}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  2. COGNITIVE PULSE
//  Math:
//   Circadian Wave    W = 0.5 + 0.5 × cos(π × (T - 14) / 12)   // peaks 10am, 4pm
//   Sleep Penalty     P = 1 / (1 + e^(2 × (S - 6)))            // >6h = OK, <6h = penalty
//   Caffeine Decay    B = C × 0.3 × e^(-0.15 × max(0, T - 8))  // strongest 8am, gone by 8pm
//   Pulse             Pulse = clamp(0, 100, 100 × (W - P + B))
// ─────────────────────────────────────────────────────────────────────
function CognitivePulse({ t, lang }) {
  const [sleep, setSleep] = useState(() => {
    const stored = parseFloat(localStorage.getItem('devrose_pulse_sleep') || '7');
    return Math.max(0, Math.min(12, isNaN(stored) ? 7 : stored));
  });
  const [time, setTime] = useState(() => new Date().getHours() + new Date().getMinutes() / 60);
  const [caffeine, setCaffeine] = useState(() => {
    const stored = parseFloat(localStorage.getItem('devrose_pulse_caffeine') || '0');
    return Math.max(0, Math.min(1, isNaN(stored) ? 0 : stored));
  });

  useEffect(() => { try { localStorage.setItem('devrose_pulse_sleep', String(sleep)); } catch (_) {} }, [sleep]);
  useEffect(() => { try { localStorage.setItem('devrose_pulse_caffeine', String(caffeine)); } catch (_) {} }, [caffeine]);

  const calc = useMemo(() => {
    const T = time;
    const S = sleep;
    const C = caffeine;
    // Bi-modal Circadian Wave: average two cosine peaks — one at 10am,
    // one at 4pm — each with a 8h half-window. At T=10 → morning
    // peak; at T=16 → afternoon peak; dip between 1pm-2pm.
    // Clamped to [0, 1] via the averaging so we never go negative.
    const morning = 0.5 + 0.5 * Math.cos((Math.PI * (T - 10)) / 8);
    const afternoon = 0.5 + 0.5 * Math.cos((Math.PI * (T - 16)) / 8);
    const W = Math.max(0, (morning + afternoon) / 2);
    const P = 1 / (1 + Math.exp(2 * (S - 6)));
    const B = C * 0.3 * Math.exp(-0.15 * Math.max(0, T - 8));
    const raw = W - P + B;
    const pulse = Math.max(0, Math.min(100, 100 * raw));
    return { W, P, B, pulse, raw };
  }, [time, sleep, caffeine]);

  const recommendation = calc.pulse >= 70
    ? t.pulse_recommend_high
    : calc.pulse >= 40
      ? t.pulse_recommend_mid
      : t.pulse_recommend_low;

  // Color: green > 70, yellow 40-70, red < 40
  const color = calc.pulse >= 70 ? '#22c55e' : calc.pulse >= 40 ? '#fbbf24' : '#ef4444';

  // Build a smooth wave path that visualizes the circadian + penalty + boost curve over 24h.
  const buildWave = () => {
    const w = 300; const h = 80; const pad = 6;
    const pts = [];
    for (let h24 = 0; h24 <= 24; h24 += 0.5) {
      // Same bi-modal formula as calc.W
      const morning = 0.5 + 0.5 * Math.cos((Math.PI * (h24 - 10)) / 8);
      const afternoon = 0.5 + 0.5 * Math.cos((Math.PI * (h24 - 16)) / 8);
      const W = Math.max(0, (morning + afternoon) / 2);
      const P = 1 / (1 + Math.exp(2 * (sleep - 6)));
      const B = caffeine * 0.3 * Math.exp(-0.15 * Math.max(0, h24 - 8));
      const raw = Math.max(0, Math.min(1, W - P + B));
      const x = (h24 / 24) * (w - 2 * pad) + pad;
      const y = h - pad - raw * (h - 2 * pad);
      pts.push([x, y]);
    }
    return 'M' + pts.map(p => p.join(',')).join(' L');
  };
  const wavePath = buildWave();
  // Time-of-day cursor on the wave.
  const cursorX = (time / 24) * (300 - 12) + 6;
  const cursorY = 80 - 6 - (calc.raw * (80 - 12));

  return (
    <div className="atelier-pane atelier-pulse">
      <header className="atelier-pane-head">
        <h3>{t.pulse_title}</h3>
        <p>{t.pulse_desc}</p>
      </header>

      <div className="atelier-pulse-grid">
        <div className="atelier-pulse-controls">
          <Slider label={t.pulse_sleep} value={sleep} min={0} max={12} step={0.5} onChange={setSleep} icon="fa-bed" unit="h" />
          <Slider label={t.pulse_when} value={time} min={0} max={24} step={0.25} onChange={setTime} icon="fa-clock" unit="" format={v => `${Math.floor(v).toString().padStart(2, '0')}:${Math.floor((v % 1) * 60).toString().padStart(2, '0')}`} />
          <Slider label={t.pulse_caffeine} value={caffeine} min={0} max={1} step={0.05} onChange={setCaffeine} icon="fa-mug-hot" unit="" format={v => `${Math.round(v * 100)}%`} />
        </div>

        <div className="atelier-pulse-readout">
          <div className="atelier-pulse-score" style={{ color }}>
            <span className="atelier-pulse-score-num">{Math.round(calc.pulse)}</span>
            <span className="atelier-pulse-score-unit">/100</span>
          </div>
          <div className="atelier-pulse-score-label">{t.pulse_score}</div>
          <svg className="atelier-pulse-wave" viewBox="0 0 300 80" preserveAspectRatio="none">
            <defs>
              <linearGradient id="pulse-grad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${wavePath} L 300,80 L 0,80 Z`} fill="url(#pulse-grad)" />
            <path d={wavePath} fill="none" stroke={color} strokeWidth="2" />
            <line x1={cursorX} x2={cursorX} y1="0" y2="80" stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={cursorX} cy={cursorY} r="5" fill={color} />
          </svg>
          <div className="atelier-pulse-formula">
            <span>Pulse = 100 × (W − P + B)</span>
            <span className="atelier-pulse-formula-vals">W={calc.W.toFixed(2)} · P={calc.P.toFixed(2)} · B={calc.B.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="atelier-pulse-recommend" style={{ borderLeftColor: color }}>
        <i className="fas fa-lightbulb" style={{ color }} />
        <div>
          <strong>{t.pulse_recommend}</strong>
          <span>{recommendation}</span>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, icon, unit, format }) {
  return (
    <div className="atelier-slider-row">
      <div className="atelier-slider-label">
        <i className={`fas ${icon}`} /> {label}
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="atelier-slider"
        aria-label={label}
      />
      <div className="atelier-slider-value">
        {format ? format(value) : `${value}${unit}`}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  3. CHRONO-CAPSULE (Time Capsule with 3 concentric SVG rings)
//  Math:
//   Progress F = (Now − Start) / (End − Start), clamped 0..1
//   Ring 1 (Days):     F
//   Ring 2 (Hours):    (Now / 3600000) mod 24 / 24
//   Ring 3 (Vibration): Math.random() based on Now mod 1000
//   Encryption: when F < 1, each character is replaced with a random
//   printable ASCII glyph (String.fromCharCode(33 + Math.random()*90))
//   so the locked message literally looks scrambled.
// ─────────────────────────────────────────────────────────────────────
function ChronoCapsule({ t, lang, showToast }) {
  const STORAGE_KEY = 'devrose_capsules';
  const [capsules, setCapsules] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) { return []; }
  });
  const [text, setText] = useState('');
  const [revealAt, setRevealAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });

  const saveCapsules = (next) => {
    setCapsules(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
  };

  const handleSave = () => {
    if (!text.trim()) {
      showToast?.(lang === 'ht' ? 'Ekri yon mesaje anvan.' : 'Write a message first.', 'exclamation-triangle');
      return;
    }
    const revealDate = new Date(revealAt + 'T00:00:00');
    if (revealDate <= new Date()) {
      showToast?.(lang === 'ht' ? 'Dat dwe nan lavni.' : 'Date must be in the future.', 'exclamation-triangle');
      return;
    }
    const capsule = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      text: text.trim(),
      createdAt: Date.now(),
      revealAt: revealDate.getTime(),
      revealed: false,
    };
    saveCapsules([capsule, ...capsules]);
    setText('');
    showToast?.(lang === 'ht' ? 'Kapsil fèmen. Li ap louvri nan dat ou chwazi a.' : 'Capsule sealed. It opens on the date you chose.', 'lock');
  };

  const handleReveal = (id) => {
    saveCapsules(capsules.map(c => c.id === id ? { ...c, revealed: true } : c));
  };

  const handleDelete = (id) => {
    saveCapsules(capsules.filter(c => c.id !== id));
  };

  // Auto-reveal any capsule whose date has passed. Re-checks every 60s
  // so a capsule that expires WHILE the Atelier is open still pops a
  // toast without requiring a page reload.
  useEffect(() => {
    const checkAndReveal = () => {
      const now = Date.now();
      const due = capsules.filter(c => !c.revealed && c.revealAt <= now);
      if (due.length) {
        saveCapsules(capsules.map(c => c.revealAt <= now ? { ...c, revealed: true } : c));
        due.forEach(() => {
          showToast?.(lang === 'ht' ? '🔓 Yon kapsil ou louvri!' : '🔓 A capsule just opened!', 'envelope-open');
        });
      }
    };
    checkAndReveal();
    const id = setInterval(checkAndReveal, 60_000);
    return () => clearInterval(id);
  }, [capsules, lang, showToast]);

  return (
    <div className="atelier-pane atelier-capsule">
      <header className="atelier-pane-head">
        <h3>{t.capsule_title}</h3>
        <p>{t.capsule_desc}</p>
      </header>

      <div className="atelier-capsule-composer">
        <label className="atelier-capsule-label">
          {t.capsule_compose}
          <textarea
            className="atelier-capsule-textarea"
            value={text}
            onChange={e => setText(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
            placeholder={lang === 'ht' ? 'Bonjou lavni mwen...' : 'Hello future me...'}
          />
        </label>
        <label className="atelier-capsule-label">
          {t.capsule_reveal}
          <input
            type="date"
            value={revealAt}
            min={new Date().toISOString().split('T')[0]}
            onChange={e => setRevealAt(e.target.value)}
            className="atelier-capsule-date"
          />
        </label>
        <button type="button" className="atelier-btn atelier-btn-primary" onClick={handleSave}>
          <i className="fas fa-lock" /> {t.capsule_save}
        </button>
      </div>

      <div className="atelier-capsule-list">
        {capsules.length === 0 && (
          <div className="atelier-capsule-empty">
            <i className="fas fa-hourglass-half" />
            <span>{t.capsule_no_capsules}</span>
          </div>
        )}
        {capsules.map(c => <CapsuleCard key={c.id} capsule={c} t={t} lang={lang} onReveal={handleReveal} onDelete={handleDelete} />)}
      </div>
    </div>
  );
}

function CapsuleCard({ capsule, t, lang, onReveal, onDelete }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (capsule.revealed) return;
    const id = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [capsule.revealed]);

  const now = Date.now();
  const total = capsule.revealAt - capsule.createdAt;
  const elapsed = Math.max(0, now - capsule.createdAt);
  const F = Math.max(0, Math.min(1, elapsed / total));
  const C = 2 * Math.PI * 50; // circumference for r=50
  const dash = F * C;
  const secondsJitter = capsule.revealed ? 0 : ((Date.now() % 1000) / 1000) * 6;

  // Encrypted view: each character replaced with random printable ASCII.
  const scramble = (s) => Array.from(s).map(() => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join('');

  const daysLeft = Math.max(0, Math.ceil((capsule.revealAt - now) / 86400000));
  const hoursLeft = Math.max(0, Math.ceil(((capsule.revealAt - now) % 86400000) / 3600000));

  return (
    <div className={`atelier-capsule-card ${capsule.revealed ? 'is-revealed' : 'is-sealed'}`}>
      <svg className="atelier-capsule-rings" viewBox="0 0 120 120">
        {/* Outer ring — days progress */}
        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          cx="60" cy="60" r="50" fill="none"
          stroke={capsule.revealed ? '#22c55e' : 'var(--atelier-neon)'}
          strokeWidth="6"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        {/* Mid ring — hours modulo 24 */}
        <circle cx="60" cy="60" r="38" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle
          cx="60" cy="60" r="38" fill="none"
          stroke={capsule.revealed ? '#22c55e' : 'var(--atelier-cyan)'}
          strokeWidth="4"
          strokeDasharray={`${((now / 3600000) % 24 / 24) * 2 * Math.PI * 38} ${2 * Math.PI * 38}`}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        />
        {/* Inner ring — seconds jitter (vibrates) */}
        <circle cx="60" cy="60" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle
          cx="60" cy="60" r="26" fill="none"
          stroke={capsule.revealed ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.3)'}
          strokeWidth="3"
          strokeDasharray={`${secondsJitter} ${2 * Math.PI * 26}`}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="56" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="monospace">
          {capsule.revealed ? 'OPEN' : '🔒'}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="8" fontFamily="monospace">
          {capsule.revealed ? '✓' : `${daysLeft}d ${hoursLeft}h`}
        </text>
      </svg>

      <div className="atelier-capsule-content">
        <div className="atelier-capsule-text">
          {capsule.revealed ? capsule.text : scramble(capsule.text)}
        </div>
        <div className="atelier-capsule-meta">
          <span><i className="fas fa-calendar-plus" /> {new Date(capsule.createdAt).toLocaleDateString()}</span>
          <span><i className="fas fa-unlock" /> {new Date(capsule.revealAt).toLocaleDateString()}</span>
        </div>
        <div className="atelier-capsule-actions">
          {!capsule.revealed && (
            <button type="button" className="atelier-btn atelier-btn-ghost" onClick={() => onReveal(capsule.id)}>
              <i className="fas fa-key" /> {t.capsule_reveal_now}
            </button>
          )}
          <button type="button" className="atelier-btn atelier-btn-danger" onClick={() => onDelete(capsule.id)}>
            <i className="fas fa-trash" /> {t.capsule_delete}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  4. TYPOGRAPHIC DNA (Cadence Lock)
//  Math:
//   Inter-keystroke Δtᵢ = Tᵢ₊₁ − Tᵢ
//   μ = mean(Δt), σ = std(Δt)
//   Rhythm score R = min(1, σ / μ)
//   R ≈ 0 → metronomic; R ≈ 1 → chaotic
//   UI asymmetry mapping:
//     border-radius: 40 - R*30, 10 + R*40, 40 - R*30, 10 + R*40
//     font-weight: 400 + R*400
//     letter-spacing: -0.5 + R*4 (px)
// ─────────────────────────────────────────────────────────────────────
function TypographicDNA({ t, lang }) {
  const [phrase, setPhrase] = useState('');
  const [keystrokes, setKeystrokes] = useState([]);
  const lastTimeRef = useRef(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('devrose_typedna_phrase');
      if (stored) setPhrase(stored);
    } catch (_) {}
  }, []);

  const handleChange = (e) => {
    const newVal = e.target.value;
    const now = performance.now();
    if (lastTimeRef.current !== null) {
      const dt = now - lastTimeRef.current;
      // Only count dt < 2s to filter pauses between thoughts.
      if (dt < 2000) {
        setKeystrokes(prev => [...prev, dt].slice(-200));
      }
    }
    lastTimeRef.current = now;
    setPhrase(newVal);
    try { localStorage.setItem('devrose_typedna_phrase', newVal); } catch (_) {}
  };

  const stats = useMemo(() => {
    if (keystrokes.length < 3) return null;
    const mu = keystrokes.reduce((a, b) => a + b, 0) / keystrokes.length;
    const variance = keystrokes.reduce((s, x) => s + (x - mu) ** 2, 0) / keystrokes.length;
    const sigma = Math.sqrt(variance);
    const R = Math.min(1, sigma / Math.max(mu, 1));
    return { mu, sigma, R, samples: keystrokes.length };
  }, [keystrokes]);

  // Live UI asymmetry from R.
  const r = stats ? stats.R : 0;
  const radius = `${40 - r * 30}px ${10 + r * 40}px ${40 - r * 30}px ${10 + r * 40}px`;
  const weight = 400 + Math.round(r * 400);
  const spacing = -0.5 + r * 4;

  const rhythmLabel = !stats ? '—' : r > 0.66 ? t.dna_chaotic : r > 0.33 ? t.dna_moderate : t.dna_metronomic;

  return (
    <div className="atelier-pane atelier-dna">
      <header className="atelier-pane-head">
        <h3>{t.dna_title}</h3>
        <p>{t.dna_desc}</p>
      </header>

      <div className="atelier-dna-stage">
        <textarea
          className="atelier-dna-textarea"
          value={phrase}
          onChange={handleChange}
          placeholder={t.dna_placeholder}
          rows={3}
          style={{ borderRadius: radius, fontWeight: weight, letterSpacing: `${spacing}px` }}
        />
        <div className="atelier-dna-hint">
          <i className="fas fa-fingerprint" /> {t.dna_rhythm} <strong>{rhythmLabel}</strong>
        </div>
      </div>

      <div className="atelier-dna-readout">
        <div className="atelier-dna-meter">
          <svg viewBox="0 0 200 60" className="atelier-dna-meter-svg">
            <defs>
              <linearGradient id="dna-grad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="50%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            <rect x="10" y="20" width="180" height="20" rx="10" fill="rgba(255,255,255,0.06)" />
            <rect x="10" y="20" width={180 * r} height="20" rx="10" fill="url(#dna-grad)" />
            <line x1={10 + 180 * 0.33} x2={10 + 180 * 0.33} y1="14" y2="46" stroke="rgba(255,255,255,0.3)" strokeDasharray="2 2" />
            <line x1={10 + 180 * 0.66} x2={10 + 180 * 0.66} y1="14" y2="46" stroke="rgba(255,255,255,0.3)" strokeDasharray="2 2" />
          </svg>
          <div className="atelier-dna-meter-labels">
            <span>{t.dna_metronomic}</span>
            <span>{t.dna_moderate}</span>
            <span>{t.dna_chaotic}</span>
          </div>
        </div>
        {stats && (
          <div className="atelier-dna-formula">
            <span>R = σ / μ = {stats.sigma.toFixed(0)}ms / {stats.mu.toFixed(0)}ms = <strong>{r.toFixed(3)}</strong></span>
            <span className="atelier-dna-samples">{stats.samples} {lang === 'ht' ? 'echantiyon' : 'samples'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  5. DIGITAL FRICTION (BONUS)
//  Maps 0..1 to CSS --transition-speed (50ms..1200ms) and
//  --ease-curve: cubic-bezier(0.5, f*2, 0.5, 1) where f is the
//  friction value. Modifies :root so every animation in the app
//  inherits the new inertia.
// ─────────────────────────────────────────────────────────────────────
function DigitalFriction({ t, lang, showToast }) {
  const [friction, setFriction] = useState(() => {
    const v = parseFloat(localStorage.getItem('devrose_friction') || '0');
    return Math.max(0, Math.min(1, isNaN(v) ? 0 : v));
  });

  useEffect(() => {
    try { localStorage.setItem('devrose_friction', String(friction)); } catch (_) {}
    const speed = Math.round(50 + friction * 1150); // 50ms → 1200ms
    const c1y = (friction * 2).toFixed(2);
    document.documentElement.style.setProperty('--atelier-friction-speed', `${speed}ms`);
    document.documentElement.style.setProperty('--atelier-friction-curve', `cubic-bezier(0.5, ${c1y}, 0.5, 1)`);
  }, [friction]);

  return (
    <div className="atelier-pane atelier-friction">
      <header className="atelier-pane-head">
        <h3>{t.friction_title}</h3>
        <p>{t.friction_desc}</p>
      </header>

      <div className="atelier-friction-stage">
        <div className="atelier-friction-ball" style={{ '--friction': friction }}>
          <div className="atelier-friction-ball-inner" />
        </div>
        <div className="atelier-friction-track">
          <div className="atelier-friction-marker" style={{ left: `${friction * 100}%` }} />
        </div>
        <div className="atelier-friction-labels">
          <span>{t.friction_instant}</span>
          <span>{t.friction_honey}</span>
        </div>
      </div>

      <input
        type="range"
        min={0} max={1} step={0.01}
        value={friction}
        onChange={e => setFriction(parseFloat(e.target.value))}
        className="atelier-slider atelier-friction-slider"
        aria-label={t.friction_label}
      />

      <div className="atelier-friction-readout">
        <span>f = <strong>{friction.toFixed(2)}</strong></span>
        <span>transition: <code>{Math.round(50 + friction * 1150)}ms cubic-bezier(0.5, {(friction * 2).toFixed(2)}, 0.5, 1)</code></span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Atelier shell — 5 tabs, 1 close button, dark lab aesthetic
// ─────────────────────────────────────────────────────────────────────
export function Atelier({ lang = 'en', isOpen, onClose, showToast }) {
  const t = ATELIER_I18N[lang] || ATELIER_I18N.en;
  const [tab, setTab] = useState('aura');

  // Lock body scroll while open.
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('atelier-open');
      return () => document.body.classList.remove('atelier-open');
    }
  }, [isOpen]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs = [
    { id: 'aura', icon: 'fa-vial-circle-check', label: t.tab_aura },
    { id: 'pulse', icon: 'fa-wave-square', label: t.tab_pulse },
    { id: 'capsule', icon: 'fa-hourglass-half', label: t.tab_capsule },
    { id: 'dna', icon: 'fa-fingerprint', label: t.tab_dna },
    { id: 'friction', icon: 'fa-droplet', label: t.tab_friction },
  ];

  return (
    <div className="atelier-shell" role="dialog" aria-modal="true" aria-label={t.title}>
      {/* Safety-belt veil (twin of the privacy one): z-index -1
          inside the shell. Even if a Safari stacking-context bug
          punches above (backdrop-filter, mix-blend-mode noise,
          ``background: var()`` shorthand parse fallback), the
          Atelier is guaranteed to NEVER show the underlying
          page through this layer. */}
      <div className="atelier-veil" aria-hidden="true" />
      <div className="atelier-noise" aria-hidden="true" />
      <header className="atelier-topbar">
        <div className="atelier-topbar-title">
          <span className="atelier-pulse-dot" />
          <h2>{t.title}</h2>
          <span className="atelier-subtitle">{t.subtitle}</span>
        </div>
        <button type="button" className="atelier-close" onClick={onClose} aria-label={t.close}>
          <i className="fas fa-xmark" />
        </button>
      </header>

      <nav className="atelier-tabs" role="tablist">
        {tabs.map(tb => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            className={`atelier-tab ${tab === tb.id ? 'is-active' : ''}`}
            onClick={() => setTab(tb.id)}
          >
            <i className={`fas ${tb.icon}`} />
            <span>{tb.label}</span>
          </button>
        ))}
      </nav>

      <main className="atelier-main">
        {tab === 'aura' && <AuraSynthesizer t={t} lang={lang} onCommit={() => {}} showToast={showToast} />}
        {tab === 'pulse' && <CognitivePulse t={t} lang={lang} />}
        {tab === 'capsule' && <ChronoCapsule t={t} lang={lang} showToast={showToast} />}
        {tab === 'dna' && <TypographicDNA t={t} lang={lang} />}
        {tab === 'friction' && <DigitalFriction t={t} lang={lang} showToast={showToast} />}
      </main>

      <footer className="atelier-footer">
        <span className="atelier-footer-tag">DevRose · Atelier v1.0</span>
        <span className="atelier-footer-tag">5 inventions · 0 libraries</span>
      </footer>
    </div>
  );
}

export default Atelier;
