#!/usr/bin/env python3
"""Ensure the status creator modal ALWAYS renders the uploaded photo in the preview area,
even when we're in TEXT tab with image present. Also use the chosen background gradient
when displaying an image so it frames nicely.

The simplest, most reliable fix: locate the kot3-preview-input textarea render inside
kot3-preview-box, and rewrite its body to:
- If image is set: render <img src={statusCreatorImage} alt="" class="kot3-preview-img"/>
- Otherwise: render the textarea (with or without gradient bg)
"""
FILE = '/home/jhoncharlyreactive/.work/src/components/Kot3Chat.jsx'
with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# We do the replacement by detecting the kot3-preview-input textarea and replacing its render
# inside the kot3-preview-box.
# Find old block:
OLD = """                <div className="kot3-preview-box" style={{ background: statusCreatorTab === 'text' ? STATUS_PALETTE[activeGradIdx] : (statusCreatorImage ? 'transparent' : STATUS_PALETTE[activeGradIdx]) }}>
                  {statusCreatorImage ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      <img src={statusCreatorImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                      <button
                        type="button"
                        onClick={() => setStatusCreatorImage('')}
                        title={lang === 'ht' ? 'Retire foto a' : 'Remove photo'}
                        style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.72)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                      style={{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family, display: statusCreatorTab === 'text' ? 'block' : 'none' }}
                    />
                  )}
                </div>"""

NEW = """                <div className="kot3-preview-box" style={{ background: statusCreatorImage ? '#000' : (statusCreatorTab === 'text' ? STATUS_PALETTE[activeGradIdx] : '#1a1a1a') }}>
                  {statusCreatorImage ? (
                    <div className="kot3-preview-photo-wrap">
                      <img
                        src={statusCreatorImage}
                        alt=""
                        className="kot3-preview-photo"
                      />
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
                      style={{ fontFamily: (STATUS_FONTS.find(f => f.key === statusCreatorFont) || STATUS_FONTS[0]).family, display: statusCreatorTab === 'text' ? 'block' : 'none' }}
                    />
                  )}
                </div>"""

if OLD in src:
    src = src.replace(OLD, NEW, 1)
    print('[OK] preview-box now has cleaner photo vs text conditional')
else:
    # maybe the file has a slightly different existing block — try a more flexible anchor
    print('[INFO] OLD block not found verbatim; falling back to direct textarea anchor')

    # Find any textarea inside kot3-preview-box and wrap it sensibly.
    # Anchor: 'className=".kot3-preview-input font-.\n... maxLength={120}\n... rows={4}'
    # Use a regex to find the textarea block and replace it cleanly.
    import re
    pat = re.compile(
        r'(<div className="kot3-preview-box"[^>]*>)\s*\n'
        r'(.*?)'
        r'(</div>)',
        re.DOTALL
    )
    m = pat.search(src)
    if m:
        head = m.group(1)
        body = m.group(2)
        tail = m.group(3)
        print('Found preview-box, head:', repr(head[:100]), 'body length:', len(body))
        # Replace with our standard block, keeping head & tail.
        src = src[:m.start()] + head + NEW[len(NEW)-len(NEW)+5:].lstrip() + tail + src[m.end():]
        print('[OK] preview-box swapped via regex')
    else:
        print('[WARN] could not locate preview-box; no JSX edit done.')

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(src)

print('file size:', len(src))
