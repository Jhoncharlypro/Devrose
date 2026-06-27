#!/usr/bin/env python3
"""Read the exact current picker code in Kot3Chat.jsx to find correct anchors."""
FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# Find the picker block
start = src.find('<div className="kot3-top-settings-menu">')
end = src.find('</div>\n                  )}', start)
if end < 0:
    end = start + 4000

picker_block = src[start:start + 3500]
print('=== EXACT picker block ===')
print(repr(picker_block[:2000]))
print('---')
print(picker_block[2000:3500])
print()
print('=== THEME_BY_ID lines ===')
for i, line in enumerate(src.split('\n')):
    if 'themeName' in line or 'theme_apply' in line or 'Apply ' in line or "'theme_'+t.id" in line:
        print(f'line {i+1}: {line!r}')
