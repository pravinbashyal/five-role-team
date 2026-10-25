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
 * - --default: Install the default setup with no setup questions (parsed here; behaviour in task 2.1)
 * - --verbose: Print per-directory copy lines (parsed here; behaviour in task 4.1)
 * - init: Subcommand (must be the first argument) that installs. Scope defaults to local.
 * - uninstall: Subcommand (must be the first argument) that removes the installed
 *   plugin instead of installing it: `five-role-team uninstall --global --harness pi`.
 *   `--uninstall` is not a flag: it is rejected as an unknown flag.
 *   `install` is no longer an alias: it is rejected as an unknown argument.
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
 *   - defaultSetup: boolean
 *   - verbose: boolean
 *   - uninstall: boolean
 *   - init: boolean
 *   - agents: array or null (null if not provided, empty array if provided but empty)
 *   - agentModels: object (empty object {} if not provided). Values preserve any '=' characters.
 *   - errors: array of error messages
 * 
 * Validation:
 *   - Either --global or --local must be specified (exactly one, not both, not neither)
 *   - --harness is required (unless --help is given)
 *   - If --harness flag is provided without a value, an error is added
 *   - If --agents flag is provided without a value, an error is added
 *   - If --agent-models flag is provided without a value, an error is added
 *   - Malformed --agent-models pairs (no '=', empty key or value) add errors
 *   - Unknown flags (any '-'-prefixed token that is not recognised, including --uninstall) add an error
 */
