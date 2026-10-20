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

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-7-')));
const src = __dirname;
process.env.HOME = path.join(tmpRoot, 'h0');
process.env.USERPROFILE = process.env.HOME;
const { main } = require(path.join(src, 'install.js'));
const { linkSecondary } = require(path.join(src, 'install-files.js'));

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
async function run(argv, name) {
  const home = path.join(tmpRoot, name, 'home'); const work = path.join(tmpRoot, name, 'work');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(work, { recursive: true });
  process.env.HOME = home; process.env.USERPROFILE = home; process.chdir(work);
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl: async () => { throw new Error('prompted'); }, log: (m) => out.push(m), error: (m) => err.push(m) });
  return { r, home, work, out: out.join('\n'), err: err.join('\n') };
}
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

(async () => {
  let x = await run(['--global', '--harness', 'pi', '--agents', 'worker,reviewer'], 'copy');
  let prim = path.join(x.home, '.claude', 'skills', 'five-role-team');
  let sec = path.join(x.home, '.pi', 'agent', 'skills', 'five-role-team');
  assert(x.r.exitCode === 0 && !x.err, 'pi global copy: exit 0 (' + x.err + ')');
  assert(lst(prim) && lst(prim).isDirectory() && !lst(prim).isSymbolicLink(), 'primary is a real directory');
  assert(lst(sec) && lst(sec).isSymbolicLink(), 'secondary is a symlink');
  assert(fs.realpathSync(sec) === fs.realpathSync(prim), 'secondary resolves to primary');
  assert(fs.existsSync(path.join(sec, 'SKILL.md')), 'SKILL.md visible via secondary');

  x = await run(['--global', '--harness', 'pi', '--agents', 'worker', '--link'], 'link');
  prim = path.join(x.home, '.claude', 'skills', 'five-role-team');
  sec = path.join(x.home, '.pi', 'agent', 'skills', 'five-role-team');
  assert(x.r.exitCode === 0 && !x.err, 'pi global --link: exit 0 (' + x.err + ')');
  assert(lst(prim).isSymbolicLink() && fs.realpathSync(prim) === fs.realpathSync(src), 'primary symlink -> source');
  assert(lst(sec).isSymbolicLink() && path.resolve(path.dirname(sec), fs.readlinkSync(sec)) === prim, 'secondary symlink -> primary path');
  assert(fs.realpathSync(sec) === fs.realpathSync(src), 'secondary resolves through primary to source');

  x = await run(['--local', '--harness', 'pi', '--agents', 'worker'], 'local');
  assert(x.r.exitCode === 0 && lst(path.join(x.work, '.pi', 'skills', 'five-role-team')).isDirectory(), 'pi local: installed to ./.pi/skills/five-role-team');
  assert(!lst(path.join(x.home, '.pi')) && !lst(path.join(x.home, '.claude')), 'pi local: nothing created in home (no secondary)');

  x = await run(['--global', '--harness', 'claude-code', '--agents', 'worker'], 'cc');
  assert(x.r.exitCode === 0 && lst(path.join(x.home, '.claude', 'skills', 'five-role-team')) && !lst(path.join(x.home, '.pi')), 'claude-code: no secondary / no ~/.pi');

  const custom = path.join(tmpRoot, 'customdest');
  x = await run(['--global', '--harness', custom, '--agents', 'worker'], 'custom');
  assert(x.r.exitCode === 0 && lst(path.join(custom, 'five-role-team')) && !lst(path.join(x.home, '.pi')), 'custom path: no secondary');

  // existing secondary: file, dir, dangling symlink -> error, intact
  for (const kind of ['file', 'dir', 'dangling']) {
    const name = 'exist-' + kind;
    const home = path.join(tmpRoot, name, 'home');
    const sdir = path.join(home, '.pi', 'agent', 'skills');
    fs.mkdirSync(sdir, { recursive: true });
    const s = path.join(sdir, 'five-role-team');
    if (kind === 'file') fs.writeFileSync(s, 'keep');
    if (kind === 'dir') { fs.mkdirSync(s); fs.writeFileSync(path.join(s, 'k'), 'keep'); }
    if (kind === 'dangling') fs.symlinkSync(path.join(tmpRoot, 'nowhere'), s);
    x = await run(['--global', '--harness', 'pi', '--agents', 'worker'], name);
    assert(x.r.exitCode !== 0 && /^Error: .*already exists/m.test(x.err), kind + ': Error: ... already exists');
    const st = lst(s);
    const intact = kind === 'file' ? fs.readFileSync(s, 'utf8') === 'keep'
      : kind === 'dir' ? fs.readFileSync(path.join(s, 'k'), 'utf8') === 'keep'
      : st.isSymbolicLink() && fs.readlinkSync(s) === path.join(tmpRoot, 'nowhere');
    assert(intact, kind + ': existing secondary left intact');
  }

  // re-run: secondary already pointing at primary is accepted, left as-is
  // 5.9: with --force the existing primary is replaced and the correct secondary is tolerated
  x = await run(['--global', '--harness', 'pi', '--agents', 'worker', '--link', '--force'], 'link');
  assert(x.r.exitCode === 0 && lst(path.join(x.home, '.pi', 'agent', 'skills', 'five-role-team')).isSymbolicLink(), 're-run --link --force: reinstalled, secondary still valid');
  const s2 = path.join(tmpRoot, 'copy', 'home', '.pi', 'agent', 'skills', 'five-role-team');
  const r2 = linkSecondary(path.join(tmpRoot, 'copy', 'home', '.claude', 'skills', 'five-role-team'), s2);
  assert(r2 && r2.existed && lst(s2).isSymbolicLink(), 'secondary already linking to primary: no-op success');
  assert(linkSecondary('/x', null) === null && linkSecondary('/x', '') === null, 'linkSecondary: null/empty secondary is no-op');

  process.chdir(src);
  assert(snap() === before, 'real ~/.claude/skills and ~/.pi/agent/skills unchanged');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
