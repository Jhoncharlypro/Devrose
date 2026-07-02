/**
 * src/components/JadenWoz.jsx
 *
 * "Jaden Woz" — Rose Garden. The signature, never-before-seen feature
 * of DevRose Academy. Replaces the static Roadmap tab.
 *
 * The concept: the user's learning journey is visualized as a living
 * garden. Each course they touch becomes a plant. Progress is the
 * bloom stage. The garden grows with the user, blooms when they
 * complete, and stays beautiful in every season.
 *
 * Phase 12 — advanced animations:
 *   • SkyOverlay      → time-of-day gradient (dawn/noon/dusk/midnight) with stars
 *   • DigitalRain     → Matrix-style rain when the user is inactive 3+ days
 *   • ButterflySwarm  → animated butterflies from the talent pool that flutter
 *                       around the garden
 *   • InactivityBanner→ glassmorphic notice that fades out on first interaction
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { courseService, progressService } from '../services/api';
import { TALENT_SEEDS } from '../data/exploreSeeds';
// Shared utility (Phase 16) — same hashHue algorithm as MyProfile +
// profileUtils.js so the rose / plant colors for any given seed are
// identical across the app.
import { hashHue } from '../utils/profileUtils';
// Phase 17a — Garden Protocol: Saison Kaché (Dormancy).
// The frost visual + the season state machine live in dedicated
// modules so the JadenWoz main function stays focused on the
// plant data + layout.
import { useGardenSeason } from '../hooks/useGardenSeason';
import { FrostOverlay } from './jaden/FrostOverlay';
// Phase 17a — Dormancy + Spring Bloom styles. Imported here (not
// in main.jsx) because they're only relevant when JadenWoz mounts.
import '../styles/jaden-garden.css';

// ─── Bloom stages ───────────────────────────────────────────────────────────

const STAGES = [
  { id: 'seed',     min: 0,   max: 0,   ht: 'Grenn',     en: 'Seed',        fr: 'Graine',    es: 'Semilla' },
  { id: 'sprout',   min: 1,   max: 40,  ht: 'Jèmen',     en: 'Sprout',      fr: 'Pousse',    es: 'Brote' },
  { id: 'bud',      min: 41,  max: 70,  ht: 'Bouton',    en: 'Bud',         fr: 'Bouton',    es: 'Capullo' },
  { id: 'blooming', min: 71,  max: 99,  ht: 'Pouse',     en: 'Blooming',    fr: 'Épanouissement', es: 'Floreciendo' },
  { id: 'full',     min: 100, max: 100, ht: 'An Fleri',  en: 'Full Bloom',  fr: 'Pleine fleur', es: 'Plena flor' },
];

function getStage(percentage) {
  const p = Math.max(0, Math.min(100, Number(percentage) || 0));
  return STAGES.find((s) => p >= s.min && p <= s.max) || STAGES[0];
}

// ─── Color hashing (deterministic per course) ───────────────────────────────
// ``hashHue`` is now imported from ``utils/profileUtils`` (see top of file).
// The local copy was removed in Phase 16 so the rose + plant colors
// share a single source of truth.

function plantColors(course) {
  const hue = hashHue(course?.id ?? course?.title ?? Math.random());
  return {
    stem: `hsl(${hue}, 65%, 55%)`,
    leaf: `hsl(${hue}, 70%, 60%)`,
    accent: `hsl(${(hue + 30) % 360}, 75%, 65%)`,
    glow: `hsla(${hue}, 80%, 65%, 0.45)`,
  };
}

// ─── Plant component (CSS-drawn, no images) ────────────────────────────────

function PlantVisual({ stage, colors, isFeatured, isDrinking }) {
  const stemColor = isFeatured ? 'linear-gradient(180deg, #f59e0b, #b45309)' : colors.stem;
  const leafColor = isFeatured ? '#fbbf24' : colors.leaf;
  const flowerColor = isFeatured
    ? 'radial-gradient(circle at 50% 40%, #fff7ed, #fbbf24 40%, #d97706 100%)'
    : `radial-gradient(circle at 50% 40%, #fff, hsl(${(hashHue(colors.stem) + 320) % 360}, 80%, 75%) 40%, ${colors.accent} 100%)`;

  return (
    <div className={`jaden-plant-visual${isDrinking ? ' is-drinking' : ''}`} data-stage={stage.id}>
      <div className="jaden-soil" />
      {stage.id !== 'seed' && (
        <div className="jaden-stem" style={{ background: stemColor }} />
      )}
      {stage.id === 'sprout' && (
        <div className="jaden-leaves">
          <span className="jaden-leaf jaden-leaf-left" style={{ background: leafColor }} />
          <span className="jaden-leaf jaden-leaf-right" style={{ background: leafColor }} />
        </div>
      )}
      {stage.id === 'bud' && (
        <div className="jaden-bud" style={{ background: flowerColor, boxShadow: `0 0 12px ${colors.glow}` }} />
      )}
      {stage.id === 'blooming' && (
        <>
          <div className="jaden-blooming" style={{ background: flowerColor, boxShadow: `0 0 18px ${colors.glow}` }}>
            <span className="jaden-petal jaden-petal-1" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-2" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-3" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-4" style={{ background: flowerColor }} />
          </div>
          <div className="jaden-pollen"><i /><i /><i /></div>
        </>
      )}
      {stage.id === 'full' && (
        <>
          <div className="jaden-full-bloom" style={{ background: flowerColor, boxShadow: `0 0 28px ${colors.glow}, 0 0 60px ${colors.glow}` }}>
            <span className="jaden-petal jaden-petal-1" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-2" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-3" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-4" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-5" style={{ background: flowerColor }} />
            <span className="jaden-petal jaden-petal-6" style={{ background: flowerColor }} />
            <span className="jaden-center" />
          </div>
          <div className="jaden-pollen"><i /><i /><i /><i /><i /></div>
          {isFeatured && <div className="jaden-sparkle"><i /><i /><i /></div>}
        </>
      )}
      {stage.id === 'seed' && (
        <div className="jaden-seed" style={{ boxShadow: `0 0 14px ${colors.glow}, 0 0 28px ${colors.glow}` }} />
      )}
    </div>
  );
}

// ─── Single plant pot card ──────────────────────────────────────────────────

function PlantCard({ progress, course, lang, t, onOpen, index, isDrinking }) {
  const pct = Math.max(0, Math.min(100, Number(progress?.percentage) || 0));
  const stage = getStage(pct);
  const colors = useMemo(() => plantColors(course), [course]);
  const stageName = stage[lang] || stage.en;
  const isComplete = pct >= 100;

  return (
    <button
      type="button"
      className={`jaden-pot stage-${stage.id}${isComplete ? ' is-complete' : ''}${course?.is_featured ? ' is-featured' : ''}`}
      style={{ animationDelay: `${index * 80}ms` }}
      onClick={() => onOpen?.(course)}
      aria-label={`${course?.title || ''} — ${pct}%`}
    >
      <PlantVisual stage={stage} colors={colors} isFeatured={course?.is_featured} isDrinking={isDrinking} />
      <div className="jaden-pot-meta">
        <div className="jaden-pot-stage">
          {isComplete ? <i className="fas fa-crown" aria-hidden="true" /> : <i className="fas fa-seedling" aria-hidden="true" />}
          <span>{stageName}</span>
        </div>
        <div className="jaden-pot-title">{course?.title || `Course #${progress?.course}`}</div>
        <div className="jaden-pot-progress">
          <div className="jaden-pot-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="jaden-pot-footer">
          <span className="jaden-pot-pct">{pct}%</span>
          <span className="jaden-pot-cta">
            {isComplete
              ? (t.jaden_view || 'View')
              : (t.jaden_water || (lang === 'ht' ? 'Wouze' : 'Water'))}
            <i className="fas fa-arrow-right" aria-hidden="true" />
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Stats panel ────────────────────────────────────────────────────────────

function StatsPanel({ progressList, lang, t }) {
  const counts = useMemo(() => {
    let full = 0, growing = 0, dormant = 0;
    for (const p of progressList) {
      const pct = Number(p?.percentage) || 0;
      if (pct >= 100) full++;
      else if (pct > 0) growing++;
      else dormant++;
    }
    return { full, growing, dormant, total: progressList.length };
  }, [progressList]);

  const labels = {
    full:    { ht: 'Roz ki Fleri',   en: 'Full Blooms',   fr: 'Pleines Fleurs', es: 'Plenas Flores' },
    growing: { ht: 'Ap grandi',      en: 'Growing',       fr: 'En croissance',  es: 'Creciendo' },
    dormant: { ht: 'Grènn',          en: 'Seeds',         fr: 'Graines',        es: 'Semillas' },
    total:   { ht: 'Total plant',    en: 'Total Plants',  fr: 'Total Plantes',  es: 'Plantas Totales' },
  };
  const L = (k) => labels[k][lang] || labels[k].en;

  return (
    <div className="jaden-stats">
      <div className="jaden-stat" data-tone="full">
        <span className="jaden-stat-num">{counts.full}</span>
        <span className="jaden-stat-label">{L('full')}</span>
        <i className="fas fa-crown" aria-hidden="true" />
      </div>
      <div className="jaden-stat" data-tone="growing">
        <span className="jaden-stat-num">{counts.growing}</span>
        <span className="jaden-stat-label">{L('growing')}</span>
        <i className="fas fa-seedling" aria-hidden="true" />
      </div>
      <div className="jaden-stat" data-tone="dormant">
        <span className="jaden-stat-num">{counts.dormant}</span>
        <span className="jaden-stat-label">{L('dormant')}</span>
        <i className="fas fa-circle" aria-hidden="true" />
      </div>
      <div className="jaden-stat" data-tone="total">
        <span className="jaden-stat-num">{counts.total}</span>
        <span className="jaden-stat-label">{L('total')}</span>
        <i className="fas fa-leaf" aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyGarden({ lang, t, onPlant }) {
  const msg = {
    ht: { title: 'Tè a pare.', sub: 'Plante premye grenn ou.' },
    en: { title: 'The soil is ready.', sub: 'Plant your first seed.' },
    fr: { title: 'La terre est prête.', sub: 'Plantez votre première graine.' },
    es: { title: 'La tierra está lista.', sub: 'Planta tu primera semilla.' },
  }[lang] || { title: 'The soil is ready.', sub: 'Plant your first seed.' };
  return (
    <div className="jaden-empty">
      <div className="jaden-empty-pot">
        <div className="jaden-soil" />
        <div className="jaden-seed" style={{ boxShadow: '0 0 24px rgba(216,27,96,0.55), 0 0 60px rgba(216,27,96,0.25)' }} />
      </div>
      <h3>{msg.title}</h3>
      <p>{msg.sub}</p>
      <button type="button" className="jaden-empty-cta" onClick={onPlant}>
        <i className="fas fa-compass" aria-hidden="true" />
        <span>{t.jaden_plant_cta || (lang === 'ht' ? 'Ale nan Explore' : 'Go to Explore')}</span>
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 12 — Advanced animations
// ═══════════════════════════════════════════════════════════════════════════

// ─── SkyOverlay (time-of-day gradient + stars) ─────────────────────────────

function getTimeOfDay(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 9) return 'dawn';
  if (h >= 9 && h < 17) return 'noon';
  if (h >= 17 && h < 20) return 'dusk';
  return 'midnight';
}

function SkyOverlay() {
  const [period, setPeriod] = useState(() => getTimeOfDay());
  // Stars are pre-computed once so they don't reshuffle on every re-render.
  // On dusk + midnight we show 20 stars; on dawn + noon we skip rendering
  // the .jaden-stars container entirely (no point paying paint cost for
  // a layer that will be opacity-0).
  const showStars = period === 'dusk' || period === 'midnight';
  const stars = useMemo(() => {
    const out = [];
    for (let i = 0; i < 20; i++) {
      out.push({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 1.5 + Math.random() * 2.5,
        delay: (Math.random() * 2).toFixed(2),
        duration: (1.8 + Math.random() * 1.5).toFixed(2),
      });
    }
    return out;
  }, []);

  useEffect(() => {
    const id = setInterval(() => setPeriod(getTimeOfDay()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="jaden-sky" aria-hidden="true">
      <div className={`jaden-sky-layer sky-dawn    ${period === 'dawn'    ? 'is-active' : ''}`} />
      <div className={`jaden-sky-layer sky-noon    ${period === 'noon'    ? 'is-active' : ''}`} />
      <div className={`jaden-sky-layer sky-dusk    ${period === 'dusk'    ? 'is-active' : ''}`} />
      <div className={`jaden-sky-layer sky-midnight ${period === 'midnight' ? 'is-active' : ''}`} />
      {showStars && (
        <div className="jaden-stars">
          {stars.map((s) => (
            <span
              key={s.id}
              className="jaden-star"
              style={{
                top: `${s.top}%`,
                left: `${s.left}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: `${s.delay}s`,
                animationDuration: `${s.duration}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ButterflySwarm (4 SVG butterflies from talent pool) ────────────────────

function ButterflySVG({ hue, size = 22 }) {
  // A simple two-wing butterfly drawn in SVG. Two wing paths + a tiny body.
  // `hue` is applied as a CSS variable so the wing fill can use hsl(var(--butterfly-hue)).
  return (
    <svg
      className="jaden-butterfly-svg"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ '--butterfly-hue': hue }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`bg-${hue}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={`hsl(${hue}, 95%, 85%)`} />
          <stop offset="100%" stopColor={`hsl(${hue}, 80%, 60%)`} />
        </radialGradient>
      </defs>
      <path className="wing wing-left-top"  d="M20 20 Q4 4 4 18 Q6 30 20 22 Z" fill={`url(#bg-${hue})`} />
      <path className="wing wing-left-bot"  d="M20 22 Q6 30 8 38 Q14 40 20 28 Z" fill={`hsl(${hue}, 75%, 55%)`} />
      <path className="wing wing-right-top" d="M20 20 Q36 4 36 18 Q34 30 20 22 Z" fill={`url(#bg-${hue})`} />
      <path className="wing wing-right-bot" d="M20 22 Q34 30 32 38 Q26 40 20 28 Z" fill={`hsl(${hue}, 75%, 55%)`} />
      <ellipse cx="20" cy="22" rx="1.2" ry="6" fill="#2a1010" />
      <circle  cx="20" cy="16" r="1.4" fill="#2a1010" />
    </svg>
  );
}

function ButterflySwarm({ isActive, lang }) {
  // Cap at 4 butterflies so the screen doesn't get noisy. On mobile
  // (≤540px) the CSS hides flight-3 / flight-4, so we still render
  // 4 in the DOM but only 2 are visible — the rest remain in the tree
  // for hot-state transitions (rotation back to landscape) without a
  // re-mount thrash.
  const talents = useMemo(() => TALENT_SEEDS.slice(0, 4), []);
  return (
    <div className="jaden-swarm" aria-hidden="true">
      {isActive && talents.map((t, idx) => {
        const hue = hashHue(t.id + t.name);
        return (
          <div
            key={t.id}
            className={`jaden-butterfly flight-${idx + 1}`}
            style={{ animationDelay: `${idx * 1.4}s` }}
          >
            <div className="jaden-butterfly-inner">
              <ButterflySVG hue={hue} />
              <div className="jaden-butterfly-tip" role="tooltip">
                <strong>{t.name}</strong>
                <span>{t.role}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function JadenWoz({
  user,
  lang = 'ht',
  translations,
  onOpenCourse,
  showToast,
  onSwitchTab,
}) {
  const t = translations?.[lang] || translations?.ht || {};
  const [progressList, setProgressList] = useState([]);
  const [courses, setCourses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Phase 17a — Garden Protocol: Saison Kaché (Dormancy).
  // The hook owns the entire localStorage + state machine for the
  // dormancy + revival + multiplier. We just read its returns.
  //   - seasonState:     'active' | 'dormant' | 'reviving'
  //   - multiplierActive: true for 7 days after revival
  //   - triggerRevival:   call once on first user interaction
  //   - multiplierText:   formatted "6j 23h" for the banner
  // This replaces the previous Phase 12 "thirsty garden" / 3-day
  // anxiety pattern with a calmer 14-day threshold and a positive
  // Spring Revival animation instead of a Matrix-rain punishment.
  const {
    seasonState,
    multiplierActive,
    multiplierText,
    triggerRevival,
  } = useGardenSeason();

  // First user interaction in dormant state triggers Spring Revival.
  // Listeners are one-shot (`{ once: true }`) so the user only needs
  // to tap/click/keydown once — we don't fire 5 handlers per click.
  useEffect(() => {
    if (seasonState !== 'dormant') return undefined;
    const handler = () => triggerRevival();
    window.addEventListener('click', handler, { passive: true, once: true });
    window.addEventListener('touchstart', handler, { passive: true, once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('touchstart', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [seasonState, triggerRevival]);

  // The "drinking" visual is the legacy prop name from the Phase 12
  // isDrinking overlay. We map the new state machine to the same
  // boolean so the existing PlantVisual desaturation keeps working
  // without an extra CSS branch.
  const isDrinking = seasonState === 'dormant' || seasonState === 'reviving';

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      progressService.getAll().catch(() => ({ data: [] })),
      courseService.getAll().catch(() => ({ data: [] })),
    ]).then(([progRes, courseRes]) => {
      setProgressList(Array.isArray(progRes?.data) ? progRes.data : []);
      setCourses(Array.isArray(courseRes?.data) ? courseRes.data : []);
    }).finally(() => setIsLoading(false));
  }, []);

  const plants = useMemo(() => {
    return progressList
      .map((p) => {
        const course = courses.find((c) => c.id === p.course || c.id === p.course_id);
        return course ? { progress: p, course } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.course.is_featured && !b.course.is_featured) return -1;
        if (!a.course.is_featured && b.course.is_featured) return 1;
        return (b.progress?.percentage || 0) - (a.progress?.percentage || 0);
      });
  }, [progressList, courses]);

  const heroCopy = {
    ht: { title: 'Jaden Woz', sub: 'Bati jaden konesans ou, flè pa flè.' },
    en: { title: 'Rose Garden', sub: 'Grow your knowledge garden, bloom by bloom.' },
    fr: { title: 'Jardin de Roses', sub: 'Cultivez votre jardin, fleur par fleur.' },
    es: { title: 'Jardín de Rosas', sub: 'Cultiva tu jardín, flor a flor.' },
  }[lang] || { title: 'Rose Garden', sub: 'Grow your knowledge garden, bloom by bloom.' };

  const handlePlant = () => {
    if (onSwitchTab) onSwitchTab('explore');
    else showToast?.(t.explore_coming_soon || 'Coming soon', 'compass');
  };

  // Butterflies should only fly when there's a garden to fly around.
  const showButterflies = !isLoading && plants.length > 0;

  return (
    <div className="jaden-page" data-sky-period={getTimeOfDay()}>
      <SkyOverlay />
      <ButterflySwarm isActive={showButterflies} lang={lang} />

      {/* Phase 17a — Dormancy frost overlay (replaces the Phase 12
          DigitalRain with a calmer, philosophical frost visual). */}
      <FrostOverlay active={isDrinking && showButterflies} isReviving={seasonState === 'reviving'} />

      {/* Phase 17a — Dormant banner (replaces the anxious InactivityBanner
          "your garden is thirsty" with a calmer "your garden is dormant"). */}
      {seasonState === 'dormant' && showButterflies && (
        <div className="jaden-dormant-banner" role="status">
          <i className="fas fa-snowflake" aria-hidden="true" />
          <span>{t.jaden_dormant || (lang === 'ht' ? 'Jaden ou te dòmi. Touche ekran an pou l reyini.' : 'Your garden was dormant. Touch anywhere to revive it.')}</span>
        </div>
      )}

      {/* Phase 17a — Spring Bloom multiplier (slides in for 7 days after revival). */}
      {multiplierActive && (
        <div className="jaden-spring-multiplier" role="status">
          <i className="fas fa-seedling" aria-hidden="true" />
          <span>{t.jaden_spring_active || (lang === 'ht' ? 'Spring Bloom aktif · +2x XP' : 'Spring Bloom active · +2x XP')}</span>
          <span className="jaden-spring-multiplier-time">{multiplierText}</span>
        </div>
      )}

      <div className="jaden-hero">
        <h2 className="jaden-hero-title">{heroCopy.title}</h2>
        <p className="jaden-hero-sub">{heroCopy.sub}</p>
      </div>

      {!isLoading && plants.length > 0 && (
        <StatsPanel progressList={plants.map((p) => p.progress)} lang={lang} t={t} />
      )}

      <div className={`jaden-garden ${isDrinking ? 'is-dormant' : ''}`}>
        {isLoading && (
          <div className="jaden-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{t.common_loading || (lang === 'ht' ? 'Ap grandi…' : 'Growing…')}</span>
          </div>
        )}
        {!isLoading && plants.length === 0 && (
          <EmptyGarden lang={lang} t={t} onPlant={handlePlant} />
        )}
        {plants.map((p, i) => (
          <PlantCard
            key={p.course.id || p.progress.id || i}
            progress={p.progress}
            course={p.course}
            lang={lang}
            t={t}
            onOpen={onOpenCourse}
            index={i}
            isDrinking={isDrinking}
          />
        ))}
      </div>
    </div>
  );
}

export default JadenWoz;
