// patch_step2_jsx_renders.mjs — JSX re-renders: image, reply, edit, delivery ticks, FAB, theme toggle, attachment menu
import fs from 'node:fs';

const JS = 'src/components/Kot3Chat.jsx';
let js = fs.readFileSync(JS, 'utf-8');

// ====================================================================
// 4. MESSAGE BUBBLE: render image + reply_to quote + edited tag + ticks
// ====================================================================
const bubbleAnchor = `                          {msg.audio || msg.audio_pending ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button onClick={() => !msg.audio_pending && toggleAudioPlayback(msg.id)} style={{
                                background: 'rgba(255,255,255,0.2)', border: 'none',
                                width: '28px', height: '28px', borderRadius: '50%',
                                color: 'white', cursor: msg.audio_pending ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                              }}>
                                <i className={msg.audio_pending ? 'fas fa-spinner fa-spin' : (playingAudioId === msg.id ? 'fas fa-pause' : 'fas fa-play')}></i>
                              </button>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.8)' }}>🎙️ Mesaj Vokal</span>
                                <span style={{ fontSize: '9px', opacity: 0.6 }}>{msg.audio_pending ? (lang === 'ht' ? 'Ap chaje...' : 'Loading...') : 'Audio note'}</span>
                              </div>
                              {msg.audio && (
                                <audio
                                  ref={el => { if (el) audioRefs.current[msg.id] = el; }}
                                  src={msg.audio}
                                  onEnded={() => setPlayingAudioId(null)}
                                />
                              )}
                            </div>
                          ) : (
                            msg.content
                          )}`;

const newBubble = `                          {/* Reply quote preview ABOVE the bubble if this message replies to another */}
                          {msg.reply_to_id && (
                            <div
                              className="kot3-msg-reply-quote"
                              onClick={(e) => { e.stopPropagation(); try {
                                const messagesContainer = messagesContainerRef.current;
                                if (!messagesContainer) return;
                                const targetEl = messagesContainer.querySelector('[data-msg-id="' + msg.reply_to_id + '"]');
                                if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              } catch {} }}
                              title={lang === 'ht' ? 'Ale nan mesaj orijinal la' : 'Jump to original message'}
                            >
                              <span className="kot3-reply-bar"></span>
                              <div className="kot3-reply-content">
                                <span className="kot3-reply-author">@{msg.reply_to_sender || 'user'}</span>
                                <span className="kot3-reply-snippet">{msg.reply_to_snippet || (lang === 'ht' ? '...' : '...')}</span>
                              </div>
                            </div>
                          )}

                          {msg.audio || msg.audio_pending ? (
                            <div className="kot3-audio-row">
                              <button onClick={() => !msg.audio_pending && toggleAudioPlayback(msg.id)} className="kot3-audio-play-btn">
                                <i className={msg.audio_pending ? 'fas fa-spinner fa-spin' : (playingAudioId === msg.id ? 'fas fa-pause' : 'fas fa-play')}></i>
                              </button>
                              <div className="kot3-audio-meta">
                                <span>🎙️ {lang === 'ht' ? 'Not Vokal' : 'Voice note'}</span>
                                <span className="kot3-audio-sub">{msg.audio_pending ? (lang === 'ht' ? 'Ap chaje...' : 'Loading...') : (lang === 'ht' ? 'Klike pou koute' : 'Tap to play')}</span>
                              </div>
                              {msg.audio && (
                                <audio
                                  ref={el => { if (el) audioRefs.current[msg.id] = el; }}
                                  src={msg.audio}
                                  onEnded={() => setPlayingAudioId(null)}
                                />
                              )}
                            </div>
                          ) : msg.image ? (
                            <img
                              src={msg.image}
                              alt="attachment"
                              className="kot3-msg-image"
                              loading="lazy"
                              onClick={() => msg.image && window.open && window.open(msg.image, '_blank')}
                            />
                          ) : (
                            msg.content
                          )}

                          {msg.is_edited && (
                            <span className="kot3-edited-tag">
                              {lang === 'ht' ? '· modifye' : '· edited'}
                            </span>
                          )}`;

if (js.includes(bubbleAnchor) && !js.includes('kot3-msg-reply-quote')) {
  js = js.replace(bubbleAnchor, newBubble);
  console.log('STEP 4 OK: bubble render enriched with image/reply/edited');
} else {
  console.log('STEP 4 SKIP');
}

