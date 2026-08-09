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
import { spawn } from 'node:child_process';
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
function lanIps() {
  const out = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      const virt = /loopback|wsl|vethernet|virtualbox|vmware|hyper-v|docker|tailscale|zerotier/i.test(iface);
      out.push({ iface, ip: a.address, wifi: /wi-?fi|wlan|wireless/i.test(iface), virt });
    }
  }
  // Real wifi first, virtual adapters last — but never hidden, in case the only
  // usable network is an unusual one.
  return out.sort((a, b) => Number(a.virt) - Number(b.virt) || Number(b.wifi) - Number(a.wifi));
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
  // If one is already serving, launching another just exits — say so instead.
  server: async () => {
    if (await probe('http://localhost:8787/health')) {
      say('server', '— a sync server is already running on 8787; using it —', 'cmd');
      entry('server').status = 'done';
      return { ok: true, alreadyRunning: true };
    }
    return launch('server', process.execPath, [join(ROOT, 'server', 'index.mjs')]);
  },
  // EXPO_TOKEN is needed here too, not just for builds. Once `eas init` writes
  // an `owner` and project id into app.json, `expo start` verifies the session
  // and otherwise stops on a login prompt it cannot show.
  expo: async () => {
    if (!readToken()) {
      return { ok: false, error: 'Expo needs your access token to serve this project (app.json now has an owner). Paste it in the build card — Step 1 — then press Start app again.' };
    }
    const port = await pickMetroPort();
    const r = launch('expo', 'npx', ['expo', 'start', '--port', String(port)],
      { cwd: APP, env: easEnv() });
    say('expo', `— panel chose port ${port} (8081 was ${port === 8081 ? 'free' : 'in use'}) —`, 'cmd');
    return r;
  },
  expoTunnel: async () => {
    const port = await pickMetroPort();
    const r = launch('expo', 'npx', ['expo', 'start', '--tunnel', '--port', String(port)],
      { cwd: APP, env: easEnv() });
    say('expo', `— panel chose port ${port} (tunnel) —`, 'cmd');
    return r;
  },
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
      const serverUp = await probe('http://localhost:8787/health');
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
        serverUp,
        address: addressIsCurrent(),
        files: Object.fromEntries(Object.entries(SERVE).map(([k, v]) => [k, existsSync(v)])),
        expUrl: entry('expo').meta.expUrl || null,
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
      // "openjdk version \"17.0.9\"" / "java version \"11.0.31\""
      const jv = /version \"?(\d+)/.exec(java.version || '');
      const javaMajor = jv ? Number(jv[1]) : 0;
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
      const serverUp = await probe('http://localhost:8787/health');
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
        { name: 'Network address found', ok: lanIps().length > 0, detail: lanIps().map(i => `${i.ip} (${i.iface})`).join(', ') || 'none — check wifi' },
        { name: '.env written', ok: existsSync(ENV_PATH), detail: existsSync(ENV_PATH) ? (readEnv().EXPO_PUBLIC_SERVER_URL || '(no server url)') : 'press Save settings' },
      ] });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { action } = await readBody(req);
      const fn = ACTIONS[action];
      if (!fn) return json(res, 400, { ok: false, error: `unknown action ${action}` });
      return json(res, 200, await fn());
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
