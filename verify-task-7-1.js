#!/usr/bin/env node
'use strict';
// Verify task 7.1: the `uninstall` subcommand detects a copy install (real
// directory) vs a symlink install (--link) and removes each correctly, for
// global and local scope with the claude-code harness.
//
// A symlink install removes only the link; the source checkout is untouched.
// A copy install removes the directory. Pi dual-location cleanup (7.2), the
// parent-directory check (7.3) and the nothing-installed message wording (7.6)
// are covered by their own tasks.
//
// SANDBOXED ONLY. This script:
//   - captures the real home directory, then points HOME/USERPROFILE at a fresh
//     temp directory and chdirs into a temp work folder before anything else;
//   - aborts (exit 2, nothing removed) if HOME ever resolves to the real home;
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
const REAL_HOME = fs.realpathSync(os.homedir());

// 2. Create the sandbox and point HOME/cwd at it.
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-7-1-')));
const SANDBOX_HOME = path.join(TMP_ROOT, 'home');
const SANDBOX_WORK = path.join(TMP_ROOT, 'work');
fs.mkdirSync(SANDBOX_HOME, { recursive: true });
fs.mkdirSync(SANDBOX_WORK, { recursive: true });
process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;
process.chdir(SANDBOX_WORK);

// 3. Guard: refuse to run if HOME resolves to the real home or the cwd is not the sandbox.
function assertSandboxed() {
  const resolvedHome = fs.realpathSync(os.homedir());
  const resolvedCwd = fs.realpathSync(process.cwd());
  const inTmp = (p) => p === TMP_ROOT || p.startsWith(TMP_ROOT + path.sep);
  if (resolvedHome === REAL_HOME || !inTmp(resolvedHome) || !inTmp(resolvedCwd)) {
    console.error(`ABORT: sandbox guard tripped (home=${resolvedHome}, cwd=${resolvedCwd}, realHome=${REAL_HOME}). Nothing was removed.`);
    process.exit(2);
  }
}
assertSandboxed();

const REAL_CONFIG_BEFORE = fs.existsSync(path.join(SRC, CFG));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('OK:', msg);
}
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

// Run the real CLI entry point as a child process, sandboxed by env and cwd.
function cli(args, cwd = SANDBOX_WORK) {
  assertSandboxed();
  const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), ...args], {
    cwd,
    env: { ...process.env, HOME: SANDBOX_HOME, USERPROFILE: SANDBOX_HOME },
    input: '', // no TTY and no stdin: any unexpected prompt cannot be answered
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  return { status: r.status, out, err, text: out + err };
}

// Fresh sandbox homes/work folders per scenario so runs cannot interact.
function resetScenario(name) {
  const home = path.join(TMP_ROOT, name, 'home');
  const work = path.join(TMP_ROOT, name, 'work');
  fs.rmSync(path.join(TMP_ROOT, name), { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  return { home, work };
}

// Install via the CLI with the sandbox HOME of this scenario. Non-interactive
// (--agents with no prompts), so this only sets up the state to uninstall.
function install(home, work, scope, extra) {
  const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), scope, '--harness', 'claude-code', '--agents', 'architect,worker', ...extra], {
    cwd: work,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input: '',
    encoding: 'utf8',
    timeout: 60000,
  });
  return r;
}

function uninstall(home, work, scope) {
  assertSandboxed();
  const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), 'uninstall', scope, '--harness', 'claude-code'], {
    cwd: work,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input: '',
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  return { status: r.status, out, err, text: out + err };
}

