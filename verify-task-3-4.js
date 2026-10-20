#!/usr/bin/env node
'use strict';

const {
  AGENT_CATALOG,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  getAvailableAgentsForHarness,
  resolveSelectedAgents,
} = require('./select-agents');
const { parseArgs, resolveSelectedAgents: resolveFromInstall } = require('./install.js');

const ALL_AGENT_IDS = AGENT_CATALOG.map((agent) => agent.id);
const NON_PI_DEFAULT = ALL_AGENT_IDS.filter((id) => id !== 'intern');

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

function selectedIdsFromChoices(choices) {
  return choices.filter((c) => c.selected).map((c) => c.value);
}

assert(
  getAvailableAgentsForHarness('pi').join(',') === ALL_AGENT_IDS.join(','),
  'pi harness includes all six agents'
);
assert(
  getAvailableAgentsForHarness('claude-code').join(',') === NON_PI_DEFAULT.join(','),
  'claude-code harness excludes intern'
);
assert(
  getAvailableAgentsForHarness(undefined).join(',') === ALL_AGENT_IDS.join(','),
  'unspecified harness includes intern in available set'
);

const piChoices = buildAgentSelectChoices({ harness: 'pi' });
assert(
  selectedIdsFromChoices(piChoices).join(',') === ALL_AGENT_IDS.join(','),
  'interactive default selects all agents for pi'
);

const claudeChoices = buildAgentSelectChoices({ harness: 'claude-code' });
assert(
  selectedIdsFromChoices(claudeChoices).join(',') === NON_PI_DEFAULT.join(','),
  'interactive default selects all available agents for claude-code'
);

const defaultCatalogChoices = buildAgentSelectChoices();
assert(
  selectedIdsFromChoices(defaultCatalogChoices).join(',') === ALL_AGENT_IDS.join(','),
  'catalog default prompt pre-selects all agents including intern'
);

const piQuestion = buildAgentSelectPromptQuestion({ harness: 'pi' });
assert(
  selectedIdsFromChoices(piQuestion.choices).join(',') === ALL_AGENT_IDS.join(','),
  'prompt question default matches all agents for pi'
);

let result = resolveSelectedAgents({ agents: null, harness: 'claude-code' });
assert(result.errors.length === 0, 'null agents on claude-code has no errors');
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') === NON_PI_DEFAULT.join(','),
  'resolveSelectedAgents defaults to all available for claude-code'
);

result = resolveSelectedAgents({ agents: null, harness: 'pi' });
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') === ALL_AGENT_IDS.join(','),
  'resolveSelectedAgents defaults to all agents for pi'
);

const parsed = parseArgs(['--global', '--harness', 'claude-code']);
const fromArgv = resolveFromInstall({
  agents: parsed.agents,
  harness: parsed.harness,
});
assert(parsed.agents === null, 'parseArgs leaves agents null when flag omitted');
assert(
  fromArgv.selectedAgents &&
    fromArgv.selectedAgents.join(',') === NON_PI_DEFAULT.join(','),
  'install resolve path defaults when --agents omitted'
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log('\nAll task 3.4 checks passed.');
