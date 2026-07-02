import React from 'react';

const Tabs = ({ activeTab, setActiveTab, lang, translations }) => {
  const t = translations[lang];

  const tabs = [
    { id: 'explore', label: t.tab_explore || 'Explore' },
    { id: 'jaden_woz', label: t.tab_jaden_woz || 'Jaden Woz' },
    { id: 'profile', label: t.tab_profile || 'Profile' },
    { id: 'live_classroom', label: 'Live Classroom' },
    { id: 'classroom', label: 'Classroom' },
    { id: 'kot3chat', label: 'Chat' },
    { id: 'explore_detail', label: t.tab_registration },
  ];

  return (
    <div className="tabs-container" style={{
      display: 'flex',
      background: 'var(--pink-light)',
      padding: '5px',
      borderRadius: '50px',
      marginBottom: '25px',
      gap: '5px',
      overflowX: 'auto'
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          style={{
            flex: '0 0 auto',
            padding: '10px 20px',
            cursor: 'pointer',
            border: 'none',
            background: activeTab === tab.id ? 'var(--pink-primary)' : 'none',
            fontWeight: 600,
            borderRadius: '40px',
            transition: '0.3s',
            color: activeTab === tab.id ? '#fff' : 'var(--pink-primary)',
            textAlign: 'center',
            fontSize: '0.85rem',
            minWidth: 'max-content',
            whiteSpace: 'nowrap'
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default Tabs;
