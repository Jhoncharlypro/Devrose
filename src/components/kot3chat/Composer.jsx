/**
 * src/components/kot3chat/Composer.jsx
 *
 * Self-contained message composer. Bars, text input, attachment menu,
 * voice recording, emoji picker — everything below the chat pane.
 *
 * Pure presentational. The host component owns:
 *   * input / setInput
 *   * replyingTo / editingMessage / attachedImage
 *   * emojiPickerOpen / attachmentMenuOpen / isRecording
 *   * mediaRecorderRef / mediaStreamRef / audioChunksRef
 *   * the actual API calls (chatService.sendMessage, handleSendMessage, etc.)
 *
 * The composer owns:
 *   * nothing — every visible state is a controlled prop.
 *
 * Why a separate file
 * -------------------
 * The original footer was ~150 lines of JSX inlined into Kot3Chat.jsx with
 * side effects inside (recorder state, FileReader, etc.). Extracting it
 * means future features (GIFs, polls, voice→text transcription) become
 * additions to a single file, not invasive growth of the 145k-char
 * Kot3Chat.jsx root.
 *
 * Props
 * -----
 *   disable              : boolean                composer is grayed when activeThread.is_temp
 *   input                : string                 controlled
 *   onInputChange        : (string) => void
 *
 *   // reply / edit context banner
 *   replyingTo           : { id, sender_username, content } | null
 *   editingMessage       : { id, content } | null
 *   onCancelContext      : () => void              dismisses BOTH reply and edit
 *
 *   // attachment menu
 *   attachedImage        : string (data URL) | ''
 *   imagePreviewUrl      : string (data URL) | ''
 *   attachmentMenuOpen   : boolean
 *   onToggleAttachmentMenu : () => void
 *   onAttachImage        : (file: File) => void
 *   onClearAttachedImage : () => void
 *
 *   // voice recorder
 *   isRecording          : boolean
 *   onStartRecording     : () => void
 *   onStopRecording      : () => void              (commits)
 *   onCancelRecording    : () => void
 *
 *   // emoji picker
 *   emojiPickerOpen      : boolean
 *   onToggleEmoji        : () => void
 *   recentEmojis         : string[]               quick-pick row inside picker
 *   onPickEmoji          : (emoji) => void
 *
 *   // send
 *   onSend               : () => void              the actual submit
 *   disableSend          : boolean                no text + no image → false
 *
 *   // disappearing-messages picker
 *   ephemeralSeconds      : number    0 = off, else seconds-until-expiry
 *   onPickEphemeral       : (seconds: number) => void   toggles 1h / 24h / 7d / off
 *
 *   // language + toast
 *   lang                 : 'ht' | 'en' | …
 *   onToast              : (msg, icon) => void     surfaced for UX
 *
 *   // file-ref for the camera-button "open file picker" gesture
 *   fileInputRef         : React.RefObject<HTMLInputElement>
 */
import React, { useMemo, useRef } from 'react';
import './composer.css';

/**
 * Common emoji palette for the popover picker. Mirrors the original 30-cell
 * grid embedded in Kot3Chat.jsx. We guard against being in a remote-render
 * environment where window is undefined by memoizing at module scope.
 */
const EMOJI_SET = [
  '😀','😃','😄','😁','😆','🥹','😂','🤣','🥲','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣',
  '😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔',
  '👍','👎','👏','🙌','🙏','🤝','💪','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗',
];

const RECENT_EMOJI_KEY = 'kot3_recent_emojis';

function loadRecentEmojis() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]');
    if (Array.isArray(arr)) return arr.filter((e) => typeof e === 'string').slice(0, 16);
  } catch {}
  return ['👍', '❤️', '😂', '🔥', '🙏', '👏'];
}

