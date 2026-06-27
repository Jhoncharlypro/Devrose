import React from 'react';

const NotFound = ({ onBack }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '80vh',
      textAlign: 'center',
      padding: '20px'
    }}>
      <h1 style={{ fontSize: '6rem', color: 'var(--pink-primary)', margin: '0' }}>404</h1>
      <h2 style={{ marginBottom: '20px' }}>Oups! Paj sa a pa egziste.</h2>
      <p style={{ color: '#888', marginBottom: '30px' }}>Li sanble ou pèdi wout ou nan akademi an.</p>
      <button className="btn-action" onClick={onBack} style={{ width: 'auto', padding: '12px 30px' }}>
        Tounen nan Akèy
      </button>
    </div>
  );
};

export default NotFound;
