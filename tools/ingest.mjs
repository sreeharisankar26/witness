/**
 * Turn submittal documents into the approved record.
 *
 *   node tools/ingest.mjs                    # everything in docs/submittals
 *   node tools/ingest.mjs path/to/one.pdf
 *
 * The pipeline, and which part is allowed to be wrong:
 *
 *   PDF  ->  text          pdftotext if present, else server/pdftext.mjs (no deps)
 *        ->  candidates    A MODEL READS IT. Messy layouts, prose notes. Fallible.
 *                          No key configured? A pattern extractor takes over.
 *        ->  validation    DETERMINISTIC. server/ingest.mjs. The gate.
 *        ->  record        only what survived, plus a report of what did not.
 *
 * The model never decides what is approved. It reads; the gate rules. That is
 * the same division the app makes at the point of install, applied to the
 * document that the app's answers ultimately come from.
 *
 * Writes:
 *   app/src/data/witness_record.json   the ingested approved record
 *   docs/INGEST_REPORT.md              what was accepted, held and refused, and why
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pdfToText } from '../server/pdftext.mjs';
import { extractCandidates, validateSubmittals, toSubmittals } from '../server/ingest.mjs';
import { reconcile } from '../server/ensemble.mjs';
import { draftAll } from '../server/rfi.mjs';
import { askJson, providerOf, resolveModel } from '../server/model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SEED = join(ROOT, 'app', 'src', 'data', 'witness_seed.json');
const OUT = join(ROOT, 'app', 'src', 'data', 'witness_record.json');
const REPORT = join(ROOT, 'docs', 'INGEST_REPORT.md');

// ─────────────────────────────────────────────────────────────── env + text
function env() {
  const p = join(ROOT, 'app', '.env');
  const o = {};
  if (!existsSync(p)) return o;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2];
  }
  return o;
}

/**
 * pdftotext gives better layout when poppler happens to be installed. Our own
 * reader is the guarantee that this runs anywhere. Try the good one, fall back
 * without comment — the pipeline must not depend on a system package.
 */
function textOf(file) {
  if (extname(file).toLowerCase() !== '.pdf') {
    return { text: readFileSync(file, 'utf8'), via: 'plain text' };
  }
  try {
    const t = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', timeout: 15000 });
    if (t && t.trim().length > 40) return { text: t, via: 'pdftotext' };
  } catch { /* not installed — expected on most Windows machines */ }
  return { text: pdfToText(readFileSync(file)), via: 'built-in reader (no dependencies)' };
}

// ──────────────────────────────────────────────────────────── the model read
const SCHEMA = `Return ONLY JSON, no prose, no code fence:
{
  "rows": [
    {"id":"SUB-0001","sku":"GT-12","description":"...","discipline":"Mechanical",
     "zone":"Zone A","rev":"Rev C","date":"31-Jul-2026","status":"APPROVED"}
  ],
  "notes": [
    {"kind":"SUPERSEDED_BY","loser":"SUB-0013","winner":"SUB-0001","text":"the sentence you read it from"}
  ]
}`;

const PROMPT = `You are reading a construction submittal register.

Extract EVERY row in the table, including rows that are not approved. Do not
filter anything out - something downstream decides what counts, and a row you
drop is a row nobody can check.

Copy values EXACTLY as printed. Do not tidy a part number, do not expand an
abbreviation, do not correct what looks like a typo. If a field is blank, use null.

"status" is the approval state as printed: APPROVED, PENDING, REJECTED, and so on.

Then read the notes and remarks. Where a note says one submittal supersedes
another, record it, quoting the sentence you took it from.

${SCHEMA}`;

/**
 * Read one document N times and reconcile.
 *
 * The reads are independent calls at temperature 0. Temperature 0 is not
 * determinism — the same prompt against the same model still varies, and that
 * residual variation is precisely the signal we want: where two reads of the
 * same row differ, that field is unreliable on THIS document. See
 * server/ensemble.mjs for why we do not then take a majority.
 */
async function modelExtract(text, cfg, reads = 2) {
  const runs = [];
  for (let i = 0; i < reads; i++) {
    // Free tiers count requests per MINUTE. Firing every read back-to-back is
    // what triggers the limit in the first place; a short gap costs nothing a
    // person is waiting on and keeps the whole run inside the budget.
    if (i > 0) await new Promise(r => setTimeout(r, PACE_MS));
    const r = await askJson({
      url: cfg.url, key: cfg.key, model: cfg.model,
      prompt: `${PROMPT}\n\n---DOCUMENT---\n${text}`,
      maxTokens: 8000, temperature: 0,
      onRetry: ({ waitMs }) =>
        console.log(`      rate limited — waiting ${Math.round(waitMs / 1000)}s (free tier)`),
    });
    if (!r.ok) {
      if (runs.length === 0) throw new Error(r.error);
      break;                       // one good read is better than none
    }
    runs.push({ rows: r.data.rows ?? [], notes: r.data.notes ?? [], ms: r.ms });
  }
  const merged = reconcile(runs);
  return { ...merged, calls: runs.length, ms: runs.reduce((a, r) => a + (r.ms || 0), 0) };
}