export function Composer({
  disable,
  input, onInputChange,
  replyingTo, editingMessage, onCancelContext,
  attachedImage, imagePreviewUrl, attachmentMenuOpen, onToggleAttachmentMenu,
  onAttachImage, onAttachDocument, onAttachLocation, onClearAttachedImage,
  attachedDocument, attachedLocation,
  isRecording, onStartRecording, onStopRecording, onCancelRecording,
  emojiPickerOpen, onToggleEmoji, onPickEmoji,
  onSend, disableSend,
  ephemeralSeconds = 0, onPickEphemeral,
  lang, onToast, fileInputRef,
}) {
  // We only read recent emojis on mount (and re-read on picker open) so the
  // picker doesn't re-read localStorage on every keystroke.
  const recentEmojis = useMemo(() => loadRecentEmojis(), [emojiPickerOpen]);

  // Hidden file-input handle for the "Document" attachment (PDF / DOCX /
  // TXT / XLSX / PPT / ZIP). The hidden ``<input>`` below consumes this
  // ref via a callback ref so two sibling inputs don't fight each other
  // when React re-renders the composer mid-mount.
  const composerDocInputRef = useRef(null);

  const rememberEmoji = (e) => {
    try {
      const next = [e, ...recentEmojis.filter((x) => x !== e)].slice(0, 16);
      localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
    } catch {}
  };

  const handleAttachImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      onToast?.(lang === 'ht' ? 'Imaj twò gwo. Max 4MB.' : 'Image too large. Max 4MB.', 'exclamation-triangle');
      e.target.value = '';
      return;
    }
    onAttachImage?.(file);
    e.target.value = '';
  };

  const handleAttachDocument = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      onToast?.(lang === 'ht' ? 'Dokiman twò gwo. Max 10MB.' : 'Document too large. Max 10MB.', 'exclamation-triangle');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      onAttachDocument?.({ name: file.name, base64: String(reader.result || '') });
      onToggleAttachmentMenu?.();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAttachLocation = () => {
    if (!navigator.geolocation) {
      onToast?.(lang === 'ht' ? 'Navigatè a pa sipòte lokalizasyon.' : 'Geolocation not supported.', 'exclamation-triangle');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onAttachLocation?.({
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        name: lang === 'ht' ? 'Pozisyon mwen' : 'My location',
      }),
      (err) => onToast?.(lang === 'ht' ? 'Pa ka jwenn pozisyon.' : 'Cannot retrieve position.', 'exclamation-triangle'),
      { enableHighAccuracy: false, timeout: 8000 }
    );
    onToggleAttachmentMenu?.();
  };

  return (
    <footer className="kot3-chat-footer" aria-label={lang === 'ht' ? 'Kompozitè mesaj' : 'Message composer'}>
      {/* Hidden file input shared by the attach menu's "Pick a photo" button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleAttachImage}
      />
      {/* Hidden file inputs for documents + all-types picker (Phase 9). */}
      <input
        ref={(el) => { composerDocInputRef.current = el; }}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={handleAttachDocument}
      />

      {/* Context banner: shown for reply OR edit. Click X to dismiss both. */}
      {(replyingTo || editingMessage) && (
        <div
          className="kot3-context-banner"
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            bottom: '64px',
            left: 14, right: 60,
          }}
        >
          <div className="kot3-context-banner-icon" aria-hidden="true">
            {editingMessage ? <i className="fas fa-pen" /> : <i className="fas fa-reply" />}
          </div>
          <div className="kot3-context-banner-text">
            <div className="kot3-context-banner-title">
              {editingMessage
                ? (lang === 'ht' ? 'Modifye mesaj' : 'Editing message')
                : (lang === 'ht' ? `Reponn @${replyingTo?.sender_username || ''}` : `Reply to @${replyingTo?.sender_username || ''}`)}
            </div>
            <div className="kot3-context-banner-snippet">
              {(editingMessage?.content || replyingTo?.content || '').slice(0, 80)}
            </div>
          </div>
          <button
            type="button"
            className="kot3-context-banner-close"
            aria-label={lang === 'ht' ? 'Anile' : 'Cancel'}
            onClick={onCancelContext}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Image preview row — appears above send button while composable */}
      {attachedImage && (
        <div className="kot3-image-preview" style={{ position: 'absolute', bottom: '64px', left: 60 }}>
          <img src={imagePreviewUrl || attachedImage} alt="" />
          <button
            type="button"
            className="kot3-image-preview-close"
            onClick={onClearAttachedImage}
            aria-label={lang === 'ht' ? 'Retire imaj la' : 'Remove image'}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Document preview chip — file name + size */}
      {attachedDocument && (
        <div className="kot3-doc-preview-chip" style={{ position: 'absolute', bottom: '64px', left: 60 }}>
          <i className="fas fa-file-alt" aria-hidden="true" />
          <span>{attachedDocument.name}</span>
          <button type="button" onClick={() => onClearAttachedImage?.()} aria-label={lang === 'ht' ? 'Retire' : 'Remove'}>
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Location preview chip — lat/lng */}
      {attachedLocation && (
        <div className="kot3-loc-preview-chip" style={{ position: 'absolute', bottom: '64px', left: 60 }}>
          <i className="fas fa-map-marker-alt" aria-hidden="true" />
          <span>{attachedLocation.name || `${attachedLocation.lat.toFixed(4)}, ${attachedLocation.lng.toFixed(4)}`}</span>
          <button type="button" onClick={() => onClearAttachedImage?.()} aria-label={lang === 'ht' ? 'Retire' : 'Remove'}>
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Ephemeral countdown pill — appears beside the composer when active */}
      {ephemeralSeconds > 0 && (
        <div className="kot3-ephemeral-pill" style={{
          position: 'absolute', bottom: '64px', right: 14,
          fontSize: 11, fontWeight: 700,
          color: 'var(--primary-color)',
          background: 'rgba(var(--primary-rgb), 0.10)',
          padding: '4px 10px', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <i className="fas fa-hourglass-half" aria-hidden="true" />
          <span>{ephemeralSeconds >= 86400 ? `${ephemeralSeconds / 86400}d` :
                ephemeralSeconds >= 3600 ? `${ephemeralSeconds / 3600}h` :
                `${ephemeralSeconds / 60}m`}</span>
          <button type="button" onClick={() => onPickEphemeral?.(0)} aria-label={lang === 'ht' ? 'Anile' : 'Cancel'}>
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Attachment menu trigger */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className={`kot3-attach-trigger ${attachmentMenuOpen ? 'active' : ''}`}
          onClick={onToggleAttachmentMenu}
          disabled={isRecording || disable}
          aria-label={lang === 'ht' ? 'Atache yon dokiman' : 'Attach a file'}
          aria-expanded={attachmentMenuOpen}
          title={lang === 'ht' ? 'Atache yon dokiman' : 'Attach'}
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
        {attachmentMenuOpen && (
          <div className="kot3-attachment-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="kot3-attach-btn"
              onClick={() => { fileInputRef?.current?.click(); onToggleAttachmentMenu?.(); }}
            >
              <i className="fas fa-image" aria-hidden="true" />
              <span>{lang === 'ht' ? 'Foto' : 'Photo'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="kot3-attach-btn"
              onClick={() => {
                composerDocInputRef.current?.click();
                onToggleAttachmentMenu?.();
              }}
            >
              <i className="fas fa-file-alt" aria-hidden="true" />
              <span>{lang === 'ht' ? 'Dokiman' : 'Document'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="kot3-attach-btn"
              onClick={handleAttachLocation}
            >
              <i className="fas fa-map-marker-alt" aria-hidden="true" />
              <span>{lang === 'ht' ? 'Lokalizasyon' : 'Location'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Disappearing timer trigger — sits to the left of the recorder */}
      <button
        type="button"
        className={`kot3-attach-trigger ${ephemeralSeconds > 0 ? 'active' : ''}`}
        disabled={isRecording || disable}
        onClick={() => {
          // Cycle: off → 1h → 24h → 7d → off.
          const order = [0, 3600, 86400, 7 * 86400];
          const idx = order.indexOf(ephemeralSeconds);
          const next = order[(idx === -1 ? 0 : (idx + 1) % order.length)];
          onPickEphemeral?.(next);
        }}
        aria-label={lang === 'ht' ? 'Disparèt apre' : 'Disappearing after'}
        title={lang === 'ht' ? 'Tan pou disparèt' : 'Disappearing timer'}
        style={{ background: 'transparent' }}
      >
        <i className="fas fa-hourglass-half" aria-hidden="true" />
      </button>

      {/* Voice recorder — replaces typing area while recording. */}
      {isRecording ? (
        <div className="kot3-recording-bar" style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          borderRadius: 18,
          border: '1px solid rgba(var(--primary-rgb), 0.30)',
          background: 'rgba(var(--primary-rgb), 0.10)',
          color: 'var(--text-primary)',
        }}>
          <span className="kot3-recording-wave" aria-hidden="true">
            <i className="fas fa-microphone" style={{ color: 'var(--primary-color)', fontSize: 16 }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary-color)' }}>
            {lang === 'ht' ? 'Ap anrejistre...' : 'Recording...'}
          </span>
          <button
            type="button"
            className="kot3-attach-btn"
            onClick={onCancelRecording}
            aria-label={lang === 'ht' ? 'Anile anrejistreman' : 'Cancel recording'}
            style={{ marginLeft: 'auto' }}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="kot3-send-btn"
            onClick={onStopRecording}
            aria-label={lang === 'ht' ? 'Voye vokal' : 'Send voice note'}
            title={lang === 'ht' ? 'Voye' : 'Send'}
          >
            <i className="fas fa-paper-plane" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <div className="kot3-input-wrapper">
            <input
              className="kot3-chat-input"
              value={input}
              onChange={(e) => onInputChange?.(e.target.value)}
              placeholder={
                editingMessage
                  ? (lang === 'ht' ? 'Modifye mesaj...' : 'Editing message...')
                  : replyingTo
                  ? (lang === 'ht' ? 'Reponn...' : 'Reply...')
                  : (lang === 'ht' ? 'Ekri yon mesaj...' : 'Type a message...')
              }
              disabled={disable}
              aria-label={lang === 'ht' ? 'Antre mesaj' : 'Message input'}
            />
            <button
              type="button"
              className="kot3-emoji-trigger"
              onClick={onToggleEmoji}
              disabled={disable}
              aria-label={lang === 'ht' ? 'Ouvri emoji' : 'Open emoji picker'}
              aria-expanded={emojiPickerOpen}
            >
              <i className="far fa-smile" aria-hidden="true" />
            </button>
            {emojiPickerOpen && (
              <div className="kot3-emoji-picker" role="dialog" aria-label={lang === 'ht' ? 'Chwazi yon emoji' : 'Choose an emoji'}>
                {EMOJI_SET.map((e) => (
                  <span
                    key={e}
                    role="button"
                    aria-label={`Emoji ${e}`}
                    onClick={() => {
                      rememberEmoji(e);
                      onPickEmoji?.(e);
                    }}
                  >
                    {e}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="kot3-attach-trigger"
            onClick={onStartRecording}
            disabled={disable}
            aria-label={lang === 'ht' ? 'Anrejistre yon vokal' : 'Record a voice note'}
            title={lang === 'ht' ? 'Anrejistre' : 'Record'}
            style={{ background: 'transparent' }}
          >
            <i className="fas fa-microphone" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`kot3-send-btn ${editingMessage ? 'kot3-send-btn-edit' : ''}`}
            onClick={onSend}
            disabled={disable || disableSend}
            aria-label={editingMessage
              ? (lang === 'ht' ? 'Sove edit' : 'Save edit')
              : (lang === 'ht' ? 'Voye mesaj' : 'Send message')}
          >
            <i className={editingMessage ? 'fas fa-check' : 'fas fa-paper-plane'} aria-hidden="true" />
          </button>
        </>
      )}
    </footer>
  );
}

export default Composer;
