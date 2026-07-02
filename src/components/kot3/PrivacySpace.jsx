/**
 * src/components/kot3/PrivacySpace.jsx
 *
 * Espas Konfidansyalite · Privacy Space (consolidated)
 *
 * Single, dedicated full-screen surface where every privacy-, identity-,
 * and account-control touchpoint lives. Replaces the previous scatter
 * of controls across Kot3Profile.jsx (privacy toggle panel), Settings.jsx
 * (cover photo / interests / social / country / notif / blocks / mutes /
 *  email-reveal / verify / change-pw / delete), and MyProfile.jsx (avatar /
 *  bio / username).
 *
 * Sections are tab-organized exactly like the Inventor's Atelier so the
 * visual language is unified across both z-5000 overlays:
 *
 *   1. Visibility   — profile_visibility, last_seen_visibility, contact + DM toggles
 *   2. Identity     — avatar, cover, bio, interests, social links, country, username
 *   3. Communication — notification prefs, blocked users, muted users
 *   4. Security     — email reveal / verify, change password, delete account
 *   5. Audit        — activity timeline (modeled on Kot3Profile's prior timeline)
 *
 * Autosave: every control commits to PATCH /api/profile/me/ (or the
 * related service) 700 ms after the user stops moving. Optimistic update
 * with rollback on server error + a toast.
 *
 * Side-by-side companion: the bottom-right "Preview as…" pill opens
 * ``Kot3Profile`` so the user can see EXACTLY what their changes look
 * like before committing them. That handoff keeps the simulator focused
 * on the preview concern (Stranger / Mutual Friend / You) and the
 * Privacy Space focused on the controls concern — split surfaces per
 * the design decided in the prior exploration phase.
 *
 * Backend: every field already lives on ``Profile`` (model + migrations)
 * and the existing endpoints surface them.  No schema work required.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { profileService, authService, blocksService, mutesService } from '../../services/api';
import { resizeImage, bucketRelativeTime } from '../../utils/profileUtils';

// ─── Inline 4-language i18n. Same pattern as Atelier — keeps the
//     component self-contained and avoids a round-trip through
//     src/data/translations.js for Privacy-Space-specific copy. The
//     common labels (close, save) are still sourced from there.
const PRIVACY_I18N = {
  ht: {
    title: 'Espas Konfidansyalite',
    subtitle: 'Ou dikte sa DevRose wè. Aktivite, vi, sekirite — tout nan yon sèl kote.',
    close: 'Fèmen',
    preview_as: 'Wè köm…',

    tab_visibility: 'Vizibilite',
    tab_identity:   'Idantite',
    tab_comm:       'Kominikasyon',
    tab_security:   'Sekirite',
    tab_audit:      'Aktivite',

    hero_title: 'Chanm Kontwòl Ou',
    hero_subtitle: 'Men ou kenbe kle a. Pa gen okenn paramèt ki kache.',
    hero_chip_visibility: 'Vizibilite',
    hero_chip_identity:   'Idantite',
    hero_chip_comm:       'Mesaj & Notif',
    hero_chip_security:   'Sekirite',
    hero_chip_audit:      'Odit',

    autosave: 'Oto-save',
    saved:   'Sove!',
    saving:  'Ap sove…',

    /* Visibility */
    vis_section_title: 'Ki moun ki wè ou?',
    vis_section_sub:   'Kontwole kijan lòt moun rankontre w nan DevRose.',
    vis_profile_label: 'Ki moun ki ka wè profil ou?',
    vis_profile_sub:   'Sa gouvène tout done w parèt sou Kot3 chat + Explore.',
    vis_lastseen_label:'Ki moun ki wè lè ou te aktif?',
    vis_lastseen_sub:  'Montre tan dènye koneksyon ou sou pwofil ou.',
    vis_contact_label: 'Montre enfòmasyon kontak',
    vis_contact_sub:   'Imèl + telefòn nan paj About ou. Lòt moun toujou wè non ou.',
    vis_dms_label:     'Aksepte mesaj nan men etranje',
    vis_dms_sub:       'Moun ki pa zanmi ou ka voye mesaj ba ou.',
    vis_opt_public:   'Piblik',
    vis_opt_friends:  'Zanmi sèlman',
    vis_opt_private:  'Prive',
    vis_opt_everyone: 'Tout moun',
    vis_opt_nobody:   'Pèsonn',
    vis_now_public:   'Kounye a: Piblik',
    vis_now_friends:  'Kounye a: Zanmi sèlman',
    vis_now_private:  'Kounye a: Prive',

    /* Identity */
    id_section_title: 'Sa ou parèt lòt moun',
    id_section_sub:   'Foto, deskripsyon, peyi — tout sa ou montre piblikman.',
    id_avatar_label:  'Foto pwofil',
    id_avatar_sub:    'Rezize a 400×400 otomatikman.',
    id_cover_label:   'Foto kouvèti',
    id_cover_sub:     'Rezize a 1200×400 — bann laj sou foto pwofil ou.',
    id_username_label:'Non itilizatè',
    id_username_sub:  'You can change your username from Settings → Account.',
    id_bio_label:     'Bio',
    id_bio_sub:       'Maksimòm 500 karaktè.',
    id_interests_label:'Enterè',
    id_interests_sub: 'Maksimòm 10 tags — piblik yo wè sa ou renmen.',
    id_interests_add: 'Ajoute',
    id_social_label:  'Lyans sosyal',
    id_social_sub:    'Yon lyans pa rezo. URL dwe kòmanse ak http(s)://',
    id_country_label: 'Peyi',
    id_country_select:'Chwazi peyi ou',

    /* Communication */
    comm_section_title: 'Mesaj & Notifikasyon',
    comm_section_sub:   'Triye ki mesaj rive jwenn ou, ki moun, kilè.',
    comm_notif_sound:     'Son lè yon mesaj rive',
    comm_notif_desktop:   'Notif sou Desktop',
    comm_notif_email:     'Notif pa imèl',
    comm_notif_preview:   'Montre aperçu mesaj la',
    comm_blocks_title:    'Moun ou bloke',
    comm_blocks_sub:      'Yo pa ka voye w mesaj ni wè pwofil ou.',
    comm_mutes_title:     'Moun ou mete nan mòd silans',
    comm_mutes_sub:       'Mesaj yo pa notifye w, men ou toujou wè yo.',
    comm_unblock: 'Debloke',
    comm_unmute:  'Retire silans',
    comm_empty:  'Anyen pou montre.',

    /* Security */
    sec_section_title: 'Sekirite kont',
    sec_section_sub:   'Imèl, modpas, aksè — bagay ki pwoteje idantite ou.',
    sec_email_label:   'Adrès imèl ou',
    sec_email_show:    'Montre imèl',
    sec_email_hide:    'Kache imèl',
    sec_verify_title:  'Verifye imèl ou',
    sec_verify_sub:    'Verifye imèl ouvri plis opsyon (badge, recovery).',
    sec_verified:      'Verifye',
    sec_not_verified:  'Pa verifye',
    sec_resend:        'Re Voye',
    sec_confirm:       'Konfime',
    sec_token_ph:      'Token (dev mode)',
    sec_pwd_change:    'Chanje modpas',
    sec_pwd_current:   'Modpas aktyèl',
    sec_pwd_new:       'Nouvo modpas',
    sec_pwd_confirm:   'Konfime nouvo modpas',
    sec_pwd_submit:    'Chanje modpas',
    sec_delete_title:  'Efase kont mwen',
    sec_delete_sub:    'Aksyon sa pa ka defèt.',
    sec_delete_btn:    'Efase kont',
    sec_delete_prompt: 'Tape DELETE pou konfime:',

    /* Audit */
    audit_title:      'Aktivite sou pwofil ou',
    audit_subtitle:   'Dènye 50 evènman sou kont ou — vizibilite, kontak, apèsi.',
    audit_empty:      'Pa gen okenn aktivite ankò.',
    /* In-pane navigation (chip strip at the bottom of the scroll panel) */
    nav_prev:       'Anvan',
    nav_next:       'Apre',
    nav_pane_label: 'Navigasyon espas',
    audit_labels: {
      visibility_change: 'Konfidansyalite chanje',
      contact_toggle:    'Vizibilite enfòmasyon',
      dms_toggle:        'DM etranje',
      profile_view:      'Pwofil gade',
      profile_update:    'Pwofil mete ajou',
    },
  },
  en: {
    title: 'Privacy Space',
    subtitle: 'You dictate what DevRose sees. Presence, identity, security — all in one place.',
    close: 'Close',
    preview_as: 'Preview as…',

    tab_visibility: 'Visibility',
    tab_identity:   'Identity',
    tab_comm:       'Communication',
    tab_security:   'Security',
    tab_audit:      'Activity',

    hero_title: 'Your Control Room',
    hero_subtitle: 'You hold the keys. No setting is hidden anywhere else.',
    hero_chip_visibility: 'Visibility',
    hero_chip_identity:   'Identity',
    hero_chip_comm:       'Messages & Notif',
    hero_chip_security:   'Security',
    hero_chip_audit:      'Activity',

    autosave: 'Autosave',
    saved:   'Saved!',
    saving:  'Saving…',

    /* Visibility */
    vis_section_title: 'Who can see you?',
    vis_section_sub:   'Control how others encounter you across DevRose.',
    vis_profile_label: 'Who can see your profile?',
    vis_profile_sub:   'This governs every Kot3 chat + Explore surface your data appears on.',
    vis_lastseen_label:'Who can see your last seen?',
    vis_lastseen_sub:  'Reveals the most-recent activity timestamp on your profile.',
    vis_contact_label: 'Show contact information',
    vis_contact_sub:   'Email + phone on your About tab. Your username is always public.',
    vis_dms_label:     'Accept messages from strangers',
    vis_dms_sub:       'Non-mutuals can send you messages in Kot3 Chat.',
    vis_opt_public:    'Public',
    vis_opt_friends:   'Friends only',
    vis_opt_private:   'Private',
    vis_opt_everyone:  'Everyone',
    vis_opt_nobody:    'Nobody',
    vis_now_public:    'Currently: Public',
    vis_now_friends:   'Currently: Friends only',
    vis_now_private:   'Currently: Private',

    /* Identity */
    id_section_title: 'How you appear to others',
    id_section_sub:   'Avatar, bio, country — the data you put on display.',
    id_avatar_label:  'Profile photo',
    id_avatar_sub:    'Resized to 400×400 automatically.',
    id_cover_label:   'Cover photo',
    id_cover_sub:     'Resized to 1200×400 — the wide banner above your avatar.',
    id_username_label:'Username',
    id_username_sub:  'You can change this from Settings → Account.',
    id_bio_label:     'Bio',
    id_bio_sub:       'Up to 500 characters.',
    id_interests_label:'Interests',
    id_interests_sub: 'Up to 10 tags — they are public.',
    id_interests_add: 'Add',
    id_social_label:  'Social links',
    id_social_sub:    'One URL per platform. Must start with http(s)://',
    id_country_label: 'Country',
    id_country_select:'Select your country',

    /* Communication */
    comm_section_title: 'Messages & Notifications',
    comm_section_sub:   'Sort what reaches you, who, and when.',
    comm_notif_sound:     'Sound on new message',
    comm_notif_desktop:   'Desktop notifications',
    comm_notif_email:     'Email notifications',
    comm_notif_preview:   'Show message preview',
    comm_blocks_title:    'Users you have blocked',
    comm_blocks_sub:      'They can\'t DM you or see your profile.',
    comm_mutes_title:     'Users you have muted',
    comm_mutes_sub:       'They\'re silenced — messages still arrive.',
    comm_unblock: 'Unblock',
    comm_unmute:  'Unmute',
    comm_empty:   'Nothing here yet.',

    /* Security */
    sec_section_title: 'Account security',
    sec_section_sub:   'Email, password, access — what protects your identity.',
    sec_email_label:   'Email address',
    sec_email_show:    'Show email',
    sec_email_hide:    'Hide email',
    sec_verify_title:  'Verify your email',
    sec_verify_sub:    'Verifying unlocks extra features (badge, account recovery).',
    sec_verified:      'Verified',
    sec_not_verified:  'Not verified',
    sec_resend:        'Resend',
    sec_confirm:       'Confirm',
    sec_token_ph:      'Token (dev mode)',
    sec_pwd_change:    'Change password',
    sec_pwd_current:   'Current password',
    sec_pwd_new:       'New password',
    sec_pwd_confirm:   'Confirm new password',
    sec_pwd_submit:    'Change password',
    sec_delete_title:  'Delete my account',
    sec_delete_sub:    'This cannot be undone.',
    sec_delete_btn:    'Delete account',
    sec_delete_prompt: 'Type DELETE to confirm:',

    /* Audit */
    audit_title:    'Activity on your profile',
    audit_subtitle: 'Your last 50 profile events — visibility, contact, views.',
    audit_empty:    'No activity yet.',
    /* In-pane navigation (chip strip at the bottom of the scroll panel) */
    nav_prev:       'Previous',
    nav_next:       'Next',
    nav_pane_label: 'Pane navigation',
    audit_labels: {
      visibility_change: 'Privacy changed',
      contact_toggle:    'Contact visibility',
      dms_toggle:        'Stranger DMs',
      profile_view:      'Profile viewed',
      profile_update:    'Profile updated',
    },
  },
  es: {
    title: 'Espacio de Privacidad',
    subtitle: 'Tú decides qué ve DevRose. Presencia, identidad, seguridad — todo en un lugar.',
    close: 'Cerrar',
    preview_as: 'Ver como…',
    tab_visibility: 'Visibilidad',
    tab_identity:   'Identidad',
    tab_comm:       'Comunicación',
    tab_security:   'Seguridad',
    tab_audit:      'Actividad',
    hero_title: 'Tu Sala de Control',
    hero_subtitle: 'Tienes las llaves. Ningún ajuste está escondido.',
    hero_chip_visibility: 'Visibilidad',
    hero_chip_identity:   'Identidad',
    hero_chip_comm:       'Mensajes y Notif',
    hero_chip_security:   'Seguridad',
    hero_chip_audit:      'Actividad',
    autosave: 'Auto-guardado',
    saved:   '¡Guardado!',
    saving:  'Guardando…',
    vis_section_title: '¿Quién puede verte?',
    vis_section_sub:   'Controla cómo te descubren en DevRose.',
    vis_profile_label: '¿Quién puede ver tu perfil?',
    vis_profile_sub:   'Controla todos los datos que muestras en Kot3 chat y Explore.',
    vis_lastseen_label:'¿Quién puede ver tu última conexión?',
    vis_lastseen_sub:  'Muestra tu última hora de actividad en tu perfil.',
    vis_contact_label: 'Mostrar información de contacto',
    vis_contact_sub:   'Correo y teléfono en tu pestaña About. Tu usuario siempre es público.',
    vis_dms_label:     'Aceptar mensajes de desconocidos',
    vis_dms_sub:       'Usuarios sin amigos mutuos pueden escribirte en Kot3 Chat.',
    vis_opt_public:    'Público',
    vis_opt_friends:   'Solo amigos',
    vis_opt_private:   'Privado',
    vis_opt_everyone:  'Todos',
    vis_opt_nobody:    'Nadie',
    vis_now_public:    'Actualmente: Público',
    vis_now_friends:   'Actualmente: Solo amigos',
    vis_now_private:   'Actualmente: Privado',
    id_section_title: 'Cómo apareces ante otros',
    id_section_sub:   'Avatar, bio, país — los datos que muestras.',
    id_avatar_label:  'Foto de perfil',
    id_avatar_sub:    'Se redimensiona a 400×400.',
    id_cover_label:   'Foto de portada',
    id_cover_sub:     'Se redimensiona a 1200×400.',
    id_username_label:'Nombre de usuario',
    id_username_sub:  'Puedes cambiarlo desde Settings → Account.',
    id_bio_label:     'Bio',
    id_bio_sub:       'Hasta 500 caracteres.',
    id_interests_label:'Intereses',
    id_interests_sub: 'Hasta 10 etiquetas — son públicas.',
    id_interests_add: 'Añadir',
    id_social_label:  'Redes sociales',
    id_social_sub:    'Una URL por plataforma. Debe empezar con http(s)://',
    id_country_label: 'País',
    id_country_select:'Selecciona tu país',
    comm_section_title: 'Mensajes y notificaciones',
    comm_section_sub:   'Filtra lo que te llega.',
    comm_notif_sound:     'Sonido en mensaje nuevo',
    comm_notif_desktop:   'Notificaciones de escritorio',
    comm_notif_email:     'Notificaciones por correo',
    comm_notif_preview:   'Mostrar vista previa del mensaje',
    comm_blocks_title:    'Usuarios bloqueados',
    comm_blocks_sub:      'No pueden escribirte ni ver tu perfil.',
    comm_mutes_title:     'Usuarios silenciados',
    comm_mutes_sub:       'Sus mensajes llegan pero sin notificación.',
    comm_unblock: 'Desbloquear',
    comm_unmute:  'Quitar silencio',
    comm_empty:   'Nada aquí todavía.',
    sec_section_title: 'Seguridad de la cuenta',
    sec_section_sub:   'Correo, contraseña, acceso.',
    sec_email_label:   'Correo electrónico',
    sec_email_show:    'Mostrar correo',
    sec_email_hide:    'Ocultar correo',
    sec_verify_title:  'Verifica tu correo',
    sec_verify_sub:    'Verificar desbloquea funciones extra.',
    sec_verified:      'Verificado',
    sec_not_verified:  'No verificado',
    sec_resend:        'Reenviar',
    sec_confirm:       'Confirmar',
    sec_token_ph:      'Token (dev)',
    sec_pwd_change:    'Cambiar contraseña',
    sec_pwd_current:   'Contraseña actual',
    sec_pwd_new:       'Nueva contraseña',
    sec_pwd_confirm:   'Confirmar nueva contraseña',
    sec_pwd_submit:    'Cambiar contraseña',
    sec_delete_title:  'Eliminar mi cuenta',
    sec_delete_sub:    'Esto no se puede deshacer.',
    sec_delete_btn:    'Eliminar cuenta',
    sec_delete_prompt: 'Escribe DELETE para confirmar:',
    audit_title:    'Actividad en tu perfil',
    audit_subtitle: 'Tus últimos 50 eventos de perfil.',
    audit_empty:    'Sin actividad aún.',
    /* In-pane navigation (chip strip at the bottom of the scroll panel) */
    nav_prev:       'Anterior',
    nav_next:       'Siguiente',
    nav_pane_label: 'Navegación del panel',
    audit_labels: {
      visibility_change: 'Privacidad cambiada',
      contact_toggle:    'Visibilidad del contacto',
      dms_toggle:        'DMs desconocidos',
      profile_view:      'Perfil visto',
      profile_update:    'Perfil actualizado',
    },
  },
  fr: {
    title: 'Espace Confidentialité',
    subtitle: 'Vous dictez ce que DevRose voit. Présence, identité, sécurité — tout au même endroit.',
    close: 'Fermer',
    preview_as: 'Voir comme…',
    tab_visibility: 'Visibilité',
    tab_identity:   'Identité',
    tab_comm:       'Communication',
    tab_security:   'Sécurité',
    tab_audit:      'Activité',
    hero_title: 'Votre Salle de Contrôle',
    hero_subtitle: 'Vous tenez les clés. Aucun réglage n\'est caché ailleurs.',
    hero_chip_visibility: 'Visibilité',
    hero_chip_identity:   'Identité',
    hero_chip_comm:       'Messages & Notif',
    hero_chip_security:   'Sécurité',
    hero_chip_audit:      'Activité',
    autosave: 'Auto-save',
    saved:   'Enregistré !',
    saving:  'Enregistrement…',
    vis_section_title: 'Qui peut vous voir ?',
    vis_section_sub:   'Contrôlez comment les autres vous découvrent.',
    vis_profile_label: 'Qui peut voir votre profil ?',
    vis_profile_sub:   'Contrôle toutes les données sur Kot3 chat + Explore.',
    vis_lastseen_label:'Qui peut voir votre dernière connexion ?',
    vis_lastseen_sub:  'Affiche l\'horodatage de votre dernière activité.',
    vis_contact_label: 'Afficher les coordonnées',
    vis_contact_sub:   'Email + téléphone dans l\'onglet About. Votre nom est public.',
    vis_dms_label:     'Accepter les messages d\'inconnus',
    vis_dms_sub:       'Les non-mutuels peuvent vous écrire dans Kot3 Chat.',
    vis_opt_public:    'Public',
    vis_opt_friends:   'Amis seulement',
    vis_opt_private:   'Privé',
    vis_opt_everyone:  'Tout le monde',
    vis_opt_nobody:    'Personne',
    vis_now_public:    'Actuellement : Public',
    vis_now_friends:   'Actuellement : Amis seulement',
    vis_now_private:   'Actuellement : Privé',
    id_section_title: 'Comment vous apparaissez aux autres',
    id_section_sub:   'Avatar, bio, pays.',
    id_avatar_label:  'Photo de profil',
    id_avatar_sub:    'Redimensionnée à 400×400.',
    id_cover_label:   'Photo de couverture',
    id_cover_sub:     'Redimensionnée à 1200×400.',
    id_username_label:'Nom d\'utilisateur',
    id_username_sub:  'Modifiable depuis Settings → Account.',
    id_bio_label:     'Bio',
    id_bio_sub:       'Jusqu\'à 500 caractères.',
    id_interests_label:'Centres d\'intérêt',
    id_interests_sub: 'Jusqu\'à 10 tags.',
    id_interests_add: 'Ajouter',
    id_social_label:  'Réseaux sociaux',
    id_social_sub:    'Une URL par plateforme. Doit commencer par http(s)://',
    id_country_label: 'Pays',
    id_country_select:'Sélectionnez votre pays',
    comm_section_title: 'Messages & notifications',
    comm_section_sub:   'Triez ce qui vous atteint.',
    comm_notif_sound:     'Son sur nouveau message',
    comm_notif_desktop:   'Notifications bureau',
    comm_notif_email:     'Notifications email',
    comm_notif_preview:   'Aperçu du message',
    comm_blocks_title:    'Utilisateurs bloqués',
    comm_blocks_sub:      'Ils ne peuvent pas vous écrire ni voir votre profil.',
    comm_mutes_title:     'Utilisateurs en sourdine',
    comm_mutes_sub:       'Silencieux — les messages arrivent quand même.',
    comm_unblock: 'Débloquer',
    comm_unmute:  'Retirer la sourdine',
    comm_empty:   'Rien ici pour l\'instant.',
    sec_section_title: 'Sécurité du compte',
    sec_section_sub:   'Email, mot de passe, accès.',
    sec_email_label:   'Adresse email',
    sec_email_show:    'Afficher',
    sec_email_hide:    'Masquer',
    sec_verify_title:  'Vérifiez votre email',
    sec_verify_sub:    'Vérifier débloque des fonctions.',
    sec_verified:      'Vérifié',
    sec_not_verified:  'Non vérifié',
    sec_resend:        'Renvoyer',
    sec_confirm:       'Confirmer',
    sec_token_ph:      'Token (dev)',
    sec_pwd_change:    'Changer le mot de passe',
    sec_pwd_current:   'Mot de passe actuel',
    sec_pwd_new:       'Nouveau mot de passe',
    sec_pwd_confirm:   'Confirmer',
    sec_pwd_submit:    'Changer',
    sec_delete_title:  'Supprimer mon compte',
    sec_delete_sub:    'Irréversible.',
    sec_delete_btn:    'Supprimer',
    sec_delete_prompt: 'Tapez DELETE pour confirmer :',
    audit_title:    'Activité sur votre profil',
    audit_subtitle: 'Vos 50 derniers événements.',
    audit_empty:    'Pas encore d\'activité.',
    /* In-pane navigation (chip strip at the bottom of the scroll panel) */
    nav_prev:       'Précédent',
    nav_next:       'Suivant',
    nav_pane_label: 'Navigation du panneau',
    audit_labels: {
      visibility_change: 'Confidentialité changée',
      contact_toggle:    'Visibilité du contact',
      dms_toggle:        'DMs inconnus',
      profile_view:      'Profil consulté',
      profile_update:    'Profil mis à jour',
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────

// Hook back to callers (Settings, MyProfile) is via onAuthOpen. We can
// also surface an explicit "sign out" hook for tab deltas if needed.

// Debounce hook — used to coalesce rapid keystrokes on the bio textarea
// into a single PATCH.
function useDebouncedEffect(fn, deps, delay = 700) {
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Privacy status pill — shows "Currently: Public" / "Currently: Private"
// so users know the current persisted state, not just what they last
// edited. Computed from the saved `privacy` state, mirrored in tabs.
function StatusPill({ kind, lang }) {
  const map = {
    public:  { color: '#22c55e', dot: '🟢' },
    friends: { color: '#f59e0b', dot: '🟡' },
    private: { color: '#ef4444', dot: '🔴' },
  };
  const cfg = map[kind] || map.public;
  return (
    <span className="privacy-status-pill" style={{ '--pill-color': cfg.color }}>
      <span className="privacy-status-dot" aria-hidden="true">{cfg.dot}</span>
      <span>{lang === 'fr' ? `Actuellement : ${kind}` : `Currently: ${kind}`}</span>
    </span>
  );
}

// ─── SHELL ──────────────────────────────────────────────────────
export function PrivacySpace({ lang = 'en', isOpen, onClose, onPreviewAs, onAuthOpen, showToast, onProfileUpdate, onLogout }) {
  const t = PRIVACY_I18N[lang] || PRIVACY_I18N.en;

  // Hydrated state. lifecycle: mount → hydrate from /api/profile/me/ →
  // fill defaults if missing → render.
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('visibility');
  const [pending, setPending] = useState(null);     // editing state
  const [committed, setCommitted] = useState(null); // last-saved state
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [countries, setCountries] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [showEmail, setShowEmail] = useState(false);
  const [verifyEmailToken, setVerifyEmailToken] = useState('');
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [isChangePwdOpen, setIsChangePwdOpen] = useState(false);
  const [changePwdForm, setChangePwdForm] = useState({ current: '', next: '', confirm: '' });
  const [isChangingPwd, setIsChangingPwd] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [newInterest, setNewInterest] = useState('');

  // Body scroll-lock + Esc + focus management.
  //
  // Esc closes. We add ``privacy-open`` (a SEPARATE body class from
  // ``atelier-open``) so two overlays can never accidentally remove
  // each other's lock if the user opens Atelier from inside Privacy
  // Space, or vice-versa.
  //
  // Focus: on open we steal focus to the dialog container so screen
  // readers announce the title + so keyboard users don't have to tab
  // through the page behind. On unmount we hand focus back to whatever
  // element launched the overlay (caller passes ``triggerRef``).
  const dialogRef = React.useRef(null);
  const lastFocusRef = React.useRef(null);
  const mainScrollRef = React.useRef(null);
  useEffect(() => {
    if (!isOpen) return;
    lastFocusRef.current = document.activeElement;
    document.body.classList.add('privacy-open');
    // Defer so the dialog node has rendered before we focus it.
    const focusTimer = setTimeout(() => {
      try { dialogRef.current?.focus({ preventScroll: false }); } catch (_) { /* ignore */ }
    }, 0);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusTimer);
      document.body.classList.remove('privacy-open');
      window.removeEventListener('keydown', onKey);
      // Return focus to the trigger so keyboard users land where they were.
      try {
        const f = lastFocusRef.current;
        if (f && typeof f.focus === 'function') f.focus({ preventScroll: true });
      } catch (_) { /* ignore */ }
    };
  }, [isOpen, onClose]);

  // Hydrate on open.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setSaveState('idle');
    profileService.getMe()
      .then((res) => {
        if (!alive) return;
        const u = res?.data || {};
        const p = u.profile || {};
        const shape = {
          profile_visibility:   p.profile_visibility || 'public',
          last_seen_visibility: p.last_seen_visibility || 'everyone',
          show_contact_info:    p.show_contact_info !== false,
          allow_stranger_dms:   p.allow_stranger_dms !== false,
          bio:                  p.bio || '',
          interests:            p.interests || [],
          social_links:         p.social_links || {},
          country:              p.country || '',
          notification_prefs:   p.notification_prefs || {},
          avatar:               p.avatar || '',
          cover_photo:          p.cover_photo || '',
          email_verified:       !!p.email_verified,
          username:             u.username || '',
          email:                u.email || '',
        };
        setMe(u);
        setPending(shape);
        setCommitted(shape);
      })
      .catch(() => {});
    profileService.getCountries().then(r => setCountries(r.data || [])).catch(() => setCountries([]));
    blocksService.list().then(r => setBlocks(r.data || [])).catch(() => setBlocks([]));
    mutesService.list().then(r => setMutes(r.data || [])).catch(() => setMutes([]));
    profileService.getActivity().then(r => setActivityLogs(Array.isArray(r?.data) ? r.data : [])).catch(() => setActivityLogs([]));
    return () => { alive = false; };
  }, [isOpen]);

  // ── Autosave: when pending diverges from committed on any tracked
  //    field, PATCH the deltas. We compare shallow JSONs so an
  //    interest-tag add is detected without needing per-field
  //    tracking.
  useDebouncedEffect(() => {
    if (!pending || !committed) return;
    if (JSON.stringify(pending) === JSON.stringify(committed)) {
      setSaveState('idle');
      return;
    }
    const delta = {};
    for (const k of Object.keys(pending)) {
      if (JSON.stringify(pending[k]) !== JSON.stringify(committed[k])) {
        delta[k] = pending[k];
      }
    }
    if (Object.keys(delta).length === 0) return;
    setSaveState('saving');
    // Capture the EXACT snapshot we attempted to write so rollback on
    // error can restore that snapshot instead of the previous
    // ``committed`` (which the user may have further mutated while the
    // request was in-flight — a real race for fast typing on the bio
    // textarea + the 700 ms autosave debounce).
    const sentSnapshot = pending;
    profileService.updateMe(delta)
      .then(() => {
        // Only advance ``committed`` to the snapshot we SENT (not
        // necessarily to ``pending`` — the user may have typed more
        // since). The next autosave tick will detect any new delta
        // and emit a fresh PATCH so we don't lose the in-flight edits.
        setCommitted(sentSnapshot);
        setSaveState('saved');
        if (onProfileUpdate) onProfileUpdate();
        // Reset 'saved' badge after a moment so the indicator animates.
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
      })
      .catch((err) => {
        // Roll back the keys we actually sent to the value they HELD
        // AT SEND TIME (``sentSnapshot``). Doing this instead of
        // rolling back to ``committed`` means any newer edits the
        // user typed during the in-flight window are PRESERVED for
        // keys OTHER than the failing one. The user still loses edits
        // on the failing key itself — that's the standard autosave
        // rollback trade-off; the 700 ms debounce keeps that window
        // small and the error toast tells them to retry.
        setSaveState('idle');
        setPending((cur) => {
          if (!cur) return cur;
          const next = { ...cur };
          for (const k of Object.keys(delta)) {
            // ``sentSnapshot`` is the value at send time, fall back
            // to an empty string only if the shape is missing entirely
            // (shouldn't happen in practice — pending is always
            // initialised before autosave can fire).
            next[k] = sentSnapshot && Object.prototype.hasOwnProperty.call(sentSnapshot, k)
              ? sentSnapshot[k]
              : '';
          }
          return next;
        });
        // Parenthesize the language fallback explicitly — without the
        // parens the ternary precedence bites and we mis-route French
        // callers to the Haitian Creole copy.
        const fallback =
          lang === 'ht' ? 'Erè nan sove.' :
          lang === 'fr' ? 'Échec de la sauvegarde.' :
          lang === 'es' ? 'Error al guardar.' :
          'Save failed.';
        const serverMsg = err?.response?.data?.error || fallback;
        if (showToast) showToast(serverMsg, 'exclamation-triangle');
      });
  }, [pending, committed, showToast, onProfileUpdate, lang], 700);

  // ── Update one field (and queue autosave).
  const patch = (key, value) => {
    setPending((p) => ({ ...p, [key]: value }));
    if (window.playSynthSound) window.playSynthSound?.('toggle', true);
  };

  // ── Avatar / cover photo upload.
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (showToast) showToast(lang === 'ht' ? 'Foto a twò gwo.' : 'Photo too large.', 'exclamation-triangle');
      return;
    }
    try {
      const base64 = await resizeImage(file, 400, 400, 0.8);
      patch('avatar', base64);
      if (showToast) showToast(lang === 'ht' ? 'Foto parèt...' : 'Photo staging…', 'camera');
    } catch (err) {
      if (showToast) showToast('Image error.', 'exclamation-triangle');
    } finally {
      e.target.value = '';
    }
  };

  const handleCoverChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (showToast) showToast(lang === 'ht' ? 'Foto a twò gwo.' : 'Photo too large.', 'exclamation-triangle');
      return;
    }
    try {
      const base64 = await resizeImage(file, 1200, 400, 0.85);
      patch('cover_photo', base64);
      if (showToast) showToast(lang === 'ht' ? 'Kouvèti parèt...' : 'Cover staging…', 'image');
    } catch (err) {
      if (showToast) showToast('Image error.', 'exclamation-triangle');
    } finally {
      e.target.value = '';
    }
  };

  // ── Interests mutate (optimistic) → queued autosave.
  const addInterest = () => {
    const tag = newInterest.trim().toLowerCase();
    if (!tag) return;
    if ((pending?.interests || []).includes(tag)) { setNewInterest(''); return; }
    if ((pending?.interests || []).length >= 10) {
      if (showToast) showToast(lang === 'ht' ? 'Maksimòm 10.' : 'Maximum 10.', 'exclamation-triangle');
      return;
    }
    patch('interests', [...(pending.interests || []), tag.slice(0, 30)]);
    setNewInterest('');
  };
  const removeInterest = (tag) => {
    patch('interests', (pending.interests || []).filter(t => t !== tag));
  };

  // ── Social links.
  const saveSocial = (platform, value) => {
    const next = { ...(pending.social_links || {}) };
    if (!value) delete next[platform];
    else next[platform] = value;
    patch('social_links', next);
  };

  // ── Notification prefs.
  const toggleNotif = (key) => {
    const cur = { ...(pending.notification_prefs || {}) };
    cur[key] = !cur[key];
    patch('notification_prefs', cur);
  };

  // ── Block / mute actions.
  const unblock = async (id) => {
    try {
      await blocksService.remove(id);
      setBlocks(blocks.filter(b => b.id !== id));
      if (showToast) showToast(t.comm_unblock + '!', 'check-circle');
    } catch (err) {
      if (showToast) showToast(err?.response?.data?.error || 'Error', 'exclamation-triangle');
    }
  };
  const unmute = async (id) => {
    try {
      await mutesService.remove(id);
      setMutes(mutes.filter(m => m.id !== id));
      if (showToast) showToast(t.comm_unmute + '!', 'check-circle');
    } catch (err) {
      if (showToast) showToast(err?.response?.data?.error || 'Error', 'exclamation-triangle');
    }
  };

  // ── Security: verify + change pwd + delete.
  const handleSendVerify = async () => {
    setIsVerifyingEmail(true);
    try {
      const { data } = await authService.sendEmailVerification();
      if (data?.dev_verify_token) setVerifyEmailToken(String(data.dev_verify_token));
      if (showToast) showToast(lang === 'ht' ? 'Imèl voye.' : 'Verification email sent.', 'envelope');
    } catch (err) {
      if (showToast) showToast(err?.response?.data?.error || 'Error', 'exclamation-triangle');
    } finally {
      setIsVerifyingEmail(false);
    }
  };
  const handleConfirmVerify = async () => {
    if (!verifyEmailToken.trim()) return;
    setIsVerifyingEmail(true);
    try {
      await authService.confirmEmailVerification(verifyEmailToken.trim());
      // The BE writes ``Profile.email_verified = True`` server-side;
      // we re-fetch the canonical user shape (which now includes
      // ``email_verified`` read-only) and merge the flag into BOTH
      // ``pending`` AND ``committed`` — otherwise the autosave will
      // detect a delta and try to PATCH the read-only field, which
      // the serializer silently drops (wasted network call but no
      // infinite loop). Keeping ``committed`` in sync means the
      // debounce effect stays idle after verify.
      setVerifyEmailToken('');
      const fresh = await profileService.getMe();
      const verified = !!fresh?.data?.profile?.email_verified;
      setPending((p) => p ? { ...p, email_verified: verified } : p);
      setCommitted((c) => c ? { ...c, email_verified: verified } : c);
      setMe((m) => m && fresh?.data ? { ...m, ...fresh.data, profile: fresh.data.profile || m.profile } : m);
      if (showToast) showToast(lang === 'ht' ? 'Verifye!' : 'Email verified.', 'check-circle');
    } catch (err) {
      if (showToast) showToast(err?.response?.data?.error || 'Bad token.', 'exclamation-triangle');
    } finally {
      setIsVerifyingEmail(false);
    }
  };
  const handleChangePassword = async () => {
    const { current, next, confirm } = changePwdForm;
    if (!current || !next) {
      if (showToast) showToast(lang === 'ht' ? 'Ranpli tout chan yo.' : 'Fill all fields.', 'exclamation-triangle');
      return;
    }
    if (next !== confirm) {
      if (showToast) showToast(lang === 'ht' ? 'Modpas pa matche.' : 'Passwords do not match.', 'exclamation-triangle');
      return;
    }
    if (next.length < 6) {
      if (showToast) showToast(lang === 'ht' ? 'Omwen 6 karaktè.' : 'Min 6 chars.', 'exclamation-triangle');
      return;
    }
    setIsChangingPwd(true);
    try {
      await authService.changePassword({ current_password: current, new_password: next });
      if (showToast) showToast(lang === 'ht' ? 'Modpas chanje!' : 'Password changed.', 'check-circle');
      setIsChangePwdOpen(false);
      setChangePwdForm({ current: '', next: '', confirm: '' });
      if (onLogout) onLogout('password_changed');
      if (onClose) onClose();
    } catch (err) {
      if (showToast) showToast(err?.response?.data?.error || 'Error', 'exclamation-triangle');
    } finally {
      setIsChangingPwd(false);
    }
  };
  const handleDeleteAccount = () => {
    const text = window.prompt(t.sec_delete_prompt);
    if (text !== 'DELETE') {
      if (showToast) showToast(lang === 'ht' ? 'Aksyon anile.' : 'Cancelled.', 'info-circle');
      return;
    }
    setIsDeletingAccount(true);
    authService.deleteAccount()
      .then(() => {
        if (showToast) showToast(lang === 'ht' ? 'Kont efase.' : 'Account deleted.', 'check-circle');
        if (onLogout) onLogout('account_deleted');
        if (onClose) onClose();
      })
      .catch(err => {
        if (showToast) showToast(err?.response?.data?.error || 'Error', 'exclamation-triangle');
      })
      .finally(() => setIsDeletingAccount(false));
  };

  // ── In-pane navigation helpers.
  //
  // Wraps ``setTab`` so the new tab + the scroll-to-top of main are
  // atomically applied — without the scroll call, the user would land
  // mid-content on the new pane (which feels disorienting after a
  // tall pane like Identity). ``behavior: 'smooth'`` is intentional:
  // a hard jump would visually detach the previous pane's tail from
  // the current pane's head.
  //
  // We deliberately do NOT call ``goToTab`` from the initial
  // ``setTab('visibility')`` in state init — React doesn't fire an
  // effect for state init, so the scroll is only triggered from
  // real user actions (top tab click OR the new in-pane nav buttons).
  const goToTab = (tabId) => {
    if (tabId === tab) return;
    setTab(tabId);
    try {
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      // Older browsers without scrollTo options — fall back to instant jump.
      try { mainScrollRef.current && (mainScrollRef.current.scrollTop = 0); } catch (__) { /* ignore */ }
    }
  };

  // ── Audit timeline (icons + colours).
  const AUDIT_ICONS = {
    visibility_change: { icon: 'fa-eye',                  color: '#0084ff' },
    contact_toggle:    { icon: 'fa-id-card',              color: '#e91e63' },
    dms_toggle:        { icon: 'fa-envelope-open-text',   color: '#9c27b0' },
    profile_view:      { icon: 'fa-eye',                  color: '#22c55e' },
    profile_update:    { icon: 'fa-pen',                  color: '#f59e0b' },
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'visibility', icon: 'fa-eye',                  label: t.tab_visibility },
    { id: 'identity',   icon: 'fa-id-badge',             label: t.tab_identity },
    { id: 'comm',       icon: 'fa-comments',             label: t.tab_comm },
    { id: 'security',   icon: 'fa-shield-halved',        label: t.tab_security },
    { id: 'audit',      icon: 'fa-timeline',             label: t.tab_audit },
  ];
  // Index of the current tab + neighbours for the in-pane nav strip.
  // Computed once per render so the prev/next buttons know what to
  // jump to without a second pass over the tabs array.
  const tabIndex = tabs.findIndex(tb => tb.id === tab);
  const prevTab = tabIndex > 0 ? tabs[tabIndex - 1] : null;
  const nextTab = tabIndex >= 0 && tabIndex < tabs.length - 1 ? tabs[tabIndex + 1] : null;

  const emailMask = me?.email || '';
  const emailShown = (showEmail && emailMask) || '';
  const emailHidden = emailMask ? '••••••••' + emailMask.substring(emailMask.indexOf('@')) : '';

  return (
    <div className="privacy-shell" role="dialog" aria-modal="true" aria-label={t.title} tabIndex={-1} ref={dialogRef}>
      {/* Safety-belt veil: sits at z-index -1 inside the shell so
          even if a Safari stacking-context bug punches above through
          (backdrop-filter on the footer, mix-blend-mode on the
          noise, or a ``background: var()`` shorthand parse
          fallback), the modal is guaranteed to NEVER show the
          underlying Kot3 page through this layer. */}
      <div className="privacy-veil" aria-hidden="true" />
      <div className="privacy-noise" aria-hidden="true" />
      <header className="privacy-topbar">
        <div className="privacy-topbar-title">
          <span className="privacy-pulse-dot" />
          <h2>{t.title}</h2>
          <span className="privacy-subtitle">{t.subtitle}</span>
        </div>
        <div className="privacy-autosave" data-state={saveState}>
          <i className={`fas ${saveState === 'saving' ? 'fa-spinner fa-spin' : saveState === 'saved' ? 'fa-check-circle' : 'fa-cloud'}`} />
          <span>{saveState === 'saving' ? t.saving : saveState === 'saved' ? t.saved : t.autosave}</span>
        </div>
        <button
          type="button"
          className={`privacy-tab-trigger ${onPreviewAs ? '' : 'is-disabled'}`}
          onClick={() => onPreviewAs?.()}
          disabled={!onPreviewAs}
          title={t.preview_as}
        >
          <i className="fas fa-user-secret" />
          <span>{t.preview_as}</span>
        </button>
        <button type="button" className="privacy-close" onClick={onClose} aria-label={t.close}>
          <i className="fas fa-xmark" />
        </button>
      </header>

      <nav className="privacy-tabs" role="tablist">
        {tabs.map(tb => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            className={`privacy-tab ${tab === tb.id ? 'is-active' : ''}`}
            onClick={() => goToTab(tb.id)}
          >
            <i className={`fas ${tb.icon}`} />
            <span>{tb.label}</span>
            <span className="privacy-tab-status-dot" aria-hidden="true" />
          </button>
        ))}
      </nav>

      <main className="privacy-main" ref={mainScrollRef}>
        {/* ─── VISIBILITY ─────────────────────────────────────── */}
        {tab === 'visibility' && (
          <section className="privacy-pane">
            <div className="privacy-hero">
              <div className="privacy-hero-text">
                <h3>{t.vis_section_title}</h3>
                <p>{t.vis_section_sub}</p>
              </div>
              <div className="privacy-hero-chips">
                <span className="privacy-hero-chip">
                  <i className="fas fa-user-secret" />
                  {pending?.profile_visibility === 'public' ? t.vis_now_public
                    : pending?.profile_visibility === 'friends' ? t.vis_now_friends
                    : t.vis_now_private}
                </span>
              </div>
            </div>

            <article className="privacy-card">
              <div className="privacy-card-body">
                <div className="privacy-card-label">
                  <i className="fas fa-eye" />
                  <strong>{t.vis_profile_label}</strong>
                  <span>{t.vis_profile_sub}</span>
                </div>
                <div className="privacy-card-control">
                  <select
                    className="privacy-select"
                    value={pending?.profile_visibility || 'public'}
                    onChange={(e) => patch('profile_visibility', e.target.value)}
                  >
                    <option value="public">{t.vis_opt_public}</option>
                    <option value="friends">{t.vis_opt_friends}</option>
                    <option value="private">{t.vis_opt_private}</option>
                  </select>
                </div>
              </div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-body">
                <div className="privacy-card-label">
                  <i className="fas fa-clock" />
                  <strong>{t.vis_lastseen_label}</strong>
                  <span>{t.vis_lastseen_sub}</span>
                </div>
                <div className="privacy-card-control">
                  <select
                    className="privacy-select"
                    value={pending?.last_seen_visibility || 'everyone'}
                    onChange={(e) => patch('last_seen_visibility', e.target.value)}
                  >
                    <option value="everyone">{t.vis_opt_everyone}</option>
                    <option value="friends">{t.vis_opt_friends}</option>
                    <option value="nobody">{t.vis_opt_nobody}</option>
                  </select>
                </div>
              </div>
            </article>

            <article className="privacy-card privacy-card-toggle">
              <div className="privacy-card-body">
                <div className="privacy-card-label">
                  <i className="fas fa-id-card" />
                  <strong>{t.vis_contact_label}</strong>
                  <span>{t.vis_contact_sub}</span>
                </div>
                <div className="privacy-card-control">
                  <label className="privacy-switch">
                    <input
                      type="checkbox"
                      checked={!!pending?.show_contact_info}
                      onChange={(e) => patch('show_contact_info', e.target.checked)}
                    />
                    <span className="privacy-switch-slider" />
                  </label>
                </div>
              </div>
            </article>

            <article className="privacy-card privacy-card-toggle">
              <div className="privacy-card-body">
                <div className="privacy-card-label">
                  <i className="fas fa-envelope-open-text" />
                  <strong>{t.vis_dms_label}</strong>
                  <span>{t.vis_dms_sub}</span>
                </div>
                <div className="privacy-card-control">
                  <label className="privacy-switch">
                    <input
                      type="checkbox"
                      checked={!!pending?.allow_stranger_dms}
                      onChange={(e) => patch('allow_stranger_dms', e.target.checked)}
                    />
                    <span className="privacy-switch-slider" />
                  </label>
                </div>
              </div>
            </article>
          </section>
        )}

        {/* ─── IDENTITY ───────────────────────────────────────── */}
        {tab === 'identity' && (
          <section className="privacy-pane">
            <div className="privacy-hero">
              <div className="privacy-hero-text">
                <h3>{t.id_section_title}</h3>
                <p>{t.id_section_sub}</p>
              </div>
            </div>

            <div className="privacy-grid-2">
              <article className="privacy-card">
                <div className="privacy-card-label">
                  <i className="fas fa-camera" />
                  <strong>{t.id_avatar_label}</strong>
                  <span>{t.id_avatar_sub}</span>
                </div>
                <div className="privacy-uploader">
                  <div className="privacy-uploader-preview">
                    {pending?.avatar && pending.avatar.length > 200 ? (
                      <img src={pending.avatar} alt="" />
                    ) : (
                      <i className="fas fa-user" />
                    )}
                  </div>
                  <label className="privacy-upload-btn">
                    <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
                    <i className="fas fa-cloud-arrow-up" />
                    <span>{lang === 'ht' ? 'Chwazi' : lang === 'fr' ? 'Choisir' : lang === 'es' ? 'Elegir' : 'Choose'}</span>
                  </label>
                </div>
              </article>

              <article className="privacy-card">
                <div className="privacy-card-label">
                  <i className="fas fa-image" />
                  <strong>{t.id_cover_label}</strong>
                  <span>{t.id_cover_sub}</span>
                </div>
                <div className="privacy-uploader privacy-uploader-cover">
                  <div className="privacy-uploader-preview">
                    {pending?.cover_photo ? (
                      <img src={pending.cover_photo} alt="" />
                    ) : (
                      <i className="fas fa-panorama" />
                    )}
                  </div>
                  <label className="privacy-upload-btn">
                    <input type="file" accept="image/*" onChange={handleCoverChange} style={{ display: 'none' }} />
                    <i className="fas fa-cloud-arrow-up" />
                    <span>{lang === 'ht' ? 'Chwazi' : lang === 'fr' ? 'Choisir' : lang === 'es' ? 'Elegir' : 'Choose'}</span>
                  </label>
                </div>
              </article>
            </div>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-at" />
                <strong>{t.id_username_label}</strong>
                <span>{t.id_username_sub}</span>
              </div>
              <div className="privacy-username-display">
                <span className="privacy-username-handle">@{pending?.username || '—'}</span>
                <span className="privacy-username-hint">
                  {lang === 'ht' ? 'Nan Settings → Kont' : lang === 'fr' ? 'Dans Settings → Account' : lang === 'es' ? 'En Settings → Account' : 'In Settings → Account'}
                </span>
              </div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-quote-left" />
                <strong>{t.id_bio_label}</strong>
                <span>{t.id_bio_sub}</span>
              </div>
              <textarea
                className="privacy-textarea"
                value={pending?.bio || ''}
                onChange={(e) => patch('bio', e.target.value.slice(0, 500))}
                maxLength={500}
                placeholder={lang === 'ht' ? 'Ekri yon ti deskripsyon…' : 'Tell us about yourself…'}
                rows={3}
              />
              <div className="privacy-bio-counter">{(pending?.bio || '').length}/500</div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-tags" />
                <strong>{t.id_interests_label}</strong>
                <span>{t.id_interests_sub}</span>
              </div>
              <div className="privacy-interests-row">
                <input
                  type="text"
                  value={newInterest}
                  onChange={(e) => setNewInterest(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInterest(); } }}
                  maxLength={30}
                  placeholder={lang === 'ht' ? 'Tag…' : 'Tag…'}
                  className="privacy-input"
                />
                <button type="button" className="privacy-btn privacy-btn-ghost" onClick={addInterest} disabled={!newInterest.trim()}>
                  <i className="fas fa-plus" /> {t.id_interests_add}
                </button>
              </div>
              <div className="privacy-chips">
                {(pending?.interests || []).map(tag => (
                  <span key={tag} className="privacy-chip">
                    #{tag}
                    <button type="button" onClick={() => removeInterest(tag)} aria-label={`Remove ${tag}`}>
                      <i className="fas fa-xmark" />
                    </button>
                  </span>
                ))}
              </div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-share-nodes" />
                <strong>{t.id_social_label}</strong>
                <span>{t.id_social_sub}</span>
              </div>
              <div className="privacy-social-grid">
                {['instagram', 'whatsapp', 'website', 'twitter', 'linkedin', 'github'].map(p => (
                  <div key={p} className="privacy-social-row">
                    <span className="privacy-social-platform">{p}</span>
                    <input
                      type="url"
                      className="privacy-input"
                      value={(pending?.social_links || {})[p] || ''}
                      onChange={(e) => saveSocial(p, e.target.value)}
                      placeholder={`https://${p === 'website' ? 'example.com' : p + '.com/user'}`}
                    />
                  </div>
                ))}
              </div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-globe" />
                <strong>{t.id_country_label}</strong>
              </div>
              <select
                className="privacy-select privacy-select-full"
                value={pending?.country || ''}
                onChange={(e) => patch('country', e.target.value)}
              >
                <option value="">{t.id_country_select}</option>
                {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </article>
          </section>
        )}

        {/* ─── COMMUNICATION ─────────────────────────────────── */}
        {tab === 'comm' && (
          <section className="privacy-pane">
            <div className="privacy-hero">
              <div className="privacy-hero-text">
                <h3>{t.comm_section_title}</h3>
                <p>{t.comm_section_sub}</p>
              </div>
            </div>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-bell" />
                <strong>{t.comm_notif_sound.split(' ').slice(0, 2).join(' ')}…</strong>
                <span>{lang === 'ht' ? 'Son, desktop, imèl, aperçu.' : 'Sound, desktop, email, preview.'}</span>
              </div>
              <div className="privacy-notif-grid">
                {[
                  ['sound',           t.comm_notif_sound,   'fa-volume-up'],
                  ['desktop_notif',   t.comm_notif_desktop, 'fa-desktop'],
                  ['email_notif',     t.comm_notif_email,   'fa-envelope'],
                  ['message_preview', t.comm_notif_preview, 'fa-eye'],
                ].map(([key, label, icon]) => (
                  <div key={key} className="privacy-notif-row" onClick={() => toggleNotif(key)}>
                    <i className={`fas ${icon}`} />
                    <span>{label}</span>
                    <label className="privacy-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!(pending?.notification_prefs || {})[key]}
                        onChange={(e) => toggleNotif(key)}
                      />
                      <span className="privacy-switch-slider" />
                    </label>
                  </div>
                ))}
              </div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-user-slash" />
                <strong>{t.comm_blocks_title}</strong>
                <span>{t.comm_blocks_sub}</span>
              </div>
              {blocks.length === 0 ? (
                <p className="privacy-empty">{t.comm_empty}</p>
              ) : (
                <ul className="privacy-list">
                  {blocks.map(b => (
                    <li key={b.id} className="privacy-list-row">
                      <span>{b.blocked?.username || `#${b.blocked_id || b.user_id}`}</span>
                      <button type="button" className="privacy-btn privacy-btn-ghost" onClick={() => unblock(b.id)}>
                        {t.comm_unblock}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-bell-slash" />
                <strong>{t.comm_mutes_title}</strong>
                <span>{t.comm_mutes_sub}</span>
              </div>
              {mutes.length === 0 ? (
                <p className="privacy-empty">{t.comm_empty}</p>
              ) : (
                <ul className="privacy-list">
                  {mutes.map(m => (
                    <li key={m.id} className="privacy-list-row">
                      <span>{m.muted?.username || `#${m.muted_id || m.user_id}`}</span>
                      <button type="button" className="privacy-btn privacy-btn-ghost" onClick={() => unmute(m.id)}>
                        {t.comm_unmute}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>
        )}

        {/* ─── SECURITY ───────────────────────────────────────── */}
        {tab === 'security' && (
          <section className="privacy-pane">
            <div className="privacy-hero">
              <div className="privacy-hero-text">
                <h3>{t.sec_section_title}</h3>
                <p>{t.sec_section_sub}</p>
              </div>
            </div>

            <article className="privacy-card privacy-card-clickable" onClick={() => setShowEmail(v => !v)}>
              <div className="privacy-card-label">
                <i className="fas fa-envelope" />
                <strong>{t.sec_email_label}</strong>
                <span>{showEmail ? emailShown || (lang === 'ht' ? 'Pa gen imèl' : 'No email') : emailHidden || (lang === 'ht' ? 'Pa gen imèl' : 'No email')}</span>
              </div>
              <div className="privacy-card-control">
                <span className="privacy-badge">
                  <i className={`fas ${showEmail ? 'fa-eye-slash' : 'fa-eye'}`} />
                  {showEmail ? t.sec_email_hide : t.sec_email_show}
                </span>
              </div>
            </article>

            <article className="privacy-card">
              <div className="privacy-card-label">
                <i className="fas fa-shield-halved" />
                <strong>{t.sec_verify_title}</strong>
                <span>{t.sec_verify_sub}</span>
              </div>
              <div className="privacy-verify-state">
                <span className={`privacy-badge ${pending?.email_verified ? 'is-good' : 'is-warn'}`}>
                  <i className={`fas ${pending?.email_verified ? 'fa-check-circle' : 'fa-exclamation-triangle'}`} />
                  {pending?.email_verified ? t.sec_verified : t.sec_not_verified}
                </span>
                {!pending?.email_verified && (
                  <button type="button" className="privacy-btn" onClick={handleSendVerify} disabled={isVerifyingEmail}>
                    {isVerifyingEmail ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-paper-plane" />}
                    {t.sec_resend}
                  </button>
                )}
              </div>
              {!pending?.email_verified && (
                <div className="privacy-verify-row">
                  <input
                    type="text"
                    className="privacy-input privacy-mono"
                    placeholder={t.sec_token_ph}
                    value={verifyEmailToken}
                    onChange={(e) => setVerifyEmailToken(e.target.value)}
                  />
                  <button type="button" className="privacy-btn privacy-btn-ghost" onClick={handleConfirmVerify} disabled={isVerifyingEmail || !verifyEmailToken.trim()}>
                    {t.sec_confirm}
                  </button>
                </div>
              )}
            </article>

            <article className="privacy-card privacy-card-collapsible">
              <div className="privacy-card-clickable" onClick={() => setIsChangePwdOpen(v => !v)}>
                <div className="privacy-card-label">
                  <i className="fas fa-key" />
                  <strong>{t.sec_pwd_change}</strong>
                </div>
                <div className="privacy-card-control">
                  <i className={`fas ${isChangePwdOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                </div>
              </div>
              {isChangePwdOpen && (
                <div className="privacy-pwd-form">
                  <input
                    type="password"
                    placeholder={t.sec_pwd_current}
                    value={changePwdForm.current}
                    onChange={(e) => setChangePwdForm(p => ({ ...p, current: e.target.value }))}
                    className="privacy-input"
                    autoComplete="current-password"
                  />
                  <input
                    type="password"
                    placeholder={t.sec_pwd_new}
                    value={changePwdForm.next}
                    onChange={(e) => setChangePwdForm(p => ({ ...p, next: e.target.value }))}
                    className="privacy-input"
                    autoComplete="new-password"
                  />
                  <input
                    type="password"
                    placeholder={t.sec_pwd_confirm}
                    value={changePwdForm.confirm}
                    onChange={(e) => setChangePwdForm(p => ({ ...p, confirm: e.target.value }))}
                    className="privacy-input"
                    autoComplete="new-password"
                  />
                  <button type="button" className="privacy-btn privacy-btn-primary" onClick={handleChangePassword} disabled={isChangingPwd}>
                    {isChangingPwd && <i className="fas fa-spinner fa-spin" />}
                    {t.sec_pwd_submit}
                  </button>
                </div>
              )}
            </article>

            <article className="privacy-card privacy-card-danger">
              <div className="privacy-card-label">
                <i className="fas fa-trash" />
                <strong>{t.sec_delete_title}</strong>
                <span>{t.sec_delete_sub}</span>
              </div>
              <div className="privacy-card-control">
                <button type="button" className="privacy-btn privacy-btn-danger" onClick={handleDeleteAccount} disabled={isDeletingAccount}>
                  {isDeletingAccount && <i className="fas fa-spinner fa-spin" />}
                  {t.sec_delete_btn}
                </button>
              </div>
            </article>
          </section>
        )}

        {/* ─── ACTIVITY ───────────────────────────────────────── */}
        {tab === 'audit' && (
          <section className="privacy-pane">
            <div className="privacy-hero">
              <div className="privacy-hero-text">
                <h3>{t.audit_title}</h3>
                <p>{t.audit_subtitle}</p>
              </div>
            </div>
            {activityLogs.length === 0 ? (
              <p className="privacy-empty">{t.audit_empty}</p>
            ) : (
              <ol className="privacy-timeline">
                {activityLogs.map(log => {
                  const meta = AUDIT_ICONS[log.action] || { icon: 'fa-circle', color: '#888' };
                  // For unknown action keys (anything the backend adds
                  // without an i18n entry), fall back to a generic
                  // localized "Event" label instead of the raw server
                  // string. React still escapes the value defensively,
                  // but unmapped raw values can be long status blobs
                  // that visually break the timeline card.
                  const label = t.audit_labels[log.action] || (
                    lang === 'ht' ? 'Evènman' :
                    lang === 'fr' ? 'Événement' :
                    lang === 'es' ? 'Evento' :
                    'Event'
                  );
                  return (
                    <li key={log.id} className="privacy-timeline-item">
                      <span className="privacy-timeline-dot" style={{ background: meta.color }} aria-hidden="true">
                        <i className={`fas ${meta.icon}`} />
                      </span>
                      <div className="privacy-timeline-body">
                        <div className="privacy-timeline-label">{label}</div>
                        <div className="privacy-timeline-time">{bucketRelativeTime(log.created_at, lang)}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}

        {/* ── IN-PANE NAV (sticky prev/next + progress chip) ──────
            Renders ONCE per render because it lives OUTSIDE the
            conditional sections, so it stays put across tab switches
            and the user can always reach the next/previous pane
            without scrolling back to the top. ``position: sticky;
            bottom: 0`` glues it to the bottom of the scroll panel
            (see ``.privacy-pane-nav`` CSS). */}
        <nav className="privacy-pane-nav" aria-label={t.nav_pane_label}>
          <button
            type="button"
            className="privacy-pane-nav-btn is-prev"
            onClick={() => prevTab && goToTab(prevTab.id)}
            disabled={!prevTab}
            aria-label={`${t.nav_prev}: ${prevTab ? prevTab.label : ''}`}
          >
            <i className="fas fa-arrow-left" />
            <span className="privacy-pane-nav-stack">
              <small className="privacy-pane-nav-eyebrow">{t.nav_prev}</small>
              <strong className="privacy-pane-nav-title">{prevTab ? prevTab.label : ' '}</strong>
            </span>
          </button>

          <div className="privacy-pane-progress" aria-live="polite">
            <span className="privacy-pane-progress-label">{tabs[tabIndex]?.label || ' '}</span>
            <span className="privacy-pane-progress-count">{`${tabIndex + 1} / ${tabs.length}`}</span>
          </div>

          <button
            type="button"
            className="privacy-pane-nav-btn is-next"
            onClick={() => nextTab && goToTab(nextTab.id)}
            disabled={!nextTab}
            aria-label={`${t.nav_next}: ${nextTab ? nextTab.label : ''}`}
          >
            <span className="privacy-pane-nav-stack">
              <small className="privacy-pane-nav-eyebrow">{t.nav_next}</small>
              <strong className="privacy-pane-nav-title">{nextTab ? nextTab.label : ' '}</strong>
            </span>
            <i className="fas fa-arrow-right" />
          </button>
        </nav>
      </main>

      <footer className="privacy-footer">
        <span className="privacy-footer-tag">
          <i className="fas fa-shield-halved" />
          DevRose · Espas Konfidansyalite
        </span>
        <span className="privacy-footer-tag">
          <i className="fas fa-magic" />
          {lang === 'ht' ? 'Tout bagay sou yon ekran.' : lang === 'fr' ? 'Tout est sur un écran.' : lang === 'es' ? 'Todo en una pantalla.' : 'Everything on one screen.'}
        </span>
      </footer>
    </div>
  );
}

export default PrivacySpace;
