import React from 'react';

const DashboardPreview = ({ lang, translations, onJoin, userProgress, courses }) => {
  const t = translations[lang];

  return (
    <div className="dashboard-preview-card fade-in-up" style={{ marginTop: '50px', background: 'var(--white)', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', border: '1px solid var(--pink-light)' }}>
      <div style={{ padding: '20px', background: 'var(--pink-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: 'var(--pink-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <i className="fas fa-user-graduate"></i> <span>{t.dashboard_preview}</span>
        </h3>
        <span style={{ background: 'var(--pink-primary)', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 'bold' }}>LIVE</span>
      </div>
      <div style={{ padding: '25px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          {userProgress && userProgress.length > 0 ? userProgress.map(prog => {
            const course = courses.find(c => c.id === prog.course);
            if (!course) return null;
            return (
              <div key={prog.id} style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifySelf: 'space-between', marginBottom: '5px', fontSize: '0.9rem', justifyContent: 'space-between' }}>
                  <span>{course.title}</span>
                  <span style={{ fontWeight: 'bold', color: 'var(--pink-primary)' }}>{prog.percentage}%</span>
                </div>
                <div style={{ height: '10px', background: '#eee', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{ width: `${prog.percentage}%`, height: '100%', background: 'var(--pink-primary)' }}></div>
                </div>
              </div>
            );
          }) : (
            <p style={{ color: '#888', fontSize: '0.9rem' }}>Ou poko kòmanse okenn kou.</p>
          )}
        </div>
        <div className="next-class-card" style={{ flex: 1, minWidth: '200px', background: '#f9f9f9', padding: '15px', borderRadius: '12px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>{t.next_class_title}</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <div style={{ width: '40px', height: '40px', background: 'var(--meet-blue)', color: 'white', borderRadius: '8px', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center' }}>
              <i className="fas fa-video"></i>
            </div>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Sibersekirite Avanse</div>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>Demain, 14:00 PM</div>
            </div>
          </div>
          <button className="btn-action" onClick={onJoin} style={{ padding: '8px', fontSize: '0.85rem', background: 'var(--meet-blue)' }}>{t.join_now_btn}</button>
        </div>
      </div>
    </div>
  );
};

export default DashboardPreview;
