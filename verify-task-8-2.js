#!/usr/bin/env node
'use strict';
// Verify task 8.2: after a successful install the final output is a success
// block with the absolute installation path, the pi secondary symlink (pi only),
// the configuration file path (copy mode) or a no-config statement (--link mode),
// and a configuration summary (agents, models, harness, scope, copy/symlink mode).
// The summary is cross-checked against .agent-config.json and the installed agent
// frontmatter. Nothing is printed as success on a failed install, on cancel, or on
// uninstall.
//
// Installs run as child processes (or in-process with injected prompts for the
// cancel case) through the shared sandbox helper (verify-sandbox.js). HOME and cwd
// are inside the sandbox temp root; the helper aborts if HOME resolves to the real
// home. Nothing outside the sandbox is installed or removed.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const SRC = path.resolve(__dirname);
const INSTALL = path.join(__dirname, 'install.js');
const SUCCESS = 'Installation successful: ';
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
  sb.enter(sc);
  const r = sb.run([INSTALL, ...argv], { home: sc.home, cwd: sc.cwd });
  return { sc, r, out: r.stdout };
}

const lines = (out) => out.split('\n');
const hasLine = (out, line) => lines(out).includes(line);
const lstat = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

// Model value from a file's YAML frontmatter `model:` line, quotes removed.
function frontmatterModel(file) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = fm && fm[1].match(/^model:[ \t]*(.*?)[ \t]*$/m);
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : null;
}

// Lines of the "Configuration summary" agent list: the "  Agents and models:" header
// followed by 4-space indented "    id: model" lines.
function summaryAgentLines(out) {
  const ls = lines(out);
  const i = ls.indexOf('  Agents and models:');
  if (i === -1) return null;
  const rest = [];
  for (let j = i + 1; j < ls.length && ls[j].startsWith('    '); j++) rest.push(ls[j]);
  return rest;
}

// Copy mode: the summary must match .agent-config.json and each installed agent file.
function checkCopySummary(label, out, primary, expectedAgents) {
  const cfgPath = path.join(primary, '.agent-config.json');
  assert(hasLine(out, '  Configuration file: ' + cfgPath), label + ': summary names the absolute config path ' + cfgPath);
  const cfgExists = fs.existsSync(cfgPath);
  assert(cfgExists, label + ': config file exists at the named path');
  if (!cfgExists) return;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert(JSON.stringify(cfg.agents) === JSON.stringify(expectedAgents), label + ': config lists exactly the selected agents in order (' + cfg.agents.join(',') + ')');
  const expectedLines = cfg.agents.map(id => '    ' + id + ': ' + cfg.models[id]);
  const got = summaryAgentLines(out);
  assert(got !== null && JSON.stringify(got) === JSON.stringify(expectedLines),
    label + ': summary agent/model lines match .agent-config.json' + (got ? ' (got ' + JSON.stringify(got) + ')' : ' (no summary block)'));
  for (const id of cfg.agents) {
    const candidates = [path.join(primary, 'agents', id + '.md'), path.join(primary, 'pi', 'agents', id + '.md')];
    const file = candidates.find(f => fs.existsSync(f));
    const fm = file ? frontmatterModel(file) : null;
    assert(fm !== null && fm === cfg.models[id], label + ': installed ' + id + ' frontmatter model matches config (' + fm + ')');
  }
}

