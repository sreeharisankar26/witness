/**
 * Minimal QR encoder — byte mode, error-correction level L, versions 1..5.
 *
 * Exists so the control panel can show a scannable code for the Expo dev URL
 * without a terminal and without a CDN. That range covers up to 106 bytes,
 * which is far more than any `exp://192.168.x.x:8081` needs, and every version
 * in it is single-block for level L — so no interleaving.
 *
 * Verified module-for-module against the Python `qrcode` library.
 */

const CAP_L = { 1: 17, 2: 32, 3: 53, 4: 78, 5: 106 };      // byte-mode capacity
const DATA_CW = { 1: 19, 2: 34, 3: 55, 4: 80, 5: 108 };    // data codewords
const EC_CW = { 1: 7, 2: 10, 3: 15, 4: 20, 5: 26 };        // ec codewords
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };

// ---------------------------------------------------------------- GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

/**
 * Generator polynomial: product of (x - a^i) for i in 0..n-1, highest degree
 * first. Note the index order below - writing the two terms the other way round
 * builds the reciprocal polynomial, which produces plausible-looking but wrong
 * EC codewords and a QR that no scanner will read.
 */
function rsGenerator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                        // multiply by x
      next[j + 1] ^= mul(poly[j], EXP[i]);       // multiply by a^i
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= mul(gen[i + 1], factor);
  }
  return res;
}

// ------------------------------------------------------------------ layout
function pickVersion(len) {
  for (const v of [1, 2, 3, 4, 5]) if (len <= CAP_L[v]) return v;
  throw new Error(`Too long for this encoder: ${len} bytes (max ${CAP_L[5]})`);
}

function buildCodewords(bytes, version) {
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };

  push(0b0100, 4);            // byte mode
  push(bytes.length, 8);      // count indicator: 8 bits for versions 1..9
  for (const b of bytes) push(b, 8);

  const capacityBits = DATA_CW[version] * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);  // terminator
  while (bits.length % 8) bits.push(0);

  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; cw.length < DATA_CW[version]; i++) cw.push(PAD[i % 2]);

  return cw.concat(rsEncode(cw, EC_CW[version]));
}

/** null = free module, true/false = dark/light, `fixed` marks function patterns. */
function emptyMatrix(size) {
  return {
    size,
    m: Array.from({ length: size }, () => new Array(size).fill(null)),
    fixed: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setFixed(g, r, c, v) {
  if (r < 0 || c < 0 || r >= g.size || c >= g.size) return;
  g.m[r][c] = v; g.fixed[r][c] = true;
}

function placeFunctionPatterns(g, version) {
  const n = g.size;

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inner && (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        );
        setFixed(g, r0 + r, c0 + c, inner ? dark : false);
      }
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);

  // timing
  for (let i = 8; i < n - 8; i++) {
    setFixed(g, 6, i, i % 2 === 0);
    setFixed(g, i, 6, i % 2 === 0);
  }

  // alignment
  const centers = ALIGN[version];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFixed(g, r + dr, c + dc, dark);
        }
      }
    }
  }

  setFixed(g, n - 8, 8, true);   // dark module

  // reserve format areas
  for (let i = 0; i < 9; i++) {
    if (g.m[8][i] === null) setFixed(g, 8, i, false);
    if (g.m[i][8] === null) setFixed(g, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (g.m[8][n - 1 - i] === null) setFixed(g, 8, n - 1 - i, false);
    if (g.m[n - 1 - i][8] === null) setFixed(g, n - 1 - i, 8, false);
  }
}

function placeData(g, codewords) {
  const n = g.size;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);

  let idx = 0, upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;              // skip the vertical timing column
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i;
      for (const col of [right, right - 1]) {
        if (g.fixed[row][col]) continue;
        g.m[row][col] = idx < bits.length ? bits[idx] === 1 : false;
        idx++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m) {
  const n = m.length;
  let p = 0;

  // rule 1: runs of 5+
  for (let i = 0; i < n; i++) {
    for (const line of [m[i], m.map(row => row[i])]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        if (line[j] === line[j - 1]) { run++; }
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
  }
  // rule 2: 2x2 blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }
  // rule 3: finder-like patterns
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const match = (line, pat) => pat.every((v, k) => line[k] === v);
  for (let i = 0; i < n; i++) {
    const row = m[i], col = m.map(r => r[i]);
    for (let j = 0; j + 11 <= n; j++) {
      for (const line of [row.slice(j, j + 11), col.slice(j, j + 11)]) {
        if (match(line, A) || match(line, B)) p += 40;
      }
    }
  }
  // rule 4: dark/light balance
  const dark = m.flat().filter(Boolean).length;
  const pct = (dark * 100) / (n * n);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

/** BCH(15,5) format information for EC level L. */
function formatBits(maskIdx) {
  const data = (0b01 << 3) | maskIdx;          // 01 = level L
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function placeFormat(g, maskIdx) {
  const n = g.size;
  const bits = formatBits(maskIdx);
  // MSB first: the module at (8,0) carries bit 14 of the format word, not bit 0.
  // Getting this backwards yields a symbol that looks perfect and decodes to
  // the wrong mask, so every scanner rejects it.
  const bit = i => ((bits >> (14 - i)) & 1) === 1;

  for (let i = 0; i <= 5; i++) g.m[8][i] = bit(i);
  g.m[8][7] = bit(6);
  g.m[8][8] = bit(7);
  g.m[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) g.m[14 - i][8] = bit(i);

  // Copy 2 splits 7 + 8, not 8 + 7. The module at (n-8, 8) is the permanently
  // dark module, so the vertical run stops one short of it and bit 7 belongs to
  // the horizontal run at column n-8. Writing bit 7 into the dark module
  // position instead loses it entirely.
  for (let i = 0; i <= 6; i++) g.m[n - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i++) g.m[8][n - 15 + i] = bit(i);
  g.m[n - 8][8] = true;                        // dark module, always
}

/** Returns a boolean matrix — true = dark module. */
export function encode(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  const size = 17 + version * 4;
  const codewords = buildCodewords(bytes, version);

  let best = null, bestScore = Infinity;
  for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
    const g = emptyMatrix(size);
    placeFunctionPatterns(g, version);
    placeData(g, codewords);
    const masked = g.m.map((row, r) =>
      row.map((v, c) => (g.fixed[r][c] ? v : (MASKS[maskIdx](r, c) ? !v : v))));
    const gg = { size, m: masked, fixed: g.fixed };
    placeFormat(gg, maskIdx);
    const score = penalty(gg.m);
    if (score < bestScore) { bestScore = score; best = gg.m; }
  }
  return best;
}

/** Scannable SVG. Quiet zone of 4 modules is required by the spec. */
export function toSvg(text, px = 260) {
  const m = encode(text);
  const n = m.length, quiet = 4, total = n + quiet * 2;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<g fill="#000">${rects}</g></svg>`;
}
