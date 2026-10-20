#!/usr/bin/env node
'use strict';

const { parseArgs, readDefaultModels, resolveAgentModels, resolveSelectedAgents, expandModelName } = require('./install.js');

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }

const ids = ['architect', 'worker', 'reviewer'];
const defaults = readDefaultModels(ids);
const parsed = parseArgs(['--agent-models', 'worker=sonnet,reviewer=opus']);
const models = resolveAgentModels(ids, defaults, parsed.agentModels);

assert(models.worker === 'anthropic/claude-sonnet-4-20250514', 'worker override sonnet expanded');
assert(models.reviewer === 'anthropic/claude-opus-4-5-20251101', 'reviewer override opus expanded');
assert(models.architect === resolveAgentModels(['architect'], defaults, {}).architect && !!models.architect, 'architect keeps expanded default');
assert(resolveAgentModels(['worker'], defaults, { worker: 'a/b' }).worker === 'a/b', 'full path unchanged');
assert(resolveAgentModels(['worker'], defaults, { worker: 'haiku' }).worker === 'haiku', 'haiku as-is');
assert(!('supervisor' in resolveAgentModels(['worker'], defaults, { supervisor: 'opus' })), 'unselected override ignored');
assert(models.worker !== defaults.worker, 'override differs from default');

// Composed pi default-selection flow (intern has pi/agents/intern.md default)
{
  const p = parseArgs(['--agent-models', 'worker=sonnet,reviewer=opus', '--global', '--harness', 'pi']);
  const sel = resolveSelectedAgents({ agents: p.agents, harness: p.harness });
  assert(sel.selectedAgents.includes('intern'), 'pi default selection includes intern');
  const d = readDefaultModels(sel.selectedAgents);
  assert(d.intern === 'haiku', 'intern has default from pi/agents/intern.md');
  let m = null, err = null;
  try { m = resolveAgentModels(sel.selectedAgents, d, p.agentModels); } catch (e) { err = e; }
  assert(!err && m, 'composed pi flow succeeds' + (err ? ': ' + err.message : ''));
  assert(m && m.intern === 'haiku' && m.worker === expandModelName('sonnet') && m.reviewer === expandModelName('opus'), 'intern default, overrides expanded');
}

process.exit(failed ? 1 : 0);
