#!/usr/bin/env node
'use strict';
// Verify task 7.7: the shared sandbox helper (verify-sandbox.js) guard.
//
//   (a) assertSafe aborts with a non-zero exit when HOME is the real home. Done in
//       child processes that only require the helper; they never install or remove
//       anything. Also: a spawn with home set to the real home is refused before
//       any child runs.
//   (b) a normal sandbox passes the guard and spawns children with sandbox HOME.
//   (c) remove/cleanup never touch anything outside the temp root (including via
//       ../ traversal and symlinks that point outside).
//   (d) the sandbox HOME is never the real home.
//
// Nothing here installs or removes install files. The only deletions are the
// sandbox roots this script creates and the decoy paths it creates under the
// temp directory, each removed by this script.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HELPER = path.join(__dirname, 'verify-sandbox.js');
const { createSandbox, REAL_HOME, PREFIX } = require(HELPER);

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });
const TMP_BASE = fs.realpathSync(os.tmpdir());
const isInside = (p, base) => p === base || p.startsWith(base + path.sep);
const HOME_AT_START = process.env.HOME;

// Child-process body helper: writes synchronously so output survives process.exit.
const childBody = (lines) => `
const fs = require('fs');
const { createSandbox } = require(${JSON.stringify(HELPER)});
const w = (s) => fs.writeSync(1, s + '\\n');
${lines}
`;

// Parent sandbox used for (c) and (d). The parent never activates it, so the
// parent's own HOME and cwd are never changed by this script.
const sb = createSandbox();
let decoyRoot = null;

