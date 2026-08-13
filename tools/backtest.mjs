/**
 * Would it actually have caught them?
 *
 *   node --experimental-strip-types tools/backtest.mjs
 *
 * The economics on every slide in this space are illustrative: "rework is 5-15%
 * of project cost, catch a third of it, save X". Fine as an argument, worth
 * nothing as evidence, because it assumes the catch rate rather than measuring
 * it.
 *
 * This measures it. Every nonconformance in the record is a wrong part that
 * really went in. For each one, reconstruct what a worker would have been
 * holding at that moment, hand it to the engine, and ask what the engine would
 * have said BEFORE it was fitted.
 *
 * Two things are counted, because only reporting the first would be dishonest:
 *
 *   CAUGHT        a real nonconformance the engine stops
 *   FALSE ALARM   a correctly installed unit the engine would have stopped
 *
 * A tool that flags everything catches everything and is worthless. The second
 * number is what keeps the first one meaningful.
 *
 * The NCR being present in the record does NOT help the engine find it: the
 * verdict comes from comparing the unit's revision against the approved
 * submittal for its zone. Prior NCRs only feed the memory warning, which is
 * advisory and changes no verdict. Memory is therefore excluded from the count.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(here, '..');
// A dynamic import takes a URL, not a path. An absolute Windows path begins
// "C:", which the ESM loader reads as an unknown URL scheme — so this line
// worked everywhere except the machine the demo is recorded on.
const { resolve, severityOf } =
  await import(pathToFileURL(join(ROOT, 'app', 'src', 'engine', 'resolve.ts')).href);

const out = [];
const p = s => { out.push(String(s)); console.log(String(s)); };

const recordPath = process.argv[2]
  ? resolvePath(process.argv[2])
  : join(ROOT, 'app', 'src', 'data', 'witness_seed.json');
const snap = JSON.parse(readFileSync(recordPath, 'utf8'));
snap.record_synced_at = new Date().toISOString();   // fresh, so nothing is downgraded for age

const now = new Date().toISOString();
const ask = (sku, serial, zone) =>
  resolve(snap, { version: 1, sku, serial, source: 'TAG', confidence: 1 }, zone, { now });

/** A verdict that stops work. Anything else lets the part go in. */
const stops = r => severityOf(r.verdict) === 'STOP';

p('WITNESS BACKTEST  ' + new Date().toISOString());
p(`record: ${recordPath.replace(ROOT, '.')}`);
p('');

/* ── 1. the nonconformances that really happened ─────────────────────────── */

const caught = [], missed = [];
for (const n of snap.ncrs) {
  const r = ask(n.sku, n.serial, n.zone_id);
  (stops(r) ? caught : missed).push({ ncr: n, verdict: r.verdict, authority: r.authority });
}

p('  NONCONFORMANCES THAT REALLY HAPPENED');
p(`  ${snap.ncrs.length} in this record. For each, what would the engine have said at the point of install?`);
p('');
for (const c of caught) {
  p(`   CAUGHT   ${c.ncr.id.padEnd(10)} ${c.ncr.sku.padEnd(8)} ${c.ncr.serial.padEnd(9)} ${c.ncr.zone_id.padEnd(8)} -> ${c.verdict} (${c.authority})`);
}
for (const m of missed) {
  p(`   MISSED   ${m.ncr.id.padEnd(10)} ${m.ncr.sku.padEnd(8)} ${m.ncr.serial.padEnd(9)} ${m.ncr.zone_id.padEnd(8)} -> ${m.verdict}`);
}

const rate = snap.ncrs.length ? caught.length / snap.ncrs.length : 0;
p('');
p(`   caught ${caught.length} of ${snap.ncrs.length}  =  ${Math.round(rate * 100)}%`);

