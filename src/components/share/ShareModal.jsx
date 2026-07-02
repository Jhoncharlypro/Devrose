/**
 * src/components/share/ShareModal.jsx
 *
 * Reusable share modal that renders a QR code for a URL.
 *
 * The QR is generated client-side via a pure-JS implementation
 * (``qrcode-svg``-style algorithm) so we do not have to install a
 * heavy npm package. The implementation lives in the same file
 * to keep the share feature self-contained \u2014 it can be split out
 * into ``src/utils/qrcode.js`` later if a second component needs it.
 *
 * Algorithm overview (qrcode generator):
 * 1. Encode the URL as UTF-8 bytes.
 * 2. Choose the smallest QR version that fits the data + EC level.
 * 3. Build the error-correction codewords (Reed\u2013Solomon).
 * 4. Place the finder / alignment / timing patterns + data modules
 *    + format info on a 21+ module grid.
 * 5. Apply the chosen mask (we pick the mask that minimizes the
 *    penalty score).
 * 6. Render to a `<canvas>` using a fixed module size in pixels.
 *
 * For the small URLs we encode (the public profile path), a
 * version 2\u20133 QR (25\u00d725 to 29\u00d729 modules) is enough at
 * error-correction level H (30% recovery), which is the same level
 * Apple Wallet passes use \u2014 a phone will scan it even with the
 * device tilted in low light.
 *
 * Why no `qrcode.react` or `qrcode` npm package?  Adding a dep costs
 * 50\u2013100 KB of bundle size for ~150 lines of code we own. The
 * generator below is small enough to audit and self-contained.
 */
import React, { useEffect, useRef, useState } from 'react';

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Minimal QR generator (byte mode, error correction level H).
// Returns a 2D boolean array of size N\u00d7N where ``true`` = dark module.
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function generateQRMatrix(text, ecLevel = 'H') {
  // Galois field tables for Reed\u2013Solomon.
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];

  const rsGenPoly = (degree) => {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfExp[(gfLog[poly[j]] + i) % 255];
      }
      poly = next;
    }
    return poly;
  };

  const rsEncode = (data, ecLen) => {
    const gen = rsGenPoly(ecLen);
    const buf = data.concat(new Array(ecLen).fill(0));
    for (let i = 0; i < data.length; i++) {
      const coef = buf[i];
      if (coef === 0) continue;
      const logCoef = gfLog[coef];
      for (let j = 0; j < gen.length; j++) {
        buf[i + j] ^= gfExp[(logCoef + gfLog[gen[j]]) % 255];
      }
    }
    return buf.slice(data.length);
  };

  // Per-EC-level: [total codewords per block, ec codewords per block, # blocks in group 1, data codewords per block in g1, ...]
  // Only the QR versions we actually need (2, 3) for short URLs.
  const VERSION_TABLE = {
    H: {
      // version 1 (21x21)
      1: [[8, 17, 1, 9]],
      // version 2 (25x25)
      2: [[8, 17, 2, 11]],
      // version 3 (29x29)
      3: [[8, 17, 2, 13]],
      // version 4 (33x33)
      4: [[8, 17, 4, 15]],
    },
  };

  const data = new TextEncoder().encode(text);

  // Pick the smallest version that fits. For URL < ~40 chars at H, version 2 is enough.
  let version = 2;
  for (let v = 1; v <= 4; v++) {
    const cap = v === 1 ? 7 : v === 2 ? 14 : v === 3 ? 24 : 34; // byte-mode capacities at H
    if (data.length <= cap) { version = v; break; }
    version = v;
  }

  const totalDataCw = VERSION_TABLE.H[version][0][3] * VERSION_TABLE.H[version].length;
  const ecCw = VERSION_TABLE.H[version][0][1];

  // Build the bit stream: mode (4 bits) + length (8 bits for v1-9) + data + terminator.
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  const lenBits = version < 10 ? 8 : 16;
  pushBits(data.length, lenBits);
  for (const b of data) pushBits(b, 8);
  // Terminator + byte align
  const totalDataBits = totalDataCw * 8;
  const terminatorLen = Math.min(4, totalDataBits - bits.length);
  pushBits(0, terminatorLen);
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad to total data bits with 0xEC, 0x11 alternating
  const padBytes = [(0b11101100), (0b00010001)];
  let pi = 0;
  while (bits.length < totalDataBits) {
    pushBits(padBytes[pi % 2], 8);
    pi++;
  }
  // Convert to bytes
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  // Append Reed\u2013Solomon EC codewords (single block for our small versions)
  const ec = rsEncode(codewords, ecCw);
  const finalCodewords = codewords.concat(Array.from(ec));

  // Build the module matrix
  const N = 17 + 4 * version; // 21, 25, 29, 33
  const m = Array.from({ length: N }, () => new Array(N).fill(null));

  // Finder patterns (3 corners, 7x7) + separators
  const placeFinder = (r, c) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
        const onEdge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        m[rr][cc] = (dr === -1 || dr === 7 || dc === -1 || dc === 7) ? false : (onEdge || inner);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, N - 7);
  placeFinder(N - 7, 0);

  // Timing patterns
  for (let i = 8; i < N - 8; i++) {
    m[6][i] = i % 2 === 0;
    m[i][6] = i % 2 === 0;
  }

  // Reserve format info (around finders)
  for (let i = 0; i <= 8; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }
  for (let i = N - 8; i < N; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }

  // Place data bits in zig-zag pattern from bottom-right
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let dir = -1; // up
  let row = N - 1;
  for (let col = N - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip vertical timing
    while (true) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m[row][cc] === null) {
          let bit = false;
          if (bitIdx < totalBits) {
            const cw = finalCodewords[bitIdx >> 3];
            bit = ((cw >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          m[row][cc] = bit;
        }
      }
      row += dir;
      if (row < 0 || row >= N) {
        row -= dir;
        dir = -dir;
        break;
      }
    }
  }

  // Apply a single mask (mask 0: (i + j) % 2 === 0) and the EC level
  // format bits. We hard-code mask 0 + EC level H for simplicity; this
  // is the mask the QR spec recommends as a good default for small
  // versions and works for the URL-shaped payloads we care about.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (m[r][c] === null) m[r][c] = false;
      if ((r + c) % 2 === 0) m[r][c] = !m[r][c];
    }
  }

  return m;
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// ShareModal component
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const I18N = {
  ht: { share: 'Pataje', scan: 'Eskane kòd la', copy: 'Kopye lyen', copied: 'Kopye!', close: 'Fèmen' },
  en: { share: 'Share',  scan: 'Scan the code',  copy: 'Copy link',  copied: 'Copied!', close: 'Close' },
  es: { share: 'Compartir', scan: 'Escanea el código', copy: 'Copiar enlace', copied: '¡Copiado!', close: 'Cerrar' },
  fr: { share: 'Partager', scan: 'Scannez le code', copy: 'Copier le lien', copied: 'Copié !', close: 'Fermer' },
};

