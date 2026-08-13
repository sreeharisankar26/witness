/**
 * Does this hold up on a real project?
 *
 *   node tools/bench.mjs            # 1k, 10k, 100k units
 *   node tools/bench.mjs 250000     # one specific size
 *
 * "Scales across large construction projects" is a claim, and until it has a
 * number attached it is only a claim. A tower is tens of thousands of installed
 * components; the demo record has 119. This measures the gap.
 *
 * What is measured is the SAFETY PATH — the work done between a worker holding
 * their phone at a part and the verdict appearing. That path runs on a cheap
 * Android handset with no network, so the numbers that matter are per-scan
 * latency and the memory the record occupies, not server throughput.
 *
 * Reports p50/p99 rather than a mean, because a mean hides exactly the case a
 * worker notices. Writes tools/bench.txt.
 *
 * Node core only.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(here, '..');

/**
 * A dynamic import takes a URL, not a path.
 *
 * On Linux and macOS an absolute path happens to work, because it starts with a
 * slash and the loader reads it as a relative URL. On Windows it starts with
 * "C:" and the loader reads that as a URL scheme it has never heard of, so this
 * file failed on Windows and nowhere else — with an error that names ESM
 * loaders and says nothing about paths.
 */
const load = p => import(pathToFileURL(p).href);

const { resolve, memoryFor, supersededChain, buildIndex } =
  await load(join(ROOT, 'app', 'src', 'engine', 'resolve.ts'));
const { forecast } = await load(join(ROOT, 'server', 'forecast.mjs'));
const { deriveReturnBatches, deriveReorder } = await load(join(ROOT, 'server', 'reorder.mjs'));

const out = [];
const p = s => { out.push(String(s)); console.log(String(s)); };

/* ── a synthetic project of arbitrary size ───────────────────────────────── */

const SKUS = ['GT-12', 'AHU-04', 'VLV-22', 'PNL-08', 'DMP-05', 'SPR-14', 'PMP-31', 'FCU-17', 'CBL-90', 'ISO-02'];
const REVS = ['A', 'B', 'C', 'D'];

/**
 * Shaped like a real tower rather than uniformly random: many zones, a long
 * tail of parts, and nonconformances clustered in a few places — which is what
 * makes memoryFor() expensive, since it scans for the ones that match.
 */
function project(units) {
  const zoneCount = Math.max(4, Math.round(units / 400));
  const zones = Array.from({ length: zoneCount }, (_, i) => ({
    id: `ZONE-${i}`, name: `Level ${Math.floor(i / 4) + 1} Area ${i % 4}`,
  }));

  const unitList = Array.from({ length: units }, (_, i) => ({
    serial: `SN-${i}`,
    sku: SKUS[i % SKUS.length],
    rev: REVS[i % REVS.length],
  }));

  const submittals = [];
  for (const z of zones) {
    for (const sku of SKUS) {
      submittals.push({
        id: `SUB-${z.id}-${sku}`, sku, zone_id: z.id,
        description: `${sku} assembly`, approved_rev: 'C', approved_date: '2026-07-01',
      });
    }
  }

  const revisions = [];
  for (const sku of SKUS) {
    revisions.push(
      { sku, rev: 'A', superseded_by: 'B', approved_date: '2026-01-01' },
      { sku, rev: 'B', superseded_by: 'C', approved_date: '2026-03-01' },
      { sku, rev: 'C', superseded_by: null, approved_date: '2026-07-01' },
      { sku, rev: 'D', superseded_by: null, approved_date: '2026-07-01' },
    );
  }

  // Roughly 3% of installs go wrong, which is a plausible rework rate.
  const ncrs = [];
  const bad = Math.round(units * 0.03);
  for (let i = 0; i < bad; i++) {
    const z = zones[i % zones.length];
    const sku = SKUS[i % SKUS.length];
    ncrs.push({
      id: `NCR-${i}`, serial: `SN-${i * 7 % units}`, sku, zone_id: z.id,
      installed_rev: 'B', approved_rev: 'C',
      created_at: new Date(Date.now() - i * 36e5).toISOString(),
      confirmed_by: `Worker ${i % 12}`, status: 'OPEN',
    });
  }

  const installs = unitList.map((u, i) => ({
    id: `INS-${i}`, serial: u.serial, sku: u.sku,
    zone_id: zones[i % zones.length].id,
    installed_at: '2026-07-01',
    status: i % 20 === 0 ? 'VERIFIED' : i % 33 === 0 ? 'FLAGGED' : 'PENDING',
  }));

  return {
    units: unitList, submittals, revisions, ncrs, zones, installs,
    record_synced_at: new Date().toISOString(),
  };
}

