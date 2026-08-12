/**
 * Witness — verify the control panel end to end, without a browser.
 *
 * Starts the panel on a spare port, exercises every endpoint the "Start
 * everything" button uses, writes tools/verify.txt, then shuts everything it
 * started back down. Nothing here changes firewall or system settings.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

const out = [];
const p = s => { out.push(String(s)); console.log(String(s)); };
const flush = () => writeFileSync(join(here, 'verify.txt'), out.join('\n'), 'utf8');

const get = async (path, ms = 45000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await (await fetch(BASE + path, { signal: c.signal })).json(); }
  catch (e) { return { __error: String(e.message) }; }
  finally { clearTimeout(t); }
};
const post = async (path, body = {}, ms = 90000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await (await fetch(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: c.signal,
    })).json();
  } catch (e) { return { __error: String(e.message) }; }
  finally { clearTimeout(t); }
};

p('WITNESS VERIFY  ' + new Date().toISOString());
p('');

const panel = spawn(process.execPath, [join(here, 'control', 'server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, WITNESS_PANEL_PORT: String(PORT), WITNESS_NO_OPEN: '1' },
  windowsHide: true,
});
let panelLog = '';
panel.stdout.on('data', d => panelLog += d);
panel.stderr.on('data', d => panelLog += d);

const shutdown = async () => {
  await post('/api/stop', { name: 'expo' }, 5000);
  await post('/api/stop', { name: 'server' }, 5000);
  await post('/api/free-ports', {}, 20000);
  await post('/api/quit', {}, 5000);
  setTimeout(() => { try { panel.kill(); } catch {} }, 800);
};

try {
  // Wait for the panel to answer rather than guessing at a sleep.
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await new Promise(r => setTimeout(r, 400));
    up = !(await get('/api/state', 1500)).__error;
  }
  p('panel responding: ' + (up ? 'yes' : 'NO — aborting'));
  if (!up) { p(panelLog); flush(); await shutdown(); process.exit(1); }
  p('');

  const s = await get('/api/state');
  p('--- what the panel sees ---');
  p('  node                ' + s.node + (s.nodeOk ? ' (ok)' : ' (TOO OLD)'));
  p('  addresses           ' + (s.ips || []).map(i => `${i.ip} [${i.iface}]${i.routed ? ' <-ROUTED' : ''}${i.virt ? ' virtual' : ''}`).join('  |  '));
  p('  best address        ' + (s.bestIp || '(none)'));
  p('  network             ' + (s.network?.name || '?') + '  category=' + (s.network?.category || '?')
    + (s.network?.publicRisk ? '   *** PUBLIC: Windows blocks inbound ***' : ''));
  p('  firewall rules      ' + (s.firewall?.present ? s.firewall.names.join(', ') : '*** NONE — phone cannot reach this PC ***'));
  p('  .env address        ' + (s.env?.EXPO_PUBLIC_SERVER_URL || '(unset)'));
  p('  address still valid ' + (s.address?.matches ? 'yes' : 'NO — stale'));
  p('  sync server up      ' + s.serverUp);
  p('');

  p('--- pressing "Start everything" ---');
  const r = await post('/api/start-all', {});
  for (const st of r.steps || []) p(`  ${st.ok ? '[ok]  ' : '[FAIL]'} ${st.label} — ${st.detail}`);
  p('  result              ' + (r.ok ? 'started' : 'FAILED: ' + r.error));
  if (r.ok) {
    p('  address chosen      ' + r.ip);
    p('  health check url    ' + r.healthUrl);
    p('  phone will connect  ' + (r.blocked ? 'NO — firewall/network blocks it (press "Let my phone in")' : 'yes, once Metro finishes booting'));
  }
  p('');

  // Metro takes a while to print its URL; that URL is what the QR is built from.
  p('--- waiting for Expo to advertise a URL (up to 90s) ---');
  let exp = null;
  for (let i = 0; i < 90 && !exp; i++) {
    await new Promise(r2 => setTimeout(r2, 1000));
    exp = (await get('/api/state', 3000)).expUrl;
  }
  p('  exp url             ' + (exp || 'NOT SEEN — see the expo log below'));
  if (exp && r.ip) {
    p('  matches .env host   ' + (exp.includes(r.ip) ? 'YES — QR and sync server agree' : `NO — QR says ${exp}, sync says ${r.ip}`));
  }
  p('');

  const st = await get('/api/selftest');
  p('--- self test ---');
  for (const c of st.checks || []) p(`  ${c.ok ? '[ok]  ' : '[FAIL]'} ${c.name} — ${c.detail}`);
  p('');

  const bc = await get('/api/buildcheck');
  p('--- build check ---');
  for (const c of bc.checks || []) p(`  ${c.ok ? '[ok]  ' : '[FAIL]'} ${c.name} — ${c.detail}`);
  p('');

  const lg = await get('/api/log?name=expo&since=0');
  p('--- expo log ---');
  for (const l of (lg.lines || []).slice(-40)) p('  ' + l.text);
} catch (e) {
  p('VERIFY CRASHED: ' + (e?.stack || e));
} finally {
  p('');
  p('--- panel process output ---');
  p(panelLog.trim() || '(none)');
  flush();
  await shutdown();
  console.log('\nWritten to tools\\verify.txt');
  setTimeout(() => process.exit(0), 1500);
}