// ────────────────────────────────────────────────────────────────────── main
const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const files = args.length ? args.map(a => resolve(a)) : (() => {
  const dir = join(ROOT, 'docs', 'submittals');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /\.(pdf|txt)$/i.test(f)).sort().map(f => join(dir, f));
})();

if (!files.length) {
  console.error('No documents. Put PDFs in docs/submittals/ (tools/make_submittals.py generates samples).');
  process.exit(1);
}

const seed = JSON.parse(readFileSync(SEED, 'utf8'));
const ctx = {
  zones: seed.zones,
  // What the supply chain actually carries. Without this there is nothing to
  // verify a part number against, and every row would be held.
  knownSkus: [...new Set(seed.units.map(u => u.sku))],
};

const e = env();
const cfg = { url: e.EXPO_PUBLIC_LLM_URL, key: e.EXPO_PUBLIC_LLM_KEY, model: e.EXPO_PUBLIC_VLM_MODEL || e.EXPO_PUBLIC_LLM_MODEL };
let useModel = Boolean(cfg.url && cfg.key);
/** How many independent reads per document. Two is enough to catch instability. */
const READS = Number(process.env.WITNESS_READS || 2);
/** Gap between model calls. Free tiers are rated per minute, not per second. */
const PACE_MS = Number(process.env.WITNESS_PACE_MS || 4500);

/**
 * Confirm the model before touching a single document.
 *
 * Doing this per-document meant the same retired-model 404 was printed once per
 * file, buried the actual cause in a wall of JSON, and quietly dropped every
 * document to the pattern extractor — so the run "worked" and used no model at
 * all, which is the exact failure this project exists to make visible.
 */
let modelNote = '';
if (useModel) {
  const r = await resolveModel({ url: cfg.url, key: cfg.key, model: cfg.model });
  if (r.ok) {
    cfg.model = r.model;
    if (r.swapped) {
      modelNote = `"${r.previous}" is retired — using "${r.swapped}" instead. `
                + `Update EXPO_PUBLIC_LLM_MODEL and EXPO_PUBLIC_VLM_MODEL in app/.env.`;
    }
  } else {
    useModel = false;
    modelNote = `model unavailable (${r.error}) — reading with patterns instead. `
              + `Run: node tools/modeltest.mjs`;
  }
}

console.log(`\nWITNESS INGESTION`);
console.log(`  documents : ${files.length}`);
const haveKey = Boolean(cfg.url && cfg.key);
console.log(`  reader    : ${useModel
  ? `${READS}x ${cfg.model} via ${providerOf(cfg.url)} — disagreement between reads becomes HELD`
  : haveKey
    ? 'pattern extractor — a key is set, but the model could not be reached'
    : 'pattern extractor — no model key configured'}`);
console.log(`  gate      : server/ingest.mjs (deterministic, 61 tests)`);
if (modelNote) console.log(`  note      : ${modelNote}`);
console.log('');

const rows = [], notes = [], provenance = [];

let firstDoc = true;
for (const f of files) {
  if (!firstDoc && useModel) await new Promise(r => setTimeout(r, PACE_MS));
  firstDoc = false;
  const { text, via } = textOf(f);
  let got, reader, agreement = null;
  if (useModel) {
    try {
      got = await modelExtract(text, cfg, READS);
      agreement = got.agreement;
      reader = `${got.calls}x model (${cfg.model})`;
    } catch (err) {
      console.log(`  ! ${basename(f)}: model read failed (${err.message}) - falling back to patterns`);
      got = extractCandidates(text); reader = 'pattern extractor (model failed)';
    }
  } else {
    got = extractCandidates(text); reader = 'pattern extractor';
  }
  const withRef = got.rows.map(r => ({ ...r, doc_ref: basename(f) }));
  rows.push(...withRef);
  notes.push(...(got.notes ?? []));
  provenance.push({
    file: basename(f), textVia: via, reader,
    rows: got.rows.length, notes: (got.notes ?? []).length, agreement,
  });
  console.log(`  ${basename(f)}  ->  ${got.rows.length} rows, ${(got.notes ?? []).length} notes   [${via}]`
    + (agreement && agreement.reads > 1
        ? `\n      ${agreement.reads} reads agreed on ${agreement.rate}% of rows`
          + (agreement.disputedRows ? `; ${agreement.disputedRows} disputed -> held` : '')
        : ''));
}

const v = validateSubmittals({ rows, notes }, ctx);
// Every held row is a question somebody has to ask. Draft it now, while the
// evidence is to hand, rather than leaving a folder nobody opens.
const rfis = draftAll(v.held, seed.project);

