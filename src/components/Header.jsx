import React from 'react';const Header = ({ lang, translations, toggleTheme, toggleSettings, darkMode, onOpenChat, unreadChatCount = 0 }) => {
  const t = translations[lang];

  return (
    <header style={{
      background: 'var(--header-bg)',
      backdropFilter: 'blur(10px)',
      padding: '10px 15px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      borderBottom: '1px solid var(--border-color)',
      gap: '10px'
    }}>
      <button className="icon-btn" onClick={toggleSettings} title={t.settings} style={{ flexShrink: 0 }}>
        <i className="fas fa-cog"></i>
      </button>

      <h1 style={{
        margin: 0,
        color: 'var(--pink-primary)',
        fontSize: '1.2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        whiteSpace: 'nowrap',
        animation: 'slideDown 0.5s ease-out',
        flexGrow: 1,
        justifyContent: 'center',
        textAlign: 'center',
        minWidth: 0
      }}>
        <i className="fas fa-graduation-cap" style={{ flexShrink: 0 }}></i>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.brand_name}</span>
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {typeof onOpenChat === 'function' && (
          <button
            className="icon-btn kot3-header-chat-btn"
            onClick={onOpenChat}
            title={lang === 'ht' ? 'Kot3Chat — tout mesaj ou' : 'Kot3Chat — all your messages'}
            style={{ position: 'relative' }}
          >
            <i className="fas fa-comments"></i>
            {unreadChatCount > 0 && (
              <span style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: '#e91e63',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 6px rgba(233,30,99,0.6)'
              }}>
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </span>
            )}
          </button>
        )}
        <button className="icon-btn" id="theme-btn" onClick={toggleTheme} title={t.toggle_theme} style={{ flexShrink: 0 }}>
          <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </header>
  );
};

export default Header;
