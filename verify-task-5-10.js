#!/usr/bin/env node
'use strict';
// Verify task 5.10: rollback on partial installation failure.
const fs = require('fs');
const os = require('os');
const path = require('path');

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

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-10-')));
const src = __dirname;
process.env.HOME = path.join(tmpRoot, 'h0');
process.env.USERPROFILE = process.env.HOME;
const { main } = require(path.join(src, 'install.js'));

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
async function run(argv, opts = {}) {
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl: noPrompt, log: (m) => out.push(m), error: (m) => err.push(m), ...opts });
  return { r, out: out.join('\n'), err: err.join('\n') };
}
// A source copy whose agents/worker.md has no frontmatter: copyInstall copies
// SKILL.md, commands/, conventions/, .claude-plugin/ and then fails midway.
function brokenSource(name) {
  const d = path.join(tmpRoot, name);
  fs.mkdirSync(d, { recursive: true });
  for (const n of ['SKILL.md', 'commands', 'conventions', '.claude-plugin', 'agents', 'pi']) {
    fs.cpSync(path.join(src, n), path.join(d, n), { recursive: true });
  }
  fs.writeFileSync(path.join(d, 'agents', 'worker.md'), 'no frontmatter here\n');
  return d;
}
function tree(p) {
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d).sort()) {
      const f = path.join(d, n); const st = fs.lstatSync(f);
      out.push(f + (st.isSymbolicLink() ? ' -> ' + fs.readlinkSync(f) : ''));
      if (st.isDirectory()) walk(f);
    }
  })(p);
  return out;
}
const withPatch = async (obj, key, impl, fn) => {
  const orig = obj[key]; obj[key] = impl(orig);
  try { return await fn(); } finally { obj[key] = orig; }
};

const MODELS = ['--agent-models', 'worker=sonnet'];
const LOCAL = ['--local', '--harness', 'claude-code', '--agents', 'worker', ...MODELS];

