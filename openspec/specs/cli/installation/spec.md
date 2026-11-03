# cli/installation Specification

## Purpose

Provides a command-line installation script that automates deployment of the five-role-team plugin to various AI assistant harnesses, with interactive agent selection and model configuration, supporting both copy and symlink modes with clean uninstallation.

## Requirements

### Requirement: Select which agents to include

The script SHALL let the user select which agents to include in their installation. The Default setup includes every agent available for the harness; Custom asks with a multiselect.

#### Scenario: User selects subset of agents
- **WHEN** user picks "Custom" during `five-role-team init` and reaches agent selection
- **THEN** script displays list of available agents (architect, designer, worker, reviewer, supervisor, intern) and allows multi-select

#### Scenario: Skip designer agent
- **WHEN** user deselects designer from agent list
- **THEN** `agents/designer.md` is NOT installed and configuration file does not include designer

#### Scenario: Install all agents by default
- **WHEN** user picks "Default (recommended)", or runs `five-role-team init --default` without `--agents`
- **THEN** every agent is installed, including intern

#### Scenario: Intern agent is selectable for every harness
- **WHEN** user selects intern agent with `--harness claude-code` (or any other harness)
- **THEN** `agents/intern.md` is installed and configuration file includes intern, with no warning or rejection

### Requirement: Configure model for each agent

The script SHALL let the user configure which model each selected agent uses. Default uses each agent's default model. Custom asks "Keep default models? (Y/n)" once and prompts per agent only when the answer is no.

#### Scenario: Configure architect model
- **WHEN** user has selected architect agent and answered "n" to "Keep default models? (Y/n)"
- **THEN** script prompts for architect model with the default read from the architect agent file

#### Scenario: Accept default models
- **WHEN** user answers "Y" to "Keep default models? (Y/n)", or presses Enter at a per-agent model prompt without changing it
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

The script SHALL support a non-interactive mode for automated installations using flags, including `--default` for the default setup with no setup questions.

#### Scenario: Install with predefined agents
- **WHEN** user runs `five-role-team init --agents architect,worker,reviewer --global --harness pi`
- **THEN** only architect, worker, and reviewer agents are installed, and no agent or model question is asked

#### Scenario: Configure models via flags
- **WHEN** user runs `five-role-team init --agent-models "worker=sonnet,reviewer=opus" --global --harness pi`
- **THEN** worker uses sonnet model and reviewer uses opus model without prompting

#### Scenario: Combine agent and model flags
- **WHEN** user provides both `--agents` and `--agent-models` flags
- **THEN** only specified agents are installed with their configured models

#### Scenario: Default flag needs no other flag
- **WHEN** user runs `five-role-team init --default` with stdin not a TTY
- **THEN** the default setup (detected harness, all available agents, default models) is installed to this project (local scope) without prompting

#### Scenario: Default flag with explicit harness
- **WHEN** user runs `five-role-team init --default --harness pi` in a directory with `./.claude` and no `./.pi`
- **THEN** the pi harness is used instead of the detected Claude Code harness, and intern is included

### Requirement: Install plugin globally

The script SHALL install the plugin to the global skills directory for the selected harness.

#### Scenario: Install to claude-code globally
- **WHEN** user runs `five-role-team init --default --global --harness claude-code`
- **THEN** plugin files are copied to `~/.claude/skills/five-role-team/`

#### Scenario: Install to pi globally
- **WHEN** user runs `five-role-team init --default --global --harness pi`
- **THEN** plugin files are copied to `~/.claude/skills/five-role-team/` AND a symlink is created at `~/.pi/agent/skills/five-role-team` pointing to `~/.claude/skills/five-role-team/`

#### Scenario: Install to custom harness path
- **WHEN** user runs `five-role-team init --default --global --harness /custom/path/skills`
- **THEN** plugin files are copied to `/custom/path/skills/five-role-team/`

### Requirement: Install plugin locally to project

The script SHALL install the plugin to the local project skills directory for the selected harness.

