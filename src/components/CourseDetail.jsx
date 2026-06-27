import React from 'react';
import FAQ from './FAQ';

const CourseDetail = ({ course, lang, translations, onBack, onEnroll, isSaved, onToggleSave }) => {
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

        <div style={{ background: '#fdf2f7', padding: '20px', borderRadius: '12px', margin: '20px 0' }}>
          <h3 style={{ color: 'var(--pink-primary)', marginTop: 0 }}>{t.registration_summary}</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span>{t.registration_fee}</span>
            <span style={{ fontWeight: 'bold', color: 'var(--pink-primary)' }}>${course.price}</span>
          </div>
        </div>
        
        <p>{t.payment_method}</p>
        <div id="paypal-button-container" style={{ marginBottom: '20px' }}>
          <button className="btn-action" style={{ background: '#0070ba' }} onClick={onEnroll}>
            <i className="fab fa-paypal"></i> Pay with PayPal
          </button>
        </div>
        
        <hr style={{ margin: '30px 0', border: 0, borderTop: '1px solid #eee' }} />
        
        <p dangerouslySetInnerHTML={{ __html: t.local_payment_desc }}></p>
        <a 
          href={`https://wa.me/50931234567?text=${encodeURIComponent(`Bonjou, mwen vle enskri nan kou: ${course.title}`)}`} 
          target="_blank" 
          rel="noopener noreferrer"
          className="btn-action whatsapp-btn"
          style={{ background: '#25D366', color: 'white', marginTop: '10px', textDecoration: 'none', display: 'block', textAlign: 'center' }}
        >
          <i className="fab fa-whatsapp"></i> <span>{t.enroll_whatsapp}</span>
        </a>

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
