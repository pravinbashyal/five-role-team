#!/usr/bin/env node
'use strict';
// Verify task 8.3: failures print a clear, human-readable message that says what
// failed and where, exit non-zero, and never show a stack trace.
//   - harness path that cannot be created (a path component is a regular file)
//   - harness path whose parent (or the harness directory itself) is not writable
//   - copy failure mid-install: the partial install is rolled back and reported
//   - agent source file that cannot be read
//   - closed / non-TTY stdin without --agents: refused up front with a message
//     that points at --agents / --agent-models (exit 1), while the flag-driven
//     install still succeeds and an injected-prompt cancel still exits 0
//
// All installs run as child processes through the shared sandbox helper
// (verify-sandbox.js): HOME and cwd are inside the sandbox temp root, and the
// helper aborts if HOME resolves to the real home. Permission cases change modes
// only inside the sandbox and restore them before cleanup. The copy-failure and
// unreadable-agent cases use a sandboxed copy of the plugin source, so the
// repository files are never modified.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const { copyPluginSource, primaryPath, GLOBAL_CLAUDE_CODE } = require(path.join(__dirname, 'verify-matrix.js'));

const INSTALL = path.join(__dirname, 'install.js');
const sb = createSandbox();
// Permission bits are not enforced for root, so the permission cases cannot
// show a failure there. They are reported as skipped instead of passing falsely.
const CAN_LOCK = !(typeof process.getuid === 'function' && process.getuid() === 0);

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
function skip(m) { console.log('SKIP:', m); }

// Output must not contain a Node stack frame.
const hasStack = (text) => /    at /.test(text);

// Modes changed inside the sandbox, restored (in reverse order) before cleanup.
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

