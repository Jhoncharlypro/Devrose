import React, { useState, useEffect } from 'react';
import { enrollmentService } from '../services/api';

const Wizard = ({ isOpen, onClose, selectedCourse, lang, translations, onEnrollSuccess, showToast }) => {
  const [step, setStep] = useState(1);
  const [showPayment, setShowPayment] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    experience: 'beginner',
    goal: ''
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const t = translations[lang] || translations['ht'];

  useEffect(() => {
    if (showPayment && window.paypal) {
      const container = document.getElementById('paypal-button-container-wizard');
      if (!container) return;
      
      container.innerHTML = '';
      
      window.paypal.Buttons({
        style: {
          layout: 'vertical',
          color: 'blue',
          shape: 'rect',
          label: 'pay'
        },
        createOrder: (data, actions) => {
          return actions.order.create({
            purchase_units: [{
              amount: { value: selectedCourse?.price || '0.00' },
              description: `Enrollment: ${selectedCourse?.title}`
            }]
          });
        },
        onApprove: async (data, actions) => {
          setIsProcessing(true);
          try {
            await actions.order.capture();
            // Save enrollment to backend
            await enrollmentService.create(selectedCourse.id);
            showToast(t.enroll_success || 'Success!', 'check-circle');
            if (onEnrollSuccess) onEnrollSuccess(selectedCourse.id);
            handleClose();
          } catch (err) {
            console.error('Enrollment error:', err);
            showToast(lang === 'ht' ? 'Gen yon pwoblèm nan sistèm nan. Kontakte sipò.' : 'System error. Contact support.', 'exclamation-triangle');
          } finally {
            setIsProcessing(false);
          }
        },
        onError: (err) => {
          console.error('PayPal Error:', err);
          showToast(t.payment_error || 'Payment Error', 'exclamation-triangle');
        }
      }).render('#paypal-button-container-wizard');
    }
  }, [showPayment, selectedCourse, t]);

  if (!isOpen) return null;

  const nextStep = () => setStep(step + 1);
  const prevStep = () => setStep(step - 1);

  const handleEnroll = () => {
    setShowPayment(true);
  };

  const handleClose = () => {
    onClose();
    setStep(1);
    setShowPayment(false);
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard-card" style={{ position: 'relative' }}>
        {isProcessing && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            zIndex: 200,
            gap: '15px'
          }}>
            <i className="fas fa-spinner fa-spin" style={{ fontSize: '3rem', color: 'var(--pink-primary)' }}></i>
            <p style={{ fontWeight: 'bold' }}>{lang === 'ht' ? 'Tranzaksyon ap trete...' : 'Processing payment...'}</p>
          </div>
        )}
        <div className="wizard-header">
          <h3 style={{ margin: 0 }}>{t.wizard_title}: {selectedCourse?.title}</h3>
          <button onClick={handleClose} className="icon-btn" style={{ position: 'absolute', right: '15px', top: '15px', background: 'rgba(0,0,0,0.1)', color: 'white' }}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="wizard-body">
          <div className="wizard-progress">
            {[1, 2, 3].map(s => (
              <div key={s} className={`progress-dot ${step >= s ? 'active' : ''}`}></div>
            ))}
          </div>

          {step === 1 && (
            <div className="wizard-step active">
              <h4>{t.wizard_step1_title}</h4>
              <div className="form-group">
                <label>{t.wizard_name}</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="Jean Philippe"
                />
              </div>
              <div className="form-group">
                <label>{t.wizard_email}</label>
                <input 
                  type="email" 
                  className="form-control" 
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="jean@gmail.com"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step active">
              <h4>{t.wizard_step2_title}</h4>
              <div className="form-group">
                <label>{t.wizard_experience}</label>
                <select 
                  className="form-control"
                  value={formData.experience}
                  onChange={(e) => setFormData({...formData, experience: e.target.value})}
                >
                  <option value="beginner">{t.exp_beginner}</option>
                  <option value="intermediate">{t.exp_intermediate}</option>
                  <option value="advanced">{t.exp_advanced}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t.wizard_goal}</label>
                <textarea 
                  className="form-control" 
                  rows="3" 
                  value={formData.goal}
                  onChange={(e) => setFormData({...formData, goal: e.target.value})}
                ></textarea>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step active" style={{ textAlign: 'center' }}>
              <h4>{t.wizard_step3_title}</h4>
              {!showPayment ? (
                <>
                  <i className="fas fa-check-circle" style={{ fontSize: '3rem', color: '#2ecc71', marginBottom: '15px' }}></i>
                  <p>{t.wizard_confirm_text}</p>
                  <div style={{ background: 'var(--pink-light)', padding: '15px', borderRadius: '10px', textAlign: 'left', fontSize: '0.9rem', marginBottom: '20px', color: 'var(--text-main)' }}>
                    <p><strong>{t.wizard_name}:</strong> {formData.name}</p>
                    <p><strong>{t.wizard_email}:</strong> {formData.email}</p>
                    <p><strong>{t.tab_courses}:</strong> {selectedCourse?.title}</p>
                    <p><strong>{t.price_label}:</strong> ${selectedCourse?.price}</p>
                  </div>
                </>
              ) : (
                <div style={{ animation: 'fadeIn 0.5s' }}>
                  <p style={{ fontWeight: 'bold', color: 'var(--pink-primary)' }}>{t.payment_method}</p>
                  <div id="paypal-button-container-wizard" style={{ marginTop: '20px', minHeight: '150px' }}></div>
                  <div style={{ margin: '20px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#eee' }}></div>
                    <span style={{ color: '#888', fontSize: '0.8rem' }}>{lang === 'ht' ? 'OSWA' : 'OR'}</span>
                    <div style={{ flex: 1, height: '1px', background: '#eee' }}></div>
                  </div>
                  <a 
                    href={`https://wa.me/50931234567?text=${encodeURIComponent(`Bonjou, mwen fini enskripsyon wizard pou kou: ${selectedCourse?.title}.`)}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="btn-action"
                    style={{ background: '#25D366', color: 'white', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
                  >
                    <i className="fab fa-whatsapp"></i> {t.enroll_whatsapp}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {!showPayment && (
          <div className="wizard-footer">
            {step > 1 && (
              <button className="btn-action" onClick={prevStep} style={{ background: '#888', width: 'auto' }}>{t.wizard_prev}</button>
            )}
            {step < 3 ? (
              <button className="btn-action" onClick={nextStep} style={{ width: 'auto', marginLeft: 'auto' }}>{t.wizard_next}</button>
            ) : (
              <button className="btn-action" onClick={handleEnroll} style={{ width: 'auto', marginLeft: 'auto', background: '#27ae60' }}>{t.wizard_finish}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Wizard;
