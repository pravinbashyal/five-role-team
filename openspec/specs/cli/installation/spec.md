# cli/installation Specification

## Purpose

Provides a command-line installation script that automates deployment of the five-role-team plugin to various AI assistant harnesses, with interactive agent selection and model configuration, supporting both copy and symlink modes with clean uninstallation.

## Requirements

### Requirement: Select which agents to include

The script SHALL prompt the user to select which agents to include in their installation.

#### Scenario: User selects subset of agents
- **WHEN** user runs installation and is prompted for agent selection
- **THEN** script displays list of available agents (architect, designer, worker, reviewer, supervisor, intern) and allows multi-select

#### Scenario: Skip designer agent
- **WHEN** user deselects designer from agent list
- **THEN** `agents/designer.md` is NOT installed and configuration file does not include designer

#### Scenario: Install all agents by default
- **WHEN** user confirms default selection without changes
- **THEN** all agents are installed

#### Scenario: Intern agent is selectable for every harness
- **WHEN** user selects intern agent with `--harness claude-code` (or any other harness)
- **THEN** `agents/intern.md` is installed and configuration file includes intern, with no warning or rejection

### Requirement: Configure model for each agent

The script SHALL prompt the user to configure which model each selected agent uses.

#### Scenario: Configure architect model
- **WHEN** user has selected architect agent
- **THEN** script prompts for architect model with default `anthropic/claude-opus-4-5-20251101`

#### Scenario: Accept default models
- **WHEN** user presses enter without changing model
- **THEN** script uses the default model from original agent file

#### Scenario: Custom model for worker
- **WHEN** user enters custom model `anthropic/claude-sonnet-4-20250514` for worker
- **THEN** installed `agents/worker.md` frontmatter has `model: anthropic/claude-sonnet-4-20250514`

#### Scenario: Different models per agent
- **WHEN** user configures different models for different agents
- **THEN** each installed agent file has its configured model in frontmatter

### Requirement: Generate configuration file

The script SHALL generate a configuration file recording the selected agents and their models.

#### Scenario: Save configuration for global install
- **WHEN** installation completes with global scope
- **THEN** configuration file is saved alongside the installed plugin (e.g., `~/.claude/skills/five-role-team/.agent-config.json`)

#### Scenario: Save configuration for local install
- **WHEN** installation completes with local scope
- **THEN** configuration file is saved alongside the installed plugin (e.g., `./.pi/skills/five-role-team/.agent-config.json`)

#### Scenario: Configuration includes agent list and models
- **WHEN** configuration file is generated
- **THEN** file contains JSON with selected agents array and model mapping object

#### Scenario: No configuration file in symlink mode
- **WHEN** user runs installation with `--link`
- **THEN** no `.agent-config.json` is written, because the installed path is a symlink into the source checkout and writing would modify the source tree

### Requirement: Support non-interactive mode

The script SHALL support a non-interactive mode for automated installations using flags.

#### Scenario: Install with predefined agents
- **WHEN** user runs `node install.js --agents architect,worker,reviewer --global --harness pi`
- **THEN** only architect, worker, and reviewer agents are installed without prompting

#### Scenario: Configure models via flags
- **WHEN** user runs `node install.js --agent-models "worker=sonnet,reviewer=opus" --global --harness pi`
- **THEN** worker uses sonnet model and reviewer uses opus model without prompting

#### Scenario: Combine agent and model flags
- **WHEN** user provides both `--agents` and `--agent-models` flags
- **THEN** only specified agents are installed with their configured models

### Requirement: Install plugin globally

The script SHALL install the plugin to the global skills directory for the selected harness.

#### Scenario: Install to claude-code globally
- **WHEN** user runs `node install.js --global --harness claude-code`
- **THEN** plugin files are copied to `~/.claude/skills/five-role-team/`

#### Scenario: Install to pi globally
- **WHEN** user runs `node install.js --global --harness pi`
- **THEN** plugin files are copied to `~/.claude/skills/five-role-team/` AND a symlink is created at `~/.pi/agent/skills/five-role-team` pointing to `~/.claude/skills/five-role-team/`