try {
  // ---- (a) copy install, claude-code global: absolute path, config path, summary ----
  let copySc = null;
  {
    const { sc, r, out } = run('copy-claude', ['--global', '--harness', 'claude-code',
      '--agents', 'architect,worker', '--agent-models', 'architect=opus,worker=sonnet']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    copySc = sc;
    assert(r.status === 0, `(a) copy install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(r.stderr === '', '(a) nothing on stderr on success');
    assert(path.isAbsolute(primary) && primary.startsWith(sc.home + path.sep), '(a) expected primary is absolute and inside the sandbox home');
    assert(hasLine(out, SUCCESS + 'five-role-team installed at ' + primary),
      '(a) success line names the absolute installation path ' + primary);
    assert(hasLine(out, '  Mode: copy, global scope, harness claude-code'), '(a) summary names copy mode, global scope, harness');
    assert(!/Pi secondary symlink/.test(out), '(a) no pi secondary line for claude-code');
    const cfgPath = path.join(primary, '.agent-config.json');
    const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null;
    assert(cfg && cfg.models.architect === 'anthropic/claude-opus-4-5-20251101' && cfg.models.worker === 'anthropic/claude-sonnet-4-20250514',
      '(a) config holds the expanded models passed on the CLI');
    checkCopySummary('(a)', out, primary, ['architect', 'worker']);
    assert(!/^    reviewer: /m.test(out), '(a) unselected agent is not in the summary');
    const missing = inOrder(out, [
      'Installed ',
      'Saved configuration to ' + cfgPath,
      SUCCESS + 'five-role-team installed at ' + primary,
    ]);
    assert(missing.length === 0, '(a) success block comes after the progress lines' + (missing.length ? ' (missing/out of order: ' + missing.join(' | ') + ')' : ''));
    const ls = lines(out.replace(/\n+$/, ''));
    assert(ls[ls.length - 1] === '    worker: anthropic/claude-sonnet-4-20250514', '(a) success block is the last output');
  }

  // ---- (a2) uninstall of the copy install prints no success block ----
  // Runs in the (a) scenario home, so it removes the copy install that (a) just made.
  {
    sb.enter(copySc);
    const r = sb.run([INSTALL, 'uninstall', '--global', '--harness', 'claude-code'], { home: copySc.home, cwd: copySc.cwd });
    assert(r.status === 0, `(a2) uninstall of the copy install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(!/Installation successful/.test(r.stdout + r.stderr), '(a2) uninstall prints no success block');
  }

  // ---- (b) --link install, claude-code global: symlink path, no-config statement ----
  {
    const { sc, r, out } = run('link-claude', ['--global', '--harness', 'claude-code', '--link',
      '--agents', 'architect']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    const srcCfg = path.join(SRC, '.agent-config.json');
    assert(r.status === 0, `(b) link install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(r.stderr === '', '(b) nothing on stderr on success');
    assert(hasLine(out, SUCCESS + 'five-role-team linked at ' + primary + ' -> ' + SRC),
      '(b) success line names the absolute symlink path and its source');
    assert(hasLine(out, '  Mode: symlink (--link), global scope, harness claude-code'), '(b) summary names symlink mode, global scope, harness');
    assert(hasLine(out, '  Configuration file: none (no .agent-config.json is written in symlink mode)'),
      '(b) summary states that no configuration file is written');
    assert(!/Configuration file: \//.test(out), '(b) summary names no configuration file path');
    assert(summaryAgentLines(out) === null, '(b) no per-agent model list (selection/models not applied in link mode)');
    assert(hasLine(out, '  Agents: the whole source directory is linked; agent selection and model configuration are not applied'),
      '(b) summary says agent selection and models are not applied');
    const missing = inOrder(out, [
      'Linked ' + primary + ' -> ' + SRC,
      SUCCESS + 'five-role-team linked at ' + primary,
    ]);
    assert(missing.length === 0, '(b) success block comes after the symlink progress line');
    const st = lstat(primary);
    assert(st && st.isSymbolicLink(), '(b) sandbox install is a symlink');
    assert(!fs.existsSync(srcCfg), '(b) no .agent-config.json was written into the source directory');
  }

  // ---- (c) copy install, pi global: pi secondary path + config path + summary ----
  {
    const { sc, r, out } = run('copy-pi', ['--global', '--harness', 'pi',
      '--agents', 'architect,intern']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    const secondary = path.join(sc.home, '.pi', 'agent', 'skills', 'five-role-team');
    assert(r.status === 0, `(c) pi global copy install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(r.stderr === '', '(c) nothing on stderr on success');
    assert(hasLine(out, SUCCESS + 'five-role-team installed at ' + primary),
      '(c) success line names the absolute primary path');
    assert(hasLine(out, '  Pi secondary symlink: ' + secondary + ' -> ' + primary),
      '(c) summary names the absolute pi secondary symlink and its target');
    const sst = lstat(secondary);
    assert(sst && sst.isSymbolicLink() && path.resolve(path.dirname(secondary), fs.readlinkSync(secondary)) === primary,
      '(c) pi secondary is a symlink to the primary install');
    assert(hasLine(out, '  Mode: copy, global scope, harness pi'), '(c) summary names copy mode, global scope, harness pi');
    checkCopySummary('(c)', out, primary, ['architect', 'intern']);
    const missing = inOrder(out, [
      'Linked ' + secondary + ' -> ' + primary,
      SUCCESS + 'five-role-team installed at ' + primary,
    ]);
    assert(missing.length === 0, '(c) success block comes after the pi secondary link line');
  }

  // ---- (d) local copy install (cwd = sandbox work dir): absolute, not relative ----
  {
    const { sc, r, out } = run('local-claude', ['--local', '--harness', 'claude-code',
      '--agents', 'worker']);
    const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
    assert(r.status === 0, `(d) local install exits 0 (got ${r.status}; ${r.stderr.trim()})`);
    assert(hasLine(out, SUCCESS + 'five-role-team installed at ' + primary),
      '(d) success line names the absolute local installation path (cwd-resolved)');
    assert(hasLine(out, '  Mode: copy, local scope, harness claude-code'), '(d) summary names copy mode, local scope');
    checkCopySummary('(d)', out, primary, ['worker']);
    const m = out.match(/^Installation successful: five-role-team installed at (.+)$/m);
    assert(m !== null && path.isAbsolute(m[1]), '(d) success path is absolute (' + (m ? m[1] : 'no success line') + ')');
  }

  // ---- (e) failed install: invalid agent name -> exit 1, no success block ----
  {
    const { sc, r, out } = run('bad-agent', ['--global', '--harness', 'claude-code',
      '--agents', 'architect,bogus']);
    const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
    assert(r.status === 1, `(e) invalid agent exits 1 (got ${r.status})`);
    assert(!/Installation successful/.test(out + r.stderr), '(e) no success block on invalid agent');
    assert(!fs.existsSync(primary), '(e) nothing installed for invalid agent');
  }

  // ---- (f) failed install: unusable target (parent is a file) -> exit 1, no success block ----
  {
    const sc = sb.scenario('blocked-target');
    sb.enter(sc);
    fs.writeFileSync(path.join(sc.home, 'blocker'), 'x');
    const harness = path.join(sc.home, 'blocker', 'skills');
    const r = sb.run([INSTALL, '--global', '--harness', harness, '--agents', 'worker'], { home: sc.home, cwd: sc.cwd });
    assert(r.status === 1, `(f) blocked target exits 1 (got ${r.status})`);
    assert(!/Installation successful/.test(r.stdout + r.stderr), '(f) no success block on failed install');
  }
} catch (err) {
  console.error('FAIL: unexpected error', err);
  failed += 1;
}

// ---- (g) cancel, in-process with injected prompts (same pattern as verify-task-5-1) ----
(async () => {
  try {
    const { main } = require(INSTALL);
    const cancelCases = [
      ['cancel at agent prompt', async () => ({})],
      ['cancel at model prompt', async (q, o) => { if (q.name === 'agents') return { agents: ['worker'] }; o.onCancel(); return {}; }],
    ];
    for (const [label, impl] of cancelCases) {
      const sc = sb.scenario('cancel-' + label.replace(/[^a-z]+/g, '-').replace(/-$/, ''));
      sb.enter(sc);
      const logs = [];
      const errs = [];
      const res = await main(['--global', '--harness', 'claude-code'], {
        promptsImpl: impl,
        log: (m) => logs.push(m),
        error: (m) => errs.push(m),
      });
      const out = logs.join('\n');
      const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
      assert(res.exitCode === 0 && res.cancelled, `(g) ${label}: cancelled with exit 0`);
      assert(/Installation cancelled\./.test(out), `(g) ${label}: cancel message shown`);
      assert(!/Installation successful/.test(out) && !/Installation successful/.test(errs.join('\n')), `(g) ${label}: no success block`);
      assert(!fs.existsSync(primary), `(g) ${label}: nothing installed`);
    }
  } catch (err) {
    console.error('FAIL: unexpected error in cancel checks', err);
    failed += 1;
  } finally {
    sb.cleanup();
    if (sb.root && fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
    else console.log('OK: sandbox root removed by cleanup');
    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`);
      process.exit(1);
    }
    console.log('\nAll task 8.2 checks passed');
  }
})();
