#!/usr/bin/env node

/**
 * Five-Role Team Plugin Installation Script
 * 
 * Automates installation of the five-role-team plugin to AI assistant harnesses
 * with interactive agent selection and model configuration.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const prompts = require('prompts');

/**
 * Parse installation script command line arguments
 * 
 * Parses the following flags:
 * - --global: Install globally
 * - --local: Install locally to project
 * - --harness <name>: Specify harness name or path
 * - --link: Use symlink mode instead of copy
 * - --force: Force overwrite without confirmation
 * - --uninstall: Uninstall instead of install
 * - --agents <list>: Comma-separated list of agents (non-interactive mode)
 * - --agent-models <map>: Comma-separated key=value pairs for agent models (non-interactive mode)
 * 
 * @param {string[]} argv - Arguments array (without 'node' and script name)
 * @returns {object} Parsed arguments object with boolean properties and harness value:
 *   - global: boolean
 *   - local: boolean
 *   - harness: string or null
 *   - link: boolean
 *   - force: boolean
 *   - uninstall: boolean
 *   - agents: array or null (null if not provided, empty array if provided but empty)
 *   - agentModels: object (empty object {} if not provided). Values preserve any '=' characters.
 *   - errors: array of error messages
 * 
 * Validation:
 *   - Either --global or --local must be specified (exactly one, not both, not neither)
 *   - If --harness flag is provided without a value, an error is added
 *   - If --agents flag is provided without a value, an error is added
 *   - If --agent-models flag is provided without a value, an error is added
 *   - Malformed --agent-models pairs (no '=', empty key or value) add errors
 *   - Unknown flags are silently ignored
 */
function parseArgs(argv) {
  const parsed = {
    global: false,
    local: false,
    harness: null,
    link: false,
    force: false,
    uninstall: false,
    agents: null,
    agentModels: {},
    errors: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--global') {
      parsed.global = true;
    } else if (arg === '--local') {
      parsed.local = true;
    } else if (arg === '--harness') {
      // Get next argument as value. Value is required and must not look like a flag.
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        parsed.harness = argv[i + 1];
        i++; // Skip next argument since we consumed it as the harness value
      } else {
        // --harness without a value is an error
        parsed.errors.push('--harness requires a value (harness name or path)');
      }
    } else if (arg === '--link') {
      parsed.link = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--uninstall') {
      parsed.uninstall = true;
    } else if (arg === '--agents') {
      // Get next argument as value. Value is required and must not look like a flag.
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        const agentList = argv[i + 1];
        i++; // Skip next argument since we consumed it as the value
        // Parse comma-separated list, trim whitespace, drop empty strings
        parsed.agents = agentList
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else {
        // --agents without a value is an error
        parsed.errors.push('--agents requires a value (comma-separated list)');
      }
    } else if (arg === '--agent-models') {
      // Get next argument as value. Value is required and must not look like a flag.
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        const modelMap = argv[i + 1];
        i++; // Skip next argument since we consumed it as the value
        // Parse comma-separated key=value pairs
        parsed.agentModels = {};
        const pairs = modelMap.split(',');
        for (const pair of pairs) {
          const trimmed = pair.trim();
          if (trimmed.length === 0) continue; // Skip empty entries
          // Find first '=' to handle values containing '='
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex === -1) {
            parsed.errors.push(`--agent-models: malformed pair '${trimmed}' (must be key=value)`);
          } else {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            if (key.length === 0 || value.length === 0) {
              parsed.errors.push(`--agent-models: pair '${trimmed}' has empty key or value`);
            } else {
              parsed.agentModels[key] = value;
            }
          }
        }
      } else {
        // --agent-models without a value is an error
        parsed.errors.push('--agent-models requires a value (comma-separated key=value pairs)');
      }
    }
    // Unknown flags are silently ignored (as per task 2.1 scope)
  }

  // Validate that exactly one of --global or --local is provided (task 2.2)
  // However, skip this validation if --help is provided
  if (!argv.includes('--help') && !argv.includes('-h')) {
    if (!parsed.global && !parsed.local) {
      parsed.errors.push('Either --global or --local must be specified');
    } else if (parsed.global && parsed.local) {
      parsed.errors.push('--global and --local are mutually exclusive; specify only one');
    }
  }

  return parsed;
}

