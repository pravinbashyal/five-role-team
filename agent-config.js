'use strict';

/**
 * Build the in-memory structure of the `.agent-config.json` file written at
 * install time. This is a pure function: it does not touch the filesystem.
 *
 * Shape (see design.md Decision 8):
 * {
 *   "agents": ["architect", "worker", ...],   // selected agent ids, in selection order
 *   "models": { "architect": "<model>", ... }, // one entry per selected agent
 *   "harness": "<name or custom path>",
 *   "installedAt": "<ISO 8601 timestamp>"
 * }
 *
 * @param {object} input
 * @param {string[]} input.agents - Selected agent ids (non-empty, no duplicates)
 * @param {Object<string,string>} input.models - Model per selected agent (non-empty strings)
 * @param {string} input.harness - Harness name or custom path as given on the CLI
 * @param {string} [input.installedAt] - ISO timestamp; defaults to the current time
 * @returns {{agents: string[], models: Object<string,string>, harness: string, installedAt: string}}
 * @throws {Error} when the input does not satisfy the configuration structure
 */
function buildAgentConfig(input) {
  if (input === null || typeof input !== 'object') {
    throw new Error('Agent config input must be an object');
  }
  const { agents, models, harness } = input;
  const installedAt = input.installedAt === undefined
    ? new Date().toISOString()
    : input.installedAt;

  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('Agent config requires a non-empty agents array');
  }
  const seen = new Set();
  for (const id of agents) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Agent config agents entries must be non-empty strings');
    }
    if (seen.has(id)) {
      throw new Error(`Agent config lists "${id}" more than once`);
    }
    seen.add(id);
  }

  if (models === null || typeof models !== 'object' || Array.isArray(models)) {
    throw new Error('Agent config requires a models object');
  }
  for (const id of agents) {
    const model = models[id];
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new Error(`Agent config has no non-empty model for "${id}"`);
    }
  }
  const modelKeys = Object.keys(models);
  for (const key of modelKeys) {
    if (!seen.has(key)) {
      throw new Error(`Agent config has a model for "${key}", which is not a selected agent`);
    }
  }

  if (typeof harness !== 'string' || harness.trim().length === 0) {
    throw new Error('Agent config requires a non-empty harness');
  }
  if (typeof installedAt !== 'string' || Number.isNaN(Date.parse(installedAt))) {
    throw new Error('Agent config installedAt must be an ISO 8601 timestamp string');
  }

  const orderedModels = {};
  for (const id of agents) orderedModels[id] = models[id];

  return {
    agents: agents.slice(),
    models: orderedModels,
    harness,
    installedAt,
  };
}

module.exports = {
  buildAgentConfig,
};
