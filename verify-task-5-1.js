#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Redirect HOME so installs never touch the real ~/.claude or ~/.pi.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-1-'));
const fakeHome = path.join(tmpRoot, 'home');
fs.mkdirSync(fakeHome);
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
const { main } = require('./install.js');

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }

async function run(argv, promptsImpl) {
  const out = []; const err = [];
  const r = await main(argv, { promptsImpl, log: (m) => out.push(m), error: (m) => err.push(m) });
  return { r, out: out.join('\n'), err: err.join('\n') };
}

(async () => {
  const base = ['--global', '--harness', 'pi'];

  // Flag-driven (pi default agents, intern default model from source)
  let x = await run([...base, '--agents', 'worker,intern', '--agent-models', 'worker=sonnet']);
  assert(x.r.exitCode === 0 && x.r.selectedAgents.join() === 'worker,intern', 'flag-driven: agents resolved');
  assert(x.r.models.worker === 'anthropic/claude-sonnet-4-20250514', 'flag-driven: worker override expanded');
  assert(x.r.models.intern === 'qwen3.5:4b-mlx', 'flag-driven: intern uses source default');
  assert(/worker: anthropic/.test(x.out), 'flag-driven: summary printed');

  // --agent-models only: no prompting, harness default agents
  const noPrompt = async () => { throw new Error('prompted'); };
  x = await run([...base, '--agent-models', 'worker=sonnet'], noPrompt);
  assert(x.r.exitCode === 0 && x.r.selectedAgents.includes('worker') && x.r.selectedAgents.includes('intern'), '--agent-models alone: no prompts, harness default agents');

  // Interactive with stubbed prompts
  const seen = [];
  const stub = async (q) => {
    seen.push(q.name);
    if (q.name === 'agents') return { agents: ['worker', 'intern'] };
    return { model: q.initial || 'haiku' };
  };
  x = await run(base, stub);
  assert(x.r.exitCode === 0 && x.r.selectedAgents.join() === 'worker,intern', 'interactive: selection from stub');
  assert(seen[0] === 'agents' && seen.filter(n => n === 'model').length === 2, 'interactive: agent prompt then one model prompt per agent');
  assert(x.r.models.intern === 'qwen3.5:4b-mlx', 'interactive: intern default accepted');

  // --agents only: no prompts at all; models from source defaults
  seen.length = 0;
  x = await run([...base, '--agents', 'worker'], stub);
  assert(x.r.exitCode === 0 && seen.length === 0, '--agents alone: no agent or model prompts run');
  assert(x.r.selectedAgents.join() === 'worker' && x.r.models.worker === 'haiku', '--agents alone: model is source default (agents/worker.md)');
  x = await run([...base, '--agents', 'worker,intern'], noPrompt);
  assert(x.r.exitCode === 0 && x.r.selectedAgents.join() === 'worker,intern', '--agents worker,intern (pi): never prompts');
  assert(x.r.models.worker === 'haiku' && x.r.models.intern === 'qwen3.5:4b-mlx', '--agents worker,intern (pi): worker=haiku, intern=qwen3.5:4b-mlx');

  // claude-code architect default from source (opus expanded)
  x = await run(['--global', '--harness', 'claude-code', '--agents', 'architect'], noPrompt);
  assert(x.r.exitCode === 0 && x.r.models.architect === 'anthropic/claude-opus-4-5-20251101', 'claude-code architect: default opus expanded exactly');

  // Cancel at agent prompt and at model prompt
  x = await run(base, async () => ({}));
  assert(x.r.exitCode === 0 && x.r.cancelled && x.r.selectedAgents === null && !x.err, 'cancel at agent prompt: clean exit');
  x = await run(base, async (q, o) => { if (q.name === 'agents') return { agents: ['worker'] }; o.onCancel(); return {}; });
  assert(x.r.exitCode === 0 && x.r.cancelled && !x.err, 'cancel at model prompt: clean exit');

  // Invalid inputs
  x = await run([...base, '--agents', 'worker', '--agent-models', 'worker=']);
  assert(x.r.exitCode === 1 && /empty/.test(x.err), 'empty --agent-models value: error');
  x = await run([...base, '--agents', 'ghost', '--agent-models', 'ghost=x']);
  assert(x.r.exitCode === 1 && /^Error: .*ghost/m.test(x.err), 'unknown agent: clear Error message');
  x = await run([...base, '--agents', 'ghost2', '--agent-models', 'worker=sonnet']);
  assert(x.r.exitCode === 1 && /^Error: .*ghost2/m.test(x.err) && !/\n\s+at /.test(x.err), 'ghost2: expected error message, no stack trace');
  x = await run(base, async (q) => q.name === 'agents' ? { agents: ['worker'] } : { model: '' });
  assert(x.r.exitCode === 1 && /^Error: Model for worker must not be empty$/m.test(x.err), 'empty interactive answer: clear error');

  // Real CLI: exit codes and no stack traces
  const cli = path.join(__dirname, 'install.js');
  let p = spawnSync('node', [cli, ...base, '--agents', 'worker,intern', '--agent-models', 'worker=sonnet'], { encoding: 'utf8' });
  assert(p.status === 0 && /intern: qwen3.5:4b-mlx/.test(p.stdout), 'CLI flag-driven pi run exits 0');
  p = spawnSync('node', [cli, ...base, '--agents', 'worker', '--agent-models', 'worker='], { encoding: 'utf8' });
  assert(p.status === 1 && !/\n\s+at /.test(p.stderr) && /Error/.test(p.stderr), 'CLI invalid --agent-models: exit 1, no stack trace');

  process.exit(failed ? 1 : 0);
})();
