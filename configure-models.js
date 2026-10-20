'use strict';

const defaultPrompts = require('prompts');

const MODEL_ALIASES = {
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
};

/**
 * Expand a short model name to its full form.
 * `opus` and `sonnet` expand to full anthropic paths, `haiku` stays as-is,
 * and any other value (including full names containing `/`) is unchanged.
 *
 * @param {string} name
 * @returns {string}
 */
function expandModelName(name) {
  if (typeof name !== 'string') return name;
  const trimmed = name.trim();
  if (trimmed.includes('/')) return trimmed;
  return Object.prototype.hasOwnProperty.call(MODEL_ALIASES, trimmed)
    ? MODEL_ALIASES[trimmed]
    : trimmed;
}

/**
 * Build the prompts question object for one agent's model.
 * The current default is shown in the message and pre-filled as `initial`,
 * so pressing enter accepts it. Agents without a default (e.g. intern, which
 * has no source file) show "no default" and start empty.
 *
 * @param {string} agentId
 * @param {string|undefined} defaultModel - Default model from source frontmatter, if any
 * @returns {{ type: 'text', name: string, message: string, initial: string }}
 */
function buildModelPromptQuestion(agentId, defaultModel) {
  const hasDefault = typeof defaultModel === 'string' && defaultModel.length > 0;
  return {
    type: 'text',
    name: 'model',
    message: hasDefault
      ? `Model for ${agentId} (default: ${defaultModel}):`
      : `Model for ${agentId} (no default):`,
    initial: hasDefault ? defaultModel : '',
  };
}

/**
 * Run interactive model prompts for each selected agent.
 *
 * @param {string[]} agentIds - Selected agent ids
 * @param {object} defaults - Map of agent id → default model (see readDefaultModels)
 * @param {object} [options]
 * @param {typeof defaultPrompts} [options.promptsImpl] - Injectable prompts module for tests
 * @returns {Promise<object|null>} Map of agent id → chosen model (agents with an empty
 *   answer and no default are omitted), or null if the user cancelled
 */
async function promptModelConfiguration(agentIds, defaults = {}, options = {}) {
  const promptsImpl = options.promptsImpl || defaultPrompts;
  const models = {};

  for (const id of agentIds) {
    let cancelled = false;
    const response = await promptsImpl(
      buildModelPromptQuestion(id, defaults[id]),
      { onCancel: () => { cancelled = true; return false; } }
    );

    if (cancelled || !response) {
      return null;
    }

    const model = typeof response.model === 'string' ? response.model.trim() : '';
    if (model.length > 0) {
      models[id] = expandModelName(model);
    }
  }

  return models;
}

module.exports = {
  expandModelName,
  buildModelPromptQuestion,
  promptModelConfiguration,
};