#### Scenario: Install to claude-code locally
- **WHEN** user runs `five-role-team init --default --local --harness claude-code` from a project directory
- **THEN** plugin files are copied to `./.claude/skills/five-role-team/` in the current directory

#### Scenario: Install to pi locally
- **WHEN** user runs `five-role-team init --default --local --harness pi` from a project directory
- **THEN** plugin files are copied to `./.pi/skills/five-role-team/` in the current directory

### Requirement: Support symlink mode for development

The script SHALL create symlinks instead of copying files when the --link flag is provided.

#### Scenario: Symlink install for development
- **WHEN** user runs `five-role-team init --global --harness claude-code --link`
- **THEN** a symlink is created at `~/.claude/skills/five-role-team/` pointing to the source directory, and no Default/Custom, agent or model question is asked because link mode applies no agent selection

#### Scenario: Symlink with pi dual-location requirement
- **WHEN** user runs `five-role-team init --global --harness pi --link`
- **THEN** a symlink is created at `~/.claude/skills/five-role-team/` pointing to source AND another symlink at `~/.pi/agent/skills/five-role-team` pointing to `~/.claude/skills/five-role-team/`

### Requirement: Uninstall plugin cleanly

The script SHALL remove all installed plugin files and symlinks when the `uninstall` subcommand is provided.

#### Scenario: Uninstall from claude-code
- **WHEN** user runs `five-role-team uninstall --global --harness claude-code`
- **THEN** `~/.claude/skills/five-role-team/` is removed (file or symlink)

#### Scenario: Uninstall from pi
- **WHEN** user runs `five-role-team uninstall --global --harness pi`
- **THEN** `~/.claude/skills/five-role-team/` is removed (file or symlink) AND `~/.pi/agent/skills/five-role-team` symlink is removed

#### Scenario: Uninstall from local project
- **WHEN** user runs `five-role-team uninstall --local --harness claude-code`
- **THEN** `./.claude/skills/five-role-team/` in the current directory is removed

#### Scenario: Uninstall with nothing installed
- **WHEN** user runs `five-role-team uninstall --global --harness claude-code` and no installation exists
- **THEN** the script exits non-zero with a "Nothing to uninstall" message and removes nothing

### Requirement: Handle harness-specific files

The script SHALL only install harness-specific files for the target harness.

#### Scenario: pi-specific files included for pi
- **WHEN** user installs with `--harness pi` and the worker and intern agents are selected
- **THEN** the `pi/agents/worker.md` and `pi/agents/intern.md` files are included in the installation

#### Scenario: pi-specific agent file follows agent selection
- **WHEN** user installs with `--harness pi --agents intern` (worker not selected)
- **THEN** `pi/agents/intern.md` is included and `pi/agents/worker.md` is NOT included in the installation

#### Scenario: pi-specific files excluded for claude-code
- **WHEN** user installs with `--harness claude-code`
- **THEN** the `pi/` directory is NOT included in the installation, so neither `pi/agents/worker.md` nor `pi/agents/intern.md` is installed

### Requirement: Detect existing installations

The script SHALL detect and report if the plugin is already installed before proceeding. Re-running `init` goes through the normal Default/Custom flow; there is no separate update option.

#### Scenario: Warn on existing installation
- **WHEN** user runs `five-role-team init` and plugin already exists at target location
- **THEN** script displays a warning message and asks for confirmation to overwrite

#### Scenario: Skip warning with force flag
- **WHEN** user runs `five-role-team init` with `--force` flag and plugin already exists
- **THEN** script proceeds without confirmation prompt

#### Scenario: [interaction] Overwrite confirmation after Default
- **WHEN** user runs `five-role-team init` in a terminal in a project that already has `./.claude/skills/five-role-team/`, picks "Default (recommended)" and "This project"
- **THEN** the terminal warns that five-role-team is already installed at that path and asks "Overwrite existing installation at <path>?" with No as the default; answering No prints "Installation cancelled. Nothing was changed." and leaves the existing install untouched

