import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { profileService, authService } from '../services/api';
import { resizeImage } from '../utils/profileUtils';
import { SHEETS } from '../routes/sheets';

/**
 * src/components/Settings.jsx
 *
 * Settings panel — appearance + language + atelier + logout ONLY.
 *
 * PRIVACY, IDENTITY (avatars / cover / bio / interests / social / country),
 * NOTIFICATIONS, BLOCKS / MUTES, and ACCOUNT SECURITY (email-verify / change
 * password / delete account) have all been consolidated into the new
 * dedicated Privacy Space overlay:
 *
 *     src/components/kot3/PrivacySpace.jsx
 *
 * That's the single, dedicated destination for everything the user can
 * say about how DevRose treats them. Settings now only hosts the
 * "vibe" controls (theme / FX / language) so its identity stays clear.
 *
 * The deep-link launcher rows in each former section point at the new
 * overlay so existing muscle memory still finds the surface, just two
 * taps away. Each row uses the `.privacy-link` glassmorphic pill pattern
 * shared with Atelier's launcher so the visual language is consistent.
 */

const PREFERRED_API_ERROR_FIELDS = [
  'cover_photo', 'avatar', 'username', 'bio', 'status_text',
  'interests', 'social_links', 'country', 'notification_prefs',
  'non_field_errors', 'detail', 'error',
];
function extractApiErrorMessage(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return null;
  for (const key of PREFERRED_API_ERROR_FIELDS) {
    const v = data[key];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length && typeof v[0] === 'string') return v[0];
  }
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('__')) continue;
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length && typeof v[0] === 'string') return v[0];
  }
  return null;
}

