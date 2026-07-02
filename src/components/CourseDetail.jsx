import React from 'react';
import FAQ from './FAQ';

const CourseDetail = ({ course, lang, translations, onBack, isSaved, onToggleSave }) => {
  const t = translations[lang];
  if (!course) return null;

  const syllabus = course.syllabus || [];

  return (
    <div className="content active fade-in" id="description">
      <div className="detail-view">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <button className="btn-action" style={{ width: 'auto', background: '#666' }} onClick={onBack}>
            <i className="fas fa-arrow-left"></i> <span>{t.back_to_list}</span>
          </button>

          <button 
            onClick={(e) => onToggleSave(e, course.id)}
            style={{
              background: 'var(--white)', border: '2px solid var(--pink-light)', borderRadius: '50%',
              width: '45px', height: '45px', cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              color: isSaved ? 'var(--pink-primary)' : '#ccc',
              fontSize: '1.2rem'
            }}
          >
            <i className={isSaved ? "fas fa-heart" : "far fa-heart"}></i>
          </button>
        </div>

        <div className="meet-badge-detail" style={{
          background: 'var(--meet-blue)',
          color: 'white',
          padding: '10px 20px',
          borderRadius: '50px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '20px',
          fontWeight: 'bold'
        }}>
          <i className="fas fa-video"></i> <span>{t.live_meet_badge}</span>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <button className="btn-action" style={{ width: 'auto', background: 'var(--white)', color: 'var(--pink-primary)', border: '1px solid var(--pink-primary)' }}>
            <i className="fas fa-share-alt"></i> <span>{t.share_course}</span>
          </button>
        </div>

        <img 
          src={course.image_url} 
          className="detail-img" 
          style={{ width: '100%', borderRadius: '15px', marginBottom: '20px' }} 
          alt={course.title}
          onError={(e) => { e.target.src = `https://via.placeholder.com/1200x600/d81b60/ffffff?text=${encodeURIComponent(course.title)}` }}
        />
        <h2>{course.title}</h2>
        
        <p style={{ fontWeight: 'bold', color: 'var(--pink-primary)', fontSize: '1.1rem', marginBottom: '20px' }}>
          {course.description}
        </p>

        {/* Phase 10 — no payment forms. The price is shown as
            informational metadata only. The actual enrollment / payment
            surface lives in `CourseManager` (the "lòt espas"). */}
        {course.price != null && (
          <div style={{ background: '#fdf2f7', padding: '20px', borderRadius: '12px', margin: '20px 0' }}>
            <h3 style={{ color: 'var(--pink-primary)', marginTop: 0 }}>
              {t.price_label || 'Price'}
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span>{t.explore_price_info || (lang === 'ht' ? 'Pri enskripsyon (referans)' : 'Registration price (reference)')}</span>
              <span style={{ fontWeight: 'bold', color: 'var(--pink-primary)' }}>${course.price}</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t.explore_price_disclaimer || (lang === 'ht'
                ? 'Kontakte yon admin nan espas jesyon an pou plis enfòmasyon sou enskripsyon.'
                : 'Contact an admin in the management space for enrollment details.')}
            </p>
          </div>
        )}

        <div style={{ textAlign: 'left', background: 'var(--card-bg)', padding: '25px', borderRadius: '15px', marginTop: '40px', borderLeft: '5px solid var(--pink-primary)', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
          <h3 style={{ color: 'var(--dark)', marginTop: 0 }}>
            <i className="fas fa-list-ol"></i> <span>{t.syllabus_title}</span>
          </h3>
          <div style={{ marginBottom: '30px' }}>
            {syllabus.length > 0 ? syllabus.map((item, index) => (
              <div key={index} style={{ display: 'flex', gap: '15px', marginBottom: '15px', alignItems: 'flex-start', borderBottom: '1px dashed var(--pink-light)', paddingBottom: '10px' }}>
                <span style={{ background: 'var(--pink-primary)', color: 'white', padding: '5px 10px', borderRadius: '5px', fontWeight: 'bold', fontSize: '0.8rem', minWidth: '80px', textAlign: 'center' }}>
                  Week {index + 1}
                </span>
                <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{item}</span>
              </div>
            )) : (
              <p>Kourikoulòm ap disponib byento.</p>
            )}
          </div>

          <h3 style={{ color: 'var(--dark)', marginTop: '30px' }}>
            <i className="fas fa-info-circle"></i> <span>{t.full_details_title}</span>
          </h3>
          <p style={{ color: 'var(--text-main)', lineHeight: '1.6', fontSize: '1rem' }}>
            {course.description}
          </p>
        </div>

        <FAQ lang={lang} translations={translations} courseId={course.id} />
      </div>
    </div>
  );
};

export default CourseDetail;
