#!/usr/bin/env node
'use strict';
// Verify task 7.4: `uninstall` removes `.agent-config.json` together with the
// installed plugin directory for copy installs, and never touches a config that
// lives in the source checkout for --link installs.
//
// Scenarios:
//   A. global claude-code copy: config written, uninstall removes it and the dir.
//   B. local claude-code copy: same, under ./.claude/skills.
//   C. global pi copy (dual location): config removed from the primary copy and
//      the ~/.pi/agent/skills/five-role-team symlink is removed too.
//   D. local pi copy: config and directory removed under ./.pi/skills.
//   E. global claude-code --link: no config is written by the install, and the
//      uninstall removes only the link.
//   F. global claude-code --link whose source holds a `.agent-config.json`: the
//      source config and the source files survive uninstall unchanged. A copy of
//      the plugin source is used for this so the real checkout is never written.
//
// Each copy-install scenario first proves the config is really present before
// uninstall, so a run that wrote nothing fails instead of passing vacuously.
//
// SANDBOXED ONLY. This script:
//   - captures the real home directory (os.userInfo) BEFORE HOME is changed;
//   - points HOME/USERPROFILE at a fresh temp directory and chdirs into a temp
//     work folder before anything else;
//   - aborts (exit 2, nothing removed) if HOME ever resolves to the real home;
//   - runs install.js / uninstall only as child processes with a sandboxed HOME
//     and cwd, checked again immediately before each spawn.
// Nothing touches the real ~/.claude or ~/.pi.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = __dirname;
const PLUGIN = 'five-role-team';
const CFG = '.agent-config.json';
const SENTINEL = '{"sentinel":"source-config-must-survive"}\n';

// 1. Capture the real home BEFORE HOME is changed.
const REAL_HOME = fs.realpathSync(os.userInfo().homedir);
const REAL_SRC_CFG_BEFORE = fs.existsSync(path.join(SRC, CFG));

// 2. Create the sandbox and point HOME/cwd at it.
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-7-4-')));
const SANDBOX_HOME = path.join(TMP_ROOT, 'home');
const SANDBOX_WORK = path.join(TMP_ROOT, 'work');
fs.mkdirSync(SANDBOX_HOME, { recursive: true });
fs.mkdirSync(SANDBOX_WORK, { recursive: true });
process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;
process.chdir(SANDBOX_WORK);

const inTmp = (p) => p === TMP_ROOT || p.startsWith(TMP_ROOT + path.sep);

// 3. Guard: refuse to run if HOME resolves to the real home or a path is outside the sandbox.
function assertSandboxedPath(home, work) {
  const resolvedHome = fs.realpathSync(home);
  const resolvedWork = fs.realpathSync(work);
  if (resolvedHome === REAL_HOME || !inTmp(resolvedHome) || !inTmp(resolvedWork)) {
    console.error(`ABORT: sandbox guard tripped (home=${resolvedHome}, work=${resolvedWork}, realHome=${REAL_HOME}). Nothing was removed.`);
    process.exit(2);
  }
}
function assertSandboxed() {
  assertSandboxedPath(os.homedir(), process.cwd());
}
assertSandboxed();

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('OK:', msg);
}
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

// Spawn the CLI as a child process with the given sandbox HOME and cwd.
// `script` is the install.js to run (defaults to this checkout's).
function run(args, home, work, script = path.join(SRC, 'install.js'), extraEnv = {}) {
  assertSandboxedPath(home, work);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: work,
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
    input: '', // no TTY and no stdin: any unexpected prompt cannot be answered
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  return { status: r.status, out, err, text: out + err };
}

