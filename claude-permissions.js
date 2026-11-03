'use strict';

// Claude Code permission allow-list written by `five-role-team init` and removed by `uninstall`
// (openspec change init-claude-permissions, design D1, D2, D4, D5, D8).
//
// Pure functions build the rule list, merge rules into parsed settings, and remove the plugin's
// agent rules. File wrappers read, merge and write one settings file and return a status object.
// The wrappers never throw. A problem with the file (unreadable, not JSON, wrong shape, or a failed
// write) yields status 'warned' with a reason, and the file is left byte-for-byte unchanged.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Agent rules this plugin writes. Uninstall removes exactly the rules matching this pattern (D8).
const AGENT_RULE_PATTERN = /^Agent\(five-role-team:[^)]+\)$/;

// Git Bash rules, written after the agent rules in this fixed order (D2). Uninstall keeps them.
const GIT_BASH_RULES = Object.freeze([
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git rev-parse:*)',
  'Bash(git log:*)',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Ordered allow-list rules for the given agent ids: one `Agent(five-role-team:<id>)` per id in the
 * order given, then the six git Bash rules.
 *
 * @param {string[]} agentIds
 * @returns {string[]}
 */
function buildPermissionRules(agentIds) {
  if (!Array.isArray(agentIds)) {
    throw new TypeError('agent ids must be an array');
  }
  const agentRules = agentIds.map((id) => {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TypeError('agent ids must be non-empty strings');
    }
    return `Agent(five-role-team:${id})`;
  });
  return [...agentRules, ...GIT_BASH_RULES];
}

// Throws when the parsed settings do not have the shape the merge and removal rely on.
function checkSettingsShape(settings) {
  if (!isPlainObject(settings)) {
    throw new Error('the file root is not a JSON object');
  }
  const perms = settings.permissions;
  if (perms !== undefined && !isPlainObject(perms)) {
    throw new Error('"permissions" is not an object');
  }
  if (perms !== undefined && perms.allow !== undefined && !Array.isArray(perms.allow)) {
    throw new Error('"permissions.allow" is not an array');
  }
}

/**
 * Append each rule that is not already present (exact string match) to `permissions.allow`.
 * Existing entries, their order and every other key are kept. The input is not mutated.
 * Throws when the settings shape is wrong.
 *
 * @param {object} settings - Parsed settings object
 * @param {string[]} rules - Rules to ensure are present
 * @returns {{settings: object, added: string[]}} the merged copy and the rules appended
 */
function mergeAllowRules(settings, rules) {
  checkSettingsShape(settings);
  const next = cloneJson(settings);
  const existing = next.permissions !== undefined && next.permissions.allow !== undefined
    ? next.permissions.allow
    : [];
  const added = [];
  for (const rule of rules) {
    if (!existing.includes(rule) && !added.includes(rule)) {
      added.push(rule);
    }
  }
  if (added.length === 0) {
    return { settings: next, added };
  }
  if (next.permissions === undefined) {
    next.permissions = {};
  }
  if (next.permissions.allow === undefined) {
    next.permissions.allow = [];
  }
  next.permissions.allow.push(...added);
  return { settings: next, added };
}

/**
 * Drop every `permissions.allow` entry that matches AGENT_RULE_PATTERN. Git Bash rules, other
 * entries and every other key are kept. The input is not mutated. Throws when the settings shape
 * is wrong.
 *
 * @param {object} settings - Parsed settings object
 * @returns {{settings: object, removed: string[]}} the trimmed copy and the rules removed
 */
function removeAgentRules(settings) {
  checkSettingsShape(settings);
  const next = cloneJson(settings);
  const removed = [];
  const allow = next.permissions !== undefined ? next.permissions.allow : undefined;
  if (!Array.isArray(allow)) {
    return { settings: next, removed };
  }
  next.permissions.allow = allow.filter((rule) => {
    if (typeof rule === 'string' && AGENT_RULE_PATTERN.test(rule)) {
      removed.push(rule);
      return false;
    }
    return true;
  });
  return { settings: next, removed };
}