try {
  // A. Global claude-code, copy install.
  {
    const { home, work } = resetScenario('global-copy');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const inst = install(home, work, '--global', ['--agent-models', 'architect=opus,worker=haiku']);
    assert(inst.status === 0, `setup: global copy install exits 0 (got ${inst.status}; ${inst.stderr})`);
    assert(lst(primary) && lst(primary).isDirectory() && !lst(primary).isSymbolicLink(), 'setup: primary is a real directory (copy)');
    assert(fs.existsSync(path.join(primary, CFG)), 'setup: .agent-config.json written inside the copy');

    // A symlink inside the copy that points outside must be unlinked, never followed.
    const victimDir = path.join(home, 'outside');
    fs.mkdirSync(victimDir, { recursive: true });
    const victim = path.join(victimDir, 'keep.txt');
    fs.writeFileSync(victim, 'keep me\n');
    fs.symlinkSync(victim, path.join(primary, 'agents', 'stray-link.md'));

    const un = uninstall(home, work, '--global');
    assert(un.status === 0, `global copy: uninstall subcommand exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'global copy: ~/.claude/skills/five-role-team directory removed');
    assert(/Removed installation at/.test(un.out), 'global copy: success message names the installation');
    assert(fs.existsSync(path.join(home, '.claude', 'skills')), 'global copy: parent skills directory left in place');
    assert(fs.existsSync(victim) && fs.readFileSync(victim, 'utf8') === 'keep me\n', 'global copy: symlink target outside the copy was not followed or removed');
  }

  // B. Global claude-code, symlink install (--link).
  {
    const { home, work } = resetScenario('global-link');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const srcSkill = path.join(SRC, 'SKILL.md');
    const srcAgent = path.join(SRC, 'agents', 'worker.md');
    const skillBefore = fs.readFileSync(srcSkill, 'utf8');
    const agentBefore = fs.readFileSync(srcAgent, 'utf8');
    const inst = install(home, work, '--global', ['--link', '--agent-models', 'architect=opus,worker=haiku']);
    assert(inst.status === 0, `setup: global symlink install exits 0 (got ${inst.status}; ${inst.stderr})`);
    assert(lst(primary) && lst(primary).isSymbolicLink(), 'setup: primary is a symlink (--link)');

    const un = uninstall(home, work, '--global');
    assert(un.status === 0, `global symlink: uninstall subcommand exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'global symlink: the link is removed');
    assert(fs.existsSync(srcSkill) && fs.readFileSync(srcSkill, 'utf8') === skillBefore, 'global symlink: source SKILL.md still present and unchanged');
    assert(fs.readFileSync(srcAgent, 'utf8') === agentBefore, 'global symlink: source agents/worker.md unchanged');
    assert(/Source directory .* was left untouched/.test(un.out), 'global symlink: message says the source was left untouched');
  }

  // C. Local claude-code, copy install.
  {
    const { home, work } = resetScenario('local-copy');
    const primary = path.join(work, '.claude', 'skills', PLUGIN);
    const inst = install(home, work, '--local', ['--agent-models', 'architect=opus,worker=haiku']);
    assert(inst.status === 0 && fs.existsSync(path.join(primary, CFG)), 'setup: local copy install written with config');

    const un = uninstall(home, work, '--local');
    assert(un.status === 0, `local copy: uninstall subcommand exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'local copy: ./.claude/skills/five-role-team removed');
  }

  // D. Local claude-code, symlink install (--link).
  {
    const { home, work } = resetScenario('local-link');
    const primary = path.join(work, '.claude', 'skills', PLUGIN);
    const inst = install(home, work, '--local', ['--link', '--agent-models', 'architect=opus,worker=haiku']);
    assert(inst.status === 0 && lst(primary) && lst(primary).isSymbolicLink(), 'setup: local symlink install written');

    const un = uninstall(home, work, '--local');
    assert(un.status === 0, `local symlink: uninstall subcommand exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'local symlink: the link is removed');
    assert(fs.existsSync(path.join(SRC, 'SKILL.md')), 'local symlink: source checkout untouched');
  }

  // E. Symlink install points at a directory holding a config file: the cleanup
  //    list must not be applied through the link (only copy installs are cleaned).
  {
    const { home, work } = resetScenario('link-target-sentinel');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const elsewhere = path.join(TMP_ROOT, 'link-target-sentinel', 'elsewhere', PLUGIN);
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'SKILL.md'), 'skill\n');
    fs.writeFileSync(path.join(elsewhere, CFG), '{"sentinel":true}\n');
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.symlinkSync(elsewhere, primary);

    const un = uninstall(home, work, '--global');
    assert(un.status === 0, `symlink to outside dir: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'symlink to outside dir: link removed');
    assert(fs.existsSync(path.join(elsewhere, CFG)) && fs.existsSync(path.join(elsewhere, 'SKILL.md')), 'symlink to outside dir: target directory and its config untouched');
  }

  // F. Nothing installed: non-zero exit, nothing created.
  {
    const { home, work } = resetScenario('absent');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const un = uninstall(home, work, '--global');
    assert(un.status === 1, `absent install: exit code 1 (got ${un.status})`);
    assert(/Error: Nothing to uninstall/.test(un.err), 'absent install: error names "Nothing to uninstall"');
    assert(lst(primary) === undefined && !fs.existsSync(path.join(home, '.claude')), 'absent install: nothing created');
  }

  // G. A regular file at the plugin path is refused and kept.
  {
    const { home, work } = resetScenario('regular-file');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(primary, 'not ours\n');
    const un = uninstall(home, work, '--global');
    assert(un.status === 1 && /not a directory or symlink/.test(un.err), 'regular file: refused with error, exit 1');
    assert(fs.readFileSync(primary, 'utf8') === 'not ours\n', 'regular file: kept untouched');
  }

  // H. The old --uninstall flag is rejected (not silently turned into an install).
  {
    const { home, work } = resetScenario('old-flag');
    const primary = path.join(home, '.claude', 'skills', PLUGIN);
    const inst = install(home, work, '--global', ['--agent-models', 'architect=opus,worker=haiku']);
    assert(inst.status === 0, 'setup: global copy install for old-flag check');
    const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), '--uninstall', '--global', '--harness', 'claude-code'], {
      cwd: work, env: { ...process.env, HOME: home, USERPROFILE: home }, input: '', encoding: 'utf8', timeout: 60000,
    });
    assert(r.status === 1 && /replaced by the uninstall subcommand/.test(r.stderr || ''), '--uninstall flag: rejected with exit 1');
    assert(lst(primary) && lst(primary).isDirectory(), '--uninstall flag: existing install left untouched');
  }

  // H2. `uninstall` anywhere but the first argument is rejected, not treated as
  //     an install (it must not start the install prompt or write anything).
  {
    const { home, work } = resetScenario('misplaced-uninstall');
    assertSandboxed();
    const r0 = spawnSync(process.execPath, [path.join(SRC, 'install.js'), '--global', '--harness', 'claude-code', 'uninstall'], {
      cwd: work, env: { ...process.env, HOME: home, USERPROFILE: home }, input: '', encoding: 'utf8', timeout: 60000,
    });
    const r = { status: r0.status, err: r0.stderr || '' };
    assert(r.status === 1 && /uninstall must be the first argument/.test(r.err), 'misplaced uninstall: rejected with exit 1');
    assert(!fs.existsSync(path.join(home, '.claude')), 'misplaced uninstall: nothing created in the sandbox HOME');
  }

  // I. Help text documents the subcommand and no longer lists the flag.
  {
    const r = cli(['--help']);
    assert(r.status === 0, '--help: exits 0');
    assert(/node install\.js uninstall --global\|--local --harness <name\|path>/.test(r.out), '--help: documents the uninstall subcommand');
    assert(!/--uninstall/.test(r.out), '--help: no longer mentions the --uninstall flag');
  }

  assert(REAL_CONFIG_BEFORE === fs.existsSync(path.join(SRC, CFG)), 'source checkout: no .agent-config.json created or removed in the repo');
} finally {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 7.1 checks passed');
