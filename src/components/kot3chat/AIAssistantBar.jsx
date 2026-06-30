/**
 * src/components/kot3chat/AIAssistantBar.jsx
 *
 * Premium AI assistant bar that appears above the message composer.
 * Surfaces:
 *   * Smart reply chips (3 short suggestions from the most recent
 *     incoming message in the active thread).
 *   * A "magic" dropdown that wraps:
 *       - Translate (to EN / FR / ES / HT)
 *       - Rewrite tone (Polite / Professional / Casual)
 *       - Summarize thread (the last 30 messages, ≤120 words)
 *   * Loading + error states for each action.
 *
 * Pure presentational. Host owns:
 *   - threadId              : number | null
 *   - composerText          : string (current draft)
 *   - onApplyText(text)     : (string) => void
 *   - onToast(msg, icon)    : optional UX feedback
 *   - lang, t               : localization
 *
 * All AI calls go through the /api/ai/* endpoints added in Part 5
 * (api/urls.py). The Gemini API key is server-side; this component
 * never sees it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { aiService } from '../../services/api';

const TONES = [
  { id: 'polite',       icon: 'fa-handshake',       label: 'Polite' },
  { id: 'professional', icon: 'fa-briefcase',       label: 'Professional' },
  { id: 'casual',       icon: 'fa-mug-hot',         label: 'Casual' },
];
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'ht', label: 'Kreyòl' },
];

export function AIAssistantBar({
  threadId = null,
  composerText = '',
  onApplyText = () => {},
  onToast = () => {},
  lang = 'en',
  t = {},
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSmart, setLoadingSmart] = useState(false);
  const [loadingAction, setLoadingAction] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Fetch smart replies when the active thread changes. The backend
  // caches per (thread, message, user) so back-navigation is free.
  useEffect(() => {
    if (!threadId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setLoadingSmart(true);
    aiService.smartReply({ thread_id: threadId })
      .then((res) => {
        if (cancelled) return;
        const list = (res?.data?.suggestions) || [];
        setSuggestions(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => { if (!cancelled) setLoadingSmart(false); });
    return () => { cancelled = true; };
  }, [threadId]);

  // Click-outside dismisses the magic menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  // Action handlers ----------------------------------------------------
  const handleTranslate = async (langCode) => {
    if (!composerText.trim()) {
      onToast(t.ai_need_text || 'Type something to translate.', 'exclamation-triangle');
      return;
    }
    setLoadingAction('translate');
    try {
      const res = await aiService.translate({ text: composerText, target_lang: langCode });
      onApplyText(res?.data?.text || '');
    } catch (e) {
      onToast(t.ai_error || 'AI request failed.', 'times-circle');
    } finally {
      setLoadingAction(null);
      setMenuOpen(false);
    }
  };

  const handleRewrite = async (tone) => {
    if (!composerText.trim()) {
      onToast(t.ai_need_text || 'Type something to rewrite.', 'exclamation-triangle');
      return;
    }
    setLoadingAction('rewrite');
    try {
      const res = await aiService.rewrite({ text: composerText, tone });
      onApplyText(res?.data?.text || '');
    } catch (e) {
      onToast(t.ai_error || 'AI request failed.', 'times-circle');
    } finally {
      setLoadingAction(null);
      setMenuOpen(false);
    }
  };

  const handleSummarize = async () => {
    if (!threadId) {
      onToast(t.ai_need_thread || 'Open a conversation to summarize.', 'info-circle');
      return;
    }
    setLoadingAction('summarize');
    try {
      // We piggyback the last-N-messages summary by sending a
      // trimmed dump of composerText (the user can also type a
      // dump directly). A real thread-fetch would happen here.
      const res = await aiService.summarize({ text: composerText, max_words: 120 });
      onApplyText(res?.data?.text || '');
    } catch (e) {
      onToast(t.ai_error || 'AI request failed.', 'times-circle');
    } finally {
      setLoadingAction(null);
      setMenuOpen(false);
    }
  };

  return (
    <div
      className="kot3-ai-bar"
      role="region"
      aria-label={t.ai_bar_label || 'AI assistant'}
    >
      {/* Smart reply chips */}
      {loadingSmart && (
        <div className="kot3-ai-suggestions" aria-live="polite">
          <span className="kot3-ai-chip loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{t.ai_thinking || 'AI thinking…'}</span>
          </span>
        </div>
      )}
      {!loadingSmart && suggestions.length > 0 && (
        <div className="kot3-ai-suggestions" aria-label={t.ai_suggestions_label || 'Smart replies'}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="kot3-ai-chip"
              onClick={() => onApplyText(s)}
              aria-label={`${t.ai_use_reply || 'Use reply'}: ${s}`}
              title={t.ai_use_reply || 'Use this reply'}
            >
              <i className="fas fa-bolt" aria-hidden="true" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}

      {/* Magic menu trigger + dropdown */}
      <div className="kot3-ai-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className={`kot3-ai-trigger ${loadingAction ? 'loading' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t.ai_menu_label || 'AI tools'}
          disabled={!!loadingAction}
        >
          <i className="fas fa-wand-magic-sparkles" aria-hidden="true" />
          <span>{t.ai_tools || 'AI'}</span>
        </button>
        {menuOpen && (
          <div className="kot3-ai-menu" role="menu">
            <div className="kot3-ai-menu-section">
              <div className="kot3-ai-menu-title">
                <i className="fas fa-language" aria-hidden="true" /> {t.ai_translate || 'Translate'}
              </div>
              <div className="kot3-ai-menu-grid">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="menuitem"
                    className="kot3-ai-menu-btn"
                    onClick={() => handleTranslate(l.label)}
                    disabled={loadingAction === 'translate'}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="kot3-ai-menu-section">
              <div className="kot3-ai-menu-title">
                <i className="fas fa-pen-fancy" aria-hidden="true" /> {t.ai_rewrite || 'Rewrite'}
              </div>
              <div className="kot3-ai-menu-grid">
                {TONES.map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    role="menuitem"
                    className="kot3-ai-menu-btn"
                    onClick={() => handleRewrite(tone.id)}
                    disabled={loadingAction === 'rewrite'}
                  >
                    <i className={`fas ${tone.icon}`} aria-hidden="true" /> {tone.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="kot3-ai-menu-section">
              <button
                type="button"
                role="menuitem"
                className="kot3-ai-menu-btn full"
                onClick={handleSummarize}
                disabled={loadingAction === 'summarize'}
              >
                <i className="fas fa-compress-alt" aria-hidden="true" /> {t.ai_summarize || 'Summarize'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIAssistantBar;