// data-msg-id wrapper for scroll-to-original-message
const rowAnchor = `<div key={msg.id} className={\`kot3-message-row \${isMe ? 'sent' : 'received'}\`}>`;
const newRow = `<div key={msg.id} data-msg-id={msg.id} className={\`kot3-message-row \${isMe ? 'sent' : 'received'}\`}>`;
if (js.includes(rowAnchor) && !js.includes('data-msg-id={msg.id}')) {
  js = js.replace(rowAnchor, newRow);
  console.log('STEP 4b OK: data-msg-id on row for reply jump');
}

// Replace delivery tick meta with state ticks
const metaTickAnchor = `<div className="kot3-message-meta">
                          <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isMe && <i className={\`fas fa-check-double \${msg.is_read ? 'read' : ''}\`}></i>}
                        </div>`;

const newMeta = `<div className="kot3-message-meta">
                          <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isMe && (() => {
                            const ms = msg.status;
                            if (ms === 'sending') return <i className="fas fa-clock kot3-delivery-clock" title={lang === 'ht' ? 'Ap voye...' : 'Sending...'}></i>;
                            if (ms === 'sent' || (msg.is_delivered === false && !msg.is_read)) return <i className="fas fa-check" title={lang === 'ht' ? 'Voye' : 'Sent'}></i>;
                            if ((ms === 'delivered' || msg.is_delivered) && !msg.is_read) return <i className="fas fa-check-double" title={lang === 'ht' ? 'Livre' : 'Delivered'}></i>;
                            if (msg.is_read || ms === 'read') return <i className={\`fas fa-check-double read \${msg.is_read ? 'read' : ''}\`} title={lang === 'ht' ? 'Li' : 'Read'}></i>;
                            return <i className={\`fas fa-check-double \${msg.is_read ? 'read' : ''}\`}></i>;
                          })()}
                        </div>`;

if (js.includes(metaTickAnchor)) {
  js = js.replace(metaTickAnchor, newMeta);
  console.log('STEP 4c OK: meta tick renderer with 3 states');
}

// Replace msg-actions-overlay with reply + react + edit + delete
const actionsOverlayAnchor = `{/* Hover Actions options */}
                        <div className="kot3-msg-actions-overlay">
                          <button className="kot3-msg-action-btn" onClick={() => setOpenReactionDrawerId(openReactionDrawerId === msg.id ? null : msg.id)}>
                            <i className="far fa-smile"></i>
                          </button>
                          <button className="kot3-msg-action-btn" onClick={() => deleteMessage(msg.id)}>
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>`;

const newActionsOverlay = `{/* Hover Actions options */}
                        <div className="kot3-msg-actions-overlay">
                          <button className="kot3-msg-action-btn" title={lang === 'ht' ? 'Reponn' : 'Reply'} onClick={(e) => { e.stopPropagation(); startReply(msg); }}>
                            <i className="fas fa-reply"></i>
                          </button>
                          <button className="kot3-msg-action-btn" title={lang === 'ht' ? 'Reaji' : 'React'} onClick={(e) => { e.stopPropagation(); setOpenReactionDrawerId(openReactionDrawerId === msg.id ? null : msg.id); }}>
                            <i className="far fa-smile"></i>
                          </button>
                          {isMe && <button className="kot3-msg-action-btn" title={lang === 'ht' ? 'Modifye' : 'Edit'} onClick={(e) => { e.stopPropagation(); startEditMessage(msg); }}>
                            <i className="fas fa-pen"></i>
                          </button>}
                          <button className="kot3-msg-action-btn kot3-msg-action-danger" title={lang === 'ht' ? 'Efase' : 'Delete'} onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); }}>
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>`;

if (js.includes(actionsOverlayAnchor)) {
  js = js.replace(actionsOverlayAnchor, newActionsOverlay);
  console.log('STEP 4d OK: actions overlay has reply + edit (only own messages) + delete');
}

// ====================================================================
// 5. ATTACHMENT MENU + REPLY/EDIT BANNER + IMAGE PREVIEW + DARK MODE in settings
// ====================================================================
const sendBtnAnchor = `<button
            type="submit"
            onClick={handleSendMessage}
            disabled={!input.trim() && !isRecording}
            className="kot3-send-btn"
            title={lang === 'ht' ? 'Voye' : 'Send'}
          >
            <i className="fas fa-paper-plane"></i>
          </button>`;

