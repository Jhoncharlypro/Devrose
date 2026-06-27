#!/usr/bin/env python3
"""
apply_fixes_v4.py — surgical fix for the corrupted kot3-preview-box JSX.

The earlier apply_fixes_v3.py used a depth-walker that ended on the inner
</div> (closing kot3-preview-photo-wrap) instead of the outer one, leaving
the file with a duplicated textarea and a stray closing tag.

Strategy: read the file, find the EXACT broken pattern (deterministic),
replace it with one clean block. Idempotent — running twice is a no-op.
"""

import os
import sys

ROOT = '/home/jhoncharlyreactive/.work'
JSX = os.path.join(ROOT, 'src/components/Kot3Chat.jsx')

# Backup (just in case)
bk = JSX + '.bk-v4'
if not os.path.exists(bk):
    with open(JSX, 'r', encoding='utf-8') as f:
        data = f.read()
    with open(bk, 'w', encoding='utf-8') as f:
        f.write(data)

with open(JSX, 'r', encoding='utf-8') as f:
    src = f.read()

# ---- Detected broken pattern (from diagnostic awk output, lines 3052-3076) ----
BROKEN = '''                                <div className="kot3-preview-box" style={{ background: statusCreatorImage ? '#000' : STATUS_PALETTE[activeGradIdx] }}>
                {statusCreatorImage ? (
                  <div className="kot3-preview-photo-wrap">
                    <img
                      src={statusCreatorImage}
                      alt={lang === 'ht' ? 'AperM-CM-'u foto' : 'Photo preview'}
                      className="kot3-preview-photo"
                    />
                    <button
                      type="button"
                      className="kot3-preview-photo-remove"
                      onClick={() => setStatusCreatorImage('')}
                      title={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                      aria-label={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                    >
                      <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={statusCreatorText}
                    onChange={(e) => setStatusCreatorText(e.target.value)}
                    placeholder={lang === 'ht' ? 'Ekri mesaj...' : 'Type a message...'}
                    className={'kot3-preview-input font-' + statusCreatorFont}
                    maxLength={120}
                    rows={4}
                    style={{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family }}
                  />
                )}
              </div>
                ) : (
                  <textarea
                    value={statusCreatorText}
                    onChange={(e) => setStatusCreatorText(e.target.value)}
                    placeholder={lang === 'ht' ? 'Ekri mesaj...' : 'Type a message...'}
                    className={'kot3-preview-input font-' + statusCreatorFont}
                    maxLength={120}
                    rows={4}
                    style={{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family }}
                  />
                )}
              </div>'''

# ---- Clean replacement (single correctly-closed block) ----
# Use 16-space indent for the wrapper, 18-space for the inner conditional,
# 20-space for the photo-wrap, etc. — consistent with surrounding creator-card.
CLEAN = '''              <div
                className="kot3-preview-box"
                style={{ background: statusCreatorImage ? '#000' : STATUS_PALETTE[activeGradIdx] }}
              >
                {statusCreatorImage ? (
                  <div className="kot3-preview-photo-wrap">
                    <img
                      src={statusCreatorImage}
                      alt={lang === 'ht' ? 'Aperç\u00e7u foto' : 'Photo preview'}
                      className="kot3-preview-photo"
                    />
                    <button
                      type="button"
                      className="kot3-preview-photo-remove"
                      onClick={() => setStatusCreatorImage('')}
                      title={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                      aria-label={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                    >
                      <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={statusCreatorText}
                    onChange={(e) => setStatusCreatorText(e.target.value)}
                    placeholder={lang === 'ht' ? 'Ekri mesaj...' : 'Type a message...'}
                    className={'kot3-preview-input font-' + statusCreatorFont}
                    maxLength={120}
                    rows={4}
                    style={{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family }}
                  />
                )}
              </div>'''

if BROKEN not in src:
    # Try a tolerant variant: the actual literal in file may use a literal " (U+00E7) instead of M-CM- escape
    # Diagnostic showed 'AperM-CM-'u foto' which is the cat -A rendering of bytes 0xC3 0xA7 ("ç") as "M-CM-".
    # So the actual file content has 'Aperçu foto'. Try matching with the real char.
    BROKEN2 = BROKEN.replace('AperM-CM-\'u foto', 'Aper\u00e7u foto')
    if BROKEN2 in src:
        src = src.replace(BROKEN2, CLEAN, 1)
        with open(JSX, 'w', encoding='utf-8') as f:
            f.write(src)
        print(f'JSX: kot3-preview-box block repaired (BROKEN2 literal, {len(BROKEN2)} -> {len(CLEAN)} chars)')
    else:
        print('ERROR: broken block not found verbatim, attempting regex match', file=sys.stderr)
        import re
        # tolerant regex: match from kot3-preview-box to the closing </div></div>
        # The signature: aria-label line + i + /button + /div + ) : ( + textarea + )} + </div>
        pattern = re.compile(
            r'<div\s+className="kot3-preview-box"[^>]*>\s*\{statusCreatorImage\s*\?\s*\(\s*<div[^>]*>\s*<img[^/]*/>\s*<button[^>]*aria-label[^>]*>\s*<i[^>]*></i>\s*</button>\s*</div>\s*\)\s*:\s*\(\s*<textarea[^>]*?/>\s*\)\s*\}\s*</div>\s*\)\s*:\s*\(\s*<textarea[^>]*?/>\s*\)\s*\}\s*</div>',
            re.DOTALL,
        )
        m = pattern.search(src)
        if m:
            src = src[:m.start()] + CLEAN + src[m.end():]
            with open(JSX, 'w', encoding='utf-8') as f:
                f.write(src)
            print(f'JSX: kot3-preview-box block repaired via regex ({len(m.group())} -> {len(CLEAN)} chars)')
        else:
            print('ERROR: even regex match failed. File is in unrecoverable state.', file=sys.stderr)
            sys.exit(1)
else:
    src = src.replace(BROKEN, CLEAN, 1)
    with open(JSX, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'JSX: kot3-preview-box block repaired ({len(BROKEN)} -> {len(CLEAN)} chars)')

# ---- Also revert the TEXT-tab onClick back to simple form (the v3 change introduced a
#      UX race: the new handler asks confirm AFTER switching tab). If present, fix order. ----
OLD_CLICK_TEXT = (
    "onClick={() => {\n"
    "                            setStatusCreatorTab('text');\n"
    "                            if (statusCreatorImage && !window.confirm(lang === 'ht' ? 'Sa ap efase foto a. Kontinye?' : 'This will discard your photo. Continue?')) return;\n"
    "                            setStatusCreatorImage('');\n"
    "                          }}"
)
NEW_CLICK_TEXT = (
    "onClick={() => {\n"
    "                            if (statusCreatorImage && !window.confirm(lang === 'ht' ? 'Sa ap efase foto a, ou vl\u00e8 kons\u00e8ve l? ' : 'This will discard your photo. Continue?')) return;\n"
    "                            setStatusCreatorTab('text');\n"
    "                            setStatusCreatorImage('');\n"
    "                          }}"
)
with open(JSX, 'r', encoding='utf-8') as f:
    cur = f.read()
if OLD_CLICK_TEXT in cur:
    cur = cur.replace(OLD_CLICK_TEXT, NEW_CLICK_TEXT, 1)
    with open(JSX, 'w', encoding='utf-8') as f:
        f.write(cur)
    print('JSX: TEXT-tab onClick reordered so confirm happens BEFORE state updates')
