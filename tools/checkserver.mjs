/**
 * Is the sync server that is ANSWERING the same code that is on disk?
 *
 * Writes tools/servercheck.txt as well as printing, so the result survives the
 * console window closing.
 */
import { statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const B = 'http://127.0.0.1:8787';
const out = [];
const p = s => { out.push(String(s)); console.log(String(s)); };

const get = async path => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 4000);
  try {
    const r = await fetch(B + path, { signal: c.signal });
    return { status: r.status, body: r.ok ? await r.json() : null };
  } catch (e) { return { status: 0, error: e.message }; }
  finally { clearTimeout(t); }
};

let onDisk = 0;
for (const f of ['index.mjs', 'reorder.mjs']) {
  try { onDisk = Math.max(onDisk, statSync(join(ROOT, 'server', f)).mtimeMs); } catch {}
}
onDisk = Math.round(onDisk);

const h = await get('/health');
if (!h.body) {
  p('  SYNC SERVER: not answering on 8787 (' + (h.error || h.status) + ')');
} else {
  const stamp = h.body.srcStamp;
  const stale = typeof stamp !== 'number' || stamp < onDisk;
  p('  SYNC SERVER: up, started ' + h.body.startedAt);
  p('  code in memory : ' + (stamp ?? '(no stamp - old build)'));
  p('  code on disk   : ' + onDisk);
  p(stale ? '  *** STALE - restart it ***' : '  current - matches the files on disk');
}

for (const path of ['/summary', '/zone?id=ZONE-A', '/reorder']) {
  const r = await get(path);
  p(`  ${path.padEnd(18)} -> ${r.status}${r.status === 200 ? ' ok' : ' <-- PROBLEM'}`);
}

const s = await get('/summary');
if (s.body) {
  p('  reorder lines  : ' + (s.body.reorder ? s.body.reorder.length : 'FIELD MISSING - old build'));
  p('  return batches : ' + (s.body.returnBatches ? s.body.returnBatches.length : 'FIELD MISSING - old build'));
}

writeFileSync(join(here, 'servercheck.txt'), out.join('\n'), 'utf8');