#### Scenario: Install to custom harness path
- **WHEN** user runs `node install.js --global --harness /custom/path/skills`
- **THEN** plugin files are copied to `/custom/path/skills/five-role-team/`

### Requirement: Install plugin locally to project

The script SHALL install the plugin to the local project skills directory for the selected harness.

#### Scenario: Install to claude-code locally
- **WHEN** user runs `node install.js --local --harness claude-code` from a project directory
- **THEN** plugin files are copied to `./.claude/skills/five-role-team/` in the current directory

#### Scenario: Install to pi locally
- **WHEN** user runs `node install.js --local --harness pi` from a project directory
- **THEN** plugin files are copied to `./.pi/skills/five-role-team/` in the current directory

### Requirement: Support symlink mode for development

The script SHALL create symlinks instead of copying files when the --link flag is provided.

#### Scenario: Symlink install for development
- **WHEN** user runs `node install.js --global --harness claude-code --link`
- **THEN** a symlink is created at `~/.claude/skills/five-role-team/` pointing to the source directory

#### Scenario: Symlink with pi dual-location requirement
- **WHEN** user runs `node install.js --global --harness pi --link`
- **THEN** a symlink is created at `~/.claude/skills/five-role-team/` pointing to source AND another symlink at `~/.pi/agent/skills/five-role-team` pointing to `~/.claude/skills/five-role-team/`

### Requirement: Uninstall plugin cleanly

The script SHALL remove all installed plugin files and symlinks when the `uninstall` subcommand is provided.

#### Scenario: Uninstall from claude-code
- **WHEN** user runs `node install.js uninstall --global --harness claude-code`
- **THEN** `~/.claude/skills/five-role-team/` is removed (file or symlink)

#### Scenario: Uninstall from pi
- **WHEN** user runs `node install.js uninstall --global --harness pi`
- **THEN** `~/.claude/skills/five-role-team/` is removed (file or symlink) AND `~/.pi/agent/skills/five-role-team` symlink is removed

#### Scenario: Uninstall from local project
- **WHEN** user runs `node install.js uninstall --local --harness claude-code`
- **THEN** `./.claude/skills/five-role-team/` in the current directory is removed

#### Scenario: Uninstall with nothing installed
- **WHEN** user runs `node install.js uninstall --global --harness claude-code` and no installation exists
- **THEN** the script exits non-zero with a "Nothing to uninstall" message and removes nothing

### Requirement: Handle harness-specific files

The script SHALL only install harness-specific files for the target harness.

#### Scenario: pi-specific files included for pi
- **WHEN** user installs with `--harness pi`
- **THEN** the `pi/agents/intern.md` file is included in the installation

#### Scenario: pi-specific files excluded for claude-code
- **WHEN** user installs with `--harness claude-code`
- **THEN** the `pi/` directory is NOT included in the installation

### Requirement: Detect existing installations

The script SHALL detect and report if the plugin is already installed before proceeding.

#### Scenario: Warn on existing installation
- **WHEN** user runs install and plugin already exists at target location
- **THEN** script displays a warning message and asks for confirmation to overwrite

#### Scenario: Skip warning with force flag
- **WHEN** user runs install with `--force` flag and plugin already exists
- **THEN** script proceeds without confirmation prompt

### Requirement: Validate installation prerequisites

The script SHALL validate that required directories exist or can be created before installation.

#### Scenario: Create missing target directories
- **WHEN** user runs `node install.js --global --harness claude-code` and `~/.claude/skills/` does not exist
- **THEN** script creates the directory structure before installing

#### Scenario: Error on invalid harness path
- **WHEN** user provides a custom harness path that cannot be created or accessed
- **THEN** script displays an error message and exits with non-zero status

### Requirement: Provide installation feedback

The script SHALL display clear progress and outcome messages during installation.

#### Scenario: Show installation progress
- **WHEN** installation is in progress
- **THEN** script displays which files are being copied or linked

#### Scenario: Show success confirmation
- **WHEN** installation completes successfully
- **THEN** script displays a success message with the installation path

#### Scenario: Show error details on failure
- **WHEN** installation fails
- **THEN** script displays a clear error message explaining what went wrong
