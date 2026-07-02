/**
 * src/components/kot3/Kot3Profile.jsx
 *
 * Kot3 Profile — focused "View-As" simulator.
 *
 * After the Privacy Space refactor, this overlay has a single,
 * focused responsibility: let the user sees how their profile looks
 * to other users (Stranger / Mutual Friend / You personas) so they
 * can verify their privacy settings BEFORE publishing them.
 *
 * All controls (profile_visibility, last_seen_visibility, contact +
 * DM toggles, identity surfaces, security, etc.) live in the new
 * consolidated Privacy Space overlay. The topbar's "Controls" button
 * below hands off to that surface.
 *
 * Visual model is unchanged: full-screen z-5000 overlay, sticky
 * persona toggle, persona-aware live preview that redacts fields
 * using the same `fieldVisibility()` helper from
 * `src/utils/profileUtils.js` (single source of truth so this view
 * matches what the backend returns to other users).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ProfilePage } from '../kot3chat/ProfilePage';
import { profileService } from '../../services/api';
import ShareModal from '../share/ShareModal';
import { fieldVisibility } from '../../utils/profileUtils';

const I18N = {
  ht: {
    title: 'Profil Kot3',
    subtitle: 'Wè kòm lòt moun wè ou — verifikasyon vi.',
    close: 'Fèmen',
    view_as: 'Wè kòm:',
    persona_stranger: 'Nenpòt moun',
    persona_friend: 'Zanmi Komen',
    persona_you: 'Ou menb',
    controls: 'Kontwòl',
    notice_back: 'Klike <Retounen> pou kite paj sa a.',
  },
  en: {
    title: 'Kot3 Profile',
    subtitle: 'See how you appear to others — verify visibility.',
    close: 'Close',
    view_as: 'View as:',
    persona_stranger: 'Stranger',
    persona_friend: 'Mutual Friend',
    persona_you: 'You',
    controls: 'Controls',
    notice_back: 'Click <Back> to leave this page.',
  },
  es: {
    title: 'Perfil Kot3',
    subtitle: 'Mira cómo apareces a los demás — verifica visibilidad.',
    close: 'Cerrar',
    view_as: 'Ver como:',
    persona_stranger: 'Cualquiera',
    persona_friend: 'Amigo en común',
    persona_you: 'Tú',
    controls: 'Controles',
    notice_back: 'Haz clic en <Volver> para salir.',
  },
  fr: {
    title: 'Profil Kot3',
    subtitle: 'Voyez comment les autres vous voient — vérifiez la visibilité.',
    close: 'Fermer',
    view_as: 'Voir comme :',
    persona_stranger: 'Inconnu',
    persona_friend: 'Ami commun',
    persona_you: 'Vous',
    controls: 'Contrôles',
    notice_back: 'Cliquez sur <Retour> pour quitter.',
  },
};

function PersonaToggle({ value, onChange, t }) {
  return (
    <div className="kot3prof-persona" role="tablist" aria-label={t.view_as}>
      <span className="kot3prof-persona-label">
        <i className="fas fa-eye" /> {t.view_as}
      </span>
      <div className="kot3prof-persona-pills">
        {[
          { id: 'stranger', icon: 'fa-user-secret', label: t.persona_stranger },
          { id: 'friend',   icon: 'fa-user-friends', label: t.persona_friend },
          { id: 'self',     icon: 'fa-user', label: t.persona_you },
        ].map(p => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={value === p.id}
            className={`kot3prof-persona-pill ${value === p.id ? 'is-active' : ''}`}
            onClick={() => onChange(p.id)}
          >
            <i className={`fas ${p.icon}`} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Kot3Profile({ lang = 'en', isOpen, onClose, onOpenPrivacy, showToast }) {
  const t = I18N[lang] || I18N.en;
  const [me, setMe] = useState(null);
  const [persona, setPersona] = useState('stranger');
  // The privacy shape mirrored locally so the live preview reacts
  // instantly when the user toggles a control in PrivacySpace even
  // though the persisted save happens there. ``getMe`` is the only
  // refetch trigger; the shape stays in sync because the backend
  // returns the same field names.
  const [privacy, setPrivacy] = useState({
    profile_visibility: 'public',
    last_seen_visibility: 'everyone',
    show_contact_info: true,
    allow_stranger_dms: true,
  });
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    profileService.getMe()
      .then((res) => {
        const data = res?.data || {};
        setMe(data);
        setPrivacy({
          profile_visibility: data.profile_visibility || 'public',
          last_seen_visibility: data.last_seen_visibility || 'everyone',
          show_contact_info: data.show_contact_info !== false,
          allow_stranger_dms: data.allow_stranger_dms !== false,
        });
        if (data.username) {
          setPublicUrl(`${window.location.origin}/u/${encodeURIComponent(data.username)}`);
        }
      })
      .catch(() => {
        try {
          const stored = JSON.parse(localStorage.getItem('user') || 'null');
          if (stored) setMe(stored);
        } catch (_) { /* ignore */ }
      });
  }, [isOpen]);

  // Re-hydrate privacy whenever the overlay re-opens so a change in
  // PrivacySpace is reflected instantly when the user comes back here.
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => {
      profileService.getMe()
        .then((res) => {
          const d = res?.data || {};
          setPrivacy({
            profile_visibility: d.profile_visibility || 'public',
            last_seen_visibility: d.last_seen_visibility || 'everyone',
            show_contact_info: d.show_contact_info !== false,
            allow_stranger_dms: d.allow_stranger_dms !== false,
          });
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, [isOpen, persona]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.body.classList.add('kot3prof-open');
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('kot3prof-open');
    };
  }, [isOpen, onClose]);

  const vis = fieldVisibility(privacy, persona);
  const isMeView = persona === 'self';

  const previewUser = useMemo(() => {
    if (!me) return null;
    const profile = me.profile || {};
    return {
      ...me,
      profile: me.profile,
      phone:   vis.phone   ? (profile.phone || me.phone || '')   : '',
      email:   vis.email   ? (profile.email || me.email || '')   : '',
      country: vis.country ? (profile.country || '') : '',
      joined_at: me.date_joined || me.joined_at || '',
      role: vis.blocked ? null : me.role,
      status_text: vis.blocked ? '' : (me.status_text || ''),
      is_online: isMeView ? !!me.is_online : (vis.last_seen ? !!me.is_online : false),
    };
  }, [me, vis, isMeView, persona]);

  if (!isOpen) return null;

  return (
    <div className="kot3prof-shell" role="dialog" aria-modal="true" aria-label={t.title}>
      <header className="kot3prof-topbar">
        <button type="button" className="kot3prof-back" onClick={onClose} aria-label={t.close}>
          <i className="fas fa-arrow-left" /> <span>{t.close}</span>
        </button>
        <div className="kot3prof-topbar-title">
          <h2>{t.title}</h2>
          <span>{t.subtitle}</span>
        </div>
        {/* "Controls" button — hands off to the Privacy Space
            overlay where the actual privacy + identity + security
            toggles live. If the opener did not pass an
            ``onOpenPrivacy`` callback we render a disabled visual
            placeholder so the topbar layout stays balanced. */}
        <button
          type="button"
          className={`kot3prof-controls-btn ${onOpenPrivacy ? '' : 'is-disabled'}`}
          onClick={() => onOpenPrivacy?.()}
          disabled={!onOpenPrivacy}
          title={t.controls}
        >
          <i className="fas fa-sliders" />
          <span>{t.controls}</span>
        </button>
        <button
          type="button"
          className="kot3prof-share-btn"
          onClick={() => setIsShareOpen(true)}
          disabled={!publicUrl}
          title={publicUrl
            ? (lang === 'ht' ? 'Pataje pwofil ou' : 'Share your profile')
            : (lang === 'ht' ? 'Ap chache URL ou...' : 'Loading your URL…')}
        >
          <i className="fas fa-share-nodes" />
        </button>
      </header>

      <div className="kot3prof-persona-wrap">
        <PersonaToggle value={persona} onChange={setPersona} t={t} />
      </div>

      <main className="kot3prof-main">
        <section className="kot3prof-preview">
          {previewUser ? (
            <>
              {persona === 'self' && (
                <div className="kot3prof-self-hint" role="status">
                  <i className="fas fa-circle-info" />
                  <span>
                    {lang === 'ht'
                      ? 'Sa a se kòm ou menb wè pwofil ou — tout enfòmasyon yo parèt.'
                      : 'This is how you see your own profile — every field is visible.'}
                  </span>
                </div>
              )}
              {persona !== 'self' && vis.blocked && (
                <div className="kot3prof-blocked-hint" role="status">
                  <i className="fas fa-lock" />
                  <span>
                    {lang === 'ht'
                      ? 'Pwofil ou prive — yo pa wè anyen.'
                      : 'Your profile is private — nothing is shown.'}
                  </span>
                </div>
              )}
              <ProfilePage
                user={previewUser}
                myUserId={me?.id}
                onMessage={() => showToast?.(lang === 'ht' ? 'Sa a se yon preview.' : 'This is a preview.', 'info-circle')}
                lang={lang}
                t={{}}
              />
            </>
          ) : (
            <div className="kot3prof-loading">
              <i className="fas fa-spinner fa-spin" />
              <span>{lang === 'ht' ? 'Ap chache done w...' : 'Loading your data…'}</span>
            </div>
          )}
        </section>
      </main>

      <footer className="kot3prof-footer">
        <span>{t.notice_back}</span>
      </footer>

      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        url={publicUrl}
        title={t.title}
        subtitle={me?.username ? `@${me.username}` : ''}
        lang={lang}
      />
    </div>
  );
}

export default Kot3Profile;
