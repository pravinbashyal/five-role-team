#!/usr/bin/env node
'use strict';
// Verify task 7.5: the `--uninstall` flag is gone everywhere, so `uninstall` is
// only a subcommand. `--uninstall` is rejected as an unknown flag (exit 1) in
// every position, and removes nothing. The `uninstall` subcommand still works,
// known flags still parse, and --help documents the subcommand but not the flag.
//
// SANDBOXED ONLY. This script:
//   - captures the real home directory (os.userInfo), then points HOME/USERPROFILE
//     at a fresh temp directory and chdirs into a temp work folder before anything else;
//   - aborts (exit 2, nothing removed) if HOME or the cwd ever resolves outside the
//     temp root or to the real home;
//   - runs the CLI only as a child process with that sandboxed HOME and cwd.
// Nothing touches the real ~/.claude or ~/.pi.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = __dirname;
const PLUGIN = 'five-role-team';
const CFG = '.agent-config.json';

// 1. Capture the real home BEFORE HOME is changed.
const REAL_HOME = fs.realpathSync(os.userInfo().homedir);

// 2. Create the sandbox and point HOME/cwd at it.
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-7-5-')));
const SANDBOX_HOME = path.join(TMP_ROOT, 'home');
const SANDBOX_WORK = path.join(TMP_ROOT, 'work');
fs.mkdirSync(SANDBOX_HOME, { recursive: true });
fs.mkdirSync(SANDBOX_WORK, { recursive: true });
process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;
process.chdir(SANDBOX_WORK);

// 3. Guard: every home and cwd used for a run must resolve inside TMP_ROOT and
// must not be the real home. Called before every spawn and every removal.
const inTmp = (p) => p === TMP_ROOT || p.startsWith(TMP_ROOT + path.sep);
function assertSandboxed(home, work) {
  const resolvedHome = fs.realpathSync(home);
  const resolvedWork = fs.realpathSync(work);
  if (resolvedHome === REAL_HOME || !inTmp(resolvedHome) || !inTmp(resolvedWork)) {
    console.error(`ABORT: sandbox guard tripped (home=${resolvedHome}, work=${resolvedWork}, realHome=${REAL_HOME}). Nothing was removed.`);
    process.exit(2);
  }
}
assertSandboxed(SANDBOX_HOME, SANDBOX_WORK);

const REAL_CONFIG_BEFORE = fs.existsSync(path.join(SRC, CFG));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('OK:', msg);
}
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

// Run the real CLI entry point as a child process, sandboxed by env and cwd.
function cli(args, home, work) {
  assertSandboxed(home, work);
  const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), ...args], {
    cwd: work,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input: '', // no TTY and no stdin: any unexpected prompt cannot be answered
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  return { status: r.status, out, err, text: out + err };
}

// Fresh sandbox home/work folders per scenario so runs cannot interact.
function resetScenario(name) {
  const root = path.join(TMP_ROOT, name);
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  assertSandboxed(TMP_ROOT, TMP_ROOT);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  return { home, work };
}

// Non-interactive copy install (claude-code harness) in the given scope.
function install(home, work, scope, extra = []) {
  return cli([scope, '--harness', 'claude-code', '--agents', 'architect,worker',
    '--agent-models', 'architect=opus,worker=haiku', ...extra], home, work);
}

// The installed primary for a scope: global lives under HOME, local under the work folder.
const primaryFor = (scope, home, work) =>
  path.join(scope === '--local' ? work : home, '.claude', 'skills', PLUGIN);

// Flat, sorted listing of every entry under root (type and size), so a before/after
// comparison proves nothing was added, removed, or changed. Empty if root is absent.
function snapshot(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      const type = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file';
      entries.push(`${path.relative(root, p)}:${type}:${type === 'file' ? st.size : ''}`);
      if (type === 'dir') walk(p);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return entries;
}

// A. `--uninstall` is rejected as an unknown flag in every position, and nothing is removed.
const REJECT_CASES = [
  { name: 'alone', scope: '--global', args: ['--uninstall'] },
  { name: 'with --global --harness', scope: '--global', args: ['--uninstall', '--global', '--harness', 'claude-code'] },
  { name: 'after --global --harness', scope: '--global', args: ['--global', '--harness', 'claude-code', '--uninstall'] },
  { name: 'after the uninstall subcommand', scope: '--global', args: ['uninstall', '--global', '--harness', 'claude-code', '--uninstall'] },
  { name: 'before the uninstall subcommand', scope: '--global', args: ['--uninstall', 'uninstall', '--global', '--harness', 'claude-code'] },
  { name: 'with --local --harness', scope: '--local', args: ['--uninstall', '--local', '--harness', 'claude-code'] },
  { name: 'local, after the uninstall subcommand', scope: '--local', args: ['uninstall', '--local', '--harness', 'claude-code', '--uninstall'] },
];

