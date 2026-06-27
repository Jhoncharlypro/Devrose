#!/usr/bin/env python3
"""Fix the picker translation lookup to use existing theme_<id> keys."""
FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# ---- 1. Fix the translations[lang].theme_names lookup to use the correct
#       per-language theme_<id> keys that already exist in translations.js.
OLD_LOOKUP = """    const meta = THEME_BY_ID[t.id] || {};
    const themeName = (translations && translations[lang] && translations[lang].theme_names && translations[lang].theme_names[t.id]) || t.label;"""

NEW_LOOKUP = """    const meta = THEME_BY_ID[t.id] || {};
    const trForLang = (translations && translations[lang]) || {};
    // Existing translations expose `theme_<id>` keys per language (theme_dark, theme_messenger_light, etc.).
    const themeName = trForLang['theme_' + t.id] || t.label;
    const applyLabel = trForLang.theme_apply || ('Apply ' + t.label);"""

if OLD_LOOKUP not in src:
    print('[FATAL] themeNames lookup anchor not found')
    raise SystemExit(1)
src = src.replace(OLD_LOOKUP, NEW_LOOKUP, 1)
print('[OK] themeNames/fallback updated')

# ---- 2. Fix chip `title` to use the localized applyLabel.
OLD_TITLE = """        title={{'Apply ' + t.label}}"""
NEW_TITLE = """        title={{applyLabel}}"""
if OLD_TITLE not in src:
    print('[WARN] chip title anchor not found')
else:
    src = src.replace(OLD_TITLE, NEW_TITLE, 1)
    print('[OK] chip title uses localized applyLabel')

# ---- 3. Defensive: also fix the theme_section label fallback to be tolerant
#       of missing translations (already chained in the JSX; ensure it works).
# Already chained as `translations[lang]?.theme_section || 'Theme'` so nothing to add.

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(src)

print('file size:', len(src))
