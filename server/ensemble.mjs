/**
 * DISAGREEMENT AS THE CONFIDENCE SIGNAL.
 *
 * The problem with asking a model how sure it is: it will tell you, and the
 * number is not worth much. Self-reported confidence is poorly calibrated —
 * models are routinely confident and wrong, and the failure is silent, which is
 * the worst possible shape for something feeding an approved record.
 *
 * So this does not ask. It reads the same document more than once and looks at
 * where the readings differ. Sampling variance is a property we can measure
 * rather than a claim we have to trust, and it is measured on exactly the field
 * we care about: if two reads of the same row produce Rev C and Rev D, that
 * field is unreliable HERE, on THIS document, regardless of what any confidence
 * score says.
 *
 * The idea is borrowed from self-consistency decoding (sample several times,
 * keep what the samples agree on). The twist worth stealing is what happens to
 * the disagreement: most implementations take a majority vote and move on. We
 * do not vote. A field the model contradicts itself on becomes HELD and goes to
 * a person, because a majority of two-out-of-three is not evidence about an
 * approved revision — it is a coin that landed twice.
 *
 * Cheap, too: two reads of a register on a free tier, and the second read costs
 * nothing but latency the operator is not waiting on.
 *
 * Pure functions. No clock, no network, no model. Node core only.
 */

/** Fields where a difference between reads actually matters. */
const CRITICAL = ['sku', 'rev', 'zone', 'status'];

/** Fields worth noting but not worth holding a row over. */
const MINOR = ['description', 'discipline', 'date'];

/**
 * Loose equality for comparing two reads of the same cell.
 *
 * Case and surrounding whitespace differ between reads constantly and mean
 * nothing. Everything else is treated as a real difference — deliberately
 * including "Rev C" vs "C", because if two reads cannot even agree on the
 * SHAPE of the value, that is worth a human glance.
 */
const same = (a, b) => {
  const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return norm(a) === norm(b);
};

/**
 * Merge N independent reads of one document.
 *
 * Returns the rows, each carrying `disputed` — the list of fields the reads
 * could not agree on — plus a summary. Nothing is voted on and nothing is
 * dropped; a row seen by only some of the reads is itself a disagreement, and
 * arguably the most serious kind, because a register row the model silently
 * skipped is one nobody will ever check.
 */
export function reconcile(runs = []) {
  const reads = runs.filter(r => r && Array.isArray(r.rows));
  if (reads.length === 0) return { rows: [], notes: [], agreement: null };
  if (reads.length === 1) {
    return {
      rows: reads[0].rows.map(r => ({ ...r, disputed: [], seenIn: 1, reads: 1 })),
      notes: reads[0].notes ?? [],
      agreement: { reads: 1, rows: reads[0].rows.length, disputedRows: 0, missedRows: 0, note: 'single read — no cross-check possible' },
    };
  }

  // Index every read by submittal reference.
  const byId = new Map();
  reads.forEach((read, i) => {
    for (const row of read.rows) {
      const id = String(row.id ?? '').toUpperCase();
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ ...row, _read: i });
    }
  });

  const rows = [];
  let disputedRows = 0, missedRows = 0;

  for (const [id, versions] of byId) {
    const base = versions[0];
    const disputed = [];
    const variants = {};

    for (const field of [...CRITICAL, ...MINOR]) {
      const values = versions.map(v => v[field]);
      const allSame = values.every(v => same(v, values[0]));
      if (!allSame) {
        variants[field] = [...new Set(values.map(v => (v == null ? null : String(v))))];
        if (CRITICAL.includes(field)) disputed.push(field);
      }
    }

    // A row that only some reads saw at all.
    const missed = versions.length < reads.length;
    if (missed) {
      missedRows++;
      disputed.push('presence');
      variants.presence = [`seen in ${versions.length} of ${reads.length} reads`];
    }

    if (disputed.length) disputedRows++;

    rows.push({
      ...base,
      _read: undefined,
      disputed,
      variants: disputed.length ? variants : undefined,
      seenIn: versions.length,
      reads: reads.length,
    });
  }

  // Notes are unioned rather than intersected. A supersession clause that only
  // one read noticed is still a clause in the document, and the validator will
  // only act on it where it settles a conflict anyway.
  const noteKey = n => `${n.kind}|${n.loser}|${n.winner}`;
  const notes = [];
  const seenNote = new Set();
  for (const read of reads) {
    for (const n of read.notes ?? []) {
      const k = noteKey(n);
      if (seenNote.has(k)) continue;
      seenNote.add(k);
      notes.push(n);
    }
  }

  const total = rows.length;
  return {
    rows: rows.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    notes,
    agreement: {
      reads: reads.length,
      rows: total,
      disputedRows,
      missedRows,
      /** Share of rows every read agreed on, across every critical field. */
      rate: total ? Math.round((1 - disputedRows / total) * 100) : 100,
    },
  };
}
