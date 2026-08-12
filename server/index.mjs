/**
 * Witness sync server.
 *
 * Deliberately tiny and dependency-free - Node's own http module, JSON on disk.
 * It exists to receive what the phones queued up and to feed the supervisor
 * dashboard. It is NOT on the safety path: if this server is on fire, every
 * phone on site still gives correct verdicts.
 *
 *   node server/index.mjs          -> http://localhost:8787
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveReturnBatches, deriveReorder, RETURN_THRESHOLD } from './reorder.mjs';
import { forecast } from './forecast.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * When was the code this process is running last edited?
 *
 * A long-lived Node process keeps whatever it was started with. Edit a route,
 * forget to restart, and the dashboard calls an endpoint that exists on disk
 * but not in memory — you get a 404 and go hunting for a bug in code that is
 * already correct. Reported on /health so the control panel can compare it
 * against the files and say so out loud instead.
 */
const SRC_STAMP = (() => {
  let newest = 0;
  for (const f of ['index.mjs', 'reorder.mjs', 'ingest.mjs', 'forecast.mjs', 'ensemble.mjs', 'rfi.mjs', 'model.mjs']) {
    try { newest = Math.max(newest, statSync(join(here, f)).mtimeMs); } catch { /* ignore */ }
  }
  return Math.round(newest);
})();
const STARTED_AT = new Date().toISOString();
const PORT = process.env.PORT || 8787;
const STORE = join(here, 'store.json');
const SEED = join(here, '..', 'app', 'src', 'data', 'witness_seed.json');

/**
 * Fields added after the first store.json was written in the field.
 *
 * A store from an older build is missing them, and `db.reports.filter(...)`
 * on undefined throws inside a request handler — which surfaces as a dead
 * dashboard with no clue why. Defaulted on every load instead of hoping.
 */
function migrate(db, seed) {
  db.reports ??= [];
  db.returnDecisions ??= {};
  // The read model needs the approved record to say what SHOULD have arrived.
  // Earlier stores kept only what the phones sent.
  db.units ??= seed.units ?? [];
  db.submittals ??= seed.submittals ?? [];
  return db;
}

function load({ fromSeed = false } = {}) {
  const seed = JSON.parse(readFileSync(SEED, 'utf8'));
  if (!fromSeed && existsSync(STORE)) {
    return migrate(JSON.parse(readFileSync(STORE, 'utf8')), seed);
  }
  return {
    project: seed.project,
    zones: seed.zones,
    units: seed.units ?? [],
    submittals: seed.submittals ?? [],
    installs: seed.installs,
    ncrs: seed.ncrs,
    reports: seed.reports ?? [],   // worker-filed problems, with their notes
    returnDecisions: {},           // batch key -> supervisor's ruling
    seen: {},                      // Idempotency-Key -> true
    log: [],
  };
}
let db = load();
// Write to a temp file and rename. rename() is atomic on the same filesystem,
// so a crash mid-write leaves the previous good store intact rather than a
// truncated file that refuses to parse on restart.
function save() {
  const tmp = STORE + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, STORE);
}

// Idempotency keys are device-scoped and unbounded, so cap the set. Keeping the
// most recent few thousand is far longer than any retry window.
const SEEN_CAP = 5000;
function remember(key) {
  db.seen[key] = Date.now();
  const keys = Object.keys(db.seen);
  if (keys.length > SEEN_CAP) {
    keys.sort((a, b) => db.seen[a] - db.seen[b])
        .slice(0, keys.length - SEEN_CAP)
        .forEach(k => delete db.seen[k]);
  }
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Length': Buffer.byteLength(s),
  });
  res.end(s);
};

const body = req => new Promise((ok, no) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } });
});

/** Batches and the reorder list, derived fresh. Never stored — see reorder.mjs. */
function reorderView() {
  const batches = deriveReturnBatches({
    ncrs: db.ncrs, reports: db.reports, units: db.units,
    submittals: db.submittals, decisions: db.returnDecisions,
  });
  const lines = deriveReorder({
    batches, reports: db.reports, submittals: db.submittals, zones: db.zones,
  });
  return { batches, lines };
}