#### Scenario: [interaction] Existing install without a terminal
- **WHEN** user runs `five-role-team init --default` with stdin not a TTY and five-role-team is already installed at the target
- **THEN** the command exits 1 without changing anything and tells the user to re-run with `--force`

### Requirement: Validate installation prerequisites

The script SHALL validate that required directories exist or can be created before installation.

#### Scenario: Create missing target directories
- **WHEN** user runs `five-role-team init --default --global --harness claude-code` and `~/.claude/skills/` does not exist
- **THEN** script creates the directory structure before installing

#### Scenario: Error on invalid harness path
- **WHEN** user provides a custom harness path that cannot be created or accessed
- **THEN** script displays an error message and exits with non-zero status

### Requirement: Provide installation feedback

The script SHALL display clear outcome messages during installation. Per-directory copy lines SHALL appear only with `--verbose`. A successful install SHALL end with a "Next steps" block.

#### Scenario: Show installation progress
- **WHEN** installation is in progress and `--verbose` is given
- **THEN** script displays which files are being copied or linked, one line per directory

#### Scenario: [interaction] Quiet progress by default
- **WHEN** user runs `five-role-team init --default` without `--verbose`
- **THEN** no per-directory "Copying ..." line is printed

#### Scenario: Show success confirmation
- **WHEN** installation completes successfully
- **THEN** script displays a success message with the installation path, the harness, and each installed agent with its model

#### Scenario: [interaction] Next steps after a Claude Code install
- **WHEN** `five-role-team init` finishes installing with the Claude Code harness
- **THEN** the last output is a "Next steps" block telling the user to start Claude Code from the project root (or run `/reload-plugins` in an open session), to run `/five-role-team:apply` to implement an OpenSpec change, and to point the project's `CLAUDE.md` at `/five-role-team:apply`

#### Scenario: [interaction] Warning when a marketplace copy would shadow the install
- **WHEN** `five-role-team init` finishes installing with the Claude Code harness and a marketplace-installed `five-role-team` plugin is recorded for this user
- **THEN** the "Next steps" block warns that the marketplace copy takes precedence and the new install will not load, and tells the user to run `claude plugin uninstall five-role-team@five-role-team`; the installer itself does not uninstall anything

#### Scenario: Show error details on failure
- **WHEN** installation fails
- **THEN** script displays a clear error message explaining what went wrong

### Requirement: Write Claude Code permissions during init