if (missed.length) {
  p('');
  p('   Why the misses matter more than the catches: each one is a wrong part');
  p('   this system would have let through. Look at what they have in common.');
  const reasons = {};
  for (const m of missed) reasons[m.verdict] = (reasons[m.verdict] ?? 0) + 1;
  for (const [v, c] of Object.entries(reasons)) p(`     ${c} x ${v}`);
}

/* ── 2. the cost of being wrong the other way ────────────────────────────── */

const verified = (snap.installs ?? []).filter(i => i.status === 'VERIFIED');
const falseAlarms = [];
for (const i of verified) {
  const r = ask(i.sku, i.serial, i.zone_id);
  if (stops(r)) falseAlarms.push({ install: i, verdict: r.verdict });
}

p('');
p('  THE OTHER HALF');
p(`  ${verified.length} units were installed correctly and signed off. How many would it have stopped?`);
p('');
if (falseAlarms.length === 0) {
  p('   0 false alarms. It stopped nothing that was right.');
} else {
  for (const f of falseAlarms) {
    p(`   FALSE ALARM  ${f.install.sku} ${f.install.serial} in ${f.install.zone_id} -> ${f.verdict}`);
  }
  p('');
  p(`   ${falseAlarms.length} of ${verified.length} correct installs would have been stopped.`);
  p('   Every one of these is a worker told to stop for no reason, which is how');
  p('   a tool gets ignored.');
}

/* ── 3. what it is worth, using the measured rate ────────────────────────── */

p('');
p('  WHAT THAT IS WORTH');
p('');
const PROJECT = 10_000_000;
p(`  On a $${(PROJECT / 1e6).toFixed(0)}M project, applying the published rework range and`);
p('  THIS measured catch rate rather than an assumed one:');
p('');
for (const [reworkPct, label] of [[0.05, 'low end of the range'], [0.15, 'high end']]) {
  const rework = PROJECT * reworkPct;
  const versionLinked = rework * 0.5;      // industry estimate, and the weakest link here
  const saved = versionLinked * rate;
  p(`   rework at ${(reworkPct * 100).toFixed(0)}% (${label})`);
  p(`     $${(rework / 1e3).toFixed(0)}K rework  ->  ~$${(versionLinked / 1e3).toFixed(0)}K version-linked  ->  $${(saved / 1e3).toFixed(0)}K at a ${Math.round(rate * 100)}% catch rate`);
}
p('');
p('  The catch rate above is measured on this project\'s own record. The 5-15%');
p('  rework range and the "about half is version-linked" split are industry');
p('  figures we did not measure and should not pretend to have. Only one of the');
p('  three numbers in that chain is ours.');

/* ── what this cannot tell you ───────────────────────────────────────────── */

p('');
p('  WHAT THIS DOES NOT MEASURE');
p('');
p(`  * Sample size. ${snap.ncrs.length} nonconformances is not a rate, it is an`);
p('    indication. A percentage from single figures should be read as "it caught');
p('    the ones we have" and nothing stronger.');
p('  * The record is synthetic. A real pilot would replay a contractor\'s own');
p('    closed NCR log, which is the measurement that would actually settle this.');
p('  * Whole classes of defect are invisible to it BY DESIGN. Witness compares an');
p('    identity and a revision against an approved record. It cannot see bad');
p('    workmanship, a part fitted the wrong way round, a correct revision');
p('    installed in the wrong place by a worker who set the zone wrongly, or a');
p('    part with no tag that nobody chose to scan. Those are not misses. They are');
p('    outside what this system claims to do, and a version of it that claimed');
p('    otherwise would be worse, not better.');
p('  * It assumes the part was scanned. Coverage is a separate problem from');
p('    accuracy, and the dashboard measures it separately for that reason.');

p('');
p(`  SUMMARY  catch ${Math.round(rate * 100)}%  ·  false alarms ${falseAlarms.length}/${verified.length}  ·  ${snap.ncrs.length} nonconformances replayed`);

writeFileSync(join(here, 'backtest.txt'), out.join('\n'));
console.log('\nWritten to tools\\backtest.txt');
