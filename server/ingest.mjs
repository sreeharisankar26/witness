/**
 * SUBMITTAL INGESTION — the same split, one level up.
 *
 *      A model reads the document.        (messy, probabilistic, fallible)
 *      This file decides what is allowed  (deterministic, auditable, tested)
 *      into the approved record.
 *
 * The engine in app/src/engine/resolve.ts is only ever as trustworthy as the
 * record it rules against. So the record needs a gate of its own, and it needs
 * to be the same kind of gate: pure, explicit, and willing to refuse.
 *
 * The failure this exists to prevent, concretely: a submittal register contains
 * rows that are still PENDING consultant approval, sitting in the same table as
 * approved ones. A pipeline that OCRs the table into JSON turns a row nobody
 * approved into an "approved revision", and from that moment the app is
 * confidently, deterministically wrong — and it will say so out loud to a
 * worker. Everything downstream is honest; the lie was let in here.
 *
 * Three outcomes, never two:
 *
 *   ACCEPTED  every field verified against something. Enters the record.
 *   HELD      readable but not verifiable — unknown zone, unknown part,
 *             an unresolved contradiction. Goes to a human WITH the reason.
 *   REJECTED  positively disqualified. Not approved, or explicitly superseded.
 *
 * "Held" is the important one. A pipeline with only accept and reject has to
 * guess about everything in between, and guessing is what we are here to avoid.
 *
 * Pure functions. No clock, no network, no model. Node core only.
 */

/**
 * WHAT A REAL SUBMITTAL REGISTER ACTUALLY SAYS.
 *
 * Almost no real register contains the word "APPROVED". They carry review
 * action codes, and the vocabulary is close to standardised across US public
 * work — ENG Form 4288 (US Army Corps of Engineers) and the CSI convention
 * behind most private specs:
 *
 *   A / NET     Approved · No Exceptions Taken        -> approved
 *   AN / B      Approved as Noted · Make Corrections  -> approved, conditionally
 *   C / RR      Revise and Resubmit                   -> NOT approved
 *   D / DIS     Disapproved · Rejected                -> NOT approved
 *   FIO / RA    For Information Only · Receipt Ack.   -> NOT an approval at all
 *
 * Two of these are traps.
 *
 * "Approved as Noted" is accepted here, because on site that means work may
 * proceed incorporating the reviewer's corrections — refusing it would hold
 * most of a real register and make the tool useless. But it is carried through
 * as CONDITIONAL so the report says so, because the corrections may be exactly
 * what the installer needs to read.
 *
 * "For Information Only" is the dangerous one. It looks benign, it sits in the
 * same column as the approvals, and it is not an approval — it means somebody
 * filed a document, nothing more. Reading it as one would put an unapproved
 * revision into the record wearing a tick.
 */
const STATUS_CODES = [
  // [ matcher, canonical, approved, conditional ]
  [/^(A|NET|NO EXCEPTIONS?( TAKEN)?|APPROVED|APPD|ACCEPTED)$/i, 'APPROVED', true, false],
  [/^(AN|B|APPROVED AS NOTED|APPD AS NOTED|MAKE CORRECTIONS( NOTED)?|EXCEPTIONS? (TAKEN )?AS NOTED|FURNISH AS CORRECTED)$/i,
    'APPROVED_AS_NOTED', true, true],
  [/^(C|RR|REVISE( AND | & )?RESUBMIT|RESUBMIT|REVISE)$/i, 'REVISE_AND_RESUBMIT', false, false],
  [/^(D|DIS|DISAPPROVED|REJECTED|NOT APPROVED|NOT ACCEPTED)$/i, 'REJECTED', false, false],
  [/^(FIO|RA|FOR INFORMATION( ONLY)?|INFORMATION ONLY|RECEIPT ACKNOWLEDGED|RECORD COPY)$/i,
    'INFORMATION_ONLY', false, false],
  [/^(PENDING|IN REVIEW|FOR REVIEW|UNDER REVIEW|OPEN|SUBMITTED|AWAITING)$/i, 'PENDING', false, false],
  [/^(SUPERSEDED|VOID|WITHDRAWN|CANCELLED|CANCELED)$/i, 'VOID', false, false],
];