console.log(`\n  read ${v.stats.read}  ->  accepted ${v.stats.accepted} | held ${v.stats.held} | refused ${v.stats.rejected}\n`);
for (const r of v.rejected) console.log(`  REFUSED  ${r.id} ${r.sku ?? ''} - ${r.reason.detail}`);
for (const r of v.held) console.log(`  HELD     ${r.id} ${r.sku ?? ''} - ${r.reason.detail}`);
if (rfis.length) console.log(`\n  ${rfis.length} RFI${rfis.length === 1 ? '' : 's'} drafted for the held rows (not sent — see docs/RFI_DRAFTS.md)`);

// The record. A submittal register carries approved revisions per part per
// zone; it does NOT carry unit serial numbers - those come from delivery and
// the asset tags. So ingestion replaces the submittals and nothing else.
const record = {
  ...seed,
  _note: 'Approved revisions INGESTED FROM DOCUMENTS by tools/ingest.mjs. Units, revisions and zones come from the supply-chain record.',
  _ingest: {
    at: new Date().toISOString(),
    documents: provenance,
    stats: v.stats,
    heldForReview: v.held.map(h => ({ id: h.id, sku: h.sku, reason: h.reason })),
    rfisDrafted: rfis.length,
    refused: v.rejected.map(h => ({ id: h.id, sku: h.sku, reason: h.reason })),
  },
  submittals: toSubmittals(v.accepted),
};
writeFileSync(OUT, JSON.stringify(record, null, 2));

// ───────────────────────────────────────────────────────────────── the report
const esc = s => String(s ?? '').replace(/\|/g, '\\|');
const table = (rowsIn, extra) => rowsIn.length
  ? [`| Ref | Part | Zone | Rev | ${extra} |`, `|---|---|---|---|---|`,
     ...rowsIn.map(r => `| ${esc(r.id)} | ${esc(r.sku)} | ${esc(r.zone_id ?? r.zone ?? '—')} | ${esc(r.rev ?? '—')} | ${esc(r.reason ? r.reason.detail : r.date)} |`)].join('\n')
  : '_none_';

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `# Ingestion report

Generated ${new Date().toISOString()} by \`tools/ingest.mjs\`.

A model reads the documents. \`server/ingest.mjs\` decides what is allowed to
become an approved revision. Every row is accounted for — nothing is silently
dropped, and nothing ambiguous is silently accepted.

| | |
|---|---|
| Rows read | **${v.stats.read}** |
| Accepted into the record | **${v.stats.accepted}** |
| Held for a human | **${v.stats.held}** |
| Refused | **${v.stats.rejected}** |
| Supersession notes found in prose | **${v.stats.notesFound}** |

## Documents

| File | Text extracted via | Read by | Rows | Notes | Reads agreed |
|---|---|---|---|---|---|
${provenance.map(p => `| ${p.file} | ${p.textVia} | ${p.reader} | ${p.rows} | ${p.notes} | ${
  p.agreement && p.agreement.reads > 1
    ? `${p.agreement.rate}%${p.agreement.disputedRows ? ` (${p.agreement.disputedRows} disputed)` : ''}`
    : '—'} |`).join('\n')}

## Refused — never enters the approved record

${table(v.rejected, 'Why')}

## Held — readable, not verifiable, sent to a human

${table(v.held, 'Why')}

## Accepted

${table(v.accepted, 'Approved')}

## Questions raised

${rfis.length
  ? rfis.map(r => `- **${r.ref}** — ${r.subject} _(${r.reason})_`).join('\n')
      + `\n\nFull drafts in [RFI_DRAFTS.md](RFI_DRAFTS.md). None have been sent.`
  : '_Nothing held, so nothing to ask._'}

## Notes found in prose

${notes.length ? notes.map(n => `- **${n.loser} superseded by ${n.winner}** — "${n.text}"`).join('\n') : '_none_'}

---

The row worth looking at is any marked \`NOT_APPROVED\`. Those are rows sitting in
the same table as the approved ones, still awaiting consultant approval. A
pipeline that reads the table into JSON turns them into approved revisions, and
from that point the app is confidently wrong out loud to a worker. This is the
failure the gate exists to prevent.
`);

const RFI_OUT = join(ROOT, 'docs', 'RFI_DRAFTS.md');
writeFileSync(RFI_OUT, `# Requests for information — drafted, not sent

Generated by \`tools/ingest.mjs\` from the rows the gate held.

A held submittal is not an outcome, it is an unanswered question. These are
those questions, addressed and referenced, each asking one thing that has a
decidable answer. **Nothing here has been sent.** An RFI is correspondence on a
construction contract; a system emailing a consultant in a coordinator's name is
not a feature. A person reads these and presses send.

${rfis.length ? rfis.map(r => [
  `## ${r.ref} — ${r.subject}`,
  '',
  '```',
  r.body,
  '```',
  '',
  `Held because: \`${r.reason}\``,
].join('\n')).join('\n\n---\n\n') : '_No rows were held. Nothing to ask._'}
`);

console.log(`\n  record  -> ${OUT}`);
console.log(`  report  -> ${REPORT}`);
console.log(`  rfis    -> ${RFI_OUT}\n`);
