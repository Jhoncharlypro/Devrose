#!/usr/bin/env python3
"""
Apply code-reviewer feedback for status photo fixes (v3).

Goals:
  1. Dedupe duplicate `.kot3-status-content` rule in CSS.
  2. Add `vh` fallback for `dvh` in status container max-width.
  3. Add `:focus-visible` to `.kot3-preview-photo-remove`.
  4. Add alt text to photo preview img.
  5. Normalize kot3-preview-box indentation in JSX.
  6. Improve UX: switch Text-tab only clears image when an image is currently set
     (use window.confirm when present, otherwise silent).
"""

import os
import re

ROOT = '/home/jhoncharlyreactive/.work'
JSX = os.path.join(ROOT, 'src/components/Kot3Chat.jsx')
CSS = os.path.join(ROOT, 'src/styles/kot3chat.css')


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write(path, s):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(s)


# ----------------------------------------------------------------------
# 1. JSX: normalize kot3-preview-box indentation + localized alt +
#         safer Text-tab image clear UX.
# ----------------------------------------------------------------------

jsx_src = read(JSX)

# Find the kot3-preview-box block: from "<div className=\"kot3-preview-box\"" through closing `</div>` of the wrapper, before the next kot3-creator-tool-row.
# We use a robust approach: anchor on the unique opening JSX line, then walk forward to close.

OLD_BLOCK_START = '<div className="kot3-preview-box"\n                   style={{ background: statusCreatorImage ? \'#000\' : STATUS_PALETTE[activeGradIdx] }}>\n                {statusCreatorImage ? (\n                  <div className="kot3-preview-photo-wrap">\n                    <img src={statusCreatorImage} alt="" className="kot3-preview-photo" />'

# Try a simpler anchor first: the original messy block (or variants with different indent)
candidates = [
    OLD_BLOCK_START,
    # fallback anchor with original exact whitespace from earlier diagnostic
    '''                                <div className="kot3-preview-box"
                   style={{ background: statusCreatorImage ? '#000' : STATUS_PALETTE[activeGradIdx] }}>
                {statusCreatorImage ? (
                  <div className="kot3-preview-photo-wrap">
                    <img src={statusCreatorImage} alt="" className="kot3-preview-photo" />''',
]

start_idx = -1
matched = None
for cand in candidates:
    i = jsx_src.find(cand)
    if i != -1:
        start_idx = i
        matched = cand
        break

# Try regex tolerant version if direct find failed
if start_idx == -1:
    pattern = re.compile(
        r'<div\s+className="kot3-preview-box"\s*\n\s*style=\{\{\s*background:\s*statusCreatorImage\s*\?\s*\'#000\'\s*:\s*STATUS_PALETTE\[activeGradIdx\]\s*\}\}\s*>\s*\n\s*\{statusCreatorImage\s*\?\s*\(\s*\n\s*<div\s+className="kot3-preview-photo-wrap"\s*>\s*\n\s*<img\s+src=\{statusCreatorImage\}\s+alt=""\s+className="kot3-preview-photo"\s*/>',
        re.DOTALL,
    )
    m = pattern.search(jsx_src)
    if m:
        start_idx = m.start()
        matched = m.group()

if start_idx == -1:
    raise SystemExit('ERROR: could not locate kot3-preview-box opening block')

# Find the matching closing `</div>` for the kot3-preview-box wrapper.
# Walk forward, tracking depth of balanced <div ...> and </div> tokens.
end_pattern = re.compile(r'</div>')
# Start scanning after start_idx
depth = 0
scan = jsx_src[start_idx:]
pos = 0
end_local = -1
while True:
    m_open = re.search(r'<div\b', scan[pos:])
    m_close = end_pattern.search(scroll if False else scan[pos:])
    # find next <div or </div>
    next_open = m_open.start() if m_open else None
    next_close = m_close.start() if m_close else None
    if next_open is None and next_close is None:
        break
    if next_close is not None and (next_open is None or next_close < next_open):
        depth -= 1
        pos = next_close + len('</div>')
        if depth == 0:
            end_local = pos
            break
    else:
        depth += 1
        pos = next_open + len('<div')
        pos = (re.search(r'>', scan[pos:]) or type('', (), {'start': pos, 'end': pos})()).end() + pos if False else pos

    # alt implementation: use a clean fragment loop
    # We'll restart cleanly:
    break

# Simpler deterministic walk: count <div ...> opens vs </div> closes from start_idx
i = start_idx
depth = 0  # 0 = at the same level as the outer <div kot3-preview-box>
end_idx = -1
# Skip past the opening tag first: find '>' that closes the <div kot3-preview-box ...>
opening_close = jsx_src.find('>', jsx_src.find('style={', start_idx))
if opening_close == -1:
    raise SystemExit('ERROR: cannot find opening tag close for kot3-preview-box')
i = opening_close + 1
while i < len(jsx_src):
    # find next <div or </div>
    a = jsx_src.find('<div', i)
    b = jsx_src.find('</div>', i)
    if b == -1:
        break
    if a != -1 and a < b:
        # <div at a: it's an opening tag
        # find its closing > (skipping the bracket attr)
        # also ensure it's actually <div (not <divX), simple check
        if jsx_src[a+4] in ' \t\n>':
            depth += 1
            # jump to after the >
            close = jsx_src.find('>', a)
            i = close + 1
        else:
            # some other tag starting with <div... advance past it
            close = jsx_src.find('>', a)
            i = close + 1
    else:
        # </div>
        depth -= 1
        i = b + len('</div>')
        if depth == 0:
            end_idx = i
            break

