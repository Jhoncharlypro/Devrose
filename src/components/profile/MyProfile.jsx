/**
 * src/components/profile/MyProfile.jsx
 *
 * DevRose Terrarium (TeraWoz) — display surface for the user's own
 * profile. Read-only presentation of how the world sees them.
 *
 * After the Privacy Space refactor, every identity control
 * (avatar / cover / bio / username / interests / social links / country)
 * lives in `<PrivacySpace>` so the user's identity has ONE editor,
 * not three. MyProfile now renders:
 *
 *   1. Cover photo banner (16:7) with gradient overlay (display only).
 *   2. Avatar (display only — edits via Privacy Space → Identity tab).
 *   3. Hybrid Rose + Premium Golden Stem treatment when is_premium.
 *   4. Profile Completion "Water Gauge" — read-only mirror of the
 *      server-side completion algorithm.
 *   5. Badges row (6 client-side computed badges).
 *   6. Top course from Jaden Woz — highest-progressed course.
 *   7. Action bar: Privacy Space (Privacy Shield), Share (QR Packet).
 *
 * The "Privacy Shield" button is the primary affordance — it's how
 * the user reaches the identity editor. Behind the curtain the
 * `profileService.getMe()` round-trip still refreshes the page state
 * (so Profile Completion stays accurate), but no inline mutation
 * happens here. The single source of truth for writes is PrivacySpace.
 */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { profileService, progressService } from '../../services/api';
import ShareModal from '../share/ShareModal';
import { hashHue, resizeImage } from '../../utils/profileUtils';

function HybridRose({ hue, size = 160 }) {
  const petalColor = `radial-gradient(circle at 50% 40%, #fff, hsl(${hue}, 80%, 75%) 40%, hsl(${(hue + 30) % 360}, 75%, 60%) 100%)`;
  const stemColor = `linear-gradient(180deg, hsl(${hue}, 70%, 65%), hsl(${(hue + 15) % 360}, 60%, 50%))`;
  return (
    <div className="profile-rose" style={{ width: size, height: size }} aria-hidden="true">
      <div className="profile-rose-stem" style={{ background: stemColor }} />
      <div className="profile-rose-bloom" style={{ background: petalColor, boxShadow: `0 0 28px hsla(${hue}, 80%, 60%, 0.5), 0 0 60px hsla(${hue}, 80%, 60%, 0.25)` }}>
        <span className="profile-rose-petal p1" style={{ background: petalColor }} />
        <span className="profile-rose-petal p2" style={{ background: petalColor }} />
        <span className="profile-rose-petal p3" style={{ background: petalColor }} />
        <span className="profile-rose-petal p4" style={{ background: petalColor }} />
        <span className="profile-rose-petal p5" style={{ background: petalColor }} />
        <span className="profile-rose-petal p6" style={{ background: petalColor }} />
        <span className="profile-rose-center" />
      </div>
      <div className="profile-rose-pollen"><i /><i /><i /></div>
    </div>
  );
}

const COMPLETION_BUCKETS = [
  { key: 'verified',     weight: 20, label_ht: 'Imèl verifye',          label_en: 'Email verified',      label_fr: 'Email vérifié',        label_es: 'Correo verificado',   icon: 'fa-shield-halved' },
  { key: 'avatar',       weight: 15, label_ht: 'Foto pwofil',            label_en: 'Profile photo',       label_fr: 'Photo de profil',     label_es: 'Foto de perfil',     icon: 'fa-camera' },
  { key: 'bio',          weight: 15, label_ht: 'Bio',                    label_en: 'Bio',                 label_fr: 'Bio',                 label_es: 'Bio',                icon: 'fa-quote-left' },
  { key: 'interests',    weight: 10, label_ht: '3+ enterè',              label_en: '3+ interests',        label_fr: '3+ centres',          label_es: '3+ intereses',       icon: 'fa-tags' },
  { key: 'country',      weight: 10, label_ht: 'Peyi',                   label_en: 'Country',             label_fr: 'Pays',                label_es: 'País',               icon: 'fa-globe' },
  { key: 'social',       weight: 10, label_ht: '1+ rezo sosyal',         label_en: '1+ social link',      label_fr: '1+ réseau social',    label_es: '1+ red social',      icon: 'fa-share-nodes' },
  { key: 'first_seed',   weight: 20, label_ht: 'Premye grenn plante',     label_en: 'First seed planted',  label_fr: 'Première graine',     label_es: 'Primera semilla',    icon: 'fa-seedling' },
];

