import React from 'react';

const Features = ({ lang, translations }) => {
  const t = translations[lang];

  return (
    <div className="features fade-in-up">
      <div className="feature-item">
        <i className="fas fa-laptop-code"></i>
        <h4>{t.feature_live_title}</h4>
        <p>{t.feature_live_desc}</p>
      </div>
      <div className="feature-item">
        <i className="fas fa-certificate"></i>
        <h4>{t.feature_cert_title}</h4>
        <p>{t.feature_cert_desc}</p>
      </div>
      <div className="feature-item">
        <i className="fas fa-users"></i>
        <h4>{t.feature_support_title}</h4>
        <p>{t.feature_support_desc}</p>
      </div>
    </div>
  );
};

export default Features;
