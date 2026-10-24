#!/usr/bin/env node
'use strict';
// Verify task 8.1: progress messages during installation (detecting harness,
// copying files, creating symlinks, writing the config file) are shown, in order,
// at each step.
//
// Three installs run as child processes through the shared sandbox helper
// (verify-sandbox.js). HOME and cwd of every child are inside the sandbox temp
// root, and the helper aborts if HOME resolves to the real home. Nothing outside
// the sandbox is installed or removed.
//
//   (a) copy install, claude-code global: harness/target line, per-directory copy
//       lines naming every agent file, config write, success line; in order.
//   (b) --link install, claude-code global: harness/target line, symlink creation
//       line, linked line; no copy lines and no config write.
//   (c) copy install, pi global: as (a) plus the pi secondary symlink creation step.
//
// Progress goes to stdout; a successful run writes nothing to stderr.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const INSTALL = path.join(__dirname, 'install.js');
const sb = createSandbox();

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }

// Each marker must appear in stdout after the previous one (line order).
function inOrder(out, markers) {
  let pos = -1;
  const missing = [];
  for (const m of markers) {
    const idx = out.indexOf(m, pos + 1);
    if (idx === -1) { missing.push(m); continue; }
    pos = idx;
  }
  return missing;
}

function run(name, argv) {
  const sc = sb.scenario(name);
  // Point this process at the scenario home/cwd first (guarded), as verify-task-6-2 does.
  sb.enter(sc);
  const r = sb.run([INSTALL, ...argv], { home: sc.home, cwd: sc.cwd });
  return { sc, r, out: r.stdout };
}

try {
  // ---- (a) copy install, claude-code global ----
  {
    const { sc, r, out } = run('copy-claude', ['--global', '--harness', 'claude-code',
      '--agents', 'architect,worker']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    assert(r.status === 0, `(a) copy install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(r.stderr === '', '(a) progress is on stdout, nothing on stderr');
    const missing = inOrder(out, [
      'Detecting harness claude-code (global scope)',
      'Target installation path: ' + primary,
      'Copying top-level: SKILL.md',
      'Copying agents: ',
      'Installed ',
      'Writing configuration file into ' + primary,
      'Saved configuration to ' + path.join(primary, '.agent-config.json'),
    ]);
    assert(missing.length === 0, '(a) progress lines appear in order' + (missing.length ? ' (missing/out of order: ' + missing.join(' | ') + ')' : ''));
    const agentLine = (out.match(/^Copying agents: (.*)$/m) || [])[1] || '';
    assert(agentLine.split(', ').includes('architect.md') && agentLine.split(', ').includes('worker.md'),
      '(a) copy progress names each selected agent file (' + agentLine + ')');
    assert(!/reviewer\.md/.test(out), '(a) unselected agent file is not named in progress');
    assert(!/Pi secondary/.test(out) && !/pi secondary symlink/.test(out), '(a) no pi secondary step for claude-code');
    assert(fs.existsSync(path.join(primary, 'agents', 'worker.md')), '(a) sandbox install actually copied worker.md');
  }

  // ---- (b) --link install, claude-code global ----
  {
    const { sc, r, out } = run('link-claude', ['--global', '--harness', 'claude-code', '--link',
      '--agents', 'architect']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    assert(r.status === 0, `(b) link install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(r.stderr === '', '(b) progress is on stdout, nothing on stderr');
    const missing = inOrder(out, [
      'Detecting harness claude-code (global scope)',
      'Target installation path: ' + primary,
      'Creating symlink ' + primary + ' -> ' + path.resolve(__dirname),
      'Linked ' + primary + ' -> ' + path.resolve(__dirname),
    ]);
    assert(missing.length === 0, '(b) symlink progress appears in order' + (missing.length ? ' (missing/out of order: ' + missing.join(' | ') + ')' : ''));
    assert(!/^Copying /m.test(out) && !/Writing configuration/.test(out), '(b) link mode prints no copy or config-write step');
    const st = fs.lstatSync(primary, { throwIfNoEntry: false });
    assert(st && st.isSymbolicLink(), '(b) sandbox install is a symlink');
  }

  // ---- (c) copy install, pi global (secondary symlink) ----
  {
    const { sc, r, out } = run('copy-pi', ['--global', '--harness', 'pi',
      '--agents', 'architect,intern']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    const secondary = path.join(sc.home, '.pi', 'agent', 'skills', 'five-role-team');
    assert(r.status === 0, `(c) pi global copy install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(r.stderr === '', '(c) progress is on stdout, nothing on stderr');
    const missing = inOrder(out, [
      'Detecting harness pi (global scope)',
      'Target installation path: ' + primary,
      'Pi secondary location: ' + secondary,
      'Copying top-level: SKILL.md',
      'Copying agents: ',
      'Copying pi/agents: ',
      'Installed ',
      'Writing configuration file into ' + primary,
      'Saved configuration to ' + path.join(primary, '.agent-config.json'),
      'Creating pi secondary symlink ' + secondary + ' -> ' + primary,
      'Linked ' + secondary + ' -> ' + primary,
    ]);
    assert(missing.length === 0, '(c) pi progress lines appear in order' + (missing.length ? ' (missing/out of order: ' + missing.join(' | ') + ')' : ''));
    const piLine = (out.match(/^Copying pi\/agents: (.*)$/m) || [])[1] || '';
    assert(piLine.split(', ').includes('intern.md'), '(c) copy progress names the pi-only agent file (' + piLine + ')');
    const agentLine = (out.match(/^Copying agents: (.*)$/m) || [])[1] || '';
    assert(agentLine.split(', ').includes('architect.md'), '(c) copy progress names the selected shared agent file (' + agentLine + ')');
  }
} catch (err) {
  console.error('FAIL: unexpected error', err);
  failed += 1;
} finally {
  sb.cleanup();
  assert(!fs.existsSync(sb.root), 'sandbox root removed by cleanup');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll task 8.1 checks passed');
