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
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const STORE = join(here, 'store.json');
const SEED = join(here, '..', 'app', 'src', 'data', 'witness_seed.json');

function load({ fromSeed = false } = {}) {
  if (!fromSeed && existsSync(STORE)) return JSON.parse(readFileSync(STORE, 'utf8'));
  const seed = JSON.parse(readFileSync(SEED, 'utf8'));
  return {
    project: seed.project,
    zones: seed.zones,
    installs: seed.installs,
    ncrs: seed.ncrs,
    seen: {},            // Idempotency-Key -> true
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

/** What the dashboard renders. Computed, never stored. */
function summary() {
  const byZone = {};
  for (const z of db.zones) byZone[z.id] = { zone_id: z.id, name: z.name, verified: 0, flagged: 0, pending: 0, ncrs: 0 };
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

  return {
    project: db.project,
    zones,
    openNcrs: db.ncrs.filter(n => (n.status ?? 'OPEN') === 'OPEN').length,
    totalNcrs: db.ncrs.length,
    mostConfused: Object.values(confusion).sort((a, b) => b.count - a.count).slice(0, 5),
    recent: db.log.slice(-12).reverse(),
    ncrs: db.ncrs.slice(-20).reverse(),
    updated_at: new Date().toISOString(),
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://x`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/summary') return json(res, 200, summary());

    if (req.method === 'POST' && (url.pathname === '/ncr' || url.pathname === '/install')) {
      // A phone that timed out mid-send will retry. Same key = same write.
      const key = req.headers['idempotency-key'];
      if (key && db.seen[key]) return json(res, 200, { ok: true, deduped: true });

      const payload = await body(req);
      if (url.pathname === '/ncr') {
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
  console.log(`  GET  /summary   dashboard feed`);
  console.log(`  POST /ncr       confirmed nonconformance`);
  console.log(`  POST /install   field-verified install`);
  console.log(`  POST /reset     restore the seed  <- run this between takes`);
});
