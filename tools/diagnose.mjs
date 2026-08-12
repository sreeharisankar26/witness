/**
 * Witness — one-shot connection diagnostic.
 *
 * Answers the only question that matters when the phone will not connect:
 * WHICH address on this laptop can the phone actually reach, and is anything
 * blocking or already sitting on the ports we need?
 *
 * Writes tools/diagnostic.txt. Node core only.
 */
import { networkInterfaces } from 'node:os';
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect as netConnect } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const out = [];
const p = s => { out.push(String(s)); console.log(String(s)); };

const sh = cmd => {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 20000, windowsHide: true }); }
  catch (e) { return `(failed: ${e.message})`; }
};
const ps = script => sh(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`);

const portOpen = (host, port, ms = 700) => new Promise(done => {
  const s = netConnect({ host, port });
  const fin = v => { s.destroy(); done(v); };
  s.once('connect', () => fin(true));
  s.once('error', () => fin(false));
  setTimeout(() => fin(false), ms);
});

p('WITNESS DIAGNOSTIC  ' + new Date().toISOString());
p('project root: ' + ROOT + '   (' + ROOT.length + ' chars)');
p('node: ' + process.version + '   platform: ' + process.platform);
p('');

p('--- network interfaces (raw) ---');
for (const [iface, addrs] of Object.entries(networkInterfaces())) {
  for (const a of addrs || []) {
    if (a.family !== 'IPv4') continue;
    p(`  ${a.internal ? '[internal] ' : ''}${iface}  ->  ${a.address}/${a.netmask}`);
  }
}
p('');

p('--- network profile (Public blocks inbound by default) ---');
p(ps('Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity | Format-List | Out-String'));

p('--- default route ---');
p(sh('route print -4 0.0.0.0').split(/\r?\n/).filter(l => /^\s+0\.0\.0\.0/.test(l)).join('\n') || '(none)');
p('');

p('--- ports ---');
for (const port of [8081, 8082, 8787, 8790, 19000]) {
  p(`  ${port}: ${(await portOpen('127.0.0.1', port)) ? 'IN USE' : 'free'}`);
}
p('');
p('--- who holds them ---');
p(ps("Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 8081,8082,8787,8790,19000} | ForEach-Object { $pr = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; '{0,-6} {1,-16} pid {2,-8} {3}' -f $_.LocalPort, $_.LocalAddress, $_.OwningProcess, $pr.ProcessName } | Out-String"));

p('--- inbound firewall rules for node.exe ---');
p(ps("Get-NetFirewallRule -Direction Inbound -Enabled True | Where-Object { try { ($_ | Get-NetFirewallApplicationFilter).Program -like '*node.exe*' } catch { $false } } | Select-Object DisplayName,Action,Profile,Enabled | Format-Table -AutoSize | Out-String -Width 200"));

p('--- inbound rules opening 8081/8787 by port ---');
p(ps("Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -in '8081','8787','8790' } | ForEach-Object { $r = $_ | Get-NetFirewallRule; '{0,-8} {1,-40} {2,-8} {3}' -f $_.LocalPort, $r.DisplayName, $r.Action, $r.Profile } | Out-String -Width 200"));

p('--- firewall profile state ---');
p(sh('netsh advfirewall show allprofiles state'));

p('--- app/.env ---');
const envPath = join(ROOT, 'app', '.env');
p(existsSync(envPath)
  ? readFileSync(envPath, 'utf8').split(/\r?\n/).map(l => '  ' + (l.startsWith('EXPO_PUBLIC_LLM_KEY=') ? 'EXPO_PUBLIC_LLM_KEY=(hidden)' : l)).join('\n')
  : '  (missing)');
p('');

p('--- expo token present? ---');
p('  ' + (existsSync(join(here, 'control', '.expo-token')) && readFileSync(join(here, 'control', '.expo-token'), 'utf8').trim() ? 'yes' : 'NO'));
p('--- app/node_modules: ' + (existsSync(join(ROOT, 'app', 'node_modules')) ? 'present' : 'MISSING'));

writeFileSync(join(here, 'diagnostic.txt'), out.join('\n'), 'utf8');
console.log('\nWritten to tools\\diagnostic.txt');
