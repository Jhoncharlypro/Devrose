#!/usr/bin/env python3
"""Apply JSX + CSS fixes for status photo rendering — robust against whitespace drift."""
import re

JSX_FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
CSS_FILE = '/home/jhoncharlyreactive/.work/src/styles/kot3chat.css'

# ============================================================
# 1. JSX: rewrite the kot3-preview-box so the uploaded photo
#    is shown in the preview area (currently the preview-box
#    only ever renders a textarea, regardless of selected tab).
# ============================================================
with open(JSX_FILE, 'r', encoding='utf-8') as f:
    jsx = f.read()

# Anchor: the OLD preview-box start. Match whatever leading whitespace it has.
old_pattern = re.compile(
    r'(<div\s+className="kot3-preview-box"\s+style=\{\{[^}]*\}\}\s*>\s*)'
    r'(.*?)'
    r'(</div>\s*<!--\s*Text vs Photo picker',
    re.DOTALL
)
# Simpler: locate just the start of the kot3-preview-box and the closing </div>
# before the next block (font picker / palette). Use a search for the
# opening line and capture until </div> at the same depth.
start_re = re.compile(
    r'<div\s+className="kot3-preview-box"\s+style=\{\{[^}]*\}\}>',
    re.IGNORECASE,
)
m = start_re.search(jsx)
if not m:
    raise SystemExit('FATAL: kot3-preview-box start not found')

# Walk forward to find the closing </div>. The opening <div ...> counts as +1.
start = m.end()
depth = 1
i = start
while i < len(jsx) and depth > 0:
    if jsx[i:i+4] == '<div':
        depth += 1
        i += 4
    elif jsx[i:i+6] == '</div>':
        depth -= 1
        if depth == 0:
            break
        i += 6
    else:
        i += 1
end_close = i + 6  # include '</div>'
old_block = jsx[m.start():end_close]
print(f'[diag] old preview-box block (length={len(old_block)}):')
print(old_block[:400])
print('...')

# Build the new block. Use the same style approach as before, but conditional.
# Two branches: statusCreatorImage -> render photo, else textarea.
new_block_lines = [
    '{INDENT}<div className="kot3-preview-box"',
    '{INDENT}     style={{ background: statusCreatorImage ? \'#000\' : STATUS_PALETTE[activeGradIdx] }}>',
    '{INDENT}  {{statusCreatorImage ? (',
    '{INDENT}    <div className="kot3-preview-photo-wrap">',
    '{INDENT}      <img src={{statusCreatorImage}} alt="" className="kot3-preview-photo" />',
    '{INDENT}      <button',
    '{INDENT}        type="button"',
    '{INDENT}        className="kot3-preview-photo-remove"',
    '{INDENT}        onClick={{() => setStatusCreatorImage(\'\')}}',
    '{INDENT}        title={{lang === \'ht\' ? \'Retire foto a\' : \'Remove photo\'}}',
    '{INDENT}      >',
    '{INDENT}        <i className="fas fa-times"></i>',
    '{INDENT}      </button>',
    '{INDENT}    </div>',
    '{INDENT}  ) : (',
    '{INDENT}    <textarea',
    '{INDENT}      value={{statusCreatorText}}',
    '{INDENT}      onChange={{(e) => setStatusCreatorText(e.target.value)}}',
    '{INDENT}      placeholder={{lang === \'ht\' ? \'Ekri mesaj...\' : \'Type a message...\'}}',
    '{INDENT}      className={{\'kot3-preview-input font-\' + statusCreatorFont}}',
    '{INDENT}      maxLength={{120}}',
    '{INDENT}      rows={{4}}',
    '{INDENT}      style={{{{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family }}}}',
    '{INDENT}    />',
    '{INDENT}  )}}',
    '{INDENT}</div>',
]

# We have to compute the right indentation from how nested the preview-box is.
# In current file, kot3-preview-box is at indentation of 16 spaces (4 levels × 4).
# But to be safe count leading whitespace of the matched <div>.
indent = re.match(r'^(\s*)', old_block).group(1)
print(f'[diag] old block indent = {len(indent)} spaces')

new_block_str = '\n'.join(line.format(INDENT=indent) for line in new_block_lines)
print('[diag] new preview-box block:')
print(new_block_str)

# Replace.
new_jsx = jsx[:m.start()] + new_block_str + jsx[end_close:]
with open(JSX_FILE, 'w', encoding='utf-8') as f:
    f.write(new_jsx)
print(f'[ok] JSX replaced; new file size = {len(new_jsx)}')

# ============================================================
# 2. CSS: append the new helper classes for photo preview at the
#    end of kot3chat.css (right before the very last @media + spin block).
# ============================================================
with open(CSS_FILE, 'r', encoding='utf-8') as f:
    css = f.read()

CSS_INSERT = (
    "\n/* ===== Status creator photo preview (replaces textarea when image is set) ===== */\n"
    ".kot3-preview-photo-wrap {\n"
    "  position: relative;\n"
    "  width: 100%;\n"
    "  height: 100%;\n"
    "  display: flex;\n"
    "  align-items: center;\n"
    "  justify-content: center;\n"
    "}\n"
    ".kot3-preview-photo {\n"
    "  max-width: 100%;\n"
    "  max-height: 100%;\n"
    "  width: auto;\n"
    "  height: auto;\n"
    "  object-fit: contain;\n"
    "  background-color: #000;\n"
    "  border-radius: 8px;\n"
    "  user-select: none;\n"
    "  -webkit-user-drag: none;\n"
    "}\n"
    ".kot3-preview-photo-remove {\n"
    "  position: absolute;\n"
    "  top: 8px;\n"
    "  right: 8px;\n"
    "  width: 30px;\n"
    "  height: 30px;\n"
    "  border-radius: 50%;\n"
    "  border: none;\n"
    "  background: rgba(0, 0, 0, 0.72);\n"
    "  color: #fff;\n"
    "  cursor: pointer;\n"
    "  display: flex;\n"
    "  align-items: center;\n"
    "  justify-content: center;\n"
    "  font-size: 12px;\n"
    "  transition: background-color 0.15s, transform 0.15s;\n"
    "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);\n"
    "}\n"
    ".kot3-preview-photo-remove:hover {\n"
    "  background: var(--primary-color);\n"
    "  transform: scale(1.06);\n"
    "}\n"
)

# Insert just before the very last `@keyframes kot3-spin` block (the CSS is normally
# closed by `@media (max-width: 768px) {...}` followed by the keyframes).
marker = '\n/* Responsive transitions for screen sizes */'
if marker in css:
    css = css.replace(marker, CSS_INSERT + marker, 1)
    print('[ok] CSS inserted before responsive marker')
else:
    # fallback: just append
    css = css + CSS_INSERT
    print('[ok] CSS appended at end (responsive marker missing)')

with open(CSS_FILE, 'w', encoding='utf-8') as f:
    f.write(css)
print(f'[ok] CSS final size = {len(css)}')
