import React, { useState } from 'react';
import { authService, applyTokenPair, clearTokenPair, applySupabaseSession } from '../services/api';
import { translations } from '../data/translations';
import { getSupabase, isSupabaseConfigured } from '../services/supabase';

/**
 * Authentication modal — JWT-driven.
 *
 * Modes (`mode` state):
 *   * 'login'             — email + password
 *   * 'signup'            — email + password
 *   * 'forgot'            — email entry screen → triggers dev-mode reset
 *   * 'reset'             — new_password + confirm + dev_reset_token
 *
 * Token storage: `access_token` + `refresh_token` + `user` (three keys).
 * The legacy `token` key is cleaned out on successful login so we don't
 * leave any orphan DRF Token stragglers around.
 *
 * Dev-mode reset flow: /api/password/forgot/ returns the signed JWT in
 * `dev_reset_token` so we can drive the full UI without SMTP. The user
 * pastes their new password and we POST it back to
 * /api/password/reset/confirm/.
 */
const Auth = ({ isOpen, onClose, onLoginSuccess, lang, showToast }) => {
  const t = translations[lang] || {};
  const supabaseReady = isSupabaseConfigured();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot' | 'reset' | 'supabase'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetInfo, setResetInfo] = useState({ email: '', token: '', resetUrl: '' });

  // Unified form state — all modes share a single bag.
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    // ``username`` is rendered ONLY in signup mode (see the conditional
    // input below). It's optional in the wire contract: an empty string
    // falls through to the backend's auto-derive-from-email path so
    // older FE versions without this field keep working unchanged.
    username: '',
    confirmPassword: '',
    newPassword: '',
    confirmNewPassword: '',
    resetToken: '',
  });

  if (!isOpen) return null;

  // Texts the modal needs. Falls back to EN for missing strings so dev
  // locales don't crash inside the JSX.
  const T = {
    login: t.login || 'Login',
    signup: t.signup || 'Sign up',
    login_subtitle: t.login_soon || 'Log in to your account.',
    signup_subtitle: t.signup_soon || 'Create an account.',
    forgot_title: t.forgot_title || 'Forgot password',
    forgot_subtitle: t.forgot_subtitle || 'Enter your email to receive a reset link.',
    forgot_send: t.forgot_send || 'Send reset link',
    forgot_back_to_login: t.forgot_back_to_login || 'Back to login',
    reset_title: t.reset_title || 'Reset password',
    reset_subtitle: t.reset_subtitle || 'Choose a new password for your account.',
    reset_new: t.reset_new_password || 'New password',
    reset_confirm: t.reset_confirm_password || 'Confirm new password',
    reset_use_token: t.reset_use_token || 'Reset token (paste from forgot-password response)',
    reset_submit: t.reset_submit || 'Save new password',
    forgot_success: t.forgot_success || 'If the email is registered, a reset link has been issued.',
    reset_success: t.reset_success || 'Password updated. Please log in.',
    placeholder_username: t.wizard_full_name || 'Username',
    placeholder_email: t.wizard_email || 'Email',
    placeholder_password: t.password_placeholder || 'Password',
    forgot_link: t.forgot_password_link || 'Forgot password?',
    no_account: lang === 'ht' ? 'Ou pa gen kont?' : 'No account?',
    have_account: lang === 'ht' ? 'Ou gen kont deja?' : 'Already have an account?',
    cancel: t.common_cancel || 'Cancel',
    switch_to_login: t.login || 'Login',
    switch_to_signup: t.signup || 'Sign up',
  };

  // Helper to update any field in formData.
  const update = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  // Persist JWT pair + clean any legacy 'token' key from the old DRF flow.
  const persistSession = ({ access, refresh, user }) => {
    applyTokenPair({ access, refresh, user });
    try { localStorage.removeItem('token'); } catch { /* ignore */ }
  };

  /**
   * Sign in via Supabase (only callable when env is configured). Tries
   * `signInWithPassword` first; falls back to `signUp` on the standard
   * "Invalid login credentials" shape so a fresh user can self-onboard
   * from the same form without a dedicated sign-up screen.
   *
   * On success:
   *   1. Mirror the session into localStorage (so the axios interceptor
   *      ships the sb JWT on every subsequent /api/ call).
   *   2. Hit /api/me/ using that JWT — the Django JWKS verifier picks
   *      the user up (creating one on first login) and returns the
   *      canonical UserSerializer shape `{id, username, email, profile,
   *      email_verified, ...}`.
   *   3. Hand the canonical user back to App.jsx via onLoginSuccess.
   */
  const handleSupabaseSignIn = async (email, password) => {
    const client = getSupabase();
    if (!client) {
      setError(lang === 'ht' ? 'Supabase pa konfigire.' : 'Supabase is not configured.');
      return;
    }
    setError('');
    let session = null;
    let authedUser = null;

    // Prefer signInWithPassword so a returning user gets a fresh session
    // immediately. On failure, fall back to signUp — supabase-js emits
    // a "User already registered" error if the email exists, which we
    // surface verbatim. No brittle local string-matching of message
    // bodies (the previous version had an inverted boolean predicate
    // that mis-classified rate-limit / network errors as "unknown
    // user" and unwittingly triggered signUp on them).
    const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({ email, password });
    if (!signInErr && signInData?.session) {
      session = signInData.session;
      authedUser = signInData.user;
    } else {
      const { data: signUpData, error: signUpErr } = await client.auth.signUp({ email, password });
      if (signUpErr) {
        setError(signUpErr.message || (lang === 'ht' ? 'Erè nan koneksyon Supabase.' : 'Supabase sign-in failed.'));
        return;
      }
      if (!signUpData?.session) {
        // Supabase returns no session when email confirmation is required
        // by the project's Auth settings. Tell the user to click the
        // verification link rather than silently failing.
        setError(
          lang === 'ht'
            ? 'Verifye imel ou pou kontinye. (Cheche bwat resepsyon ou.)'
            : 'Please confirm your email to continue. (Check your inbox.)',
        );
        return;
      }
      session = signUpData.session;
      authedUser = signUpData.user;
    }

    if (!session) {
      setError(lang === 'ht' ? 'Sesyon Supabase vid.' : 'Empty Supabase session.');
      return;
    }

    // Mirror JUST the tokens + raw user metadata into localStorage.
    // We deliberately do NOT write the Django `user` blob here — the
    // /api/me/ call below returns the canonical UserSerializer shape
    // and we don't want a half-formed placeholder clobbering it. The
    // axios interceptor only reads `sb_access_token` for outbound
    // auth, so the missing `user` slot is harmless until getMe.
    applySupabaseSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      userMeta: authedUser?.user_metadata,
    });

    // Fetch the canonical Django-side user. The Django JwtOnlyAuthentication
    // class will JWKS-verify our sb JWT, look up or auto-create the Django
    // User, and return the canonical /api/me/ shape App.jsx expects.
    try {
      const me = await authService.getMe();
      const canonicalUser = me?.data;
      if (!canonicalUser) {
        setError(lang === 'ht' ? 'Pa kapab chache profil la.' : 'Could not load profile.');
        return;
      }
      if (showToast) showToast(lang === 'ht' ? 'Koneksyon siksè!' : 'Login successful!', 'check-circle');
      onLoginSuccess(canonicalUser);
      onClose();
    } catch (meErr) {
      // If /api/me/ failed the sb JWT may be stale. Clear the sb session
      // so a retry starts fresh — never leave a half-authenticated state.
      try { await client.auth.signOut(); } catch (_) {}
      try { localStorage.removeItem('sb_access_token'); } catch (_) {}
      setError(
        meErr?.response?.data?.error ||
        meErr?.response?.data?.detail ||
        (lang === 'ht' ? 'Sesyon an pa valab.' : 'Session is not valid.'),
      );
    }
  };

  const switchMode = (next) => {
    setError('');
    if (next === 'login' && mode !== 'login') {
      // Preserve the typed email when bouncing back from signup.
      setFormData((prev) => ({ ...prev, password: '', confirmPassword: '' }));
    }
    setMode(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (mode === 'login') {
        const { data } = await authService.login({
          username: formData.email,
          password: formData.password,
        });
        persistSession(data);
        if (showToast) showToast(lang === 'ht' ? 'Koneksyon siksè!' : 'Login successful!', 'check-circle');
        onLoginSuccess(data.user);
        onClose();
      } else if (mode === 'signup') {
        if (formData.password !== formData.confirmPassword) {
          setError(lang === 'ht' ? 'Modpas yo pa menm.' : 'Passwords do not match.');
          setIsLoading(false);
          return;
        }
        // Username is OPTIONAL end-to-end (the backend auto-derives from
        // the email local-part when the key is absent OR empty) — we only
        // sanity-check it as a courtesy when the user typed something,
        // so we don't waste a round-trip on input the Django User model
        // would reject anyway. Rule mirrors the Django default username
        // validator at the client level: 3-150 chars, alphanumerics,
        // underscore, hyphen, dot.
        const trimmedUsername = (formData.username || '').trim();
        if (trimmedUsername && !/^[A-Za-z0-9_.-]{3,150}$/.test(trimmedUsername)) {
          setError(
            lang === 'ht'
              ? 'Non itilizatè a dwe 3-150 karaktè (lèt, chif, _, -, .).'
              : 'Username must be 3-150 chars (letters, digits, _, -, .).'
          );
          setIsLoading(false);
          return;
        }
        const { data } = await authService.signup({
          email: formData.email,
          password: formData.password,
          username: trimmedUsername, // empty string → backend auto-derives
        });
        persistSession(data);
        if (showToast) showToast(lang === 'ht' ? 'Kont ou kreye ak siksè!' : 'Account created successfully!', 'user-check');
        onLoginSuccess(data.user);
        onClose();
      } else if (mode === 'forgot') {
        const email = formData.email.trim();
        if (!email) {
          setError(lang === 'ht' ? 'Antre imel ou.' : 'Please enter your email.');
          setIsLoading(false);
          return;
        }
        const { data } = await authService.forgotPassword(email);
        if (showToast) showToast(T.forgot_success, 'envelope');
        // ALSO kick off Supabase's password-reset email path when Supabase
        // is configured. Supabase sends a styled link to the user; the
        // Django `/api/password/forgot/` is the legacy dev-mode fallback.
        if (supabaseReady) {
          try {
            const sb = getSupabase();
            await sb?.auth.resetPasswordForEmail?.(email, {
              redirectTo: `${window.location.origin}/login`,
            });
          } catch (sbResetErr) {
            // Silent fallback — the user still got the dev-mode token via
            // the Django call above. We don't want to alarm operators
            // with a non-fatal parallel-reset error in dev.
            // eslint-disable-next-line no-console
            console.warn('Supabase resetPasswordForEmail failed:', sbResetErr);
          }
        }
        // Dev-mode: backend hands us the token + URL right back. We hand it
        // straight to the reset sub-screen. In a real deployment the user
        // would receive these via email.
        setResetInfo({
          email,
          token: data?.dev_reset_token || '',
          resetUrl: data?.dev_reset_url || '',
        });
        update('resetToken', data?.dev_reset_token || '');
        setMode('reset');
      } else if (mode === 'reset') {
        const { resetToken, newPassword, confirmNewPassword } = formData;
        if (newPassword !== confirmNewPassword) {
          setError(lang === 'ht' ? 'Modpas yo pa menm.' : 'Passwords do not match.');
          setIsLoading(false);
          return;
        }
        if (newPassword.length < 6) {
          setError(lang === 'ht' ? 'Modpas dwe omwen 6 karaktè.' : 'Password must be at least 6 characters.');
          setIsLoading(false);
          return;
        }
        await authService.resetPasswordConfirm(resetToken || resetInfo.token, newPassword);
        if (showToast) showToast(T.reset_success, 'check-circle');
        // Wipe any in-flight session just in case — the user must log in fresh.
        clearTokenPair();
        setMode('login');
        setFormData((prev) => ({
          ...prev,
          password: '',
          newPassword: '',
          confirmNewPassword: '',
          resetToken: '',
        }));
      } else if (mode === 'supabase') {
        const email = formData.email.trim();
        const password = formData.password;
        if (!email || !password) {
          setError(lang === 'ht' ? 'Antre imel ak modpas.' : 'Please enter email + password.');
          setIsLoading(false);
          return;
        }
        await handleSupabaseSignIn(email, password);
      }
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        (lang === 'ht' ? 'Gen yon erè ki fèt.' : 'An error occurred.');
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      if (showToast) showToast(typeof msg === 'string' ? msg : 'Error', 'exclamation-triangle');
    } finally {
      setIsLoading(false);
    }
  };

  const renderTitle = () => {
    if (mode === 'login') return T.login;
    if (mode === 'signup') return T.signup;
    if (mode === 'forgot') return T.forgot_title;
    if (mode === 'reset') return T.reset_title;
    if (mode === 'supabase') return lang === 'ht' ? 'Konekte ak Supabase' : 'Continue with Supabase';
    return '';
  };

  const renderSubtitle = () => {
    if (mode === 'login') return T.login_subtitle;
    if (mode === 'signup') return T.signup_subtitle;
    if (mode === 'forgot') return T.forgot_subtitle;
    if (mode === 'reset') return T.reset_subtitle;
    if (mode === 'supabase') return lang === 'ht'
      ? 'Itilize kont Supabase ou pou konekte.'
      : 'Use your Supabase account to sign in.';
    return '';
  };

  return (
    <div className="auth-modal">
      <div className="auth-card">
        <h2>{renderTitle()}</h2>
        <p>{renderSubtitle()}</p>

        {error && <p style={{ color: 'red', fontSize: '0.85rem' }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          {(mode === 'login' || mode === 'signup' || mode === 'supabase') && (
            <div className="form-group">
              <input
                type={(mode === 'signup' || mode === 'supabase') ? 'email' : 'text'}
                className="form-control"
                placeholder={
                  (mode === 'signup' || mode === 'supabase')
                    ? (T.placeholder_email || 'Email')
                    : (lang === 'ht' ? 'Imèl oswa Non itilizatè' : 'Email or Username')
                }
                value={formData.email}
                onChange={(e) => update('email', e.target.value)}
                required
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
          )}

          {/* Username — signup-mode-only, OPTIONAL. Visible BEFORE the
              password field so users who already typed both don't get
              surprised when they switch modes (the password-clear in
              switchMode was leaving the username behind). The backend
              treats an empty string the same as a missing key: fall back
              to auto-deriving from the email local-part. We do NOT mark
              it `required` because that contradicts the wire contract
              with the Django backend. */}
          {mode === 'signup' && (
            <div className="form-group">
              <input
                type="text"
                name="username"
                className="form-control"
                placeholder={lang === 'ht' ? 'Non itilizatè (opsyonèl)' : 'Username (optional)'}
                value={formData.username}
                onChange={(e) => update('username', e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                maxLength={150}
                style={{ fontFamily: 'inherit' }}
              />
            </div>
          )}

          {(mode === 'login' || mode === 'signup' || mode === 'supabase') && (
            <div className="form-group">
              <input
                type="password"
                className="form-control"
                placeholder={T.placeholder_password}
                value={formData.password}
                onChange={(e) => update('password', e.target.value)}
                required
                disabled={isLoading}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <input
                type="password"
                className="form-control"
                placeholder={lang === 'ht' ? 'Konfime modpas la' : 'Confirm password'}
                value={formData.confirmPassword}
                onChange={(e) => update('confirmPassword', e.target.value)}
                required
                disabled={isLoading}
                autoComplete="new-password"
              />
            </div>
          )}

          {mode === 'forgot' && (
            <div className="form-group">
              <input
                type="email"
                className="form-control"
                placeholder={T.placeholder_email}
                value={formData.email}
                onChange={(e) => update('email', e.target.value)}
                required
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
          )}

          {mode === 'reset' && (
            <>
              {resetInfo.token && (
                <div className="form-group" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <i className="fas fa-info-circle"></i>
                  <span style={{ marginLeft: 6 }}>
                    {lang === 'ht'
                      ? 'Mòd dev: rezilta a soti nan /api/password/forgot/. Nan pwodiksyon, lyen reset la ap vin nan imel.'
                      : 'Dev mode: token came back from /api/password/forgot/. In production this would arrive by email.'}
                  </span>
                </div>
              )}
              <div className="form-group">
                <input
                  type="password"
                  className="form-control"
                  placeholder={T.reset_new}
                  value={formData.newPassword}
                  onChange={(e) => update('newPassword', e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  className="form-control"
                  placeholder={T.reset_confirm}
                  value={formData.confirmNewPassword}
                  onChange={(e) => update('confirmNewPassword', e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="new-password"
                />
              </div>
              {/* Manual token paste fallback for users who test with cURL etc. */}
              <div className="form-group">
                <input
                  type="text"
                  className="form-control"
                  placeholder={T.reset_use_token}
                  value={formData.resetToken}
                  onChange={(e) => update('resetToken', e.target.value)}
                  disabled={isLoading}
                  style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            className="btn-action"
            disabled={isLoading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
          >
            {isLoading && <i className="fas fa-spinner fa-spin"></i>}
            {mode === 'login' && T.login}
            {mode === 'signup' && T.signup}
            {mode === 'forgot' && T.forgot_send}
            {mode === 'reset' && T.reset_submit}
            {mode === 'supabase' && (lang === 'ht' ? 'Konekte ak Supabase' : 'Continue with Supabase')}
          </button>
          {/* Supabase brand tag — visible only in supabase mode. We render
              a small caption below the main button so the user knows which
              IdP they're signing into. The brand name is required by
              Supabase's brand guidelines (see supabase.com/brand). */}
          {mode === 'supabase' && (
            <p style={{
              fontSize: '0.7rem', color: 'var(--text-secondary)',
              textAlign: 'center', marginTop: '8px', marginBottom: 0,
            }}>
              <i className="fas fa-shield-halved" style={{ color: '#3ecf8e', marginRight: 6 }}></i>
              Powered by Supabase
            </p>
          )}
        </form>

        {/* Mode-switching footer (only show for login/signup/forgot, not reset) */}
        {mode !== 'reset' && (
          <p style={{ marginTop: '15px', fontSize: '0.85rem' }}>
            {mode === 'login' && (
              <>
                {T.no_account}{' '}
                <span
                  onClick={() => !isLoading && switchMode('signup')}
                  style={{ color: 'var(--pink-primary)', fontWeight: 'bold', cursor: isLoading ? 'default' : 'pointer', marginLeft: '5px', opacity: isLoading ? 0.5 : 1 }}
                >
                  {T.switch_to_signup}
                </span>
              </>
            )}
            {mode === 'signup' && (
              <>
                {T.have_account}{' '}
                <span
                  onClick={() => !isLoading && switchMode('login')}
                  style={{ color: 'var(--pink-primary)', fontWeight: 'bold', cursor: isLoading ? 'default' : 'pointer', marginLeft: '5px', opacity: isLoading ? 0.5 : 1 }}
                >
                  {T.switch_to_login}
                </span>
              </>
            )}
            {mode === 'forgot' && (
              <span
                onClick={() => !isLoading && switchMode('login')}
                style={{ color: 'var(--pink-primary)', fontWeight: 'bold', cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.5 : 1 }}
              >
                {T.forgot_back_to_login}
              </span>
            )}
            {mode === 'supabase' && (
              <span
                onClick={() => !isLoading && switchMode('login')}
                style={{ color: 'var(--pink-primary)', fontWeight: 'bold', cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.5 : 1 }}
              >
                {lang === 'ht' ? 'Tounen nan koneksyon lokal' : 'Back to local login'}
              </span>
            )}
          </p>
        )}

        {/* "Continue with Supabase" affordance — only render the link when
            Supabase env vars are configured AND we're on the Django login
            screen. Tapping it switches the modal into the Supabase mode,
            reusing the same email + password fields above. */}
        {supabaseReady && mode === 'login' && (
          <p style={{ marginTop: '12px', fontSize: '0.78rem', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => !isLoading && switchMode('supabase')}
              disabled={isLoading}
              style={{
                background: 'transparent',
                border: '1.5px solid #3ecf8e',
                color: '#3ecf8e',
                padding: '6px 14px',
                borderRadius: '20px',
                fontWeight: 700,
                cursor: isLoading ? 'default' : 'pointer',
                opacity: isLoading ? 0.5 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.78rem',
              }}
            >
              <i className="fas fa-bolt"></i>
              {lang === 'ht' ? 'Konekte ak Supabase' : 'Continue with Supabase'}
            </button>
          </p>
        )}

        {/* Login-only forgot password link, between the form and the cancel btn */}
        {mode === 'login' && (
          <p style={{ marginTop: '4px', fontSize: '0.78rem' }}>
            <span
              onClick={() => !isLoading && switchMode('forgot')}
              style={{ color: 'var(--primary-color)', cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.5 : 1, textDecoration: 'underline' }}
            >
              {T.forgot_link}
            </span>
          </p>
        )}

        <button onClick={onClose} disabled={isLoading} className="btn-reset" style={{ marginTop: '10px', opacity: isLoading ? 0.5 : 1 }}>
          {T.cancel}
        </button>
      </div>
    </div>
  );
};

export default Auth;
