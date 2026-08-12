/**
 * Does the model key actually work, and which paths does it light up?
 *
 *   node tools/modeltest.mjs
 *
 * Exists because "the AI is configured" is not something anyone should discover
 * is false during a demo. Every model path in Witness is optional by design, so
 * a missing key degrades silently and correctly — which is exactly what makes it
 * easy to miss that nothing is running at all.
 *
 * Exercises all three, reports latency, and writes tools/modeltest.txt.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, askJson, providerOf, resolveModel } from '../server/model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const out = [];
const p = s => { out.push(String(s)); console.log(String(s)); };

const env = (() => {
  const f = join(ROOT, 'app', '.env');
  const o = {};
  if (!existsSync(f)) return o;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2];
  }
  return o;
})();

const url = env.EXPO_PUBLIC_LLM_URL;
const key = env.EXPO_PUBLIC_LLM_KEY;
const textModel = env.EXPO_PUBLIC_LLM_MODEL;
const visionModel = env.EXPO_PUBLIC_VLM_MODEL || textModel;

p('WITNESS MODEL CHECK  ' + new Date().toISOString());
p('');

if (!url || !key) {
  p('  NO MODEL CONFIGURED.');
  p('');
  p('  Every model path is optional, so the app still works — but three things');
  p('  are currently doing nothing:');
  p('    - nameplate reading (rung 2 of the fallback ladder)');
  p('    - document ingestion reads the register with patterns, not a model');
  p('    - verdicts are phrased from the on-device template');
  p('');
  p('  Free option that needs no card and does vision:');
  p('    1. aistudio.google.com -> Get API key -> Create API key');
  p('    2. In the control panel, set');
  p('         URL   https://generativelanguage.googleapis.com/v1beta/openai');
  p('         key   (paste it)');
  p('    3. Run this again — it asks your key which models it can use and');
  p('       tells you exactly what to put in the model field.');
  writeFileSync(join(here, 'modeltest.txt'), out.join('\n'));
  process.exit(1);
}

p(`  endpoint : ${url}`);
p(`  provider : ${providerOf(url)} shape`);
p(`  text     : ${textModel}`);
p(`  vision   : ${visionModel}`);
p('');

let failures = 0;
/**
 * These start as whatever .env says and are replaced if that model turns out to
 * be retired. Model names rot — the whole point of this file is to find that out
 * here rather than three minutes into a take.
 */
let useText = textModel, useVision = visionModel, swapped = null;
const report = (name, ok, detail, ms) => {
  p(`  ${ok ? '[ok]  ' : '[FAIL]'} ${name.padEnd(34)} ${ms ? String(ms).padStart(6) + 'ms  ' : '          '}${detail}`);
  if (!ok) failures++;
};

// 1. Can it talk at all?
{
  const resolved = await resolveModel({ url, key, model: useText });
  if (resolved.available) {
    const chat = resolved.available.filter(m => /gemini|gpt|claude|llama|mistral|qwen/i.test(m));
    p('  Models this key can use:');
    for (const m of chat.slice(0, 14)) p(`      ${m}`);
    if (chat.length > 14) p(`      … and ${chat.length - 14} more`);
    p('');
  }
  if (resolved.swapped) {
    swapped = resolved.swapped;
    useText = resolved.model;
    useVision = resolved.model;
    p(`  "${resolved.previous}" is retired. Continuing with ${resolved.model}.`);
    p('');
  }

  const r = resolved.ok
    ? await ask({ url, key, model: useText, maxTokens: 32, prompt: 'Reply with exactly the word: READY' })
    : { ok: false, error: resolved.error, ms: 0 };

  report('Model reachable', r.ok && /READY/i.test(r.text || ''),
    r.ok ? `replied ${JSON.stringify((r.text || '').trim().slice(0, 40))}` : r.error, r.ms);
  if (!r.ok) {
    p('');
    p('  Nothing else can pass while this fails. Common causes:');
    p('    401/403  the key is wrong, or pasted with a stray space');
    p('    404      the model name is retired, or the URL includes /chat/completions');
    p('             (it should stop at the base — this tool appends the path)');
    p('    429      free-tier rate limit — wait a minute and run this again');
    writeFileSync(join(here, 'modeltest.txt'), out.join('\n'));
    process.exit(1);
  }
}

// 2. Structured extraction — what ingestion depends on.
{
  const r = await askJson({
    url, key, model: useText, maxTokens: 900,
    prompt: `Extract every row. Return ONLY JSON: {"rows":[{"id":"","sku":"","rev":"","zone":"","status":""}]}

SUB-0001  GT-12   Zone A   Rev C   APPROVED
SUB-0002  VLV-22  Zone B   Rev A   PENDING`,
  });
  const rows = r.ok && Array.isArray(r.data?.rows) ? r.data.rows : null;
  const gotBoth = rows && rows.length === 2;
  const keptPending = rows && rows.some(x => /pending/i.test(String(x.status)));
  report('Structured extraction', Boolean(gotBoth && keptPending),
    r.ok ? (gotBoth ? (keptPending ? 'both rows, PENDING preserved' : 'dropped the PENDING row — the gate would never see it')
                    : `expected 2 rows, got ${rows ? rows.length : '?'}`)
         : r.error, r.ms);
}

// 3. Vision — rung 2 of the ladder. A 2x2 JPEG is enough to prove the
//    multimodal path is wired; whether it can read a dirty nameplate is a
//    question for a real photograph, not a self-test.
{
  const TINY_JPEG =
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAHwAAAQUBAQEB'
    + 'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh'
    + 'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ'
    + 'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG'
    + 'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiv/9k=';
  const r = await ask({
    url, key, model: useVision, maxTokens: 32,
    prompt: 'Reply with exactly the word: SEEN',
    images: [TINY_JPEG],
  });
  report('Vision path (nameplate)', r.ok, r.ok ? 'accepted an image' : r.error, r.ms);
  if (!r.ok) p('         nameplate reading will fall through to "type the serial in"');
}

// 4. Phrasing — cosmetic, and must never be load-bearing.
{
  const r = await ask({
    url, key, model: useText, maxTokens: 90, temperature: 0.3,
    prompt: 'Rewrite for a worker on a noisy site, one short sentence, no preamble: '
          + '"Installed revision B does not match approved revision C for zone A."',
  });
  report('Verdict phrasing', r.ok,
    r.ok ? JSON.stringify((r.text || '').trim().slice(0, 60)) : r.error, r.ms);
}

p('');
if (swapped) {
  p(`  YOUR .env IS OUT OF DATE. It names "${textModel}", which this key cannot use.`);
  p(`  Everything above ran against "${swapped}" instead. Set both lines in app/.env:`);
  p('');
  p(`      EXPO_PUBLIC_LLM_MODEL=${swapped}`);
  p(`      EXPO_PUBLIC_VLM_MODEL=${swapped}`);
  p('');
  p('  (or paste it into the control panel Model field and press Save settings)');
  p('');
}
p(failures === 0
  ? '  All model paths are live. Ingestion will read documents with the model,\n'
    + '  reading each one twice and holding any row the reads disagree on.'
  : `  ${failures} path(s) unavailable. Witness still works — every one of these is\n`
    + '  optional by design — but the AI half of the story is not running.');

writeFileSync(join(here, 'modeltest.txt'), out.join('\n'));
console.log('\nWritten to tools\\modeltest.txt');
process.exit(failures === 0 ? 0 : 1);
