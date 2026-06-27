import React, { useState } from 'react';
import { authService } from '../services/api';
import { translations } from '../data/translations';

const Auth = ({ isOpen, onClose, onLoginSuccess, lang, showToast }) => {
  const t = translations[lang];
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      let response;
      if (isLogin) {
        response = await authService.login({
          username: formData.username,
          password: formData.password
        });
        showToast(lang === 'ht' ? 'Koneksyon siksè!' : 'Login successful!', 'check-circle');
      } else {
        response = await authService.signup(formData);
        showToast(lang === 'ht' ? 'Kont ou kreye ak siksè!' : 'Account created successfully!', 'user-check');
      }
      
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      onLoginSuccess(response.data.user);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || (lang === 'ht' ? 'Gen yon erè ki fèt.' : 'An error occurred.');
      setError(msg);
      showToast(msg, 'exclamation-triangle');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-modal">
      <div className="auth-card">
        <h2>{isLogin ? t.login : t.signup}</h2>
        <p>{isLogin ? t.login_soon : t.signup_soon}</p>
        
        {error && <p style={{ color: 'red', fontSize: '0.85rem' }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="text"
              className="form-control"
              placeholder={t.wizard_full_name || "Username"}
              value={formData.username}
              onChange={(e) => setFormData({...formData, username: e.target.value})}
              required
              disabled={isLoading}
            />
          </div>
          {!isLogin && (
            <div className="form-group">
              <input
                type="email"
                className="form-control"
                placeholder={t.wizard_email || "Email"}
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
                disabled={isLoading}
              />
            </div>
          )}
          <div className="form-group">
            <input
              type="password"
              className="form-control"
              placeholder="Password"
              value={formData.password}
              onChange={(e) => setFormData({...formData, password: e.target.value})}
              required
              disabled={isLoading}
            />
          </div>
          <button type="submit" className="btn-action" disabled={isLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            {isLoading && <i className="fas fa-spinner fa-spin"></i>}
            {isLogin ? t.login : t.signup}
          </button>
        </form>

        <p style={{ marginTop: '15px', fontSize: '0.85rem' }}>
          {isLogin ? (lang === 'ht' ? 'Ou pa gen kont?' : 'No account?') : (lang === 'ht' ? 'Ou gen kont deja?' : 'Already have an account?')} 
          <span 
            onClick={() => !isLoading && setIsLogin(!isLogin)} 
            style={{ color: 'var(--pink-primary)', fontWeight: 'bold', cursor: isLogin ? 'pointer' : 'default', marginLeft: '5px', opacity: isLoading ? 0.5 : 1 }}
          >
            {isLogin ? t.signup : t.login}
          </span>
        </p>
        <button onClick={onClose} disabled={isLoading} className="btn-reset" style={{ marginTop: '10px', opacity: isLoading ? 0.5 : 1 }}>Anile</button>
      </div>
    </div>
  );
};

export default Auth;
