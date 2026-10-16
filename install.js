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

// Parse command line arguments
const args = process.argv.slice(2);

// Check for --help flag
if (args.includes('--help') || args.includes('-h')) {
  showUsage();
  process.exit(0);
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
  console.log('Five-Role Team Plugin Installer');
  console.log('Installation logic coming soon...');
  console.log('Run with --help to see usage information.');
}

// Run main if not showing help
if (!args.includes('--help') && !args.includes('-h')) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