/**
 * Absolute path of the settings file for a scope. Local is `<cwd>/.claude/settings.local.json`;
 * global is `<home>/.claude/settings.json`.
 *
 * @param {'local'|'global'} scope
 * @param {{cwd?: string, home?: string}} [opts] - Defaults to process.cwd() and os.homedir()
 * @returns {string}
 */
function settingsPathFor(scope, opts = {}) {
  if (scope === 'local') {
    return path.resolve(opts.cwd || process.cwd(), '.claude', 'settings.local.json');
  }
  if (scope === 'global') {
    return path.resolve(opts.home || os.homedir(), '.claude', 'settings.json');
  }
  throw new Error(`unknown settings scope: ${scope}`);
}

// Read and parse the settings file. A missing file is { exists: false, settings: {} }. Throws with
// a plain-language reason for every other problem.
function readSettingsFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { exists: false, settings: {} };
    }
    throw new Error(`cannot read the file (${err.message})`);
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (err) {
    throw new Error(`not valid JSON (${err.message})`);
  }
  return { exists: true, settings };
}

// Create the parent directory when missing, then write 2-space JSON with a trailing newline.
// writeFileSync writes through a symlink, so a linked settings file is updated in place.
function writeSettingsFile(file, settings) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    throw new Error(`cannot write the file (${err.message})`);
  }
}

/**
 * Merge the rules for `agentIds` into the settings file at `file`. Creates the file and its
 * `.claude/` directory when missing. Never throws.
 *
 * Status:
 * - 'added': `added` lists the rules appended and the file was written
 * - 'present': every rule was already there and the file was not written
 * - 'warned': the file was not changed; `reason` says why, and `rules` are the rules to add by hand
 *
 * @param {string} file - Settings file path (resolved to an absolute path in the result)
 * @param {string[]} agentIds
 * @returns {{status: 'added'|'present'|'warned', path: string, rules: string[], added: string[], reason?: string}}
 */
function applyClaudePermissions(file, agentIds) {
  const abs = path.resolve(file);
  let rules = [];
  try {
    rules = buildPermissionRules(agentIds);
    const loaded = readSettingsFile(abs);
    const merged = mergeAllowRules(loaded.settings, rules);
    if (merged.added.length === 0) {
      return { status: 'present', path: abs, rules, added: [] };
    }
    writeSettingsFile(abs, merged.settings);
    return { status: 'added', path: abs, rules, added: merged.added };
  } catch (err) {
    return { status: 'warned', path: abs, rules, added: [], reason: err.message };
  }
}

/**
 * Remove every `Agent(five-role-team:<id>)` rule from the settings file at `file`. A missing file
 * is left alone. Never throws.
 *
 * Status:
 * - 'removed': `removed` lists the rules dropped (empty when none matched, and then the file is
 *   not written)
 * - 'warned': the file was not changed; `reason` says why
 *
 * @param {string} file - Settings file path (resolved to an absolute path in the result)
 * @returns {{status: 'removed'|'warned', path: string, removed: string[], reason?: string}}
 */
function removeClaudePermissions(file) {
  const abs = path.resolve(file);
  try {
    const loaded = readSettingsFile(abs);
    if (!loaded.exists) {
      return { status: 'removed', path: abs, removed: [] };
    }
    const trimmed = removeAgentRules(loaded.settings);
    if (trimmed.removed.length === 0) {
      return { status: 'removed', path: abs, removed: [] };
    }
    writeSettingsFile(abs, trimmed.settings);
    return { status: 'removed', path: abs, removed: trimmed.removed };
  } catch (err) {
    return { status: 'warned', path: abs, removed: [], reason: err.message };
  }
}

module.exports = {
  AGENT_RULE_PATTERN,
  GIT_BASH_RULES,
  buildPermissionRules,
  mergeAllowRules,
  removeAgentRules,
  settingsPathFor,
  applyClaudePermissions,
  removeClaudePermissions,
};