function parseArgs(argv) {
  const parsed = {
    global: false,
    local: false,
    harness: null,
    link: false,
    force: false,
    defaultSetup: false,
    verbose: false,
    uninstall: false,
    init: false,
    agents: null,
    agentModels: {},
    errors: []
  };

  // `init` and `uninstall` are the only subcommands, and they are only recognised
  // as the first argument. `init` installs into the current project directory
  // (local scope by default, `--global` overrides). With no subcommand nothing is
  // installed: main() prints usage instead.
  let tokens = argv;
  if (argv[0] === 'init') {
    parsed.init = true;
    tokens = argv.slice(1);
  } else if (argv[0] === 'uninstall') {
    parsed.uninstall = true;
    tokens = argv.slice(1);
  }

  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];

    if (arg === '--global') {
      parsed.global = true;
    } else if (arg === '--local') {
      parsed.local = true;
    } else if (arg === '--harness') {
      // Get next argument as value. Value is required and must not look like a flag.
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        parsed.harness = tokens[i + 1];
        i++; // Skip next argument since we consumed it as the harness value
      } else {
        // --harness without a value is an error
        parsed.errors.push('--harness requires a value (harness name or path)');
      }
    } else if (arg === '--link') {
      parsed.link = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--default') {
      parsed.defaultSetup = true;
    } else if (arg === '--verbose') {
      parsed.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      // Handled before parsing (see the early --help check); accepted here so it
      // is not reported as an unknown flag.
    } else if (arg === 'uninstall') {
      // Reached only when uninstall is not the first argument (index 0 is
      // stripped above). Rejected so it cannot silently fall through to an install.
      parsed.errors.push('uninstall must be the first argument (five-role-team uninstall --global|--local --harness <name|path>)');
    } else if (arg === 'install') {
      // The install alias was removed; install is now only `init`.
      parsed.errors.push('Unknown argument: install (the install command was removed; use "five-role-team init" to install, see "five-role-team --help")');
    } else if (arg === '--agents') {
      // Get next argument as value. Value is required and must not look like a flag.
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        const agentList = tokens[i + 1];
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
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        const modelMap = tokens[i + 1];
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
    } else if (arg.startsWith('-')) {
      // Any other flag-looking token is unknown. Rejected rather than ignored so a
      // removed or mistyped flag (e.g. the old --uninstall) cannot silently run
      // an install with the flag dropped.
      parsed.errors.push(`Unknown flag: ${arg} (run "five-role-team --help" for usage)`);
    } else {
      // Any bare token that is not a recognised flag, a consumed flag value, or the
      // leading uninstall (e.g. a typo such as `uninstal`) is an error. The grammar
      // has no other positional arguments, so it must not silently fall through to an install.
      parsed.errors.push(`Unknown argument: ${arg} (run "five-role-team --help" for usage)`);
    }
  }

  // `init` installs into the current project directory by default (local scope),
  // so when neither scope flag is given it defaults to local (task 2.1).
  if (parsed.init && !parsed.global && !parsed.local && !argv.includes('--help') && !argv.includes('-h')) {
    parsed.local = true;
  }

  // --global and --local are mutually exclusive (task 2.2). A missing scope is
  // NOT an error here: init defaults to local, and other forms prompt for it
  // on a TTY or fail with a hint without one (handled in main()).
  if (!argv.includes('--help') && !argv.includes('-h')) {
    if (parsed.global && parsed.local) {
      parsed.errors.push('--global and --local are mutually exclusive; specify only one');
    }
  }

  // --harness is required (design Decision 2) for install and uninstall alike;
  // the `--harness <value>` value check already ran in the loop above. A wholly
  // missing --harness is NOT an error here either: it is prompted on a TTY and
  // fails with a hint without one (handled in main()).

  // `uninstall` never prompts: restore the pre-task-2.2 required-flag errors so
  // a missing scope or harness is rejected at parse time (exit 1), exactly as
  // `git show 118042f:install.js` did.
  if (parsed.uninstall) {
    if (!parsed.global && !parsed.local) {
      parsed.errors.push('Either --global or --local must be specified');
    }
    if (!parsed.harness) {
      parsed.errors.push('--harness is required (harness name or path, e.g. --harness pi)');
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

    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read agent file ${file}: ${describeFsError(err)}`);
    }
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
 * Display usage information. Every line names `five-role-team`; only the `init`
 * and `uninstall` subcommands are listed.
 *
 * @param {function} [write] - Line writer (default console.log). Used by main()
 *   so usage printed on a failed run can go to stderr.
 */
function showUsage(write = console.log) {
  write(`
Five-Role Team Plugin Installer

USAGE:
  five-role-team init [OPTIONS]              Install into this project (asks Default or Custom first on a terminal)
  five-role-team init --default [OPTIONS]    Install the default setup with no questions
  five-role-team uninstall --global|--local --harness <name|path>
  five-role-team --help

  Running five-role-team with no subcommand prints this help and installs nothing.

OPTIONS:
  --help, -h              Show this help message

  SCOPE (init asks on a terminal unless given; defaults to local without a terminal; uninstall requires one):
  --global                Install for all projects (~/.claude/skills/; pi also symlinks from ~/.pi/agent/skills/)
  --local                 Install into this project (./.claude/skills/ or ./.pi/skills/)

  HARNESS (init asks on a terminal unless given or set by --default; uninstall requires it):
  --harness <name|path>   Target harness: 'pi', 'claude-code', or custom path
                          - pi: Installs to ~/.claude/skills/ with symlink from ~/.pi/agent/skills/
                          - claude-code: Installs to ~/.claude/skills/ (global) or ./.claude/skills/ (local)
                          - custom: Uses provided path as installation directory

  SETUP:
  --default               Install the default setup (detected harness, every agent, default models)
                          with no setup questions. --harness, --agents and --agent-models override
                          their part of the default.

  NON-INTERACTIVE MODE:
  --agents <list>         Comma-separated list of agents to install (skips the agent question)
                          Example: --agents architect,worker,reviewer
  --agent-models <map>    Comma-separated key=value pairs for agent models (skips the model questions)
                          Example: --agent-models "worker=sonnet,reviewer=opus"
                          Short names: opus, sonnet, haiku (expanded to full model paths)

  INSTALLATION MODE:
  --link                  Create symlinks instead of copying files (development mode)

  OTHER OPTIONS:
  --force                 Skip overwrite confirmation for existing installations
  --verbose               Print one "Copying ..." line per directory while installing

  UNINSTALL (subcommand, must be the first argument):
  uninstall               Remove the installed plugin for the given scope and harness.
                          A copy install is deleted, including .agent-config.json.
                          A --link install only loses its symlink; the source is never touched.
                          Exits 1 with "Nothing to uninstall" when nothing is installed.
                          Uses --global|--local and --harness. Other recognised options
                          (--link, --force, --default, --verbose, --agents, --agent-models) are
                          accepted but have no effect. Unknown flags or arguments are an error (exit 1).

  INTERACTIVE MODE (init on a terminal, without --default):
  - Asks "How do you want to set up five-role-team?": Default (recommended) or Custom
  - Then asks where to install (this project, or all projects for this user)
  - Custom also asks harness, agents and whether to keep the default models

EXAMPLES:
  # Install the default setup into this project
  five-role-team init --default

  # Install the default setup for all projects
  five-role-team init --default --global

  # Non-interactive with specific agents and models
  five-role-team init --global --harness pi --agents architect,worker,reviewer --agent-models "worker=sonnet"

  # Development symlink installation
  five-role-team init --global --harness claude-code --link

  # Uninstall
  five-role-team uninstall --global --harness pi

AGENT OPTIONS:
  architect   - Plan-time exploration, captures change artifacts
  designer    - Plan-time interaction design, researches UX
  worker      - Implements tasks
  reviewer    - Audits worker diffs
  supervisor  - Composition audit, interaction gate
  intern      - Menial chores for other agents

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
 * Warn about an existing installation (and/or a conflicting pi secondary
 * location) and ask whether to overwrite it.
 * Decline, cancel (Ctrl-C) or a missing answer resolve to false. When there is
 * no TTY and no promptsImpl is injected the question cannot be asked: that is
 * NOT a decline, so it throws an Error with code 'NON_INTERACTIVE' (callers
 * report it as a failure and point at --force).
 *
 * @param {{kind: string, path: string, linkTarget?: string}|null} existing - From detectExistingInstall (null when only the secondary conflicts)
 * @param {object} [options]
 * @param {object} [options.promptsImpl] - Injectable prompts module for tests
 * @param {function} [options.log] - Logger for the warning (default console.log)
 * @param {{kind: string, path: string, linkTarget?: string}|null} [options.secondary] - Conflicting pi secondary from detectSecondaryConflict
 * @returns {Promise<boolean>} true only on explicit confirmation
 * @throws {Error} code 'NON_INTERACTIVE' when no TTY is available to ask
 */
async function confirmOverwrite(existing, options = {}) {
  const log = options.log || console.log;
  const describe = (e) => e.kind === 'directory' ? 'directory'
    : e.kind === 'file' ? 'file'
    : e.kind === 'dangling-symlink' ? 'dangling symlink -> ' + e.linkTarget
    : 'symlink -> ' + e.linkTarget;
  const secondary = options.secondary || null;
  if (existing) {
    log('Warning: five-role-team is already installed at ' + existing.path + ' (' + describe(existing) + ').');
  }
  if (secondary) {
    log('Warning: the pi secondary location ' + secondary.path + ' already exists (' + describe(secondary) + ') and is not a link to the new installation.');
  }
  log('Continuing will remove ' + (existing && secondary ? 'both' : 'it') + ' and install again (the installed copy or link only; a symlink source is never deleted). Use --force to skip this prompt.');
  if (!options.promptsImpl && !(process.stdin && process.stdin.isTTY)) {
    const err = new Error('Non-interactive input: cannot confirm overwrite. Re-run with --force to overwrite without a prompt.');
    err.code = 'NON_INTERACTIVE';
    throw err;
  }
  const promptsImpl = options.promptsImpl || prompts;
  const names = [existing, secondary].filter(Boolean).map(e => e.path).join(' and ');
  const response = await promptsImpl({
    type: 'confirm',
    name: 'overwrite',
    message: 'Overwrite existing installation at ' + names + '?',
    initial: false
  }, { onCancel: () => true });
  return !!(response && response.overwrite === true);
}

/**
 * Copy-mode progress (task 8.1): one line per directory of the install set,
 * naming the files about to be copied into it, e.g.
 * "Copying agents: architect.md, worker.md". Top-level files are grouped as
 * "top-level". Only file entries are named; directory entries are not listed.
 *
 * @param {{path: string, type: 'file'|'dir'}[]} installSet - From buildInstallSet
 * @param {function} log - stdout logger
 */
function logCopyPlan(installSet, log) {
  const groups = new Map();
  for (const entry of installSet) {
    if (entry.type !== 'file') continue;
    const dir = path.posix.dirname(entry.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(path.posix.basename(entry.path));
  }
  for (const [dir, names] of groups) {
    log('Copying ' + (dir === '.' ? 'top-level' : dir) + ': ' + names.join(', '));
  }
}

/**
 * Success summary (task 8.2). Printed once, at the end of a successful install
 * (after the backup discard), so it is the last thing the run reports. Paths are
 * the absolute paths actually used. Never called on failure, rollback, cancel or
 * uninstall.
 *
 * @param {function} log - stdout logger
 * @param {object} s
 * @param {string} s.primary - Absolute installed (or linked) plugin path
 * @param {string|null} s.secondary - Absolute pi secondary symlink path, or null
 * @param {string|null} s.linkSource - Absolute source directory (link mode only)
 * @param {string|null} s.cfgPath - Absolute .agent-config.json path (copy mode only)
 * @param {boolean} s.link - True for --link (symlink) mode
 * @param {boolean} s.global - True for global scope
 * @param {string} s.harness - Harness name or path as given on the CLI
 * @param {string[]} s.selectedAgents - Selected agent ids, in selection order
 * @param {object} s.models - Model per selected agent (as written to the config)
 */
function logInstallSummary(log, s) {
  if (s.link) {
    log('Installation successful: five-role-team linked at ' + s.primary + ' -> ' + s.linkSource);
  } else {
    log('Installation successful: five-role-team installed at ' + s.primary);
  }
  log('  Mode: ' + (s.link ? 'symlink (--link)' : 'copy') + ', ' + (s.global ? 'global' : 'local') + ' scope, harness ' + s.harness);
  if (s.secondary) log('  Pi secondary symlink: ' + s.secondary + ' -> ' + s.primary);
  if (s.link) {
    log('  Configuration file: none (no .agent-config.json is written in symlink mode)');
    log('  Agents: the whole source directory is linked; agent selection and model configuration are not applied');
  } else {
    log('  Configuration file: ' + s.cfgPath);
    log('  Agents and models:');
    s.selectedAgents.forEach(id => log('    ' + id + ': ' + s.models[id]));
  }
}

/**
 * Prompt for a missing installation scope on a TTY (select global or local).
 *
 * @param {object} [options]
 * @param {object} [options.promptsImpl] - Injectable prompts module for tests
 * @returns {Promise<'global'|'local'|null>} chosen scope, or null on cancel
 */
async function promptScopeSelection(options = {}) {
  const promptsImpl = (options && options.promptsImpl) || (typeof prompts !== 'undefined' ? prompts : require('prompts'));
  let cancelled = false;
  const response = await promptsImpl(
    {
      type: 'select',
      name: 'scope',
      message: 'Select installation scope:',
      choices: [
        { title: 'Global (user-wide install)', value: 'global' },
        { title: 'Local (project directory)', value: 'local' },
      ],
    },
    { onCancel: () => { cancelled = true; return true; } }
  );
  if (cancelled || !response) return null;
  return response.scope === 'global' || response.scope === 'local' ? response.scope : null;
}

/**
 * Prompt for a missing harness on a TTY (select pi / claude-code / custom path).
 *
 * @param {object} [options]
 * @param {object} [options.promptsImpl] - Injectable prompts module for tests
 * @returns {Promise<string|null>} chosen harness string, or null on cancel
 */
async function promptHarnessSelection(options = {}) {
  const promptsImpl = (options && options.promptsImpl) || (typeof prompts !== 'undefined' ? prompts : require('prompts'));
  let cancelled = false;
  const response = await promptsImpl(
    {
      type: 'select',
      name: 'harness',
      message: 'Select harness:',
      choices: [
        { title: 'pi', value: 'pi' },
        { title: 'claude-code', value: 'claude-code' },
        { title: 'Custom path', value: '__custom__' },
      ],
    },
    { onCancel: () => { cancelled = true; return true; } }
  );
  if (cancelled || !response) return null;
  if (response.harness === 'pi' || response.harness === 'claude-code') return response.harness;
  if (response.harness !== '__custom__') return null;
  let cCancelled = false;
  const cResponse = await promptsImpl(
    { type: 'text', name: 'path', message: 'Custom harness path:' },
    { onCancel: () => { cCancelled = true; return true; } }
  );
  if (cCancelled || !cResponse) return null;
  const p = cResponse.path;
  if (typeof p !== 'string' || p.trim().length === 0) return null;
  return p.trim();
}

/**
 * Main installation logic: argument validation, agent selection, model
 * configuration, then file installation (copy or --link, pi secondary link,
 * existing-install handling with backup/rollback). The uninstall subcommand
 * is handled before any prompt and never asks anything.
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
 * @param {boolean} [options.isTTY] - Test-only override for the interactive (TTY) signal
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

  // --help is answered here too (not only by the module-level check), so a caller
  // that runs main() with --help gets the usage and exit 0 rather than an install.
  if (argv.includes('--help') || argv.includes('-h')) {
    showUsage(log);
    return result;
  }

  const parsed = parseArgs(argv);

  // Check for parsing and validation errors
  if (parsed.errors.length > 0) {
    return fail('Error parsing arguments:', ...parsed.errors.map(err => '  - ' + err));
  }

  // No subcommand: nothing is installed. With no arguments, print usage and exit 0.
  // With flags, an attempted install that does nothing must not look like success
  // to a script, so print usage plus a note and exit 1.
  if (!parsed.init && !parsed.uninstall) {
    if (argv.length === 0) {
      showUsage(log);
      return result;
    }
    showUsage(error);
    return fail('Error: installing needs the init subcommand. Nothing was installed.',
      '  Hint: run "five-role-team init" with the same flags, e.g. five-role-team init --global --harness pi');
  }

  // TTY signal (real or explicitly injected for tests) drives interactive
  // scope/harness prompting; an injected promptsImpl alone does not.
  const interactive = !!(options.isTTY || (process.stdin && process.stdin.isTTY));

  const cancel = () => {
    log('Installation cancelled.');
    result.cancelled = true;
    result.selectedAgents = null;
    result.models = null;
    return result;
  };

  // uninstall never prompts; missing scope/harness are rejected in parseArgs above.

  // Prompt for missing scope (not for `init`) and harness on a TTY (task 2.2).
  // Without a TTY (and no injected prompts) fail with a hint instead of prompting.
  if (!argv.includes('--help') && !argv.includes('-h')) {
    if (!parsed.uninstall && !parsed.init && !parsed.global && !parsed.local) {
      if (!interactive) {
        return fail('Error: --global or --local is required (installation scope).\n  Hint: re-run with --global or --local, e.g. five-role-team init --global --harness pi');
      }
      const scope = await promptScopeSelection({ promptsImpl: options.promptsImpl });
      if (scope === null) return cancel();
      if (scope === 'global') parsed.global = true;
      else parsed.local = true;
    }
    if (!parsed.uninstall && !parsed.harness) {
      if (!interactive) {
        return fail('Error: --harness is required (harness name or path, e.g. --harness pi)\n  Hint: re-run with --harness, e.g. --harness claude-code');
      }
      const h = await promptHarnessSelection({ promptsImpl: options.promptsImpl });
      if (h === null) return cancel();
      parsed.harness = h;
    }
  }

  // The plugin source (the directory install.js sits in) must be a five-role-team
  // plugin directory (task 8.4). Checked before any prompt or write. Uninstall copies
  // nothing from the source and only uses it for the removal safety check, so a
  // missing manifest does not block uninstall.
  if (!parsed.uninstall) {
    try {
      validatePluginSource(sourceDir);
    } catch (err) {
      return fail('Error: ' + err.message);
    }
  }

  // Validate the harness resolves before asking anything (missing --harness is
  // already rejected by parseArgs).
  try {
    resolveHarnessPath(parsed.harness, parsed.global);
  } catch (err) {
    return fail('Error resolving harness path: ' + err.message);
  }

  // Uninstall (task 7.1) needs no agent selection or model configuration, so it
  // branches here, before any prompt, and never asks anything.
  if (parsed.uninstall) {
    try {
      const resolved = resolveHarnessPath(parsed.harness, parsed.global);
      // The primary goes first; its safety refusals throw before anything else is
      // touched. A missing primary is only an error when no pi secondary symlink
      // is removed either (a dangling secondary left by a deleted install counts).
      let primaryPresent;
      try {
        primaryPresent = !!fs.lstatSync(resolved.primary, { throwIfNoEntry: false });
      } catch (err) {
        // ENOTDIR: a parent path component is a regular file, so nothing is installed here.
        if (err.code !== 'ENOTDIR') throw err;
        primaryPresent = false;
      }
      // Skills roots the uninstall must never remove or contain (task 7.3): the
      // harness base directory and the default global claude-code and pi skills dirs.
      const protect = [
        resolved.base,
        path.join(os.homedir(), '.claude', 'skills'),
        path.join(os.homedir(), '.pi', 'agent', 'skills'),
      ];
      const removed = primaryPresent
        ? uninstallInstall(resolved.primary, { sourceDir, expected: resolved.primary, protect })
        : null;
      if (removed) {
        if (removed.kind === 'symlink') {
          log('Removed symlink ' + removed.path + ' -> ' + removed.linkTarget);
          log('Source directory ' + removed.linkTarget + ' was left untouched.');
        } else {
          removed.cleaned.forEach(file => log('Removed ' + file));
          log('Removed installation at ' + removed.path);
        }
      }
      // pi only (task 7.2): the ~/.pi/agent/skills symlink is removed only when it
      // is a symlink to the primary. Anything else there is left and reported.
      const secondary = uninstallPiSecondary(resolved.primary, resolved.secondary);
      if (secondary && secondary.kind === 'symlink') {
        log('Removed pi secondary symlink ' + secondary.path + ' -> ' + secondary.linkTarget);
      } else if (secondary) {
        log('Warning: left ' + secondary.path + ' in place because ' + secondary.reason + '.');
      }
      if (!removed && !(secondary && secondary.kind === 'symlink')) {
        throw new Error('Nothing to uninstall: no five-role-team installation at ' + path.resolve(resolved.primary));
      }
    } catch (err) {
      return fail('Error: ' + err.message);
    }
    return result;
  }

  const hasModelFlag = Object.keys(parsed.agentModels).length > 0;
  // With neither --agents nor --agent-models, the agent and model prompts run. Without
  // a terminal they can never be answered, so refuse up front with a clear message
  // instead of exiting silently (task 8.3). Injected prompts (tests) bypass this check.
  if (parsed.agents === null && !hasModelFlag && !options.promptsImpl && !(process.stdin && process.stdin.isTTY)) {
    return fail(
      'Error: No interactive input available: stdin is not a terminal, so the agent and model prompts cannot be answered.',
      '  For a non-interactive install pass --agents <list> and --agent-models <map>, for example:',
      '  five-role-team init --global --harness pi --agents architect,worker --agent-models "worker=sonnet"'
    );
  }
  try {
    // Agent selection (section 3)
    let selectedAgents;
    if (parsed.agents !== null || hasModelFlag) {
      const resolution = resolveSelectedAgents({ agents: parsed.agents });
      if (resolution.errors.length > 0) {
        return fail(...resolution.errors.map(msg => 'Error: ' + msg));
      }
      selectedAgents = resolution.selectedAgents;
    } else {
      selectedAgents = await promptAgentSelection(promptsOption);
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
    return fail('Error: ' + describeFsError(err));
  }

  log('Selected agents and models:');
  result.selectedAgents.forEach(id => log('  ' + id + ': ' + result.models[id]));

  // File installation (section 5). Uninstall returned earlier.
  // Rollback state: only what THIS run creates is ever removed on failure.
  // A confirmed/--force overwrite moves the old install aside to a hidden
  // sibling first; on failure it is restored, on success it is deleted.
  const tx = { secondary: null, primary: null, backup: null, secondaryBackup: null, createdDirs: [], sourceDir };
  // Absolute paths actually used, recorded for the success summary (task 8.2).
  const outcome = { primary: null, secondary: null, linkSource: null, cfgPath: null };
  let resolved;
  try {
    resolved = resolveHarnessPath(parsed.harness, parsed.global);
    outcome.primary = path.resolve(resolved.primary);
    // Progress (task 8.1): where the harness resolved to, before anything is written.
    log('Detecting harness ' + parsed.harness + ' (' + (parsed.global ? 'global' : 'local') + ' scope)');
    log('Target installation path: ' + resolved.primary);
    if (resolved.secondary) log('Pi secondary location: ' + resolved.secondary);
    const existing = detectExistingInstall(resolved.primary);
    // A pi secondary that already links to the primary is fine (it is correct
    // again after reinstall); anything else there would block linkSecondary.
    const secConflict = detectSecondaryConflict(resolved.primary, resolved.secondary);
    if (existing || secConflict) {
      if (!parsed.force) {
        let ok;
        try {
          ok = await confirmOverwrite(existing, { ...promptsOption, log, secondary: secConflict });
        } catch (err) {
          if (err.code === 'NON_INTERACTIVE') return fail('Error: ' + err.message);
          throw err;
        }
        if (!ok) return cancel();
      }
      if (existing) {
        tx.backup = moveAsideExistingInstall(resolved.primary, { sourceDir, expected: resolved.primary });
        if (tx.backup) log('Removed existing installation at ' + existing.path);
      }
      if (secConflict) {
        tx.secondaryBackup = moveAsideExistingInstall(resolved.secondary, { sourceDir, expected: resolved.secondary });
        if (tx.secondaryBackup) log('Removed existing secondary location at ' + secConflict.path);
      }
    }
    try {
      ensureInstallDirectories(resolved).createdPaths.forEach(d => tx.createdDirs.push(d));
    } catch (err) {
      if (err.createdPaths) err.createdPaths.forEach(d => tx.createdDirs.push(d));
      throw err;
    }
    if (parsed.link) {
      tx.primary = resolved.primary; // absent here (moved aside / never existed)
      log('Creating symlink ' + resolved.primary + ' -> ' + path.resolve(sourceDir));
      const linked = linkInstall(sourceDir, resolved.primary);
      outcome.linkSource = linked.source;
      log('Note: symlink mode links the whole source directory; agent selection and model configuration are not applied.');
      log('Note: no .agent-config.json is written in symlink mode (it would be written into the source directory).');
      log('Linked ' + linked.target + ' -> ' + linked.source);
      if (resolved.secondary) log('Creating pi secondary symlink ' + resolved.secondary + ' -> ' + resolved.primary);
      const sec = linkSecondary(resolved.primary, resolved.secondary);
      if (sec) {
        if (!sec.existed) tx.secondary = sec.target;
        outcome.secondary = sec.target;
        log('Linked ' + sec.target + ' -> ' + sec.source);
      }
    } else {
      const installSet = buildInstallSet(sourceDir, result.selectedAgents, parsed.harness);
      // Build the config before writing anything so invalid input fails early.
      const agentConfig = buildAgentConfig({
        agents: result.selectedAgents,
        models: result.models,
        harness: parsed.harness,
      });
      tx.primary = resolved.primary;
      logCopyPlan(installSet, log);
      const written = copyInstall(sourceDir, resolved.primary, installSet, result.models);
      log('Installed ' + written.files.length + ' files to ' + written.target);
      // Written inside the copied plugin dir, so rollback (tx.primary) covers it.
      // The pi secondary symlink (below) exposes the same file at ~/.pi/agent/skills/.
      log('Writing configuration file into ' + resolved.primary);
      const cfg = writeAgentConfigFile(resolved.primary, agentConfig);
      outcome.cfgPath = cfg.path;
      log('Saved configuration to ' + cfg.path);
      if (resolved.secondary) log('Creating pi secondary symlink ' + resolved.secondary + ' -> ' + resolved.primary);
      const sec = linkSecondary(resolved.primary, resolved.secondary);
      if (sec) {
        if (!sec.existed) tx.secondary = sec.target;
        outcome.secondary = sec.target;
        log('Linked ' + sec.target + ' -> ' + sec.source);
      }
    }
  } catch (err) {
    const lines = ['Error: ' + describeFsError(err)];
    if (tx.backup || tx.secondaryBackup || tx.primary || tx.createdDirs.length > 0) {
      // tx.primary is only set once the write phase started, so its target
      // was absent before this run and is safe to remove.
      const rb = rollbackInstall(tx);
      if (rb.restored) lines.push('Partial installation rolled back; previous installation restored at ' + rb.restored);
      else if (rb.removed.length > 0 || !tx.backup) lines.push('Partial installation rolled back (created files and directories removed).');
      if (rb.restoredSecondary) lines.push('Previous secondary location restored at ' + rb.restoredSecondary);
      rb.errors.forEach(e => lines.push('Rollback problem: ' + e));
    }
    return fail(...lines);
  }
  for (const b of [tx.backup, tx.secondaryBackup]) {
    if (!b) continue;
    try {
      discardBackup(b);
    } catch (err) {
      log('Warning: could not delete the previous installation backup ' + b.backup + ': ' + err.message);
    }
  }
  logInstallSummary(log, {
    ...outcome,
    link: parsed.link,
    global: parsed.global,
    harness: parsed.harness,
    selectedAgents: result.selectedAgents,
    models: result.models,
  });
  return result;
}


const {
  AGENT_CATALOG,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  promptAgentSelection,
  resolveSelectedAgents,
} = require('./select-agents');
const { ensureInstallDirectories, buildInstallSet, copyInstall, writeAgentConfigFile, linkInstall, linkSecondary, detectExistingInstall, detectSecondaryConflict, moveAsideExistingInstall, discardBackup, rollbackInstall, uninstallInstall, uninstallPiSecondary, describeFsError, validatePluginSource } = require('./install-files');
const { buildAgentConfig } = require('./agent-config');
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
  showUsage,
  resolveHarnessPath,
  readDefaultModels,
  confirmOverwrite,
  promptScopeSelection,
  promptHarnessSelection,
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
    console.error('Error:', describeFsError(err));
    process.exit(1);
  });
}
