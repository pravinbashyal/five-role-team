#!/usr/bin/env node
'use strict';
// Verify task 5.9: existing installation detection, overwrite warning/confirm, --force.
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

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-9-')));
const src = __dirname;
process.env.HOME = path.join(tmpRoot, 'h0');
process.env.USERPROFILE = process.env.HOME;
const { main } = require(path.join(src, 'install.js'));
const { removeExistingInstall, detectExistingInstall } = require(path.join(src, 'install-files.js'));

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });
const noPrompt = async () => { throw new Error('prompted'); };

function env(name) {
  const home = path.join(tmpRoot, name, 'home'); const work = path.join(tmpRoot, name, 'work');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(work, { recursive: true });
  process.env.HOME = home; process.env.USERPROFILE = home; process.chdir(work);
  return { home, work };
}
async function run(argv, promptsImpl, opts = {}) {
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl, log: (m) => out.push(m), error: (m) => err.push(m), ...opts });
  return { r, out: out.join('\n'), err: err.join('\n') };
}
const LOCAL = ['--local', '--harness', 'claude-code', '--agents', 'worker'];
const primaryOf = (e) => path.join(e.work, '.claude', 'skills', 'five-role-team');

(async () => {
  // (a) no existing install: no prompt, no warning
  let e = env('a');
  let x = await run(LOCAL, noPrompt);
  let t = primaryOf(e);
  assert(x.r.exitCode === 0 && lst(t).isDirectory() && !/already installed|Warning/i.test(x.out), 'no existing: installs without prompt or warning');

  // (b) existing + confirm yes: warning naming path, confirm prompt, replaced
  fs.writeFileSync(path.join(t, 'MARKER'), 'old');
  const asked = [];
  x = await run(LOCAL, async (q) => { asked.push(q); return { overwrite: true }; });
  assert(asked.length === 1 && asked[0].type === 'confirm' && asked[0].initial === false, 'confirm: single confirm prompt, default No');
  assert(x.out.includes('Warning: five-role-team is already installed at ' + t), 'confirm: overwrite warning names the path');
  assert(/overwrite/i.test(asked[0].message) && asked[0].message.includes(t), 'confirm: prompt message names the path');
  assert(x.r.exitCode === 0 && !lst(path.join(t, 'MARKER')) && fs.existsSync(path.join(t, 'SKILL.md')), 'confirm yes: old install replaced, fresh files present');

  // (c) existing + decline / cancel / no answer: unchanged, exit 0
  fs.writeFileSync(path.join(t, 'MARKER'), 'old');
  for (const [label, impl] of [
    ['decline', async () => ({ overwrite: false })],
    ['cancel', async (q, o) => { o.onCancel(); return {}; }],
    ['undefined answer', async () => undefined],
  ]) {
    x = await run(LOCAL, impl);
    assert(x.r.exitCode === 0 && x.r.cancelled && /Installation cancelled\./.test(x.out) && fs.readFileSync(path.join(t, 'MARKER'), 'utf8') === 'old', label + ': exit 0, "Installation cancelled.", install unchanged');
    assert(/already installed/.test(x.out), label + ': warning was shown before declining');
  }
  // non-TTY real CLI (no injected prompts): cannot ask -> failure (exit 1, --force hint), not a decline; no hang
  const p = spawnSync('node', [path.join(src, 'install.js'), ...LOCAL], { encoding: 'utf8', cwd: e.work, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  assert(p.status !== 0 && /--force/.test(p.stderr) && /^Error: /m.test(p.stderr) && !/Installation cancelled\./.test(p.stdout) && /already installed/.test(p.stdout) && fs.existsSync(path.join(t, 'MARKER')), 'non-TTY CLI: warning, Error + --force hint, non-zero exit, unchanged');

  // (d) existing + --force: no prompt, replaced
  x = await run([...LOCAL, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && !lst(path.join(t, 'MARKER')) && fs.existsSync(path.join(t, 'SKILL.md')) && !/Warning/.test(x.out), '--force: no prompt, replaced');

  // (e) existing symlink: removal unlinks only, source dir survives
  e = env('e');
  t = primaryOf(e);
  const other = path.join(tmpRoot, 'e-source'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'keep.txt'), 'k');
  fs.mkdirSync(path.dirname(t), { recursive: true }); fs.symlinkSync(other, t, 'dir');
  assert(detectExistingInstall(t).kind === 'symlink', 'detect: symlink');
  x = await run([...LOCAL, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && lst(t).isDirectory() && !lst(t).isSymbolicLink() && fs.readFileSync(path.join(other, 'keep.txt'), 'utf8') === 'k', 'symlink target: replaced by copy, link source dir not deleted');
  // symlink to this repo (the real source): must not delete anything in it
  fs.rmSync(t, { recursive: true }); fs.symlinkSync(src, t, 'dir');
  x = await run(LOCAL, async () => ({ overwrite: true }));
  assert(x.r.exitCode === 0 && lst(t).isDirectory() && !lst(t).isSymbolicLink() && fs.existsSync(path.join(src, 'SKILL.md')) && fs.existsSync(path.join(src, 'install.js')), 'symlink to plugin source: replaced, source intact');

  // (f) --link over existing copy; copy over existing link
  e = env('f'); t = primaryOf(e);
  await run(LOCAL, noPrompt);
  assert(lst(t).isDirectory(), 'setup: copy install present');
  x = await run([...LOCAL, '--link'], async () => ({ overwrite: true }));
  assert(x.r.exitCode === 0 && lst(t).isSymbolicLink() && fs.realpathSync(t) === fs.realpathSync(src), '--link over existing copy (confirmed): now symlink to source');
  x = await run([...LOCAL, '--link'], async () => ({ overwrite: false }));
  assert(x.r.exitCode === 0 && x.r.cancelled && lst(t).isSymbolicLink(), '--link over existing link, declined: unchanged');
  x = await run([...LOCAL, '--link', '--force'], noPrompt);
  assert(x.r.exitCode === 0 && lst(t).isSymbolicLink(), '--link --force over existing link: relinked');
  x = await run([...LOCAL, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && lst(t).isDirectory() && !lst(t).isSymbolicLink() && fs.existsSync(path.join(src, 'SKILL.md')), 'copy over existing link (--force): directory, source intact');

  // dangling symlink and plain file
  const dang = (kind) => {
    const ee = env('g-' + kind); const tt = primaryOf(ee); fs.mkdirSync(path.dirname(tt), { recursive: true });
    if (kind === 'dangling') fs.symlinkSync(path.join(tmpRoot, 'nowhere'), tt); else fs.writeFileSync(tt, 'x');
    return tt;
  };
  for (const kind of ['dangling', 'file']) {
    const tt = dang(kind);
    assert(detectExistingInstall(tt).kind === (kind === 'dangling' ? 'dangling-symlink' : 'file'), 'detect: ' + kind);
    x = await run([...LOCAL, '--force'], noPrompt);
    assert(x.r.exitCode === 0 && lst(tt).isDirectory(), kind + ': replaced with --force');
  }

  // (h) unsafe targets refused
  const sk = path.join(tmpRoot, 'unsafe', 'skills'); fs.mkdirSync(sk, { recursive: true });
  const bad = path.join(sk, 'other-name'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'f'), '1');
  const thrown = (fn) => { try { fn(); } catch (err) { return err.message; } return ''; };
  assert(/Refusing/.test(thrown(() => removeExistingInstall(bad, { sourceDir: src }))) && fs.existsSync(path.join(bad, 'f')), 'refuses target not named five-role-team');
  const good = path.join(sk, 'five-role-team'); fs.mkdirSync(good); fs.writeFileSync(path.join(good, 'f'), '1');
  assert(/Refusing/.test(thrown(() => removeExistingInstall(good, { sourceDir: src, expected: path.join(sk, 'x', 'five-role-team') }))) && fs.existsSync(path.join(good, 'f')), 'refuses target differing from resolved path');
  assert(/Refusing/.test(thrown(() => removeExistingInstall(good, { sourceDir: good }))) && fs.existsSync(path.join(good, 'f')), 'refuses target == source dir');
  const nested = path.join(good, 'sub', 'srcdir'); fs.mkdirSync(nested, { recursive: true });
  assert(/Refusing/.test(thrown(() => removeExistingInstall(good, { sourceDir: nested }))) && fs.existsSync(nested), 'refuses target containing source dir');
  const viaLink = path.join(tmpRoot, 'unsafe', 'alias'); fs.symlinkSync(good, viaLink);
  assert(/Refusing/.test(thrown(() => removeExistingInstall(good, { sourceDir: viaLink }))) && fs.existsSync(nested), 'refuses when source resolves (realpath) inside target');
  // through main: custom harness whose primary is the source directory
  const selfSkills = path.join(tmpRoot, 'self', 'skills'); fs.mkdirSync(selfSkills, { recursive: true });
  const selfSrc = path.join(selfSkills, 'five-role-team'); fs.cpSync(src, selfSrc, { recursive: true, filter: (s) => !/node_modules|\.git$/.test(s) });
  env('h');
  x = await run(['--global', '--harness', selfSkills, '--agents', 'worker', '--force'], noPrompt, { sourceDir: selfSrc });
  assert(x.r.exitCode === 1 && /Refusing|source directory/.test(x.err) && fs.existsSync(path.join(selfSrc, 'SKILL.md')), 'main: primary == source refused, exit 1, source intact');
  assert(fs.existsSync(selfSkills), 'parent skills dir never deleted');
  assert(removeExistingInstall(path.join(sk, 'missing', 'five-role-team'), { sourceDir: src }) === false, 'nothing to remove returns false');

  // (i) pi global reinstall keeps both locations valid
  e = env('i');
  const prim = path.join(e.home, '.claude', 'skills', 'five-role-team');
  const sec = path.join(e.home, '.pi', 'agent', 'skills', 'five-role-team');
  const PI = ['--global', '--harness', 'pi', '--agents', 'worker'];
  x = await run(PI, noPrompt);
  assert(x.r.exitCode === 0 && lst(sec).isSymbolicLink(), 'pi global: first install ok');
  x = await run(PI, async () => ({ overwrite: true }));
  assert(x.r.exitCode === 0 && lst(prim).isDirectory() && lst(sec).isSymbolicLink() && fs.realpathSync(sec) === fs.realpathSync(prim) && fs.existsSync(path.join(sec, 'SKILL.md')), 'pi global: confirmed reinstall, primary dir + secondary link valid');
  x = await run([...PI, '--force'], noPrompt);
  assert(x.r.exitCode === 0 && fs.realpathSync(sec) === fs.realpathSync(prim), 'pi global: --force reinstall keeps both valid');
  x = await run([...PI, '--force', '--link'], noPrompt);
  assert(x.r.exitCode === 0 && lst(prim).isSymbolicLink() && fs.realpathSync(sec) === fs.realpathSync(src), 'pi global: --link --force reinstall keeps both valid');
  x = await run(PI, async () => ({ overwrite: false }));
  assert(x.r.exitCode === 0 && x.r.cancelled && lst(prim).isSymbolicLink() && lst(sec).isSymbolicLink(), 'pi global: declined reinstall leaves both untouched');
  // secondary pointing elsewhere: no longer a hard error; handled by detection/confirm/backup (full coverage in verify-task-5-11.js).
  // Without --force and with no TTY it is refused (exit 1) and left untouched.
  e = env('j');
  const sec2 = path.join(e.home, '.pi', 'agent', 'skills', 'five-role-team');
  fs.mkdirSync(path.dirname(sec2), { recursive: true }); fs.symlinkSync(path.join(tmpRoot, 'elsewhere'), sec2);
  const pj = spawnSync('node', [path.join(src, 'install.js'), ...PI], { encoding: 'utf8', cwd: e.work, env: { ...process.env, HOME: e.home, USERPROFILE: e.home }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  assert(pj.status !== 0 && /--force/.test(pj.stderr) && fs.readlinkSync(sec2) === path.join(tmpRoot, 'elsewhere') && !lst(path.join(e.home, '.claude')), 'secondary pointing elsewhere, no TTY, no --force: refused, untouched');

  process.chdir(src);
  assert(snap() === before, 'real ~/.claude/skills and ~/.pi/agent/skills unchanged');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err); process.exit(1); });
