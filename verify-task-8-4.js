#!/usr/bin/env node
'use strict';
// Verify task 8.4: the installer checks that its plugin source (the directory
// install.js sits in) is a five-role-team plugin directory, i.e. that
// `.claude-plugin/plugin.json` exists there as a readable regular file. A wrong
// directory fails with a clear message (what was expected, which directory was
// checked) and exit 1, before any prompt or filesystem write.
//   - manifest missing: install (with and without flags) and --link refused,
//     nothing written under the sandbox HOME or cwd, nothing printed to stdout
//   - manifest path is a directory: refused with "is not a file"
//   - manifest unreadable: refused with a readable message (skipped as root)
//   - uninstall is not gated on the manifest: it removes an existing copy install
//     from a source whose manifest was removed
//   - a valid plugin directory still installs (copy and --link)
//
// Every run is a child process inside the shared sandbox (verify-sandbox.js).
// The sources are sandboxed copies, so the repository files are never modified
// and the repository install.js is never run directly.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const sb = createSandbox();
const CAN_LOCK = !(typeof process.getuid === 'function' && process.getuid() === 0);

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
function skip(m) { console.log('SKIP:', m); }
const hasStack = (text) => /    at /.test(text);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Modes changed inside the sandbox, restored before cleanup.
const locks = [];
function lock(p, mode) {
  locks.push([p, fs.statSync(p).mode & 0o777]);
  fs.chmodSync(p, mode);
}
function unlockAll() {
  while (locks.length > 0) {
    const [p, mode] = locks.pop();
    try { fs.chmodSync(p, mode); } catch (err) { /* already gone */ }
  }
}

// Copy the plugin sources an install needs into a sandbox directory (same set as
// verify-task-8-3.js), plus a link to node_modules so `prompts` resolves.
function copyPluginSource(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['SKILL.md', 'agents', 'pi', 'commands', 'conventions', '.claude-plugin',
    'install.js', 'install-files.js', 'select-agents.js', 'configure-models.js', 'agent-config.js']) {
    fs.cpSync(path.join(__dirname, name), path.join(dest, name), { recursive: true });
  }
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

// Sorted list of every entry under dir (relative path plus type), used to prove
// that a refused run wrote nothing. A missing dir yields an empty list.
function snapshot(dir) {
  const out = [];
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      out.push(`${ent.isDirectory() ? 'd' : ent.isSymbolicLink() ? 'l' : 'f'} ${r}`);
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
    }
  };
  walk(dir, '');
  return out.sort();
}