if end_idx == -1:
    raise SystemExit('ERROR: could not locate closing </div> for kot3-preview-box')

old_block = jsx_src[start_idx:end_idx]

# Build the new block with consistent 16-space indent (matching surrounding creator-card body).
NEW_BLOCK = '''<div className="kot3-preview-box" style={{ background: statusCreatorImage ? '#000' : STATUS_PALETTE[activeGradIdx] }}>
                {statusCreatorImage ? (
                  <div className="kot3-preview-photo-wrap">
                    <img
                      src={statusCreatorImage}
                      alt={lang === 'ht' ? 'Aperçu foto' : 'Photo preview'}
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

if old_block.strip() == NEW_BLOCK.strip():
    print('JSX indentation already normalized (no change needed)')
else:
    new_jsx_src = jsx_src[:start_idx] + NEW_BLOCK + jsx_src[end_idx:]
    write(JSX, new_jsx_src)
    print(f'JSX: kot3-preview-box block normalized ({len(old_block)} -> {len(NEW_BLOCK)} chars)')

# Also patch the TEXT-tab onClick handler to confirm before clearing image.
OLD_TEXT_CLICK = "onClick={() => { setStatusCreatorTab('text'); setStatusCreatorImage(''); }}"
NEW_TEXT_CLICK = (
    "onClick={() => {\n"
    "                            setStatusCreatorTab('text');\n"
    "                            if (statusCreatorImage && !window.confirm(lang === 'ht' ? 'Sa ap efase foto a. Kontinye?' : 'This will discard your photo. Continue?')) return;\n"
    "                            setStatusCreatorImage('');\n"
    "                          }}"
)
if OLD_TEXT_CLICK in jsx_src:
    jsx_src = read(JSX)
    jsx_src = jsx_src.replace(OLD_TEXT_CLICK, NEW_TEXT_CLICK, 1)
    write(JSX, jsx_src)
    print('JSX: TEXT-tab image-clear now confirms before discarding')
else:
    print('JSX: TEXT-tab onClick already updated or not in expected form (skipping)')

# ----------------------------------------------------------------------
# 2. CSS: dedupe .kot3-status-content, add vh fallback, focus-visible.
# ----------------------------------------------------------------------

css_src = read(CSS)

# Find the ORIGINAL `.kot3-status-content {` block (around line 1948) and remove its redundant
# overflow/background properties (so the LATEST block at the bottom is the only one).
# We'll find both occurrences and merge their properties by removing the duplicate.

# Strategy: detect the FIRST occurrence of `.kot3-status-content {` and remove its inner
# bg-color and overflow rules (only if they exist); they will be provided by the LATER block.
first_match = re.search(r'(\n\.kot3-status-content\s*\{)([^}]*)(\}\n)', css_src)
if first_match:
    inner = first_match.group(2)
    new_inner = inner
    # remove bg-color if present (preserve others)
    new_inner = re.sub(r'\n\s*background-color:\s*[^;]+;\s*', '\n', new_inner)
    if 'background-color' not in new_inner or 'background-color' in inner:
        new_inner_changed = new_inner != inner
        new_block = first_match.group(1) + new_inner + first_match.group(3)
        new_css_src = css_src[:first_match.start()] + new_block + css_src[first_match.end():]
        css_src = new_css_src
        print(f'CSS: removed redundant bg-color from first .kot3-status-content rule (changed={new_inner_changed})')

# Now patch the LATER .kot3-status-container rule to include vh fallback.
OLD_MAX_WIDTH = 'max-width: calc((100dvh - 40px) * 9 / 16);'
NEW_MAX_WIDTH = (
    'max-width: min(440px, 90vw, (100vh - 40px) * 9 / 16, (100dvh - 40px) * 9 / 16);'
)
if OLD_MAX_WIDTH in css_src:
    css_src = css_src.replace(OLD_MAX_WIDTH, NEW_MAX_WIDTH, 1)
    print('CSS: added vh fallback + min() cap to status container max-width')
else:
    print('CSS: max-width rule already updated or not found in expected form')

# Add :focus-visible to .kot3-preview-photo-remove (insert after :hover block).
# The :hover block ends with `.kot3-preview-photo-remove:hover { ... }` followed by the new
# .kot3-status-content block. We'll insert :focus-visible right after the :hover block.
focus_rule = (
    "\n.kot3-preview-photo-remove:focus-visible {\n"
    "  outline: 2px solid var(--primary-color, #e91e63);\n"
    "  outline-offset: 2px;\n"
    "  background: rgba(0, 0, 0, 0.85);\n"
    "}"
)
HOOK = '.kot3-preview-photo-remove:hover {'
# Find hover rule + close
hover_open = css_src.find(HOOK)
if hover_open != -1:
    # find next }
    hover_close = css_src.find('}', hover_open)
    if hover_close != -1:
        insert_at = hover_close + 1
        if '.kot3-preview-photo-remove:focus-visible' not in css_src:
            css_src = css_src[:insert_at] + focus_rule + css_src[insert_at:]
            print('CSS: added :focus-visible for .kot3-preview-photo-remove')
        else:
            print('CSS: :focus-visible already present')

write(CSS, css_src)
print('CSS: saved')
