'use strict';

const defaultPrompts = require('prompts');

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
 * @returns {Array<{ title: string, value: string, selected?: boolean }>}
 */
function buildAgentSelectChoices(options = {}) {
  const { selectAllExceptIntern = true } = options;

  return AGENT_CATALOG.map((agent) => {
    const choice = {
      title: formatAgentChoiceTitle(agent),
      value: agent.id,
    };
    if (selectAllExceptIntern) {
      choice.selected = agent.id !== 'intern';
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
  const question = buildAgentSelectPromptQuestion(options.choiceOptions);

  const response = await promptsImpl(question, {
    onCancel: () => true,
  });

  if (!response || !Array.isArray(response.agents)) {
    return null;
  }
  return response.agents;
}

module.exports = {
  AGENT_CATALOG,
  formatAgentChoiceTitle,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  promptAgentSelection,
};
