import React, { useRef, useState } from 'react';
import { profileService, authService, blocksService, mutesService } from '../services/api';

// Extract the FIRST human-readable error string from a DRF-style
// error body. The body is usually one of:
//   { error: "Top-level message" }
//   { detail: "Top-level message" }
//   { field_name: ["First issue", "Second issue"] }
//   { non_field_errors: ["..."] }
// We walk a preferred-field order so the user always sees the SAME
// first error (DRF doesn't guarantee key order). Falls back to null
// when the body is unparseable so the caller can use the legacy
// "Save failed" / "Cannot reach server" branch.
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
  // Last resort: any key with a string / [string] value
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('__')) continue;
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length && typeof v[0] === 'string') return v[0];
  }
  return null;
}

// Resize an image File to fit within `maxWidth x maxHeight` (preserving
// aspect ratio) and re-encode it as JPEG at the given quality. Returns
// a Promise<string> (data URL).
//
// WHY this exists: the avatar + cover-photo upload paths used to
// base64-encode the raw file and ship it. A 1.5 MB avatar → 2 MB
// base64 body sat right at the Vite proxy body cap and the CORS
// preflight blocked the 413 → generic NetworkError → "Cannot reach
// server". A 5 MB cover photo → 6.7 MB base64 → same problem. With
// this helper the output is typically <50 KB (avatar at 400x400 q=0.8)
// or <100 KB (cover at 1200x400 q=0.85), so the request body stays
// well below every upstream cap and the round-trip is fast on mobile.
function resizeImage(file, maxWidth, maxHeight, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // Cap dimensions while preserving aspect ratio.
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // JPEG (not PNG) — photos are 3–5x smaller at the same
        // visual quality. The 'image/jpeg' MIME is universally
        // supported by <img> tags and the Supabase bucket.
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

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

  // ============== PROFILE module state (0012) ==============
  // Cover photo: mirrors the avatar upload pipeline but for a wide banner.
  const [coverFileInputRef] = useState(() => React.createRef());
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  // Interests: array of short lowercase tags (max 10).
  const [interests, setInterests] = useState(user?.profile?.interests || []);
  const [newInterest, setNewInterest] = useState('');
  // Social links: dict by platform.
  const [socialLinks, setSocialLinks] = useState(user?.profile?.social_links || {});
  // Country: ISO-3166 code, hydrated via GET /api/profile/countries/.
  const [country, setCountry] = useState(user?.profile?.country || '');
  const [countries, setCountries] = useState([]);
  // Notification prefs: object of bools.
  const [notifPrefs, setNotifPrefs] = useState(user?.profile?.notification_prefs || {});
  // Block + mute lists.
  const [blocks, setBlocks] = useState([]);
  const [mutes, setMutes] = useState([]);
  // Tab: which inner "Details" / "Notifications" / "Moderation" sub-section
  // is currently expanded. Lets us avoid nesting 100+ rows vertically.
  const [openProfileSection, setOpenProfileSection] = useState(null); // 'cover' | 'interests' | 'social' | 'country' | 'notif' | 'moderation' | null

  // ============== Security & Account state (auth-extension phase) ==============
  // Verify email: tracks whether the user's email is verified and the dev-mode
  // token issued by /api/email/verify/send/ for the in-FE confirm step.
  const [verifyEmailToken, setVerifyEmailToken] = useState('');
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);

  // Change-password: 3-field inline form, hidden behind a "Change password"
  // toggle so the Settings panel doesn't feel too tall.
  const [isChangePwdOpen, setIsChangePwdOpen] = useState(false);
  const [changePwdForm, setChangePwdForm] = useState({
    current_password: '',
    new_password: '',
    confirm_new_password: '',
  });
  const [isChangingPwd, setIsChangingPwd] = useState(false);

  // Delete account: simple typed-confirmation modal so a stray click can't
  // wipe the user's data. We could build a styled modal but window.prompt is
  // sufficient and keeps a single hard-coded barrier to entry ("DELETE").
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  React.useEffect(() => {
    setTempBio(user?.profile?.bio || '');
    setTempUsername(user?.username || '');
    // Hydrate the 0012 fields from the cached User object so the UI shows
    // current values on first paint; no round-trip required.
    setInterests(user?.profile?.interests || []);
    setSocialLinks(user?.profile?.social_links || {});
    setCountry(user?.profile?.country || '');
    setNotifPrefs(user?.profile?.notification_prefs || {});
  }, [user]);

  // Fetch countries catalog + block/mute lists once on mount.
  React.useEffect(() => {
    if (!user) return;
    profileService.getCountries()
      .then(res => setCountries(res.data || []))
      .catch(() => setCountries([]));
    // Bug-fix (Reviewer): the prior shape had the `.catch()` INSIDE the
    // arrow callback (`setBlocks(res.data || []).catch(...)`). Since
    // React's setState returns `undefined`, that ``undefined.catch(...)``
    // threw TypeError synchronously every render — the outer ``.catch``
    // caught the TypeError and reset ``blocks = []`` every time, so the
    // list was *always* empty even on a 200 response. The catch belongs
    // on the Promise itself, not the side effect.
    blocksService.list().then(res => setBlocks(res.data || [])).catch(() => setBlocks([]));
    mutesService.list().then(res => setMutes(res.data || [])).catch(() => setMutes([]));
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
      // Tightened the trail-fade from 0.05 → 0.15 so each frame clears
      // ~15 % of the previous one (was 5 %). The original 0.05 let text
      // accumulate over many seconds until the screen was a uniform
      // pink wash. 0.15 keeps the classic "matrix rain" trail feel
      // (previous text still visible for ~1 s before fading) without
      // the fill — see handleResetAppearance for the user's escape
      // hatch if a different FX combination still misbehaves.
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

  // ============== Security & Account handlers ==============

  // Resend a verify-email token. Dev mode returns the token in the response
  // body so the user can paste it back into the UI to simulate "clicking
  // the link in your email".
  const handleSendVerifyEmail = async () => {
    setIsVerifyingEmail(true);
    try {
      const { data } = await authService.sendEmailVerification();
      if (data?.dev_verify_token) {
        setVerifyEmailToken(String(data.dev_verify_token));
        if (showToast) showToast(t.verify_email_success || 'Verification email sent.', 'envelope');
      } else {
        if (showToast) showToast(t.verify_email_success || 'Verification email sent.', 'envelope');
      }
    } catch (err) {
      console.error('sendVerifyEmail error:', err);
      if (showToast) showToast(err.response?.data?.error || 'Error sending verification email.', 'exclamation-triangle');
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  // Consume the dev-mode token (or the emailed one in production) to mark
  // the email as verified.
  const handleConfirmVerifyEmail = async () => {
    if (!verifyEmailToken.trim()) {
      if (showToast) showToast(lang === 'ht' ? 'Mete token verifye a.' : 'Please paste the verify token first.', 'exclamation-triangle');
      return;
    }
    setIsVerifyingEmail(true);
    try {
      await authService.confirmEmailVerification(verifyEmailToken.trim());
      if (showToast) showToast(t.verify_email_success || 'Email verified.', 'check-circle');
      setVerifyEmailToken('');
      if (onProfileUpdate) onProfileUpdate();
    } catch (err) {
      const msg = err.response?.data?.error || (lang === 'ht' ? 'Token verifye a pa bon.' : 'Invalid verification token.');
      if (showToast) showToast(msg, 'exclamation-triangle');
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  // Change password: validate locally first (don't burn server roundtrips
  // on something the validators could catch), then PUT current + new.
  const handleChangePassword = async () => {
    const { current_password, new_password, confirm_new_password } = changePwdForm;
    if (!current_password || !new_password) {
      if (showToast) showToast(lang === 'ht' ? 'Ranpli tout chan yo.' : 'Please fill all fields.', 'exclamation-triangle');
      return;
    }
    if (new_password !== confirm_new_password) {
      if (showToast) showToast(t.change_password_mismatch || 'Passwords do not match.', 'exclamation-triangle');
      return;
    }
    if (new_password.length < 6) {
      if (showToast) showToast(lang === 'ht' ? 'Modpas dwe omwen 6 karaktè.' : 'Password must be at least 6 chars.', 'exclamation-triangle');
      return;
    }
    setIsChangingPwd(true);
    try {
      await authService.changePassword({ current_password, new_password });
      if (showToast) showToast(t.change_password_success || 'Password changed.', 'check-circle');
      // The server blacklists ALL outstanding refresh tokens for this user,
      // so force logout client-side too. Pass 'password_changed' so the
      // bounce toast says "Password changed. Logged out." instead of the
      // generic "Logged out!" that would otherwise fire via the user path.
      if (onLogout) onLogout('password_changed');
      if (onClose) onClose();
    } catch (err) {
      const msg = err.response?.data?.error || (lang === 'ht' ? 'Erè nan chanje modpas.' : 'Error changing password.');
      if (showToast) showToast(msg, 'exclamation-triangle');
    } finally {
      setIsChangingPwd(false);
    }
  };

  // ============== Reset Appearance (defensive escape hatch) ==============
  // One-click nuclear option for the user. Clears every localStorage key
  // the appearance system writes to (theme color, ambient FX, card
  // style, sonic UI, cyber cursor, font family, dark-mode flag) and
  // reloads the page so every React effect + body class re-derives from
  // the default. Solves the "the page became a uniform pink wash" /
  // "matrix FX filled the screen" / "cyber-cursor stuck" class of
  // issues that happen when a stacked FX combination overpaints the
  // content. The Django + Supabase auth keys are deliberately left
  // alone — the user is still logged in afterwards.
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
      // Kot3chat theme system: see src/hooks/useResolvedTheme.js header
      // for the full read/write contract. Without these two, the
      // 'system' / 'custom' sentinel and the user's custom accent
      // would survive the reset and the all-pink bug could return.
      'kot3_active_theme',
      'kot3_custom_accent',
    ];
    APPEARANCE_KEYS.forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
    });
    // Hard reload so every effect re-derives from defaults — cleaner
    // than trying to reset each useEffect's local state by hand.
    window.location.reload();
  };

  // Delete account: requires the user to literally type "DELETE" in a
  // window.prompt to weed out accidental clicks. After the server confirms,
  // clear local tokens and bounce back to the sign-in modal.
  const handleDeleteAccount = () => {
    const confirmText = window.prompt(t.delete_account_confirm_prompt || 'Type DELETE to confirm:');
    if (confirmText !== 'DELETE') {
      if (showToast) showToast(lang === 'ht' ? 'Aksyon anile.' : 'Cancelled.', 'info-circle');
      return;
    }
    setIsDeletingAccount(true);
    authService.deleteAccount()
      .then(() => {
      if (showToast) showToast(t.delete_account_success || 'Account deleted.', 'check-circle');
      // Pass 'account_deleted' so the bounce toast doesn't pretend the
      // user clicked Logout. ``handleLogout`` (App.jsx) calls
      // ``clearTokenPair()`` internally and shows the toast — no need
      // to pre-clear here.
      if (onLogout) onLogout('account_deleted');
      if (onClose) onClose();
      })
      .catch(err => {
        console.error('deleteAccount error:', err);
        const msg = err.response?.data?.error || (lang === 'ht' ? 'Erè nan efase kont la.' : 'Error deleting account.');
        if (showToast) showToast(msg, 'exclamation-triangle');
      })
      .finally(() => setIsDeletingAccount(false));
  };

  // ============== PROFILE module handlers (0012) ==============
  // Cover photo upload. Resized to 1200x400 JPEG q=0.85 BEFORE
  // base64-encoding via the module-level `resizeImage` helper, so
  // even a 10 MB raw photo produces a <100 KB request body (a raw
  // 5 MB cover → 6.7 MB base64 was hitting the Vite proxy body
  // cap → CORS-preflight-blocked 413 → "Cannot reach server").
  const handleCoverPhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Pre-flight size cap is 10 MB — generous because resizeImage
    // downscales anything wider than 1200px before base64-encoding.
    if (file.size > 10 * 1024 * 1024) {
      showToast?.(lang === 'ht' ? 'Foto kouvèti a twò gwo (max 10MB).' : 'Cover photo too large (max 10MB).', 'exclamation-triangle');
      return;
    }
    setIsUploadingCover(true);
    resizeImage(file, 1200, 400, 0.85)
      .then(base64 => profileService.updateMe({ cover_photo: base64 }, { timeout: 60000 }))
      .then(() => {
        showToast?.(lang === 'ht' ? 'Foto kouvèti a mete ajou!' : 'Cover photo updated!', 'camera');
        onProfileUpdate?.();
      })
      // 3-tier fallback (same shape as handlePhotoChange):
      //   1. Server-supplied human-readable error (DRF field errors
      //      are walked in a stable field order via the module-level
      //      extractApiErrorMessage helper).
      //   2. Generic "Save failed" when a response came back but
      //      we couldn't extract a clean message.
      //   3. "Cannot reach server" only when axios finished without
      //      *any* response (true network error / abort).
      // We append err.message so a timeout / abort surfaces the
      // underlying cause ("timeout of 30000ms exceeded", etc.)
      // instead of the vague fallback string.
      .catch(err => {
        const serverMsg = extractApiErrorMessage(err.response?.data);
        const reason = serverMsg
          || (err.response
                ? (lang === 'ht' ? 'Echèk nan sove.' : 'Save failed.')
                : (lang === 'ht' ? 'Pa kapab rejwenn sèvè a.' : 'Cannot reach server.'));
        const detail = err.message ? ` (${err.message})` : '';
        showToast?.(reason + detail, 'exclamation-triangle');
      })
      .finally(() => setIsUploadingCover(false));
  };

  // Interest tag add — uppercase 'Enter' key + dedupe. Server caps at 10 tags.
  const addInterest = () => {
    const tag = newInterest.trim().toLowerCase();
    if (!tag) return;
    if (interests.includes(tag)) { setNewInterest(''); return; }
    if (interests.length >= 10) {
      showToast?.(lang === 'ht' ? 'Maksimòm 10 tags.' : 'Maximum 10 tags.', 'exclamation-triangle');
      return;
    }
    const next = [...interests, tag.slice(0, 30)];
    setInterests(next);
    setNewInterest('');
    profileService.updateMe({ interests: next }).catch(() => {
      showToast?.(lang === 'ht' ? 'Erè nan sove.' : 'Save error.', 'exclamation-triangle');
    });
  };

  const removeInterest = (tag) => {
    const next = interests.filter(t => t !== tag);
    setInterests(next);
    profileService.updateMe({ interests: next }).catch(() => {
      showToast?.(lang === 'ht' ? 'Erè nan sove.' : 'Save error.', 'exclamation-triangle');
    });
  };

  // Social link blur-save — fires when the user tabs out of the input.
  const saveSocialLink = (platform, value) => {
    const next = { ...socialLinks, [platform]: value };
    if (!value) delete next[platform]; // clear sends an empty string to the BE
    setSocialLinks(next);
    profileService.updateMe({ social_links: next }).catch(err => {
      showToast?.(err.response?.data?.error || 'Save error', 'exclamation-triangle');
    });
  };

  const saveCountry = (code) => {
    setCountry(code);
    profileService.updateMe({ country: code }).catch(() => {
      showToast?.(lang === 'ht' ? 'Erè nan sove peyi a.' : 'Save error.', 'exclamation-triangle');
    });
  };

  const toggleNotifPref = (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    profileService.updateMe({ notification_prefs: next }).catch(() => {
      showToast?.('Save error', 'exclamation-triangle');
    });
  };

  // Block / mute moderation actions.
  const handleUnblock = async (rowId) => {
    try {
      await blocksService.remove(rowId);
      setBlocks(blocks.filter(b => b.id !== rowId));
      showToast?.(lang === 'ht' ? 'Debloke!' : 'Unblocked!', 'check-circle');
    } catch (err) {
      showToast?.(err.response?.data?.error || 'Error', 'exclamation-triangle');
    }
  };

  const handleUnmute = async (rowId) => {
    try {
      await mutesService.remove(rowId);
      setMutes(mutes.filter(m => m.id !== rowId));
      showToast?.(lang === 'ht' ? 'Retire nan mòd silans!' : 'Unmuted!', 'check-circle');
    } catch (err) {
      showToast?.(err.response?.data?.error || 'Error', 'exclamation-triangle');
    }
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const accessToken =
      localStorage.getItem('access_token')
      || localStorage.getItem('sb_access_token');
    if (!accessToken) {
      if (showToast) showToast(lang === 'ht' ? 'Ou dwe konekte anvan ou moute foto a.' : 'You must log in before uploading a photo.', 'exclamation-triangle');
      if (onAuthOpen) onAuthOpen();
      return;
    }
    if (!file.type.startsWith('image/')) {
      if (showToast) showToast(lang === 'ht' ? 'Chwazi yon fichye foto sèlman.' : 'Please select an image file.', 'exclamation-triangle');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      if (showToast) showToast(lang === 'ht' ? 'Foto a twò gwo (max 10MB).' : 'Photo too large (max 10MB).', 'exclamation-triangle');
      e.target.value = '';
      return;
    }
    setIsUploading(true);
    resizeImage(file, 400, 400, 0.8)
      .then(base64 => {
        const len = (base64 || '').length;
        console.info('[PhotoUpload] resize OK length=', len, 'type=', base64?.slice(0, 30));
        return profileService.updateMe({ avatar: base64 }, { timeout: 120000 });
      })
      .then(res => {
        console.info('[PhotoUpload] updateMe status=', res?.status, 'dataKeys=', Object.keys(res?.data || {}));
        if (showToast) showToast(lang === 'ht' ? 'Foto a chanje!' : 'Photo updated!', 'camera');
        if (onProfileUpdate) onProfileUpdate();
      })
      .catch(err => {
        console.error('[PhotoUpload] full error object:', err);
        console.error('[PhotoUpload] err.message:', err?.message);
        console.error('[PhotoUpload] err.code:', err?.code);
        console.error('[PhotoUpload] err.response:', err?.response);
        console.error('[PhotoUpload] err.stack:', err?.stack);
        e.target.value = '';
        const serverMsg = extractApiErrorMessage(err?.response?.data);
        let reason = serverMsg
          || (err?.response
                ? (lang === 'ht' ? 'Echèk nan sove.' : 'Save failed.')
                : (lang === 'ht' ? 'Pa kapab rejwenn sèvè a.' : 'Cannot reach server.'));
        const detail = err?.message ? ` (${err.message})` : '';
        alert((lang === 'ht' ? "Erè nan moute foto a: " : "Error uploading photo: ") + reason + detail);
      })
      .finally(() => setIsUploading(false));
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
          {/* Reset Appearance — always-visible distress escape. Sits at
              the TOP of the Appearance section (NOT buried behind the
              Advanced Personalization toggle) so a user stuck in the
              "all pink" / "matrix filled the screen" / "cyber-cursor
              stuck" class of issues can find it in one click without
              expanding anything. See handleResetAppearance for the
              full key list. Auth tokens are NOT touched. */}
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

        {/* Profile Details Section (PROFILE module 0012) */}
        {user && (
          <>
            <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>
              {t.profile_section || (lang === 'ht' ? 'Detay Profil' : 'Profile Details')}
            </div>
            <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
              {/* Cover photo */}
              <div className="settings-item" style={{ padding: '15px 20px', borderBottom: '1px solid var(--pink-light)' }}>
                <div onClick={() => setOpenProfileSection(openProfileSection === 'cover' ? null : 'cover')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-image" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.cover_photo || 'Cover photo'}</span>
                  </div>
                  <i className={`fas ${openProfileSection === 'cover' ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {openProfileSection === 'cover' && (
                  <div style={{ marginTop: '10px' }}>
                    {(user?.profile?.cover_photo) && (
                      <img src={user.profile.cover_photo} alt="cover" style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '10px', marginBottom: '10px' }} />
                    )}
                    <input type="file" ref={coverFileInputRef} onChange={handleCoverPhotoChange} accept="image/*" style={{ display: 'none' }} />
                    <button type="button" className="btn-action" onClick={() => coverFileInputRef.current?.click()} disabled={isUploadingCover} style={{ padding: '8px 14px', fontSize: '0.8rem', borderRadius: '14px' }}>
                      {isUploadingCover ? <i className="fas fa-spinner fa-spin"></i> : (lang === 'ht' ? 'Chwazi yon foto' : 'Choose photo')}
                    </button>
                    <p style={{ fontSize: '0.72rem', color: '#888', marginTop: '6px', marginBottom: 0 }}>{t.cover_photo_hint}</p>
                  </div>
                )}
              </div>

              {/* Interests tag input */}
              <div className="settings-item" style={{ padding: '15px 20px', borderBottom: '1px solid var(--pink-light)' }}>
                <div onClick={() => setOpenProfileSection(openProfileSection === 'interests' ? null : 'interests')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-tags" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.interests_section || 'Interests'}</span>
                  </div>
                  <i className={`fas ${openProfileSection === 'interests' ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {openProfileSection === 'interests' && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={newInterest}
                        onChange={(e) => setNewInterest(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInterest(); } }}
                        placeholder={t.interests_placeholder || 'Type a tag and press Enter'}
                        maxLength={30}
                        className="form-control"
                        style={{ fontSize: '0.8rem', padding: '8px 10px', flex: 1 }}
                      />
                      <button type="button" className="btn-action" onClick={addInterest} disabled={!newInterest.trim()} style={{ padding: '8px 12px', fontSize: '0.8rem', borderRadius: '14px' }}>
                        {lang === 'ht' ? 'Ajoute' : 'Add'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {interests.map(tag => (
                        <span key={tag} className="kot3-interests-chip" style={{ padding: '4px 10px', borderRadius: '20px', background: 'var(--pink-light)', color: 'var(--pink-primary)', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                          #{tag}
                          <button type="button" onClick={() => removeInterest(tag)} style={{ background: 'transparent', border: 'none', color: 'var(--pink-primary)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }} aria-label={`Remove ${tag}`}>
                            <i className="fas fa-xmark"></i>
                          </button>
                        </span>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.72rem', color: '#888', margin: 0 }}>{t.interests_hint}</p>
                  </div>
                )}
              </div>

              {/* Social links */}
              <div className="settings-item" style={{ padding: '15px 20px', borderBottom: '1px solid var(--pink-light)' }}>
                <div onClick={() => setOpenProfileSection(openProfileSection === 'social' ? null : 'social')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-share-nodes" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.social_links_section || 'Social Links'}</span>
                  </div>
                  <i className={`fas ${openProfileSection === 'social' ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {openProfileSection === 'social' && (
                  <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px', alignItems: 'center' }}>
                    {['instagram', 'whatsapp', 'website', 'twitter', 'linkedin', 'github'].map(platform => (
                      <React.Fragment key={platform}>
                        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)', textTransform: 'capitalize' }}>{platform}</label>
                        <input
                          type="url"
                          value={socialLinks[platform] || ''}
                          onChange={(e) => setSocialLinks({ ...socialLinks, [platform]: e.target.value })}
                          onBlur={(e) => saveSocialLink(platform, e.target.value)}
                          placeholder={`https://${platform === 'website' ? 'example.com' : platform + '.com/user'}`}
                          className="form-control"
                          style={{ fontSize: '0.78rem', padding: '6px 8px' }}
                        />
                      </React.Fragment>
                    ))}
                    <p style={{ gridColumn: '1 / span 2', fontSize: '0.72rem', color: '#888', margin: 0 }}>{t.social_links_hint}</p>
                  </div>
                )}
              </div>

              {/* Country dropdown */}
              <div className="settings-item" style={{ padding: '15px 20px', borderBottom: '1px solid var(--pink-light)' }}>
                <div onClick={() => setOpenProfileSection(openProfileSection === 'country' ? null : 'country')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-globe" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.country_section || 'Country'}</span>
                  </div>
                  <i className={`fas ${openProfileSection === 'country' ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {openProfileSection === 'country' && (
                  <div style={{ marginTop: '10px' }}>
                    <select
                      value={country}
                      onChange={(e) => saveCountry(e.target.value)}
                      className="form-control"
                      style={{ fontSize: '0.8rem', padding: '8px 10px', width: '100%', borderRadius: '10px' }}
                    >
                      <option value="">{t.country_select || 'Select your country'}</option>
                      {countries.map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Notification toggles */}
              <div className="settings-item" style={{ padding: '15px 20px' }}>
                <div onClick={() => setOpenProfileSection(openProfileSection === 'notif' ? null : 'notif')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-bell" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.notif_section || 'Notifications'}</span>
                  </div>
                  <i className={`fas ${openProfileSection === 'notif' ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {openProfileSection === 'notif' && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {[
                      ['sound', t.notif_sound || 'Sounds'],
                      ['desktop_notif', t.notif_desktop || 'Desktop notifications'],
                      ['email_notif', t.notif_email || 'Email notifications'],
                      ['message_preview', t.notif_preview || 'Show message preview'],
                    ].map(([key, label]) => (
                      <div key={key} className="settings-subitem" onClick={() => toggleNotifPref(key)} style={{ padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                        <span style={{ fontSize: '0.82rem' }}>{label}</span>
                        <label className="switch" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={!!notifPrefs[key]} onChange={() => toggleNotifPref(key)} />
                          <span className="slider"></span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Block & Mute Section */}
            <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>
              {t.block_section || (lang === 'ht' ? 'Blòk + Mòd' : 'Block & Mute')}
            </div>
            <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>
              <div className="settings-item" style={{ padding: '15px 20px', borderBottom: '1px solid var(--pink-light)' }}>
                <div onClick={() => setOpenProfileSection(openProfileSection === 'moderation' ? null : 'moderation')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-user-slash" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.blocked_users || 'Blocked users'} ({blocks.length})</span>
                  </div>
                  <i className={`fas ${openProfileSection === 'moderation' ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {openProfileSection === 'moderation' && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {blocks.length === 0 && <p style={{ fontSize: '0.78rem', color: '#888', margin: 0 }}>{t.no_blocked_users || 'No blocked users.'}</p>}
                    {blocks.map(b => (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.82rem', borderBottom: '1px solid var(--pink-light)' }}>
                        <span>{b.blocked?.username || `#${b.blocked_id || b.user_id}`}</span>
                        <button type="button" className="btn-action" onClick={() => handleUnblock(b.id)} style={{ padding: '4px 12px', fontSize: '0.7rem', borderRadius: '12px' }}>
                          {t.unblock_btn || 'Unblock'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="settings-item" style={{ padding: '15px 20px' }}>
                <div style={{ marginBottom: '10px', fontWeight: 500, fontSize: '0.85rem' }}>
                  {t.muted_users || 'Muted users'} ({mutes.length})
                </div>
                {mutes.length === 0 && <p style={{ fontSize: '0.78rem', color: '#888', margin: 0 }}>{t.no_muted_users || 'No muted users.'}</p>}
                {mutes.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.82rem' }}>
                    <span>{m.muted?.username || `#${m.muted_id || m.user_id}`}</span>
                    <button type="button" className="btn-action" onClick={() => handleUnmute(m.id)} style={{ padding: '4px 12px', fontSize: '0.7rem', borderRadius: '12px' }}>
                      {t.unmute_btn || 'Unmute'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Security & Account Section */}
        {user && (
          <>
            <div className="settings-section-title" style={{ padding: '15px 20px 10px 20px', fontSize: '0.8rem', fontWeight: 'bold', color: '#888', textTransform: 'uppercase' }}>
              {t.security_section || (lang === 'ht' ? 'Sekirite ak Kont' : 'Security & Account')}
            </div>
            <div className="settings-section" style={{ background: 'var(--white)', borderRadius: '15px', marginBottom: '25px', overflow: 'hidden' }}>

              {/* Email reveal row (kept from before) */}
              <div
                className="settings-item"
                onClick={() => setShowEmail(!showEmail)}
                style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid var(--pink-light)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <i className="fas fa-envelope" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <div>
                    <span style={{ fontWeight: 500, display: 'block' }}>{lang === 'ht' ? 'Imèl mwen' : 'My Email'}</span>
                    <span style={{ fontSize: '0.85rem', color: '#888', fontFamily: 'monospace' }}>
                      {showEmail ? user.email : '••••••••' + (user.email || '').substring((user.email || '').indexOf('@'))}
                    </span>
                  </div>
                </div>
                <i className={`fas ${showEmail ? 'fa-eye-slash' : 'fa-eye'}`} style={{ color: 'var(--pink-primary)', fontSize: '1rem' }}></i>
              </div>

              {/* Verify email row (NEW) */}
              <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: '1px solid var(--pink-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-shield-halved" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <div>
                      <span style={{ fontWeight: 500, display: 'block' }}>{t.verify_email_title || 'Verify your email'}</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: user?.profile?.email_verified ? '#00c853' : '#ff6d00' }}>
                        {user?.profile?.email_verified ? (t.verify_email_verified || 'Verified') : (t.verify_email_unverified || 'Not verified')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-auth"
                    onClick={handleSendVerifyEmail}
                    disabled={isVerifyingEmail || user?.profile?.email_verified}
                    style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '14px', background: user?.profile?.email_verified ? 'transparent' : 'var(--pink-primary)', color: user?.profile?.email_verified ? '#888' : '#fff', border: '1.5px solid ' + (user?.profile?.email_verified ? '#ddd' : 'var(--pink-primary)'), cursor: user?.profile?.email_verified ? 'default' : 'pointer' }}
                  >
                    {isVerifyingEmail ? <i className="fas fa-spinner fa-spin"></i> : (t.verify_email_resend || 'Resend')}
                  </button>
                </div>
                {!user?.profile?.email_verified && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder={t.verify_email_token_placeholder || 'Verification token (dev mode)'}
                      value={verifyEmailToken}
                      onChange={(e) => setVerifyEmailToken(e.target.value)}
                      style={{ flex: 1, padding: '8px 10px', fontSize: '0.75rem', fontFamily: 'monospace', borderRadius: '8px', border: '1px solid var(--pink-primary)', background: 'var(--pink-light)', color: 'var(--text-main)' }}
                    />
                    <button
                      type="button"
                      className="btn-auth"
                      onClick={handleConfirmVerifyEmail}
                      disabled={isVerifyingEmail}
                      style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '14px', width: 'auto' }}
                    >
                      {t.verify_email_confirm_btn || 'Confirm'}
                    </button>
                  </div>
                )}
                {!user?.profile?.email_verified && (
                  <p style={{ fontSize: '0.72rem', color: '#888', margin: 0, fontStyle: 'italic' }}>
                    {t.verify_email_banner || 'Please verify your email to unlock all features.'}
                  </p>
                )}
              </div>

              {/* Change password row (NEW) */}
              <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid var(--pink-light)' }}>
                <div
                  onClick={() => setIsChangePwdOpen(prev => !prev)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  role="button"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <i className="fas fa-key" style={{ width: '30px', height: '30px', background: 'var(--pink-light)', color: 'var(--pink-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                    <span style={{ fontWeight: 500 }}>{t.change_password_title || 'Change password'}</span>
                  </div>
                  <i className={`fas ${isChangePwdOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ color: 'var(--pink-primary)' }}></i>
                </div>
                {isChangePwdOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px', animation: 'fadeInUp 0.3s ease' }}>
                    <input
                      type="password"
                      placeholder={t.change_password_current || 'Current password'}
                      value={changePwdForm.current_password}
                      onChange={(e) => setChangePwdForm(prev => ({ ...prev, current_password: e.target.value }))}
                      className="form-control"
                      autoComplete="current-password"
                      style={{ fontSize: '0.8rem', padding: '8px 10px' }}
                    />
                    <input
                      type="password"
                      placeholder={t.change_password_new || 'New password'}
                      value={changePwdForm.new_password}
                      onChange={(e) => setChangePwdForm(prev => ({ ...prev, new_password: e.target.value }))}
                      className="form-control"
                      autoComplete="new-password"
                      style={{ fontSize: '0.8rem', padding: '8px 10px' }}
                    />
                    <input
                      type="password"
                      placeholder={t.change_password_confirm || 'Confirm new password'}
                      value={changePwdForm.confirm_new_password}
                      onChange={(e) => setChangePwdForm(prev => ({ ...prev, confirm_new_password: e.target.value }))}
                      className="form-control"
                      autoComplete="new-password"
                      style={{ fontSize: '0.8rem', padding: '8px 10px' }}
                    />
                    <button
                      type="button"
                      className="btn-action"
                      onClick={handleChangePassword}
                      disabled={isChangingPwd}
                      style={{ padding: '8px 12px', fontSize: '0.8rem', borderRadius: '14px', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isChangingPwd && <i className="fas fa-spinner fa-spin"></i>}
                      {t.change_password_submit || 'Change password'}
                    </button>
                  </div>
                )}
              </div>

              {/* Delete account row (NEW) */}
              <div className="settings-item" style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1, minWidth: '200px' }}>
                  <i className="fas fa-trash" style={{ width: '30px', height: '30px', background: 'rgba(255, 45, 85, 0.1)', color: '#ff2d55', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></i>
                  <span style={{ fontWeight: 700, color: '#ff2d55' }}>
                    {t.delete_account_btn || 'Delete my account'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-action"
                  onClick={handleDeleteAccount}
                  disabled={isDeletingAccount}
                  style={{ padding: '8px 14px', fontSize: '0.78rem', borderRadius: '14px', background: '#ff2d55', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                >
                  {isDeletingAccount && <i className="fas fa-spinner fa-spin"></i>}
                  <i className="fas fa-trash"></i>
                  {lang === 'ht' ? 'Efase' : 'Delete'}
                </button>
                <p style={{ fontSize: '0.72rem', color: '#888', margin: 0, marginTop: '4px', width: '100%', fontStyle: 'italic' }}>
                  {t.delete_account_help || 'This cannot be undone.'}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
