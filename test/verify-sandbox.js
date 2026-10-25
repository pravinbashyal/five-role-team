#!/usr/bin/env node
'use strict';
// Shared sandbox helper for install/uninstall verify scripts (task 7.7, design
// Decision 12). Every sandbox is a fresh directory under os.tmpdir():
//
//   <root>/home   sandbox HOME (HOME and USERPROFILE point here)
//   <root>/work   sandbox cwd
//   <root>/<name> per-scenario home/work pairs (see scenario())
//
// The real home is captured from the passwd entry (os.userInfo) at require
// time, before any script changes HOME. assertSafe() aborts the process with
// exit 2 if HOME, USERPROFILE, os.homedir() or the cwd resolve to the real home
// or to anywhere outside the sandbox root. Every spawn helper re-checks the home
// and cwd it is about to use. Removal only ever touches paths inside the root.
//
// Nothing here installs or removes anything by itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PREFIX = 'verify-sbx-';
const SPAWN_TIMEOUT_MS = 60000;

// Captured before any HOME change. os.userInfo() reads the passwd database and
// does not depend on the HOME environment variable.
const REAL_HOME = fs.realpathSync(os.userInfo().homedir);
const TMP_BASE = fs.realpathSync(os.tmpdir());

function isInside(p, base) {
  return p === base || p.startsWith(base + path.sep);
}

function abort(msg) {
  // fs.writeSync: process.exit() can drop pending async console output on pipes.
  fs.writeSync(2, `ABORT (sandbox guard): ${msg} Nothing was installed or removed.\n`);
  process.exit(2);
}

// realpath that aborts (rather than throws) when the path cannot be resolved.
function resolveOrAbort(p, what) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    abort(`${what} ${p} cannot be resolved (${err.code || err.message}).`);
  }
  return null;
}

// Check that a home/cwd pair is inside the sandbox root and is not the real home.
function checkHomeAndCwd(root, home, cwd, label) {
  const h = resolveOrAbort(home, `${label} HOME`);
  const c = resolveOrAbort(cwd, `${label} cwd`);
  if (h === REAL_HOME) abort(`${label} HOME resolves to the real home ${REAL_HOME}.`);
  if (!isInside(h, root)) abort(`${label} HOME ${h} is outside the sandbox root ${root}.`);
  if (!isInside(c, root)) abort(`${label} cwd ${c} is outside the sandbox root ${root}.`);
}

// The root must be a sandbox-named directory under the temp base that does not
// contain or equal the real home. cleanup() and remove() depend on this.
function rootIsSafe(root) {
  return isInside(root, TMP_BASE) && root !== TMP_BASE &&
    path.basename(root).startsWith(PREFIX) &&
    !isInside(REAL_HOME, root);
}

function createSandbox() {
  const origCwd = process.cwd();
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  const root = fs.realpathSync(fs.mkdtempSync(path.join(TMP_BASE, PREFIX)));
  if (!rootIsSafe(root)) abort(`sandbox root ${root} is not a safe sandbox directory.`);

  const home = path.join(root, 'home');
  const cwd = path.join(root, 'work');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);

  let activated = false;

  function childEnv(h, extra) {
    return { ...process.env, ...(extra || {}), HOME: h, USERPROFILE: h };
  }

  // Refuse any path that is not strictly inside the root, following ancestors
  // through symlinks so a link inside the root cannot redirect a removal.
  function assertRemovable(p) {
    const abs = path.resolve(p);
    if (abs === root || !isInside(abs, root)) {
      throw new Error(`refusing to remove ${abs}: outside sandbox root ${root}`);
    }
    let parent;
    try {
      parent = fs.realpathSync(path.dirname(abs));
    } catch (err) {
      return false; // parent does not exist, so there is nothing to remove
    }
    if (!isInside(parent, root)) {
      throw new Error(`refusing to remove ${abs}: its parent resolves outside sandbox root ${root}`);
    }
    return true;
  }

  // Re-check the process state a script is about to rely on.
  function assertSafe() {
    if (!rootIsSafe(root)) abort(`sandbox root ${root} is no longer a safe sandbox directory.`);
    for (const name of ['HOME', 'USERPROFILE']) {
      const v = process.env[name];
      if (v === undefined) continue;
      if (v === REAL_HOME) abort(`${name} is set to the real home ${REAL_HOME}.`);
      checkHomeAndCwd(root, v, process.cwd(), `${name}=${v}`);
    }
    const homedir = resolveOrAbort(os.homedir(), 'os.homedir()');
    if (homedir === REAL_HOME) abort(`os.homedir() resolves to the real home ${REAL_HOME}.`);
    if (!isInside(homedir, root)) abort(`os.homedir() ${homedir} is outside the sandbox root ${root}.`);
    const cwdNow = resolveOrAbort(process.cwd(), 'process.cwd()');
    if (!isInside(cwdNow, root)) abort(`cwd ${cwdNow} is outside the sandbox root ${root}.`);
    return true;
  }

  // Point this process at the sandbox HOME and cwd, then verify it.
  function activate() {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.chdir(cwd);
    activated = true;
    return assertSafe();
  }

  // Point this process at a named scenario home/cwd pair, then verify it.
  function enter(scenarioObj) {
    process.env.HOME = scenarioObj.home;
    process.env.USERPROFILE = scenarioObj.home;
    process.chdir(scenarioObj.cwd);
    activated = true;
    return assertSafe();
  }

  // Per-scenario home/work pair inside the root. Any previous copy is removed.
  function scenario(name) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`bad scenario name: ${name}`);
    const dir = path.join(root, name);
    remove(dir);
    const sHome = path.join(dir, 'home');
    const sCwd = path.join(dir, 'work');
    fs.mkdirSync(sHome, { recursive: true });
    fs.mkdirSync(sCwd, { recursive: true });
    return Object.freeze({ name, home: sHome, cwd: sCwd, env: childEnv(sHome) });
  }

  // Run a node script as a child process. HOME/USERPROFILE and cwd are passed
  // explicitly, the home and cwd are re-checked, and stdin is empty.
  function run(argv, opts = {}) {
    const h = opts.home || home;
    const c = opts.cwd || cwd;
    checkHomeAndCwd(root, h, c, 'spawn');
    const r = spawnSync(process.execPath, argv, {
      cwd: c,
      env: childEnv(h, opts.env),
      input: '',
      encoding: 'utf8',
      timeout: opts.timeout || SPAWN_TIMEOUT_MS,
    });
    const out = r.stdout || '';
    const err = r.stderr || '';
    return { status: r.status, signal: r.signal, stdout: out, stderr: err, out, err, text: out + err };
  }

  // Remove a path inside the root only. Symlinks are unlinked, never followed.
  function remove(p) {
    const abs = path.resolve(p);
    if (assertRemovable(abs)) fs.rmSync(abs, { recursive: true, force: true });
  }

  // Remove the whole sandbox. Restores HOME/USERPROFILE/cwd first if this
  // process was pointed at the sandbox, so no later code runs in a deleted dir.
  function cleanup() {
    if (!rootIsSafe(root)) throw new Error(`refusing to clean up ${root}: not a sandbox directory`);
    if (activated) {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
      if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile;
      process.chdir(origCwd);
      activated = false;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }

  return Object.freeze({
    realHome: REAL_HOME,
    root,
    home,
    cwd,
    env: childEnv(home),
    assertSafe,
    activate,
    enter,
    scenario,
    run,
    remove,
    cleanup,
  });
}

module.exports = { createSandbox, REAL_HOME, PREFIX };