for (const c of REJECT_CASES) {
  const { home, work } = resetScenario(`reject-${c.name.replace(/[^a-z0-9]+/gi, '-')}`);
  const inst = install(home, work, c.scope);
  const primary = primaryFor(c.scope, home, work);
  assert(inst.status === 0 && lst(primary) && lst(primary).isDirectory(),
    `reject [${c.name}]: setup copy install exists (${c.scope})`);
  const before = { home: snapshot(home), work: snapshot(work) };

  const r = cli(c.args, home, work);
  assert(r.status === 1, `reject [${c.name}]: exit code 1 (got ${r.status})`);
  assert(/Unknown flag: --uninstall/.test(r.err), `reject [${c.name}]: reported as unknown flag "--uninstall"`);
  assert(!/Nothing to uninstall/.test(r.text), `reject [${c.name}]: not treated as an uninstall`);
  assert(lst(primary) && lst(primary).isDirectory(), `reject [${c.name}]: install still exists`);
  assert(fs.existsSync(path.join(primary, CFG)), `reject [${c.name}]: install config still exists`);
  assert(JSON.stringify(snapshot(home)) === JSON.stringify(before.home), `reject [${c.name}]: HOME tree unchanged`);
  assert(JSON.stringify(snapshot(work)) === JSON.stringify(before.work), `reject [${c.name}]: work tree unchanged`);
}

// A2. A mistyped or bare positional token is rejected as an unknown argument (exit 1)
//     and removes nothing. Without this, `uninstal` would silently run an install.
const BARE_CASES = [
  { name: 'mistyped uninstal', args: ['uninstal', '--global', '--harness', 'claude-code'] },
  { name: 'bare remove', args: ['remove', '--global', '--harness', 'claude-code'] },
  { name: 'stray trailing positional', args: ['uninstall', '--global', '--harness', 'claude-code', 'extra'] },
];
for (const c of BARE_CASES) {
  const { home, work } = resetScenario(`bare-${c.name.replace(/[^a-z0-9]+/gi, '-')}`);
  const inst = install(home, work, '--global');
  const primary = primaryFor('--global', home, work);
  assert(inst.status === 0 && lst(primary) && lst(primary).isDirectory(),
    `bare [${c.name}]: setup copy install exists`);
  const before = { home: snapshot(home), work: snapshot(work) };

  const r = cli(c.args, home, work);
  assert(r.status === 1, `bare [${c.name}]: exit code 1 (got ${r.status})`);
  assert(/Unknown argument: /.test(r.err), `bare [${c.name}]: reported as unknown argument`);
  assert(lst(primary) && lst(primary).isDirectory(), `bare [${c.name}]: existing install still exists`);
  assert(fs.existsSync(path.join(primary, CFG)), `bare [${c.name}]: install config still exists`);
  assert(JSON.stringify(snapshot(home)) === JSON.stringify(before.home), `bare [${c.name}]: HOME tree unchanged`);
  assert(JSON.stringify(snapshot(work)) === JSON.stringify(before.work), `bare [${c.name}]: work tree unchanged`);
}

// B. The `uninstall` subcommand still works for global and local copy installs.
{
  const { home, work } = resetScenario('subcommand-global');
  const inst = install(home, work, '--global');
  assert(inst.status === 0, 'subcommand global: setup copy install');
  const primary = primaryFor('--global', home, work);
  const r = cli(['uninstall', '--global', '--harness', 'claude-code'], home, work);
  assert(r.status === 0, `subcommand global: exit code 0 (got ${r.status})`);
  assert(lst(primary) === undefined, 'subcommand global: primary install removed');
}
{
  const { home, work } = resetScenario('subcommand-local');
  const inst = install(home, work, '--local');
  assert(inst.status === 0, 'subcommand local: setup copy install');
  const primary = primaryFor('--local', home, work);
  // A known flag alongside the subcommand is still accepted (ignored for uninstall).
  const r = cli(['uninstall', '--local', '--harness', 'claude-code', '--force'], home, work);
  assert(r.status === 0, `subcommand local (with --force): exit code 0 (got ${r.status})`);
  assert(lst(primary) === undefined, 'subcommand local: primary install removed');
}

// C. Known install flags still parse (no regression from the unknown-flag rejection).
{
  const { home, work } = resetScenario('known-force');
  const r = install(home, work, '--global', ['--force']);
  assert(r.status === 0, `known flag --force: install exit code 0 (got ${r.status})`);
  assert(lst(primaryFor('--global', home, work)) !== undefined, 'known flag --force: install created');
}
{
  const { home, work } = resetScenario('known-link');
  const r = install(home, work, '--global', ['--link']);
  assert(r.status === 0, `known flag --link: install exit code 0 (got ${r.status})`);
  const p = primaryFor('--global', home, work);
  assert(lst(p) && lst(p).isSymbolicLink(), 'known flag --link: install created as a symlink');
}

// D. --help documents the uninstall subcommand and no longer mentions the flag.
{
  const { home, work } = resetScenario('help');
  const r = cli(['--help'], home, work);
  assert(r.status === 0, `--help: exits 0 (got ${r.status})`);
  assert(/node install\.js uninstall --global\|--local --harness <name\|path>/.test(r.out), '--help: documents the uninstall subcommand usage');
  assert(/^\s+uninstall\s+Remove the installed plugin/m.test(r.out), '--help: documents the uninstall subcommand entry');
  assert(!/--uninstall/.test(r.out), '--help: no longer mentions the --uninstall flag');
}

assert(REAL_CONFIG_BEFORE === fs.existsSync(path.join(SRC, CFG)), 'source checkout: no .agent-config.json created or removed in the repo');

fs.rmSync(TMP_ROOT, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 7.5 checks passed');
