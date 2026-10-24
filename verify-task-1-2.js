#!/usr/bin/env node
'use strict';
// Verify task 1.2: the package can be packed, installed into an isolated global prefix,
// and run as `five-role-team` without touching the real home or global prefix.
//
//   - packs the tarball into the sandbox
//   - `npm install -g --prefix <tmp>` of the tarball
//   - `five-role-team --help` exits 0
//   - `five-role-team init --global --harness claude-code` with a temp HOME
//   - `five-role-team init --harness claude-code` from a temp project dir with temp HOME/cwd
//   - checks the plugin files landed in both cases
//
// Everything runs under verify-sandbox.js; the real home and global prefix are never touched.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const REPO_ROOT = __dirname;
const TIMEOUT_MS = 300000;

const sb = createSandbox();
let failed = 0;
function assert(c, m) {
  if (c) console.log('OK:', m);
  else { console.error('FAIL:', m); failed += 1; }
}

function runBin(bin, args, opts) {
  const o = opts || {};
  const env = { ...process.env, ...(o.env || {}), HOME: o.home, USERPROFILE: o.home };
  if (!env.PATH) env.PATH = process.env.PATH;
  const r = spawnSync(bin, args, {
    cwd: o.cwd,
    env,
    input: '',
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '' };
}

try {
  // 1. Pack the tarball into the sandbox.
  const packDir = path.join(sb.root, 'pack');
  fs.mkdirSync(packDir);
  const pack = spawnSync('npm', ['pack', '--pack-destination', packDir], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: sb.home, USERPROFILE: sb.home },
    input: '',
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  assert(pack.status === 0, `npm pack exits 0 (got ${pack.status})`);
  const tgzs = fs.readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
  assert(tgzs.length >= 1, `a .tgz tarball was produced (${tgzs.length} found)`);
  if (tgzs.length === 0) throw new Error('no tarball produced');
  const tarball = path.join(packDir, tgzs[tgzs.length - 1]);

  // 2. Install into an isolated global prefix.
  const prefix = path.join(sb.root, 'prefix');
  fs.mkdirSync(prefix);
  const inst = spawnSync('npm', ['install', '-g', '--prefix', prefix, tarball], {
    cwd: sb.root,
    env: { ...process.env, HOME: sb.home, USERPROFILE: sb.home },
    input: '',
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  assert(inst.status === 0, `npm install -g --prefix <tmp> exits 0 (got ${inst.status})`);

  const bin = path.join(prefix, 'bin', 'five-role-team');
  assert(fs.existsSync(bin), `five-role-team executable exists at ${bin}`);

  // 3. `five-role-team --help` prints usage and exits 0 (uses the isolated bin on PATH).
  const help = runBin(bin, ['--help'], { home: sb.home, cwd: sb.cwd });
  assert(help.status === 0, `five-role-team --help exits 0 (got ${help.status})`);
  assert(/Five-Role Team Plugin Installer/i.test(help.stdout + help.stderr),
    'five-role-team --help prints usage');

  // 4. Global install via the command.
  const gScn = sb.scenario('globalinit');
  const gCmd = runBin(bin, ['init', '--global', '--harness', 'claude-code'], {
    home: gScn.home, cwd: gScn.cwd,
  });
  assert(gCmd.status === 0, `five-role-team init --global --harness claude-code exits 0 (got ${gCmd.status})`);
  const gFile = path.join(gScn.home, '.claude', 'skills', 'five-role-team', 'SKILL.md');
  assert(fs.existsSync(gFile), `global init placed SKILL.md at ${gFile}`);

  // 5. Project (local) install via the command.
  const pScn = sb.scenario('projectinit');
  const pCmd = runBin(bin, ['init', '--harness', 'claude-code'], {
    home: pScn.home, cwd: pScn.cwd,
  });
  assert(pCmd.status === 0, `five-role-team init --harness claude-code exits 0 (got ${pCmd.status})`);
  const pFile = path.join(pScn.cwd, '.claude', 'skills', 'five-role-team', 'SKILL.md');
  assert(fs.existsSync(pFile), `project init placed SKILL.md at ${pFile}`);

} catch (err) {
  console.error('FAIL: unexpected error', err && err.message ? err.message : err);
  failed += 1;
} finally {
  sb.cleanup();
  if (fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
  else console.log('OK: sandbox root removed by cleanup');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nAll task 1.2 checks passed');
  process.exitCode = 0;
}