/**
 * Resolve harness name or path to the actual installation directory
 * 
 * Resolves the following patterns:
 * - 'pi' with global scope → ~/.claude/skills/
 * - 'claude-code' with global scope → ~/.claude/skills/
 * - 'pi' with local scope → ./.pi/skills/
 * - 'claude-code' with local scope → ./.claude/skills/
 * - custom path (contains '/' or ends with known dir name) → used as-is
 * 
 * For pi harness, also returns secondary symlink location
 * 
 * @param {string} harness - Harness name or path
 * @param {boolean} isGlobal - True for global scope, false for local
 * @returns {object} Resolved paths object:
 *   - base: string - base skills directory path (without /five-role-team/ suffix)
 *   - primary: string - primary installation path (base/five-role-team/)
 *   - secondary: string|null - secondary symlink path for pi (only for pi harness)
 * @throws {Error} if harness is empty or invalid
 */
function resolveHarnessPath(harness, isGlobal) {
  if (!harness || harness.trim().length === 0) {
    throw new Error('Harness name or path is required');
  }
  
  const trimmedHarness = harness.trim();
  const pluginName = 'five-role-team';
  
  // Detect if this is a custom path (contains '/' or is an absolute path)
  const isCustomPath = trimmedHarness.includes(path.sep) || trimmedHarness.startsWith('/');
  
  let basePath;
  let secondaryPath = null;
  
  if (isCustomPath) {
    // Custom path: use as-is
    basePath = trimmedHarness;
  } else if (trimmedHarness === 'pi') {
    if (isGlobal) {
      // Global pi: primary goes to ~/.claude/skills/, secondary symlink at ~/.pi/agent/skills/
      basePath = path.join(os.homedir(), '.claude', 'skills');
      secondaryPath = path.join(os.homedir(), '.pi', 'agent', 'skills');
    } else {
      // Local pi: goes to ./.pi/skills/
      basePath = path.join('.', '.pi', 'skills');
    }
  } else if (trimmedHarness === 'claude-code') {
    if (isGlobal) {
      // Global claude-code: ~/.claude/skills/
      basePath = path.join(os.homedir(), '.claude', 'skills');
    } else {
      // Local claude-code: ./.claude/skills/
      basePath = path.join('.', '.claude', 'skills');
    }
  } else {
    // Unknown harness name - treat as potential custom path
    basePath = trimmedHarness;
  }
  
  const primaryPath = path.join(basePath, pluginName);
  
  return {
    base: basePath,
    primary: primaryPath,
    secondary: secondaryPath ? path.join(secondaryPath, pluginName) : null
  };
}

/**
 * Read default models from source agent frontmatter files
 *
 * Looks up each agent's source file (agents/<id>.md, falling back to
 * pi/agents/<id>.md for pi-only agents) and extracts the `model:` value
 * from its YAML frontmatter.
 *
 * @param {string[]} agentIds - Agent ids to read defaults for
 * @param {string} [sourceDir] - Plugin source root (defaults to this script's directory)
 * @returns {object} Map of agent id → default model string (e.g. { worker: 'haiku' }).
 *   Agents with no source file or no `model:` field are omitted.
 */
