#!/usr/bin/env python3
"""Plain Python find-and-replace for picker lookup + title. No regex, no format()."""
FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# ---- 1. Replace the broken themeName lookup ----
# The exact problematic assignment line. Find presence; should be 1 occurrence.
old_themeName = "translations[lang].theme_names && translations[lang].theme_names[t.id]) || t.label"
if old_themeName in src:
    # Find the leading const themeName = ( part to capture the indent & leading line
    head_marker = "const themeName = (translations && translations[lang] && "
    tail_marker = old_themeName
    head_idx = src.find(head_marker)
    if head_idx < 0:
        print('[FATAL] cannot find themeName declaration')
        raise SystemExit(1)
    tail_idx = src.find(tail_marker, head_idx)
    if tail_idx < 0:
        print('[FATAL] cannot find tail marker')
        raise SystemExit(1)
    # capture the captured indent (whitespace before `const themeName`)
    line_start = src.rfind('\n', 0, head_idx) + 1
    indent = src[line_start:head_idx]
    print(f'[info] indent on themeName line = {len(indent)} spaces (repr={indent!r})')

    # Build the new block using the captured indent.
    new_lines = [
        '',
        indent + "const trForLang = (translations && translations[lang]) || {};\n",
        indent + "// Existing translations expose per-language `theme_<id>` keys (theme_dark, theme_messenger_light, ...).\n",
        indent + "const themeName = trForLang['theme_' + t.id] || t.label;\n",
        indent + "const applyLabel = trForLang.theme_apply || ('Apply ' + t.label);"
    ]
    new_block = ''.join(new_lines)

    # Replace from `const themeName` start through the `;` after `t.label`
    semicolon_idx = src.find(';', tail_idx)
    end_idx = semicolon_idx + 1
    src = src[:head_idx] + new_block + src[end_idx:]
    print('[OK] themeName lookup replaced')
else:
    print('[WARN] old_themeName marker not found - may already be fixed')

# ---- 2. Replace title={'Apply ' + t.label} with title={applyLabel} ----
old_title = "title={{'Apply ' + t.label}}"
new_title = "title={{applyLabel}}"
if old_title in src:
    src = src.replace(old_title, new_title, 1)
    print('[OK] chip title uses applyLabel')
else:
    print('[WARN] old_title not found - may already be fixed')

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(src)

print('final file size:', len(src))

# Show the result for verification
import re
print()
print('=== Lines around the picker chip near `trForLang` ===')
m = re.search(r'trForLang.*?;\n', src)
if m:
    start = src.rfind('\n', 0, m.start()) + 1
    end = src.find('\nconst', m.end())
    if end < 0:
        end = m.end() + 500
    print(src[start:end])
