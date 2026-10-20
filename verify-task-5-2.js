#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-2-'));
const fakeHome = path.join(tmpRoot, 'home');
fs.mkdirSync(fakeHome);
// Redirect os.homedir() so ~/.claude and ~/.pi are never touched.
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
const realCwd = process.cwd();

const { resolveHarnessPath } = require('./install.js');
const { ensureDirectory, ensureInstallDirectories } = require('./install-files.js');

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
function throws(fn, re) {
  try { fn(); } catch (e) { return re.test(e.message) && !/\n\s+at /.test(e.message); }
  return false;
}
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

try {
  assert(os.homedir() === fakeHome, 'sanity: os.homedir() redirected to temp dir');

  // Global claude-code: ~/.claude/skills missing -> created
  let r = ensureInstallDirectories(resolveHarnessPath('claude-code', true));
  const skills = path.join(fakeHome, '.claude', 'skills');
  assert(isDir(skills) && r.created.includes(skills), 'claude-code global: missing ~/.claude/skills created');
  assert(!fs.existsSync(path.join(skills, 'five-role-team')), 'claude-code global: plugin dir itself not created');

  // Idempotent
  r = ensureInstallDirectories(resolveHarnessPath('claude-code', true));
  assert(r.created.length === 0 && r.existing.includes(skills), 'second run: existing dir reported, nothing created');

  // Global pi: both locations' parents
  fs.rmSync(path.join(fakeHome, '.claude'), { recursive: true });
  r = ensureInstallDirectories(resolveHarnessPath('pi', true));
  assert(isDir(skills) && isDir(path.join(fakeHome, '.pi', 'agent', 'skills')), 'pi global: ~/.claude/skills and ~/.pi/agent/skills created');
  assert(!fs.existsSync(path.join(fakeHome, '.pi', 'agent', 'skills', 'five-role-team')), 'pi global: secondary symlink path not created');

  // Local (relative to cwd, which is a temp project dir)
  const proj = path.join(tmpRoot, 'proj');
  fs.mkdirSync(proj);
  process.chdir(proj);
  ensureInstallDirectories(resolveHarnessPath('claude-code', false));
  assert(isDir(path.join(proj, '.claude', 'skills')), 'claude-code local: ./.claude/skills created');
  ensureInstallDirectories(resolveHarnessPath('pi', false));
  assert(isDir(path.join(proj, '.pi', 'skills')), 'pi local: ./.pi/skills created');
  process.chdir(realCwd);

  // Custom path, deeply nested
  const custom = path.join(tmpRoot, 'a', 'b', 'c', 'skills');
  r = ensureInstallDirectories(resolveHarnessPath(custom, true));
  assert(isDir(custom) && r.created[0] === custom, 'custom path: nested missing dirs created');

  // Errors: path exists as a file
  const aFile = path.join(tmpRoot, 'afile');
  fs.writeFileSync(aFile, 'x');
  assert(throws(() => ensureInstallDirectories(resolveHarnessPath(aFile, true)), /not a directory/), 'target base is a file: clear error');
  assert(throws(() => ensureInstallDirectories(resolveHarnessPath(path.join(aFile, 'sub', 'skills'), true)), /not a directory/), 'ancestor is a file: clear error');

  // Errors: unwritable parent
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    console.log('SKIP: unwritable parent (running as root)');
  } else {
    const ro = path.join(tmpRoot, 'ro');
    fs.mkdirSync(ro);
    fs.chmodSync(ro, 0o555);
    assert(throws(() => ensureInstallDirectories(resolveHarnessPath(path.join(ro, 'x', 'skills'), true)), /not writable/), 'unwritable parent: clear error');
    assert(!fs.existsSync(path.join(ro, 'x')), 'unwritable parent: nothing created');
    assert(throws(() => ensureDirectory(ro), /not writable/), 'existing unwritable dir: clear error');
    fs.chmodSync(ro, 0o755);
  }

  // Errors: bad input
  assert(throws(() => ensureDirectory(''), /required/), 'empty path: clear error');
  assert(throws(() => ensureInstallDirectories(null), /required/), 'missing resolved paths: clear error');
} finally {
  process.chdir(realCwd);
  try {
    for (const p of [path.join(tmpRoot, 'ro')]) if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (e) { /* best effort */ }
}

process.exit(failed ? 1 : 0);