/**
 * Read a review action code.
 *
 * Returns `null` for anything unrecognised rather than guessing — an unknown
 * code is not evidence of approval, and a gate that defaults to "probably fine"
 * is not a gate.
 */
export function classifyStatus(raw) {
  // Table cells arrive wrapped and punctuated in every combination: "(C)",
  // "A.", "[NET]". Strip the wrapping, never the meaning.
  const s = String(raw ?? '').trim().replace(/^[([{]+/, '').replace(/[.)\]}]+$/, '').trim();
  if (!s) return null;
  for (const [re, code, approved, conditional] of STATUS_CODES) {
    if (re.test(s)) return { raw: s, code, approved, conditional };
  }
  return null;
}

/** Every token the extractor should recognise as occupying the status column. */
const KNOWN_STATUS = [
  'A', 'AN', 'B', 'C', 'D', 'NET', 'RR', 'DIS', 'FIO', 'RA',
  'APPROVED', 'APPD', 'ACCEPTED', 'REJECTED', 'DISAPPROVED', 'NOT APPROVED',
  'PENDING', 'IN REVIEW', 'FOR REVIEW', 'UNDER REVIEW', 'OPEN', 'SUBMITTED',
  'RESUBMIT', 'REVISE', 'SUPERSEDED', 'VOID', 'WITHDRAWN', 'CANCELLED',
  'APPROVED AS NOTED', 'MAKE CORRECTIONS', 'INFORMATION ONLY',
];

const DISCIPLINES = ['Structural', 'Mechanical', 'Electrical', 'Plumbing', 'Civil', 'Architectural'];

/**
 * Revisions are written five ways in one document: "Rev C", "REV-C", "Rev. C",
 * "C", "Rev C1". Normalise to the bare token, or return null and let a human
 * look — silently coercing something unrecognisable is how a wrong revision
 * gets in wearing the right clothes.
 */
export function normaliseRev(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/^REV[\s.\-:]*/, '').trim();
  return /^[A-Z]\d?$/.test(s) ? s : null;
}

/** "Zone A" / "zone-a" / "ZONE A" -> "ZONE-A", but only if the project has it. */
export function normaliseZone(raw, zones = []) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '-') return null;
  const key = s.toUpperCase().replace(/[\s_]+/g, '-');
  const byId = zones.find(z => z.id.toUpperCase() === key);
  if (byId) return byId.id;
  // Fall back to matching the human name: "Zone A - Level 3 Mech Room".
  const byName = zones.find(z => {
    const n = (z.name || '').toUpperCase();
    return n === s.toUpperCase() || n.startsWith(s.toUpperCase() + ' ');
  });
  return byName ? byName.id : null;
}

/** Levenshtein, capped — only used to suggest, never to correct. */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * The nearest part number we actually know about.
 *
 * "GT-l2" is a lowercase L where a digit one belongs — the single most common
 * way a part number comes out of a document wrong, and invisible in most fonts.
 * We surface the suggestion and refuse the row. We do NOT apply it: a part
 * number silently corrected is a wrong part confidently approved.
 */
