'use strict';

const path = require('path');
const defaultPrompts = require('prompts');

/**
 * Whether the install target harness is pi (pi-only files such as pi/agents/ are installed only for pi).
 *
 * @param {string|null|undefined} harness - Harness name or path from `--harness`
 * @returns {boolean}
 */
function isPiHarness(harness) {
  if (!harness || typeof harness !== 'string') {
    return false;
  }
  const trimmed = harness.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === 'pi') {
    return true;
  }
  const isCustomPath =
    trimmed.includes(path.sep) || trimmed.startsWith('/');
  if (isCustomPath) {
    return trimmed.includes(`${path.sep}.pi${path.sep}`) || trimmed.includes(`${path.sep}.pi`);
  }
  return trimmed.includes('pi');
}

/**
 * Catalog of installable agents (order matches interactive prompt).
 * @type {ReadonlyArray<{ id: string, description: string }>}
 */
const AGENT_CATALOG = Object.freeze([
  {
    id: 'architect',
    description: 'plan-time exploration, captures change artifacts',
  },
  {
    id: 'designer',
    description: 'plan-time interaction design, researches UX',
  },
  {
    id: 'worker',
    description: 'implements tasks',
  },
  {
    id: 'reviewer',
    description: 'audits worker diffs',
  },
  {
    id: 'supervisor',
    description: 'composition audit, interaction gate',
  },
  {
    id: 'intern',
    description: 'menial chores for other agents',
  },
]);

/**
 * Human-readable choice title for prompts multiselect (matches design.md Decision 6).
 * @param {{ id: string, description: string }} agent
 * @returns {string}
 */
function formatAgentChoiceTitle(agent) {
  return `${agent.id} (${agent.description})`;
}

/**
 * Build prompts multiselect `choices` for agent selection.
 * Exported for verification without a TTY.
 *
 * @param {object} [options]
 * @param {boolean} [options.selectAllAvailable=true] - Pre-select every agent
 * @returns {Array<{ title: string, value: string, selected: boolean }>}
 */
function buildAgentSelectChoices(options = {}) {
  const { selectAllAvailable = true } = options;

  return AGENT_CATALOG.map((agent) => ({
    title: formatAgentChoiceTitle(agent),
    value: agent.id,
    selected: selectAllAvailable,
  }));
}

/**
 * Build the prompts question object passed to `prompts()` for agent multi-select.
 *
 * @param {object} [options] - Same options as {@link buildAgentSelectChoices}
 * @returns {{ type: 'multiselect', name: string, message: string, choices: ReturnType<typeof buildAgentSelectChoices>, hint: string }}
 */
function buildAgentSelectPromptQuestion(options) {
  return {
    type: 'multiselect',
    name: 'agents',
    message: 'Select agents to include:',
    choices: buildAgentSelectChoices(options),
    hint: '- Space to select. Return to submit',
  };
}

/**
 * Run interactive multi-select for agents (requires TTY unless prompts is injected/mocked).
 *
 * @param {object} [options]
 * @param {typeof defaultPrompts} [options.promptsImpl] - Injectable prompts module for tests
 * @param {object} [options.choiceOptions] - Passed to {@link buildAgentSelectChoices}
 * @returns {Promise<string[]|null>} Selected agent ids, or null if user cancelled
 */
/** @type {ReadonlySet<string>} */
const KNOWN_AGENT_IDS = new Set(AGENT_CATALOG.map((agent) => agent.id));

/**
 * Resolve agent selection for non-interactive `--agents` (and future interactive default path).
 *
 * @param {object} options
 * @param {string[]|null|undefined} options.agents - Parsed `--agents` list; null/undefined means not provided (every agent is selected)
 * @returns {{ selectedAgents: string[]|null, errors: string[] }}
 */
function resolveSelectedAgents(options = {}) {
  const { agents } = options;
  const errors = [];

  if (agents === null || agents === undefined) {
    return {
      selectedAgents: AGENT_CATALOG.map((agent) => agent.id),
      errors,
    };
  }

  if (!Array.isArray(agents)) {
    errors.push('--agents: expected a list of agent ids');
    return { selectedAgents: null, errors };
  }

  if (agents.length === 0) {
    errors.push('--agents: at least one agent must be specified');
    return { selectedAgents: null, errors };
  }

  const unknown = [];
  const selectedAgents = [];
  const seen = new Set();

  for (const rawId of agents) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (id.length === 0) {
      continue;
    }
    if (!KNOWN_AGENT_IDS.has(id)) {
      unknown.push(id);
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      selectedAgents.push(id);
    }
  }

  if (unknown.length > 0) {
    const knownList = AGENT_CATALOG.map((agent) => agent.id).join(', ');
    errors.push(
      `--agents: unknown agent(s): ${unknown.join(', ')} (known: ${knownList})`
    );
    return { selectedAgents: null, errors };
  }

  if (selectedAgents.length === 0) {
    errors.push('--agents: at least one agent must be specified');
    return { selectedAgents: null, errors };
  }

  return { selectedAgents, errors };
}

async function promptAgentSelection(options = {}) {
  const promptsImpl = options.promptsImpl || defaultPrompts;
  const choiceOptions = options.choiceOptions || {};

  const response = await promptsImpl(buildAgentSelectPromptQuestion(choiceOptions), {
    onCancel: () => true,
  });

  if (!response || !Array.isArray(response.agents)) {
    return null;
  }

  return response.agents;
}

module.exports = {
  AGENT_CATALOG,
  KNOWN_AGENT_IDS,
  isPiHarness,
  formatAgentChoiceTitle,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  resolveSelectedAgents,
  promptAgentSelection,
};
