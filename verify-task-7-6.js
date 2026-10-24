#!/usr/bin/env node
'use strict';
// Verify task 7.6: `uninstall` with nothing installed exits 1 with a
// "Nothing to uninstall" message and removes nothing. Covered: global and local
// x claude-code and pi, a custom harness path, a fresh HOME with no skills dir,
// a pi secondary that is not ours, and a path whose parent is a regular file.
// A dangling symlink at the primary IS an installation and is removed (exit 0).
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
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-7-6-')));
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

// Sibling content that must survive every case: a skills dir with another plugin
// (two files of known sizes), and a stray file in the work folder.
function addSiblings(skillsDir, work) {
  const sib = path.join(skillsDir, 'other-plugin');
  fs.mkdirSync(sib, { recursive: true });
  fs.writeFileSync(path.join(sib, 'SKILL.md'), 'sibling skill\n');
  fs.writeFileSync(path.join(sib, 'data.txt'), 'x'.repeat(42));
  fs.writeFileSync(path.join(work, 'keep.txt'), 'keep me\n');
}

// A. Nothing installed: exit 1, "Nothing to uninstall" on stderr, both trees unchanged.
const NOTHING_CASES = [
  {
    name: 'global claude-code, skills dir with sibling',
    args: ['uninstall', '--global', '--harness', 'claude-code'],
    setup: (home, work) => addSiblings(path.join(home, '.claude', 'skills'), work),
  },
  {
    name: 'local claude-code, skills dir with sibling',
    args: ['uninstall', '--local', '--harness', 'claude-code'],
    setup: (home, work) => addSiblings(path.join(work, '.claude', 'skills'), work),
  },
  {
    name: 'global pi, both skills dirs with siblings',
    args: ['uninstall', '--global', '--harness', 'pi'],
    setup: (home, work) => {
      addSiblings(path.join(home, '.claude', 'skills'), work);
      addSiblings(path.join(home, '.pi', 'agent', 'skills'), work);
    },
  },
  {
    name: 'local pi, skills dir with sibling',
    args: ['uninstall', '--local', '--harness', 'pi'],
    setup: (home, work) => addSiblings(path.join(work, '.pi', 'skills'), work),
  },
  {
    name: 'custom harness path, skills dir with sibling',
    args: null, // filled in below: needs the scenario's work path
    setup: (home, work) => addSiblings(path.join(work, 'custom', 'skills'), work),
    customRel: path.join('custom', 'skills'),
  },
  {
    name: 'global claude-code, fresh HOME with no .claude at all',
    args: ['uninstall', '--global', '--harness', 'claude-code'],
    setup: () => {},
  },
  {
    name: 'global pi, secondary is a real dir that is not ours (primary absent)',
    args: ['uninstall', '--global', '--harness', 'pi'],
    setup: (home, work) => {
      addSiblings(path.join(home, '.claude', 'skills'), work);
      const real = path.join(home, '.pi', 'agent', 'skills', PLUGIN);
      fs.mkdirSync(real, { recursive: true });
      fs.writeFileSync(path.join(real, 'mine.txt'), 'user-owned\n');
    },
  },
  {
    name: 'custom harness path whose parent component is a regular file',
    args: null,
    setup: (home, work) => {
      fs.writeFileSync(path.join(work, 'afile'), 'not a directory\n');
      addSiblings(path.join(work, 'other', 'skills'), work);
    },
    customRel: path.join('afile', 'skills'),
  },
];

for (const c of NOTHING_CASES) {
  const tag = c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const { home, work } = resetScenario(`nothing-${tag}`);
  c.setup(home, work);
  const args = c.args || ['uninstall', '--harness', path.join(work, c.customRel)];
  if (!c.args) args.splice(1, 0, '--global'); // scope is ignored for an explicit path
  const before = { home: snapshot(home), work: snapshot(work) };

  const r = cli(args, home, work);
  assert(r.status === 1, `nothing [${c.name}]: exit code 1 (got ${r.status})`);
  assert(/Nothing to uninstall/.test(r.err), `nothing [${c.name}]: "Nothing to uninstall" on stderr (stderr: ${JSON.stringify(r.err.trim())})`);
  assert(JSON.stringify(snapshot(home)) === JSON.stringify(before.home), `nothing [${c.name}]: HOME tree unchanged`);
  assert(JSON.stringify(snapshot(work)) === JSON.stringify(before.work), `nothing [${c.name}]: work tree unchanged`);
}

// B. A dangling symlink at the primary IS an installation: removed, exit 0,
// the missing target is not created, and the sibling plugin is untouched.
{
  const { home, work } = resetScenario('dangling-primary');
  const skills = path.join(home, '.claude', 'skills');
  addSiblings(skills, work);
  const primary = path.join(skills, PLUGIN);
  const missing = path.join(home, 'nowhere', PLUGIN);
  fs.symlinkSync(missing, primary);
  const before = snapshot(home).filter(e => !e.startsWith(`.claude/skills/${PLUGIN}:`));
  const r = cli(['uninstall', '--global', '--harness', 'claude-code'], home, work);
  assert(r.status === 0, `dangling primary: exit code 0 (got ${r.status}; ${r.text.trim()})`);
  assert(lst(primary) === undefined, 'dangling primary: broken symlink removed');
  assert(lst(missing) === undefined, 'dangling primary: missing target not created');
  assert(JSON.stringify(snapshot(home)) === JSON.stringify(before), 'dangling primary: sibling plugin and other HOME entries unchanged');
}

// C. Pi with the primary missing but a dangling ~/.pi secondary pointing at it.
// The current code removes that stale secondary (exit 0, reported). This is an
// OPEN QUESTION against the spec scenario (nothing installed => exit 1); the check
// below records the current behavior and that the leftover is not silent.
{
  const { home, work } = resetScenario('pi-stale-secondary');
  addSiblings(path.join(home, '.claude', 'skills'), work);
  const secondaryDir = path.join(home, '.pi', 'agent', 'skills');
  fs.mkdirSync(secondaryDir, { recursive: true });
  const secondary = path.join(secondaryDir, PLUGIN);
  fs.symlinkSync(path.join(home, '.claude', 'skills', PLUGIN), secondary);
  fs.mkdirSync(path.join(secondaryDir, 'other-plugin'));
  const r = cli(['uninstall', '--global', '--harness', 'pi'], home, work);
  console.log(`INFO: pi stale secondary: exit ${r.status}, output: ${JSON.stringify(r.text.trim())}`);
  assert(lst(secondary) === undefined || r.status === 1, 'pi stale secondary: either removed or refused with exit 1 (not silently left at exit 0)');
  assert(lst(path.join(secondaryDir, 'other-plugin')) !== undefined, 'pi stale secondary: sibling in ~/.pi skills dir untouched');
  assert(lst(path.join(home, '.claude', 'skills', 'other-plugin', 'data.txt')) !== undefined, 'pi stale secondary: sibling in ~/.claude skills dir untouched');
}

assert(REAL_CONFIG_BEFORE === fs.existsSync(path.join(SRC, CFG)), 'source checkout: no .agent-config.json created or removed in the repo');

fs.rmSync(TMP_ROOT, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 7.6 checks passed');