try {
  // ---- (a) guard aborts against a real HOME (child processes, nothing installed) ----
  {
    const code = childBody(`
      const s = createSandbox();
      process.on('exit', () => { s.cleanup(); });
      w('ROOT=' + s.root);
      process.env.HOME = s.realHome;
      process.env.USERPROFILE = s.realHome;
      s.assertSafe();
      w('REACHED_AFTER_GUARD');
    `);
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: sb.cwd,
      env: { ...process.env, HOME: REAL_HOME, USERPROFILE: REAL_HOME },
      input: '',
      encoding: 'utf8',
      timeout: 60000,
    });
    const rootLine = ((r.stdout || '').match(/^ROOT=(.*)$/m) || [])[1];
    assert(r.status === 2, `(a) assertSafe with HOME=real home exits 2 (got ${r.status}; ${(r.stderr || '').trim()})`);
    assert(/ABORT \(sandbox guard\)/.test(r.stderr || ''), '(a) abort message names the sandbox guard');
    assert(!/REACHED_AFTER_GUARD/.test(r.stdout || ''), '(a) execution stopped at the guard');
    assert(rootLine && isInside(rootLine, TMP_BASE) && path.basename(rootLine).startsWith(PREFIX) && !fs.existsSync(rootLine),
      '(a) the aborted child only ever used, and then removed, its own temp root');
  }

  {
    const code = childBody(`
      const s = createSandbox();
      process.on('exit', () => { s.cleanup(); });
      w('ROOT=' + s.root);
      s.run(['-e', 'process.exit(0)'], { home: s.realHome, cwd: s.cwd });
      w('REACHED_AFTER_GUARD');
    `);
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: sb.cwd,
      env: { ...process.env, HOME: REAL_HOME, USERPROFILE: REAL_HOME },
      input: '',
      encoding: 'utf8',
      timeout: 60000,
    });
    assert(r.status === 2, `(a) spawn with home set to the real home is refused with exit 2 (got ${r.status})`);
    assert(!/REACHED_AFTER_GUARD/.test(r.stdout || ''), '(a) spawn refused before any child process ran');
  }

  // ---- (b) a normal sandbox passes ----
  {
    const code = childBody(`
      const s = createSandbox();
      process.on('exit', () => { s.cleanup(); });
      w('ROOT=' + s.root);
      s.activate();
      s.assertSafe();
      const r = s.run(['-e', 'process.stdout.write(process.env.HOME + "|" + require("os").homedir())']);
      w('RUN_STATUS=' + r.status);
      w('RUN_OUT=' + r.stdout);
      w('NORMAL_PASSED');
    `);
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: sb.cwd, env: { ...process.env }, input: '', encoding: 'utf8', timeout: 60000,
    });
    const out = r.stdout || '';
    const rootLine = (out.match(/^ROOT=(.*)$/m) || [])[1];
    const runOut = ((out.match(/^RUN_OUT=(.*)$/m) || [])[1] || '').trim();
    assert(r.status === 0 && /NORMAL_PASSED/.test(out), `(b) normal sandbox passes assertSafe (exit ${r.status}; ${(r.stderr || '').trim()})`);
    assert(/^RUN_STATUS=0$/m.test(out), '(b) spawned child through the guard exits 0');
    // rootLine is already a realpath (the helper resolves it), and the child has
    // removed it by now, so compare the strings rather than resolving on disk.
    const expectedHome = rootLine ? path.join(rootLine, 'home') : null;
    assert(expectedHome && runOut === `${expectedHome}|${expectedHome}`,
      '(b) spawned child sees HOME and os.homedir() both at the sandbox home');
    assert(rootLine && !fs.existsSync(rootLine), '(b) sandbox root removed by cleanup on exit');
  }

  // ---- (d) the sandbox HOME is never the real home ----
  {
    const realSandboxHome = fs.realpathSync(sb.home);
    assert(sb.realHome === REAL_HOME && REAL_HOME === fs.realpathSync(os.userInfo().homedir),
      '(d) helper real home matches the passwd home directory');
    assert(realSandboxHome !== REAL_HOME, '(d) sandbox HOME does not resolve to the real home');
    assert(isInside(realSandboxHome, fs.realpathSync(sb.root)) && isInside(fs.realpathSync(sb.root), TMP_BASE),
      '(d) sandbox HOME sits inside a temp root under the temp directory');
    assert(!isInside(REAL_HOME, fs.realpathSync(sb.root)), '(d) the real home is not inside the sandbox root');
    assert(sb.env.HOME === sb.home && sb.env.USERPROFILE === sb.home, '(d) sandbox env points HOME and USERPROFILE at the sandbox home');
    assert(process.env.HOME === HOME_AT_START, '(d) creating a sandbox does not change this process HOME');
  }

  // ---- (c) cleanup and remove never touch anything outside the temp root ----
  {
    decoyRoot = fs.mkdtempSync(path.join(TMP_BASE, 'verify-7-7-decoy-'));
    const decoyFile = path.join(decoyRoot, 'keep.txt');
    const decoyDir = path.join(decoyRoot, 'dir');
    fs.writeFileSync(decoyFile, 'keep me\n');
    fs.mkdirSync(decoyDir);
    fs.writeFileSync(path.join(decoyDir, 'keep2.txt'), 'keep me too\n');

    let threw = false;
    try { sb.remove(decoyFile); } catch (err) { threw = /outside sandbox root/.test(err.message); }
    assert(threw && fs.readFileSync(decoyFile, 'utf8') === 'keep me\n', '(c) remove() refuses a file outside the root and leaves it');

    threw = false;
    try { sb.remove(path.join(sb.root, '..', path.basename(decoyRoot), 'keep.txt')); } catch (err) { threw = true; }
    assert(threw && fs.existsSync(decoyFile), '(c) remove() refuses a ../ traversal out of the root');

    threw = false;
    try { sb.remove(sb.root); } catch (err) { threw = true; }
    assert(threw && fs.existsSync(sb.root), '(c) remove() refuses the sandbox root itself');

    threw = false;
    try { sb.remove(path.join(REAL_HOME, '.verify-7-7-probe-not-present')); } catch (err) { threw = true; }
    assert(threw, '(c) remove() refuses a path under the real home (probe path that does not exist)');

    fs.symlinkSync(decoyDir, path.join(sb.root, 'evil'), 'dir');
    threw = false;
    try { sb.remove(path.join(sb.root, 'evil', 'keep2.txt')); } catch (err) { threw = /parent resolves outside/.test(err.message); }
    assert(threw && fs.readFileSync(path.join(decoyDir, 'keep2.txt'), 'utf8') === 'keep me too\n',
      '(c) remove() refuses a path reached through a symlink that points outside the root');

    fs.symlinkSync(decoyFile, path.join(sb.root, 'leaf.txt'));
    sb.remove(path.join(sb.root, 'leaf.txt'));
    assert(lst(path.join(sb.root, 'leaf.txt')) === undefined && fs.readFileSync(decoyFile, 'utf8') === 'keep me\n',
      '(c) remove() of a symlink inside the root unlinks it and does not touch the target');

    const sb3 = createSandbox();
    fs.symlinkSync(decoyDir, path.join(sb3.root, 'out-link'), 'dir');
    sb3.cleanup();
    assert(!fs.existsSync(sb3.root) && fs.existsSync(path.join(decoyDir, 'keep2.txt')),
      '(c) cleanup() removes its own root and never follows a symlink out of it');
  }
} catch (err) {
  console.error('FAIL: unexpected error', err);
  failed += 1;
} finally {
  sb.cleanup();
  if (decoyRoot) fs.rmSync(decoyRoot, { recursive: true, force: true });
  assert(!fs.existsSync(sb.root), 'parent sandbox root removed by cleanup');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 7.7 checks passed');
