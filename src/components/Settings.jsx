import React, { useRef } from 'react';
import { profileService } from '../services/api';

const Settings = ({ isOpen, onClose, onAuthOpen, lang, onLangChange, toggleTheme, darkMode, fontSize, setFontSize, user, onLogout, translations, showToast, onProfileUpdate }) => {
  const t = translations[lang];
  const [isUploading, setIsUploading] = React.useState(false);
  const fileInputRef = useRef(null);
  const [isEditingBio, setIsEditingBio] = React.useState(false);
  const [tempBio, setTempBio] = React.useState(user?.profile?.bio || '');
  const [isSavingBio, setIsSavingBio] = React.useState(false);
  const [showEmail, setShowEmail] = React.useState(false);
  const [isEditingUsername, setIsEditingUsername] = React.useState(false);
  const [tempUsername, setTempUsername] = React.useState(user?.username || '');
  const [isSavingUsername, setIsSavingUsername] = React.useState(false);
  const [themeColor, setThemeColor] = React.useState(localStorage.getItem('devrose_theme_color') || '#d81b60');
  const [fontFamily, setFontFamily] = React.useState(localStorage.getItem('devrose_font_family') || "'Poppins', sans-serif");
  const [ambientFx, setAmbientFx] = React.useState(localStorage.getItem('devrose_ambient_fx') || 'none');
  const [cardStyle, setCardStyle] = React.useState(localStorage.getItem('devrose_card_style') || 'classic');
  const [showAdvancedAppearance, setShowAdvancedAppearance] = React.useState(false);
  const [sonicUi, setSonicUi] = React.useState(localStorage.getItem('devrose_sonic_ui') === 'true');
  const [cyberCursor, setCyberCursor] = React.useState(localStorage.getItem('devrose_cyber_cursor') === 'true');

  React.useEffect(() => {
    setTempBio(user?.profile?.bio || '');
    setTempUsername(user?.username || '');
  }, [user]);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--font-family', fontFamily);
    localStorage.setItem('devrose_font_family', fontFamily);
  }, [fontFamily]);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--pink-primary', themeColor);
    let rgb = '216, 27, 96'; // default pink
    if (themeColor === '#d81b60') rgb = '216, 27, 96';
    else if (themeColor === '#00acc1') rgb = '0, 172, 193'; // ocean blue
    else if (themeColor === '#43a047') rgb = '67, 160, 71';  // green
    else if (themeColor === '#8e24aa') rgb = '142, 36, 170'; // purple
    else if (themeColor === '#fb8c00') rgb = '251, 140, 0';   // orange

    document.documentElement.style.setProperty('--pink-light', `rgba(${rgb}, 0.1)`);
    localStorage.setItem('devrose_theme_color', themeColor);
  }, [themeColor]);

  React.useEffect(() => {
    localStorage.setItem('devrose_sonic_ui', sonicUi);
    window.playSynthSound = (type, param) => {
      if (localStorage.getItem('devrose_sonic_ui') !== 'true') return;
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'click') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1500, audioCtx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.15);
        } else if (type === 'hover') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
          osc.frequency.setValueAtTime(1300, audioCtx.currentTime + 0.03);
          gain.gain.setValueAtTime(0.015, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.05);
        } else if (type === 'save') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(600, audioCtx.currentTime);
          osc.frequency.setValueAtTime(900, audioCtx.currentTime + 0.08);
          osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.16);
          gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.3);
        } else if (type === 'toggle') {
          osc.type = 'sine';
          const isUp = param === true;
          osc.frequency.setValueAtTime(isUp ? 400 : 700, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(isUp ? 800 : 350, audioCtx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.2);
        }
      } catch (e) {
        console.error(e);
      }
    };
  }, [sonicUi]);

  React.useEffect(() => {
    localStorage.setItem('devrose_cyber_cursor', cyberCursor);
    if (!cyberCursor) {
      document.body.classList.remove('cyber-cursor-active');
      const existingCursor = document.getElementById('cyber-custom-cursor');
      if (existingCursor) existingCursor.remove();
      return;
    }

    document.body.classList.add('cyber-cursor-active');
    
    let cursor = document.getElementById('cyber-custom-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = 'cyber-custom-cursor';
      cursor.style.position = 'fixed';
      cursor.style.width = '20px';
      cursor.style.height = '20px';
      cursor.style.borderRadius = '50%';
      cursor.style.border = `2px solid ${themeColor}`;
      cursor.style.pointerEvents = 'none';
      cursor.style.zIndex = '99999';
      cursor.style.transform = 'translate(-50%, -50%)';
      cursor.style.transition = 'width 0.1s, height 0.1s';
      document.body.appendChild(cursor);
    }

    const moveCursor = (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;

      if (Math.random() < 0.15) {
        const particle = document.createElement('div');
        particle.className = 'cyber-particle-trail';
        particle.style.position = 'fixed';
        particle.style.left = `${e.clientX}px`;
        particle.style.top = `${e.clientY}px`;
        particle.style.width = '4px';
        particle.style.height = '4px';
        particle.style.borderRadius = '50%';
        particle.style.background = themeColor;
        particle.style.pointerEvents = 'none';
        particle.style.zIndex = '99998';
        particle.style.transform = 'translate(-50%, -50%)';
        particle.style.transition = 'all 0.5s ease-out';
        document.body.appendChild(particle);

        setTimeout(() => {
          particle.style.transform = 'translate(-50%, -50%) scale(0)';
          particle.style.opacity = '0';
          setTimeout(() => particle.remove(), 500);
        }, 10);
      }
    };

    const pressCursor = () => {
      cursor.style.width = '35px';
      cursor.style.height = '35px';
      cursor.style.background = `rgba(216, 27, 96, 0.2)`;
    };

    const releaseCursor = () => {
      cursor.style.width = '20px';
      cursor.style.height = '20px';
      cursor.style.background = 'transparent';
    };

    window.addEventListener('mousemove', moveCursor);
    window.addEventListener('mousedown', pressCursor);
    window.addEventListener('mouseup', releaseCursor);

    return () => {
      window.removeEventListener('mousemove', moveCursor);
      window.removeEventListener('mousedown', pressCursor);
      window.removeEventListener('mouseup', releaseCursor);
      if (cursor) cursor.remove();
      document.body.classList.remove('cyber-cursor-active');
    };
  }, [cyberCursor, themeColor]);

  React.useEffect(() => {
    document.body.classList.remove('fx-glass', 'fx-cyber', 'fx-matrix');
    if (ambientFx !== 'none') {
      document.body.classList.add(`fx-${ambientFx}`);
    }
    localStorage.setItem('devrose_ambient_fx', ambientFx);

    if (ambientFx === 'matrix') {
      const canvas = document.getElementById('matrix-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      let animationFrameId;

      const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      const columns = Math.floor(canvas.width / 20) + 1;
      const ypos = Array(columns).fill(0);

      const matrix = () => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = themeColor;
        ctx.font = '15pt monospace';

        ypos.forEach((y, ind) => {
          const chars = "DEVROSE10011001";
          const text = chars.charAt(Math.floor(Math.random() * chars.length));
          const x = ind * 20;
          ctx.fillText(text, x, y);

          if (y > 100 + Math.random() * 10000) {
            ypos[ind] = 0;
          } else {
            ypos[ind] = y + 20;
          }
        });
      };

      const render = () => {
        matrix();
        animationFrameId = requestAnimationFrame(render);
      };
      render();

      return () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('resize', resizeCanvas);
      };
    }
  }, [ambientFx, themeColor]);

  React.useEffect(() => {
    document.body.classList.remove('design-glass', 'design-brutalist');
    if (cardStyle !== 'classic') {
      document.body.classList.add(`design-${cardStyle}`);
    }
    localStorage.setItem('devrose_card_style', cardStyle);
  }, [cardStyle]);

  const handleSaveBio = () => {
    setIsSavingBio(true);
    profileService.updateMe({ bio: tempBio })
      .then(() => {
        if (showToast) showToast(lang === 'ht' ? 'Profil ou mete ajou!' : 'Profile updated!', 'check-circle');
        setIsEditingBio(false);
        if (onProfileUpdate) onProfileUpdate();
      })
      .catch(err => {
        console.error("Bio update error:", err);
        alert(lang === 'ht' ? "Erè nan mete ajou bio a." : "Error updating bio.");
      })
      .finally(() => setIsSavingBio(false));
  };

  const handleSaveUsername = () => {
    if (!tempUsername.trim()) {
      alert(lang === 'ht' ? 'Non itilizatè a pa ka vid.' : 'Username cannot be empty.');
      return;
    }
    setIsSavingUsername(true);
    profileService.updateMe({ username: tempUsername, lang })
      .then(() => {
        if (showToast) showToast(lang === 'ht' ? 'Non itilizatè ou mete ajou!' : 'Username updated!', 'check-circle');
        setIsEditingUsername(false);
        if (onProfileUpdate) onProfileUpdate();
      })
      .catch(err => {
        console.error("Username update error:", err);
        const errorMsg = err.response?.data?.error || (lang === 'ht' ? "Erè nan mete ajou non itilizatè a." : "Error updating username.");
        alert(errorMsg);
      })
      .finally(() => setIsSavingUsername(false));
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 3 * 1024 * 1024) {
         alert(lang === 'ht' ? 'Foto a twò gwo (max 3MB)' : 'Photo too large (max 3MB)');
         return;
      }
      
      setIsUploading(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        profileService.updateMe({ avatar: base64 })
          .then(() => {
            if (showToast) showToast(lang === 'ht' ? 'Foto a chanje!' : 'Photo updated!', 'camera');
            if (onProfileUpdate) onProfileUpdate();
          })
          .catch(err => {
            console.error("Upload error:", err);
            const errorMsg = err.response?.data?.error || (typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : null);
            alert((lang === 'ht' ? "Erè nan moute foto a: " : "Error uploading photo: ") + (errorMsg || err.message));
          })
          .finally(() => setIsUploading(false));
      };
      reader.onerror = () => {
        setIsUploading(false);
        alert("Erè nan li fichye a.");
      };
      reader.readAsDataURL(file);
    }
  };

  const languages = [
    { id: 'ht', label: 'Kreyòl Ayisyen', icon: 'fa-language' },
    { id: 'en', label: 'English', icon: 'fa-globe' },
    { id: 'es', label: 'Español', icon: 'fa-globe-americas' },
    { id: 'fr', label: 'Français', icon: 'fa-globe-europe' }
  ];

  return (
    <div className={`settings-overlay ${isOpen ? 'active' : ''}`} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'var(--pink-bg)',
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
      transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
      transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.4s, opacity 0.4s',
      overflowY: 'auto',
      visibility: isOpen ? 'visible' : 'hidden',
      pointerEvents: isOpen ? 'auto' : 'none',
      opacity: isOpen ? 1 : 0
    }}>
      <div className="settings-header" style={{
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--white)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
      }}>
        <button className="icon-btn" onClick={onClose} style={{ background: 'none', width: 'auto', fontSize: '1.5rem' }}>
          <i className="fas fa-chevron-down"></i>
        </button>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--pink-primary)' }}>{t.settings_title || t.settings}</h2>
        <div style={{ width: '40px' }}></div>
      </div>
      
      <div className="settings-content" style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
        {/* Account Section */}
        <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>{t.account_section}</div>
        <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
          <div className="auth-container" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '20px' }}>
            {user ? (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ position: 'relative', width: '6.25rem', height: '6.25rem', margin: '0 auto 1.25rem auto' }}>
                    <div style={{ 
                        width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', 
                        border: '4px solid var(--pink-primary)', boxShadow: '0 5px 20px rgba(216, 27, 96, 0.3)',
                        position: 'relative', background: 'var(--pink-light)'
                    }}>
                        {isUploading && (
                            <div style={{ 
                                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
                                background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 
                            }}>
                                <i className="fas fa-spinner fa-spin" style={{ color: 'white', fontSize: '1.5rem' }}></i>
                            </div>
                        )}
                        {user.profile?.avatar && user.profile.avatar.length > 0 ? (
                            <img 
                              src={user.profile.avatar} 
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                              alt="Avatar" 
                            />
                        ) : (
                            <div style={{ 
                                width: '100%', height: '100%', display: 'flex', alignItems: 'center', 
                                justifyContent: 'center', fontSize: '2.5rem', fontWeight: 'bold', 
                                color: 'var(--pink-primary)', textTransform: 'uppercase'
                            }}>
                                {user.username.charAt(0)}
                            </div>
                        )}
                    </div>
                    <button 
                        onClick={() => !isUploading && fileInputRef.current.click()}
                        disabled={isUploading}
                        title={lang === 'ht' ? 'Chanje foto' : 'Change photo'}
                        style={{ position: 'absolute', bottom: '0', right: '0', background: 'var(--pink-primary)', color: 'white', border: 'none', width: '2.2rem', height: '2.2rem', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', zIndex: 11 }}
                    >
                        <i className="fas fa-camera" style={{ fontSize: '1rem' }}></i>
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handlePhotoChange} style={{ display: 'none' }} accept="image/*" />
                </div>
                
                <div style={{ marginBottom: '15px' }}>
                    {isEditingUsername ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', maxWidth: '250px', margin: '0 auto', animation: 'fadeInUp 0.3s ease' }}>
                        <input 
                          type="text" 
                          value={tempUsername} 
                          onChange={(e) => setTempUsername(e.target.value)} 
                          className="form-control" 
                          style={{ 
                            textAlign: 'center', fontSize: '1.1rem', fontWeight: '600', padding: '6px 12px', 
                            borderRadius: '10px', border: '1px solid var(--pink-primary)', background: 'var(--pink-light)', 
                            color: 'var(--text-main)', width: '100%' 
                          }}
                          placeholder={lang === 'ht' ? 'Non itilizatè...' : 'Username...'}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => { setIsEditingUsername(false); setTempUsername(user?.username || ''); }} 
                            className="btn-reset" 
                            style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '20px' }}
                          >
                            {lang === 'ht' ? 'Anile' : 'Cancel'}
                          </button>
                          <button 
                            onClick={handleSaveUsername} 
                            disabled={isSavingUsername}
                            className="btn-action" 
                            style={{ padding: '4px 15px', fontSize: '0.75rem', borderRadius: '20px', width: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}
                          >
                            {isSavingUsername && <i className="fas fa-spinner fa-spin"></i>}
                            {lang === 'ht' ? 'Sove' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div 
                        onClick={() => setIsEditingUsername(true)}
                        style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '10px', 
                          cursor: 'pointer',
                          padding: '6px 18px',
                          borderRadius: '25px',
                          background: 'linear-gradient(135deg, rgba(216, 27, 96, 0.06), rgba(255, 64, 129, 0.06))',
                          border: '1.5px solid var(--border-color)',
                          boxShadow: '0 4px 12px rgba(216, 27, 96, 0.05)',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-1px)';
                          e.currentTarget.style.borderColor = 'var(--pink-primary)';
                          e.currentTarget.style.boxShadow = '0 6px 15px rgba(216, 27, 96, 0.12)';
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(216, 27, 96, 0.1), rgba(255, 64, 129, 0.1))';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(216, 27, 96, 0.05)';
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(216, 27, 96, 0.06), rgba(255, 64, 129, 0.06))';
                        }}
                        title={lang === 'ht' ? 'Klike pou chanje non' : 'Click to change username'}
                      >
                        <p style={{ margin: '0', fontSize: '1.3rem', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '0.3px' }}>
                          {user.username}
                          <i className="fas fa-check-circle" style={{ color: '#ffb300', fontSize: '1.05rem' }} title="Verified Scholar"></i>
                        </p>
                        <i className="fas fa-pen-nib" style={{ fontSize: '0.85rem', color: 'var(--pink-primary)', opacity: 0.8 }}></i>
                      </div>
                    )}
                    
                    <div style={{ marginTop: '10px' }}>
                      {isEditingBio ? (
                        <div style={{ marginTop: '10px', textAlign: 'left', animation: 'fadeInUp 0.3s ease' }}>
                          <textarea 
                            value={tempBio}
                            onChange={(e) => setTempBio(e.target.value)}
                            placeholder={lang === 'ht' ? 'Ekri yon ti deskripsyon sou ou...' : 'Tell us about yourself...'}
                            className="form-control"
                            rows="2"
                            style={{ 
                              fontSize: '0.85rem', resize: 'none', background: 'var(--pink-light)', 
                              border: '1px solid var(--pink-primary)', color: 'var(--text-main)', borderRadius: '10px',
                              padding: '8px'
                            }}
                          />
                          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
                            <button 
                              onClick={() => { setIsEditingBio(false); setTempBio(user?.profile?.bio || ''); }} 
                              className="btn-reset" 
                              style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '20px' }}
                            >
                              {lang === 'ht' ? 'Anile' : 'Cancel'}
                            </button>
                            <button 
                              onClick={handleSaveBio} 
                              disabled={isSavingBio}
                              className="btn-action" 
                              style={{ padding: '4px 15px', fontSize: '0.75rem', borderRadius: '20px', width: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}
                            >
                              {isSavingBio && <i className="fas fa-spinner fa-spin"></i>}
                              {lang === 'ht' ? 'Sove' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div 
                          onClick={() => setIsEditingBio(true)}
                          style={{ 
                            marginTop: '8px', 
                            fontSize: '0.9rem', 
                            color: user?.profile?.bio ? 'var(--text-main)' : 'rgba(216, 27, 96, 0.7)', 
                            fontStyle: user?.profile?.bio ? 'italic' : 'normal',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '4px 10px',
                            borderRadius: '15px',
                            background: 'rgba(216, 27, 96, 0.05)',
                            transition: '0.3s'
                          }}
                          title={lang === 'ht' ? 'Klike pou chanje bio' : 'Click to edit bio'}
                        >
                          {user?.profile?.bio ? (
                            <>
                              <span>"{user.profile.bio}"</span>
                              <i className="fas fa-pencil-alt" style={{ fontSize: '0.75rem', opacity: 0.6 }}></i>
                            </>
                          ) : (
                            <>
                              <i className="fas fa-plus" style={{ fontSize: '0.75rem' }}></i>
                              <span>{lang === 'ht' ? 'Ajoute yon ti deskripsyon' : 'Add a short description'}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                </div>
                <button onClick={onLogout} className="btn-auth" style={{ 
                  padding: '10px 20px', borderRadius: '10px', fontWeight: 'bold', border: '2px solid #eee', color: '#666', background: 'transparent', cursor: 'pointer', width: '100%', fontSize: '0.9rem', transition: '0.3s' 
                }}>{t.logout || 'Logout'}</button>
              </div>
            ) : (
              <div onClick={onAuthOpen} className="btn-auth btn-login" style={{ 
                background: 'var(--pink-primary)', color: 'white', padding: '12px', borderRadius: '10px', fontWeight: 'bold', textAlign: 'center', cursor: 'pointer' 
              }}>{t.login} / {t.signup}</div>
            )}
          </div>
        </div>

        {/* Appearance Section */}
        <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>{t.appearance_section}</div>
        <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
          <div className="settings-item" onClick={toggleTheme} style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--pink-light)', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`} style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
              <span style={{ fontWeight: 500 }}>{t.dark_mode}</span>
            </div>
            <label className="switch" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={darkMode} onChange={toggleTheme} />
              <span className="slider"></span>
            </label>
          </div>

          {/* Theme Color Selector */}
          <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', borderBottom: '1px solid var(--pink-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <i className="fas fa-palette" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
              <span style={{ fontWeight: 500 }}>{lang === 'ht' ? 'Koulè tèm nan' : 'Theme Color'}</span>
            </div>
            <div style={{ display: 'flex', gap: '15px', padding: '5px 0', width: '100%', justifyContent: 'space-around' }}>
              {[
                { hex: '#d81b60', name: 'Pink' },
                { hex: '#00acc1', name: 'Blue' },
                { hex: '#43a047', name: 'Green' },
                { hex: '#8e24aa', name: 'Purple' },
                { hex: '#fb8c00', name: 'Orange' }
              ].map(color => (
                <button
                  key={color.hex}
                  onClick={() => setThemeColor(color.hex)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: color.hex,
                    border: themeColor === color.hex ? '3px solid var(--text-main)' : '2px solid transparent',
                    cursor: 'pointer',
                    boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                    transform: themeColor === color.hex ? 'scale(1.15)' : 'scale(1)',
                    transition: 'all 0.2s'
                  }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Font Family Selector */}
          <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--pink-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <i className="fas fa-font" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
              <span style={{ fontWeight: 500 }}>{lang === 'ht' ? 'Kalite Tèks' : 'Font Family'}</span>
            </div>
            <select 
              value={fontFamily} 
              onChange={(e) => setFontFamily(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1.5px solid var(--pink-primary)',
                background: 'var(--white)',
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="'Poppins', sans-serif">Poppins</option>
              <option value="'Outfit', sans-serif">Outfit</option>
              <option value="'Inter', sans-serif">Inter</option>
              <option value="'Roboto Mono', monospace">Roboto Mono</option>
            </select>
          </div>

          <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: showAdvancedAppearance ? '1px solid var(--pink-light)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <i className="fas fa-text-height" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
              <span style={{ fontWeight: 500 }}>{t.text_size}</span>
            </div>
            <input 
              type="range" 
              min="12" 
              max="24" 
              value={fontSize} 
              onChange={(e) => setFontSize(parseInt(e.target.value))} 
              style={{ width: '100px', accentColor: 'var(--pink-primary)' }}
            />
          </div>

          {/* Collapsible Advanced Personalization Trigger */}
          <div 
            onClick={() => {
              setShowAdvancedAppearance(!showAdvancedAppearance);
              window.playSynthSound?.('click');
            }}
            style={{ 
              padding: '12px 20px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              cursor: 'pointer',
              background: 'rgba(216, 27, 96, 0.03)',
              borderTop: '1px solid var(--pink-light)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <i className="fas fa-magic" style={{ color: 'var(--pink-primary)' }}></i>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--pink-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {lang === 'ht' ? 'Opsyon Vizyèl & Sonò' : 'Sonic & Visual FX'}
              </span>
            </div>
            <i className={`fas ${showAdvancedAppearance ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
          </div>

          {showAdvancedAppearance && (
            <div style={{ animation: 'fadeInUp 0.3s ease', background: 'rgba(0,0,0,0.01)' }}>
              {/* Ambient Background FX Selector */}
              <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--pink-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <i className="fas fa-wind" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <span style={{ fontWeight: 500 }}>{lang === 'ht' ? 'Ambyans Paj la' : 'Ambient FX Backdrop'}</span>
                </div>
                <select 
                  value={ambientFx} 
                  onChange={(e) => {
                    setAmbientFx(e.target.value);
                    window.playSynthSound?.('toggle', true);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--pink-primary)',
                    background: 'var(--white)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  <option value="none">{lang === 'ht' ? 'Senp / Net' : 'None / Clean'}</option>
                  <option value="glass">{lang === 'ht' ? 'Gliss (Glow)' : 'Floating Globs'}</option>
                  <option value="cyber">{lang === 'ht' ? 'Cyber (Grid)' : 'Cyberpunk Grid'}</option>
                  <option value="matrix">{lang === 'ht' ? 'Kòd Matris' : 'Matrix Rain'}</option>
                </select>
              </div>

              {/* Sonic UI Toggle */}
              <div className="settings-item" onClick={() => {
                const nextVal = !sonicUi;
                setSonicUi(nextVal);
                if (nextVal) {
                  localStorage.setItem('devrose_sonic_ui', 'true');
                  setTimeout(() => window.playSynthSound?.('toggle', true), 10);
                } else {
                  localStorage.setItem('devrose_sonic_ui', 'false');
                }
              }} style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--pink-light)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <i className="fas fa-volume-up" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <span style={{ fontWeight: 500 }}>{lang === 'ht' ? 'Feedback Sonò' : 'Sonic UI Sounds'}</span>
                </div>
                <label className="switch" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sonicUi} onChange={() => {}} />
                  <span className="slider"></span>
                </label>
              </div>

              {/* Cyber Cursor Toggle */}
              <div className="settings-item" onClick={() => {
                const nextVal = !cyberCursor;
                setCyberCursor(nextVal);
                window.playSynthSound?.('toggle', nextVal);
              }} style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--pink-light)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <i className="fas fa-mouse-pointer" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <span style={{ fontWeight: 500 }}>{lang === 'ht' ? 'Kèso Espesyal' : 'Cyber Cursor Trail'}</span>
                </div>
                <label className="switch" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={cyberCursor} onChange={() => {}} />
                  <span className="slider"></span>
                </label>
              </div>

              {/* Card Design Selector */}
              <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <i className="fas fa-cubes" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <span style={{ fontWeight: 500 }}>{lang === 'ht' ? 'Stil Kat Sit la' : 'Card Design Style'}</span>
                </div>
                <select 
                  value={cardStyle} 
                  onChange={(e) => {
                    setCardStyle(e.target.value);
                    window.playSynthSound?.('toggle', true);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--pink-primary)',
                    background: 'var(--white)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  <option value="classic">{lang === 'ht' ? 'Klasik' : 'Classic Rounded'}</option>
                  <option value="glass">{lang === 'ht' ? 'Vit / Blur' : 'Glassmorphism'}</option>
                  <option value="brutalist">{lang === 'ht' ? 'Retro / Teknoloji' : 'Neo-Brutalist'}</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Language Section */}
        <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>{t.language_section}</div>
        <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
          {languages.map(l => (
            <div key={l.id} onClick={() => onLangChange(l.id)} className="settings-item" style={{ 
              padding: '15px 20px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              borderBottom: '1px solid var(--pink-light)', 
              cursor: 'pointer' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <i className={`fas ${l.icon}`} style={{ width: '30px', color: 'var(--pink-primary)', textAlign: 'center' }}></i>
                <span style={{ fontWeight: 500 }}>{l.label}</span>
              </div>
              {lang === l.id && <i className="fas fa-check" style={{ color: 'var(--pink-primary)' }}></i>}
            </div>
          ))}
        </div>

        {/* Security & Info Section */}
        {user && (
          <>
            <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>
              {lang === 'ht' ? 'Sekirite ak Enfòmasyon' : 'Security & Info'}
            </div>
            <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
              <div 
                className="settings-item" 
                onClick={() => setShowEmail(!showEmail)} 
                style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <i className="fas fa-envelope" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <div>
                    <span style={{ fontWeight: 500, display: 'block' }}>{lang === 'ht' ? 'Imèl mwen' : 'My Email'}</span>
                    <span style={{ fontSize: '0.85rem', color: '#888', fontFamily: 'monospace' }}>
                      {showEmail ? user.email : '••••••••' + user.email.substring(user.email.indexOf('@'))}
                    </span>
                  </div>
                </div>
                <i className={`fas ${showEmail ? 'fa-eye-slash' : 'fa-eye'}`} style={{ color: 'var(--pink-primary)', fontSize: '1rem' }}></i>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
