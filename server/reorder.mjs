/**
 * Return batches and the reorder list.
 *
 * The same idea as the rest of Witness, applied one level up:
 *
 *     Three units of the same part, at the same wrong revision, in the same
 *     place is not three mistakes. It is one bad delivery.
 *
 * A worker cannot see that. Standing at the beam, each wrong part looks like an
 * isolated problem, and it gets torn out and replaced one at a time. The
 * pattern is only visible from the record — so the record is what states it.
 *
 * Pure functions over plain data. No clock, no I/O, no model. Same rules as
 * engine/resolve.ts: this is adjudication, and adjudication is deterministic or
 * it is nothing. A supervisor still confirms before anything is sent back to a
 * supplier — the system proposes, a human disposes.
 */

/**
 * Distinct units of one part at one wrong revision before we call it a
 * delivery problem rather than an installation problem.
 *
 * Deliberately the same number as MEMORY_THRESHOLD in engine/resolve.ts. Two
 * different thresholds for "this has happened enough times to mean something"
 * would be two different opinions about the same question.
 */
export const RETURN_THRESHOLD = 2;

const key = (sku, rev) => `${sku}|${rev}`;

/**
 * Every unit we have evidence arrived at the wrong revision.
 *
 * Two independent sources, deduplicated by serial so one unit that generated
 * both an NCR and a worker report is still one unit:
 *
 *   1. Confirmed nonconformances — the strongest evidence there is. A human
 *      stood in front of the part and confirmed the revision mismatch.
 *   2. Worker reports of WRONG_ITEM — the revision comes from the unit record,
 *      not from the worker's opinion, so it is still a fact we can join on.
 */
function wrongRevUnits({ ncrs, reports, units }) {
  const revOf = new Map(units.map(u => [u.serial, u.rev]));
  const found = new Map();          // serial -> evidence

  for (const n of ncrs) {
    if (!n.installed_rev || n.installed_rev === n.approved_rev) continue;
    found.set(n.serial, {
      serial: n.serial, sku: n.sku, foundRev: n.installed_rev,
      approvedRev: n.approved_rev, zone_id: n.zone_id, via: 'NCR', ref: n.id,
    });
  }

  for (const r of reports) {
    if (r.kind !== 'WRONG_ITEM') continue;
    if (found.has(r.serial)) continue;          // NCR evidence already stronger
    const rev = revOf.get(r.serial);
    if (!rev) continue;                          // unknown unit — refuse to guess
    found.set(r.serial, {
      serial: r.serial, sku: r.sku, foundRev: rev,
      approvedRev: null, zone_id: r.zone_id, via: 'REPORT', ref: r.id,
    });
  }

  return [...found.values()];
}

/** What revision is approved for this part in this place? */
function approvedRevFor(submittals, sku, zoneId) {
  const s = submittals.find(x => x.sku === sku && x.zone_id === zoneId);
  return s ? s.approved_rev : null;
}

/**
 * Group wrong-revision units into proposed return batches.
 *
 * `decisions` carries what a supervisor has already said about each batch, so a
 * dismissed batch stays dismissed as more evidence arrives rather than
 * reappearing every time someone scans another one.
 */