// Fresh sandbox home/work per scenario so runs cannot interact.
function resetScenario(name) {
  const home = path.join(TMP_ROOT, name, 'home');
  const work = path.join(TMP_ROOT, name, 'work');
  fs.rmSync(path.join(TMP_ROOT, name), { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  return { home, work };
}

// Non-interactive install that writes the config (copy mode, explicit agents and models).
function install(home, work, scope, harness, extra = [], script) {
  return run([scope, '--harness', harness, '--agents', 'architect,worker', '--agent-models', 'architect=opus,worker=haiku', ...extra], home, work, script);
}

function uninstall(home, work, scope, harness, script, extraEnv = {}) {
  return run(['uninstall', scope, '--harness', harness], home, work, script, extraEnv);
}

// Checks that the config is a real file written by the installer (not a stray or empty file).
function assertInstallerConfig(file, label) {
  const st = lst(file);
  assert(!!st && st.isFile(), `${label}: ${CFG} is a regular file before uninstall`);
  if (!st || !st.isFile()) return;
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { parsed = null; }
  assert(parsed && Array.isArray(parsed.agents) && parsed.agents.includes('architect') && parsed.agents.includes('worker'),
    `${label}: ${CFG} holds the installer's agent list before uninstall`);
}

// Makes a sandboxed copy of the plugin source (installer + plugin files, no
// .git / openspec / verify scripts) so link installs can be checked against a
// source tree that this test is free to put a sentinel config into.
function makeSourceCopy(root, { withSentinel }) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const names = ['install.js', 'install-files.js', 'agent-config.js', 'configure-models.js',
    'select-agents.js', 'package.json', 'SKILL.md', '.claude-plugin', 'agents', 'pi', 'commands', 'conventions'];
  for (const name of names) {
    const from = path.join(SRC, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(root, name), { recursive: true });
  }
  if (withSentinel) fs.writeFileSync(path.join(root, CFG), SENTINEL);
  return root;
}

try {
  // A. Global claude-code, copy install.
  {
    const { home, work } = resetScenario('global-copy');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const inst = install(home, work, '--global', 'claude-code');
    assert(inst.status === 0, `setup: global copy install exits 0 (got ${inst.status}; ${inst.err.trim()})`);
    assert(lst(primary) && lst(primary).isDirectory() && !lst(primary).isSymbolicLink(), 'setup: primary is a real directory (copy)');
    assertInstallerConfig(path.join(primary, CFG), 'global copy');

    const un = uninstall(home, work, '--global', 'claude-code');
    assert(un.status === 0, `global copy: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(path.join(primary, CFG)) === undefined, `global copy: ${CFG} is deleted`);
    assert(lst(primary) === undefined, 'global copy: install directory is removed');
    assert(new RegExp(`Removed .*${CFG.replace(/\./g, '\\.')}`).test(un.out), 'global copy: output reports removal of the config file');
    assert(fs.existsSync(path.join(home, '.claude', 'skills')), 'global copy: parent skills directory left in place');
  }

  // B. Local claude-code, copy install.
  {
    const { home, work } = resetScenario('local-copy');
    const primary = path.join(work, '.claude', 'skills', PLUGIN);
    const inst = install(home, work, '--local', 'claude-code');
    assert(inst.status === 0, `setup: local copy install exits 0 (got ${inst.status}; ${inst.err.trim()})`);
    assertInstallerConfig(path.join(primary, CFG), 'local copy');

    const un = uninstall(home, work, '--local', 'claude-code');
    assert(un.status === 0, `local copy: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(path.join(primary, CFG)) === undefined, `local copy: ${CFG} is deleted`);
    assert(lst(primary) === undefined, 'local copy: ./.claude/skills/five-role-team is removed');
  }

  // C. Global pi, copy install (primary copy + ~/.pi/agent/skills symlink).
  {
    const { home, work } = resetScenario('global-pi-copy');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const secondary = path.join(home, '.pi', 'agent', 'skills', PLUGIN);
    const inst = install(home, work, '--global', 'pi');
    assert(inst.status === 0, `setup: global pi copy install exits 0 (got ${inst.status}; ${inst.err.trim()})`);
    assert(lst(secondary) && lst(secondary).isSymbolicLink(), 'setup: pi secondary is a symlink');
    assertInstallerConfig(path.join(primary, CFG), 'global pi copy (primary)');
    assert(fs.existsSync(path.join(secondary, CFG)), 'setup: config is visible through the pi secondary symlink');

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 0, `global pi copy: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(path.join(primary, CFG)) === undefined, `global pi copy: ${CFG} deleted from the primary copy`);
    assert(lst(primary) === undefined, 'global pi copy: primary install directory is removed');
    assert(lst(secondary) === undefined, 'global pi copy: pi secondary symlink is removed');
    assert(lst(path.join(secondary, CFG)) === undefined, 'global pi copy: config is gone from the pi location too');
  }

  // D. Local pi, copy install (no secondary for local scope).
  {
    const { home, work } = resetScenario('local-pi-copy');
    const primary = path.join(work, '.pi', 'skills', PLUGIN);
    const inst = install(home, work, '--local', 'pi');
    assert(inst.status === 0, `setup: local pi copy install exits 0 (got ${inst.status}; ${inst.err.trim()})`);
    assertInstallerConfig(path.join(primary, CFG), 'local pi copy');

    const un = uninstall(home, work, '--local', 'pi');
    assert(un.status === 0, `local pi copy: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(path.join(primary, CFG)) === undefined, `local pi copy: ${CFG} is deleted`);
    assert(lst(primary) === undefined, 'local pi copy: ./.pi/skills/five-role-team is removed');
  }

  // E. Global claude-code, --link install of this checkout: no config is written
  //    and uninstall removes only the link. Run from a sandboxed copy of the source
  //    so the real checkout is never linked into a path the test then removes.
  {
    const { home, work } = resetScenario('global-link');
    const srcCopy = makeSourceCopy(path.join(TMP_ROOT, 'global-link', 'source'), { withSentinel: false });
    const copyInstaller = path.join(srcCopy, 'install.js');
    const nodePath = { NODE_PATH: path.join(SRC, 'node_modules') };
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const inst = run(['--global', '--harness', 'claude-code', '--link', '--agents', 'architect,worker'], home, work, copyInstaller, nodePath);
    assert(inst.status === 0, `setup: global link install exits 0 (got ${inst.status}; ${inst.err.trim()})`);
    assert(lst(primary) && lst(primary).isSymbolicLink(), 'setup: primary is a symlink (--link)');
    assert(!fs.existsSync(path.join(srcCopy, CFG)), 'global link: install wrote no config into the source');
    assert(!fs.existsSync(path.join(primary, CFG)), 'global link: no config visible through the link');

    const un = uninstall(home, work, '--global', 'claude-code', copyInstaller, nodePath);
    assert(un.status === 0, `global link: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'global link: the link is removed');
    assert(fs.existsSync(path.join(srcCopy, 'SKILL.md')) && fs.existsSync(path.join(srcCopy, 'agents', 'worker.md')),
      'global link: source files untouched');
    assert(!fs.existsSync(path.join(srcCopy, CFG)), 'global link: no config created or removed in the source');
  }

  // F. Global claude-code, --link install whose source holds a .agent-config.json:
  //    uninstall must leave that source config (and the source) exactly as it was.
  {
    const { home, work } = resetScenario('global-link-sentinel');
    const srcCopy = makeSourceCopy(path.join(TMP_ROOT, 'global-link-sentinel', 'source'), { withSentinel: true });
    const copyInstaller = path.join(srcCopy, 'install.js');
    const nodePath = { NODE_PATH: path.join(SRC, 'node_modules') };
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const inst = run(['--global', '--harness', 'claude-code', '--link', '--agents', 'architect,worker'], home, work, copyInstaller, nodePath);
    assert(inst.status === 0, `setup: link install over a source with a config exits 0 (got ${inst.status}; ${inst.err.trim()})`);
    assert(lst(primary) && lst(primary).isSymbolicLink(), 'setup: primary is a symlink to the source copy');
    assert(fs.existsSync(path.join(primary, CFG)) && fs.readFileSync(path.join(srcCopy, CFG), 'utf8') === SENTINEL,
      'setup: source config is present before uninstall');

    const un = uninstall(home, work, '--global', 'claude-code', copyInstaller, nodePath);
    assert(un.status === 0, `link with source config: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'link with source config: the link is removed');
    assert(lst(path.join(srcCopy, CFG)) && fs.readFileSync(path.join(srcCopy, CFG), 'utf8') === SENTINEL,
      'link with source config: source .agent-config.json still present and unchanged');
    assert(fs.existsSync(path.join(srcCopy, 'SKILL.md')) && fs.existsSync(path.join(srcCopy, 'agents', 'worker.md')),
      'link with source config: source files untouched');
  }

  assert(REAL_SRC_CFG_BEFORE === fs.existsSync(path.join(SRC, CFG)),
    'checkout: no .agent-config.json created or removed in the real repo');
} finally {
  // Only remove the sandbox root this script created under the temp directory.
  if (inTmp(TMP_ROOT)) fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 7.4 checks passed');
