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
//
// Exit 0 only when every check passes.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const REPO = path.join(__dirname, '..');
const INSTALL = path.join(REPO, 'install.js');
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

function listAgents(primary) {
  const dir = path.join(primary, 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
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

function main() {
  const sb = createSandbox();
  try {
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
  } finally {
    sb.cleanup();
  }

  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  // exitCode rather than process.exit(): exit() can drop buffered output on pipes.
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