const Settings = ({ isOpen, onClose, onAuthOpen, lang, onLangChange, toggleTheme, darkMode, fontSize, setFontSize, user, onLogout, translations, showToast, onProfileUpdate }) => {
  const t = translations[lang];
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);
  const [themeColor, setThemeColor] = useState(localStorage.getItem('devrose_theme_color') || '#d81b60');
  const [fontFamily, setFontFamily] = useState(localStorage.getItem('devrose_font_family') || "'Poppins', sans-serif");
  const [ambientFx, setAmbientFx] = useState(localStorage.getItem('devrose_ambient_fx') || 'none');
  const [cardStyle, setCardStyle] = useState(localStorage.getItem('devrose_card_style') || 'classic');
  const [showAdvancedAppearance, setShowAdvancedAppearance] = useState(false);
  const [sonicUi, setSonicUi] = useState(localStorage.getItem('devrose_sonic_ui') === 'true');
  const [cyberCursor, setCyberCursor] = useState(localStorage.getItem('devrose_cyber_cursor') === 'true');


  useEffect(() => {
    document.documentElement.style.setProperty('--font-family', fontFamily);
    localStorage.setItem('devrose_font_family', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty('--pink-primary', themeColor);
    let rgb = '216, 27, 96';
    if (themeColor === '#d81b60') rgb = '216, 27, 96';
    else if (themeColor === '#00acc1') rgb = '0, 172, 193';
    else if (themeColor === '#43a047') rgb = '67, 160, 71';
    else if (themeColor === '#8e24aa') rgb = '142, 36, 170';
    else if (themeColor === '#fb8c00') rgb = '251, 140, 0';

    document.documentElement.style.setProperty('--pink-light', `rgba(${rgb}, 0.1)`);
    localStorage.setItem('devrose_theme_color', themeColor);
  }, [themeColor]);

  useEffect(() => {
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

  useEffect(() => {
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

  useEffect(() => {
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
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
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

  useEffect(() => {
    document.body.classList.remove('design-glass', 'design-brutalist');
    if (cardStyle !== 'classic') {
      document.body.classList.add(`design-${cardStyle}`);
    }
    localStorage.setItem('devrose_card_style', cardStyle);
  }, [cardStyle]);

  const handleResetAppearance = () => {
    const ok = window.confirm(
      lang === 'ht'
        ? 'Reyajiste tout paramèt aparans? W ap toujou konekte.'
        : 'Reset all appearance settings? You will stay logged in.'
    );
    if (!ok) return;
    const APPEARANCE_KEYS = [
      'devrose_theme_color',
      'devrose_ambient_fx',
      'devrose_card_style',
      'devrose_sonic_ui',
      'devrose_cyber_cursor',
      'devrose_font_family',
      'devrose_theme',
      'devrose_fontsize',
      'kot3_active_theme',
      'kot3_custom_accent',
    ];
    APPEARANCE_KEYS.forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
    });
    window.location.reload();
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
        {/* ═══ Inventor's Atelier trigger ═══ */}
        <button
          type="button"
          onClick={() => navigate('/sheet/atelier')}
          className="atelier-launcher"
          aria-label="Open the Inventor's Atelier"
        >
          <div className="atelier-launcher-icon">
            <i className="fas fa-flask" />
            <span className="atelier-launcher-dot" />
          </div>
          <div className="atelier-launcher-text">
            <strong>🧪 {lang === 'ht' ? 'Atelye Envantè' : lang === 'fr' ? "Atelier de l'Inventeur" : lang === 'es' ? 'Atelier del Inventor' : "Inventor's Atelier"}</strong>
            <span>
              {lang === 'ht' ? '5 envansyon ou pa jwenn okenn lòt kote — algoritm ou ka santil.'
                : lang === 'fr' ? '5 inventions introuvables ailleurs — des algorithmes que vous ressentez.'
                : lang === 'es' ? '5 inventions que no encontrarás en ningún otro lugar.'
                : '5 inventions found nowhere else — algorithms you can feel.'}
            </span>
          </div>
          <i className="fas fa-arrow-right atelier-launcher-arrow" />
        </button>

        {/* ═══ Privacy Space deep-link launcher ═══
            The single destination for everything the user can say
            about how DevRose treats them. */}
        <button
          type="button"
          onClick={() => navigate(SHEETS.PRIVACY)}
          className="atelier-launcher privacy-launcher"
          aria-label="Open Privacy Space"
        >
          <div className="atelier-launcher-icon privacy-launcher-icon">
            <i className="fas fa-shield-halved" />
            <span className="atelier-launcher-dot" />
          </div>
          <div className="atelier-launcher-text">
            <strong>
              {lang === 'ht' ? '🛡️ Espas Konfidansyalite'
                : lang === 'fr' ? "🛡️ Espace Confidentialité"
                : lang === 'es' ? '🛡️ Espacio de Privacidad'
                : '🛡️ Privacy Space'}
            </strong>
            <span>
              {lang === 'ht' ? 'Vizibilite, idantite, sekirite, aktivite — tout sou yon ekran.'
                : lang === 'fr' ? 'Visibilité, identité, sécurité, activité — tout au même endroit.'
                : lang === 'es' ? 'Visibilidad, identidad, seguridad, actividad.'
                : 'Visibility, identity, security, activity — all on one screen.'}
            </span>
          </div>
          <i className="fas fa-arrow-right atelier-launcher-arrow" />
        </button>

        {/* Account Section — sign-in / log-out only. The avatar / bio /
            username inline editors have moved into the Privacy Space
            Identity tab so the user's identity lives in one place. */}
        <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>{t.account_section}</div>
        <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
          <div className="auth-container" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '20px' }}>
            {user ? (
              <div style={{ textAlign: 'center', padding: '10px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                <span style={{
                  fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)',
                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                }}>
                  {user.username}
                  <i className="fas fa-check-circle" style={{ color: '#ffb300', fontSize: '0.95rem' }} />
                </span>
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
          <div className="settings-item" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'linear-gradient(90deg, rgba(216, 27, 96, 0.06), rgba(216, 27, 96, 0.02))', borderBottom: '1px solid var(--pink-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
              <i className="fas fa-undo" style={{ width: '30px', height: '30px', background: 'var(--pink-primary)', color: '#fff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}></i>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{lang === 'ht' ? 'Reyajiste tout aparans' : 'Reset all appearance'}</span>
                <span style={{ fontSize: '0.72rem', color: '#888' }}>
                  {lang === 'ht'
                    ? 'Retire tout efè vizyèl + tèm. W ap toujou konekte.'
                    : 'Clear all visual FX + theme. You will stay logged in.'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleResetAppearance}
              className="btn-reset"
              title={lang === 'ht' ? 'Reyajiste tout' : 'Reset all'}
              style={{ padding: '7px 14px', fontSize: '0.75rem', borderRadius: '14px', flexShrink: 0, background: 'var(--pink-primary)', color: '#fff' }}
            >
              <i className="fas fa-rotate-left" style={{ marginRight: '4px' }}></i>
              {lang === 'ht' ? 'Reyajiste' : 'Reset'}
            </button>
          </div>
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

        {/* Privacy section — single, deep-link launcher.
            The previous "Profile Details", "Block & Mute", "Security &
            Account", "Verify email", "Change password", "Delete account",
            Cover / Interests / Social / Country / Notif blocks have all
            been consolidated into `src/components/kot3/PrivacySpace.jsx`
            and the inline editors are removed. The launcher below
            routes the user to the new dedicated surface. */}
        <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>
          {lang === 'ht' ? 'Konfidansyalite & Idantite' : lang === 'fr' ? 'Confidentialité & Identité' : lang === 'es' ? 'Privacidad & Identidad' : 'Privacy & Identity'}
        </div>
        <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
          <button
            type="button"
            className="kot3prof-settings-launcher"
            onClick={() => navigate(SHEETS.PRIVACY)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(SHEETS.PRIVACY); } }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
              padding: '16px 20px',
              background: 'linear-gradient(135deg, rgba(108, 92, 231, 0.10), rgba(0, 231, 255, 0.06))',
              borderBottom: '1px solid var(--pink-light)',
              cursor: 'pointer', border: 'none', textAlign: 'left',
              font: 'inherit', color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1, minWidth: 0 }}>
              <div style={{
                width: '34px', height: '34px',
                background: 'linear-gradient(135deg, #6c5ce7, #00e7ff)',
                color: '#fff', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                fontSize: '0.95rem',
              }}>
                <i className="fas fa-shield-halved" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                  {lang === 'ht' ? 'Espas Konfidansyalite' : lang === 'fr' ? 'Espace Confidentialité' : lang === 'es' ? 'Espacio de Privacidad' : 'Privacy Space'}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#888' }}>
                  {lang === 'ht' ? 'Vizibilite · Idantite · Sekirite · Aktivite'
                    : lang === 'fr' ? 'Visibilité · Identité · Sécurité · Activité'
                    : lang === 'es' ? 'Visibilidad · Identidad · Seguridad · Actividad'
                    : 'Visibility · Identity · Security · Activity'}
                </span>
              </div>
            </div>
            <i className="fas fa-chevron-right" style={{ color: '#6c5ce7' }} />
          </button>

          <button
            type="button"
            className="kot3prof-settings-launcher"
            onClick={() => navigate(SHEETS.PROFILE)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(SHEETS.PROFILE); } }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
              padding: '16px 20px',
              background: 'linear-gradient(135deg, rgba(0,132,255,0.06), rgba(233,30,99,0.04))',
              border: 'none', textAlign: 'left', cursor: 'pointer',
              font: 'inherit', color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1, minWidth: 0 }}>
              <div style={{
                width: '34px', height: '34px',
                background: 'linear-gradient(135deg, #0084ff, #e91e63)',
                color: '#fff', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                fontSize: '0.95rem',
              }}>
                <i className="fas fa-id-badge" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                  {lang === 'ht' ? 'Profil Kot3 — Wè kòm lòt' : lang === 'fr' ? 'Profil Kot3 — Voir comme' : lang === 'es' ? 'Perfil Kot3 — Ver como' : 'Kot3 Profile — View as'}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#888' }}>
                  {lang === 'ht' ? 'Prewiew pwofil ou tankou yon etranje oswa yon zanmi komen.'
                    : lang === 'fr' ? 'Aperçu de votre profil comme un inconnu ou un ami commun.'
                    : lang === 'es' ? 'Previsualiza tu perfil como un desconocido o amigo común.'
                    : 'Preview your profile as a Stranger or Mutual Friend.'}
                </span>
              </div>
            </div>
            <i className="fas fa-chevron-right" style={{ color: '#0084ff' }} />
          </button>
        </div>
      </div>

    </div>
  );
};

export default Settings;
