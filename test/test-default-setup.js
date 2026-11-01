#!/usr/bin/env node
'use strict';
// Default bundle and non-interactive `--default` checks for install.js (openspec change
// unify-npm-init-flow, task 2.1, design D2 and D5).
//
// Every run is a child process of install.js inside a sandbox (verify-sandbox.js): a fresh
// temp HOME and temp cwd per scenario, stdin empty (not a TTY). Nothing is written to the
// repository; install.js reads its own plugin source and writes only into the sandbox.
//
// Scenarios covered (names as in specs/cli/installation and specs/cli/npm-distribution):
//   - "[interaction] Default flag without a terminal"
//   - "[interaction] Default flag with overrides"
//   - "Default flag needs no other flag"
//   - "Default flag with explicit harness"
//   - "[interaction] Missing flags without a terminal"
//   - "[interaction] Existing install without a terminal"
//   - "Init in a project"
//   - "Init with global flag"
//   - D2 harness detection: pi when ./.pi exists and ./.claude does not (plus --agents override)
//   - D2 cursor harness detection (add-cursor-init-harness task 1.1)
//   - Default flag with explicit cursor harness
//   - OpenSpec CLI check (init-openspec-check task 1.2): --default warns without installing,
//     --default --install-openspec installs (and a failed install still exits 0), a present CLI
//     is a no-op, and a no-terminal run without the flag asks nothing
//
// Most runs are child processes of install.js (stdin empty, so not a TTY). The OpenSpec checks
// give each child a PATH that holds only stub `openspec` and `npm` binaries, so no real npm runs
// and a real openspec on this machine cannot change the result. One scenario calls main()
// in-process without the isTTY override (stdin of the test runner decides; npm test uses </dev/null).
//
// Exit 0 only when every check passes.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const { copyPluginSource } = require(path.join(__dirname, 'verify-matrix.js'));

const REPO = path.join(__dirname, '..');
const INSTALL = path.join(REPO, 'install.js');
const installer = require(INSTALL);
const {
  detectDefaultHarness,
  resolveHarnessPath,
  buildScopeQuestion,
} = installer;
const ALL_AGENTS = ['architect', 'designer', 'intern', 'reviewer', 'supervisor', 'worker'];

// Model aliases as documented in install.js --help (MODEL SHORT NAMES).
const ALIASES = {
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
};

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function expandAlias(model) {
  return Object.prototype.hasOwnProperty.call(ALIASES, model) ? ALIASES[model] : model;
}