function readDefaultModels(agentIds, sourceDir = __dirname) {
  const defaults = {};

  for (const id of agentIds) {
    const candidates = [
      path.join(sourceDir, 'agents', `${id}.md`),
      path.join(sourceDir, 'pi', 'agents', `${id}.md`)
    ];
    const file = candidates.find(candidate => fs.existsSync(candidate));
    if (!file) {
      continue;
    }

    const content = fs.readFileSync(file, 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) {
      continue;
    }

    const modelLine = frontmatter[1].match(/^model:[ \t]*(.*?)[ \t]*$/m);
    if (!modelLine) {
      continue;
    }

    const model = modelLine[1].replace(/^(['"])(.*)\1$/, '$2');
    if (model.length > 0) {
      defaults[id] = model;
    }
  }

  return defaults;
}

// Parse command line arguments
const args = process.argv.slice(2);

// Check for --help flag early
if (args.includes('--help') || args.includes('-h')) {
  showUsage();
  if (require.main === module) {
    process.exit(0);
  }
}

/**
 * Display usage information
 */
function showUsage() {
  console.log(`
Five-Role Team Plugin Installer

USAGE:
  node install.js [OPTIONS]

OPTIONS:
  --help, -h              Show this help message

  INSTALLATION SCOPE (required, mutually exclusive):
  --global                Install to global skills directory (~/.claude/skills/ or ~/.pi/agent/skills/)
  --local                 Install to local project skills directory (./.claude/skills/ or ./.pi/skills/)

  HARNESS (required):
  --harness <name|path>   Target harness: 'pi', 'claude-code', or custom path
                          - pi: Installs to ~/.claude/skills/ with symlink from ~/.pi/agent/skills/
                          - claude-code: Installs to ~/.claude/skills/
                          - custom: Uses provided path as installation directory

  INSTALLATION MODE:
  --link                  Create symlinks instead of copying files (development mode)
  --uninstall             Remove installed plugin and cleanup

  INTERACTIVE MODE (default):
  - Prompts for agent selection (architect, designer, worker, reviewer, supervisor, intern)
  - Prompts for model configuration for each selected agent

  NON-INTERACTIVE MODE:
  --agents <list>         Comma-separated list of agents to install (skips interactive prompt)
                          Example: --agents architect,worker,reviewer
  --agent-models <map>    Comma-separated key=value pairs for agent models (skips interactive prompt)
                          Example: --agent-models "worker=sonnet,reviewer=opus"
                          Short names: opus, sonnet, haiku (expanded to full model paths)

  OTHER OPTIONS:
  --force                 Skip overwrite confirmation for existing installations

EXAMPLES:
  # Interactive installation to pi (global)
  node install.js --global --harness pi

  # Interactive installation to claude-code (local)
  node install.js --local --harness claude-code

  # Non-interactive with specific agents and models
  node install.js --global --harness pi --agents architect,worker,reviewer --agent-models "worker=sonnet"

  # Development symlink installation
  node install.js --global --harness claude-code --link

  # Uninstall
  node install.js --uninstall --global --harness pi

AGENT OPTIONS:
  architect   - Plan-time exploration, captures change artifacts
  designer    - Plan-time interaction design, researches UX
  worker      - Implements tasks
  reviewer    - Audits worker diffs
  supervisor  - Composition audit, interaction gate
  intern      - Menial chores for other agents (pi harness only)

MODEL SHORT NAMES:
  opus        - anthropic/claude-opus-4-5-20251101
  sonnet      - anthropic/claude-sonnet-4-20250514
  haiku       - haiku (default short form)
  Full model paths (containing '/') are used as-is

CONFIGURATION:
  Installation creates .agent-config.json with selected agents and models
  alongside the installed plugin.
`);
}

/**
 * Main installation logic (currently: argument validation, agent selection and
 * model configuration; file installation is added by later tasks).
 *
 * Selection rules:
 * - --agents given: resolveSelectedAgents (non-interactive); otherwise, if
 *   --agent-models is given, all agents available for the harness are used
 *   without prompting; otherwise promptAgentSelection runs.
 * - --agent-models given: resolveAgentModels (non-interactive); otherwise
 *   promptModelConfiguration runs (also when only --agents was given).
 * - A null prompt result (user cancel) exits cleanly with code 0.
 * - Validation errors are printed as `Error: <message>` with exit code 1.
 *
 * @param {string[]} [argv] - Arguments (defaults to process.argv.slice(2))
 * @param {object} [options]
 * @param {object} [options.promptsImpl] - Injectable prompts module for tests
 * @param {string} [options.sourceDir] - Plugin source root for default models
 * @param {function} [options.log] - stdout logger (default console.log)
 * @param {function} [options.error] - stderr logger (default console.error)
 * @returns {Promise<{exitCode: number, selectedAgents: string[]|null, models: object|null, cancelled: boolean}>}
 */
async function main(argv = args, options = {}) {
  const log = options.log || console.log;
  const error = options.error || console.error;
  const sourceDir = options.sourceDir || __dirname;
  const promptsOption = options.promptsImpl ? { promptsImpl: options.promptsImpl } : {};
  const result = { exitCode: 0, selectedAgents: null, models: null, cancelled: false };
  const fail = (...lines) => {
    lines.forEach(line => error(line));
    result.exitCode = 1;
    return result;
  };

  const parsed = parseArgs(argv);
  
  // Check for parsing and validation errors
  if (parsed.errors.length > 0) {
    return fail('Error parsing arguments:', ...parsed.errors.map(err => '  - ' + err));
  }
  
  // If harness is provided, resolve and display paths for verification
  if (parsed.harness) {
    try {
      const resolved = resolveHarnessPath(parsed.harness, parsed.global);
      log('Harness path resolution:');
      log('  Base: ' + resolved.base);
      log('  Primary: ' + resolved.primary);
      if (resolved.secondary) {
        log('  Secondary (symlink): ' + resolved.secondary);
      }
    } catch (err) {
      return fail('Error resolving harness path: ' + err.message);
    }
  } else {
    log('Five-Role Team Plugin Installer');
    log('Installation logic coming soon...');
    log('Run with --help to see usage information.');
    return result;
  }

  const hasModelFlag = Object.keys(parsed.agentModels).length > 0;
  const cancel = () => {
    log('Installation cancelled.');
    result.cancelled = true;
    result.selectedAgents = null;
    result.models = null;
    return result;
  };

  try {
    // Agent selection (section 3)
    let selectedAgents;
    if (parsed.agents !== null || hasModelFlag) {
      const resolution = resolveSelectedAgents({ agents: parsed.agents, harness: parsed.harness });
      if (resolution.errors.length > 0) {
        return fail(...resolution.errors.map(msg => 'Error: ' + msg));
      }
      selectedAgents = resolution.selectedAgents;
    } else {
      selectedAgents = await promptAgentSelection({
        ...promptsOption,
        choiceOptions: { harness: parsed.harness }
      });
      if (selectedAgents === null) return cancel();
    }

    // Model configuration (section 4)
    const defaults = readDefaultModels(selectedAgents, sourceDir);
    let models;
    // Any flag skips the prompt it covers: --agent-models covers models, and
    // --agents covers both selection and model defaults (no model prompts).
    // Only with no flags at all do both prompts run.
    if (hasModelFlag || parsed.agents !== null) {
      models = resolveAgentModels(selectedAgents, defaults, parsed.agentModels);
    } else {
      models = await promptModelConfiguration(selectedAgents, defaults, promptsOption);
      if (models === null) return cancel();
    }

    result.selectedAgents = selectedAgents;
    result.models = models;
  } catch (err) {
    return fail('Error: ' + err.message);
  }

  log('Selected agents and models:');
  result.selectedAgents.forEach(id => log('  ' + id + ': ' + result.models[id]));

  // File installation (section 5). Uninstall is handled by a later section.
  if (parsed.uninstall) return result;
  if (parsed.link) {
    return fail('Error: --link (symlink mode) is not yet supported');
  }
  try {
    const resolved = resolveHarnessPath(parsed.harness, parsed.global);
    ensureInstallDirectories(resolved);
    const installSet = buildInstallSet(sourceDir, result.selectedAgents, parsed.harness);
    const written = copyInstall(sourceDir, resolved.primary, installSet, result.models);
    log('Installed ' + written.files.length + ' files to ' + written.target);
  } catch (err) {
    return fail('Error: ' + err.message);
  }
  return result;
}


const {
  AGENT_CATALOG,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  promptAgentSelection,
  resolveSelectedAgents,
} = require('./select-agents');
const { ensureInstallDirectories, buildInstallSet, copyInstall } = require('./install-files');
const {
  validateModel,
  expandModelName,
  buildModelPromptQuestion,
  promptModelConfiguration,
  resolveAgentModels,
} = require('./configure-models');

// Export functions for testing
module.exports = {
  parseArgs,
  resolveHarnessPath,
  readDefaultModels,
  AGENT_CATALOG,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  promptAgentSelection,
  resolveSelectedAgents,
  validateModel,
  expandModelName,
  buildModelPromptQuestion,
  promptModelConfiguration,
  resolveAgentModels,
  main,
};

// Run main if not showing help
if (require.main === module && !args.includes('--help') && !args.includes('-h')) {
  main().then(result => {
    if (result.exitCode !== 0) process.exit(result.exitCode);
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
