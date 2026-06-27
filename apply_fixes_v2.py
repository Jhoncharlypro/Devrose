#!/usr/bin/env python3
"""Robust plain-string Python rewrite of the creator preview-box JSX + appends CSS.
No fragile regex — uses direct string find + replace."""
JSX_FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
CSS_FILE = '/home/jhoncharlyreactive/.work/src/styles/kot3chat.css'

# ============================================================
# 1. JSX: find the kot3-preview-box opening and walk to its </div>.
# ============================================================
with open(JSX_FILE, 'r', encoding='utf-8') as f:
    jsx = f.read()

# Locate opening tag (allow any leading whitespace).
start_marker = 'className="kot3-preview-box"'
i = jsx.find(start_marker)
if i < 0:
    raise SystemExit('FATAL: kot3-preview-box not in file')

# Walk backwards to find the preceding '<div'.
open_idx = jsx.rfind('<div', 0, i)
if open_idx < 0:
    raise SystemExit('FATAL: could not find <div opening')

# Capture the leading indentation of the opening line.
line_start = jsx.rfind('\n', 0, open_idx) + 1
indent = jsx[line_start:open_idx]
print(f'[diag] open line indent = {len(indent)} spaces')

# Walk forward to find the matching closing </div>.
depth = 1
j = i + len(start_marker)
while j < len(jsx) and depth > 0:
    next_open = jsx.find('<div', j)
    next_close = jsx.find('</div>', j)
    if next_close == -1:
        raise SystemExit('FATAL: no closing </div> found')
    if next_open != -1 and next_open < next_close:
        depth += 1
        j = next_open + 4
    else:
        depth -= 1
        j = next_close + 6
end_close = j  # right after '</div>'

old_block = jsx[open_idx:end_close]
print(f'[diag] old preview-box block length = {len(old_block)}')

# Sanity-check we're not replacing too much.
if len(old_block) > 1500:
    print('[WARN] replacement block is large — verify before continuing')
    print(old_block)
    raise SystemExit('ABORT: too large')

# Compose new block (preserve original indent).
II = indent
new_block = (
    f'{II}<div className="kot3-preview-box"\n'
    f'{II}     style={{{{ background: statusCreatorImage ? \'#000\' : STATUS_PALETTE[activeGradIdx] }}}}>\n'
    f'{II}  {{statusCreatorImage ? (\n'
    f'{II}    <div className="kot3-preview-photo-wrap">\n'
    f'{II}      <img src={{{{statusCreatorImage}}}} alt="" className="kot3-preview-photo" />\n'
    f'{II}      <button\n'
    f'{II}        type="button"\n'
    f'{II}        className="kot3-preview-photo-remove"\n'
    f'{II}        onClick={{{{() => setStatusCreatorImage(\'\')}}}}\n'
    f'{II}        title={{{{lang === \'ht\' ? \'Retire foto a\' : \'Remove photo\'}}}}\n'
    f'{II}      >\n'
    f'{II}        <i className="fas fa-times"></i>\n'
    f'{II}      </button>\n'
    f'{II}    </div>\n'
    f'{II}  ) : (\n'
    f'{II}    <textarea\n'
    f'{II}      value={{{{statusCreatorText}}}}\n'
    f'{II}      onChange={{{{(e) => setStatusCreatorText(e.target.value)}}}}\n'
    f'{II}      placeholder={{{{lang === \'ht\' ? \'Ekri mesaj...\' : \'Type a message...\'}}}}\n'
    f'{II}      className={{{{\'kot3-preview-input font-\' + statusCreatorFont}}}}\n'
    f'{II}      maxLength={{{{120}}}}\n'
    f'{II}      rows={{{{4}}}}\n'
    f'{II}      style={{{{{{{{{{{{}}}}}}}}}}}}\n'
    # placeholder — drop style line entirely so we don't fight brace escaping
    f'{II}    />\n'
    f'{II}  )}}\n'
    f'{II}</div>'
)
print('[FAIL fix1] using a different strategy — write block directly')

# Simpler strategy: just rebuild a clean block with hard-coded indentation based on what
# we observed (16 spaces = 4 levels of 4 spaces).
clean_block = '''              <div className="kot3-preview-box"
                   style={{ background: statusCreatorImage ? '#000' : STATUS_PALETTE[activeGradIdx] }}>
                {statusCreatorImage ? (
                  <div className="kot3-preview-photo-wrap">
                    <img src={statusCreatorImage} alt="" className="kot3-preview-photo" />
                    <button
                      type="button"
                      className="kot3-preview-photo-remove"
                      onClick={() => setStatusCreatorImage('')}
                      title={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                    >
                      <i className="fas fa-times"></i>
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
new_jsx = jsx[:open_idx] + clean_block + jsx[end_close:]
print(f'[ok] JSX rewritten: BEFORE {len(jsx)} chars, AFTER {len(new_jsx)} chars; diff = {len(new_jsx)-len(jsx):+d}')

with open(JSX_FILE, 'w', encoding='utf-8') as f:
    f.write(new_jsx)

# ============================================================
# 2. Append the photo preview CSS rules at the end of kot3chat.css.
# ============================================================
with open(CSS_FILE, 'r', encoding='utf-8') as f:
    css = f.read()

photo_css = """

/* ===== Status creator photo preview (replaces textarea when image is set) ===== */
.kot3-preview-photo-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kot3-preview-photo {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  background-color: #000;
  border-radius: 8px;
  user-select: none;
  -webkit-user-drag: none;
}

.kot3-preview-photo-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background-color 0.15s, transform 0.15s;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

.kot3-preview-photo-remove:hover {
  background: var(--primary-color);
  transform: scale(1.06);
}

/* ===== Status viewer image: contain + aspect-ratio 9:16 portrait frame ===== */
.kot3-status-content {
  background-color: rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.kot3-status-container {
  /* If parent changes padding, update 40px magic delta below accordingly. */
  aspect-ratio: 9 / 16;
  max-width: calc((100dvh - 40px) * 9 / 16);
  background-color: transparent;
}

.kot3-status-media {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  margin: auto;
  background-color: #000;
  user-select: none;
  -webkit-user-drag: none;
}
"""

# Idempotent guard: only append if .kot3-preview-photo-wrap is not already present.
if '.kot3-preview-photo-wrap {' not in css:
    css = css + photo_css
    print('[ok] photo preview CSS appended')
else:
    print('[skip] photo preview CSS already present, not appending')

with open(CSS_FILE, 'w', encoding='utf-8') as f:
    f.write(css)
print(f'[ok] CSS size = {len(css)}')
