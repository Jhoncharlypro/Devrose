#!/usr/bin/env python3
"""Fix picker JSX translation lookup to use existing `theme_<id>` keys.
Uses regex so we tolerate indentation differences."""
import re

FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# 1) Replace the broken `theme_names` lookup pattern.
#    Pattern matches: translations && translations[lang] && translations[lang].theme_names && translations[lang].theme_names[t.id]) || t.label
PATTERN = re.compile(
    r"const\s+trForLang\s*=\s*\([^)]*\)\s*\|\|\s*\{\};[\s\S]*?const\s+applyLabel\s*=\s*trForLang\.theme_apply\s*\|\|\s*\([^)]*\);"
)
# 1) just match the lookup expression and replace
pattern_old_label = re.compile(
    r"(\s+)const\s+themeName\s*=\s*\(\s*translations\s*&&\s*translations\[lang\]\s*&&\s*translations\[lang\]\.theme_names\s*&&\s*translations\[lang\]\.theme_names\[t\.id\]\s*\)\s*\|\|\s*t\.label\s*;"
)

new_label_block = (
    "\n{indent}const trForLang = (translations && translations[lang]) || {};\n"
    "{indent}// Existing translations expose per-language `theme_<id>` keys (theme_dark, theme_messenger_light, ...).\n"
    "{indent}const themeName = trForLang['theme_' + t.id] || t.label;\n"
    "{indent}const applyLabel = trForLang.theme_apply || ('Apply ' + t.label);"
)

# Find each match and remember its leading whitespace (indent)
def repl(m):
    indent = m.group(1)
    return new_label_block.format(indent=indent)

src2, n = pattern_old_label.subn(repl, src)
print(f'[fix1] replaced themeName block: {n} match(es)')

# 2) Replace title='Apply ' + t.label with title={applyLabel}
pattern_title = re.compile(r"title\s*=\s*\{\{\s*'Apply '\s*\+\s*t\.label\s*\}\}")
src2, n2 = pattern_title.subn("title={{applyLabel}}", src2)
print(f'[fix2] replaced title to applyLabel: {n2} match(es)')

if n == 0 and n2 == 0:
    print('[WARN] no replacements made; let me show what is in the picker')
    start = src.find('<div className="kot3-top-settings-menu">')
    if start >= 0:
        print(repr(src[start:start+2200]))
    raise SystemExit(0)

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(src2)

print('file size:', len(src2))
