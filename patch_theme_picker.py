#!/usr/bin/env python3
"""
Insert the theme picker JSX block into kot3-top-settings-menu in Kot3Chat.jsx.
Uses dict-based replacement to avoid heredoc/JSON escaping issues.
"""
FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# Targets: replace the existing 4-button menu div with the same 4 buttons +
# the new theme picker section. Indentation matches the kot3-top-settings-menu.
OLD_MENU_HEAD = '                    <div className="kot3-top-settings-menu">'

# The original 4 buttons we keep verbatim
OLD_BUTTONS = """                      <button onClick={() => { setIsContactPanelOpen(true); setIsTopSettingsOpen(false); }}>
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
                      </button>"""

# Build the new picker section (clean JSX, no string concat hacks).
T = "                      "  # 22-space indent

picker_jsx = f"""
{T}<div className="kot3-settings-divider"></div>

{T}<div className="kot3-theme-section-label">
{T}  <i className="fas fa-palette"></i>
{T}  <span>{{(translations && translations[lang] && translations[lang].theme_section) || 'Theme'}}</span>
{T}</div>
{T}<div className="kot3-theme-grid" role="radiogroup" aria-label="Theme">
{T}  {{THEMES.map((t) => {{
{T}    const isActive = activeTheme === t.id;
{T}    const meta = THEME_BY_ID[t.id] || {{}};
{T}    const themeName = (translations && translations[lang] && translations[lang].theme_names && translations[lang].theme_names[t.id]) || t.label;
{T}    const swatchStyle = {{
{T}      background: meta.bg || ('linear-gradient(135deg,' + t.accent + ',#111)'),
{T}      borderColor: meta.isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'
{T}    }};
{T}    return (
{T}      <button
{T}        key={{t.id}}
{T}        type="button"
{T}        role="radio"
{T}        aria-checked={{isActive}}
{T}        className={{'kot3-theme-chip' + (isActive ? ' active' : '')}}
{T}        onClick={{() => setTheme(t.id)}}
{T}        title={{'Apply ' + t.label}}
{T}        data-theme-id={{t.id}}
{T}      >
{T}        <span className="kot3-theme-emoji" aria-hidden="true">{{t.emoji}}</span>
{T}        <span className="kot3-theme-swatch" aria-hidden="true" style={{swatchStyle}}></span>
{T}        <span className="kot3-theme-name">{{themeName}}</span>
{T}        {{isActive && <i className="fas fa-check kot3-theme-check" aria-hidden="true"></i>}}
{T}      </button>
{T}    );
{T}  }})}}
{T}</div>"""

NEW_MENU = (
    f"{T}<div className=\"kot3-top-settings-menu\">\n"
    f"{OLD_BUTTONS}\n"
    f"{picker_jsx}\n"
    f"{T}</div>"
)

# Now locate the OLD menu block precisely - find the head, then scan to its closing </div>
idx = src.find(OLD_MENU_HEAD)
if idx < 0:
    raise SystemExit("ERROR: OLD_MENU_HEAD not found in file")

# Walk forward carefully: the menu is `<div className="kot3-top-settings-menu"> ... </div>`.
# We track JSX depth by counting `<div` opens and `</div>` closes.
# We're starting from the opening tag position.
i = idx
depth = 0
end = -1
in_string = None  # None | ' | " | `
while i < len(src):
    c = src[i]
    # Handle JS string literals to avoid counting braces/quotes inside them
    if in_string:
        if c == '\\':
            i += 2
            continue
        if c == in_string:
            in_string = None
        i += 1
        continue
    if c in ("'", '"', '`'):
        in_string = c
        i += 1
        continue
    if c == '{':
        depth += 1
        i += 1
        continue
    if c == '}':
        depth -= 1
        i += 1
        continue
    if src[i:i+4] == '<div' and (i == idx or not src[i-1].isalnum()):
        # opening div tag
        depth_jsx = 1
        j = i + 4
        # find matching </div> at same depth
        while j < len(src):
            if src[j:j+4] == '<div':
                depth_jsx += 1
                j += 4
            elif src[j:j+6] == '</div>':
                depth_jsx -= 1
                if depth_jsx == 0:
                    end = j + 6
                    break
                j += 6
            else:
                j += 1
        break
    i += 1

if end < 0:
    raise SystemExit("ERROR: could not find closing </div> for kot3-top-settings-menu")

old_block = src[idx:end]
new_src = src[:idx] + NEW_MENU + src[end:]

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(new_src)

print(f'OK: replaced menu block (chars {idx}..{end}, len {len(old_block)} -> {len(NEW_MENU)})')
print(f'file: {len(src)} -> {len(new_src)}')