(async () => {
  try {
    // ---- (a) harness path under a regular file -> clear error, exit 1 ----
    {
      const sc = sb.scenario('harness-under-file');
      sb.enter(sc);
      const blocker = path.join(sc.home, 'blocker');
      fs.writeFileSync(blocker, 'x');
      const harness = path.join(blocker, 'skills');
      const r = sb.run([INSTALL, '--global', '--harness', harness, '--agents', 'worker'], { home: sc.home, cwd: sc.cwd });
      const text = r.stdout + r.stderr;
      assert(r.status === 1, `(a) harness under a file exits 1 (got ${r.status})`);
      assert(new RegExp(`^Error: Cannot create .*: ${blocker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} exists but is not a directory$`, 'm').test(r.stderr),
        '(a) error names the regular file that blocks the harness path');
      assert(!/ENOTDIR|lstat/.test(text), '(a) no raw Node error code in the output');
      assert(!hasStack(text), '(a) no stack trace in the output');
      assert(!fs.existsSync(path.join(harness, 'five-role-team')) && !/Installation successful/.test(text),
        '(a) nothing installed and no success block');
    }

    if (CAN_LOCK) {
      // ---- (b) parent of the harness path is not writable -> clear error, exit 1 ----
      {
        const sc = sb.scenario('unwritable-parent');
        sb.enter(sc);
        const locked = path.join(sc.home, 'locked');
        fs.mkdirSync(locked);
        lock(locked, 0o555);
        const harness = path.join(locked, 'skills');
        const r = sb.run([INSTALL, '--global', '--harness', harness, '--agents', 'worker'], { home: sc.home, cwd: sc.cwd });
        const text = r.stdout + r.stderr;
        assert(r.status === 1, `(b) unwritable parent exits 1 (got ${r.status})`);
        assert(r.stderr.includes(`Cannot create ${harness}: parent directory ${locked} is not writable`),
          '(b) error names the unwritable parent directory');
        assert(!hasStack(text) && !/EACCES|EPERM/.test(text), '(b) no stack trace or raw error code');
        assert(!fs.existsSync(harness), '(b) nothing created under the unwritable parent');
      }

      // ---- (c) existing harness directory that is not writable -> clear error, exit 1 ----
      {
        const sc = sb.scenario('unwritable-harness');
        sb.enter(sc);
        const harness = path.join(sc.home, 'readonly-skills');
        fs.mkdirSync(harness);
        lock(harness, 0o555);
        const r = sb.run([INSTALL, '--global', '--harness', harness, '--agents', 'worker'], { home: sc.home, cwd: sc.cwd });
        const text = r.stdout + r.stderr;
        assert(r.status === 1, `(c) read-only harness directory exits 1 (got ${r.status})`);
        assert(r.stderr.includes(`Cannot install to ${harness}: directory is not writable`),
          '(c) error names the read-only harness directory');
        assert(!hasStack(text), '(c) no stack trace in the output');
        assert(!fs.existsSync(path.join(harness, 'five-role-team')), '(c) nothing installed into the read-only directory');
      }

      // ---- (d) copy failure mid-install -> clear error, rollback, exit 1 ----
      {
        const sc = sb.scenario('copy-failure');
        sb.enter(sc);
        const src = path.join(sc.cwd, 'plugin-src');
        copyPluginSource(src);
        const unreadable = path.join(src, 'commands', fs.readdirSync(path.join(src, 'commands')).sort()[0]);
        lock(unreadable, 0o000);
        const primary = primaryPath(sc, GLOBAL_CLAUDE_CODE);
        const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
          { home: sc.home, cwd: sc.cwd });
        const text = r.stdout + r.stderr;
        assert(r.status === 1, `(d) copy failure exits 1 (got ${r.status})`);
        assert(new RegExp(`^Error: Copy installation failed: EACCES: permission denied, .*${unreadable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(r.stderr),
          '(d) error says the copy failed, names the file and the permission cause');
        assert(/^Partial installation rolled back/m.test(r.stderr), '(d) the rollback is reported');
        assert(!fs.existsSync(primary), '(d) partial install removed by rollback');
        assert(!hasStack(text) && !/Installation successful/.test(text), '(d) no stack trace and no success block');
      }

      // ---- (e) agent source file that cannot be read -> clear error, exit 1 ----
      {
        const sc = sb.scenario('unreadable-agent');
        sb.enter(sc);
        const src = path.join(sc.cwd, 'plugin-src');
        copyPluginSource(src);
        lock(path.join(src, 'agents', 'worker.md'), 0o000);
        const primary = primaryPath(sc, GLOBAL_CLAUDE_CODE);
        const r = sb.run([path.join(src, 'install.js'), '--global', '--harness', 'claude-code', '--agents', 'worker'],
          { home: sc.home, cwd: sc.cwd });
        const text = r.stdout + r.stderr;
        assert(r.status === 1, `(e) unreadable agent file exits 1 (got ${r.status})`);
        assert(/^Error: Cannot read agent file .*worker\.md: EACCES: permission denied, open /m.test(r.stderr),
          '(e) error names the unreadable agent file and the permission cause');
        assert(!hasStack(text) && !fs.existsSync(primary), '(e) no stack trace and nothing installed');
      }
    } else {
      skip('(b)-(e) permission cases: running as root, mode bits are not enforced');
    }

    // ---- (f) closed / non-TTY stdin, no --agents or --agent-models -> message, exit 1 ----
    {
      const sc = sb.scenario('closed-stdin');
      sb.enter(sc);
      const primary = primaryPath(sc, GLOBAL_CLAUDE_CODE);
      // sb.run passes empty stdin, so the child has no terminal to prompt on.
      const r = sb.run([INSTALL, '--global', '--harness', 'claude-code'], { home: sc.home, cwd: sc.cwd });
      const text = r.stdout + r.stderr;
      assert(r.status === 1, `(f) no-input install without flags exits 1 (got ${r.status})`);
      assert(/No interactive input available/.test(r.stderr), '(f) message says no interactive input is available');
      assert(/--agents/.test(r.stderr) && /--agent-models/.test(r.stderr),
        '(f) message points at --agents and --agent-models for non-interactive installs');
      assert(!hasStack(text) && !fs.existsSync(primary) && !/Installation successful/.test(text),
        '(f) no stack trace, nothing installed, no success block');
    }

    // ---- (g) closed stdin with both non-interactive flags still installs ----
    {
      const sc = sb.scenario('closed-stdin-flags');
      sb.enter(sc);
      const primary = primaryPath(sc, GLOBAL_CLAUDE_CODE);
      const r = sb.run([INSTALL, '--global', '--harness', 'claude-code', '--agents', 'architect', '--agent-models', 'architect=opus'],
        { home: sc.home, cwd: sc.cwd });
      assert(r.status === 0 && fs.existsSync(path.join(primary, '.agent-config.json')),
        `(g) flag-driven install with closed stdin still installs and exits 0 (got ${r.status})`);
    }

    // ---- (h) user cancel through an injected prompt is unchanged: exit 0, cancel message ----
    {
      const sc = sb.scenario('cancel-injected');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const logs = [];
      const errs = [];
      const res = await main(['--global', '--harness', 'claude-code'], {
        promptsImpl: async () => ({}),
        log: (m) => logs.push(m),
        error: (m) => errs.push(m),
      });
      assert(res.exitCode === 0 && res.cancelled && logs.join('\n').includes('Installation cancelled.') && errs.length === 0,
        '(h) cancel at a prompt still exits 0 with the cancel message and no error');
    }

    // ---- (i) describeFsError: cause appended for known codes only, original text kept ----
    {
      const { describeFsError } = require(path.join(__dirname, 'install-files.js'));
      const coded = (code, message) => Object.assign(new Error(message), { code });
      const enospc = describeFsError(coded('ENOSPC', 'ENOSPC: injected'));
      assert(enospc === 'ENOSPC: injected (likely cause: no space left on device)', '(i) known code gets a plain-language cause, original message kept');
      const eacces = describeFsError(coded('EACCES', "EACCES: permission denied, open '/x'"));
      assert(eacces === "EACCES: permission denied, open '/x'", '(i) cause already in the Node message is not repeated');
      assert(describeFsError(new Error('Plain installer message')) === 'Plain installer message', '(i) error without a code is returned unchanged');
      assert(describeFsError(coded('EBUSY', 'EBUSY: injected')) === 'EBUSY: injected', '(i) unmapped code is returned unchanged');
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
    console.log('\nAll task 8.3 checks passed');
  }
})();