export function nearestSku(sku, known = []) {
  if (!sku) return null;
  const up = String(sku).toUpperCase();
  if (known.includes(up)) return up;
  let best = null, bestD = 3;
  for (const k of known) {
    const d = editDistance(up, k.toUpperCase());
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/**
 * Pattern extractor — the fallback when no model is configured.
 *
 * Rung 3 of the same ladder the app uses for parts: a model reads it, and
 * failing that something dumb and predictable does, and failing that a human
 * types it. Nobody is ever dead-ended.
 *
 * Deliberately field-shape driven rather than column-position driven. Every
 * register exports its columns in a different order, and a positional parser
 * silently reads the discipline into the revision the moment one does.
 */
export function extractCandidates(text) {
  const raw = String(text).split(/\r?\n/);
  const lines = raw.map(l => l.trim()).filter(Boolean);

  /**
   * Two extractors produce two completely different shapes for the same table:
   * `pdftotext -layout` keeps a row on one line with runs of spaces between
   * cells, while our own reader emits one cell per line. Rather than support
   * one and quietly return nothing for the other — which is exactly what it did
   * — reduce both to the same thing: a row is a reference plus a bag of cells.
   */
  /**
   * A submittal reference, as real registers actually write them.
   *
   * This started as /^SUB-\d+/ and could not read a single row of the genuine
   * Hanford register, whose references are "XXXXXX-XXX-SUB-001" — the contract
   * number comes first and the SUB- part is in the middle. Only the model saw
   * those rows; the pattern fallback silently returned nothing, which is the
   * worst possible failure for a fallback.
   *
   * Matched against the first CELL rather than the whole line, so a sentence
   * that happens to mention a submittal number does not start a row.
   */
  const REF = /\b(?:[A-Z0-9]+(?:-[A-Z0-9]+)*-)?SUB-\d+\b/i;
  /**
   * Anchored, so the reference must BE the first cell rather than merely appear
   * in it. Unanchored, the instruction sentence "the reference SUB-0013 shall be
   * updated upon award" starts a row, and a note about a submittal becomes a
   * submittal.
   */
  const REF_ONLY = /^(?:[A-Z0-9]+(?:-[A-Z0-9]+)*-)?SUB-\d+$/i;
  const isRef = l => REF_ONLY.test((l.split(/\s{2,}/)[0] || l).trim());
  // A heading must contain a space. Without that condition "APPROVED" — a cell
  // value on its own line in the one-cell-per-line shape — reads as a section
  // heading, the row stops absorbing right before its own status, and every row
  // then fails validation for having no approval status.
  const isSectionBreak = l =>
    /^NOTES?\b/i.test(l)
    || /^\d+\.\s/.test(l)
    || (/^[A-Z][A-Z\s/&-]{8,}$/.test(l) && /\s/.test(l) && !KNOWN_STATUS.includes(l.toUpperCase()));

  const cellsOf = l => l.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRef(lines[i])) continue;

    const first = cellsOf(lines[i]);
    const id = (REF.exec(first[0]) || [''])[0].toUpperCase();
    const rest = first.slice(1);

    // Absorb continuation lines — a wrapped description, or the date that
    // reportlab drops underneath the revision.
    for (let j = i + 1; j < lines.length; j++) {
      if (isRef(lines[j]) || isSectionBreak(lines[j])) break;
      rest.push(...cellsOf(lines[j]));
      if (rest.length > 24) break;              // runaway guard
    }

    const pick = re => rest.find(l => re.test(l)) ?? null;

    /**
     * A, B, C and D are valid revision letters AND valid review action codes.
     *
     * This is not a quirk of our test data — it is how registers are actually
     * printed, and it bit immediately: a row at Rev D with review action
     * APPROVED was read as "review action D", which means disapproved, and a
     * perfectly good approval was refused. The opposite mistake is worse.
     *
     * So the unambiguous forms are claimed first — "Rev C" can only be a
     * revision, "APPROVED" and "NET" can only be actions — and only the bare
     * letters left over are assigned, in document order. Registers print the
     * revision before the review action essentially universally; where that
     * convention does not hold, the row ends up refused with STATUS_UNREADABLE
     * rather than silently mis-read, which is the correct direction to fail.
     */
    const revExplicit = pick(/^rev[\s.\-:]*[A-Za-z]\d?$/i);
    const statusWord = rest.find(l => l.length > 1 && classifyStatus(l) !== null) ?? null;
    const bareLetters = rest.filter(l => /^[A-Za-z]\d?$/.test(l) && l !== revExplicit && l !== statusWord);

    let rev = revExplicit, status = statusWord;
    if (!rev && !status) { rev = bareLetters[0] ?? null; status = bareLetters[1] ?? null; }
    else if (!rev) rev = bareLetters[0] ?? null;
    else if (!status) status = bareLetters[0] ?? null;

    const zone = pick(/^(zone[\s-]?\w+|-)$/i);
    const discipline = rest.find(l => DISCIPLINES.some(d => d.toLowerCase() === l.toLowerCase())) ?? null;
    const date = pick(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[-/][A-Za-z]{3}[-/]\d{4}|\d{1,2}\/\d{1,2}\/\d{4})$/);
    // A part number: letters, a hyphen, then a short mixed token. Kept loose on
    // purpose so a mangled one still gets FOUND and can then be refused with a
    // reason, rather than vanishing from the report entirely.
    const sku = rest.find(l => /^[A-Za-z]{2,5}-[A-Za-z0-9]{1,5}$/.test(l) && l !== zone) ?? null;
    const description = rest
      .filter(l => l !== sku && l !== zone && l !== rev && l !== discipline && l !== date
                && l.toUpperCase() !== status)
      .sort((a, b) => b.length - a.length)[0] ?? null;

    rows.push({ id, sku, description, discipline, zone, rev, date, status });
  }

  // Free-text supersession. This is the part a table parser cannot see at all,
  // and it is frequently the only place the truth is written down.
  const notes = [];
  const joined = lines.join(' ');
  // Same prefix tolerance as REF above — a note on a real project names the
  // full contract-scoped reference, "354825-001-SUB-004", not a bare one.
  const re = /((?:[A-Z0-9]+(?:-[A-Z0-9]+)*-)?SUB-\d+)[^.]{0,120}?SUPERSEDED\s+BY\s+((?:[A-Z0-9]+(?:-[A-Z0-9]+)*-)?SUB-\d+)/gi;
  let m;
  while ((m = re.exec(joined)) !== null) {
    notes.push({
      kind: 'SUPERSEDED_BY',
      loser: m[1].toUpperCase(),
      winner: m[2].toUpperCase(),
      text: m[0].replace(/\s+/g, ' ').trim(),
    });
  }
  return { rows, notes };
}

