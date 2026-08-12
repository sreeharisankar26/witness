/**
 * Witness Control Panel — backend.
 *
 * Runs every command you would otherwise type, keeps the long-lived processes
 * alive, streams their output to the browser, and shows a scannable QR for the
 * Expo dev URL. Node core only; nothing to install.
 *
 * Design note, learned the hard way: this process does NOT try to launch a web
 * browser to show you a file. Asking Windows to "start" a file:// URL from a
 * spawned process is unreliable in ways that fail silently. Instead every
 * viewable file is SERVED over http from here, and the panel — which is already
 * in a browser — opens it in a tab. The browser was always the right tool.
 *
 * Started by Witness.bat.
 */
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

import { dirname, join, resolve as resolvePath, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces, homedir } from 'node:os';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { cpSync, mkdirSync } from 'node:fs';
import { toSvg } from './qr.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(here, '..', '..');        // the witness/ folder
const APP = join(ROOT, 'app');
const PORT = Number(process.env.WITNESS_PANEL_PORT || 8790);
const isWin = process.platform === 'win32';
const PY = isWin ? 'python' : 'python3';

// ─────────────────────────────────────────────────────────── process registry
/** name -> { child, log[], status, meta } */
const procs = new Map();
const LOG_CAP = 500;
let logSeq = 0;   // monotonic across all processes

function entry(name) {
  if (!procs.has(name)) {
    procs.set(name, { child: null, log: [], status: 'stopped', meta: {} });
  }
  return procs.get(name);
}

function say(name, line, kind = 'out') {
  const e = entry(name);
  for (const raw of String(line).split(/\r?\n/)) {
    const text = raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
    if (!text.trim()) continue;
    e.log.push({ seq: ++logSeq, t: Date.now(), kind, text });
  }
  if (e.log.length > LOG_CAP) e.log.splice(0, e.log.length - LOG_CAP);
}

/**
 * With shell:true the command line goes to the shell verbatim, so anything with
 * a space must be quoted by us. Node's default install path is
 * "C:\Program Files\nodejs\node.exe" — unquoted, the shell reads that as the
 * program "C:\Program" and reports something baffling.
 */