const newSendBtnArea = `{/* Attachment menu popover */}
          {attachmentMenuOpen && (
            <div className="kot3-attachment-menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="kot3-attach-btn"
                onClick={() => { document.getElementById('kot3-image-input')?.click(); }}
              >
                <i className="fas fa-image"></i>
                <span>{lang === 'ht' ? 'Imaj' : 'Image'}</span>
              </button>
              <button type="button" className="kot3-attach-btn" disabled title={lang === 'ht' ? 'Pwochèman' : 'Coming soon'}>
                <i className="fas fa-file"></i>
                <span>{lang === 'ht' ? 'Dosye' : 'File'}</span>
              </button>
              <button type="button" className="kot3-attach-btn" disabled title={lang === 'ht' ? 'Pwochèman' : 'Coming soon'}>
                <i className="fas fa-map-marker-alt"></i>
                <span>{lang === 'ht' ? 'Kote' : 'Location'}</span>
              </button>
            </div>
          )}
          <input
            id="kot3-image-input"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              handleImageAttach(f);
              try { e.target.value = ''; } catch {}
            }}
          />
          <button
            type="button"
            className={'kot3-action-btn kot3-attach-trigger ' + (attachmentMenuOpen ? 'active' : '')}
            onClick={() => setAttachmentMenuOpen(prev => !prev)}
            title={lang === 'ht' ? 'Piè' : 'Attach'}
          >
            <i className={'fas ' + (attachmentMenuOpen ? 'fa-times' : 'fa-plus')}></i>
          </button>
          <button
            type="submit"
            onClick={handleSendMessage}
            disabled={(!input.trim() && !attachedImage) || isRecording}
            className={'kot3-send-btn ' + (editingMessage ? 'kot3-send-btn-edit' : '')}
            title={editingMessage ? (lang === 'ht' ? 'Sove modifikasyon' : 'Save edit') : (lang === 'ht' ? 'Voye' : 'Send')}
          >
            <i className={editingMessage ? 'fas fa-check' : 'fas fa-paper-plane'}></i>
          </button>`;

if (js.includes(sendBtnAnchor) && !js.includes('kot3-attachment-menu')) {
  js = js.replace(sendBtnAnchor, newSendBtnArea);
  console.log('STEP 5 OK: attachment menu + send button mode');
}

// Insert Reply/Edit banners ABOVE the footer
const footerAnchor = `            {/* Message input footer */}
            <div className="kot3-chat-footer">`;
const bannersBeforeFooter = `            {/* Reply/Edit/Attachment banners */}
            {replyingTo && (
              <div className="kot3-context-banner kot3-reply-banner">
                <div className="kot3-context-banner-icon"><i className="fas fa-reply"></i></div>
                <div className="kot3-context-banner-text">
                  <span className="kot3-context-banner-title">{lang === 'ht' ? 'Reponn a' : 'Replying to'} @{replyingTo.reply_to_sender || replyingTo.sender_username || 'user'}</span>
                  <span className="kot3-context-banner-snippet">{(replyingTo.content || '').slice(0, 80) || (lang === 'ht' ? '...' : '...')}</span>
                </div>
                <button type="button" className="kot3-context-banner-close" onClick={cancelReply} title={lang === 'ht' ? 'Anile' : 'Cancel'}>
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}
            {editingMessage && (
              <div className="kot3-context-banner kot3-edit-banner">
                <div className="kot3-context-banner-icon"><i className="fas fa-pen"></i></div>
                <div className="kot3-context-banner-text">
                  <span className="kot3-context-banner-title">{lang === 'ht' ? 'Modifye mesaj' : 'Editing message'}</span>
                  <span className="kot3-context-banner-snippet">{lang === 'ht' ? 'Sove oswa anile' : 'Save or cancel'}</span>
                </div>
                <button type="button" className="kot3-context-banner-close" onClick={cancelEdit} title={lang === 'ht' ? 'Anile' : 'Cancel'}>
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}
            {imagePreviewUrl && (
              <div className="kot3-image-preview">
                <img src={imagePreviewUrl} alt="preview" />
                <button type="button" className="kot3-image-preview-close" onClick={clearAttachedImage} title={lang === 'ht' ? 'Retire imaj la' : 'Remove image'}>
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}

            {/* Message input footer */}
            <div className="kot3-chat-footer">`;

if (js.includes(footerAnchor) && !js.includes('kot3-context-banner')) {
  js = js.replace(footerAnchor, bannersBeforeFooter);
  console.log('STEP 5b OK: reply/edit/attachment banners inserted above footer');
}

// ====================================================================
// 6. SCROLL FAB + SCROLL LISTENER
// ====================================================================
const typingBubbleAnchor = `{typingUsers[activeThread.id] && (
                <div className="kot3-typing-bubble">
                  <div className="kot3-typing-dot"></div>
                  <div className="kot3-typing-dot"></div>
                  <div className="kot3-typing-dot"></div>
                </div>
              )}
              <div ref={messagesEndRef} />`;

