/**
 * Minimal PDF text-layer reader. Node core only — zlib and a parser.
 *
 * Why not a library: the rest of this project runs on a laptop with nothing
 * installed but Node, and the ingestion path is not worth breaking that for.
 * A PDF's text layer is a compressed content stream with a handful of text
 * operators in it; pulling the strings back out is about a hundred lines.
 *
 * WHAT THIS IS NOT, stated plainly so nobody deploys it thinking otherwise:
 * it reads the text layer of a digitally generated PDF. It does not do OCR, it
 * does not handle scans, it ignores custom font encodings and CID fonts, and it
 * reconstructs layout only well enough to keep a table row on one line. Real
 * submittal registers include scans and photographs of markups. In production
 * those go to the vision model as page images — the same rung-2 fallback the
 * app already uses for nameplates. This covers the digital case with no
 * dependencies, and says so.
 *
 * If `pdftotext` (poppler) is on PATH, tools/ingest.mjs prefers it. This is the
 * fallback that means ingestion still runs on a machine that has nothing.
 */
import { inflateSync } from 'node:zlib';

/** PDF string escapes: \n \r \t \b \f \( \) \\ and \ddd octal. */
function unescapePdfString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b') out += '\b';
    else if (n === 'f') out += '\f';
    else if (n === '\n') { /* line continuation */ }
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

/**
 * ASCII85, Adobe flavour.
 *
 * reportlab writes `/Filter [ /ASCII85Decode /FlateDecode ]` — the bytes are
 * deflated and then base85-armoured. Inflating without undoing the armour first
 * fails with "incorrect header check", which is exactly what it did.
 */
function ascii85Decode(str) {
  let s = str.replace(/\s+/g, '');
  if (s.startsWith('<~')) s = s.slice(2);
  const end = s.indexOf('~>');
  if (end !== -1) s = s.slice(0, end);

  const out = [];
  let tuple = [];
  for (const ch of s) {
    if (ch === 'z' && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    tuple.push(v);
    if (tuple.length === 5) {
      let n = 0;
      for (const t of tuple) n = n * 85 + t;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      tuple = [];
    }
  }
  // A partial final group encodes fewer than four bytes.
  if (tuple.length > 1) {
    const k = tuple.length;
    for (let i = k; i < 5; i++) tuple.push(84);
    let n = 0;
    for (const t of tuple) n = n * 85 + t;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, k - 1));
  }
  return Buffer.from(out);
}

/** Apply a PDF filter chain in the order the dictionary lists it. */
function applyFilters(raw, dict) {
  // "/Filter [ /ASCII85Decode /FlateDecode ]" or "/Filter /FlateDecode"
  const m = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  if (!m) return raw;
  const chain = (m[1].match(/\/(\w+)/g) || []).map(x => x.slice(1));

  let data = raw;
  for (const f of chain) {
    if (f === 'ASCII85Decode') data = ascii85Decode(data.toString('latin1'));
    else if (f === 'ASCIIHexDecode') {
      const hex = data.toString('latin1').replace(/[^0-9a-fA-F]/g, '');
      data = Buffer.from(hex.slice(0, hex.length & ~1), 'hex');
    } else if (f === 'FlateDecode') data = inflateSync(data);
    else if (f === 'DCTDecode' || f === 'JPXDecode' || f === 'CCITTFaxDecode') {
      return null;                                   // an image, not text
    }
    // LZWDecode and RunLengthDecode are not implemented; rare in text layers.
  }
  return data;
}

/**
 * Pull every stream out of the file and decode the ones we can.
 *
 * Deliberately does not walk the xref table. A damaged or linearised xref is
 * common and would make this fail on files it can otherwise read perfectly
 * well; scanning for `stream`/`endstream` cannot be defeated that way.
 */
function streams(buf) {
  const out = [];
  const hay = buf.toString('latin1');
  let i = 0;
  while (true) {
    const s = hay.indexOf('stream', i);
    if (s === -1) break;
    const e = hay.indexOf('endstream', s);
    if (e === -1) break;

    // The dictionary immediately before tells us how it is encoded.
    const dictStart = hay.lastIndexOf('<<', s);
    const dict = dictStart === -1 ? '' : hay.slice(dictStart, s);

    let start = s + 'stream'.length;
    if (hay[start] === '\r') start++;
    if (hay[start] === '\n') start++;

    if (!/\/Image|DCTDecode|JPXDecode/.test(dict)) {
      try {
        const data = applyFilters(buf.subarray(start, e), dict);
        if (data) out.push(data.toString('latin1'));
      } catch { /* mis-sliced or a filter we do not implement */ }
    }
    i = e + 'endstream'.length;
  }
  return out;
}

/**
 * Walk a content stream's text operators.
 *
 * Tracks the vertical position so rows of a table do not all run together on
 * one line — without that a submittal register comes back as a single 4000
 * character string and every field boundary is gone.
 */
function textFromContent(content) {
  const lines = [];
  let line = '';
  let lastY = null;

  // Strings, arrays, positioning operators and text-block boundaries.
  const re = /\((?:\\.|[^\\()])*\)|\[[^\]]*\]|(-?[\d.]+)\s+(-?[\d.]+)\s+(Td|TD)|(-?[\d.]+)\s+(-?[\d.]+)\s+(?:-?[\d.]+\s+){3}(-?[\d.]+)\s+Tm|\bT\*|\bTj|\bTJ|\bET|\bBT/g;

  let pendingText = null;
  let m;
  const flushLine = () => { if (line.trim()) lines.push(line.trimEnd()); line = ''; };

  while ((m = re.exec(content)) !== null) {
    const tok = m[0];

    if (tok.startsWith('(')) {
      pendingText = unescapePdfString(tok.slice(1, -1));
      continue;
    }
    if (tok.startsWith('[')) {
      // TJ array: strings interleaved with kerning numbers. A large negative
      // kern is a word gap, which is how a space survives in a justified line.
      let s = '';
      const inner = /\((?:\\.|[^\\()])*\)|-?[\d.]+/g;
      let k;
      while ((k = inner.exec(tok)) !== null) {
        const t = k[0];
        if (t.startsWith('(')) s += unescapePdfString(t.slice(1, -1));
        else if (Number(t) < -120) s += ' ';
      }
      pendingText = s;
      continue;
    }
    if (tok === 'Tj' || tok === 'TJ') {
      if (pendingText !== null) { line += pendingText; pendingText = null; }
      continue;
    }
    if (tok === 'T*') { flushLine(); continue; }
    if (tok === 'BT') { lastY = null; continue; }
    if (tok === 'ET') { flushLine(); continue; }

    // Positioning. m[2] is Td/TD's y, m[7] is Tm's f (vertical translate).
    const y = m[2] !== undefined ? Number(m[2]) : m[7] !== undefined ? Number(m[7]) : null;
    if (y === null) continue;

    if (m[3]) {
      // Td/TD are RELATIVE. A non-zero y means a new line.
      if (Math.abs(y) > 0.5) flushLine();
      else if (line) line += ' ';          // same line, moved along: a column gap
    } else {
      // Tm is absolute.
      if (lastY !== null && Math.abs(y - lastY) > 0.5) flushLine();
      else if (line) line += ' ';
      lastY = y;
    }
  }
  flushLine();
  return lines;
}

/** All readable text in the document, one string, lines preserved. */
export function pdfToText(buf) {
  const out = [];
  for (const s of streams(buf)) {
    if (!/\bT[jJ*]\b|\bBT\b/.test(s)) continue;      // not a content stream
    out.push(...textFromContent(s));
  }
  return out.join('\n');
}
