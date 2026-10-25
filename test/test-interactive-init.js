#!/usr/bin/env node
'use strict';
// Interactive `init` flow for install.js (openspec change unify-npm-init-flow, task 3.1,
// design D1, D3, D4), checked with prompt injection.
//
// main() runs in this process with `isTTY: true` and a scripted `promptsImpl`. Each question
// is matched by its `name` against the script, so question order, labels, choices, initial
// (default) values and answers are all asserted. A question the script does not expect is
// recorded as a problem and cancelled. The process is pointed at a fresh sandbox HOME and cwd
// (verify-sandbox.js enter()) for every scenario and restored by cleanup().
//
// Scenarios covered (names as in specs/cli/installation and specs/cli/npm-distribution):
//   - "[interaction] Default summary and first question", "[interaction] Default summary shows detected pi harness"
//   - "[interaction] Choosing Default asks only scope"
//   - "[interaction] Flags given in a terminal skip their questions"
//   - "[interaction] Scope choices name real paths", "[interaction] Choosing all projects installs globally"
//   - "[interaction] Custom walks through harness, agents and models"
//   - "[interaction] Keeping default models skips per-agent prompts"
//   - "[interaction] Declining default models prompts per agent"
//   - "[interaction] Custom ends with a review"
//   - "[interaction] Cancel at the first question", "[interaction] Cancel at the scope question"
//   - "[interaction] Overwrite confirmation after Default" and re-running through the same flow
//   - "Install all agents by default", "Accept default models", "Configure architect model"
//   - "Symlink install for development" (--link asks only scope and harness)
//   - "[interaction] Default flag without a terminal" is covered by test-default-setup.js; here
//     --default in a terminal must also ask nothing
//
// Exit 0 only when every check passes.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const { main } = require(path.join(__dirname, '..', 'install.js'));

const REPO = path.join(__dirname, '..');
const ALL_AGENTS = ['architect', 'designer', 'intern', 'reviewer', 'supervisor', 'worker'];
const ALIASES = {
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
};
const CANCEL_LINE = 'Installation cancelled. Nothing was changed.';
const SETUP_TITLES = ['Default (recommended)', 'Custom'];

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

