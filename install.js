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
 * 
 * @param {string[]} argv - Arguments array (without 'node' and script name)
 * @returns {object} Parsed arguments object with boolean properties and harness value:
 *   - global: boolean
 *   - local: boolean
 *   - harness: string or null
 *   - link: boolean
 *   - force: boolean
 *   - uninstall: boolean
 *   - errors: array of error messages (if --harness missing value)
 * 
 * Note: If --harness flag is provided without a value, an error is added to the errors array.
 * The script does NOT validate mutually exclusive flags in this function (that's task 2.2).
 * Unknown flags are silently ignored.
 */
function parseArgs(argv) {
  const parsed = {
    global: false,
    local: false,
    harness: null,
    link: false,
    force: false,
    uninstall: false,
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
    }
    // Unknown flags are silently ignored (as per task 2.1 scope)
  }

  return parsed;
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

// Main execution
async function main() {
  const parsed = parseArgs(args);
  
  // Check for parsing errors
  if (parsed.errors.length > 0) {
    console.error('Error parsing arguments:');
    parsed.errors.forEach(err => console.error('  -', err));
    process.exit(1);
  }
  
  console.log('Five-Role Team Plugin Installer');
  console.log('Installation logic coming soon...');
  console.log('Run with --help to see usage information.');
}

// Export parseArgs for testing via node -e or require()
module.exports = { parseArgs };

// Run main if not showing help (only when run directly as script)
if (require.main === module && !args.includes('--help') && !args.includes('-h')) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
