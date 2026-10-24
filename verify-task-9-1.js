#!/usr/bin/env node
'use strict';
// Verify task 9.1: the README.md "## Installation" section documents install.js
// accurately and every command in it works as written.
//   - every `node install.js ...` line in a fenced code block of the section is
//     run, in README order, each in its own sandbox (verify-sandbox.js: temp HOME
//     and temp cwd; the guard aborts if HOME is the real home)
//   - each command runs the copy of the plugin source at <sandbox cwd>/plugin-src
//     (the same copy verify-task-8-4.js uses), so the repository install.js is
//     never executed
//   - non-interactive install examples exit 0, print the success line and install
//     where the README says (scope, harness, copy or link, selected agents, models)
//   - the interactive example (no --agents and no --agent-models) exits 1 with the
//     no-terminal hint and installs nothing; stdin is an empty pipe, not a TTY
//   - each uninstall example runs after a setup install of the same scope and
//     harness in the same sandbox: it must exit 0 and remove the installation, and
//     a second run must exit 1 with "Nothing to uninstall"
//   - every --flag token in the section appears in `install.js --help`
//   - the section's claims hold: intern is rejected for claude-code and accepted
//     for pi; re-running over an existing install is refused without --force and
//     succeeds with it; --link links the whole source and writes no config file
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const { copyPluginSource, primaryPath, secondaryPath } = require(path.join(__dirname, 'verify-matrix.js'));

const README = path.join(__dirname, 'README.md');
const MODEL_SHORT = {
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
};

const sb = createSandbox();
let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }

