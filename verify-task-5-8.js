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

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-8-')));
const src = __dirname;
process.env.HOME = path.join(tmpRoot, 'h0');
process.env.USERPROFILE = process.env.HOME;
const { main } = require(path.join(src, 'install.js'));

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
const model = (f) => (fs.readFileSync(f, 'utf8').match(/^model:\s*(.+)$/m) || [])[1];

(async () => {
  assert(fs.existsSync(path.join(src, 'pi', 'agents', 'intern.md')), 'source has pi/agents/intern.md');

  // (a) pi global copy, intern default model
  let x = await run(['--global', '--harness', 'pi', '--agents', 'worker,intern'], 'pg');
  let prim = path.join(x.home, '.claude', 'skills', 'five-role-team');
  let f = path.join(prim, 'pi', 'agents', 'intern.md');
  assert(x.r.exitCode === 0 && !x.err, 'pi global: exit 0 (' + x.err + ')');
  assert(fs.existsSync(f) && model(f) === 'qwen3.5:4b-mlx', 'pi global: intern.md installed with default model qwen3.5:4b-mlx');
  assert(!fs.existsSync(path.join(prim, 'agents', 'intern.md')), 'pi global: intern not placed in agents/');
  assert(fs.existsSync(path.join(x.home, '.pi', 'agent', 'skills', 'five-role-team', 'pi', 'agents', 'intern.md')), 'pi global: visible via secondary symlink');

  // override via --agent-models
  x = await run(['--global', '--harness', 'pi', '--agents', 'worker,intern', '--agent-models', 'intern=llama3:8b'], 'pgo');
  f = path.join(x.home, '.claude', 'skills', 'five-role-team', 'pi', 'agents', 'intern.md');
  assert(x.r.exitCode === 0 && model(f) === 'llama3:8b', 'pi global: --agent-models intern override honored (' + model(f) + ')');
  assert(model(path.join(src, 'pi', 'agents', 'intern.md')) === 'qwen3.5:4b-mlx', 'source intern.md untouched');

  // pi local
  x = await run(['--local', '--harness', 'pi', '--agents', 'intern'], 'pl');
  f = path.join(x.work, '.pi', 'skills', 'five-role-team', 'pi', 'agents', 'intern.md');
  assert(x.r.exitCode === 0 && model(f) === 'qwen3.5:4b-mlx', 'pi local: intern.md with default model');
  x = await run(['--local', '--harness', 'pi', '--agents', 'intern', '--agent-models', 'intern=foo:1'], 'plo');
  f = path.join(x.work, '.pi', 'skills', 'five-role-team', 'pi', 'agents', 'intern.md');
  assert(x.r.exitCode === 0 && model(f) === 'foo:1', 'pi local: override honored');

  // (c) pi without intern: pi/ omitted (agents are installed only if selected)
  x = await run(['--local', '--harness', 'pi', '--agents', 'worker'], 'pn');
  assert(x.r.exitCode === 0 && !lst(path.join(x.work, '.pi', 'skills', 'five-role-team', 'pi')), 'pi without intern: no pi/ dir (pi agents are per-selection)');

  // (b) claude-code & custom path: no pi/
  x = await run(['--global', '--harness', 'claude-code', '--agents', 'worker'], 'cc');
  assert(x.r.exitCode === 0 && !lst(path.join(x.home, '.claude', 'skills', 'five-role-team', 'pi')), 'claude-code global: no pi/');
  x = await run(['--local', '--harness', 'claude-code', '--agents', 'worker'], 'ccl');
  assert(x.r.exitCode === 0 && lst(path.join(x.work, '.claude', 'skills', 'five-role-team', 'SKILL.md')) && !lst(path.join(x.work, '.claude', 'skills', 'five-role-team', 'pi')), 'claude-code local: no pi/');
  const custom = path.join(tmpRoot, 'customdest');
  x = await run(['--global', '--harness', custom, '--agents', 'worker'], 'cu');
  assert(x.r.exitCode === 0 && lst(path.join(custom, 'five-role-team', 'SKILL.md')) && !lst(path.join(custom, 'five-role-team', 'pi')), 'custom path: no pi/');

  // (d) --link on pi exposes pi/ through linked dir
  x = await run(['--global', '--harness', 'pi', '--agents', 'intern', '--link'], 'lk');
  assert(x.r.exitCode === 0 && fs.existsSync(path.join(x.home, '.claude', 'skills', 'five-role-team', 'pi', 'agents', 'intern.md')) &&
    fs.existsSync(path.join(x.home, '.pi', 'agent', 'skills', 'five-role-team', 'pi', 'agents', 'intern.md')), 'pi --link: pi/agents/intern.md visible via primary and secondary');

  // (e) intern + claude-code: clean error, no partial install
  for (const [scope, nm] of [['--global', 'ie1'], ['--local', 'ie2']]) {
    x = await run([scope, '--harness', 'claude-code', '--agents', 'worker,intern'], nm);
    const dest = scope === '--global' ? path.join(x.home, '.claude') : path.join(x.work, '.claude');
    assert(x.r.exitCode !== 0 && /intern/i.test(x.err) && /pi/i.test(x.err), `intern + claude-code ${scope}: error mentions intern/pi`);
    assert(!lst(dest) && !lst(path.join(x.home, '.pi')), `intern + claude-code ${scope}: nothing installed`);
    assert(!/\n\s+at /.test(x.err), `intern + claude-code ${scope}: no stack trace`);
  }

  process.chdir(src);
  assert(snap() === before, 'real ~/.claude/skills and ~/.pi/agent/skills unchanged');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