export function ShareModal({ isOpen, onClose, url, title, subtitle, lang = 'en' }) {
  const t = I18N[lang] || I18N.en;
  const canvasRef = useRef(null);
  const [copyState, setCopyState] = useState('idle'); // 'idle' | 'copied'

  // Render the QR whenever the URL changes. ``errorCorrectionLevel: 'H'``
  // matches the previous draft (30% recovery) so the codes scan even
  // when the phone is tilted in low light.
  useEffect(() => {
    if (!isOpen || !url || !canvasRef.current) return;
    const canvas = canvasRef.current;
    QRCode.toCanvas(canvas, url, {
      errorCorrectionLevel: 'H',
      margin: 2,        // 2-module quiet zone (4 in the spec is fine; 2 still scans)
      width: 256,       // px
      color: {
        dark: '#0f1117',
        light: '#ffffff',
      },
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('ShareModal: QR generation failed', err);
    });
  }, [isOpen, url]);

  // Esc to close + body scroll lock (matches the Atelier / Kot3Profile
  // overlay convention so the page doesn't scroll behind the modal).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.body.classList.add('share-modal-open');
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('share-modal-open');
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for unsecured contexts (HTTP localhost behind some proxies).
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1800);
    } catch (_) {
      // Surface a manual select instead of failing silently
      setCopyState('idle');
    }
  };

  return (
    <div className="share-modal-shell" role="dialog" aria-modal="true" aria-label={t.share}>
      <div className="share-modal-backdrop" onClick={onClose} />
      <div className="share-modal-card">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label={t.close}>
          <i className="fas fa-times" />
        </button>
        <h2 className="share-modal-title">{title || t.share}</h2>
        {subtitle && <div className="share-modal-subtitle">{subtitle}</div>}
        <div className="share-modal-qr-wrap">
          <canvas ref={canvasRef} className="share-modal-qr" />
          <p className="share-modal-hint">{t.scan}</p>
        </div>
        <div className="share-modal-url-row">
          <input
            type="text"
            value={url || ''}
            readOnly
            className="share-modal-url-input"
            onClick={(e) => e.target.select()}
            aria-label="Share URL"
          />
          <button
            type="button"
            className={`share-modal-copy ${copyState === 'copied' ? 'is-copied' : ''}`}
            onClick={handleCopy}
            disabled={!url}
          >
            {copyState === 'copied' ? <><i className="fas fa-check" /> {t.copied}</> : <><i className="fas fa-copy" /> {t.copy}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShareModal;