// lstat-based existence check: true for a symlink even when its target is gone.
function present(p) {
  try { fs.lstatSync(p); return true; } catch (err) { return false; }
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const listDir = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

// A fresh scenario (temp home and cwd) with the plugin source copied into its cwd.
function freshSource(name) {
  const sc = sb.scenario(name);
  sb.enter(sc);
  const src = path.join(sc.cwd, 'plugin-src');
  copyPluginSource(src);
  return { sc, src, script: path.join(src, 'install.js') };
}

const runIn = (env, argv) => sb.run(argv, { home: env.sc.home, cwd: env.sc.cwd });

// Text of the "## Installation" section, up to the next level-2 heading.
function section(text) {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => l === '## Installation');
  if (s < 0) return null;
  let e = lines.findIndex((l, i) => i > s && /^## /.test(l));
  if (e < 0) e = lines.length;
  return lines.slice(s, e).join('\n');
}

// Non-empty trimmed lines of every fenced code block in the section.
function fencedLines(sec) {
  const out = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```\s*$/gm;
  let m;
  while ((m = re.exec(sec)) !== null) {
    for (const raw of m[1].split('\n')) {
      const l = raw.trim();
      if (l) out.push(l);
    }
  }
  return out;
}

// Shell-like split: whitespace separates words; single or double quotes group.
function tokenize(line) {
  const out = [];
  let cur = null;
  let q = null;
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null; else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur = cur === null ? '' : cur; continue; }
    if (/\s/.test(ch)) {
      if (cur !== null) { out.push(cur); cur = null; }
      continue;
    }
    cur = (cur === null ? '' : cur) + ch;
  }
  if (q) throw new Error(`unterminated quote in: ${line}`);
  if (cur !== null) out.push(cur);
  return out;
}

// Expected installation paths for a command's scope and harness (README claims).
function expectedPaths(argv, sc) {
  const harness = argv[argv.indexOf('--harness') + 1];
  if (harness !== 'pi' && harness !== 'claude-code') throw new Error(`no expected path for harness ${harness}`);
  const cell = { scope: argv.includes('--global') ? 'global' : 'local', harness };
  return { primary: primaryPath(sc, cell), secondary: secondaryPath(sc, cell) };
}

function checkUninstall(label, env, rest, paths) {
  const scope = rest.includes('--global') ? '--global' : '--local';
  const harness = rest[rest.indexOf('--harness') + 1];
  const setup = runIn(env, [env.script, scope, '--harness', harness, '--agents', 'worker']);
  assert(setup.status === 0 && present(paths.primary), `${label}: setup install of the same scope and harness (exit ${setup.status})`);
  const un = runIn(env, [env.script, ...rest]);
  const gone = !present(paths.primary) && (!paths.secondary || !present(paths.secondary));
  assert(un.status === 0 && gone, `${label}: exits 0 and removes the installation (exit ${un.status})`);
  const again = runIn(env, [env.script, ...rest]);
  assert(again.status === 1 && /Nothing to uninstall/.test(again.stderr),
    `${label}: a second run exits 1 with "Nothing to uninstall" (exit ${again.status})`);
}

function checkInteractive(label, env, rest, paths) {
  // The run helper gives the child an empty pipe for stdin, which is not a TTY.
  const r = runIn(env, [env.script, ...rest]);
  assert(r.status === 1 && /No interactive input available/.test(r.stderr) && /--agents/.test(r.stderr),
    `${label}: without a terminal exits 1 with the flags hint (exit ${r.status})`);
  const none = !present(paths.primary) && (!paths.secondary || !present(paths.secondary));
  assert(none, `${label}: nothing installed`);
}

function checkInstall(label, env, rest, paths) {
  const { sc, script, src } = env;
  const r = runIn(env, [script, ...rest]);
  assert(r.status === 0 && /^Installation successful/m.test(r.stdout), `${label}: exits 0 with success message (exit ${r.status})`);
  if (r.status !== 0) console.error(r.stderr.trimEnd());

  const link = rest.includes('--link');
  const primary = paths.primary;
  const isLink = present(primary) && fs.lstatSync(primary).isSymbolicLink();
  assert(present(primary) && isLink === link, `${label}: ${link ? 'symlink' : 'copy'} install at ${primary}`);

  if (paths.secondary) {
    const ok = present(paths.secondary) && fs.lstatSync(paths.secondary).isSymbolicLink() &&
      present(primary) && fs.realpathSync(paths.secondary) === fs.realpathSync(primary);
    assert(ok, `${label}: pi symlink ${paths.secondary} points at the installation`);
  }

  const cfg = path.join(primary, '.agent-config.json');
  if (link) {
    assert(!fs.existsSync(cfg) && !present(path.join(src, '.agent-config.json')), `${label}: --link writes no .agent-config.json`);
    const linkedAgents = listDir(path.join(src, 'agents'));
    assert(present(primary) && sameList(listDir(path.join(primary, 'agents')), linkedAgents),
      `${label}: --link exposes the whole source agents directory (agent selection not applied)`);
    return;
  }

  assert(fs.existsSync(cfg), `${label}: copy install writes .agent-config.json`);
  const agentsDir = path.join(primary, 'agents');
  const ai = rest.indexOf('--agents');
  if (ai >= 0) {
    const wanted = rest[ai + 1].split(',').sort();
    const got = present(agentsDir) ? listDir(agentsDir) : [];
    assert(sameList(got, wanted), `${label}: installed agents are exactly ${wanted.join(',')} (got ${got.join(',')})`);
  }
  const mi = rest.indexOf('--agent-models');
  if (mi >= 0) {
    for (const pair of rest[mi + 1].split(',')) {
      const [agent, value] = pair.split('=');
      const expected = value.includes('/') ? value : MODEL_SHORT[value];
      const file = path.join(agentsDir, `${agent}.md`);
      const m = present(file) ? fs.readFileSync(file, 'utf8').match(/^model:\s*(.+?)\s*$/m) : null;
      assert(m !== null && m[1] === expected, `${label}: ${agent} model is ${expected} (got ${m ? m[1] : 'none'})`);
    }
  }
}

function checkClaims() {
  const ci = freshSource('claim-intern-claude-code');
  const cp = expectedPaths(['--global', '--harness', 'claude-code'], ci.sc);
  const r1 = runIn(ci, [ci.script, '--global', '--harness', 'claude-code', '--agents', 'architect,intern']);
  assert(r1.status === 1 && /intern/i.test(r1.stderr) && !present(cp.primary),
    `claim: intern is rejected by --agents for claude-code (exit ${r1.status})`);

  const pi = freshSource('claim-intern-pi');
  const pp = expectedPaths(['--global', '--harness', 'pi'], pi.sc);
  const r2 = runIn(pi, [pi.script, '--global', '--harness', 'pi', '--agents', 'architect,intern']);
  assert(r2.status === 0 && present(path.join(pp.primary, 'agents', 'intern.md')),
    `claim: intern is accepted for pi (exit ${r2.status})`);

  const rr = freshSource('claim-rerun');
  const base = [rr.script, '--global', '--harness', 'claude-code', '--agents', 'worker'];
  const first = runIn(rr, base);
  assert(first.status === 0, `claim: first install succeeds (exit ${first.status})`);
  const second = runIn(rr, base);
  assert(second.status === 1 && /--force/.test(second.stderr),
    `claim: re-running over an existing install without a terminal exits 1 and mentions --force (exit ${second.status})`);
  const forced = runIn(rr, [...base, '--force']);
  assert(forced.status === 0, `claim: re-running with --force succeeds (exit ${forced.status})`);
}

function checkSection(sec) {
  const commands = fencedLines(sec).filter((l) => /^node install\.js(\s|$)/.test(l));
  assert(commands.length >= 4, `Installation section has ${commands.length} node install.js commands in fenced blocks (expected at least 4)`);

  const helpEnv = freshSource('help');
  const help = runIn(helpEnv, [helpEnv.script, '--help']);
  assert(help.status === 0, `install.js --help exits 0 (got ${help.status})`);
  const helpFlags = new Set(help.stdout.match(/--[a-z][a-z-]*/g) || []);
  const docFlags = [...new Set(sec.match(/--[a-z][a-z-]*/g) || [])];
  assert(docFlags.length > 0, 'Installation section mentions flags');
  for (const f of docFlags) {
    assert(helpFlags.has(f), `flag ${f} mentioned in README exists in install.js --help`);
  }

  commands.forEach((cmd, i) => {
    const label = `[${i + 1}] ${cmd}`;
    const tokens = tokenize(cmd);
    assert(tokens[0] === 'node' && tokens[1] === 'install.js', `${label}: starts with node install.js`);
    assert(!/[<>|[\]]/.test(cmd), `${label}: is a concrete command (no placeholders)`);
    const rest = tokens.slice(2);
    const env = freshSource(`ex-${i + 1}`);
    const paths = expectedPaths(rest, env.sc);
    if (rest[0] === 'uninstall') checkUninstall(label, env, rest, paths);
    else if (!rest.includes('--agents') && !rest.includes('--agent-models')) checkInteractive(label, env, rest, paths);
    else checkInstall(label, env, rest, paths);
  });

  checkClaims();
}

try {
  const sec = section(fs.readFileSync(README, 'utf8'));
  assert(sec !== null, 'README.md has a "## Installation" section');
  if (sec !== null) checkSection(sec);
} catch (err) {
  console.error('FAIL: unexpected error', err);
  failed += 1;
} finally {
  sb.cleanup();
  if (sb.root && fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
  else console.log('OK: sandbox root removed by cleanup');
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll task 9.1 checks passed');
}
