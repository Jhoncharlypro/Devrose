import React from 'react';

const Roadmap = ({ lang, translations }) => {
  const t = translations[lang];

  const paths = [
    {
      id: 1,
      icon: 'fa-server',
      title: 'Backend Engineer Pro',
      desc: 'Metrize lojik dèyè gwo aplikasyon yo ak sekirite done.',
      steps: ['Linux', 'Python', 'Django']
    },
    {
      id: 2,
      icon: 'fa-laptop-code',
      title: 'Full-Stack Mobile Web Dev',
      desc: 'Aprann bati aplikasyon ki kouri sou nenpòt navigatè ak telefòn.',
      steps: ['Web Dev', 'React JS', 'Termux']
    },
    {
      id: 3,
      icon: 'fa-user-shield',
      title: 'Security & Automation Expert',
      desc: 'Aprann pwoteje sistèm yo epi fè òdinatè a travay pou ou.',
      steps: ['Linux Control', 'Python Automation', 'Cybersecurity']
    }
  ];

  return (
    <div className="content active">
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h2 style={{ color: 'var(--pink-primary)' }}>Chemen Siksè ou (Career Paths)</h2>
        <p>Nou pa jis vann kou, nou fòme pwofesyonèl. Chwazi yon chemen epi kòmanse jodi a.</p>
      </div>

      <div className="roadmap-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {paths.map(path => (
          <div key={path.id} className="roadmap-path" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            background: 'var(--pink-light)',
            padding: '20px',
            borderRadius: '15px',
            borderLeft: '8px solid var(--pink-primary)'
          }}>
            <div className="path-icon" style={{ fontSize: '2.5rem', color: 'var(--pink-primary)', minWidth: '60px', textAlign: 'center' }}>
              <i className={`fas ${path.icon}`}></i>
            </div>
            <div className="path-info">
              <h3 style={{ margin: '0 0 5px 0', color: 'var(--pink-primary)', fontSize: '1.1rem' }}>{path.title}</h3>
              <p style={{ margin: 0 }}>{path.desc}</p>
              <div className="path-steps" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {path.steps.map((step, index) => (
                  <React.Fragment key={index}>
                    <span className="step-badge" style={{
                      background: 'var(--white)',
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      border: '1px solid var(--pink-primary)',
                      color: 'var(--pink-primary)'
                    }}>{step}</span>
                    {index < path.steps.length - 1 && (
                      <span className="arrow-connector" style={{ color: '#888', display: 'flex', alignItems: 'center' }}>
                        <i className="fas fa-chevron-right"></i>
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Roadmap;
