#!/usr/bin/env node
'use strict';
// Verify task 7.2: `uninstall --harness pi` removes the primary installation AND
// the pi secondary symlink (~/.pi/agent/skills/five-role-team) for global copy and
// global link installs, handles a dangling secondary, leaves a secondary that is
// not our symlink alone (with a warning), and leaves claude-code uninstall
// unaffected by any pi secondary. Pi local has no secondary (resolveHarnessPath
// returns none for local scope), so it only removes the local primary.
//
// Covered by their own tasks: parent-directory check (7.3), config removal tests
// (7.4), --uninstall rejection (7.5), nothing-installed wording (7.6).
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
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-7-2-')));
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

// Run the CLI as a child process with the given sandbox HOME and cwd. Input is
// empty so an unexpected prompt cannot be answered.
function run(home, work, args) {
  assertSandboxed();
  const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), ...args], {
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

// Fresh sandbox home/work folders per scenario so runs cannot interact.
function resetScenario(name) {
  const home = path.join(TMP_ROOT, name, 'home');
  const work = path.join(TMP_ROOT, name, 'work');
  fs.rmSync(path.join(TMP_ROOT, name), { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  return { home, work };
}

// Install via the CLI (non-interactive: --agents, so no prompts) to set up state.
function install(home, work, scope, harness, extra = []) {
  return run(home, work, [scope, '--harness', harness, '--agents', 'architect,worker', ...extra]);
}

function uninstall(home, work, scope, harness) {
  return run(home, work, ['uninstall', scope, '--harness', harness]);
}

// Global pi locations inside a sandbox home.
const pathsFor = (home) => ({
  primary: path.join(home, '.claude', 'skills', PLUGIN),
  secondary: path.join(home, '.pi', 'agent', 'skills', PLUGIN),
  piSkills: path.join(home, '.pi', 'agent', 'skills'),
});

try {
  // A. Global pi, copy install: primary directory and secondary symlink both removed.
  {
    const { home, work } = resetScenario('pi-global-copy');
    const { primary, secondary, piSkills } = pathsFor(home);
    const inst = install(home, work, '--global', 'pi');
    assert(inst.status === 0, `setup: global pi copy install exits 0 (got ${inst.status}; ${inst.err})`);
    assert(lst(primary) && lst(primary).isDirectory() && !lst(primary).isSymbolicLink(), 'setup: primary is a real directory (copy)');
    assert(lst(secondary) && lst(secondary).isSymbolicLink() && path.resolve(path.dirname(secondary), fs.readlinkSync(secondary)) === path.resolve(primary), 'setup: secondary is a symlink to the primary');

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 0, `pi global copy: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'pi global copy: primary ~/.claude/skills/five-role-team removed');
    assert(lst(secondary) === undefined, 'pi global copy: secondary ~/.pi/agent/skills/five-role-team symlink removed');
    assert(/Removed installation at/.test(un.out), 'pi global copy: success message names the primary installation');
    assert(/Removed pi secondary symlink/.test(un.out), 'pi global copy: success message names the removed secondary symlink');
    assert(fs.existsSync(piSkills), 'pi global copy: ~/.pi/agent/skills directory itself kept (only the link removed)');
    assert(!/not removed by this uninstall step/.test(un.text), 'pi global copy: temporary 7.1 "not removed" note is gone');
  }

  // B. Global pi, symlink install (--link): both links removed, source untouched.
  {
    const { home, work } = resetScenario('pi-global-link');
    const { primary, secondary } = pathsFor(home);
    const srcSkill = path.join(SRC, 'SKILL.md');
    const skillBefore = fs.readFileSync(srcSkill, 'utf8');
    const inst = install(home, work, '--global', 'pi', ['--link']);
    assert(inst.status === 0, `setup: global pi link install exits 0 (got ${inst.status}; ${inst.err})`);
    assert(lst(primary) && lst(primary).isSymbolicLink(), 'setup: primary is a symlink (--link)');
    assert(lst(secondary) && lst(secondary).isSymbolicLink(), 'setup: secondary is a symlink');

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 0, `pi global link: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'pi global link: primary link removed');
    assert(lst(secondary) === undefined, 'pi global link: secondary link removed');
    assert(fs.existsSync(srcSkill) && fs.readFileSync(srcSkill, 'utf8') === skillBefore, 'pi global link: source SKILL.md still present and unchanged');
  }

  // C. Local pi (copy and link): only the local primary exists; no secondary is
  //    resolved for local scope, so nothing under ~/.pi is touched.
  for (const mode of ['copy', 'link']) {
    const { home, work } = resetScenario(`pi-local-${mode}`);
    const primary = path.join(work, '.pi', 'skills', PLUGIN);
    const extra = mode === 'link' ? ['--link'] : [];
    const inst = install(home, work, '--local', 'pi', extra);
    assert(inst.status === 0 && lst(primary), `setup: local pi ${mode} install exits 0 with ./.pi/skills/five-role-team (got ${inst.status}; ${inst.err})`);

    const un = uninstall(home, work, '--local', 'pi');
    assert(un.status === 0, `pi local ${mode}: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, `pi local ${mode}: ./.pi/skills/five-role-team removed`);
    assert(!/pi secondary/.test(un.text), `pi local ${mode}: no pi secondary handling reported`);
    assert(!lst(path.join(home, '.pi')), `pi local ${mode}: nothing created or removed under the sandbox ~/.pi`);
    if (mode === 'link') {
      assert(fs.existsSync(path.join(SRC, 'SKILL.md')), 'pi local link: source checkout untouched');
    }
  }

  // D. The secondary is a real directory (or a regular file) that is not our
  //    symlink: it is left alone, the primary is still removed, a warning is shown.
  for (const kind of ['directory', 'file']) {
    const { home, work } = resetScenario(`pi-secondary-real-${kind}`);
    const { primary, secondary } = pathsFor(home);
    const inst = install(home, work, '--global', 'pi');
    assert(inst.status === 0, `setup: pi global install for real-${kind} secondary check exits 0 (got ${inst.status})`);
    fs.unlinkSync(secondary);
    if (kind === 'directory') {
      fs.mkdirSync(secondary, { recursive: true });
      fs.writeFileSync(path.join(secondary, 'keep.txt'), 'keep me\n');
    } else {
      fs.writeFileSync(secondary, 'keep me\n');
    }

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 0, `secondary real ${kind}: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, `secondary real ${kind}: primary removed`);
    assert(lst(secondary) && !lst(secondary).isSymbolicLink(), `secondary real ${kind}: left in place and not turned into or removed as a symlink`);
    if (kind === 'directory') {
      assert(fs.readFileSync(path.join(secondary, 'keep.txt'), 'utf8') === 'keep me\n', 'secondary real directory: its contents untouched');
    } else {
      assert(fs.readFileSync(secondary, 'utf8') === 'keep me\n', 'secondary real file: contents untouched');
    }
    assert(/Warning: left .* in place because it is not a symlink/.test(un.out), `secondary real ${kind}: warning shown`);
  }

  // E. Dangling secondary: the primary was already deleted, so the secondary link
  //    points at nothing. It is ours (it points at the primary path) and is removed.
  {
    const { home, work } = resetScenario('pi-dangling-secondary');
    const { primary, secondary } = pathsFor(home);
    const inst = install(home, work, '--global', 'pi');
    assert(inst.status === 0, 'setup: pi global copy install for dangling check exits 0');
    fs.rmSync(primary, { recursive: true, force: true });
    assert(lst(secondary) && lst(secondary).isSymbolicLink() && !fs.existsSync(secondary), 'setup: secondary now dangles');

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 0, `dangling secondary: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(secondary) === undefined, 'dangling secondary: dangling symlink removed');
    assert(/Removed pi secondary symlink/.test(un.out), 'dangling secondary: success message names the removed symlink');
    assert(!/Nothing to uninstall/.test(un.text), 'dangling secondary: not reported as nothing to uninstall');
  }

  // E2. Dangling secondary that points somewhere else is not ours: left alone,
  //     and with no primary either there is nothing to uninstall (exit 1).
  {
    const { home, work } = resetScenario('pi-dangling-foreign');
    const { primary, secondary, piSkills } = pathsFor(home);
    fs.mkdirSync(piSkills, { recursive: true });
    const foreign = path.join(home, 'elsewhere', PLUGIN);
    fs.symlinkSync(foreign, secondary, 'dir');
    assert(!fs.existsSync(primary) && lst(secondary) && !fs.existsSync(secondary), 'setup: foreign dangling secondary and no primary');

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 1 && /Error: Nothing to uninstall/.test(un.err), `foreign dangling secondary: nothing removed, exit 1 with "Nothing to uninstall" (got ${un.status}; ${un.text.trim()})`);
    assert(lst(secondary) && lst(secondary).isSymbolicLink() && fs.readlinkSync(secondary) === foreign, 'foreign dangling secondary: link kept');
    assert(/Warning: left .* in place because it links to/.test(un.out), 'foreign dangling secondary: warning shown');
  }

  // F. The secondary is a live symlink to some other directory: not ours, so the
  //    link and the directory it points at are both left alone.
  {
    const { home, work } = resetScenario('pi-secondary-foreign-live');
    const { primary, secondary } = pathsFor(home);
    const inst = install(home, work, '--global', 'pi');
    assert(inst.status === 0, 'setup: pi global install for foreign-live secondary check exits 0');
    fs.unlinkSync(secondary);
    const other = path.join(home, 'other', PLUGIN);
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, CFG), '{"sentinel":true}\n');
    fs.symlinkSync(other, secondary, 'dir');

    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 0, `foreign live secondary: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'foreign live secondary: primary removed');
    assert(lst(secondary) && lst(secondary).isSymbolicLink() && fs.readlinkSync(secondary) === other, 'foreign live secondary: link kept');
    assert(fs.readFileSync(path.join(other, CFG), 'utf8') === '{"sentinel":true}\n', 'foreign live secondary: target directory untouched');
  }

  // G. claude-code uninstall ignores the pi secondary even when one points at the primary.
  {
    const { home, work } = resetScenario('claude-code-unaffected');
    const { primary, secondary, piSkills } = pathsFor(home);
    const inst = install(home, work, '--global', 'claude-code');
    assert(inst.status === 0 && lst(primary), 'setup: global claude-code copy install exits 0');
    fs.mkdirSync(piSkills, { recursive: true });
    fs.symlinkSync(primary, secondary, 'dir');

    const un = uninstall(home, work, '--global', 'claude-code');
    assert(un.status === 0, `claude-code: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, 'claude-code: primary removed');
    assert(lst(secondary) && lst(secondary).isSymbolicLink(), 'claude-code: pi secondary symlink left untouched');
    assert(!/pi secondary/.test(un.text), 'claude-code: no pi secondary handling reported');
  }

  // H. Global pi with nothing installed (neither primary nor secondary): exit 1, nothing created.
  {
    const { home, work } = resetScenario('pi-absent');
    const { primary, secondary } = pathsFor(home);
    const un = uninstall(home, work, '--global', 'pi');
    assert(un.status === 1 && /Error: Nothing to uninstall/.test(un.err), `pi absent: exit 1 with "Nothing to uninstall" (got ${un.status})`);
    assert(lst(primary) === undefined && lst(secondary) === undefined && !fs.existsSync(path.join(home, '.claude')) && !fs.existsSync(path.join(home, '.pi')), 'pi absent: nothing created');
  }

  // I. The source checkout was never given a configuration file by any uninstall step.
  assert(REAL_CONFIG_BEFORE === fs.existsSync(path.join(SRC, CFG)), 'source checkout: no .agent-config.json created or removed in the repo');
} finally {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 7.2 checks passed');