const q = s => (/[\s&()[\]{}^=;!'+,`~]/.test(String(s)) && !/^".*"$/.test(String(s)))
  ? `"${s}"` : String(s);

function launch(name, command, args, opts = {}) {
  const e = entry(name);
  if (e.child && e.child.exitCode === null && !e.child.killed) {
    return { ok: false, error: `${name} is already running — stop it first` };
  }
  e.child = null;
  e.log = [];
  e.status = 'running';
  e.meta = {};
  say(name, opts.raw ? `$ ${opts.raw}` : `$ ${q(command)} ${args.map(q).join(' ')}`, 'cmd');

  let child;
  try {
    if (opts.raw) {
      // A single shell string, used when two commands must run in order.
      child = spawn(opts.raw, {
        cwd: opts.cwd || ROOT, env: { ...process.env, ...opts.env },
        shell: true, windowsHide: true,
      });
      e.child = child;
      child.stdout.on('data', d => { say(name, d.toString()); sniff(name); });
      child.stderr.on('data', d => { say(name, d.toString(), 'err'); sniff(name); });
      child.on('error', err => {
        say(name, `could not start: ${err.message}`, 'err');
        e.status = 'error'; e.meta.error = err.message; e.child = null;
      });
      child.on('close', code => {
        say(name, `— exited with code ${code} —`, 'cmd');
        e.meta.exitCode = code;
        e.status = code === 0 ? 'done' : 'error';
        if (code !== 0) e.meta.error = `exited with code ${code}`;
        e.child = null; sniff(name);
      });
      return { ok: true };
    }
    // shell:true lets Node apply the platform's own quoting and resolves the
    // .cmd shims npm/npx use on Windows.
    child = spawn(q(command), args.map(q), {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...opts.env },
      shell: true,
      windowsHide: true,
    });
  } catch (err) {
    say(name, `could not start: ${err.message}`, 'err');
    e.status = 'error'; e.meta.error = err.message;
    return { ok: false, error: err.message };
  }

  e.child = child;
  child.stdout.on('data', d => { say(name, d.toString()); sniff(name); });
  child.stderr.on('data', d => { say(name, d.toString(), 'err'); sniff(name); });
  child.on('error', err => {
    say(name, `could not start: ${err.message}`, 'err');
    e.status = 'error'; e.meta.error = err.message; e.child = null;
  });
  child.on('close', code => {
    say(name, `— exited with code ${code} —`, 'cmd');
    e.meta.exitCode = code;
    e.status = code === 0 ? 'done' : 'error';
    if (code !== 0) e.meta.error = `exited with code ${code}`;
    e.child = null;
    sniff(name);
  });
  return { ok: true };
}

function stop(name) {
  const e = entry(name);
  if (!e.child) return { ok: false, error: 'not running' };
  const pid = e.child.pid;
  // With shell:true the child is the shell; Expo/Metro live underneath it.
  // /T takes the whole tree, otherwise the port stays bound.
  if (isWin) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  else e.child.kill('SIGTERM');
  return { ok: true };
}

/**
 * Derive facts from the accumulated log.
 *
 * Reads the WHOLE log, not the chunk that just arrived — stdout arrives in
 * arbitrary pieces and a summary line split across two chunks would never match.
 * That is why the checklist did not tick after a successful test run.
 */
function sniff(name) {
  const e = entry(name);
  const all = e.log.map(l => l.text).join('\n');

  const exp = /exp:\/\/[0-9a-zA-Z.\-]+:\d+/.exec(all);
  if (exp) e.meta.expUrl = exp[0];
  if (/Metro waiting on|Waiting on http|Logs for your project/i.test(all)) e.meta.ready = true;

  if (name === 'test') {
    const pass = /^#\s*pass\s+(\d+)/m.exec(all);
    const fail = /^#\s*fail\s+(\d+)/m.exec(all);
    if (pass) e.meta.pass = Number(pass[1]);
    if (fail) e.meta.fail = Number(fail[1]);
    // Belt and braces: a clean exit means the suite passed even if the summary
    // lines were mangled.
    if (e.meta.exitCode === 0 && e.meta.pass === undefined) e.meta.pass = -1;
  }
}

// ─────────────────────────────────────────────────────────────── environment
/**
 * Which address does traffic to the internet actually leave from?
 *
 * Interface NAMES lie. A WSL or Hyper-V adapter can be called anything, and on
 * this machine the real campus wifi sits on 172.24.x.x — a range that "looks
 * virtual" to any heuristic based on the address alone. The routing table does
 * not guess: whichever address owns the default route is the one a phone on the
 * same network can reach. Everything else is ranking.
 *
 * Cached, because it is read on every poll and the answer changes only when the
 * machine changes network — which we detect anyway.
 */
let routeCache = { at: 0, ip: '' };
function defaultRouteIp() {
  if (Date.now() - routeCache.at < 4000) return routeCache.ip;
  let ip = '';
  try {
    if (isWin) {
      const out = execSync('route print -4 0.0.0.0', { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      // "  0.0.0.0   0.0.0.0   172.24.64.1   172.24.67.28   30"
      let best = Infinity;
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/.exec(line);
        if (m && Number(m[3]) < best) { best = Number(m[3]); ip = m[2]; }
      }
    } else {
      const out = execSync("ip -4 route get 1.1.1.1 2>/dev/null || route -n get 1.1.1.1 2>/dev/null",
        { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /src\s+(\d+\.\d+\.\d+\.\d+)|interface:\s*\S+[\s\S]*?\n/.exec(out);
      if (m && m[1]) ip = m[1];
    }
  } catch { /* no route, no network */ }
  routeCache = { at: Date.now(), ip };
  return ip;
}

function lanIps() {
  const out = [];
  const routed = defaultRouteIp();
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      const virt = /loopback|wsl|vethernet|virtualbox|vmware|hyper-v|docker|tailscale|zerotier|radmin|hamachi/i.test(iface);
      out.push({
        iface, ip: a.address,
        wifi: /wi-?fi|wlan|wireless/i.test(iface),
        virt,
        routed: a.address === routed,
      });
    }
  }
  // The routed address wins outright — it is a fact, not a guess. Then real
  // wifi, then everything else. Nothing is hidden: the only usable network is
  // sometimes an unusual one.
  return out.sort((a, b) =>
    Number(b.routed) - Number(a.routed) ||
    Number(a.virt) - Number(b.virt) ||
    Number(b.wifi) - Number(a.wifi));
}

/** The address to hand a phone, unless the operator picked another. */
function bestIp() {
  const list = lanIps();
  return list.length ? list[0].ip : '';
}

/**
 * Windows classifies every network as Public, Private or Domain, and on a
 * PUBLIC network the firewall drops inbound connections regardless of what
 * Node asks for. Campus and hotel wifi are classified Public by default, so
 * the laptop works perfectly on localhost while the phone gets nothing —
 * which reads exactly like an app bug and is not one.
 */
let netCache = { at: 0, val: null };
function networkProfile() {
  // Same shape on every platform. A partial object here is how the self-test
  // came back as a 500 instead of a checklist.
  if (!isWin) return { supported: false, name: '', category: '', iface: '', publicRisk: false };
  if (Date.now() - netCache.at < 8000 && netCache.val) return netCache.val;
  let val = { supported: true, name: '', category: '', publicRisk: false };
  try {
    const out = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command '
      + '"Get-NetConnectionProfile | Where-Object {$_.IPv4Connectivity -ne \'NoTraffic\'} '
      + '| Select-Object -First 1 -Property Name,NetworkCategory,InterfaceAlias '
      + '| ForEach-Object { $_.Name + \'|\' + $_.NetworkCategory + \'|\' + $_.InterfaceAlias }"',
      { encoding: 'utf8', timeout: 9000, windowsHide: true });
    const [name, category, iface] = out.trim().split('|');
    val = {
      supported: true,
      name: name || '',
      category: category || '',
      iface: iface || '',
      publicRisk: /public/i.test(category || ''),
    };
  } catch { val.error = 'could not read'; }
  netCache = { at: Date.now(), val };
  return val;
}

const FW_RULES = ['Witness sync server (8787)', 'Witness Metro (8081-8090)'];

/**
 * Do our inbound rules exist, AND do they cover the network we are on?
 *
 * Existing is not enough. allow-firewall.bat creates them for private and
 * domain profiles only — a deliberate choice, and the right one on a home
 * network. On campus wifi, which Windows classifies Public, those rules are
 * inert: they are listed, they look correct, and they let nothing through.
 * Checking only for the rule NAMES reported a green tick over a phone that
 * could not connect, which is worse than no check at all.
 */
let fwCache = { at: 0, val: null };
function firewallRules() {
  if (!isWin) return { supported: false, present: true, covers: true, names: [], profiles: {} };
  if (Date.now() - fwCache.at < 8000 && fwCache.val) return fwCache.val;

  const names = [], profiles = {};
  for (const name of FW_RULES) {
    try {
      const out = execSync(`netsh advfirewall firewall show rule name="${name}"`,
        { encoding: 'utf8', timeout: 6000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      if (!/Rule Name:/i.test(out)) continue;
      names.push(name);
      const m = /^Profiles:\s*(.+)$/mi.exec(out);
      profiles[name] = (m ? m[1] : '').trim();
    } catch { /* no such rule */ }
  }

  const cat = networkProfile().category || '';
  // "Any" covers everything; otherwise the current category must be listed.
  const coversHere = names.length === FW_RULES.length && names.every(n => {
    const p = (profiles[n] || '').toLowerCase();
    return p.includes('any') || (cat && p.includes(cat.toLowerCase()));
  });

  const val = {
    supported: true,
    present: names.length === FW_RULES.length,
    covers: coversHere,
    names, profiles,
    category: cat,
  };
  fwCache = { at: Date.now(), val };
  return val;
}

const ENV_PATH = join(APP, '.env');

/**
 * Expo access token, for building without an interactive login.
 *
 * Kept in its OWN file, deliberately NOT in app/.env. Anything named
 * EXPO_PUBLIC_* is inlined into the app bundle at build time — putting a
 * credential there would ship it inside the APK to every phone on site.
 */
const TOKEN_PATH = join(here, '.expo-token');

function readToken() {
  try { return readFileSync(TOKEN_PATH, 'utf8').trim(); } catch { return ''; }
}
function writeToken(t) { writeFileSync(TOKEN_PATH, String(t || '').trim()); }

/** Env for any eas-cli invocation. */
/**
 * Windows caps a path at 260 characters. This project starts life in a session
 * scratch folder about 243 characters deep, which leaves no room for anything
 * inside it — git fails with "Filename too long", and node_modules paths are
 * far worse. Moving the project shallow is the only real fix.
 */
const SHORT_HOME = join(homedir(), 'witness');

function pathRisk() {
  const len = ROOT.length;
  return {
    root: ROOT,
    length: len,
    // A realistic deep dependency path is ~150 chars on its own.
    tooDeep: len + 150 > 260,
    suggestion: SHORT_HOME,
    alreadyShort: len <= 80,
  };
}

/** Is ROOT inside a git repository? EAS uploads via git and refuses without one. */
/** What address will a cloud build bake in? */
/** Is every preset babel.config.js references actually declared? */
function babelPresetDeclared() {
  try {
    const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    return Boolean(all['babel-preset-expo']);
  } catch { return false; }
}

function easServerUrl() {
  try {
    const eas = JSON.parse(readFileSync(join(APP, 'eas.json'), 'utf8'));
    return eas.build?.preview?.env?.EXPO_PUBLIC_SERVER_URL || '';
  } catch { return ''; }
}

function hasGitRepo() {
  return existsSync(join(ROOT, '.git'));
}

/** Has `eas init` ever run for this app? */
function easProjectId() {
  try {
    const cfg = JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8'));
    return cfg?.expo?.extra?.eas?.projectId || '';
  } catch { return ''; }
}

function easEnv() {
  const t = readToken();
  return t ? { EXPO_TOKEN: t } : {};
}

function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const o = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2];
  }
  return o;
}