const scrollFabPatch = `{typingUsers[activeThread.id] && (
                <div className="kot3-typing-bubble">
                  <div className="kot3-typing-dot"></div>
                  <div className="kot3-typing-dot"></div>
                  <div className="kot3-typing-dot"></div>
                </div>
              )}
              <div ref={messagesEndRef} />
              {showScrollFab && (
                <button
                  type="button"
                  className="kot3-scroll-fab"
                  onClick={scrollToBottom}
                  title={lang === 'ht' ? 'Desann' : 'Jump to bottom'}
                >
                  <i className="fas fa-chevron-down"></i>
                </button>
              )}`;

if (js.includes(typingBubbleAnchor) && !js.includes('kot3-scroll-fab')) {
  js = js.replace(typingBubbleAnchor, scrollFabPatch);
  console.log('STEP 6 OK: scroll FAB rendered');
}

// Add scroll listener after messages scroll effect
const scrollEffectAnchor = `useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);`;
const newScrollEffect = `useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  useEffect(() => {
    if (!activeThread) { setShowScrollFab(false); return; }
    const el = messagesContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 200;
      const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < threshold;
      setShowScrollFab(!atBottom);
    };
    el.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [activeThread]);`;

if (js.includes(scrollEffectAnchor) && !js.includes("el.removeEventListener('scroll'")) {
  js = js.replace(scrollEffectAnchor, newScrollEffect);
  console.log('STEP 6b OK: scroll listener wired');
}

// ====================================================================
// 7. DARK MODE TOGGLE in top settings menu
// ====================================================================
const settingsMenuAnchor = `<div className="kot3-top-settings-menu">
                      <button onClick={() => { setIsContactPanelOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-user"></i>
                        <span>{lang === 'ht' ? 'Pwofil kontak' : 'Contact profile'}</span>
                      </button>
                      <button onClick={() => { setIsChatSearchOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-magnifying-glass"></i>
                        <span>{lang === 'ht' ? 'Chache' : 'Search'}</span>
                      </button>
                      <button onClick={() => { setIsContactInfoOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-circle-info"></i>
                        <span>{lang === 'ht' ? 'Enfòmasyon' : 'Info'}</span>
                      </button>
                      <button onClick={() => { loadMessages(activeThread.id); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-rotate-right"></i>
                        <span>{lang === 'ht' ? 'Rafrechi' : 'Refresh'}</span>
                      </button>
                    </div>`;

const newSettingsMenu = `<div className="kot3-top-settings-menu">
                      <button onClick={() => { setIsContactPanelOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-user"></i>
                        <span>{lang === 'ht' ? 'Pwofil kontak' : 'Contact profile'}</span>
                      </button>
                      <button onClick={() => { setIsChatSearchOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-magnifying-glass"></i>
                        <span>{lang === 'ht' ? 'Chache' : 'Search'}</span>
                      </button>
                      <button onClick={() => { setIsContactInfoOpen(true); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-circle-info"></i>
                        <span>{lang === 'ht' ? 'Enfòmasyon' : 'Info'}</span>
                      </button>
                      <button onClick={() => { loadMessages(activeThread.id); setIsTopSettingsOpen(false); }}>
                        <i className="fas fa-rotate-right"></i>
                        <span>{lang === 'ht' ? 'Rafrechi' : 'Refresh'}</span>
                      </button>
                      <div className="kot3-settings-divider"></div>
                      <button onClick={() => { toggleDarkMode(); setIsTopSettingsOpen(false); }}>
                        <i className={'fas ' + (isDarkMode ? 'fa-sun' : 'fa-moon')}></i>
                        <span>{isDarkMode ? (lang === 'ht' ? 'Mod klere' : 'Light mode') : (lang === 'ht' ? 'Mod fè nwa' : 'Dark mode')}</span>
                      </button>
                    </div>`;

if (js.includes(settingsMenuAnchor) && !js.includes('toggleDarkMode')) {
  js = js.replace(settingsMenuAnchor, newSettingsMenu);
  console.log('STEP 7 OK: dark mode toggle in top settings menu');
}

// ====================================================================
// 8. Container className to use isDarkMode for body
// ====================================================================
const containerClass = `return (
    <div className={\`kot3-container \${activeThread ? 'chat-active' : ''} \${localStorage.getItem('devrose_theme') === 'light' ? 'light-mode-chat' : ''}\`}>`;
const newContainerClass = `return (
    <div className={\`kot3-container \${activeThread ? 'chat-active' : ''} \${isDarkMode ? '' : 'light-mode-chat'}\`}>`;

if (js.includes(containerClass)) {
  js = js.replace(containerClass, newContainerClass);
  console.log('STEP 8 OK: container class wired to isDarkMode state');
}

fs.writeFileSync(JS, js);
console.log('TOTAL JSX length:', js.length);
