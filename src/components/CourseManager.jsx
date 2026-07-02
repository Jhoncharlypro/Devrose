/**
 * src/components/CourseManager.jsx
 *
 * "Lòt espas" — the separate space the user asked for. The public
 * Explore page is browse-only (no payment, no enrollment); the actual
 * course management surface (admin CRUD, enrollment approvals, future
 * payment) lives here, behind authentication. For now it renders a
 * simple "coming soon" placeholder so the route exists in the activeTab
 * state machine and can be wired up by a future release without
 * touching App.jsx.
 *
 * This file is intentionally minimal: zero external state, zero
 * business logic, zero backend calls. When the real feature lands, the
 * component can grow in-place.
 */
import React from 'react';

export function CourseManager({ lang = 'ht', translations }) {
  const t = translations?.[lang] || translations?.ht || {};
  return (
    <div className="fade-in-up kot3-empty-state" style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center', padding: '40px 20px' }}>
      <div className="kot3-empty-state-illustration" aria-hidden="true">
        <i className="fas fa-toolbox" />
      </div>
      <h2 style={{ color: 'var(--pink-primary)', marginTop: 12 }}>
        {t.course_manager_title || (lang === 'ht' ? 'Jesyon Kou' : 'Course Manager')}
      </h2>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 480, margin: '0 auto 18px' }}>
        {t.course_manager_coming_soon ||
          (lang === 'ht'
            ? 'Espas sa a pral pèmèt ou jere kou ou, apwouve enskripsyon, ak plis ankò. Li ap vini nan yon vèsyon kap vini.'
            : 'This space will let you manage your courses, approve enrollments, and more. It will land in a future release.')}
      </p>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--pink-light)',
        color: 'var(--pink-primary)',
        padding: '8px 14px',
        borderRadius: 999,
        fontSize: '0.85rem',
        fontWeight: 600,
      }}>
        <i className="fas fa-clock" aria-hidden="true" />
        {lang === 'ht' ? 'Ap vini byento' : 'Coming soon'}
      </div>
    </div>
  );
}

export default CourseManager;
