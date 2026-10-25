#!/usr/bin/env node
'use strict';
// Manual install-mode matrix for install.js (task 9.3).
//
// Runs every combination of
//   scope {global, local} x harness {pi, claude-code} x mode {copy, link} x agents {all, subset}
// which is 16 cells, and checks the installed layout of each one.
//
// Each cell runs in its own sandbox (verify-sandbox.js: a fresh temp HOME and temp cwd;
// the guard aborts if HOME resolves to the real home). The plugin source is copied to
// <sandbox cwd>/plugin-src and install.js runs from that copy with an empty stdin (not a TTY).
// The repository is never written to and install.js is never run outside a sandbox.
//
// Agent axis. Without --agents the agent prompt runs, and without --agent-models the model
// prompt runs too. stdin is never a TTY here, so either prompt would fail. So:
//   - "all": `--agent-models worker=sonnet` with NO --agents. A model map skips both prompts,
//     and with no --agents resolveSelectedAgents() selects every agent.
//     worker=sonnet is a real override, so the model path is exercised.
//   - "subset": `--agents architect,worker,reviewer` (source model defaults, no prompts).
//
// Layout checked per cell:
//   - exit 0 and the "Installation successful" line
//   - primary install: global -> ~/.claude/skills/five-role-team (both harnesses);
//     local -> ./.claude/skills/five-role-team (claude-code) or ./.pi/skills/five-role-team (pi)
//   - pi global only: ~/.pi/agent/skills/five-role-team is a symlink to the primary. Every other
//     cell has no such link (pi local creates no secondary location, per install.js)
//   - scope isolation: local cells write nothing under ~/.claude/skills; global cells write
//     nothing under ./.claude or ./.pi
//   - copy: the primary is a real directory; agents/ lists exactly the expected agents; each
//     installed agent file and .agent-config.json carry the expected model (worker=sonnet
//     expanded in "all", source defaults otherwise); .agent-config.json lists exactly the
//     expected agents with the right harness; pi/agents/ lists exactly the selected pi-only agents
//     (intern and worker) for pi cells, with their models; pi/ is absent in every claude-code copy cell
//   - link: the primary is a symlink resolving to the source copy; agents/ lists the same files
//     as the source agents/ (agent choice is not applied in symlink mode); no .agent-config.json
//     in the link or in the source
//     Known behaviour, deliberately not asserted as a failure: a link exposes the whole source
//     tree, so pi/ is reachable under a claude-code link too. The pi/ exclusion in design
//     Decision 3 is only enforced for copy installs.
//
// Coverage: the matrix is checked against an independent literal copy of the axis values
// (dropping an axis value fails), against the cell count of 16, and every expected cell key
// must actually have run (dropping a cell fails).
//
// Output: one PASS/FAIL line per cell, then COVERAGE and SUMMARY lines. Exit 0 only when every
// cell passes and coverage holds.
//
// INSTALL_MODES_SOURCE=<dir> copies the plugin source from <dir> instead of this checkout. It is
// (a sabotaged source must fail the script when this is set to a broken copy).
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const {
  copyPluginSource, installArgv, primaryPath, piSecondaryPath, cellsFrom, MATRIX, MATRIX_AXES, OVERRIDE, SUBSET,
} = require(path.join(__dirname, 'verify-matrix.js'));

const SOURCE = process.env.INSTALL_MODES_SOURCE
  ? path.resolve(process.env.INSTALL_MODES_SOURCE)
  : path.join(__dirname, '..');

// Independent literal copy of the axis values, used only by the coverage check. Kept here on
// purpose: it must not be derived from verify-matrix.js, or a dropped axis value would go unnoticed.
const EXPECTED_AXES = Object.freeze({
  scope: ['global', 'local'],
  harness: ['pi', 'claude-code'],
  mode: ['copy', 'link'],
  agents: ['all', 'subset'],
});
const EXPECTED_CELLS = 16;

