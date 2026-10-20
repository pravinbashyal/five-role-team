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
 * Validate that a model string is non-empty (after trimming).
 *
 * @param {*} value
 * @returns {true|string} true if valid, otherwise an error message
 */
function validateModel(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? true
    : 'Model must not be empty';
}

/**
 * Build the prompts question object for one agent's model.
 * The current default is shown in the message and pre-filled as `initial`,
 * so pressing enter accepts it. Agents without a default (e.g. intern, which
 * has no source file) show "no default" and start empty; an empty answer is
 * rejected by `validate`, so the user is re-prompted.
 *
 * @param {string} agentId
 * @param {string|undefined} defaultModel - Default model from source frontmatter, if any
 * @returns {{ type: 'text', name: string, message: string, initial: string, validate: function }}
 */
function buildModelPromptQuestion(agentId, defaultModel) {
  const hasDefault = typeof defaultModel === 'string' && defaultModel.length > 0;
  const expandedDefault = hasDefault ? expandModelName(defaultModel) : '';
  return {
    type: 'text',
    name: 'model',
    message: hasDefault
      ? `Model for ${agentId} (default: ${expandedDefault}):`
      : `Model for ${agentId} (no default):`,
    initial: expandedDefault,
    validate: validateModel,
  };
}

/**
 * Run interactive model prompts for each selected agent.
 *
 * @param {string[]} agentIds - Selected agent ids
 * @param {object} defaults - Map of agent id → default model (see readDefaultModels)
 * @param {object} [options]
 * @param {typeof defaultPrompts} [options.promptsImpl] - Injectable prompts module for tests
 * @returns {Promise<object|null>} Map of agent id → chosen model, or null if the user
 *   cancelled
 * @throws {Error} If an answer is empty (defence in depth; the prompt itself rejects it)
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

    if (validateModel(response.model) !== true) {
      throw new Error(`Model for ${id} must not be empty`);
    }
    models[id] = expandModelName(response.model);
  }

  return models;
}

/**
 * Resolve models non-interactively from parsed --agent-models overrides.
 * Overrides (expanded) win over source defaults (also expanded, matching the
 * interactive flow). Overrides for agents that are not selected are ignored.
 * Every selected agent must resolve to a non-empty model.
 *
 * @param {string[]} agentIds - Selected agent ids
 * @param {object} defaults - Map of agent id → default model (see readDefaultModels)
 * @param {object} agentModels - Map of agent id → model from parseArgs().agentModels
 * @returns {object} Map of agent id → resolved model
 * @throws {Error} If a selected agent has an empty/blank override, or no override
 *   and no default
 */
function resolveAgentModels(agentIds, defaults = {}, agentModels = {}) {
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const models = {};
  for (const id of agentIds) {
    const raw = has(agentModels, id) ? agentModels[id] : defaults[id];
    if (validateModel(raw) !== true) {
      throw new Error(`Model for ${id} must not be empty`);
    }
    models[id] = expandModelName(raw);
  }
  return models;
}

module.exports = {
  validateModel,
  expandModelName,
  resolveAgentModels,
  buildModelPromptQuestion,
  promptModelConfiguration,
};