const reason = (code, detail) => ({ code, detail });

/**
 * The gate.
 *
 * `ctx.zones` and `ctx.knownSkus` are what "verified against something" means
 * here — the project's own zone list and the parts the supply chain actually
 * carries. Without them every row would be held, which is the correct failure
 * direction but not a useful one, so the caller must supply them.
 */
export function validateSubmittals({ rows = [], notes = [] } = {}, ctx = {}) {
  const zones = ctx.zones ?? [];
  const knownSkus = (ctx.knownSkus ?? []).map(s => String(s).toUpperCase());

  const accepted = [], held = [], rejected = [];
  const supersededIds = new Set();
  const noteFor = id => notes.find(n => n.kind === 'SUPERSEDED_BY' && n.loser === id) || null;

  // First pass: everything decidable from the row alone.
  const survivors = [];
  for (const r of rows) {
    const out = { ...r, rev: normaliseRev(r.rev), zone_id: normaliseZone(r.zone, zones) };

    if (!r.id || !r.sku) {
      rejected.push({ ...out, reason: reason('UNREADABLE', 'no reference or no part number could be read') });
      continue;
    }

    // The rule this whole module exists for.
    const st = classifyStatus(out.status);
    out.statusCode = st ? st.code : null;
    out.conditional = Boolean(st && st.conditional);

    if (!st) {
      rejected.push({
        ...out,
        reason: reason('STATUS_UNREADABLE', out.status
          ? `"${out.status}" is not a review action this system recognises — an unknown code is not evidence of approval`
          : 'no review action found on the row'),
      });
      continue;
    }
    if (!st.approved) {
      rejected.push({
        ...out,
        reason: reason('NOT_APPROVED',
          st.code === 'INFORMATION_ONLY'
            ? `marked "${st.raw}" — for information only. It sits in the approval column and is not an approval.`
            : `review action "${st.raw}" means ${st.code.replace(/_/g, ' ').toLowerCase()} — this was never approved for installation`),
      });
      continue;
    }

    const n = noteFor(out.id);
    if (n) {
      supersededIds.add(out.id);
      rejected.push({ ...out, reason: reason('SUPERSEDED', `superseded by ${n.winner} — "${n.text}"`), citation: n });
      continue;
    }

    /**
     * The model contradicted itself about this row across reads.
     *
     * Checked BEFORE the field-level rules, because if two reads disagree about
     * what the revision even says then every rule downstream is reasoning about
     * a value we have no basis to believe. Deliberately not resolved by a
     * majority vote — see ensemble.mjs.
     */
    if (Array.isArray(r.disputed) && r.disputed.length) {
      const detail = r.disputed.map(f => {
        const seen = (r.variants && r.variants[f]) || [];
        return f === 'presence'
          ? `only appeared in ${r.seenIn} of ${r.reads} reads`
          : `${f}: read as ${seen.map(v => JSON.stringify(v)).join(' and ')}`;
      }).join('; ');
      held.push({
        ...out,
        reason: reason('MODEL_DISAGREEMENT',
          `${r.reads} independent reads of this document disagreed — ${detail}. `
          + 'Not resolved by majority: a coin landing twice is not evidence about an approved revision.'),
      });
      continue;
    }

    if (!out.rev) {
      held.push({ ...out, reason: reason('REVISION_UNREADABLE', `could not read a revision from ${JSON.stringify(r.rev)}`) });
      continue;
    }
    if (!out.zone_id) {
      held.push({
        ...out,
        reason: reason('ZONE_UNKNOWN', r.zone && r.zone !== '-'
          ? `"${r.zone}" is not a zone on this project`
          : 'no location given — an approval that does not say where cannot be applied'),
      });
      continue;
    }
    if (knownSkus.length && !knownSkus.includes(out.sku.toUpperCase())) {
      const guess = nearestSku(out.sku, knownSkus);
      held.push({
        ...out,
        reason: reason('SKU_UNKNOWN',
          `"${out.sku}" is not a part on this project`
          + (guess ? ` — did you mean ${guess}? (not applied automatically)` : '')),
        suggestion: guess,
      });
      continue;
    }
    survivors.push(out);
  }

  // Second pass: contradictions only visible across rows.
  const byKey = new Map();
  for (const r of survivors) {
    const k = `${r.sku.toUpperCase()}|${r.zone_id}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  for (const [k, group] of byKey) {
    const revs = [...new Set(group.map(r => r.rev))];
    if (revs.length <= 1) { accepted.push(...group); continue; }

    // The document contradicts itself about one part in one place. If a note
    // names a loser we can settle it; otherwise we refuse to pick, because
    // picking is exactly the judgement that is not ours to make.
    const stillStanding = group.filter(r => !supersededIds.has(r.id));
    const stillDisputed = [...new Set(stillStanding.map(r => r.rev))];

    if (stillDisputed.length === 1) {
      accepted.push(...stillStanding);
    } else {
      for (const r of group) {
        held.push({
          ...r,
          reason: reason('CONFLICT',
            `${k.replace('|', ' in ')} is approved at Rev ${revs.join(' and Rev ')} by `
            + `${group.map(g => g.id).join(' and ')} — the documents disagree and no supersession note settles it`),
          conflictsWith: group.filter(g => g.id !== r.id).map(g => g.id),
        });
      }
    }
  }

  const sort = a => a.sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return {
    accepted: sort(accepted), held: sort(held), rejected: sort(rejected),
    notes,
    stats: {
      read: rows.length,
      accepted: accepted.length,
      held: held.length,
      rejected: rejected.length,
      notesFound: notes.length,
    },
  };
}

/** Accepted rows, in the shape app/src/engine/types.ts calls a Submittal. */
export function toSubmittals(accepted) {
  return accepted.map(r => ({
    id: r.id,
    sku: r.sku.toUpperCase(),
    description: r.description ?? '',
    discipline: r.discipline ?? undefined,
    zone_id: r.zone_id,
    approved_rev: r.rev,
    approved_date: r.date ?? '',
    doc_ref: r.doc_ref ?? undefined,
    // "Approved as noted" is still approved, but the reviewer's corrections
    // may be the thing the installer needs to read.
    conditional: r.conditional || undefined,
    review_action: r.statusCode ?? undefined,
  }));
}
