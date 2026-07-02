import React from 'react';

const Footer = ({ lang, translations }) => {
  const t = translations[lang];

  return (
    <footer style={{
      marginTop: '60px',
      padding: '40px 30px',
      textAlign: 'center',
      borderTop: '1px solid var(--pink-light)',
      color: '#888',
      fontSize: '0.95rem'
    }}>
      <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'center', gap: '20px', fontSize: '1.2rem' }}>
        <a href="#" style={{ color: 'var(--pink-primary)' }}><i className="fab fa-facebook"></i></a>
        <a href="#" style={{ color: 'var(--pink-primary)' }}><i className="fab fa-instagram"></i></a>
        <a href="#" style={{ color: 'var(--pink-primary)' }}><i className="fab fa-whatsapp"></i></a>
        <a href="#" style={{ color: 'var(--pink-primary)' }}><i className="fab fa-github"></i></a>
      </div>
      <p>{t.footer_rights}</p>
    </footer>
  );
};

export default Footer;