/**
 * EAS builds from the git repo, and .env is deliberately not committed — so a
 * cloud build would never see it and the APK would fall back to localhost,
 * which on a phone means the phone. The address must also live in eas.json,
 * which IS committed. A LAN address is not a secret; an API key is, and stays
 * out of here.
 */
function syncEasEnv(serverUrl) {
  const easPath = join(APP, 'eas.json');
  if (!existsSync(easPath) || !serverUrl) return;
  try {
    const eas = JSON.parse(readFileSync(easPath, 'utf8'));
    for (const profile of ['preview', 'development']) {
      if (!eas.build?.[profile]) continue;
      eas.build[profile].env = {
        ...(eas.build[profile].env || {}),
        EXPO_PUBLIC_SERVER_URL: serverUrl,
      };
    }
    writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n');
  } catch { /* eas.json is optional */ }
}

function writeEnv(patch) {
  const cur = { ...readEnv(), ...patch };
  syncEasEnv(cur.EXPO_PUBLIC_SERVER_URL);
  writeFileSync(ENV_PATH, `# Written by the Witness Control Panel.
# Restart the app after changing this — values are baked in at bundle time.

EXPO_PUBLIC_SERVER_URL=${cur.EXPO_PUBLIC_SERVER_URL ?? ''}

# Which approved record the app rules against.
#   seed      the synthetic supply-chain record
#   ingested  what tools/ingest.mjs read out of the submittal PDFs
EXPO_PUBLIC_RECORD=${cur.EXPO_PUBLIC_RECORD || 'seed'}

# Vision (nameplate reading) + phrasing. No verdict depends on either.
EXPO_PUBLIC_LLM_URL=${cur.EXPO_PUBLIC_LLM_URL ?? ''}
EXPO_PUBLIC_LLM_KEY=${cur.EXPO_PUBLIC_LLM_KEY ?? ''}
EXPO_PUBLIC_LLM_MODEL=${cur.EXPO_PUBLIC_LLM_MODEL || 'claude-sonnet-5'}
EXPO_PUBLIC_VLM_MODEL=${cur.EXPO_PUBLIC_VLM_MODEL || 'claude-sonnet-5'}
`);
  return cur;
}

/**
 * Does the address the phone was given still belong to this machine?
 *
 * A laptop's LAN IP changes with the network. The app bakes the address in at
 * start, so moving from one wifi to another leaves the phone dialling a dead
 * address — and the symptom ("can't reach the server") looks identical to a
 * firewall block. This tells the two apart without guessing.
 */
function addressIsCurrent() {
  const url = readEnv().EXPO_PUBLIC_SERVER_URL || '';
  const m = /^https?:\/\/([0-9.]+):/.exec(url);
  if (!m) return { known: false, configured: url, current: [] };
  const configured = m[1];
  const current = lanIps().map(i => i.ip);
  return {
    known: true,
    configured,
    current,
    matches: current.includes(configured),
  };
}

async function probe(url, ms = 1200) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return (await fetch(url, { signal: ctl.signal })).ok; }
  catch { return false; } finally { clearTimeout(t); }
}

async function getJson(url, ms = 1200) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/** Newest mtime across the sync server's own source files, on disk right now. */
function serverSrcStamp() {
  let newest = 0;
  for (const f of ['index.mjs', 'reorder.mjs', 'ingest.mjs', 'forecast.mjs', 'ensemble.mjs', 'rfi.mjs', 'model.mjs']) {
    try { newest = Math.max(newest, statSync(join(ROOT, 'server', f)).mtimeMs); } catch { /* ignore */ }
  }
  return Math.round(newest);
}

/**
 * Is the sync server that is ANSWERING older than the code on disk?
 *
 * This cost an afternoon. The panel treated "something is serving on 8787" as
 * success and reused it, so after editing a route the dashboard called an
 * endpoint that existed in the file and not in the running process. The symptom
 * was a 404 from a route you could read the source of — which sends you looking
 * for a bug in code that was already correct.
 *
 * Three states worth telling apart: nothing running, running the current code,
 * running something older.
 */
async function syncServerState() {
  const h = await getJson('http://localhost:8787/health');
  if (!h) return { up: false, stale: false };
  const disk = serverSrcStamp();
  return {
    up: true,
    // A server with no stamp at all predates this check, so it is by definition old.
    stale: typeof h.srcStamp !== 'number' || h.srcStamp < disk,
    running: h.srcStamp ?? null,
    onDisk: disk,
    startedAt: h.startedAt ?? null,
  };
}

/**
 * Kill whatever is listening on a port.
 *
 * Closing the panel's console window does not always deliver SIGINT on Windows,
 * so a Metro process can survive and hold 8081. The next start then asks
 * "Use port 8082 instead?" — a prompt non-interactive mode cannot answer, so it
 * just dies. Freeing the port is the fix; changing the port only moves it.
 */
function portPids(port) {
  return new Promise(done => {
    const cmd = isWin
      ? `netstat -ano | findstr :${port} | findstr LISTENING`
      : `lsof -ti tcp:${port} -sTCP:LISTEN`;
    let out = '';
    const c = spawn(cmd, { shell: true, windowsHide: true });
    c.stdout.on('data', d => out += d);
    c.on('error', () => done([]));
    c.on('close', () => {
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        // netstat: last column is the PID. lsof -t: the whole line is the PID.
        const pid = isWin ? t.split(/\s+/).pop() : t;
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      done([...pids]);
    });
    setTimeout(() => { try { c.kill(); } catch {} done([]); }, 5000);
  });
}