/* ── timing ──────────────────────────────────────────────────────────────── */

function measure(fn, iterations) {
  // Warm up so the first JIT pass is not counted as the product being slow.
  for (let i = 0; i < Math.min(50, iterations); i++) fn(i);

  const times = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn(i);
    times[i] = performance.now() - t0;
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { p50: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1] };
}

const ms = n => (n < 0.01 ? '<0.01' : n.toFixed(n < 1 ? 3 : 1));
const row = (label, r, note = '') =>
  p(`  ${label.padEnd(30)} ${String(ms(r.p50)).padStart(8)} ${String(ms(r.p99)).padStart(9)} ${String(ms(r.max)).padStart(9)}   ${note}`);

/** Rough heap cost of holding the record, which is the phone-side constraint. */
function footprintMb(snap) {
  return Buffer.byteLength(JSON.stringify(snap)) / 1048576;
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const sizes = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const SIZES = sizes.length ? sizes : [1000, 10000, 100000];

p('WITNESS SCALE BENCHMARK  ' + new Date().toISOString());
p(`node ${process.version}`);
p('');
p('The safety path is what matters: the work between a worker holding the phone');
p('at a part and the verdict appearing. It runs offline on a cheap handset.');
p('');

for (const n of SIZES) {
  const t0 = performance.now();
  const snap = project(n);
  const built = performance.now() - t0;

  p('─'.repeat(84));
  p(`  ${n.toLocaleString()} units · ${snap.zones.length} zones · ${snap.submittals.length.toLocaleString()} submittals · ${snap.ncrs.length.toLocaleString()} NCRs`);
  p(`  record built in ${built.toFixed(0)}ms · ${footprintMb(snap).toFixed(1)} MB held in memory`);
  p('');
  p(`  ${'operation'.padEnd(30)} ${'p50 ms'.padStart(8)} ${'p99 ms'.padStart(9)} ${'max ms'.padStart(9)}   note`);

  const now = new Date().toISOString();
  const iters = n >= 100000 ? 300 : 2000;

  // Built once per snapshot, so it is amortised across every scan of a shift.
  // Measured separately rather than hidden inside the first scan.
  const idxT = performance.now();
  buildIndex(snap);
  p(`  index built once in ${(performance.now() - idxT).toFixed(1)}ms — amortised across every scan`);
  p('');

  // The whole safety path: one scan, one verdict.
  row('resolve() — one scan', measure(i => {
    const u = snap.units[(i * 7919) % snap.units.length];
    resolve(snap, { version: 1, sku: u.sku, serial: u.serial, source: 'TAG', confidence: 1 },
      snap.zones[i % snap.zones.length].id, { now });
  }, iters), 'THE NUMBER A WORKER FEELS');

  row('memoryFor()', measure(i =>
    memoryFor(snap, SKUS[i % SKUS.length], snap.zones[i % snap.zones.length].id), iters));

  row('supersededChain()', measure(i =>
    supersededChain(snap, SKUS[i % SKUS.length], 'A', 'C'), iters));

  // Server-side read model. Runs on a laptop, per dashboard poll.
  const zoneAgg = snap.zones.map((z, i) => ({
    zone_id: z.id, name: z.name,
    flagged: Math.round(snap.ncrs.length / snap.zones.length),
    correct: Math.round(n / snap.zones.length / 20),
    unscanned: Math.round(n / snap.zones.length),
  }));
  row('forecast() — whole site', measure(() => forecast(zoneAgg), Math.min(200, iters)), 'server, per poll');

  row('deriveReturnBatches()', measure(() => deriveReturnBatches({
    ncrs: snap.ncrs, reports: [], units: snap.units, submittals: snap.submittals, decisions: {},
  }), Math.min(30, iters)), 'server, per poll');

  p('');
}

p('─'.repeat(84));
p('');
p('  Read this honestly:');
p('');
p('  * resolve() is the only figure on the worker\'s path. Everything else runs');
p('    on the laptop and can be slow without anyone noticing.');
p('  * The MB figure is the real ceiling. The whole approved record is held in');
p('    memory on the phone so a scan needs no I/O and no radio — which is what');
p('    makes the offline guarantee possible, and what puts a limit on project');
p('    size per device. Past that limit the record would have to be scoped to');
p('    the zones a worker actually covers, which is a change to the adapter and');
p('    nothing else.');
p('  * These are Node numbers on a laptop. A mid-range Android running Hermes is');
p('    slower, and the honest multiplier is roughly 3-5x.');

writeFileSync(join(here, 'bench.txt'), out.join('\n'));
console.log('\nWritten to tools\\bench.txt');