// `model:` from the YAML frontmatter of an agent source file, quotes stripped (same rule as install.js).
function expectedDefaultModel(id) {
  const candidates = [path.join(REPO, 'agents', `${id}.md`), path.join(REPO, 'pi', 'agents', `${id}.md`)];
  const file = candidates.find((c) => fs.existsSync(c));
  const fm = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = fm && fm[1].match(/^model:[ \t]*(.*?)[ \t]*$/m);
  return expandAlias(line ? line[1].replace(/^(['"])(.*)\1$/, '$2') : '');
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    return null;
  }
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

function listAgents(primary) {
  const dir = path.join(primary, 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

function readConfig(primary) {
  return JSON.parse(fs.readFileSync(path.join(primary, '.agent-config.json'), 'utf8'));
}

// Scripted prompts. `steps` are answered in order. A step is { name, answer, check? } where
// answer may be a function of the question (used to answer a model prompt with its own default),
// or the string 'cancel' (the user presses Ctrl-C or Esc on that question).
// `timeline` receives one entry per question, so question order can be compared with log lines.
function scripted(steps, timeline) {
  const state = { asked: [], problems: [] };
  let next = 0;
  const impl = async (question, opts = {}) => {
    const asked = {
      name: question.name,
      type: question.type,
      message: question.message,
      titles: (question.choices || []).map((c) => c.title),
      values: (question.choices || []).map((c) => c.value),
      selected: (question.choices || []).map((c) => c.selected === true),
      initial: question.initial,
    };
    state.asked.push(asked);
    timeline.push({ kind: 'question', name: question.name });
    const cancel = () => {
      if (opts.onCancel) opts.onCancel();
      return {};
    };
    const step = steps[next];
    next++;
    if (step === undefined) {
      state.problems.push(`unexpected question "${question.name}"`);
      return cancel();
    }
    if (step === 'cancel') return cancel();
    if (step.name !== question.name) {
      state.problems.push(`expected question "${step.name}" but got "${question.name}"`);
      return cancel();
    }
    if (step.check) {
      const problem = step.check(asked, question);
      if (problem) state.problems.push(problem);
    }
    const answer = typeof step.answer === 'function' ? step.answer(question) : step.answer;
    return { [question.name]: answer };
  };
  return { impl, state, remaining: () => steps.length - next };
}

// Run init in-process inside the scenario sandbox. Returns what the run did and asked.
async function runInit(sb, sc, argv, steps) {
  sb.enter(sc);
  const timeline = [];
  const errors = [];
  const s = scripted(steps, timeline);
  const result = await main(argv, {
    isTTY: true,
    promptsImpl: s.impl,
    log: (line) => timeline.push({ kind: 'log', text: String(line) }),
    error: (line) => errors.push(String(line)),
  });
  const logs = timeline.filter((e) => e.kind === 'log').map((e) => e.text);
  return {
    result,
    timeline,
    logs: logs.join('\n'),
    errors: errors.join('\n'),
    asked: s.state.asked,
    names: s.state.asked.map((q) => q.name),
    problems: s.state.problems,
    remaining: s.remaining(),
  };
}

// Question names asked, problems raised, and every scripted step consumed.
function checkQuestions(label, run, expectedNames) {
  check(`${label}: questions asked in order [${expectedNames.join(', ')}]`,
    JSON.stringify(run.names) === JSON.stringify(expectedNames), `got [${run.names.join(', ')}]`);
  check(`${label}: no prompt mismatch or unexpected question`, run.problems.length === 0, run.problems.join('; '));
  check(`${label}: every scripted answer was used`, run.remaining === 0, `${run.remaining} left`);
}

function checkInstalled(label, primary, expect) {
  const agents = listAgents(primary);
  check(`${label}: agents/ lists exactly ${expect.agents.join(',')}`,
    JSON.stringify(agents) === JSON.stringify(expect.agents), `got ${agents.join(',')}`);
  const cst = lstatOrNull(path.join(primary, '.agent-config.json'));
  check(`${label}: .agent-config.json written`, cst !== null && cst.isFile());
  if (cst === null || !cst.isFile()) return;
  const cfg = readConfig(primary);
  check(`${label}: config harness is ${expect.harness}`, cfg.harness === expect.harness, `got ${cfg.harness}`);
  for (const id of expect.agents) {
    check(`${label}: config model for ${id} is ${expect.models[id]}`,
      cfg.models && cfg.models[id] === expect.models[id], `got ${cfg.models ? cfg.models[id] : undefined}`);
  }
}

function defaultModels(agents, overrides = {}) {
  const models = {};
  for (const id of agents) {
    models[id] = Object.prototype.hasOwnProperty.call(overrides, id) ? expandAlias(overrides[id]) : expectedDefaultModel(id);
  }
  return models;
}

async function main_() {
  const sb = createSandbox();
  // The scenario cwd as the process sees it (realpath, so macOS /var -> /private/var matches).
  const realCwdOf = (sc) => fs.realpathSync(sc.cwd);
  try {
    // ---- Default or Custom is the first init question ----
    {
      // "[interaction] Default summary and first question": claude-code detected from ./.claude.
      const sc = sb.scenario('summary-claude');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'default', check: (q) => {
          if (JSON.stringify(q.titles) !== JSON.stringify(SETUP_TITLES)) return `setup choices were ${q.titles.join(' | ')}`;
          if (q.initial !== 0) return `setup initial was ${q.initial}, expected 0 (Default highlighted)`;
          if (q.message !== 'How do you want to set up five-role-team?') return `setup message was "${q.message}"`;
          return null;
        } },
        { name: 'scope', answer: 'local' },
      ]);
      checkQuestions('default summary and first question', run, ['setup', 'scope']);
      const firstQuestion = run.timeline.findIndex((e) => e.kind === 'question');
      const beforeFirst = run.timeline.slice(0, firstQuestion).map((e) => e.text).join('\n');
      check('default summary: printed before the first question', firstQuestion > 0 && /Default setup for five-role-team/.test(beforeFirst), beforeFirst);
      check('default summary: names harness claude-code and that it was detected',
        /Harness: claude-code \(detected from this directory\)/.test(beforeFirst), beforeFirst);
      const summaryLines = ALL_AGENTS.map((id) => `    ${id}: ${expectedDefaultModel(id)}`);
      check('default summary: lists every default agent with its default model',
        summaryLines.every((l) => beforeFirst.split('\n').includes(l)), beforeFirst);
      check('default summary: worker is haiku and reviewer is sonnet',
        /worker: haiku/.test(beforeFirst) && /reviewer: anthropic\/claude-sonnet/.test(beforeFirst), beforeFirst);
      check('default run: exit 0 with success', run.result.exitCode === 0 && /Installation successful/.test(run.logs), run.errors);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      // "Install all agents by default"
      checkInstalled('Install all agents by default', primary, {
        agents: ALL_AGENTS, harness: 'claude-code', models: defaultModels(ALL_AGENTS),
      });
    }
    {
      // "[interaction] Default summary shows detected pi harness": ./.pi only.
      const sc = sb.scenario('summary-pi');
      fs.mkdirSync(path.join(sc.cwd, '.pi'));
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'default' },
        { name: 'scope', answer: 'local' },
      ]);
      checkQuestions('pi summary', run, ['setup', 'scope']);
      const firstQuestion = run.timeline.findIndex((e) => e.kind === 'question');
      const beforeFirst = run.timeline.slice(0, firstQuestion).map((e) => e.text).join('\n');
      check('pi summary: names harness pi (detected)', /Harness: pi \(detected from this directory\)/.test(beforeFirst), beforeFirst);
      check('pi summary: includes intern with its default model',
        beforeFirst.split('\n').includes(`    intern: ${expectedDefaultModel('intern')}`), beforeFirst);
    }

    // ---- Scope question for every interactive init ----
    {
      // "[interaction] Scope choices name real paths" and "Choosing Default asks only scope".
      const sc = sb.scenario('scope-labels');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'default' },
        { name: 'scope', answer: 'local', check: (q) => {
          const localLabel = `This project (${realCwdOf(sc)}/.claude/skills/five-role-team)`;
          const globalLabel = 'All projects for this user (~/.claude/skills/five-role-team)';
          if (JSON.stringify(q.titles) !== JSON.stringify([localLabel, globalLabel])) {
            return `scope labels were ${q.titles.join(' | ')}`;
          }
          if (JSON.stringify(q.values) !== JSON.stringify(['local', 'global'])) return `scope values were ${q.values}`;
          if (q.initial !== 0) return `scope initial was ${q.initial}, expected 0 ("This project" preselected)`;
          if (q.message !== 'Where should five-role-team be installed?') return `scope message was "${q.message}"`;
          return null;
        } },
      ]);
      checkQuestions('scope labels (Default)', run, ['setup', 'scope']);
      check('Choosing Default asks only scope: installed in this project after the scope answer',
        lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) !== null && run.result.exitCode === 0);
      check('Choosing Default asks only scope: no harness, agent or model question',
        !run.names.some((n) => ['harness', 'agents', 'keepDefaults', 'model'].includes(n)));
    }
    {
      // "[interaction] Choosing all projects installs globally"
      const sc = sb.scenario('scope-global');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const before = snapshot(sc.cwd);
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'default' },
        { name: 'scope', answer: 'global' },
      ]);
      checkQuestions('all projects (Default)', run, ['setup', 'scope']);
      checkInstalled('all projects installs globally', path.join(sc.home, '.claude', 'skills', 'five-role-team'), {
        agents: ALL_AGENTS, harness: 'claude-code', models: defaultModels(ALL_AGENTS),
      });
      check('all projects: nothing added under the project cwd', snapshot(sc.cwd) === before, snapshot(sc.cwd));
    }

    // ---- Flags skip only their own question ----
    {
      // "[interaction] Flags given in a terminal skip their questions": --global removes scope only.
      const sc = sb.scenario('flags-global');
      const run = await runInit(sb, sc, ['init', '--global'], [
        { name: 'setup', answer: 'default' },
      ]);
      checkQuestions('init --global in a terminal', run, ['setup']);
      check('init --global: first question is still the setup question', run.names[0] === 'setup');
      checkInstalled('init --global installs to HOME', path.join(sc.home, '.claude', 'skills', 'five-role-team'), {
        agents: ALL_AGENTS, harness: 'claude-code', models: defaultModels(ALL_AGENTS),
      });
    }
    {
      // --local --agent-models: scope and the keep-models confirm are skipped, the harness and agents asked.
      const sc = sb.scenario('flags-custom');
      const run = await runInit(sb, sc, ['init', '--local', '--agent-models', 'worker=sonnet'], [
        { name: 'setup', answer: 'custom' },
        { name: 'harness', answer: 'claude-code', check: (q) => (q.initial === 1 ? null : `harness initial was ${q.initial}, expected 1 (claude-code detected)`) },
        { name: 'agents', answer: ['worker'] },
        { name: 'install', answer: true },
      ]);
      checkQuestions('--local --agent-models (Custom)', run, ['setup', 'harness', 'agents', 'install']);
      checkInstalled('--agent-models skips the keep-models question', path.join(sc.cwd, '.claude', 'skills', 'five-role-team'), {
        agents: ['worker'], harness: 'claude-code', models: defaultModels(['worker'], { worker: 'sonnet' }),
      });
    }
    {
      // --default in a terminal asks nothing at all (design D5).
      const sc = sb.scenario('default-flag-terminal');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const run = await runInit(sb, sc, ['init', '--default'], []);
      checkQuestions('init --default in a terminal', run, []);
      check('init --default in a terminal: installed in this project', run.result.exitCode === 0
        && lstatOrNull(path.join(sc.cwd, '.claude', 'skills', 'five-role-team')) !== null, run.errors);
    }

    // ---- Custom setup steps ----
    {
      // "[interaction] Custom walks through harness, agents and models" (with the Custom ends-with-review check)
      const sc = sb.scenario('custom-walk');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'custom' },
        { name: 'scope', answer: 'local' },
        { name: 'harness', answer: 'claude-code', check: (q) => {
          if (JSON.stringify(q.titles) !== JSON.stringify(['pi', 'claude-code', 'Custom path'])) return `harness choices were ${q.titles.join(' | ')}`;
          if (q.initial !== 1) return `harness initial was ${q.initial}, expected 1 (claude-code detected, preselected)`;
          return null;
        } },
        { name: 'agents', answer: ALL_AGENTS, check: (q) => {
          if (q.titles.length !== ALL_AGENTS.length) return `agent choices were ${q.titles.length}`;
          if (!q.selected.every((s) => s === true)) return 'not every agent was preselected';
          return null;
        } },
        { name: 'keepDefaults', answer: true, check: (q) => {
          if (q.message !== 'Keep default models? (Y/n)') return `keep question was "${q.message}"`;
          if (q.initial !== true) return 'keep default models was not initially Yes';
          return null;
        } },
        { name: 'install', answer: true, check: (q) => (q.message === 'Install? (Y/n)' && q.initial === true ? null : `install question was "${q.message}"`) },
      ]);
      checkQuestions('custom walk', run, ['setup', 'scope', 'harness', 'agents', 'keepDefaults', 'install']);
      const reviewAt = run.timeline.findIndex((e) => e.kind === 'log' && e.text === 'Review:');
      const installAt = run.timeline.findIndex((e) => e.kind === 'question' && e.name === 'install');
      check('custom: the review is shown before the Install question', reviewAt >= 0 && reviewAt < installAt);
      check('custom: exit 0 with success', run.result.exitCode === 0 && /Installation successful/.test(run.logs), run.errors);
      checkInstalled('custom walk installs every agent with defaults', path.join(sc.cwd, '.claude', 'skills', 'five-role-team'), {
        agents: ALL_AGENTS, harness: 'claude-code', models: defaultModels(ALL_AGENTS),
      });
    }
    {
      // "[interaction] Keeping default models skips per-agent prompts" and "Accept default models"
      const sc = sb.scenario('custom-keep');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'custom' },
        { name: 'scope', answer: 'local' },
        { name: 'harness', answer: 'claude-code' },
        { name: 'agents', answer: ['architect', 'worker'] },
        { name: 'keepDefaults', answer: true },
        { name: 'install', answer: true },
      ]);
      checkQuestions('keep default models', run, ['setup', 'scope', 'harness', 'agents', 'keepDefaults', 'install']);
      check('keep default models: no per-agent model prompt', !run.names.includes('model'));
      checkInstalled('Accept default models', path.join(sc.cwd, '.claude', 'skills', 'five-role-team'), {
        agents: ['architect', 'worker'], harness: 'claude-code', models: defaultModels(['architect', 'worker']),
      });
    }
    {
      // "[interaction] Declining default models prompts per agent" and "Configure architect model":
      // architect gets a new model, worker is accepted with Enter (its own default).
      const sc = sb.scenario('custom-per-agent');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'custom' },
        { name: 'scope', answer: 'local' },
        { name: 'harness', answer: 'claude-code' },
        { name: 'agents', answer: ['architect', 'worker'] },
        { name: 'keepDefaults', answer: false },
        { name: 'model', answer: 'sonnet', check: (q) => {
          const want = `Model for architect (default: ${expectedDefaultModel('architect')}):`;
          if (q.message !== want) return `architect prompt was "${q.message}", expected "${want}"`;
          if (q.initial !== expectedDefaultModel('architect')) return `architect initial was ${q.initial}`;
          return null;
        } },
        { name: 'model', answer: (q) => q.initial, check: (q) => {
          const want = `Model for worker (default: ${expectedDefaultModel('worker')}):`;
          return q.message === want ? null : `worker prompt was "${q.message}", expected "${want}"`;
        } },
        { name: 'install', answer: true },
      ]);
      checkQuestions('declining default models', run, ['setup', 'scope', 'harness', 'agents', 'keepDefaults', 'model', 'model', 'install']);
      checkInstalled('Configure architect model', path.join(sc.cwd, '.claude', 'skills', 'five-role-team'), {
        agents: ['architect', 'worker'], harness: 'claude-code',
        models: { architect: ALIASES.sonnet, worker: expectedDefaultModel('worker') },
      });
    }
    {
      // "[interaction] Custom ends with a review": decline at Install? writes nothing.
      const sc = sb.scenario('custom-review-decline');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const before = snapshot(sc.cwd) + '|' + snapshot(sc.home);
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'custom' },
        { name: 'scope', answer: 'local' },
        { name: 'harness', answer: 'claude-code' },
        { name: 'agents', answer: ['reviewer'] },
        { name: 'keepDefaults', answer: true },
        { name: 'install', answer: false },
      ]);
      checkQuestions('custom review decline', run, ['setup', 'scope', 'harness', 'agents', 'keepDefaults', 'install']);
      const reviewLines = run.logs.split('\n');
      const reviewAt = reviewLines.indexOf('Review:');
      const reviewBlock = reviewLines.slice(reviewAt, reviewAt + 5).join('\n');
      check('custom review: shows the resolved harness, the install path and the agent with its model',
        reviewAt >= 0 && /Harness: claude-code/.test(reviewBlock)
        && /Install path: .*\.claude\/skills\/five-role-team/.test(reviewBlock)
        && reviewLines.includes(`    reviewer: ${expectedDefaultModel('reviewer')}`), reviewBlock);
      check('custom review decline: prints the cancel line and exits 0',
        run.logs.split('\n').includes(CANCEL_LINE) && run.result.exitCode === 0 && run.result.cancelled === true, run.logs);
      check('custom review decline: nothing written', snapshot(sc.cwd) + '|' + snapshot(sc.home) === before);
    }

    // ---- Cancelling init changes nothing ----
    {
      // "[interaction] Cancel at the first question"
      const sc = sb.scenario('cancel-first');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const before = snapshot(sc.cwd) + '|' + snapshot(sc.home);
      const run = await runInit(sb, sc, ['init'], ['cancel']);
      check('cancel at the first question: prints the cancel line', run.logs.split('\n').includes(CANCEL_LINE), run.logs);
      check('cancel at the first question: exit 0', run.result.exitCode === 0, `got ${run.result.exitCode}`);
      check('cancel at the first question: no question after the cancel', run.names.length === 1, run.names.join(','));
      check('cancel at the first question: nothing created or removed', snapshot(sc.cwd) + '|' + snapshot(sc.home) === before);
    }
    {
      // "[interaction] Cancel at the scope question"
      const sc = sb.scenario('cancel-scope');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const before = snapshot(sc.cwd) + '|' + snapshot(sc.home);
      const run = await runInit(sb, sc, ['init'], [{ name: 'setup', answer: 'default' }, 'cancel']);
      check('cancel at the scope question: prints the cancel line', run.logs.split('\n').includes(CANCEL_LINE), run.logs);
      check('cancel at the scope question: exit 0', run.result.exitCode === 0, `got ${run.result.exitCode}`);
      check('cancel at the scope question: nothing created or removed', snapshot(sc.cwd) + '|' + snapshot(sc.home) === before);
    }

    // ---- Detect existing installations (re-running goes through the same flow) ----
    {
      const sc = sb.scenario('overwrite');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      sb.enter(sc);
      const first = await main(['init', '--default'], { isTTY: false, log: () => {}, error: () => {} });
      check('overwrite setup: first install succeeds', first.exitCode === 0, `got ${first.exitCode}`);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      const marker = path.join(primary, 'marker-task-3-1.txt');
      fs.writeFileSync(marker, 'keep me');
      const cfgBefore = fs.readFileSync(path.join(primary, '.agent-config.json'), 'utf8');

      // "[interaction] Overwrite confirmation after Default": answering No keeps the install.
      const run = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'default' },
        { name: 'scope', answer: 'local' },
        { name: 'overwrite', answer: false, check: (q) => {
          if (q.type !== 'confirm') return `overwrite question type was ${q.type}`;
          if (q.initial !== false) return 'overwrite was not defaulting to No';
          return /^Overwrite existing installation at .*\.claude\/skills\/five-role-team\?$/.test(q.message) ? null : `overwrite message was "${q.message}"`;
        } },
      ]);
      checkQuestions('overwrite after Default (No)', run, ['setup', 'scope', 'overwrite']);
      check('overwrite after Default: warns that five-role-team is already installed',
        /Warning: five-role-team is already installed at/.test(run.logs), run.logs);
      check('overwrite after Default (No): prints the cancel line and exits 0',
        run.logs.split('\n').includes(CANCEL_LINE) && run.result.exitCode === 0, run.logs);
      check('overwrite after Default (No): existing install untouched',
        fs.existsSync(marker) && fs.readFileSync(path.join(primary, '.agent-config.json'), 'utf8') === cfgBefore);

      // Re-running and accepting the overwrite installs again.
      const again = await runInit(sb, sc, ['init'], [
        { name: 'setup', answer: 'default' },
        { name: 'scope', answer: 'local' },
        { name: 'overwrite', answer: true },
      ]);
      checkQuestions('overwrite after Default (Yes)', again, ['setup', 'scope', 'overwrite']);
      check('overwrite after Default (Yes): exit 0 with success', again.result.exitCode === 0 && /Installation successful/.test(again.logs), again.errors);
      check('overwrite after Default (Yes): old marker removed, install replaced', !fs.existsSync(marker));
    }

    // ---- Symlink install for development: --link asks only scope and harness ----
    {
      const sc = sb.scenario('link-flags');
      const run = await runInit(sb, sc, ['init', '--global', '--harness', 'claude-code', '--link'], []);
      checkQuestions('--link with every question flagged', run, []);
      const linkPath = path.join(sc.home, '.claude', 'skills', 'five-role-team');
      const st = lstatOrNull(linkPath);
      check('symlink install: ~/.claude/skills/five-role-team is a symlink to the source',
        st !== null && st.isSymbolicLink() && path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)) === path.resolve(REPO),
        run.errors);
      check('symlink install: exit 0', run.result.exitCode === 0, run.errors);
    }
    {
      const sc = sb.scenario('link-terminal');
      const run = await runInit(sb, sc, ['init', '--link'], [
        { name: 'scope', answer: 'global' },
        { name: 'harness', answer: 'claude-code', check: (q) => (q.initial === 1 ? null : `harness initial was ${q.initial}`) },
      ]);
      checkQuestions('--link in a terminal', run, ['scope', 'harness']);
      check('--link in a terminal: no Default/Custom, agent or model question', !run.names.some((n) =>
        ['setup', 'agents', 'keepDefaults', 'model'].includes(n)));
      const linkPath = path.join(sc.home, '.claude', 'skills', 'five-role-team');
      const st = lstatOrNull(linkPath);
      check('--link in a terminal: symlink created at ~/.claude/skills/five-role-team',
        st !== null && st.isSymbolicLink(), run.errors);
    }
  } finally {
    sb.cleanup();
  }

  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  // exitCode rather than process.exit(): exit() can drop buffered output on pipes.
  process.exitCode = failed === 0 ? 0 : 1;
}

main_().catch((err) => {
  console.error('Error:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