export function deriveReturnBatches({
  ncrs = [], reports = [], units = [], submittals = [], decisions = {},
} = {}) {
  const evidence = wrongRevUnits({ ncrs, reports, units });

  const groups = new Map();
  for (const e of evidence) {
    const k = key(e.sku, e.foundRev);
    if (!groups.has(k)) {
      groups.set(k, { key: k, sku: e.sku, foundRev: e.foundRev, units: [], zones: new Set() });
    }
    const g = groups.get(k);
    g.units.push(e);
    g.zones.add(e.zone_id);
  }

  const batches = [];
  for (const g of groups.values()) {
    if (g.units.length < RETURN_THRESHOLD) continue;

    const zones = [...g.zones].sort();
    // The revision that SHOULD have arrived. Normally one; listed as a set
    // because the same part can be approved at different revisions in
    // different zones, and quietly picking one would be a guess.
    const needRevs = [...new Set(
      zones.map(z => approvedRevFor(submittals, g.sku, z))
        .concat(g.units.map(u => u.approvedRev))
        .filter(Boolean),
    )].sort();

    const d = decisions[g.key] || {};
    batches.push({
      key: g.key,
      sku: g.sku,
      foundRev: g.foundRev,
      needRevs,
      needRev: needRevs.length === 1 ? needRevs[0] : null,
      qty: g.units.length,
      zones,
      serials: g.units.map(u => u.serial).sort(),
      evidence: g.units.map(u => ({ serial: u.serial, via: u.via, ref: u.ref, zone_id: u.zone_id })),
      decision: d.decision || 'PROPOSED',
      decidedBy: d.by || null,
      decidedAt: d.at || null,
      // Stated in the batch itself so the dashboard never has to invent wording
      // for a claim the server is the one making.
      rationale:
        `${g.units.length} distinct units of ${g.sku} arrived at Rev ${g.foundRev} in `
        + `${zones.join(', ')}${needRevs.length ? `, where Rev ${needRevs.join('/')} is approved` : ''}. `
        + `At ${RETURN_THRESHOLD} or more, this is a delivery problem rather than an installation one.`,
    });
  }

  return batches.sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku));
}

/**
 * What actually needs ordering again, from both causes at once.
 *
 * A damaged part and a mis-ordered part have nothing in common on site and
 * everything in common in a procurement office: in both cases the right part is
 * not there and somebody has to order it. This is the only place the two meet.
 *
 * Damaged units are firm immediately — a cracked part is a fact, and it does
 * not need a committee. Mis-ordered batches are firm only once a supervisor has
 * confirmed the batch, because sending stock back to a supplier is a commercial
 * act, not an observation.
 */
export function deriveReorder({
  batches = [], reports = [], submittals = [], zones = [],
} = {}) {
  const lines = new Map();
  const zoneName = new Map(zones.map(z => [z.id, z.name]));

  const line = (sku, needRev) => {
    const k = key(sku, needRev ?? '?');
    if (!lines.has(k)) {
      lines.set(k, {
        key: k, sku, needRev: needRev ?? null, qty: 0,
        firm: 0, awaiting: 0, causes: [], zones: new Set(),
      });
    }
    return lines.get(k);
  };

  for (const b of batches) {
    if (b.decision === 'DISMISSED') continue;
    const l = line(b.sku, b.needRev);
    l.qty += b.qty;
    if (b.decision === 'CONFIRMED') l.firm += b.qty; else l.awaiting += b.qty;
    for (const z of b.zones) l.zones.add(z);
    l.causes.push({
      kind: 'MIS_ORDERED', qty: b.qty, detail: `Rev ${b.foundRev} delivered instead`,
      batchKey: b.key, status: b.decision,
    });
  }

  // Distinct serials, not report rows — the same rule the coverage figures use.
  const damagedBySku = new Map();
  for (const r of reports) {
    if (r.kind !== 'DAMAGED') continue;
    if ((r.status || 'OPEN') !== 'OPEN') continue;
    const k = r.sku;
    if (!damagedBySku.has(k)) damagedBySku.set(k, { serials: new Set(), zones: new Set() });
    damagedBySku.get(k).serials.add(r.serial);
    damagedBySku.get(k).zones.add(r.zone_id);
  }
  for (const [sku, d] of damagedBySku) {
    const zoneList = [...d.zones];
    const revs = [...new Set(zoneList.map(z => approvedRevFor(submittals, sku, z)).filter(Boolean))];
    const l = line(sku, revs.length === 1 ? revs[0] : null);
    const n = d.serials.size;
    l.qty += n;
    l.firm += n;
    for (const z of zoneList) l.zones.add(z);
    l.causes.push({ kind: 'DAMAGED', qty: n, detail: 'reported unusable on site', status: 'OPEN' });
  }

  return [...lines.values()]
    .map(l => ({
      ...l,
      zones: [...l.zones].sort(),
      zoneNames: [...l.zones].sort().map(z => zoneName.get(z) || z),
    }))
    .sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku));
}
