/**
 * src/components/Explore.jsx
 *
 * The new public "Explore" surface. Replaces the old `commerce` tab.
 *
 * Design intent
 * -------------
 *  • Mirror the MessengerHome premium layout language (sticky search,
 *    horizontal filter chips, sectioned cards) so the two surfaces
 *    feel like part of the same product without sharing code.
 *  • Multi-content: courses (real API) + music (seed) + talents (seed).
 *    Adding new content types later = new section + new chip.
 *  • No payment forms anywhere. Prices are shown on course cards as
 *    informational metadata. The course detail page is informational
 *    only — actual enrollment lives in `CourseManager`, a separate
 *    authenticated surface.
 *
 * Data flow
 * ---------
 *  • Courses  → `/api/courses/`  via `courseService.getAll()`
 *  • Music    → `MUSIC_SEEDS`    (src/data/exploreSeeds.js)
 *  • Talents  → `TALENT_SEEDS`   (same file)
 *
 * When the backend exposes `/api/explore/music/` and
 * `/api/explore/talents/`, swap the imports in this file for API
 * services; the component contract is unchanged.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { courseService } from '../services/api';
import { MUSIC_SEEDS, TALENT_SEEDS } from '../data/exploreSeeds';

// ─── Helpers ────────────────────────────────────────────────────────────────

function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

function formatPlays(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ─── Filter chips ───────────────────────────────────────────────────────────
// One source of truth so the chip row + the section visibility check
// can never drift apart. The `id` here is what the chip emits to setState
// and what the `visibleSections` useMemo reads.
const CHIPS = [
  { id: 'all',      icon: 'fa-globe',        ht: 'Tout',     en: 'All',         fr: 'Tout',     es: 'Todo' },
  { id: 'courses',  icon: 'fa-graduation-cap', ht: 'Kou',    en: 'Courses',     fr: 'Cours',    es: 'Cursos' },
  { id: 'music',    icon: 'fa-music',        ht: 'Mizik',    en: 'Music',       fr: 'Musique',  es: 'Música' },
  { id: 'talents',  icon: 'fa-star',         ht: 'Talan',    en: 'Talents',     fr: 'Talents',  es: 'Talentos' },
  { id: 'featured', icon: 'fa-bookmark',     ht: 'Rekòmande', en: 'Featured',   fr: 'Vedette',  es: 'Destacado' },
  { id: 'new',      icon: 'fa-sparkles',     ht: 'Nouvo',    en: 'New',         fr: 'Nouveau',  es: 'Nuevo' },
];

function getChipLabel(chip, lang) {
  const langKey = ['en', 'fr', 'es'].includes(lang) ? lang : 'ht';
  return chip[langKey] || chip.ht;
}

// ─── Section header (sticky-ish label) ──────────────────────────────────────

function SectionLabel({ icon, children, count }) {
  return (
    <div className="explore-section-label">
      {icon && <i className={`fas ${icon}`} aria-hidden="true" />}
      <span>{children}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="explore-section-count">{count}</span>
      )}
    </div>
  );
}

// ─── Course card (info only — no enroll button) ─────────────────────────────

function CourseCard({ course, onOpen, lang, t }) {
  return (
    <div className="explore-card explore-card-course" onClick={() => onOpen?.(course)} role="button" tabIndex={0}>
      <div className="explore-card-image-wrap">
        <img
          className="explore-card-image"
          src={course.image_url}
          alt={course.title}
          onError={(e) => {
            e.currentTarget.src = `https://via.placeholder.com/600x340/d81b60/ffffff?text=${encodeURIComponent(course.title || 'Course')}`;
          }}
        />
        {course.is_featured && (
          <div className="explore-card-badge explore-card-badge-star" title={t.explore_chip_featured || 'Featured'}>
            <i className="fas fa-star" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="explore-card-body">
        <div className="explore-card-title">{course.title}</div>
        {course.description && (
          <div className="explore-card-subtitle">{course.description.slice(0, 90)}{course.description.length > 90 ? '…' : ''}</div>
        )}
        <div className="explore-card-meta">
          {course.price != null && (
            <span className="explore-card-price">
              <span className="explore-card-price-label">{t.price_label || 'Price'}</span>
              <span className="explore-card-price-value">${course.price}</span>
            </span>
          )}
          <span className="explore-card-cta">
            <i className="fas fa-arrow-right" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Music card ─────────────────────────────────────────────────────────────

function MusicCard({ track, onOpen, showToast, t }) {
  return (
    <div
      className="explore-card explore-card-music"
      onClick={() => {
        if (onOpen) {
          onOpen(track);
        } else {
          showToast?.(
            t.explore_coming_soon || 'Coming soon',
            'headphones'
          );
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="explore-card-image-wrap explore-card-image-square">
        <img
          className="explore-card-image"
          src={track.cover}
          alt={track.title}
          onError={(e) => {
            e.currentTarget.src = `https://via.placeholder.com/400/d81b60/ffffff?text=${encodeURIComponent(track.title)}`;
          }}
        />
        <div className="explore-card-play-overlay" aria-hidden="true">
          <i className="fas fa-play" />
        </div>
        {track.is_featured && (
          <div className="explore-card-badge explore-card-badge-star">
            <i className="fas fa-star" aria-hidden="true" />
          </div>
        )}
        <div className="explore-card-duration">{track.duration}</div>
      </div>
      <div className="explore-card-body explore-card-body-tight">
        <div className="explore-card-title">{track.title}</div>
        <div className="explore-card-subtitle">{track.artist}</div>
        <div className="explore-card-meta">
          <span className="explore-card-tag">{track.genre}</span>
          <span className="explore-card-plays">
            <i className="fas fa-headphones" aria-hidden="true" /> {formatPlays(track.plays)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Talent card ────────────────────────────────────────────────────────────

function TalentCard({ talent, onOpen, showToast, t }) {
  return (
    <div
      className={classNames('explore-card explore-card-talent', talent.is_new && 'explore-card-new')}
      onClick={() => {
        if (onOpen) {
          onOpen(talent);
        } else {
          showToast?.(t.explore_coming_soon || 'Coming soon', 'user-plus');
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="explore-talent-row">
        <img
          className="explore-talent-avatar"
          src={talent.avatar}
          alt={talent.name}
          onError={(e) => {
            e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(talent.name || '?')}&background=e91e63&color=ffffff&size=128`;
          }}
        />
        <div className="explore-talent-meta">
          <div className="explore-card-title">
            {talent.name}
            {talent.is_new && <span className="explore-new-pill">{t.explore_chip_new || 'New'}</span>}
          </div>
          <div className="explore-card-subtitle">{talent.role}</div>
          <div className="explore-talent-skills">
            {(talent.skills || []).slice(0, 3).map((s) => (
              <span key={s} className="explore-card-tag explore-card-tag-skill">{s}</span>
            ))}
          </div>
          <div className="explore-talent-location">
            <i className="fas fa-map-marker-alt" aria-hidden="true" /> {talent.location}
          </div>
        </div>
        <button
          type="button"
          className="explore-talent-cta"
          onClick={(e) => {
            e.stopPropagation();
            showToast?.(t.explore_coming_soon || 'Coming soon', 'user-plus');
          }}
          aria-label={t.explore_connect || 'Connect'}
        >
          <i className="fas fa-user-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function Explore({
  user,
  lang = 'ht',
  translations,
  onOpenCourse,
  showToast,
}) {
  const t = translations?.[lang] || translations?.ht || {};

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [courses, setCourses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load courses from API
  useEffect(() => {
    setIsLoading(true);
    courseService
      .getAll()
      .then((res) => setCourses(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setCourses([]))
      .finally(() => setIsLoading(false));
  }, []);

  // Search filter applied per content type
  const q = search.trim().toLowerCase();

  const filteredCourses = useMemo(() => {
    if (!q) return courses;
    return courses.filter(
      (c) =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
    );
  }, [courses, q]);

  const filteredMusic = useMemo(() => {
    if (!q) return MUSIC_SEEDS;
    return MUSIC_SEEDS.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.artist.toLowerCase().includes(q) ||
        m.genre.toLowerCase().includes(q)
    );
  }, [q]);

  const filteredTalents = useMemo(() => {
    if (!q) return TALENT_SEEDS;
    return TALENT_SEEDS.filter(
      (t2) =>
        t2.name.toLowerCase().includes(q) ||
        t2.role.toLowerCase().includes(q) ||
        (t2.skills || []).some((s) => s.toLowerCase().includes(q)) ||
        (t2.location || '').toLowerCase().includes(q)
    );
  }, [q]);

  // Decide which sections show based on the active chip
  const visibleSections = useMemo(() => {
    switch (filter) {
      case 'courses':
        return { courses: filteredCourses };
      case 'music':
        return { music: filteredMusic };
      case 'talents':
        return { talents: filteredTalents };
      case 'featured': {
        const featuredCourses = filteredCourses.filter((c) => c.is_featured).slice(0, 2);
        const featuredMusic = filteredMusic.filter((m) => m.is_featured).slice(0, 2);
        const featuredTalents = filteredTalents.slice(0, 1);
        return {
          featured: [...featuredCourses, ...featuredMusic, ...featuredTalents],
        };
      }
      case 'new': {
        return {
          courses: filteredCourses.slice(0, 5),
          music: filteredMusic.slice(0, 5),
          newTalents: filteredTalents.filter((t2) => t2.is_new),
        };
      }
      case 'all':
      default:
        return {
          featured: [
            ...filteredCourses.filter((c) => c.is_featured).slice(0, 1),
            ...filteredMusic.filter((m) => m.is_featured).slice(0, 1),
            ...filteredTalents.slice(0, 1),
          ],
          courses: filteredCourses,
          music: filteredMusic,
          newTalents: filteredTalents.filter((t2) => t2.is_new),
        };
    }
  }, [filter, filteredCourses, filteredMusic, filteredTalents]);

  const totalItems =
    (visibleSections.featured?.length || 0) +
    (visibleSections.courses?.length || 0) +
    (visibleSections.music?.length || 0) +
    (visibleSections.talents?.length || 0) +
    (visibleSections.newTalents?.length || 0);

  const showEmpty = !isLoading && totalItems === 0;

  return (
    <div className="explore-page" onClick={() => { /* close any open popovers */ }}>
      {/* Hero */}
      <div className="explore-hero">
        <h2 className="explore-hero-title">{t.explore_hero_title || (lang === 'ht' ? 'Explore DevRose' : 'Explore DevRose')}</h2>
        <p className="explore-hero-desc">
          {t.explore_hero_desc || (lang === 'ht'
            ? 'Dekouvri kou, mizik, talan, ak plis ankò.'
            : 'Discover courses, music, talents, and more.')}
        </p>
      </div>

      {/* Sticky search */}
      <div className="explore-search-wrap">
        <div className="explore-search">
          <i className="fas fa-search explore-search-leading" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.explore_search_placeholder || (lang === 'ht' ? 'Chèche kou, mizik, talan…' : 'Search courses, music, talents…')}
            aria-label={t.explore_search_placeholder || 'Search'}
          />
          {search && (
            <button
              type="button"
              className="explore-search-clear"
              onClick={() => setSearch('')}
              aria-label={t.common_close || 'Clear'}
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="explore-chips" role="tablist" aria-label="Explore filter">
        {CHIPS.map((chip) => (
          <button
            type="button"
            key={chip.id}
            role="tab"
            aria-selected={filter === chip.id}
            className={classNames('explore-chip', filter === chip.id && 'active')}
            onClick={() => setFilter(chip.id)}
          >
            <i className={`fas ${chip.icon}`} aria-hidden="true" />
            <span>{getChipLabel(chip, lang)}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="explore-content">
        {isLoading && (
          <div className="explore-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{t.common_loading || (lang === 'ht' ? 'Ap chèche…' : 'Loading…')}</span>
          </div>
        )}

        {/* Featured section (mixed types) */}
        {visibleSections.featured && visibleSections.featured.length > 0 && (
          <>
            <SectionLabel icon="fa-bookmark">
              {t.explore_section_featured || (lang === 'ht' ? 'Rekòmande' : 'Featured')}
            </SectionLabel>
            <div className="explore-hscroll">
              {visibleSections.featured.map((item) => {
                if ('cover' in item) {
                  return <MusicCard key={`f-m-${item.id}`} track={item} showToast={showToast} t={t} />;
                }
                if ('skills' in item) {
                  return <TalentCard key={`f-t-${item.id}`} talent={item} showToast={showToast} t={t} />;
                }
                return <CourseCard key={`f-c-${item.id}`} course={item} onOpen={onOpenCourse} lang={lang} t={t} />;
              })}
            </div>
          </>
        )}

        {/* Courses section */}
        {visibleSections.courses && visibleSections.courses.length > 0 && (
          <>
            <SectionLabel icon="fa-graduation-cap" count={visibleSections.courses.length}>
              {t.explore_section_courses || (lang === 'ht' ? 'Kou' : 'Courses')}
            </SectionLabel>
            <div className="explore-hscroll">
              {visibleSections.courses.map((course) => (
                <CourseCard key={course.id} course={course} onOpen={onOpenCourse} lang={lang} t={t} />
              ))}
            </div>
          </>
        )}

        {/* Music section */}
        {visibleSections.music && visibleSections.music.length > 0 && (
          <>
            <SectionLabel icon="fa-music" count={visibleSections.music.length}>
              {t.explore_section_music || (lang === 'ht' ? 'Mizik' : 'Music')}
            </SectionLabel>
            <div className="explore-hscroll">
              {visibleSections.music.map((track) => (
                <MusicCard key={track.id} track={track} showToast={showToast} t={t} />
              ))}
            </div>
          </>
        )}

        {/* New talents section (vertical list, different visual) */}
        {visibleSections.newTalents && visibleSections.newTalents.length > 0 && (
          <>
            <SectionLabel icon="fa-star" count={visibleSections.newTalents.length}>
              {t.explore_section_talents || (lang === 'ht' ? 'Nouvo Talan' : 'New Talents')}
            </SectionLabel>
            <div className="explore-talent-list">
              {visibleSections.newTalents.map((talent) => (
                <TalentCard key={talent.id} talent={talent} showToast={showToast} t={t} />
              ))}
            </div>
          </>
        )}

        {/* Talents section (also vertical list) */}
        {visibleSections.talents && visibleSections.talents.length > 0 && (
          <>
            <SectionLabel icon="fa-star" count={visibleSections.talents.length}>
              {t.explore_section_talents || (lang === 'ht' ? 'Nouvo Talan' : 'New Talents')}
            </SectionLabel>
            <div className="explore-talent-list">
              {visibleSections.talents.map((talent) => (
                <TalentCard key={talent.id} talent={talent} showToast={showToast} t={t} />
              ))}
            </div>
          </>
        )}

        {/* Empty state */}
        {showEmpty && (
          <div className="explore-empty">
            <div className="explore-empty-icon" aria-hidden="true">
              <i className="fas fa-search" />
            </div>
            <h3>{t.explore_empty || (lang === 'ht' ? 'Anyen pa jwenn' : 'Nothing to explore yet')}</h3>
            <p>{t.explore_empty_hint || (lang === 'ht' ? 'Eseze yon lòt mo oswa chanje filtè a.' : 'Try a different word or change the filter.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Explore;