function sameSnapshot(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const primaryOf = (home) => path.join(home, '.claude', 'skills', 'five-role-team');

(async () => {
  try {
    // ---- (a) manifest missing -> clear error, exit 1, nothing written ----
    {
      const sc = sb.scenario('manifest-missing');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      fs.rmSync(path.join(src, '.claude-plugin', 'plugin.json'));
      const homeBefore = snapshot(sc.home);
      const cwdBefore = snapshot(sc.cwd);
      const srcReal = fs.realpathSync(src);
      const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      const text = r.stdout + r.stderr;
      assert(r.status === 1, `(a) install from a directory without plugin.json exits 1 (got ${r.status})`);
      assert(new RegExp(`^Error: Not a five-role-team plugin directory: \\.claude-plugin/plugin\\.json not found in ${esc(srcReal)}\\. Run install\\.js from the five-role-team directory`, 'm').test(r.stderr),
        '(a) error says plugin.json was expected and names the directory checked');
      assert(r.stdout === '', '(a) nothing printed to stdout before the refusal');
      assert(!hasStack(text) && !/Installation successful|Detecting harness/.test(text), '(a) no stack trace and no progress or success output');
      assert(sameSnapshot(snapshot(sc.home), homeBefore) && !fs.existsSync(primaryOf(sc.home)),
        '(a) nothing written under the sandbox HOME');
      assert(sameSnapshot(snapshot(sc.cwd), cwdBefore), '(a) nothing written under the sandbox cwd');
    }

    // ---- (b) no flags (would otherwise prompt) -> the source error, not the prompt error ----
    {
      const sc = sb.scenario('manifest-missing-noflags');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      fs.rmSync(path.join(src, '.claude-plugin', 'plugin.json'));
      const before = snapshot(sc.home);
      const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code'], { home: sc.home, cwd: sc.cwd });
      assert(r.status === 1 && /Not a five-role-team plugin directory/.test(r.stderr) && !/No interactive input/.test(r.text),
        `(b) source check runs before the agent and model prompts (exit ${r.status})`);
      assert(sameSnapshot(snapshot(sc.home), before), '(b) nothing written under the sandbox HOME');
    }

    // ---- (c) --local scope and --link with the manifest missing -> refused, nothing created ----
    {
      const sc = sb.scenario('manifest-missing-local-link');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      fs.rmSync(path.join(src, '.claude-plugin', 'plugin.json'));
      const cwdBefore = snapshot(sc.cwd);
      const local = sb.run([path.join(src, 'install.js'), '--local', '--harness', 'claude-code', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(local.status === 1 && /Not a five-role-team plugin directory/.test(local.stderr) && !fs.existsSync(path.join(sc.cwd, '.claude')),
        `(c) --local install refused and no ./.claude created (exit ${local.status})`);
      const link = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--link', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(link.status === 1 && /Not a five-role-team plugin directory/.test(link.stderr) && !fs.existsSync(primaryOf(sc.home)),
        `(c) --link install refused and no symlink created (exit ${link.status})`);
      assert(sameSnapshot(snapshot(sc.cwd), cwdBefore), '(c) nothing written under the sandbox cwd');
    }

    // ---- (d) plugin.json is a directory -> "is not a file", exit 1 ----
    {
      const sc = sb.scenario('manifest-is-directory');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      const manifest = path.join(src, '.claude-plugin', 'plugin.json');
      fs.rmSync(manifest);
      fs.mkdirSync(manifest);
      const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(r.status === 1 && new RegExp(`^Error: Not a five-role-team plugin directory: ${esc(manifest)} is not a file`, 'm').test(r.stderr),
        `(d) plugin.json that is a directory is refused with "is not a file" (exit ${r.status})`);
      assert(!hasStack(r.text) && !fs.existsSync(primaryOf(sc.home)), '(d) no stack trace and nothing installed');
    }

    // ---- (e) plugin.json unreadable -> readable message naming the file, exit 1 ----
    if (CAN_LOCK) {
      const sc = sb.scenario('manifest-unreadable');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      const manifest = path.join(src, '.claude-plugin', 'plugin.json');
      lock(manifest, 0o000);
      const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(r.status === 1 && new RegExp(`^Error: Cannot read ${esc(manifest)}: EACCES: permission denied`, 'm').test(r.stderr),
        `(e) unreadable plugin.json is refused with a permission message (exit ${r.status})`);
      assert(!hasStack(r.text) && !fs.existsSync(primaryOf(sc.home)), '(e) no stack trace and nothing installed');
    } else {
      skip('(e) unreadable plugin.json: running as root, mode bits are not enforced');
    }

    // ---- (f) uninstall is not gated on the manifest: installed copy is removed ----
    {
      const sc = sb.scenario('uninstall-broken-source');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      const primary = primaryOf(sc.home);
      const inst = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(inst.status === 0 && fs.existsSync(path.join(primary, '.claude-plugin', 'plugin.json')),
        `(f) setup: valid copy install succeeds (exit ${inst.status})`);
      fs.rmSync(path.join(src, '.claude-plugin', 'plugin.json'));
      const un = sb.run([path.join(src, 'install.js'), 'uninstall', '--global', '--harness', 'claude-code'],
        { home: sc.home, cwd: sc.cwd });
      assert(un.status === 0 && !fs.existsSync(primary) && !/Not a five-role-team plugin directory/.test(un.text),
        `(f) uninstall still removes the copy when plugin.json is missing from the source (exit ${un.status})`);
    }

    // ---- (g) valid plugin directory still installs (copy and --link) ----
    {
      const sc = sb.scenario('valid-source');
      sb.enter(sc);
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src);
      const primary = primaryOf(sc.home);
      const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(r.status === 0 && /^Installation successful/m.test(r.stdout) && fs.existsSync(path.join(primary, '.claude-plugin', 'plugin.json')),
        `(g) valid plugin directory installs (copy) and exits 0 (got ${r.status})`);
      assert(!/Not a five-role-team plugin directory/.test(r.text), '(g) no plugin directory error for a valid source');
      sb.remove(primary);
      const lk = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--link', '--agents', 'worker'],
        { home: sc.home, cwd: sc.cwd });
      assert(lk.status === 0 && fs.lstatSync(primary).isSymbolicLink(),
        `(g) valid plugin directory installs (--link) and exits 0 (got ${lk.status})`);
    }
  } catch (err) {
    console.error('FAIL: unexpected error', err);
    failed += 1;
  } finally {
    unlockAll();
    sb.cleanup();
    if (sb.root && fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
    else console.log('OK: sandbox root removed by cleanup');
    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`);
      process.exit(1);
    }
    console.log('\nAll task 8.4 checks passed');
  }
})();