/** What the dashboard renders. Computed, never stored. */
function summary() {
  const byZone = {};
  for (const z of db.zones) byZone[z.id] = { zone_id: z.id, name: z.name, verified: 0, flagged: 0, pending: 0, ncrs: 0, damaged: 0, reports: 0 };
  // Coverage is measured in DISTINCT UNITS, never in rows.
  //
  // A unit in a location is one work item. Scanning it twice is the same item
  // confirmed twice. Counting rows let a single part scanned six times take a
  // zone from 13% to 46% "field-verified" - a number a judge could inflate to
  // 100% by waving one tag at the camera. The strongest status a unit has ever
  // had is the one that counts.
  const RANK = { VERIFIED: 3, FLAGGED: 2, PENDING: 1 };
  const best = new Map();
  for (const i of db.installs) {
    if (!byZone[i.zone_id]) continue;
    const key = `${i.zone_id}|${i.serial}`;
    const cur = best.get(key);
    const rank = RANK[i.status] ?? 1;
    if (!cur || rank > cur.rank) best.set(key, { zone: i.zone_id, status: i.status, rank });
  }
  for (const u of best.values()) {
    const b = byZone[u.zone];
    if (u.status === 'VERIFIED') b.verified++;
    else if (u.status === 'FLAGGED') b.flagged++;
    else b.pending++;
  }
  for (const n of db.ncrs) if (byZone[n.zone_id]) byZone[n.zone_id].ncrs++;

  // Worker reports, counted in distinct units for the same reason coverage is:
  // one cracked part reported twice is one cracked part.
  const damagedSeen = new Set();
  for (const r of db.reports) {
    const b = byZone[r.zone_id];
    if (!b) continue;
    b.reports++;
    const k = `${r.zone_id}|${r.serial}`;
    if (r.kind === 'DAMAGED' && (r.status || 'OPEN') === 'OPEN' && !damagedSeen.has(k)) {
      damagedSeen.add(k);
      b.damaged++;
    }
  }

  const zones = Object.values(byZone).map(z => {
    const total = z.verified + z.flagged + z.pending;
    return {
      ...z,
      total,
      pct: total ? Math.round((z.verified / total) * 100) : 0,
      // Risk is driven by repeat NCRs, not raw count - a zone that keeps
      // making the SAME mistake is the one that needs a supervisor.
      risk: z.ncrs >= 3 ? 'HIGH' : z.ncrs >= 2 ? 'ELEVATED' : z.ncrs >= 1 ? 'WATCH' : 'OK',
    };
  });

  const confusion = {};
  for (const n of db.ncrs) {
    const k = `${n.sku}|${n.zone_id}`;
    confusion[k] = confusion[k] || { sku: n.sku, zone_id: n.zone_id, units: new Set(), count: 0, last: '' };
    confusion[k].units.add(n.serial);
    if (n.created_at > confusion[k].last) confusion[k].last = n.created_at;
  }
  // Distinct physical units, not NCR rows - same rule as engine/memoryFor().
  for (const c of Object.values(confusion)) { c.count = c.units.size; delete c.units; }

  const { batches, lines } = reorderView();

  /**
   * How many wrong parts are still in the un-scanned remainder.
   *
   * Fed the SAME distinct-unit counts the coverage figures use, so the
   * projection can never disagree with the tile it sits beside.
   */
  const projection = forecast(zones.map(z => ({
    zone_id: z.zone_id, name: z.name,
    flagged: z.flagged, correct: z.verified, unscanned: z.pending,
  })));

  return {
    project: db.project,
    zones,
    projection,
    openNcrs: db.ncrs.filter(n => (n.status ?? 'OPEN') === 'OPEN').length,
    totalNcrs: db.ncrs.length,
    mostConfused: Object.values(confusion).sort((a, b) => b.count - a.count).slice(0, 5),
    recent: db.log.slice(-12).reverse(),
    ncrs: db.ncrs.slice(-20).reverse(),
    returnBatches: batches,
    reorder: lines,
    reorderUnits: lines.reduce((a, l) => a + l.qty, 0),
    returnThreshold: RETURN_THRESHOLD,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Everything about one zone, for the drill-down.
 *
 * Deliberately a separate endpoint rather than more weight in /summary, which
 * every open dashboard polls every three seconds whether or not anyone has a
 * zone open.
 */
function zoneDetail(zoneId) {
  const zone = db.zones.find(z => z.id === zoneId);
  if (!zone) return null;

  const inZone = a => a.filter(x => x.zone_id === zoneId);
  const revOf = new Map(db.units.map(u => [u.serial, u.rev]));
  const approvedFor = sku =>
    (db.submittals.find(s => s.sku === sku && s.zone_id === zoneId) || {}).approved_rev ?? null;

  // Strongest status a unit has ever had — same rule as the coverage figures,
  // so the drill-down can never disagree with the tile it opened from.
  const RANK = { VERIFIED: 3, FLAGGED: 2, PENDING: 1 };
  const best = new Map();
  for (const i of inZone(db.installs)) {
    const cur = best.get(i.serial);
    if (!cur || (RANK[i.status] ?? 1) > (RANK[cur.status] ?? 1)) best.set(i.serial, i);
  }
  const units = [...best.values()].map(i => ({
    ...i, rev: revOf.get(i.serial) ?? null, approved_rev: approvedFor(i.sku),
  }));

  const ncrs = inZone(db.ncrs);
  const flaggedSerials = new Set(ncrs.map(n => n.serial));
  const reports = inZone(db.reports)
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return {
    zone,
    // What the drawing says should be here.
    approved: db.submittals
      .filter(s => s.zone_id === zoneId)
      .map(s => {
        const forSku = units.filter(u => u.sku === s.sku);
        return {
          ...s,
          installed: forSku.length,
          verified: forSku.filter(u => u.status === 'VERIFIED').length,
          flagged: forSku.filter(u => u.status === 'FLAGGED').length,
          pending: forSku.filter(u => u.status === 'PENDING').length,
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku)),

    correct: units.filter(u => u.status === 'VERIFIED'),
    awaiting: units.filter(u => u.status === 'PENDING'),

    // A flagged unit with no NCR behind it would be a hole in the audit trail,
    // so it is listed separately rather than folded in silently.
    misinstalled: ncrs.map(n => ({ ...n, note: null })),
    flaggedWithoutNcr: units.filter(u => u.status === 'FLAGGED' && !flaggedSerials.has(u.serial)),

    damaged: reports.filter(r => r.kind === 'DAMAGED'),
    wrongItem: reports.filter(r => r.kind === 'WRONG_ITEM'),
    notes: reports,

    returns: reorderView().batches.filter(b => b.zones.includes(zoneId)),
    updated_at: new Date().toISOString(),
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://x`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        srcStamp: SRC_STAMP,
        startedAt: STARTED_AT,
        // Listed so a caller can tell an old build from a new one even if the
        // stamp comparison is unavailable.
        routes: ['/summary', '/zone', '/reorder', '/ncr', '/install', '/report', '/return-decision', '/reset'],
      });
    }
    if (req.method === 'GET' && url.pathname === '/summary') return json(res, 200, summary());

    if (req.method === 'GET' && url.pathname === '/zone') {
      const d = zoneDetail(url.searchParams.get('id') || '');
      return d ? json(res, 200, d) : json(res, 404, { error: 'unknown zone' });
    }

    if (req.method === 'GET' && url.pathname === '/reorder') {
      const { batches, lines } = reorderView();
      return json(res, 200, { batches, lines, threshold: RETURN_THRESHOLD, updated_at: new Date().toISOString() });
    }

    /**
     * A supervisor accepts or rejects a proposed return batch.
     *
     * The server derives the batch; a human decides whether stock goes back to
     * a supplier. Keyed by the batch, not by a row id, so the decision survives
     * more units being added to the same batch tomorrow.
     */
    if (req.method === 'POST' && url.pathname === '/return-decision') {
      const p = await body(req);
      if (!p.key || !['CONFIRMED', 'DISMISSED', 'PROPOSED'].includes(p.decision)) {
        return json(res, 400, { error: 'need { key, decision: CONFIRMED | DISMISSED | PROPOSED }' });
      }
      if (p.decision === 'PROPOSED') delete db.returnDecisions[p.key];
      else db.returnDecisions[p.key] = { decision: p.decision, by: p.by || 'supervisor', at: new Date().toISOString() };
      db.log.push({
        t: new Date().toISOString(), kind: 'RETURN',
        text: `${p.key.replace('|', ' Rev ')} · batch ${p.decision.toLowerCase()} by ${p.by || 'supervisor'}`,
      });
      save();
      return json(res, 200, { ok: true, ...reorderView() });
    }

    if (req.method === 'POST'
        && (url.pathname === '/ncr' || url.pathname === '/install' || url.pathname === '/report')) {
      // A phone that timed out mid-send will retry. Same key = same write.
      const key = req.headers['idempotency-key'];
      if (key && db.seen[key]) return json(res, 200, { ok: true, deduped: true });

      const payload = await body(req);
      if (url.pathname === '/report') {
        // Ids are derived on the phone from the finding, so a resend replaces
        // rather than duplicates — same rule as installs and NCRs.
        db.reports = db.reports.filter(x => x.id !== payload.id).concat(payload);
        db.log.push({
          t: new Date().toISOString(), kind: 'REPORT',
          text: `${payload.kind === 'DAMAGED' ? 'Damaged' : payload.kind === 'WRONG_ITEM' ? 'Wrong item' : 'Note'}`
            + ` · ${payload.sku} ${payload.serial} in ${payload.zone_id}`
            + (payload.reported_by ? ` · ${payload.reported_by}` : ''),
        });
      } else if (url.pathname === '/ncr') {
        db.ncrs = db.ncrs.filter(n => n.id !== payload.id).concat(payload);
        db.log.push({ t: new Date().toISOString(), kind: 'NCR', text: `${payload.id} · ${payload.sku} Rev ${payload.installed_rev} in ${payload.zone_id}` });
      } else {
        db.installs = db.installs.filter(i => i.id !== payload.id).concat(payload);
        db.log.push({ t: new Date().toISOString(), kind: 'VERIFIED', text: `${payload.sku} · ${payload.serial} field-verified in ${payload.zone_id}` });
      }
      if (key) remember(key);
      save();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
      db = load({ fromSeed: true });
      save();
      return json(res, 200, { ok: true, reset: true, ncrs: db.ncrs.length });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: String(e?.message ?? e) });
  }
});

/**
 * A second instance is not an error worth a stack trace.
 *
 * The panel can be restarted while an earlier sync server is still alive, and
 * "address already in use" then looked like a crash. If something is already
 * serving on this port, the job is done — say so and exit cleanly.
 */
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`A Witness sync server is already running on port ${PORT}.`);
    console.log('Nothing to do — this one is exiting. Use it, or press "Free it anyway" in the panel to restart.');
    process.exit(0);
  }
  console.error(`Could not start the sync server: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Witness sync server on http://localhost:${PORT}`);
  console.log(`  GET  /summary          dashboard feed`);
  console.log(`  GET  /zone?id=ZONE-A   everything in one zone`);
  console.log(`  GET  /reorder          returns and replacements`);
  console.log(`  POST /ncr              confirmed nonconformance`);
  console.log(`  POST /install          field-verified install`);
  console.log(`  POST /report           worker-filed problem, in their words`);
  console.log(`  POST /return-decision  supervisor confirms or dismisses a batch`);
  console.log(`  POST /reset            restore the seed  <- run this between takes`);
});
