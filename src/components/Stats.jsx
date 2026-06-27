import React from 'react';

const Stats = ({ lang, translations }) => {
  const t = translations[lang];

  return (
    <div style={{ marginTop: '50px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '20px', textAlign: 'center' }} className="fade-in-up">
      <div style={{ background: 'var(--white)', padding: '25px', borderRadius: '15px', borderBottom: '4px solid var(--pink-primary)', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: '2rem', color: 'var(--pink-primary)', fontWeight: 'bold' }}>1,250+</div>
        <div style={{ fontSize: '0.85rem', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '5px' }}>{t.stat_students}</div>
      </div>
      <div style={{ background: 'var(--white)', padding: '25px', borderRadius: '15px', borderBottom: '4px solid #3498db', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: '2rem', color: '#3498db', fontWeight: 'bold' }}>450+</div>
        <div style={{ fontSize: '0.85rem', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '5px' }}>{t.stat_projects}</div>
      </div>
      <div style={{ background: 'var(--white)', padding: '25px', borderRadius: '15px', borderBottom: '4px solid #2ecc71', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: '2rem', color: '#2ecc71', fontWeight: 'bold' }}>98%</div>
        <div style={{ fontSize: '0.85rem', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '5px' }}>{t.stat_satisfaction}</div>
      </div>
    </div>
  );
};

export default Stats;