(async () => {
  // (a) copy failure midway; created parent dirs removed
  let e = env('a');
  const bad = brokenSource('a-src');
  let t = path.join(e.work, '.claude', 'skills', 'five-role-team');
  let x = await run(LOCAL, { sourceDir: bad });
  assert(x.r.exitCode === 1, 'copy failure: exit 1');
  assert(/Error: .*Agent file has no YAML frontmatter/.test(x.err), 'copy failure: original error shown (' + x.err.split('\n')[0] + ')');
  assert(/rolled back/i.test(x.err), 'copy failure: output mentions rollback');
  assert(!lst(t), 'copy failure: target removed (no partial files)');
  assert(!lst(path.join(e.work, '.claude')), 'copy failure: parent dirs created by this run removed');
  assert(fs.existsSync(path.join(bad, 'SKILL.md')) && fs.existsSync(path.join(bad, 'agents', 'worker.md')), 'copy failure: source untouched');

  // (b) pre-existing parents + sibling files kept; only run-created removed
  e = env('b');
  const skills = path.join(e.work, '.claude', 'skills');
  fs.mkdirSync(path.join(skills, 'other-skill'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'other-skill', 'f.txt'), 'keep');
  fs.writeFileSync(path.join(e.work, 'outside.txt'), 'keep');
  const sibBefore = JSON.stringify(tree(e.work));
  x = await run(LOCAL, { sourceDir: bad });
  assert(x.r.exitCode === 1 && /rolled back/i.test(x.err), 'pre-existing parent: failure + rollback message');
  assert(JSON.stringify(tree(e.work)) === sibBefore, 'pre-existing parent: tree identical to before (siblings and parents kept)');

  // (b2) created-by-run parent kept when non-empty (something else appeared) - only empty ones removed
  e = env('b2');
  fs.mkdirSync(path.join(e.work, '.claude'), { recursive: true }); // .claude exists, skills does not
  x = await run(LOCAL, { sourceDir: bad });
  assert(x.r.exitCode === 1 && !lst(path.join(e.work, '.claude', 'skills')) && lst(path.join(e.work, '.claude')).isDirectory(), 'partial parents: created skills/ removed, pre-existing .claude/ kept');

  // (c) link failure (symlink creation fails)
  e = env('c');
  t = path.join(e.work, '.claude', 'skills', 'five-role-team');
  x = await withPatch(fs, 'symlinkSync', () => () => { const er = new Error('EACCES: injected'); er.code = 'EACCES'; throw er; },
    () => run([...LOCAL, '--link']));
  assert(x.r.exitCode === 1 && /Symlink installation failed: EACCES: injected/.test(x.err), 'link failure: original error shown');
  assert(/rolled back/i.test(x.err) && !lst(t) && !lst(path.join(e.work, '.claude')), 'link failure: nothing left behind');

  // (d) pi global: secondary fails after primary success
  e = env('d');
  const primary = path.join(e.home, '.claude', 'skills', 'five-role-team');
  const secondary = path.join(e.home, '.pi', 'agent', 'skills', 'five-role-team');
  const elsewhere = path.join(tmpRoot, 'd-elsewhere'); fs.mkdirSync(elsewhere); fs.writeFileSync(path.join(elsewhere, 'k'), 'k');
  fs.mkdirSync(path.dirname(secondary), { recursive: true });
  fs.symlinkSync(elsewhere, secondary, 'dir'); // pre-existing, points elsewhere: linkSecondary refuses
  const PI = ['--global', '--harness', 'pi', '--agents', 'worker', ...MODELS];
  x = await run(PI);
  assert(x.r.exitCode === 1 && /Cannot create secondary link/.test(x.err), 'pi secondary failure: original error shown');
  assert(/rolled back/i.test(x.err) && !lst(primary), 'pi secondary failure: primary removed');
  assert(!lst(path.join(e.home, '.claude')), 'pi secondary failure: created .claude dirs removed');
  assert(lst(secondary).isSymbolicLink() && fs.readlinkSync(secondary) === elsewhere && fs.readFileSync(path.join(elsewhere, 'k'), 'utf8') === 'k', 'pi secondary failure: pre-existing secondary and its target intact');
  // same with --link
  x = await run([...PI, '--link']);
  assert(x.r.exitCode === 1 && !lst(primary) && fs.readlinkSync(secondary) === elsewhere, 'pi --link secondary failure: primary link removed, pre-existing secondary intact');
  assert(fs.existsSync(path.join(src, 'SKILL.md')), 'pi --link secondary failure: plugin source intact');

  // (d2) secondary creation itself fails (injected) after primary copy: secondary parent created by run is removed
  e = env('d2');
  const primary2 = path.join(e.home, '.claude', 'skills', 'five-role-team');
  const orig = fs.symlinkSync;
  x = await withPatch(fs, 'symlinkSync', () => () => { throw new Error('ENOSPC: injected'); }, () => run(PI));
  assert(x.r.exitCode === 1 && /Secondary symlink creation failed: ENOSPC: injected/.test(x.err), 'pi secondary create failure: original error shown');
  assert(!lst(primary2) && !lst(path.join(e.home, '.pi')) && !lst(path.join(e.home, '.claude')), 'pi secondary create failure: primary and run-created dirs removed');
  assert(fs.symlinkSync === orig, 'patch restored');

  // (d3) already-correct secondary tolerated by the run is NOT removed on a later... (secondary correct + primary failure)
  e = env('d3');
  const prim3 = path.join(e.home, '.claude', 'skills', 'five-role-team');
  const sec3 = path.join(e.home, '.pi', 'agent', 'skills', 'five-role-team');
  fs.mkdirSync(path.dirname(sec3), { recursive: true }); fs.mkdirSync(path.dirname(prim3), { recursive: true });
  fs.symlinkSync(prim3, sec3, 'dir');
  x = await run(PI, { sourceDir: bad });
  assert(x.r.exitCode === 1 && !lst(prim3) && lst(sec3).isSymbolicLink() && fs.readlinkSync(sec3) === prim3, 'tolerated pre-existing correct secondary kept when copy fails');

  // (e) success leaves no backup/temp artifacts (fresh and forced)
  e = env('e');
  t = path.join(e.work, '.claude', 'skills', 'five-role-team');
  x = await run(LOCAL);
  assert(x.r.exitCode === 0 && !/rolled back/i.test(x.err + x.out), 'success: exit 0, no rollback message');
  fs.writeFileSync(path.join(t, 'OLD'), 'old');
  x = await run([...LOCAL, '--force']);
  assert(x.r.exitCode === 0 && !lst(path.join(t, 'OLD')), 'forced success: replaced');
  assert(JSON.stringify(fs.readdirSync(path.dirname(t))) === JSON.stringify(['five-role-team']), 'forced success: no backup/temp artifacts in skills dir (' + fs.readdirSync(path.dirname(t)) + ')');
  x = await run([...LOCAL, '--link', '--force']);
  assert(x.r.exitCode === 0 && lst(t).isSymbolicLink() && fs.readdirSync(path.dirname(t)).length === 1, 'forced --link success: no backup artifacts');

  // (f) forced reinstall failure: old install restored
  e = env('f');
  t = path.join(e.work, '.claude', 'skills', 'five-role-team');
  fs.mkdirSync(path.join(t, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(t, 'SKILL.md'), 'OLD SKILL'); fs.writeFileSync(path.join(t, 'sub', 'x'), 'x');
  const oldTree = JSON.stringify(tree(t));
  x = await run([...LOCAL, '--force'], { sourceDir: bad });
  assert(x.r.exitCode === 1 && /Agent file has no YAML frontmatter/.test(x.err), 'forced failure: original error shown');
  assert(/previous installation restored/i.test(x.err), 'forced failure: output says previous install restored');
  assert(JSON.stringify(tree(t)) === oldTree && fs.readFileSync(path.join(t, 'SKILL.md'), 'utf8') === 'OLD SKILL', 'forced failure: old install restored exactly');
  assert(JSON.stringify(fs.readdirSync(path.dirname(t))) === JSON.stringify(['five-role-team']), 'forced failure: no backup dir left');
  // confirmed (prompted) overwrite failure behaves the same
  x = await run(LOCAL, { sourceDir: bad, promptsImpl: async () => ({ overwrite: true }) });
  assert(x.r.exitCode === 1 && JSON.stringify(tree(t)) === oldTree, 'confirmed overwrite failure: old install restored');
  // old install was a symlink: restored as the symlink, link target intact
  const other = path.join(tmpRoot, 'f-other'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'keep'), 'k');
  fs.rmSync(t, { recursive: true }); fs.symlinkSync(other, t, 'dir');
  x = await run([...LOCAL, '--force'], { sourceDir: bad });
  assert(x.r.exitCode === 1 && lst(t).isSymbolicLink() && fs.readlinkSync(t) === other && fs.readFileSync(path.join(other, 'keep'), 'utf8') === 'k', 'forced failure: old symlink install restored, target intact');
  assert(fs.readdirSync(path.dirname(t)).length === 1, 'forced symlink failure: no backup left');

  // (g) pre-existing files outside target untouched on every failure above
  assert(fs.readFileSync(path.join(tmpRoot, 'b', 'work', 'outside.txt'), 'utf8') === 'keep', 'files outside target untouched');

  // (h) rollback errors do not mask the original error
  e = env('h');
  t = path.join(e.work, '.claude', 'skills', 'five-role-team');
  x = await withPatch(fs, 'rmSync', (o) => (p, ...a) => { if (String(p) === t) throw new Error('EBUSY: injected'); return o(p, ...a); },
    () => run(LOCAL, { sourceDir: bad }));
  assert(x.r.exitCode === 1 && /Agent file has no YAML frontmatter/.test(x.err) && /Rollback problem: .*EBUSY: injected/.test(x.err), 'rollback failure: original error first, rollback problem noted');

  assert(snap() === before, 'real ~/.claude and ~/.pi unchanged');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
  console.log('All checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
