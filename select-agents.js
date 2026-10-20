'use strict';

const path = require('path');
const defaultPrompts = require('prompts');

const INTERN_AGENT_ID = 'intern';
const INTERN_REQUIRES_PI_WARNING =
  'Warning: Intern agent requires the pi harness.';
const INTERN_REQUIRES_PI_PROMPT =
  'Deselect intern or change the harness to pi (or a custom path that includes .pi).';

/**
 * Full warning shown when intern is selected with a non-pi harness.
 * @returns {string}
 */
function formatInternRequiresPiMessage() {
  return `${INTERN_REQUIRES_PI_WARNING} ${INTERN_REQUIRES_PI_PROMPT}`;
}

/**
 * Whether the selected agent list includes intern on a harness that does not support it.
 *
 * @param {string[]} agents - Selected agent ids
 * @param {string|null|undefined} harness - Harness from `--harness`
 * @returns {boolean}
 */
function selectionIncludesInvalidIntern(agents, harness) {
  if (!Array.isArray(agents) || !agents.includes(INTERN_AGENT_ID)) {
    return false;
  }
  return !isPiHarness(harness);
}

/**
 * Whether the install target harness supports the intern agent (design Decision 3 / 6).
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
    description: 'pi-only: menial chores for other agents',
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
 * @param {boolean} [options.selectAllExceptIntern=true] - Initial selection in the prompt UI
 * @param {string} [options.harness] - When set and not pi, intern choice is disabled
 * @returns {Array<{ title: string, value: string, selected?: boolean, disabled?: boolean }>}
 */
function buildAgentSelectChoices(options = {}) {
  const { selectAllExceptIntern = true, harness } = options;
  const internAllowed = harness === undefined ? true : isPiHarness(harness);

  return AGENT_CATALOG.map((agent) => {
    const choice = {
      title: formatAgentChoiceTitle(agent),
      value: agent.id,
    };
    if (agent.id === INTERN_AGENT_ID && !internAllowed) {
      choice.disabled = true;
      choice.selected = false;
    } else if (selectAllExceptIntern) {
      choice.selected = agent.id !== INTERN_AGENT_ID;
    } else {
      choice.selected = true;
    }
    return choice;
  });
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
async function promptAgentSelection(options = {}) {
  const promptsImpl = options.promptsImpl || defaultPrompts;
  const choiceOptions = options.choiceOptions || {};
  const harness = choiceOptions.harness;
  const warn = options.warn || ((message) => console.warn(message));

  for (;;) {
    const question = buildAgentSelectPromptQuestion(choiceOptions);

    const response = await promptsImpl(question, {
      onCancel: () => true,
    });

    if (!response || !Array.isArray(response.agents)) {
      return null;
    }

    if (selectionIncludesInvalidIntern(response.agents, harness)) {
      warn(formatInternRequiresPiMessage());
      continue;
    }

    return response.agents;
  }
}

module.exports = {
  AGENT_CATALOG,
  INTERN_REQUIRES_PI_WARNING,
  INTERN_REQUIRES_PI_PROMPT,
  isPiHarness,
  formatAgentChoiceTitle,
  formatInternRequiresPiMessage,
  selectionIncludesInvalidIntern,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  promptAgentSelection,
};
