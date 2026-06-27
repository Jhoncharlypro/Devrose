import React from 'react';

const Rules = ({ lang, translations }) => {
  const t = translations[lang];

  return (
    <div className="content active">
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h2 style={{ color: 'var(--pink-primary)' }}>{t.tab_rules}</h2>
        <p>{t.rules_desc}</p>
      </div>
      <div id="rules-content" style={{
        background: 'var(--card-bg)',
        padding: '25px',
        borderRadius: '15px',
        borderLeft: '5px solid var(--pink-primary)',
        boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
        lineHeight: '1.6',
        whiteSpace: 'pre-wrap',
        fontSize: '0.95rem',
        color: 'var(--text-main)',
        maxHeight: '70vh',
        overflowY: 'auto'
      }}>
        {t.rules_text}
      </div>
    </div>
  );
};

export default Rules;