// Agents installed for "all" (every agent) and for "subset".
const SUPPORTED = Object.freeze({
  'claude-code': ['architect', 'designer', 'intern', 'reviewer', 'supervisor', 'worker'],
  pi: ['architect', 'designer', 'intern', 'reviewer', 'supervisor', 'worker'],
});

// Agents that ship a pi-only file at pi/agents/<id>.md (installed for pi only, when selected).
const PI_AGENTS = Object.freeze(['intern', 'worker']);

// Same expansion as configure-models.js MODEL_ALIASES.
const MODEL_FULL = Object.freeze({
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
});

const sorted = (a) => [...a].sort();
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const expand = (v) => (v.includes('/') ? v : hasOwn(MODEL_FULL, v) ? MODEL_FULL[v] : v);

// lstat-based: true for a symlink even when its target is gone. null when absent.
function lstat(p) {
  try { return fs.lstatSync(p); } catch (err) { return null; }
}
const present = (p) => lstat(p) !== null;

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch (err) { return null; }
}

// Sorted names of the .md files directly in dir ([] when dir is absent).
function listMd(dir) {
  if (!present(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

// The `model:` value in a frontmatter file, or null.
function readModel(file) {
  const st = lstat(file);
  if (!st || !st.isFile()) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^model:[ \t]*(.*?)[ \t]*$/m);
  if (!m) return null;
  return m[1].replace(/^(['"])(.*)\1$/, '$2');
}

// Source default model for an agent, expanded. Same lookup order as install.js readDefaultModels.
function sourceDefault(id, src) {
  const candidates = [path.join(src, 'agents', `${id}.md`), path.join(src, 'pi', 'agents', `${id}.md`)];
  const file = candidates.find((c) => present(c));
  if (!file) return null;
  const v = readModel(file);
  return v === null ? null : expand(v);
}

// Expected model per agent for a cell (override applies only to the "all" cells).
function expectedModels(cell, expectedAgents, src) {
  const models = {};
  for (const id of expectedAgents) {
    if (cell.agents === 'all' && id === OVERRIDE.agent) {
      models[id] = expand(OVERRIDE.model);
    } else {
      models[id] = sourceDefault(id, src);
    }
  }
  return models;
}

// Run one cell. Returns { ok, checks, problems }. Never throws for a layout mismatch.
function runCell(sb, cell) {
  const problems = [];
  let checks = 0;
  const need = (cond, msg) => {
    checks += 1;
    if (!cond) problems.push(msg);
  };

  const sc = sb.scenario(`cell-${cell.key.replace(/\//g, '-')}`);
  const src = path.join(sc.cwd, 'plugin-src');
  copyPluginSource(src, SOURCE);

  const r = sb.run(installArgv(src, cell), { home: sc.home, cwd: sc.cwd });
  need(r.status === 0, `exit 0 (got ${r.status}): ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
  need(/^Installation successful/m.test(r.stdout), 'success message printed');
  if (r.status !== 0) return { ok: false, checks, problems };

  const primary = primaryPath(sc, cell);
  const pstat = lstat(primary);
  need(pstat !== null, `primary install present at ${primary}`);

  // Scope isolation.
  if (cell.scope === 'local') {
    need(!present(path.join(sc.home, '.claude', 'skills', 'five-role-team')),
      'local: nothing installed under ~/.claude/skills');
  } else {
    need(!present(path.join(sc.cwd, '.claude')) && !present(path.join(sc.cwd, '.pi')),
      'global: nothing installed under ./.claude or ./.pi');
  }

  // pi secondary location.
  const secondary = piSecondaryPath(sc.home);
  if (cell.scope === 'global' && cell.harness === 'pi') {
    const sst = lstat(secondary);
    need(sst !== null && sst.isSymbolicLink(), 'pi global: ~/.pi/agent/skills/five-role-team is a symlink');
    need(sst !== null && sst.isSymbolicLink() && path.resolve(path.dirname(secondary), fs.readlinkSync(secondary)) === path.resolve(primary),
      'pi global: the secondary symlink points to the primary install');
  } else {
    need(!present(secondary), 'no ~/.pi/agent/skills/five-role-team for this scope/harness');
  }

  const expectedAgents = sorted(cell.agents === 'subset' ? [...SUBSET] : SUPPORTED[cell.harness]);

  if (cell.mode === 'copy') {
    need(pstat !== null && pstat.isDirectory() && !pstat.isSymbolicLink(), 'copy: primary is a real directory');
    const agentsDir = path.join(primary, 'agents');
    const got = listMd(agentsDir);
    need(sameList(got, expectedAgents), `copy: agents/ lists exactly ${expectedAgents.join(',')} (got ${got.join(',')})`);

    const models = expectedModels(cell, expectedAgents, src);
    const cfgPath = path.join(primary, '.agent-config.json');
    const cst = lstat(cfgPath);
    need(cst !== null && cst.isFile(), 'copy: .agent-config.json written into the primary install');
    let cfg = null;
    if (cst !== null && cst.isFile()) {
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (err) { need(false, '.agent-config.json is valid JSON'); }
    }
    if (cfg) {
      need(sameList(sorted(cfg.agents || []), expectedAgents),
        `config: agents are exactly ${expectedAgents.join(',')}`);
      need(cfg.harness === cell.harness, `config: harness is ${cell.harness} (got ${cfg.harness})`);
      need(sameList(sorted(Object.keys(cfg.models || {})), expectedAgents), 'config: models cover exactly the expected agents');
      for (const id of expectedAgents) {
        need(cfg.models && cfg.models[id] === models[id],
          `config: ${id} model is ${models[id]} (got ${cfg.models ? cfg.models[id] : undefined})`);
      }
    }
    for (const id of expectedAgents) {
      const fm = readModel(path.join(agentsDir, `${id}.md`));
      need(fm === models[id], `frontmatter: ${id} model is ${models[id]} (got ${fm})`);
    }

    // pi-only agent files follow agent selection: pi/agents/<id>.md for each selected id in PI_AGENTS.
    const piAgents = cell.harness === 'pi' ? sorted(PI_AGENTS.filter((id) => expectedAgents.includes(id))) : [];
    if (piAgents.length > 0) {
      const piAgentsDir = path.join(primary, 'pi', 'agents');
      const gotPi = listMd(piAgentsDir);
      need(sameList(gotPi, piAgents), `pi: pi/agents/ lists exactly ${piAgents.join(',')} (got ${gotPi.join(',')})`);
      for (const id of piAgents) {
        const pfm = readModel(path.join(piAgentsDir, `${id}.md`));
        need(pfm === models[id], `pi: pi/agents/${id}.md model is ${models[id]} (got ${pfm})`);
      }
    } else {
      need(!present(path.join(primary, 'pi')), 'pi/ directory absent (claude-code, or no pi-only agent selected)');
    }
  } else {
    need(pstat !== null && pstat.isSymbolicLink(), 'link: primary is a symlink');
    need(realOrNull(primary) !== null && realOrNull(primary) === realOrNull(src),
      'link: primary resolves to the source copy');
    need(sameList(listMd(path.join(primary, 'agents')), listMd(path.join(src, 'agents'))),
      'link: agents/ lists the whole source agents directory (agent choice not applied)');
    need(!present(path.join(primary, '.agent-config.json')) && !present(path.join(src, '.agent-config.json')),
      'link: no .agent-config.json in the link or the source');
  }

  return { ok: problems.length === 0, checks, problems };
}

// Extra check outside the 16-cell matrix: a pi copy install with `--agents intern` must ship
// pi/agents/intern.md and must omit pi/agents/worker.md (worker not selected).
function runPiInternOnly(sb) {
  const problems = [];
  let checks = 0;
  const need = (cond, msg) => {
    checks += 1;
    if (!cond) problems.push(msg);
  };

  const sc = sb.scenario('pi-agents-intern-only');
  const src = path.join(sc.cwd, 'plugin-src');
  copyPluginSource(src, SOURCE);
  const argv = [path.join(src, 'install.js'), 'init', '--local', '--harness', 'pi', '--agents', 'intern'];
  const r = sb.run(argv, { home: sc.home, cwd: sc.cwd });
  need(r.status === 0, `exit 0 (got ${r.status}): ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
  if (r.status !== 0) return { ok: false, checks, problems };

  const primary = path.join(sc.cwd, '.pi', 'skills', 'five-role-team');
  need(sameList(listMd(path.join(primary, 'agents')), ['intern']), 'agents/ lists exactly intern');
  need(sameList(listMd(path.join(primary, 'pi', 'agents')), ['intern']),
    `pi/agents/ lists exactly intern (got ${listMd(path.join(primary, 'pi', 'agents')).join(',')})`);
  need(!present(path.join(primary, 'pi', 'agents', 'worker.md')), 'pi/agents/worker.md is NOT installed');
  return { ok: problems.length === 0, checks, problems };
}

function main() {
  const sb = createSandbox();
  const ran = [];
  let passed = 0;
  let failed = 0;
  let extraFailed = 0;
  let coverageOk = true;
  const coverageFail = (msg) => { coverageOk = false; console.log(`FAIL coverage: ${msg}`); };

  try {
    {
      let res;
      try {
        res = runPiInternOnly(sb);
      } catch (err) {
        res = { ok: false, checks: 0, problems: [`unexpected error: ${err && err.message ? err.message : err}`] };
      }
      if (res.ok) {
        console.log(`PASS extra pi/copy/local/--agents intern (${res.checks} checks)`);
      } else {
        extraFailed += 1;
        console.log('FAIL extra pi/copy/local/--agents intern');
        res.problems.forEach((p) => console.log(`  - ${p}`));
      }
    }
    for (const cell of MATRIX) {
      let res;
      try {
        res = runCell(sb, cell);
      } catch (err) {
        res = { ok: false, checks: 0, problems: [`unexpected error: ${err && err.message ? err.message : err}`] };
      }
      ran.push(cell.key);
      if (res.ok) {
        passed += 1;
        console.log(`PASS ${cell.key} (${res.checks} checks)`);
      } else {
        failed += 1;
        console.log(`FAIL ${cell.key}`);
        res.problems.forEach((p) => console.log(`  - ${p}`));
      }
    }
  } finally {
    sb.cleanup();
    if (fs.existsSync(sb.root)) coverageFail(`sandbox root ${sb.root} not removed`);
  }

  // Coverage: the matrix must be exactly the literal axes, and every expected cell must run.
  const axesMatch = ['scope', 'harness', 'mode', 'agents'].every((k) => sameList(MATRIX_AXES[k], EXPECTED_AXES[k]));
  if (!axesMatch) coverageFail('matrix axes differ from scope {global,local} x harness {pi,claude-code} x mode {copy,link} x agents {all,subset}');
  const expectedKeys = cellsFrom(EXPECTED_AXES).map((c) => c.key);
  if (expectedKeys.length !== EXPECTED_CELLS) coverageFail(`expected cell list has ${expectedKeys.length} cells, not ${EXPECTED_CELLS}`);
  if (MATRIX.length !== EXPECTED_CELLS) coverageFail(`matrix has ${MATRIX.length} cells, not ${EXPECTED_CELLS}`);
  const ranSet = new Set(ran);
  const missing = expectedKeys.filter((k) => !ranSet.has(k));
  if (missing.length > 0) coverageFail(`cells not exercised: ${missing.join(', ')}`);
  if (ran.length !== EXPECTED_CELLS) coverageFail(`exercised ${ran.length} cells, not ${EXPECTED_CELLS}`);
  if (coverageOk) console.log(`COVERAGE: ok, every one of the ${EXPECTED_CELLS} cells was exercised`);

  console.log(`SUMMARY: exercised ${ran.length} of ${EXPECTED_CELLS} install modes; ${passed} passed, ${failed} failed`);
  const ok = failed === 0 && extraFailed === 0 && coverageOk && ran.length === EXPECTED_CELLS;
  // exitCode rather than process.exit(): exit() can drop buffered output on pipes.
  process.exitCode = ok ? 0 : 1;
}

main();
