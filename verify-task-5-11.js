#!/usr/bin/env node
'use strict';
// Verify remediation 5.11: pi secondary location in detection / confirmation /
// --force / backup / rollback; non-TTY refusal exits non-zero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const realHome = os.homedir();
function snap() {
  const out = {};
  for (const d of [path.join(realHome, '.claude', 'skills'), path.join(realHome, '.pi', 'agent', 'skills')]) {
    try {
      for (const n of fs.readdirSync(d).sort()) {
        const p = path.join(d, n); const st = fs.lstatSync(p);
        out[p] = st.isSymbolicLink() ? 'L:' + fs.readlinkSync(p) : 'D:' + st.mtimeMs;
      }
    } catch (e) { out[d] = 'missing'; }
  }
  return JSON.stringify(out);
}
const before = snap();

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-11-')));
const src = __dirname;
process.env.HOME = path.join(tmpRoot, 'h0');
process.env.USERPROFILE = process.env.HOME;
const { main } = require(path.join(src, 'install.js'));
const { detectSecondaryConflict } = require(path.join(src, 'install-files.js'));

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });
const noPrompt = async () => { throw new Error('prompted'); };

function env(name) {
  const home = path.join(tmpRoot, name, 'home'); const work = path.join(tmpRoot, name, 'work');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(work, { recursive: true });
  process.env.HOME = home; process.env.USERPROFILE = home; process.chdir(work);
  const primary = path.join(home, '.claude', 'skills', 'five-role-team');
  const secondary = path.join(home, '.pi', 'agent', 'skills', 'five-role-team');
  return { home, work, primary, secondary };
}
async function run(argv, promptsImpl, opts = {}) {
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl, log: (m) => out.push(m), error: (m) => err.push(m), ...opts });
  return { r, out: out.join('\n'), err: err.join('\n') };
}
function tree(p) {
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d).sort()) {
      const f = path.join(d, n); const st = fs.lstatSync(f);
      if (st.isDirectory()) { out.push('D:' + f); walk(f); }
      else out.push((st.isSymbolicLink() ? 'L:' + fs.readlinkSync(f) : 'F:' + fs.readFileSync(f, 'utf8')) + '@' + f);
    }
  })(p);
  return out;
}
function staleDir(d, tag) { fs.mkdirSync(path.join(d, 'sub'), { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), tag); fs.writeFileSync(path.join(d, 'sub', 'x'), tag); }
const names = (d) => fs.readdirSync(d).sort();
const noBackups = (e) => names(path.dirname(e.primary)).join() === 'five-role-team' && names(path.dirname(e.secondary)).join() === 'five-role-team';
const valid = (e) => lst(e.secondary).isSymbolicLink() && fs.realpathSync(e.secondary) === fs.realpathSync(e.primary) && fs.existsSync(path.join(e.secondary, 'SKILL.md'));
const PI = ['--global', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet']; // explicit model: the broken source has no usable default

// A source whose worker.md has no frontmatter: the copy fails midway.
function brokenSource(name) {
  const d = path.join(tmpRoot, name);
  fs.mkdirSync(d, { recursive: true });
  for (const n of ['SKILL.md', 'commands', 'conventions', '.claude-plugin', 'agents', 'pi']) fs.cpSync(path.join(src, n), path.join(d, n), { recursive: true });
  fs.writeFileSync(path.join(d, 'agents', 'worker.md'), 'no frontmatter here\n');
  return d;
}

(async () => {
  let e, x;

  // (a) detectSecondaryConflict unit behaviour
  e = env('a');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true });
  assert(detectSecondaryConflict(e.primary, null) === null, 'detect: null secondary -> null');
  assert(detectSecondaryConflict(e.primary, e.secondary) === null, 'detect: absent secondary -> null');
  fs.symlinkSync(e.primary, e.secondary, 'dir');
  assert(detectSecondaryConflict(e.primary, e.secondary) === null, 'detect: (dangling) link to primary is not a conflict');
  fs.unlinkSync(e.secondary); fs.symlinkSync(path.relative(path.dirname(e.secondary), e.primary), e.secondary, 'dir');
  assert(detectSecondaryConflict(e.primary, e.secondary) === null, 'detect: relative link to primary is not a conflict');
  fs.unlinkSync(e.secondary); fs.symlinkSync(path.join(tmpRoot, 'elsewhere'), e.secondary, 'dir');
  assert(detectSecondaryConflict(e.primary, e.secondary).kind === 'dangling-symlink', 'detect: link elsewhere is a conflict');
  fs.unlinkSync(e.secondary); fs.mkdirSync(e.secondary);
  assert(detectSecondaryConflict(e.primary, e.secondary).kind === 'directory', 'detect: directory is a conflict');
  fs.rmdirSync(e.secondary); fs.writeFileSync(e.secondary, 'f');
  assert(detectSecondaryConflict(e.primary, e.secondary).kind === 'file', 'detect: file is a conflict');

  // (b) stale secondary DIRECTORY + --force: succeeds, both valid, no backups left
  e = env('b');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); staleDir(e.secondary, 'STALE');
  x = await run([...PI, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && lst(e.primary).isDirectory() && valid(e), 'stale secondary dir + --force: success, primary dir + secondary link valid');
  assert(noBackups(e), 'stale secondary dir + --force: no backup artifacts in either skills dir');
  assert(!/Warning/.test(x.out), 'stale secondary dir + --force: no prompt/warning');

  // (c) stale secondary symlink elsewhere + --force
  e = env('c');
  const other = path.join(tmpRoot, 'c-other'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'keep'), 'k');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); fs.symlinkSync(other, e.secondary, 'dir');
  x = await run([...PI, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && valid(e) && noBackups(e), 'stale secondary symlink elsewhere + --force: success, both valid, no backups');
  assert(fs.readFileSync(path.join(other, 'keep'), 'utf8') === 'k', 'stale secondary symlink: its target (not followed) intact');
  // same with --link
  e = env('c2');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); staleDir(e.secondary, 'STALE');
  x = await run([...PI, '--link', '--force'], noPrompt);
  assert(x.r.exitCode === 0 && lst(e.primary).isSymbolicLink() && fs.realpathSync(e.secondary) === fs.realpathSync(src) && noBackups(e), '--link --force over stale secondary dir: success');

  // (d) without --force: prompts and names the secondary; yes -> success
  e = env('d');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); staleDir(e.secondary, 'STALE');
  const asked = [];
  x = await run(PI, async (q) => { asked.push(q); return { overwrite: true }; });
  assert(asked.length === 1 && asked[0].type === 'confirm' && asked[0].initial === false, 'secondary only conflicting: one confirm prompt, default No');
  assert(x.out.includes(e.secondary) && /secondary/i.test(x.out) && asked[0].message.includes(e.secondary), 'warning and prompt name the secondary path');
  assert(!x.out.includes('already installed at ' + e.primary), 'warning does not claim the (absent) primary is installed');
  assert(x.r.exitCode === 0 && valid(e) && noBackups(e), 'confirmed: success, both valid');

  // (e) decline / cancel leaves both untouched (primary AND secondary conflicting)
  e = env('e');
  staleDir(e.primary, 'OLDP'); fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); staleDir(e.secondary, 'OLDS');
  const pTree = JSON.stringify(tree(e.primary)); const sTree = JSON.stringify(tree(e.secondary));
  const askedBoth = [];
  for (const [label, impl] of [['decline', async (q) => { askedBoth.push(q); return { overwrite: false }; }], ['cancel', async (q, o) => { o.onCancel(); return {}; }]]) {
    x = await run(PI, impl);
    assert(x.r.exitCode === 0 && x.r.cancelled && /Installation cancelled\./.test(x.out), label + ': exit 0, "Installation cancelled."');
    assert(JSON.stringify(tree(e.primary)) === pTree && JSON.stringify(tree(e.secondary)) === sTree && lst(e.secondary).isDirectory() && noBackups(e), label + ': both locations untouched');
  }
  assert(askedBoth.length === 1 && askedBoth[0].message.includes(e.primary) && askedBoth[0].message.includes(e.secondary), 'one prompt names both primary and secondary');
  assert(x.out.includes('already installed at ' + e.primary) && x.out.includes(e.secondary), 'warning names both');

  // (f) non-TTY real CLI with stale secondary only: non-zero, --force hint, untouched
  e = env('f');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); staleDir(e.secondary, 'OLDS');
  const sT = JSON.stringify(tree(e.secondary));
  const p = spawnSync('node', [path.join(src, 'install.js'), ...PI], { encoding: 'utf8', cwd: e.work, env: { ...process.env, HOME: e.home, USERPROFILE: e.home }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  assert(p.status === 1 && /^Error: .*--force/m.test(p.stderr) && !/Installation cancelled/.test(p.stdout), 'non-TTY CLI: exit 1, Error with --force hint');
  assert(JSON.stringify(tree(e.secondary)) === sT && !lst(e.primary), 'non-TTY CLI: nothing changed');
  const p2 = spawnSync('node', [path.join(src, 'install.js'), ...PI, '--force'], { encoding: 'utf8', cwd: e.work, env: { ...process.env, HOME: e.home, USERPROFILE: e.home }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  assert(p2.status === 0 && valid(e), 'non-TTY CLI + --force: success');

  // (g) failure after moving BOTH aside restores both exactly
  const bad = brokenSource('bad-src');
  e = env('g');
  staleDir(e.primary, 'OLDP'); fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); staleDir(e.secondary, 'OLDS');
  const gp = JSON.stringify(tree(e.primary)); const gs = JSON.stringify(tree(e.secondary));
  x = await run([...PI, '--force'], noPrompt, { sourceDir: bad });
  assert(x.r.exitCode === 1 && /Agent file has no YAML frontmatter/.test(x.err), 'copy failure: original error shown');
  assert(JSON.stringify(tree(e.primary)) === gp && JSON.stringify(tree(e.secondary)) === gs, 'copy failure: primary AND secondary restored exactly');
  assert(noBackups(e) && /restored/i.test(x.err), 'copy failure: no backups left, output says restored');
  // confirmed (prompted) variant, secondary is a symlink elsewhere
  fs.rmSync(e.secondary, { recursive: true }); const other2 = path.join(tmpRoot, 'g-other'); fs.mkdirSync(other2); fs.writeFileSync(path.join(other2, 'keep'), 'k');
  fs.symlinkSync(other2, e.secondary, 'dir');
  x = await run(PI, async () => ({ overwrite: true }), { sourceDir: bad });
  assert(x.r.exitCode === 1 && JSON.stringify(tree(e.primary)) === gp && fs.readlinkSync(e.secondary) === other2 && noBackups(e), 'confirmed failure: primary dir and secondary symlink restored');
  // failure at secondary creation (after primary copied)
  const origSym = fs.symlinkSync;
  fs.symlinkSync = () => { throw new Error('ENOSPC: injected'); };
  try { x = await run([...PI, '--force'], noPrompt); } finally { fs.symlinkSync = origSym; }
  assert(x.r.exitCode === 1 && /Secondary symlink creation failed: ENOSPC: injected/.test(x.err), 'secondary creation failure: original error shown');
  assert(JSON.stringify(tree(e.primary)) === gp && fs.readlinkSync(e.secondary) === other2 && noBackups(e), 'secondary creation failure: new primary removed, both originals restored exactly');

  // (h) correct existing secondary causes no extra prompt/backup
  e = env('h');
  x = await run(PI, noPrompt);
  assert(x.r.exitCode === 0 && valid(e), 'setup: first pi install');
  const hasked = [];
  x = await run(PI, async (q) => { hasked.push(q); return { overwrite: true }; });
  assert(hasked.length === 1 && hasked[0].message.includes(e.primary) && !hasked[0].message.includes(e.secondary), 'reinstall: single prompt mentions only the primary');
  assert(!/secondary/i.test(x.out.replace(/Linked .*/g, '')) && x.r.exitCode === 0 && valid(e) && noBackups(e), 'reinstall with correct secondary: no secondary warning, no backup, both valid');
  x = await run([...PI, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && valid(e) && !/Removed existing secondary/.test(x.out), '--force reinstall: correct secondary left alone');
  // correct secondary, primary absent (dangling): no prompt at all
  fs.rmSync(e.primary, { recursive: true });
  x = await run(PI, noPrompt);
  assert(x.r.exitCode === 0 && valid(e) && noBackups(e), 'dangling secondary -> absent primary: no prompt, success');

  // (i) real-HOME layout: secondary -> primary where primary is a symlink to source
  e = env('i');
  fs.mkdirSync(path.dirname(e.primary), { recursive: true }); fs.symlinkSync(src, e.primary, 'dir');
  fs.mkdirSync(path.dirname(e.secondary), { recursive: true }); fs.symlinkSync(e.primary, e.secondary, 'dir');
  const iasked = [];
  x = await run(PI, async (q) => { iasked.push(q); return { overwrite: false }; });
  assert(iasked.length === 1 && !iasked[0].message.includes(e.secondary) && x.r.cancelled, 'primary symlink + correct secondary: prompt about primary only; decline leaves both');
  assert(fs.readlinkSync(e.primary) === src && fs.readlinkSync(e.secondary) === e.primary && fs.existsSync(path.join(src, 'SKILL.md')), 'declined: links and source intact');

  // (j) missing --harness is an error, not the old stub
  x = await run(['--global'], noPrompt);
  assert(x.r.exitCode === 1 && /--harness is required/.test(x.err) && !/coming soon/.test(x.out), 'missing --harness: exit 1, clear error');
  const pj = spawnSync('node', [path.join(src, 'install.js'), '--global'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, env: { ...process.env, HOME: e.home, USERPROFILE: e.home } });
  assert(pj.status === 1 && /--harness is required/.test(pj.stderr) && !/coming soon/.test(pj.stdout), 'CLI missing --harness: exit 1');
  assert(!/Harness path resolution/.test(x.out), 'no leftover debug path output');

  process.chdir(src);
  assert(snap() === before, 'real ~/.claude/skills and ~/.pi/agent/skills unchanged');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err); process.exit(1); });
