#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-5-'));
const fakeHome = path.join(tmpRoot, 'home');
const work = path.join(tmpRoot, 'work');
fs.mkdirSync(fakeHome); fs.mkdirSync(work);
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
const src = __dirname;
process.chdir(work);

const { main } = require(path.join(src, 'install.js'));
const { copyInstall, buildInstallSet, linkInstall } = require(path.join(src, 'install-files.js'));

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
async function run(argv) {
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl: async () => { throw new Error('prompted'); }, log: (m) => out.push(m), error: (m) => err.push(m) });
  return { r, out: out.join('\n'), err: err.join('\n') };
}
const read = (p) => fs.readFileSync(p, 'utf8');
function fmModel(content) { const m = content.match(/^---\r?\n[\s\S]*?^model:[ \t]*(.*?)[ \t]*$/m); return m && m[1].replace(/^(['"])(.*)\1$/, '$2'); }
function listFiles(dir, rel = '') {
  let out = [];
  for (const n of fs.readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? rel + '/' + n : n;
    if (fs.statSync(path.join(dir, r)).isDirectory()) out = out.concat(listFiles(dir, r)); else out.push(r);
  }
  return out;
}

(async () => {
  // claude-code local: selected agents only, model overrides
  let x = await run(['--local', '--harness', 'claude-code', '--agents', 'worker,reviewer', '--agent-models', 'worker=sonnet']);
  const t = path.join(work, '.claude', 'skills', 'five-role-team');
  assert(x.r.exitCode === 0 && !x.err, 'claude-code local: exit 0, no errors');
  assert(fs.existsSync(path.join(t, 'agents', 'worker.md')) && fs.existsSync(path.join(t, 'agents', 'reviewer.md')), 'selected agents copied');
  assert(!fs.existsSync(path.join(t, 'agents', 'architect.md')) && !fs.existsSync(path.join(t, 'agents', 'supervisor.md')), 'unselected agents absent');
  assert(!fs.existsSync(path.join(t, 'pi')), 'claude-code: no pi/ directory (intern excluded)');
  assert(fmModel(read(path.join(t, 'agents', 'worker.md'))) === 'anthropic/claude-sonnet-4-20250514', 'worker model updated per config');
  assert(fmModel(read(path.join(t, 'agents', 'reviewer.md'))) === 'anthropic/claude-sonnet-4-20250514', 'reviewer gets its (expanded) source default model');
  const srcWorker = read(path.join(src, 'agents', 'worker.md'));
  const instWorker = read(path.join(t, 'agents', 'worker.md'));
  assert(instWorker.split('\n').slice(0).filter((l) => !/^model:/.test(l)).join('\n') === srcWorker.split('\n').filter((l) => !/^model:/.test(l)).join('\n'), 'worker differs from source only in model line');
  for (const f of ['SKILL.md', '.claude-plugin/plugin.json']) {
    assert(Buffer.compare(fs.readFileSync(path.join(t, f)), fs.readFileSync(path.join(src, f))) === 0, `byte-identical: ${f}`);
  }
  const set = buildInstallSet(src, ['worker', 'reviewer'], 'claude-code');
  const expected = set.filter((e) => e.type === 'file').map((e) => e.path).sort();
  assert(JSON.stringify(listFiles(t)) === JSON.stringify(expected), 'installed file list equals install set');
  for (const f of expected.filter((p) => !/^agents\//.test(p))) {
    if (Buffer.compare(fs.readFileSync(path.join(t, f)), fs.readFileSync(path.join(src, f))) !== 0) assert(false, 'not byte-identical: ' + f);
  }
  assert(!fs.existsSync(path.join(t, 'openspec')) && !fs.existsSync(path.join(t, 'install.js')), 'dev files not installed');

  // pi local with intern
  x = await run(['--local', '--harness', 'pi', '--agents', 'worker,intern']);
  const tp = path.join(work, '.pi', 'skills', 'five-role-team');
  assert(x.r.exitCode === 0, 'pi local: exit 0');
  assert(fs.existsSync(path.join(tp, 'pi', 'agents', 'intern.md')), 'pi: intern copied');
  assert(fmModel(read(path.join(tp, 'pi', 'agents', 'intern.md'))) === 'qwen3.5:4b-mlx', 'pi: intern model from config');
  assert(!fs.existsSync(path.join(tp, 'agents', 'reviewer.md')), 'pi: unselected reviewer absent');

  // claude-code with intern requested: rejected
  x = await run(['--local', '--harness', 'claude-code', '--agents', 'intern']);
  assert(x.r.exitCode === 1 && /^Error: /m.test(x.err), 'claude-code + intern: clean error');

  // custom path harness, global flag, nested missing dirs
  const custom = path.join(tmpRoot, 'a', 'b', 'skills');
  x = await run(['--global', '--harness', custom, '--agents', 'architect']);
  assert(x.r.exitCode === 0 && fs.existsSync(path.join(custom, 'five-role-team', 'agents', 'architect.md')), 'custom path: missing parents created, files copied');

  // --link (implemented in 5.6): creates a symlink, not a copy
  const linkPath = path.join(tmpRoot, 'linkdir');
  x = await run(['--global', '--harness', linkPath, '--agents', 'architect', '--link']);
  assert(x.r.exitCode === 0 && fs.lstatSync(path.join(linkPath, 'five-role-team')).isSymbolicLink(), '--link: creates symlink (5.6)');
  assert(!fs.existsSync(path.join(linkPath, 'five-role-team', 'agents', 'worker.md.copied')), '--link: nothing copied');

  // errors surfaced cleanly: target parent is a file
  const blocker = path.join(tmpRoot, 'blocker'); fs.writeFileSync(blocker, 'x');
  x = await run(['--global', '--harness', path.join(blocker, 'skills'), '--agents', 'architect']);
  assert(x.r.exitCode === 1 && /^Error: /m.test(x.err) && !/\n\s+at /.test(x.err), 'invalid target: Error: message, exit 1');
  // copyInstall errors
  let msg = ''; try { copyInstall(src, src, [], {}); } catch (e) { msg = e.message; }
  assert(/source directory/.test(msg), 'copyInstall refuses target == source');
  msg = ''; try { copyInstall(src, path.join(tmpRoot, 'z'), [{ path: 'agents/worker.md', type: 'file' }], {}); } catch (e) { msg = e.message; }
  assert(/No model configured for agent worker/.test(msg), 'copyInstall: missing model error');
  msg = ''; try { copyInstall(src, path.join(tmpRoot, 'z'), [{ path: 'nope.txt', type: 'file' }], {}); } catch (e) { msg = e.message; }
  assert(/^Copy installation failed: /.test(msg), 'copyInstall: fs failure wrapped');

  // Real CLI run in temp cwd with temp HOME
  const p = spawnSync('node', [path.join(src, 'install.js'), '--local', '--harness', 'claude-code', '--agents', 'supervisor', '--force'], { encoding: 'utf8', cwd: work }); // --force: earlier runs already installed here (5.9)
  assert(p.status === 0 && fs.existsSync(path.join(t, 'agents', 'supervisor.md')), 'CLI: copy install exit 0');
  const q = spawnSync('node', [path.join(src, 'install.js'), '--local', '--harness', 'claude-code', '--agents', 'supervisor', '--link'], { encoding: 'utf8', cwd: work });
  // 5.9: without --force and non-TTY stdin the overwrite is declined (exit 0, nothing changed); linkInstall's own safety net still errors
  assert(q.status === 0 && /cancelled/i.test(q.stdout) && fs.lstatSync(t).isDirectory(), 'CLI --link onto existing target: declined, unchanged');
  let le = ''; try { linkInstall(src, t); } catch (e) { le = e.message; }
  assert(/already exists/.test(le), 'linkInstall onto existing target: already exists error');

  assert(!fs.existsSync(path.join(fakeHome, '.claude')), 'fake home .claude untouched by local/custom installs');
  process.exit(failed ? 1 : 0);
})();
