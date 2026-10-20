#!/usr/bin/env node
'use strict';

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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-6-'));
const fakeHome = path.join(tmpRoot, 'home');
const work = path.join(tmpRoot, 'work');
fs.mkdirSync(fakeHome); fs.mkdirSync(work);
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
const src = __dirname;
process.chdir(work);

const { main } = require(path.join(src, 'install.js'));
const { linkInstall } = require(path.join(src, 'install-files.js'));

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
async function run(argv) {
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl: async () => { throw new Error('prompted'); }, log: (m) => out.push(m), error: (m) => err.push(m) });
  return { r, out: out.join('\n'), err: err.join('\n') };
}

(async () => {
  // local --link, no prior copy
  let x;
  const t = path.join(work, '.claude', 'skills', 'five-role-team');  // --link with no --agents would prompt; use --agents to avoid prompts
  x = await run(['--local', '--harness', 'claude-code', '--agents', 'worker,reviewer', '--link']);
  assert(x.r.exitCode === 0 && !x.err, 'local --link: exit 0, no errors (' + x.err + ')');
  const st = fs.lstatSync(t);
  assert(st.isSymbolicLink(), 'target is a symlink');
  assert(path.resolve(path.dirname(t), fs.readlinkSync(t)) === src, 'readlink points to source dir');
  assert(fs.realpathSync(t) === fs.realpathSync(src), 'realpath resolves to source dir');
  assert(fs.readFileSync(path.join(t, 'SKILL.md'), 'utf8') === fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'), 'SKILL.md read through link equals source');
  assert(fs.readFileSync(path.join(t, 'agents', 'architect.md'), 'utf8') === fs.readFileSync(path.join(src, 'agents', 'architect.md'), 'utf8'), 'agent file through link is unmodified source');
  assert(/symlink mode/i.test(x.out) && x.out.includes('->'), 'output notes whole-dir link and shows link path');

  // existing target errors cleanly, nothing changed
  x = await run(['--local', '--harness', 'claude-code', '--agents', 'worker', '--link']);
  assert(x.r.exitCode !== 0 && /^Error: .*already exists/m.test(x.err), 'existing symlink target: Error: ... already exists');
  assert(fs.lstatSync(t).isSymbolicLink() && fs.realpathSync(t) === fs.realpathSync(src), 'existing link untouched');

  // existing real directory, file and dangling symlink
  const d = path.join(tmpRoot, 'tdir'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'keep'), 'x');
  let threw = null; try { linkInstall(src, d); } catch (e) { threw = e; }
  assert(threw && /already exists/.test(threw.message) && fs.readFileSync(path.join(d, 'keep'), 'utf8') === 'x', 'existing directory: clear error, contents kept');
  const f = path.join(tmpRoot, 'tfile'); fs.writeFileSync(f, 'y');
  threw = null; try { linkInstall(src, f); } catch (e) { threw = e; }
  assert(threw && fs.readFileSync(f, 'utf8') === 'y', 'existing file: error, untouched');
  const dang = path.join(tmpRoot, 'dangling'); fs.symlinkSync(path.join(tmpRoot, 'nowhere'), dang);
  threw = null; try { linkInstall(src, dang); } catch (e) { threw = e; }
  assert(threw && fs.readlinkSync(dang) === path.join(tmpRoot, 'nowhere'), 'dangling symlink: error, untouched');
  threw = null; try { linkInstall(src, path.join(src, 'x-inside')); } catch (e) { threw = e; }
  assert(threw && !fs.existsSync(path.join(src, 'x-inside')), 'target inside source rejected');
  threw = null; try { linkInstall(tmpRoot, path.join(tmpRoot, 'l')); } catch (e) { threw = e; }
  assert(threw && /Not a plugin source/.test(threw.message), 'non-plugin source rejected');

  // global --link (claude-code) in temp HOME
  x = await run(['--global', '--harness', 'claude-code', '--agents', 'worker', '--link']);
  const g = path.join(fakeHome, '.claude', 'skills', 'five-role-team');
  assert(x.r.exitCode === 0 && fs.lstatSync(g).isSymbolicLink() && fs.realpathSync(g) === fs.realpathSync(src), 'global --link creates symlink to source in temp HOME');

  // copy mode still default
  fs.rmSync(g);
  x = await run(['--global', '--harness', 'claude-code', '--agents', 'worker']);
  const gl = fs.lstatSync(g);
  assert(x.r.exitCode === 0 && gl.isDirectory() && !gl.isSymbolicLink() && fs.existsSync(path.join(g, 'agents', 'worker.md')) && !fs.existsSync(path.join(g, 'agents', 'architect.md')), 'copy mode (no --link) still copies a real directory with selected agents only');

  assert(snap() === before, 'real ~/.claude/skills and ~/.pi/agent/skills untouched');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