/**
 * Is anything listening on this port?
 *
 * Tested by CONNECTING, not by binding. Binding to 0.0.0.0 can succeed on
 * Windows even when another process holds 127.0.0.1 on the same port — so a
 * bind test reported 8081 as free while Metro immediately found it busy, and we
 * kept handing Expo a port it could not have. A refused connection is the only
 * honest answer.
 */
function portInUse(host, port, ms = 400) {
  return new Promise(done => {
    const sock = netConnect({ host, port });
    const finish = v => { sock.destroy(); done(v); };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    setTimeout(() => finish(false), ms);
  });
}

/** Free means: nothing answers on loopback, and we can still bind it. */
async function portFree(port) {
  if (await portInUse('127.0.0.1', port)) return false;
  const bindable = await new Promise(done => {
    const srv = createNetServer();
    srv.once('error', () => done(false));
    srv.once('listening', () => srv.close(() => done(true)));
    srv.listen(port, '0.0.0.0');
  });
  return bindable;
}

/**
 * Find a port Metro can have.
 *
 * Fighting for 8081 is not worth it. Something can hold it that we cannot
 * identify or kill — another dev server, an adb reverse, a zombie with no
 * netstat entry. The panel reads the exp:// URL out of Expo's own output and
 * builds the QR from that, so ANY port works and the user never sees the
 * "use 8082 instead?" prompt that non-interactive mode cannot answer.
 */
async function pickMetroPort(start = 8081, tries = 25) {
  for (let p = start; p < start + tries; p++) {
    if (await portFree(p)) return p;
  }
  return start;
}

async function freePort(port) {
  const pids = await portPids(port);
  for (const pid of pids) {
    try {
      if (isWin) spawn('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true });
      else process.kill(Number(pid), 'SIGKILL');
    } catch { /* already gone */ }
  }
  return pids;
}

/** Does this command exist and run? Used by the self-test. */
function which(cmd, args = ['--version']) {
  return new Promise(done => {
    let out = '';
    const c = spawn(q(cmd), args.map(q), { shell: true, windowsHide: true });
    c.stdout.on('data', d => out += d);
    c.stderr.on('data', d => out += d);
    c.on('error', () => done({ ok: false, version: null }));
    c.on('close', code => done({
      ok: code === 0,
      version: (out.split(/\r?\n/).find(l => l.trim()) || '').trim().slice(0, 60),
    }));
    setTimeout(() => { try { c.kill(); } catch {} done({ ok: false, version: 'timed out' }); }, 8000);
  });
}

/**
 * Start Metro, pinned to a known address.
 *
 * Left alone, Expo picks the address it will advertise in the exp:// URL by its
 * own adapter scan — which can differ from the address we wrote into .env. The
 * result is an app that loads its bundle from one address and then tries to
 * sync with another, and only one of them is reachable. Whichever address the
 * panel decided on, REACT_NATIVE_PACKAGER_HOSTNAME makes Expo agree with it.
 */
async function startMetro({ tunnel = false, host = '' } = {}) {
  const port = await pickMetroPort();
  const ip = host || (readEnv().EXPO_PUBLIC_SERVER_URL || '').replace(/^https?:\/\/([^:/]+).*$/, '$1') || bestIp();

  const env = { ...easEnv() };
  // Offline mode skips the account check that otherwise blocks a tokenless
  // start on a project with an `owner`. Harmless when a token IS present.
  if (!readToken()) env.EXPO_OFFLINE = '1';
  if (!tunnel && ip) env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;

  const args = ['expo', 'start', '--port', String(port)];
  if (tunnel) args.push('--tunnel'); else args.push('--host', 'lan');

  const r = launch('expo', 'npx', args, { cwd: APP, env });

  /**
   * Do not wait for Expo to tell us the URL — compute it.
   *
   * The panel is not a terminal, so Expo runs non-interactively and never
   * prints the QR block or the `exp://…` line; it only says "Waiting on
   * http://localhost:8081". The old code scraped for `exp://`, so on this
   * machine the QR simply never appeared, and whether it showed up at all
   * depended on which Expo version happened to print what. We already decided
   * the host and the port, so the URL is ours to state. sniff() still
   * overwrites this if a real one turns up — which is what tunnel mode needs,
   * because only ngrok knows that address.
   */
  if (!tunnel && ip) entry('expo').meta.expUrl = `exp://${ip}:${port}`;

  say('expo', `— port ${port}${port === 8081 ? '' : ' (8081 was busy)'}${
    tunnel ? ', tunnel mode' : ip ? `, advertising ${ip}` : ''} —`, 'cmd');
  if (!tunnel && !ip) say('expo', '— no LAN address found; Expo will guess. Check wifi. —', 'err');
  if (!readToken()) say('expo', '— no Expo token saved, starting offline (fine for Expo Go) —', 'cmd');
  return { ...r, port, host: ip };
}

/**
 * One press: from "nothing running" to "scan this code".
 *
 * Every step here is one the operator used to have to do in the right order,
 * and getting the order wrong produced a different symptom each time. Freeing
 * the ports first matters most — a Metro left over from the last run keeps a
 * port and answers on it, so the phone connects to a stale bundle and the
 * failure looks intermittent rather than structural.
 */
async function startEverything(pref = {}) {
  const steps = [];
  const note = (label, detail, ok = true) => steps.push({ label, detail, ok });

  // 1. Stale processes from the last run.
  stop('expo');
  const freed = [];
  for (const p of [8081, 8082, 8083, 8084, 19000, 19001]) {
    const pids = await freePort(p);
    if (pids.length) freed.push(`${p}`);
  }
  note('Cleared old dev servers', freed.length ? `freed port ${freed.join(', ')}` : 'nothing stale');

  // 2. Sync server. Adopted only if it is running the code that is on disk —
  //    an older process is worse than none, because it answers.
  //
  //    Deliberately BEFORE the network check. The dashboard talks to this over
  //    localhost, so a laptop that is momentarily off the wifi should still get
  //    a working supervisor view rather than nothing at all.
  const sync = await syncServerState();
  if (sync.up && !sync.stale) {
    note('Sync server', 'already running on 8787, and current');
  } else {
    if (sync.up) say('server', '— the server on 8787 is older than the code on disk; restarting it —', 'cmd');
    stop('server');
    await freePort(8787);
    await new Promise(r => setTimeout(r, 300));
    launch('server', process.execPath, [join(ROOT, 'server', 'index.mjs')]);
    let now = { up: false };
    for (let i = 0; i < 25 && !now.up; i++) {
      await new Promise(r => setTimeout(r, 400));
      now = await syncServerState();
    }
    note('Sync server', now.up
      ? (sync.up ? 'restarted on 8787 — it was running older code' : 'up on 8787')
      : 'did not answer — see its log', now.up);
  }

  // 3. The address. Trust the routing table over anything remembered.
  const ip = pref.ip || bestIp();
  if (!ip) {
    note('Find this PC on the network', 'no network adapter has an address — check wifi', false);
    return {
      ok: false,
      error: 'This PC is not on a network, so the phone has nothing to connect to. '
           + 'The sync server and dashboard are running on this laptop — join the wifi and press Start again for the phone.',
      steps,
    };
  }
  const serverUrl = `http://${ip}:8787`;
  const before = readEnv().EXPO_PUBLIC_SERVER_URL || '';
  writeEnv({ EXPO_PUBLIC_SERVER_URL: serverUrl });
  note('Address written into the app', before && before !== serverUrl
    ? `${ip} — changed from ${before.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}`
    : ip);

  // 4. Metro, pinned to the same address.
  const m = await startMetro({ tunnel: Boolean(pref.tunnel), host: ip });
  if (m.ok === false) {
    note('Start the app', m.error || 'failed', false);
    return { ok: false, error: m.error, steps };
  }
  note('Starting the app', pref.tunnel ? 'tunnel mode — slower, but works on any network' : `Metro on port ${m.port}`);

  // 5. Warn about the thing that will actually stop the phone.
  const np = networkProfile();
  fwCache = { at: 0, val: null };          // re-read: the operator may have just fixed it
  const fw = firewallRules();
  const blocked = !fw.covers && !pref.tunnel;

  return {
    ok: true, steps, ip, serverUrl,
    healthUrl: `${serverUrl}/health`,
    network: np, firewall: fw, blocked,
  };
}

// ──────────────────────────────────────────────────────────────────── routes
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};