// `model:` from the YAML frontmatter of an agent file, quotes stripped.
function frontmatterModel(file) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const line = fm[1].match(/^model:[ \t]*(.*?)[ \t]*$/m);
  if (!line) return null;
  return line[1].replace(/^(['"])(.*)\1$/, '$2');
}

// The default model of an agent, read from the source frontmatter and expanded.
function expectedDefaultModel(id) {
  const candidates = [path.join(REPO, 'agents', `${id}.md`), path.join(REPO, 'pi', 'agents', `${id}.md`)];
  const file = candidates.find((c) => fs.existsSync(c));
  return expandAlias(frontmatterModel(file));
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    return null;
  }
}

// Scenario-local bin directory used as the child's whole PATH. `npm` is always a stub that
// appends its argv to npmLog and exits with npmExit; `openspec` is a stub that exits 0 only
// when `openspec: true`, so "missing" means the command is not on PATH at all.
function stubBin(sc, { openspec = false, npmExit = 0 } = {}) {
  const dir = path.join(path.dirname(sc.home), 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const npmLog = path.join(dir, 'npm-calls.log');
  const stub = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  if (openspec) stub('openspec', 'exit 0');
  stub('npm', `echo "$@" >> "${npmLog}"\nexit ${npmExit}`);
  return { env: { PATH: dir }, npmLog };
}

// The npm argv lines the stub recorded ('' when npm was never run).
function npmCalls(npmLog) {
  return fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8').trim() : '';
}

const OPENSPEC_CMD = 'npm install -g @fission-ai/openspec';

function listAgents(primary) {
  const dir = path.join(primary, 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

function listFlatCursorAgents(agentsRoot) {
  if (!fs.existsSync(agentsRoot)) return [];
  return fs.readdirSync(agentsRoot).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

function checkCursorFlatAgents(label, agentsRoot, expectAgents, models) {
  const got = listFlatCursorAgents(agentsRoot);
  check(`${label}: .cursor/agents lists exactly ${expectAgents.join(',')}`,
    JSON.stringify(got) === JSON.stringify(expectAgents), `got ${got.join(',')}`);
  for (const id of expectAgents) {
    const fm = frontmatterModel(path.join(agentsRoot, `${id}.md`));
    check(`${label}: flat ${id}.md model is ${models[id]}`, fm === models[id], `got ${fm}`);
  }
}

function readConfig(primary) {
  return JSON.parse(fs.readFileSync(path.join(primary, '.agent-config.json'), 'utf8'));
}

// Sorted relative listing of everything under dir (empty string when dir is absent).
function snapshot(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push(r);
      if (e.isDirectory()) walk(path.join(d, e.name), r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort().join('\n');
}

// Check the installed copy: exact agent set, config agents/models/harness, frontmatter models.
function checkInstalled(label, primary, expect) {
  const agents = listAgents(primary);
  check(`${label}: agents/ lists exactly ${expect.agents.join(',')}`,
    JSON.stringify(agents) === JSON.stringify(expect.agents), `got ${agents.join(',')}`);

  const cfgFile = path.join(primary, '.agent-config.json');
  const cst = lstatOrNull(cfgFile);
  check(`${label}: .agent-config.json written`, cst !== null && cst.isFile());
  if (cst === null || !cst.isFile()) return;
  const cfg = readConfig(primary);
  check(`${label}: config harness is ${expect.harness}`, cfg.harness === expect.harness, `got ${cfg.harness}`);
  check(`${label}: config agents are exactly ${expect.agents.join(',')}`,
    JSON.stringify([...(cfg.agents || [])].sort()) === JSON.stringify(expect.agents));
  for (const id of expect.agents) {
    check(`${label}: config model for ${id} is ${expect.models[id]}`,
      cfg.models && cfg.models[id] === expect.models[id], `got ${cfg.models ? cfg.models[id] : undefined}`);
    const fm = frontmatterModel(path.join(primary, 'agents', `${id}.md`));
    check(`${label}: installed ${id}.md frontmatter model is ${expect.models[id]}`,
      fm === expect.models[id], `got ${fm}`);
  }
}

// Expected models for a list of agents: every agent at its source default, with overrides
// (full-form or alias values, expanded like install.js does) applied on top.
function expectedModels(agents, overrides = {}) {
  const models = {};
  for (const id of agents) {
    models[id] = Object.prototype.hasOwnProperty.call(overrides, id)
      ? expandAlias(overrides[id])
      : expectedDefaultModel(id);
  }
  return models;
}

// Run init and report whether it completed without cancelling (stdin is empty, so any
// prompt would be cancelled and print "Installation cancelled").
function runInstall(sb, sc, argv) {
  const r = sb.run([INSTALL, ...argv], { home: sc.home, cwd: sc.cwd });
  const ok = r.status === 0 && /^Installation successful/m.test(r.stdout) && !/Installation cancelled/.test(r.stdout);
  return { r, ok };
}

async function main() {
  const sb = createSandbox();
  try {
    // ---- In-process: resolveHarnessPath and detectDefaultHarness (task 1.1) ----
    {
      const local = resolveHarnessPath('cursor', false);
      check('resolveHarnessPath cursor local: primary under ./.cursor/skills',
        local.primary === path.join('.', '.cursor', 'skills', 'five-role-team'), local.primary);
      check('resolveHarnessPath cursor local: no secondary', local.secondary === null);
      check('resolveHarnessPath cursor local: not ./cursor/five-role-team',
        local.primary !== path.join('.', 'cursor', 'five-role-team'), local.primary);
      const sc = sb.scenario('resolve-cursor-global');
      sb.enter(sc);
      const global = resolveHarnessPath('cursor', true);
      check('resolveHarnessPath cursor global: primary under HOME/.cursor/skills',
        global.primary === path.join(sc.home, '.cursor', 'skills', 'five-role-team'), global.primary);
      sb.activate();
    }
    {
      const sc = sb.scenario('detect-cursor-only');
      fs.mkdirSync(path.join(sc.cwd, '.cursor'));
      check('detectDefaultHarness: cursor-only tree', detectDefaultHarness(sc.cwd) === 'cursor');
    }
    {
      const sc = sb.scenario('detect-mixed-cursor-claude');
      fs.mkdirSync(path.join(sc.cwd, '.cursor'));
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      check('detectDefaultHarness: .cursor + .claude -> claude-code',
        detectDefaultHarness(sc.cwd) === 'claude-code');
    }
    {
      const sc = sb.scenario('detect-cursor-pi');
      fs.mkdirSync(path.join(sc.cwd, '.cursor'));
      fs.mkdirSync(path.join(sc.cwd, '.pi'));
      check('detectDefaultHarness: .cursor + .pi without .claude -> pi',
        detectDefaultHarness(sc.cwd) === 'pi');
    }
    {
      const sc = sb.scenario('detect-pi-only');
      fs.mkdirSync(path.join(sc.cwd, '.pi'));
      check('detectDefaultHarness: .pi only -> pi', detectDefaultHarness(sc.cwd) === 'pi');
    }
    {
      const sc = sb.scenario('detect-no-markers');
      check('detectDefaultHarness: no markers -> claude-code', detectDefaultHarness(sc.cwd) === 'claude-code');
    }
    {
      const sc = sb.scenario('build-scope-cursor');
      sb.enter(sc);
      fs.mkdirSync(path.join(sc.cwd, '.cursor'));
      const q = buildScopeQuestion('cursor');
      const localTitle = q.choices[0].title;
      const globalTitle = q.choices[1].title;
      const expectLocal = path.join(sc.cwd, '.cursor', 'skills', 'five-role-team');
      check('buildScopeQuestion cursor: local choice names project path',
        localTitle.includes(expectLocal), localTitle);
      check('buildScopeQuestion cursor: global choice names ~/.cursor/skills path',
        globalTitle.includes('~/.cursor/skills/five-role-team'), globalTitle);
      sb.activate();
    }

    // ---- Default flag with explicit cursor harness ----
    {
      const sc = sb.scenario('default-explicit-cursor');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const { r, ok } = runInstall(sb, sc, ['init', '--default', '--harness', 'cursor']);
      check('default flag with explicit cursor harness: exit 0 with success', ok, `status ${r.status}`);
      const cursorPrimary = path.join(sc.cwd, '.cursor', 'skills', 'five-role-team');
      check('default flag with explicit cursor harness: installed under ./.cursor/skills',
        lstatOrNull(cursorPrimary) !== null);
      check('default flag with explicit cursor harness: no ./cursor/five-role-team stray path',
        lstatOrNull(path.join(sc.cwd, 'cursor', 'five-role-team')) === null);
      check('default flag with explicit cursor harness: no claude-code install written',
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) === null);
      checkInstalled('default flag with explicit cursor harness', cursorPrimary,
        { agents: ALL_AGENTS, harness: 'cursor', models: expectedModels(ALL_AGENTS) });
      check('default flag with explicit cursor harness: pi/ excluded',
        !fs.existsSync(path.join(cursorPrimary, 'pi')));
      checkCursorFlatAgents('default flag with explicit cursor harness',
        path.join(sc.cwd, '.cursor', 'agents'), ALL_AGENTS, expectedModels(ALL_AGENTS));
    }

    // ---- Cursor-only tree detects cursor (init --default) ----
    {
      const sc = sb.scenario('default-cursor-detect');
      fs.mkdirSync(path.join(sc.cwd, '.cursor'));
      const { r, ok } = runInstall(sb, sc, ['init', '--default']);
      check('default with ./.cursor only: exit 0 with success', ok, `status ${r.status}`);
      const primary = path.join(sc.cwd, '.cursor', 'skills', 'five-role-team');
      check('default with ./.cursor only: installed under ./.cursor/skills/five-role-team',
        lstatOrNull(primary) !== null);
      check('default with ./.cursor only: no ./cursor/five-role-team',
        lstatOrNull(path.join(sc.cwd, 'cursor', 'five-role-team')) === null);
      checkInstalled('default with ./.cursor only', primary,
        { agents: ALL_AGENTS, harness: 'cursor', models: expectedModels(ALL_AGENTS) });
      checkCursorFlatAgents('[interaction] Default installs into .cursor when detected',
        path.join(sc.cwd, '.cursor', 'agents'), ALL_AGENTS, expectedModels(ALL_AGENTS));
    }

    // ---- Place selected agents: local Cursor subset ----
    {
      const sc = sb.scenario('cursor-local-subset');
      const subset = ['architect', 'worker'];
      const { ok } = runInstall(sb, sc, ['init', '--default', '--local', '--harness', 'cursor', '--agents', subset.join(',')]);
      check('Local Cursor install copies selected agents: exit 0', ok);
      checkCursorFlatAgents('Local Cursor install copies selected agents',
        path.join(sc.cwd, '.cursor', 'agents'), subset, expectedModels(subset));
    }

    // ---- Place selected agents: global Cursor default ----
    {
      const sc = sb.scenario('cursor-global-default');
      const { ok } = runInstall(sb, sc, ['init', '--default', '--global', '--harness', 'cursor']);
      check('Global Cursor install copies selected agents: exit 0', ok);
      checkCursorFlatAgents('Global Cursor install copies selected agents',
        path.join(sc.home, '.cursor', 'agents'), ALL_AGENTS, expectedModels(ALL_AGENTS));
    }

    // ---- Cursor link install symlinks agent files ----
    {
      const sc = sb.scenario('cursor-link-agents');
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src, REPO);
      const r = sb.run([path.join(src, 'install.js'), 'init', '--local', '--harness', 'cursor', '--link'],
        { home: sc.home, cwd: sc.cwd });
      const ok = r.status === 0 && /^Installation successful/m.test(r.stdout);
      check('Cursor link install symlinks agent files: exit 0', ok, `status ${r.status}`);
      const flat = path.join(sc.cwd, '.cursor', 'agents');
      for (const id of ALL_AGENTS) {
        const linkPath = path.join(flat, `${id}.md`);
        const st = lstatOrNull(linkPath);
        check(`Cursor link install: ${id}.md is a symlink`, st !== null && st.isSymbolicLink());
        if (st && st.isSymbolicLink()) {
          check(`Cursor link install: ${id}.md points at source`,
            path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)) === path.join(src, 'agents', `${id}.md`));
        }
      }
    }

    // ---- Failed Cursor agent write rolls back skill and agents dir ----
    {
      const sc = sb.scenario('cursor-agent-rollback');
      const agentsDir = path.join(sc.cwd, '.cursor', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      const userWorker = '# user worker must survive failed install\n';
      fs.writeFileSync(path.join(agentsDir, 'worker.md'), userWorker);
      fs.mkdirSync(path.join(agentsDir, 'reviewer.md'));
      const r = sb.run([INSTALL, 'init', '--default', '--local', '--harness', 'cursor',
        '--agents', 'architect,worker,reviewer'], { home: sc.home, cwd: sc.cwd });
      check('failed Cursor agent write: install exits non-zero', r.status !== 0, `status ${r.status}`);
      check('failed Cursor agent write: partial rollback message',
        /Partial installation rolled back/.test(r.text), r.text.trim().split('\n').slice(-4).join(' | '));
      check('failed Cursor agent write: skill primary removed',
        lstatOrNull(path.join(sc.cwd, '.cursor', 'skills', 'five-role-team')) === null);
      check('failed Cursor agent write: architect.md not left behind',
        !fs.existsSync(path.join(agentsDir, 'architect.md')));
      check('failed Cursor agent write: user worker.md restored',
        fs.readFileSync(path.join(agentsDir, 'worker.md'), 'utf8') === userWorker);
      check('failed Cursor agent write: reviewer.md directory untouched',
        fs.lstatSync(path.join(agentsDir, 'reviewer.md')).isDirectory());
    }

    // ---- Link mode replaces existing Cursor agent dest names ----
    {
      const sc = sb.scenario('cursor-link-replace');
      const { ok: copyOk } = runInstall(sb, sc, ['init', '--default', '--local', '--harness', 'cursor', '--agents', 'worker']);
      check('cursor link replace: copy install ok', copyOk);
      const flatWorker = path.join(sc.cwd, '.cursor', 'agents', 'worker.md');
      check('cursor link replace: copy left worker.md as a file', lstatOrNull(flatWorker) !== null && !lstatOrNull(flatWorker).isSymbolicLink());
      const src = path.join(sc.cwd, 'plugin-src');
      copyPluginSource(src, REPO);
      const r = sb.run([path.join(src, 'install.js'), 'init', '--local', '--harness', 'cursor', '--link', '--force'],
        { home: sc.home, cwd: sc.cwd });
      const linkOk = r.status === 0 && /^Installation successful/m.test(r.stdout);
      check('cursor link replace: --force --link after copy succeeds', linkOk, `status ${r.status}: ${r.stderr.trim()}`);
      const st = lstatOrNull(flatWorker);
      check('cursor link replace: worker.md is now a symlink', st !== null && st.isSymbolicLink());
    }

    // ---- Uninstall cursor with nothing installed ----
    {
      const sc = sb.scenario('cursor-uninstall-empty');
      const r = sb.run([INSTALL, 'uninstall', '--local', '--harness', 'cursor'], { home: sc.home, cwd: sc.cwd });
      check('Uninstall cursor with nothing installed: exit 1', r.status === 1, `status ${r.status}`);
      check('Uninstall cursor with nothing installed: message',
        /Nothing to uninstall/.test(r.text), r.text.trim());
    }

    // ---- Uninstall cursor leaves unrelated agents-dir files ----
    {
      const sc = sb.scenario('cursor-uninstall-leaves-other');
      const { ok } = runInstall(sb, sc, ['init', '--default', '--local', '--harness', 'cursor', '--agents', 'worker']);
      check('cursor uninstall leaves other: install ok', ok);
      const flat = path.join(sc.cwd, '.cursor', 'agents');
      fs.writeFileSync(path.join(flat, 'custom-agent.md'), '# keep me\n');
      const u = sb.run([INSTALL, 'uninstall', '--local', '--harness', 'cursor'], { home: sc.home, cwd: sc.cwd });
      check('cursor uninstall leaves other: exit 0', u.status === 0, u.text.trim());
      check('cursor uninstall leaves other: worker.md removed', !fs.existsSync(path.join(flat, 'worker.md')));
      check('cursor uninstall leaves other: custom-agent.md remains', fs.existsSync(path.join(flat, 'custom-agent.md')));
      check('cursor uninstall leaves other: skill primary removed',
        lstatOrNull(path.join(sc.cwd, '.cursor', 'skills', 'five-role-team')) === null);
    }

    // ---- [interaction] Default flag without a terminal (claude-code, local) ----
    {
      const sc = sb.scenario('default-claude');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const { r, ok } = runInstall(sb, sc, ['init', '--default']);
      check('default flag without a terminal: exit 0 with success and no prompt', ok,
        `status ${r.status}: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      const st = lstatOrNull(primary);
      check('default flag without a terminal: installed as a real directory under ./.claude/skills', st !== null && st.isDirectory() && !st.isSymbolicLink());
      const models = expectedModels(ALL_AGENTS);
      checkInstalled('default flag without a terminal', primary, { agents: ALL_AGENTS, harness: 'claude-code', models });
      check('Claude Code install does not write Cursor agents',
        lstatOrNull(path.join(sc.cwd, '.cursor', 'agents')) === null);
      check('default flag without a terminal: nothing written under HOME', snapshot(sc.home) === '', snapshot(sc.home));
    }

    // ---- Default flag needs no other flag (empty cwd: claude-code, local) ----
    {
      const sc = sb.scenario('default-bare');
      const { r, ok } = runInstall(sb, sc, ['init', '--default']);
      check('default flag needs no other flag: exit 0 with success', ok, `status ${r.status}`);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      check('default flag needs no other flag: local scope, ./.claude/skills/five-role-team present',
        lstatOrNull(primary) !== null);
      check('default flag needs no other flag: no ./.pi created', lstatOrNull(path.join(sc.cwd, '.pi')) === null);
      check('default flag needs no other flag: nothing written under HOME', snapshot(sc.home) === '', snapshot(sc.home));
    }

    // ---- D2 detection: only ./.pi present -> pi harness, intern included ----
    {
      const sc = sb.scenario('default-pi-detect');
      fs.mkdirSync(path.join(sc.cwd, '.pi'));
      const { r, ok } = runInstall(sb, sc, ['init', '--default']);
      check('default with ./.pi only: exit 0 with success', ok, `status ${r.status}`);
      const primary = path.join(sc.cwd, '.pi', 'skills', 'five-role-team');
      check('default with ./.pi only: installed under ./.pi/skills/five-role-team', lstatOrNull(primary) !== null);
      check('default with ./.pi only: no ./.claude created', lstatOrNull(path.join(sc.cwd, '.claude')) === null);
      check('default with ./.pi only: pi/agents/intern.md installed',
        fs.existsSync(path.join(primary, 'pi', 'agents', 'intern.md')));
      checkInstalled('default with ./.pi only', primary,
        { agents: ALL_AGENTS, harness: 'pi', models: expectedModels(ALL_AGENTS) });
    }

    // ---- Default flag with explicit harness: ./.claude present, --harness pi wins ----
    {
      const sc = sb.scenario('default-explicit-pi');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const { r, ok } = runInstall(sb, sc, ['init', '--default', '--harness', 'pi']);
      check('default flag with explicit harness: exit 0 with success', ok, `status ${r.status}`);
      const piPrimary = path.join(sc.cwd, '.pi', 'skills', 'five-role-team');
      check('default flag with explicit harness: pi harness used, installed under ./.pi/skills',
        lstatOrNull(piPrimary) !== null);
      check('default flag with explicit harness: no claude-code install written',
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) === null);
      check('default flag with explicit harness: intern included (pi/agents/intern.md)',
        fs.existsSync(path.join(piPrimary, 'pi', 'agents', 'intern.md')));
      checkInstalled('default flag with explicit harness', piPrimary,
        { agents: ALL_AGENTS, harness: 'pi', models: expectedModels(ALL_AGENTS) });
    }

    // ---- [interaction] Default flag with overrides (global, worker=sonnet) ----
    {
      const sc = sb.scenario('default-global-override');
      const { r, ok } = runInstall(sb, sc, ['init', '--default', '--global', '--agent-models', 'worker=sonnet']);
      check('default flag with overrides: exit 0 with success', ok, `status ${r.status}`);
      const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
      check('default flag with overrides: installed under HOME/.claude/skills/five-role-team',
        lstatOrNull(primary) !== null);
      check('default flag with overrides: nothing written in the project cwd',
        snapshot(sc.cwd) === '', snapshot(sc.cwd));
      checkInstalled('default flag with overrides', primary, {
        agents: ALL_AGENTS,
        harness: 'claude-code',
        models: expectedModels(ALL_AGENTS, { worker: 'sonnet' }),
      });
    }

    // ---- --agents overrides the default agent set; models stay at defaults ----
    {
      const sc = sb.scenario('default-agents-override');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const { r, ok } = runInstall(sb, sc, ['init', '--default', '--agents', 'architect,worker']);
      check('default with --agents: exit 0 with success', ok, `status ${r.status}`);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      checkInstalled('default with --agents', primary, {
        agents: ['architect', 'worker'],
        harness: 'claude-code',
        models: expectedModels(['architect', 'worker']),
      });
    }

    // ---- [interaction] Missing flags without a terminal ----
    {
      const sc = sb.scenario('missing-flags');
      const beforeCwd = snapshot(sc.cwd);
      const beforeHome = snapshot(sc.home);
      const r = sb.run([INSTALL, 'init'], { home: sc.home, cwd: sc.cwd });
      check('missing flags: bare init without a terminal exits 1', r.status === 1, `status ${r.status}`);
      const firstSuggestion = (r.stderr.match(/five-role-team init[^\n]*/) || [''])[0];
      check('missing flags: first suggestion is `five-role-team init --default`',
        firstSuggestion.startsWith('five-role-team init --default'), firstSuggestion);
      check('missing flags: stderr never mentions node install.js', !/node install\.js/.test(r.text));
      check('missing flags: nothing written', snapshot(sc.cwd) === beforeCwd && snapshot(sc.home) === beforeHome);
    }
    {
      const sc = sb.scenario('missing-agents');
      const beforeCwd = snapshot(sc.cwd);
      const r = sb.run([INSTALL, 'init', '--harness', 'claude-code'], { home: sc.home, cwd: sc.cwd });
      check('missing agents: init --harness without a terminal exits 1', r.status === 1, `status ${r.status}`);
      const firstSuggestion = (r.stderr.match(/five-role-team init[^\n]*/) || [''])[0];
      check('missing agents: first suggestion is `five-role-team init --default`',
        firstSuggestion.startsWith('five-role-team init --default'), firstSuggestion);
      check('missing agents: nothing written', snapshot(sc.cwd) === beforeCwd && snapshot(sc.home) === '');
    }

    // ---- [interaction] Existing install without a terminal ----
    {
      const sc = sb.scenario('existing-install');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const first = runInstall(sb, sc, ['init', '--default']);
      check('existing install: first init --default succeeds', first.ok, `status ${first.r.status}`);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      const marker = path.join(primary, 'marker-task-2-1.txt');
      fs.writeFileSync(marker, 'keep me');
      const cfgBefore = fs.readFileSync(path.join(primary, '.agent-config.json'), 'utf8');
      const cwdBefore = snapshot(sc.cwd);
      const second = sb.run([INSTALL, 'init', '--default'], { home: sc.home, cwd: sc.cwd });
      check('existing install: second init --default without a terminal exits 1', second.status === 1, `status ${second.status}`);
      check('existing install: tells the user to re-run with --force', /--force/.test(second.stderr), second.stderr.trim());
      check('existing install: nothing changed (marker and config intact)',
        fs.existsSync(marker) && fs.readFileSync(path.join(primary, '.agent-config.json'), 'utf8') === cfgBefore);
      check('existing install: no other file changed', snapshot(sc.cwd) === cwdBefore);
    }

    // ---- Init in a project (explicit flags, no terminal) ----
    {
      const sc = sb.scenario('init-project');
      const { r, ok } = runInstall(sb, sc, ['init', '--harness', 'claude-code',
        '--agents', 'architect,worker,reviewer', '--agent-models', 'worker=sonnet']);
      check('init in a project: exit 0 with success and no prompt', ok, `status ${r.status}`);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      check('init in a project: installed to ./.claude/skills/five-role-team', lstatOrNull(primary) !== null);
      checkInstalled('init in a project', primary, {
        agents: ['architect', 'reviewer', 'worker'],
        harness: 'claude-code',
        models: expectedModels(['architect', 'reviewer', 'worker'], { worker: 'sonnet' }),
      });
      check('init in a project: nothing written under HOME', snapshot(sc.home) === '', snapshot(sc.home));
    }

    // ---- Init with global flag (pi, global, secondary symlink) ----
    {
      const sc = sb.scenario('init-global');
      const { r, ok } = runInstall(sb, sc, ['init', '--global', '--harness', 'pi',
        '--agents', 'architect,worker', '--agent-models', 'worker=sonnet']);
      check('init with global flag: exit 0 with success and no prompt', ok, `status ${r.status}`);
      const primary = path.join(sc.home, '.claude', 'skills', 'five-role-team');
      check('init with global flag: installed to HOME/.claude/skills/five-role-team', lstatOrNull(primary) !== null);
      const secondary = path.join(sc.home, '.pi', 'agent', 'skills', 'five-role-team');
      const sst = lstatOrNull(secondary);
      check('init with global flag: ~/.pi/agent/skills/five-role-team is a symlink to the primary',
        sst !== null && sst.isSymbolicLink() && path.resolve(path.dirname(secondary), fs.readlinkSync(secondary)) === path.resolve(primary));
      checkInstalled('init with global flag', primary, {
        agents: ['architect', 'worker'],
        harness: 'pi',
        models: expectedModels(['architect', 'worker'], { worker: 'sonnet' }),
      });
      check('init with global flag: nothing written in the project cwd', snapshot(sc.cwd) === '', snapshot(sc.cwd));
    }

    // ---- OpenSpec CLI check (init-openspec-check task 1.2) ----
    // A `--default` run with the CLI missing warns with the install command and never installs.
    {
      const sc = sb.scenario('openspec-default-missing');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const stub = stubBin(sc);
      const r = sb.run([INSTALL, 'init', '--default'], { home: sc.home, cwd: sc.cwd, env: stub.env });
      check('openspec --default missing: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}: ${r.stderr.trim()}`);
      check('openspec --default missing: warns with the install command',
        /OpenSpec CLI \(openspec\) was not found on PATH/.test(r.stdout) && r.stdout.includes('  Install it with: ' + OPENSPEC_CMD), r.stdout);
      check('openspec --default missing: no question asked', !/Install it now/.test(r.stdout), r.stdout);
      check('openspec --default missing: npm never run', npmCalls(stub.npmLog) === '', npmCalls(stub.npmLog));
      check('openspec --default missing: plugin stays installed',
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) !== null);
    }
    // `--default --install-openspec` installs the missing CLI with npm, without a question.
    {
      const sc = sb.scenario('openspec-default-flag');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const stub = stubBin(sc);
      const r = sb.run([INSTALL, 'init', '--default', '--install-openspec'], { home: sc.home, cwd: sc.cwd, env: stub.env });
      check('openspec --default --install-openspec: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}: ${r.stderr.trim()}`);
      check('openspec --default --install-openspec: npm install -g @fission-ai/openspec runs once',
        npmCalls(stub.npmLog) === 'install -g @fission-ai/openspec', npmCalls(stub.npmLog));
      check('openspec --default --install-openspec: success reported, no question',
        r.stdout.includes('OpenSpec CLI installed with ' + OPENSPEC_CMD + '.') && !/Install it now/.test(r.stdout), r.stdout);
      check('openspec --default --install-openspec: plugin installed',
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) !== null);
    }
    // A failed npm install prints the error and the manual command, and the install still exits 0.
    {
      const sc = sb.scenario('openspec-default-flag-fails');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const stub = stubBin(sc, { npmExit: 3 });
      const r = sb.run([INSTALL, 'init', '--default', '--install-openspec'], { home: sc.home, cwd: sc.cwd, env: stub.env });
      check('openspec flag install fails: exit 0 and plugin installed',
        r.status === 0 && /^Installation successful/m.test(r.stdout) &&
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) !== null, `status ${r.status}`);
      check('openspec flag install fails: error and manual command printed',
        r.stdout.includes('Warning: installing the OpenSpec CLI failed: npm install exited with status 3') &&
        r.stdout.includes('  Install it with: ' + OPENSPEC_CMD), r.stdout);
    }
    // A present CLI is a no-op: no npm call and nothing about OpenSpec in the output.
    {
      const sc = sb.scenario('openspec-default-flag-present');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const stub = stubBin(sc, { openspec: true });
      const r = sb.run([INSTALL, 'init', '--default', '--install-openspec'], { home: sc.home, cwd: sc.cwd, env: stub.env });
      check('openspec flag with CLI present: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}: ${r.stderr.trim()}`);
      check('openspec flag with CLI present: no install attempted', npmCalls(stub.npmLog) === '', npmCalls(stub.npmLog));
      check('openspec flag with CLI present: nothing about OpenSpec printed',
        !/OpenSpec CLI|@fission-ai\/openspec/.test(r.stdout), r.stdout);
    }
    // No terminal and no flag: the custom (non-default) init never asks and never installs.
    {
      const sc = sb.scenario('openspec-no-tty');
      const stub = stubBin(sc);
      const r = sb.run([INSTALL, 'init', '--harness', 'claude-code', '--agents', 'worker',
        '--agent-models', 'worker=sonnet'], { home: sc.home, cwd: sc.cwd, env: stub.env });
      check('openspec no terminal: exit 0 with success and no prompt', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}: ${r.stderr.trim()}`);
      check('openspec no terminal: warns with the install command, no question',
        /was not found on PATH/.test(r.stdout) && r.stdout.includes(OPENSPEC_CMD) && !/Install it now/.test(r.stdout), r.stdout);
      check('openspec no terminal: npm never run', npmCalls(stub.npmLog) === '', npmCalls(stub.npmLog));
    }
    // In-process main() with no isTTY override: the real stdin decides the terminal signal.
    // Missing CLI, no flag, injected detection and install so nothing real runs; any question
    // through promptsImpl is recorded, and the run must ask none and install nothing.
    {
      const sc = sb.scenario('openspec-main-no-tty');
      sb.enter(sc);
      const logs = [];
      const errors = [];
      const installCalls = [];
      const questions = [];
      const result = await installer.main(
        ['init', '--harness', 'claude-code', '--agents', 'worker', '--agent-models', 'worker=sonnet'],
        {
          log: (l) => logs.push(String(l)),
          error: (l) => errors.push(String(l)),
          detectOpenspec: () => false,
          runInstall: () => { installCalls.push('npm'); },
          promptsImpl: async (q) => { questions.push(q && q.message); return {}; },
        });
      const text = logs.join('\n');
      check('openspec main() no terminal: exit 0', result.exitCode === 0, `exit ${result.exitCode}: ${errors.join(' | ')}`);
      check('openspec main() no terminal: no OpenSpec question asked',
        questions.every((m) => !/OpenSpec CLI not found/.test(m || '')), JSON.stringify(questions));
      check('openspec main() no terminal: nothing installed', installCalls.length === 0, `${installCalls.length} calls`);
      check('openspec main() no terminal: warning with the install command printed',
        /OpenSpec CLI \(openspec\) was not found on PATH/.test(text) && text.includes(OPENSPEC_CMD), text);
      check('openspec main() no terminal: plugin installed',
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) !== null);
    }
  } finally {
    sb.cleanup();
  }

  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  // exitCode rather than process.exit(): exit() can drop buffered output on pipes.
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Error:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