function WaterGauge({ completion, buckets, lang }) {
  const { pct, earnedKeys, hintKey } = completion;
  return (
    <div className="profile-gauge">
      <div className="profile-gauge-header">
        <span className="profile-gauge-label">{lang === 'ht' ? 'Konplete' : 'Profile Completion'}</span>
        <span className="profile-gauge-pct">{pct}%</span>
      </div>
      <div className="profile-gauge-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="profile-gauge-fill" style={{ width: `${pct}%` }} />
        {buckets.map((b) => {
          const earned = earnedKeys.includes(b.key);
          return (
            <div
              key={b.key}
              className={`profile-gauge-bucket ${earned ? 'is-earned' : ''} ${hintKey === b.key ? 'is-hint' : ''}`}
              style={{ left: `${buckets.slice(0, buckets.indexOf(b)).reduce((s, x) => s + x.weight, 0)}%`, width: `${b.weight}%` }}
              title={b[`label_${lang}`] || b.label_en}
            />
          );
        })}
      </div>
      <div className="profile-gauge-legend">
        {buckets.map((b) => {
          const earned = earnedKeys.includes(b.key);
          return (
            <div key={b.key} className={`profile-gauge-legend-item ${earned ? 'is-earned' : ''}`}>
              <i className={`fas ${b.icon}`} />
              <span>{b[`label_${lang}`] || b.label_en}</span>
              {earned ? <i className="fas fa-check" /> : <i className="fas fa-circle" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BADGE_DEFS = [
  {
    id: 'seedling', icon: 'fa-seedling', accent: '#22c55e',
    name_ht: 'Grenn', name_en: 'Seedling', name_fr: 'Graine', name_es: 'Semilla',
    desc_ht: 'Verifye imel ou', desc_en: 'Email verified', desc_fr: 'Email vérifié', desc_es: 'Correo verificado',
  },
  {
    id: 'first_bloom', icon: 'fa-spa', accent: '#ec4899',
    name_ht: 'Premye Flè', name_en: 'First Bloom', name_fr: 'Première fleur', name_es: 'Primer brote',
    desc_ht: 'Fini premye kou ou', desc_en: 'Completed your first course', desc_fr: 'Premier cours terminé', desc_es: 'Primer curso terminado',
  },
  {
    id: 'master_botanist', icon: 'fa-crown', accent: '#f59e0b',
    name_ht: 'Mèt Botanik', name_en: 'Master Botanist', name_fr: 'Maître botaniste', name_es: 'Maestro botánico',
    desc_ht: '5+ kou fini', desc_en: '5+ courses completed', desc_fr: '5+ cours terminés', desc_es: '5+ cursos terminados',
  },
  {
    id: 'global_specimen', icon: 'fa-passport', accent: '#3b82f6',
    name_ht: 'Espès Global', name_en: 'Global Specimen', name_fr: 'Spécimen global', name_es: 'Especie global',
    desc_ht: 'Chwazi peyi ou', desc_en: 'Country selected', desc_fr: 'Pays sélectionné', desc_es: 'País seleccionado',
  },
  {
    id: 'deep_roots', icon: 'fa-tree', accent: '#8b5cf6',
    name_ht: 'Rasin Fò', name_en: 'Deep Roots', name_fr: 'Racines profondes', name_es: 'Raíces profundas',
    desc_ht: 'Profil 100% konplete', desc_en: 'Profile 100% complete', desc_fr: 'Profil 100% complet', desc_es: 'Perfil 100% completo',
  },
  {
    id: 'golden_stem', icon: 'fa-gem', accent: '#fbbf24',
    name_ht: 'Tij An Lò', name_en: 'Golden Stem', name_fr: 'Tige dorée', name_es: 'Tallo dorado',
    desc_ht: 'DevRose Premium', desc_en: 'DevRose Premium', desc_fr: 'DevRose Premium', desc_es: 'DevRose Premium',
  },
];

function BadgeCard({ badge, unlocked, lang }) {
  return (
    <div className={`profile-badge ${unlocked ? 'is-unlocked' : 'is-locked'}`} style={{ '--badge-accent': badge.accent }}>
      <div className="profile-badge-icon">
        <i className={`fas ${badge.icon}`} />
        {!unlocked && <i className="fas fa-lock profile-badge-lock" />}
      </div>
      <div className="profile-badge-text">
        <strong>{badge[`name_${lang}`] || badge.name_en}</strong>
        <span>{badge[`desc_${lang}`] || badge.desc_en}</span>
      </div>
    </div>
  );
}

function TopCourseCard({ progress, course, lang }) {
  if (!course) {
    return (
      <div className="profile-top-course profile-top-course-empty">
        <i className="fas fa-seedling" />
        <p>{lang === 'ht' ? 'Pase nan Explore pou plante premye grenn ou.' : 'Visit Explore to plant your first seed.'}</p>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Number(progress?.percentage) || 0));
  const stage = pct >= 100 ? 'full' : pct >= 71 ? 'blooming' : pct >= 41 ? 'bud' : pct >= 1 ? 'sprout' : 'seed';
  return (
    <div className={`profile-top-course stage-${stage}`}>
      <div className="profile-top-course-icon" data-stage={stage}>
        <span className="profile-top-course-seed" />
        {stage !== 'seed' && <span className="profile-top-course-stem" />}
        {(stage === 'bud' || stage === 'blooming' || stage === 'full') && (
          <span className="profile-top-course-bloom" />
        )}
      </div>
      <div className="profile-top-course-meta">
        <span className="profile-top-course-label">{lang === 'ht' ? 'Pi wo flè' : 'Top bloom'}</span>
        <strong>{course.title}</strong>
        <div className="profile-top-course-progress">
          <div className="profile-top-course-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="profile-top-course-pct">{pct}%</span>
      </div>
    </div>
  );
}

export function MyProfile({ user, lang = 'ht', translations, onOpenSettings, onOpenExplore, showToast, onOpenPrivacy }) {
  const t = translations?.[lang] || translations?.ht || {};
  const [me, setMe] = useState(user || null);
  const [progressList, setProgressList] = useState([]);
  const [courses, setCourses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  // Hydrate from /api/profile/me/ on mount so we have the freshest data.
  // Profile writes happen via PrivacySpace now — this is a read-only
  // hydrate. We use a tick to re-fetch every 30 s so the page reflects
  // any in-flight PrivacySpace edits without a manual refresh.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      Promise.all([
        profileService.getMe().catch(() => ({ data: null })),
        import('../../services/api').then((m) => m.courseService.getAll().catch(() => ({ data: [] }))),
        progressService.getAll().catch(() => ({ data: [] })),
      ]).then(([meRes, courseRes, progRes]) => {
        if (cancelled) return;
        const meData = meRes?.data || user || null;
        setMe(meData);
        setCourses(Array.isArray(courseRes?.data) ? courseRes.data : []);
        setProgressList(Array.isArray(progRes?.data) ? progRes.data : []);
        if (meData?.username) {
          setPublicUrl(`${window.location.origin}/u/${encodeURIComponent(meData.username)}`);
        }
      }).finally(() => { if (!cancelled) setIsLoading(false); });
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roseHue = useMemo(() => {
    if (!me) return 320;
    return hashHue(`${me.username || me.id}|${me.date_joined || me.id}`);
  }, [me?.username, me?.date_joined, me?.id]);

  const completion = useMemo(() => {
    const p = me?.profile || {};
    const verified = !!p.email_verified;
    const hasAvatar = !!p.avatar && p.avatar.length > 200 && p.avatar.startsWith('data:');
    const hasBio = (p.bio || '').trim().length > 10;
    const hasInterests = Array.isArray(p.interests) && p.interests.length >= 3;
    const hasCountry = !!p.country && p.country.length > 0;
    const hasSocial = p.social_links && Object.keys(p.social_links).filter((k) => p.social_links[k]).length >= 1;
    const hasFirstSeed = progressList.some((pr) => Number(pr?.percentage) > 0);
    const earnedKeys = [
      verified && 'verified',
      hasAvatar && 'avatar',
      hasBio && 'bio',
      hasInterests && 'interests',
      hasCountry && 'country',
      hasSocial && 'social',
      hasFirstSeed && 'first_seed',
    ].filter(Boolean);
    const pct = earnedKeys.reduce((s, k) => s + (COMPLETION_BUCKETS.find((b) => b.key === k)?.weight || 0), 0);
    const hintKey = COMPLETION_BUCKETS.find((b) => !earnedKeys.includes(b.key))?.key || null;
    return { pct, earnedKeys, hintKey };
  }, [me?.profile, progressList]);

  const unlockedBadges = useMemo(() => {
    const p = me?.profile || {};
    const completedCourses = progressList.filter((pr) => Number(pr?.percentage) >= 100);
    return {
      seedling: p.email_verified,
      first_bloom: completedCourses.length >= 1,
      master_botanist: completedCourses.length >= 5,
      global_specimen: !!p.country,
      deep_roots: completion.pct >= 100,
      golden_stem: !!p.is_premium,
    };
  }, [me?.profile, progressList, completion.pct]);

  const topCourse = useMemo(() => {
    if (!progressList.length || !courses.length) return null;
    const sorted = progressList
      .map((pr) => {
        const course = courses.find((c) => c.id === pr.course || c.id === pr.course_id);
        return course ? { progress: pr, course } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b.progress?.percentage || 0) - (a.progress?.percentage || 0));
    return sorted[0] || null;
  }, [progressList, courses]);

  if (!me) {
    return (
      <div className="profile-page profile-page-empty">
        <i className="fas fa-user-slash" />
        <h2>{lang === 'ht' ? 'Konekte pou wè profil ou' : 'Sign in to view your profile'}</h2>
        <p>{lang === 'ht' ? 'DevRose Terrarium ou ap tann ou.' : 'Your DevRose Terrarium is waiting.'}</p>
      </div>
    );
  }

  const isPremium = !!me.profile?.is_premium;
  const profileHue = roseHue;

  return (
    <div className={`profile-page ${isPremium ? 'is-premium' : ''}`} data-sky-period="noon">
      <div className="profile-rose-backdrop" style={{ '--rose-hue': profileHue }} aria-hidden="true">
        <HybridRose hue={profileHue} size={300} />
      </div>

      <header className="profile-header">
        <div className="profile-cover">
          {me.profile?.cover_photo ? (
            <img src={me.profile.cover_photo} alt="" />
          ) : (
            <div className="profile-cover-gradient" />
          )}
          <div className="profile-cover-overlay" />
          {isPremium && <div className="profile-cover-gold" />}
        </div>
        <div className="profile-identity">
          <div className="profile-avatar-wrap">
            <HybridRose hue={profileHue} size={150} />
            <div
              className="profile-avatar"
              title={(lang === 'ht' ? 'Klike sou Shields pou chanje' : 'Edit in Privacy Space')}
            >
              {me.profile?.avatar && me.profile.avatar.length > 200 ? (
                <img src={me.profile.avatar} alt={me.username || ''} />
              ) : (
                <span className="profile-avatar-initial">
                  {(me.username || '?').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </div>
          <div className="profile-name-block">
            <h1 className="profile-username">
              {me.username}
              {isPremium && <span className="profile-premium-crown" title="Premium"><i className="fas fa-crown" /></span>}
            </h1>
            {me.profile?.status_text && (
              <div className="profile-status">{me.profile.status_text}</div>
            )}
            <div className="profile-bio-block">
              <div className="profile-bio-display" tabIndex={0}>
                {me.profile?.bio ? (
                  <span>"{me.profile.bio}"</span>
                ) : (
                  <span className="profile-bio-placeholder">
                    <i className="fas fa-plus" /> {lang === 'ht' ? 'Ajoute yon ti deskripsyon' : 'Add a short bio'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="profile-action-bar">
            {/* Primary affordance: open Privacy Space. */}
            {onOpenPrivacy && (
              <button type="button" className="profile-action profile-action-primary" onClick={onOpenPrivacy}>
                <i className="fas fa-shield-halved" />
                <span>{lang === 'ht' ? 'Konfidansyalite' : lang === 'fr' ? 'Confidentialité' : lang === 'es' ? 'Privacidad' : 'Privacy'}</span>
              </button>
            )}
            {onOpenSettings && (
              <button type="button" className="profile-action" onClick={onOpenSettings}>
                <i className="fas fa-sliders" />
                <span>{lang === 'ht' ? 'Aparans' : lang === 'fr' ? 'Apparence' : lang === 'es' ? 'Apariencia' : 'Appearance'}</span>
              </button>
            )}
            <button
              type="button"
              className="profile-action"
              onClick={() => setIsShareOpen(true)}
              disabled={!publicUrl}
              title={publicUrl
                ? (lang === 'ht' ? 'Pataje pwofil ou' : 'Share your profile')
                : (lang === 'ht' ? 'Ap chache URL ou...' : 'Loading your URL…')}
            >
              <i className="fas fa-share-nodes" />
              <span>{lang === 'ht' ? 'Pataje' : lang === 'fr' ? 'Partager' : lang === 'es' ? 'Compartir' : 'Share'}</span>
            </button>
          </div>
        </div>
      </header>

      <section className="profile-section">
        <h2 className="profile-section-title">
          <i className="fas fa-droplet" /> {lang === 'ht' ? 'Konplete profil' : lang === 'fr' ? 'Complétion du profil' : lang === 'es' ? 'Completar perfil' : 'Profile completion'}
        </h2>
        <WaterGauge
          completion={completion}
          buckets={COMPLETION_BUCKETS}
          lang={lang}
        />
      </section>

      <section className="profile-section">
        <h2 className="profile-section-title">
          <i className="fas fa-award" /> {lang === 'ht' ? 'Badj' : lang === 'fr' ? 'Badges' : lang === 'es' ? 'Insignias' : 'Badges'}
          <span className="profile-section-count">
            {Object.values(unlockedBadges).filter(Boolean).length}/{BADGE_DEFS.length}
          </span>
        </h2>
        <div className="profile-badges">
          {BADGE_DEFS.map((b) => (
            <BadgeCard key={b.id} badge={b} unlocked={unlockedBadges[b.id]} lang={lang} />
          ))}
        </div>
      </section>

      <section className="profile-section">
        <h2 className="profile-section-title">
          <i className="fas fa-spa" /> {lang === 'ht' ? 'Pi wo flè nan Jaden Woz' : lang === 'fr' ? 'Top fleur dans Jaden Woz' : lang === 'es' ? 'Top flor en Jaden Woz' : 'Top bloom in Jaden Woz'}
        </h2>
        {isLoading ? (
          <div className="profile-top-course-loading">
            <i className="fas fa-spinner fa-spin" />
          </div>
        ) : (
          <TopCourseCard
            progress={topCourse?.progress}
            course={topCourse?.course}
            lang={lang}
          />
        )}
        {onOpenExplore && !topCourse && (
          <button type="button" className="profile-top-course-cta" onClick={onOpenExplore}>
            <i className="fas fa-compass" /> {lang === 'ht' ? 'Ale nan Explore' : lang === 'fr' ? 'Aller à Explore' : lang === 'es' ? 'Ir a Explore' : 'Go to Explore'}
          </button>
        )}
      </section>

      {progressList.length > 0 && (
        <div className="profile-footer-hint">
          <i className="fas fa-info-circle" />
          <span>
            {lang === 'ht'
              ? 'Jaden Woz ou montre tout flè ou kòm plant. Ale sou tab la pou wè yo tout.'
              : lang === 'fr' ? 'Votre Jaden Woz affiche vos cours en plantes. Visitez l\'onglet.'
              : lang === 'es' ? 'Tu Jaden Woz muestra cada curso como planta.'
              : 'Your Jaden Woz shows every course as a plant. Visit the tab to see them all.'}
          </span>
        </div>
      )}

      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        url={publicUrl}
        title={lang === 'ht' ? 'Pataje pwofil ou' : lang === 'fr' ? 'Partager' : lang === 'es' ? 'Compartir' : 'Share your profile'}
        subtitle={me?.username ? `@${me.username}` : ''}
        lang={lang}
      />
    </div>
  );
}

export default MyProfile;