const readBody = req => new Promise(ok => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } });
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};

/** Files the panel is allowed to serve, by short name. */
const SERVE = {
  dashboard: join(ROOT, 'dashboard', 'index.html'),
  ingestreport: join(ROOT, 'docs', 'INGEST_REPORT.md'),
  rfidrafts: join(ROOT, 'docs', 'RFI_DRAFTS.md'),
  submittalA: join(ROOT, 'docs', 'submittals', 'submittal-register-A.pdf'),
  submittalB: join(ROOT, 'docs', 'submittals', 'submittal-register-B.pdf'),
  tags: join(ROOT, 'witness_qr_tags.pdf'),
  readme: join(ROOT, 'README.md'),
  apk: join(ROOT, 'witness.apk'),
  setup: join(ROOT, 'SETUP.md'),
  publishing: join(ROOT, 'PUBLISHING.md'),
  manual: join(ROOT, 'MANUAL.md'),
  buildguide: join(ROOT, 'BUILD_APK.md'),
};

const ACTIONS = {
  // Straight to node. No npm shim, no --prefix, no script indirection.
  test: () => launch('test', process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--disable-warning=ExperimentalWarning',
    '--experimental-sqlite', '--experimental-strip-types', '--test',
    join('src', 'engine', 'resolve.test.ts'),
    join('src', 'data', 'sync.test.ts'),
    // The delivery-level inference makes a claim that costs money if wrong,
    // so it is on the safety-critical side of the suite, not an extra.
    join('..', 'server', 'reorder.test.mjs'),
    // And the gate that decides what "approved" even means.
    join('..', 'server', 'ingest.test.mjs'),
    // The projection and the ensemble reconciliation.
    join('..', 'server', 'forecast.test.mjs'),
  ], { cwd: APP }),
  install: () => launch('install', 'npm', ['install'], { cwd: APP }),
  // babel.config.js needs babel-preset-expo declared explicitly. It resolves
  // locally by hoisting, but a clean CI install puts it somewhere Babel cannot
  // see - the build fails with "Cannot find module 'babel-preset-expo'".
  // `expo install` picks the version matching the installed SDK.
  fixBabel: () => launch('install', '', [], {
    cwd: APP,
    env: easEnv(),
    raw: 'npx --yes expo install babel-preset-expo && npm install',
  }),
  doctor: () => launch('doctor', 'npx', ['expo', 'install', '--fix'], { cwd: APP, env: easEnv() }),
  // Adopt a running server only if it is the code on disk. See syncServerState.
  server: async () => {
    const s = await syncServerState();
    if (s.up && !s.stale) {
      say('server', '— a current sync server is already running on 8787; using it —', 'cmd');
      entry('server').status = 'done';
      return { ok: true, alreadyRunning: true };
    }
    if (s.up) {
      say('server', '— the server on 8787 is older than server/*.mjs; replacing it —', 'cmd');
      stop('server');
      await freePort(8787);
      await new Promise(r => setTimeout(r, 300));
    }
    return launch('server', process.execPath, [join(ROOT, 'server', 'index.mjs')]);
  },
  restartServer: async () => {
    stop('server');
    await freePort(8787);
    await new Promise(r => setTimeout(r, 400));
    return launch('server', process.execPath, [join(ROOT, 'server', 'index.mjs')]);
  },
  // EXPO_TOKEN is needed here too, not just for builds. Once `eas init` writes
  // an `owner` and project id into app.json, `expo start` verifies the session
  // and otherwise stops on a login prompt it cannot show. Without a token we
  // still start — in offline mode, which skips the check entirely — because a
  // missing token is a worse reason to be stuck than a missing account.
  expo: async () => startMetro({}),
  expoTunnel: async () => startMetro({ tunnel: true }),
  // APK builds. Both run on THIS machine - the cloud one uploads the source to
  // Expo's builders, the local one needs Android Studio + JDK 17 installed.
  easWhoami: () => launch('build', 'npx', ['--yes', 'eas-cli', 'whoami'],
    { cwd: APP, env: easEnv() }),
  // EAS asks to init inside app/. That is the wrong place — the repo root is
  // the whole project, and putting .git inside app/ would leave the server,
  // dashboard and tools outside version control.
  gitInit: () => launch('build', '', [], {
    cwd: ROOT,
    raw: [
      'git init',
      // Helps git itself, but Windows APIs still refuse long paths unless the
      // OS-wide setting is on. Moving the project shallow is the real fix.
      'git config --local core.longpaths true',
      'git config --local user.name "Team Espada"',
      'git config --local user.email "witness@espada.local"',
      'git add -A',
      'git commit -m "Witness - approved-revision verification at the point of install"',
    ].join(' && '),
  }),
  easInit: () => launch('build', '', [], {
    cwd: APP, env: easEnv(),
    raw: 'npx --yes eas-cli init --non-interactive --force',
  }),
  // `--non-interactive` refuses to invent a project, so an unlinked app fails
  // instantly with "Existing project not found". Link first, then build.
  buildCloud: () => !hasGitRepo()
    ? { ok: false, error: 'EAS uploads your source through git, and this folder is not a git repository yet. Press "Set up git" first — it is also the first step for putting this on GitHub.' }
    : launch('build', '', [], {
    cwd: APP, env: easEnv(),
    raw: (easProjectId() ? '' : 'npx --yes eas-cli init --non-interactive --force && ')
       + 'npx --yes eas-cli build --platform android --profile preview --non-interactive',
  }),

  buildLocal: () => launch('build', 'npx', ['--yes', 'eas-cli', 'build',
    '--platform', 'android', '--profile', 'preview', '--local', '--non-interactive',
    '--output', join(ROOT, 'witness.apk')], { cwd: APP, env: easEnv() }),
  seed: () => launch('seed', PY, [join(ROOT, 'tools', 'make_seed.py')]),
  tags: () => launch('tags', PY, [join(ROOT, 'tools', 'make_qr_sheet.py')]),
  // Reads the submittal PDFs into an approved record. Node core only, so it
  // runs whether or not Python or poppler are installed.
  ingest: () => launch('ingest', process.execPath, [join(ROOT, 'tools', 'ingest.mjs')], { cwd: ROOT }),
  modelTest: () => launch('model', process.execPath, [join(ROOT, 'tools', 'modeltest.mjs')], { cwd: ROOT }),
  makeSubmittals: () => launch('ingest', PY, [join(ROOT, 'tools', 'make_submittals.py')]),
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(readFileSync(join(here, 'panel.html'), 'utf8'));
    }

    // Serve viewable files over http so the browser can just open a tab.
    if (url.pathname.startsWith('/view/')) {
      const key = url.pathname.slice(6);
      const file = SERVE[key];
      if (!file) return json(res, 404, { error: 'unknown file' });
      if (!existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<body style="font:16px system-ui;background:#0B0D10;color:#F2F5F8;padding:40px">
          <h2>Not built yet</h2><p><code>${key}</code> does not exist at:</p>
          <pre style="color:#8B95A1">${file}</pre>
          <p>For the tag sheet, use <b>Rebuild tag sheet</b> on the control panel.</p></body>`);
      }
      const body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    if (url.pathname === '/api/state') {
      const env = readEnv();
      const sync = await syncServerState();
      const serverUp = sync.up;
      const holders = await portPids(8081);
      const p8081Busy = await portInUse('127.0.0.1', 8081);
      const metroBusy = (holders.length > 0 || await portInUse('127.0.0.1', 8081))
        && !entry('expo').child;
      return json(res, 200, {
        root: ROOT,
        metroBusy,
        port8081Holders: holders,
        port8081Busy: p8081Busy,
        node: process.versions.node,
        nodeOk: Number(process.versions.node.split('.')[0]) >= 22,
        installed: existsSync(join(APP, 'node_modules')),
        env: { ...env, EXPO_PUBLIC_LLM_KEY: env.EXPO_PUBLIC_LLM_KEY ? '••••••••' : '' },
        ips: lanIps(),
        bestIp: bestIp(),
        network: networkProfile(),
        firewall: firewallRules(),
        serverUp,
        sync,
        address: addressIsCurrent(),
        files: Object.fromEntries(Object.entries(SERVE).map(([k, v]) => [k, existsSync(v)])),
        // Only while it is actually serving. A QR for a Metro that has exited
        // sends the phone to a dead port and reads as a phone problem.
        expUrl: entry('expo').child ? (entry('expo').meta.expUrl || null) : null,
        procs: Object.fromEntries([...procs].map(([k, v]) => [k, {
          status: v.status, running: Boolean(v.child), meta: v.meta,
        }])),
      });
    }

    if (url.pathname === '/api/log') {
      const name = url.searchParams.get('name') || '';
      const since = Number(url.searchParams.get('since') || 0);
      const e = entry(name);
      // Cursor is a sequence number, not a clock. With a timestamp cursor any
      // line written in the same millisecond as the poll was filtered out and
      // lost forever.
      const lines = e.log.filter(l => l.seq > since);
      return json(res, 200, {
        status: e.status, running: Boolean(e.child), meta: e.meta,
        lines, now: lines.length ? lines[lines.length - 1].seq : since,
      });
    }

    if (url.pathname === '/api/qr') {
      const text = url.searchParams.get('text') || '';
      if (!text) return json(res, 400, { error: 'no text' });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(toSvg(text, 300));
    }

    /** Real checks against this machine, not assumptions. */
    if (url.pathname === '/api/buildcheck') {
      const [java, eas] = await Promise.all([
        which('java', ['-version']),
        which('npx', ['--no-install', 'eas-cli', '--version']),
      ]);
      const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
      const git = await which('git', ['--version']);
      // "openjdk version \"17.0.9\"" / "java version \"1.8.0_401\"".
      // Java 8 and earlier report as 1.8 — reading the first number alone gave
      // "found Java 1", which is true of nothing and helps nobody.
      const jv = /version \"?(\d+)(?:\.(\d+))?/.exec(java.version || '');
      const javaMajor = jv ? (jv[1] === '1' ? Number(jv[2] || 0) : Number(jv[1])) : 0;
      const apk = join(ROOT, 'witness.apk');
      return json(res, 200, {
        tokenSet: Boolean(readToken()),
        projectId: easProjectId(),
        gitRepo: hasGitRepo(),
        path: pathRisk(),
        apkExists: existsSync(apk),
        apkPath: apk,
        apkSize: existsSync(apk) ? Math.round(statSync(apk).size / 1048576) : 0,
        checks: [
          { name: 'babel-preset-expo declared', ok: babelPresetDeclared(),
            detail: babelPresetDeclared()
              ? 'in package.json'
              : 'MISSING — babel.config.js needs it. Press "Fix Babel preset".' },
          { name: 'Build will know the server address', ok: Boolean(easServerUrl()),
            detail: easServerUrl() || 'press Save settings — .env is not committed, so the address must be in eas.json' },
          { name: 'Path short enough for Windows', ok: !pathRisk().tooDeep,
            detail: pathRisk().tooDeep
              ? `${ROOT.length} chars — over the 260 limit once files are added. Move the project.`
              : `${ROOT.length} chars` },
          { name: 'git installed', ok: git.ok, detail: git.version || 'not found — install from git-scm.com' },
          { name: 'Repository initialised', ok: hasGitRepo(),
            detail: hasGitRepo() ? ROOT : 'press "Set up git" — EAS uploads source through git' },
          { name: 'Project linked to your Expo account', ok: Boolean(easProjectId()),
            detail: easProjectId() || 'not yet — the build links it automatically on first run' },
          { name: 'eas-cli', ok: true, detail: eas.ok ? eas.version : 'not installed yet — npx fetches it automatically on first build' },
          { name: 'Java 17+ — local builds only', ok: javaMajor >= 17,
            detail: javaMajor ? `found Java ${javaMajor}${javaMajor < 17 ? ' — too old for a local build; use the cloud build' : ''}`
                              : 'not installed — use the cloud build' },
          { name: 'Android SDK — local builds only', ok: Boolean(sdk), detail: sdk || 'ANDROID_HOME not set — use the cloud build' },
        ],
      });
    }

    if (url.pathname === '/api/selftest') {
      const [node, npm, npx, py] = await Promise.all([
        which('node', ['-v']), which('npm', ['-v']), which('npx', ['-v']), which(PY, ['--version']),
      ]);
      const sync = await syncServerState();
      const serverUp = sync.up;
      const nodeMajor = Number(process.versions.node.split('.')[0]);
      let qrOk = false, qrErr = '';
      try { qrOk = toSvg('exp://127.0.0.1:8081').includes('<rect'); }
      catch (e) { qrErr = String(e.message); }

      return json(res, 200, { checks: [
        { name: 'Node runs the panel', ok: true, detail: `v${process.versions.node}` },
        { name: 'Node is 22 or newer', ok: nodeMajor >= 22, detail: nodeMajor >= 22 ? 'ok' : `v${nodeMajor} — the tests and app need 22+` },
        { name: 'node on PATH', ok: node.ok, detail: node.version || 'not found' },
        { name: 'npm on PATH', ok: npm.ok, detail: npm.version || 'not found — reinstall Node' },
        { name: 'npx on PATH', ok: npx.ok, detail: npx.version || 'not found — needed to start the app' },
        { name: 'Dependencies installed', ok: existsSync(join(APP, 'node_modules')), detail: existsSync(join(APP, 'node_modules')) ? 'app/node_modules present' : 'press Install dependencies' },
        { name: 'App entry files', ok: ['App.tsx', 'index.ts', 'app.json', 'babel.config.js', 'package.json'].every(f => existsSync(join(APP, f))), detail: 'App.tsx, index.ts, app.json, babel.config.js' },
        { name: 'Engine + seed data', ok: existsSync(join(APP, 'src', 'engine', 'resolve.ts')) && existsSync(join(APP, 'src', 'data', 'witness_seed.json')), detail: 'resolve.ts, witness_seed.json' },
        { name: 'Dashboard file', ok: existsSync(SERVE.dashboard), detail: SERVE.dashboard },
        { name: 'Tag sheet PDF', ok: existsSync(SERVE.tags), detail: existsSync(SERVE.tags) ? `${Math.round(statSync(SERVE.tags).size / 1024)} KB` : 'press Rebuild tag sheet' },
        { name: 'QR generator', ok: qrOk, detail: qrOk ? 'renders' : qrErr },
        { name: 'Python (only for rebuilding data/tags)', ok: py.ok, detail: py.version || 'not found — optional' },
        { name: 'Phone address still valid', ok: !addressIsCurrent().known || addressIsCurrent().matches,
          detail: !addressIsCurrent().known
            ? 'no address saved yet — press Save settings'
            : addressIsCurrent().matches
              ? `${addressIsCurrent().configured} is one of this PC's addresses`
              : `the app points at ${addressIsCurrent().configured}, but this PC is now ${addressIsCurrent().current.join(', ') || '(no network)'} — press Save settings and restart the app` },
        { name: 'Sync server reachable', ok: serverUp, detail: serverUp ? 'localhost:8787' : 'not running — press Start sync server' },
        // A server answering with old code is the failure that looks like a bug
        // in code you can read and see is correct.
        { name: 'Sync server is running the current code', ok: !serverUp || !sync.stale,
          detail: !serverUp ? 'not running'
            : sync.stale
              ? `it was started before server/*.mjs was last edited — press "Restart sync server". Routes added since it started will return 404.`
              : `started ${sync.startedAt ? new Date(sync.startedAt).toLocaleTimeString() : ''}, matches the files on disk` },
        { name: 'Network address found', ok: lanIps().length > 0, detail: lanIps().map(i => `${i.ip} (${i.iface})${i.routed ? ' ← routed' : ''}`).join(', ') || 'none — check wifi' },
        // The two checks that explain almost every "the phone just won't
        // connect". Both pass silently on a home network, which is why they
        // were never noticed until the demo moved onto campus wifi.
        { name: 'Network type', ok: true,
          detail: networkProfile().category
            ? `"${networkProfile().name}" is ${networkProfile().category}`
            : 'not applicable' },
        { name: 'Firewall lets your phone in', ok: firewallRules().covers,
          detail: !firewallRules().supported
            ? 'not applicable on this platform'
            : !firewallRules().present
              ? 'no Witness rules found — press "Let my phone in" (asks for administrator once)'
              : firewallRules().covers
                ? Object.entries(firewallRules().profiles).map(([n, p]) => `${n} → ${p}`).join(' | ')
                : `the rules exist but only for ${Object.values(firewallRules().profiles).join(' / ')} — this network is ${firewallRules().category}, so they do nothing. Press "Let my phone in".` },
        { name: '.env written', ok: existsSync(ENV_PATH), detail: existsSync(ENV_PATH) ? (readEnv().EXPO_PUBLIC_SERVER_URL || '(no server url)') : 'press Save settings' },
      ] });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { action } = await readBody(req);
      const fn = ACTIONS[action];
      if (!fn) return json(res, 400, { ok: false, error: `unknown action ${action}` });
      return json(res, 200, await fn());
    }

    if (req.method === 'POST' && url.pathname === '/api/start-all') {
      return json(res, 200, await startEverything(await readBody(req)));
    }

    /**
     * Open the two ports to the local subnet — and only the local subnet.
     *
     * Needs administrator rights, so it re-launches itself elevated and Windows
     * shows the UAC prompt. Scoped with remoteip=localsubnet on purpose: this
     * is a campus network, and "let my phone in" should not mean "let the
     * building in". Deliberately does NOT reclassify the network as Private —
     * that would also turn on discovery and sharing for every machine here.
     */
    if (req.method === 'POST' && url.pathname === '/api/fix-firewall') {
      if (!isWin) return json(res, 200, { ok: false, error: 'Windows only' });
      const rules = [
        'netsh advfirewall firewall delete rule name=\\"Witness sync server (8787)\\"',
        'netsh advfirewall firewall delete rule name=\\"Witness Metro (8081-8090)\\"',
        'netsh advfirewall firewall add rule name=\\"Witness sync server (8787)\\" dir=in action=allow protocol=TCP localport=8787 remoteip=localsubnet profile=any',
        'netsh advfirewall firewall add rule name=\\"Witness Metro (8081-8090)\\" dir=in action=allow protocol=TCP localport=8081-8090 remoteip=localsubnet profile=any',
      ].join('; ');
      try {
        const child = spawn(
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '/c ${rules.replace(/\\"/g, '\\"')}'"`,
          { shell: true, windowsHide: true });
        const code = await new Promise(done => {
          child.on('close', done);
          child.on('error', () => done(-1));
          setTimeout(() => done(-2), 60000);
        });
        fwCache = { at: 0, val: null };
        const fw = firewallRules();
        return json(res, 200, {
          ok: fw.covers,
          elevated: code === 0,
          firewall: fw,
          error: fw.covers ? '' : 'The rules were not added — the administrator prompt was probably declined. You can also right-click tools\\allow-firewall.bat and choose "Run as administrator".',
        });
      } catch (e) {
        return json(res, 200, { ok: false, error: String(e?.message ?? e) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/free-ports') {
      const freed = {};
      for (const port of [8081, 8082, 8787]) freed[port] = await freePort(port);
      return json(res, 200, { ok: true, freed });
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const { name } = await readBody(req);
      return json(res, 200, stop(name));
    }

    /** Copy the project somewhere Windows can actually work with. */
    if (req.method === 'POST' && url.pathname === '/api/relocate') {
      try {
        if (existsSync(SHORT_HOME)) {
          return json(res, 200, { ok: false, error: `${SHORT_HOME} already exists. Delete or rename it first, so nothing is overwritten by accident.` });
        }
        mkdirSync(SHORT_HOME, { recursive: true });
        // node_modules, .git and .expo are all rebuildable, and copying them
        // across the long path is what fails in the first place.
        const skip = new Set(['node_modules', '.git', '.expo', 'android', 'ios']);
        cpSync(ROOT, SHORT_HOME, {
          recursive: true,
          filter: (src) => !src.split(/[\\/]/).some(seg => skip.has(seg)),
        });
        return json(res, 200, { ok: true, path: SHORT_HOME });
      } catch (e) {
        return json(res, 200, { ok: false, error: String(e?.message ?? e) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/expo-token') {
      const { token } = await readBody(req);
      writeToken(token);
      return json(res, 200, { ok: true, set: Boolean(readToken()) });
    }

    /** Which model paths are live right now. Read on every poll. */
    if (url.pathname === '/api/modelstate') {
      const e = readEnv();
      const configured = Boolean(e.EXPO_PUBLIC_LLM_URL && e.EXPO_PUBLIC_LLM_KEY);
      return json(res, 200, {
        configured,
        url: e.EXPO_PUBLIC_LLM_URL || '',
        model: e.EXPO_PUBLIC_VLM_MODEL || e.EXPO_PUBLIC_LLM_MODEL || '',
        paths: {
          nameplate: configured, ingestion: configured, phrasing: configured,
        },
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/env') {
      const saved = writeEnv(await readBody(req));
      return json(res, 200, { ok: true, env: { ...saved, EXPO_PUBLIC_LLM_KEY: saved.EXPO_PUBLIC_LLM_KEY ? '••••••••' : '' } });
    }

    if (req.method === 'POST' && url.pathname === '/api/reset-demo') {
      if (!(await probe('http://localhost:8787/health'))) {
        return json(res, 200, { ok: false, error: 'Sync server is not running — press Start sync server first' });
      }
      try {
        const r = await fetch('http://localhost:8787/reset', { method: 'POST' });
        return json(res, 200, { ok: true, body: await r.json() });
      } catch (e) { return json(res, 200, { ok: false, error: String(e) }); }
    }

    /** Only the file manager needs an OS call; everything viewable is served. */
    if (req.method === 'POST' && url.pathname === '/api/open-tools') {
      try {
        const dir = join(ROOT, 'tools');
        if (isWin) spawn('explorer.exe', [dir], { detached: true });
        else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [dir], { detached: true });
        return json(res, 200, { ok: true, path: dir });
      } catch (e) { return json(res, 200, { ok: false, error: String(e.message) }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/open-folder') {
      try {
        if (isWin) spawn('explorer.exe', [ROOT], { detached: true, windowsHide: false });
        else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [ROOT], { detached: true });
        return json(res, 200, { ok: true, path: ROOT });
      } catch (e) { return json(res, 200, { ok: false, error: String(e.message), path: ROOT }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/quit') {
      json(res, 200, { ok: true });
      for (const name of procs.keys()) stop(name);
      setTimeout(() => process.exit(0), 350);
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(PORT, '127.0.0.1', () => {
  const target = `http://localhost:${PORT}/`;
  console.log(`\n  Witness Control Panel  ->  ${target}`);
  console.log('  Leave this window open. Close it to shut everything down.\n');
  if (!process.env.WITNESS_NO_OPEN) {
    // One browser launch, at startup, where a failure is visible because the
    // URL is printed above.
    // Single command string through the shell: cmd then receives exactly
    // `start "" "<url>"`. Passing an args array here means Node escapes for
    // CreateProcess while cmd re-parses with different rules, which is how the
    // empty-title argument gets mangled.
    if (isWin) spawn(`start "" "${target}"`, { shell: true, windowsHide: true, detached: true });
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true });
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { for (const n of procs.keys()) stop(n); process.exit(0); });
}
