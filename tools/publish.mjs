/**
 * Push to both repositories in one command.
 *
 *   node tools/publish.mjs          # push
 *   node tools/publish.mjs --dry    # say what it would do, touch nothing
 *
 * There are two repositories and they hold deliberately different things.
 *
 *   origin  sreeharisankar26/witness       the working repository. Full
 *                                          history, every commit, including
 *                                          the ones where something was wrong
 *                                          and got fixed.
 *
 *   kaya    sreeharisankar26/kaya_espada   the submission. Exactly ONE commit,
 *                                          holding the current state of main.
 *
 * Those are different histories, so a single `git push` cannot serve both. This
 * does. It pushes main to origin normally, then rebuilds the submission commit
 * from main's tree and force-pushes that. Rebuilt every time rather than
 * amended, so the submission can never drift from what main actually contains —
 * the tree is copied, not reconstructed.
 *
 * The force-push to kaya is intended. That repository only ever holds one
 * commit and nothing of yours lives there to lose. It force-pushes NOTHING to
 * origin, ever.
 *
 * Node core only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const say = s => console.log(s);
const die = (...lines) => {
  say('');
  for (const l of lines) say(`  ${l}`);
  say('');
  process.exit(1);
};

say('');
say('WITNESS PUBLISH');
say('');

/* ── refuse to publish something broken ──────────────────────────────────── */

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
  die(`You are on "${branch}", not main.`,
      'The submission is built from main\'s tree, so publishing from anywhere',
      'else would ship something you are not looking at. Switch first.');
}

const dirty = git('status', '--porcelain');
if (dirty) {
  die('Uncommitted changes:', '',
      ...dirty.split('\n').slice(0, 12).map(l => `  ${l}`), '',
      'The submission commit copies main\'s tree, so anything not committed',
      'simply would not be in it. Commit or stash, then run this again.');
}

/**
 * The tests are the claim the README makes in its first six lines. Publishing a
 * repository whose own headline instruction fails is worse than not publishing.
 */
if (!DRY) {
  say('  running the test suite first…');
  try {
    execFileSync('npm', ['test'], { cwd: join(ROOT, 'app'), stdio: 'pipe', shell: process.platform === 'win32' });
    say('  tests pass');
  } catch (e) {
    const out = String(e.stdout ?? '') + String(e.stderr ?? '');
    const fails = out.split('\n').filter(l => /^# fail|not ok/.test(l)).slice(0, 8);
    die('The test suite fails.', '', ...fails.map(l => `  ${l.trim()}`), '',
        'Nothing has been pushed. Fix it, or run with --dry to see the plan.');
  }
}

/* ── 1. the working repository, full history ─────────────────────────────── */

const head = git('rev-parse', '--short', 'HEAD');
say('');
say(`  origin  witness         main @ ${head}`);
if (DRY) {
  say('          would run: git push origin main');
} else {
  say('          pushing…');
  say(indent(git('push', 'origin', 'main')));
}

/* ── 2. the submission, one commit ───────────────────────────────────────── */

const msgFile = join(ROOT, 'tools', 'submission-message.txt');
if (!existsSync(msgFile)) {
  die('tools/submission-message.txt is missing.',
      'That file is the submission commit message. Restore it before publishing.');
}

const tree = git('rev-parse', 'main^{tree}');
const sub = DRY ? '(not created)' : git('commit-tree', tree, '-F', msgFile);
if (!DRY) git('branch', '-f', 'submission', sub);

say('');
say(`  kaya    kaya_espada     one commit, tree ${tree.slice(0, 7)}`);
if (DRY) {
  say('          would run: git commit-tree main^{tree} -F tools/submission-message.txt');
  say('                     git branch -f submission <new>');
  say('                     git push kaya submission:main --force');
} else {
  say(`          rebuilt as ${sub.slice(0, 7)}, pushing…`);
  say(indent(git('push', 'kaya', 'submission:main', '--force')));
}

say('');
say(DRY
  ? '  Dry run. Nothing was created and nothing was pushed.'
  : '  Both are up to date. kaya_espada holds one commit with exactly the tree\n'
  + '  that is on main right now.');
say('');

function indent(s) {
  return s ? s.split('\n').map(l => `          ${l}`).join('\n') : '          (nothing to push)';
}