After a successful install with the `claude-code` harness, `init` SHALL merge an allow-list into Claude Code settings without asking. The list is one `Agent(five-role-team:<id>)` rule per installed agent (every catalog agent under `--link`), plus `Bash(git add:*)`, `Bash(git commit:*)`, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git rev-parse:*)` and `Bash(git log:*)`.

#### Scenario: Local install creates the local settings file
- **WHEN** user runs `five-role-team init --default` in a directory with no `.claude/settings.local.json`
- **THEN** `./.claude/settings.local.json` is created with `permissions.allow` containing `Agent(five-role-team:<id>)` for each installed agent followed by the six git `Bash` rules

#### Scenario: Agent rules follow the agent selection
- **WHEN** user runs `five-role-team init --harness claude-code --agents worker,reviewer`
- **THEN** the allow-list contains `Agent(five-role-team:worker)` and `Agent(five-role-team:reviewer)` and no other `Agent(five-role-team:...)` rule

#### Scenario: Link install allows every catalog agent
- **WHEN** user runs `five-role-team init --link --local --harness claude-code`
- **THEN** the allow-list contains an `Agent(five-role-team:<id>)` rule for every agent in the catalog

#### Scenario: Global install writes user settings
- **WHEN** user runs `five-role-team init --default --global`
- **THEN** the rules are merged into `~/.claude/settings.json` and no `.claude/settings.local.json` is written

#### Scenario: Other harnesses write no settings
- **WHEN** user runs `five-role-team init --default --harness pi` or `--harness cursor` or a custom harness path
- **THEN** no Claude Code settings file is read or written and no permissions line is printed

### Requirement: Merge permissions without disturbing existing settings

The permissions merge SHALL append only rules not already present (exact string match) to `permissions.allow`. It SHALL keep every existing rule, their order, and every other key in the file. A run that adds nothing SHALL leave the file unchanged.

#### Scenario: Existing keys and rules are preserved
- **WHEN** the settings file already has other top-level keys, `permissions.deny` entries, and `permissions.allow` entries of its own
- **THEN** after `init` those keys, entries and their order are unchanged and the missing rules are appended after the existing `allow` entries

#### Scenario: Re-running init adds nothing
- **WHEN** user runs `five-role-team init --default --force` twice in the same directory
- **THEN** the second run adds no rule, no rule appears twice, and the settings file content is identical after both runs

### Requirement: Never fail the install over settings

When the settings file is not valid JSON, its root or `permissions` is not an object, `permissions.allow` is not an array, or the file cannot be read or written, `init` SHALL leave the file unchanged. It SHALL print a warning naming the file and listing the rules to add by hand, and SHALL keep its exit status and the installed files.

#### Scenario: Malformed settings file
- **WHEN** `./.claude/settings.local.json` contains invalid JSON and user runs `five-role-team init --default`
- **THEN** the file's bytes are unchanged, a warning naming the file and listing the rules is printed, the plugin files are installed, and `init` exits 0

#### Scenario: Allow is not an array
- **WHEN** the settings file has `permissions.allow` set to a non-array value
- **THEN** the file is unchanged, the same warning is printed, and `init` exits 0

### Requirement: Report the permissions outcome

`init` SHALL print exactly one line about permissions, after the success summary and before the "Next steps" block. The line SHALL give the number of rules added and the absolute settings path, or say that all rules were already present.

#### Scenario: [interaction] Rules added
- **WHEN** `five-role-team init --default` adds rules to `./.claude/settings.local.json`
- **THEN** the output contains one line `Claude Code permissions: added N rule(s) to <absolute path>` after the success summary, and "Next steps" is still the last block

#### Scenario: [interaction] Rules already present
- **WHEN** `five-role-team init --default --force` runs and every rule is already in the settings file
- **THEN** the output contains one line `Claude Code permissions: all N rule(s) already present in <absolute path>`

### Requirement: Support opting out of permissions

The script SHALL accept `--no-permissions`. On `init` it SHALL skip reading and writing Claude Code settings and print no permissions line. On `uninstall` it SHALL leave the settings file untouched.

#### Scenario: Opt out on init
- **WHEN** user runs `five-role-team init --default --no-permissions`
- **THEN** no Claude Code settings file is created or changed and no permissions line is printed

#### Scenario: Flag listed in help
- **WHEN** user runs `five-role-team --help`
- **THEN** the usage text lists `--no-permissions`

### Requirement: Remove agent permissions on uninstall

When `uninstall` with the `claude-code` harness removes an installation, it SHALL remove every `Agent(five-role-team:<id>)` rule from that scope's settings file, keep all other rules including the git `Bash` rules, and print one line naming the rules removed. A malformed settings file SHALL only cause a warning.

#### Scenario: Uninstall removes agent rules only
- **WHEN** user runs `five-role-team uninstall --local --harness claude-code` after a local `init`
- **THEN** every `Agent(five-role-team:...)` rule is gone from `./.claude/settings.local.json`, the six git `Bash` rules and all other entries remain, and one line `Claude Code permissions: removed N rule(s) from <absolute path> (...)` is printed

#### Scenario: Global uninstall uses user settings
- **WHEN** user runs `five-role-team uninstall --global --harness claude-code`
- **THEN** the agent rules are removed from `~/.claude/settings.json`

#### Scenario: Nothing installed leaves settings untouched
- **WHEN** user runs `five-role-team uninstall --local --harness claude-code` and no installation exists
- **THEN** the script exits non-zero with "Nothing to uninstall" and the settings file is not changed

#### Scenario: Uninstall keeps rules with the opt-out flag
- **WHEN** user runs `five-role-team uninstall --local --harness claude-code --no-permissions`
- **THEN** the installation is removed and the settings file is not changed
