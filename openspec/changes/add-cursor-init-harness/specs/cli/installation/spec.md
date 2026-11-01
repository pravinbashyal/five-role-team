# Spec Delta

## ADDED Requirements

### Requirement: Detect the default harness from project markers

The installer SHALL pick the default harness from directories in the current working directory only, never HOME: `cursor` when `./.cursor` exists and `./.claude` and `./.pi` do not; `pi` when `./.pi` exists and `./.claude` does not; otherwise `claude-code`. An explicit `--harness` SHALL override this.

#### Scenario: Cursor-only tree detects cursor
- **WHEN** `five-role-team init --default` runs in a directory that has `./.cursor` and neither `./.claude` nor `./.pi`
- **THEN** the cursor harness is used

#### Scenario: Mixed Cursor and Claude defaults to Claude Code
- **WHEN** `five-role-team init --default` runs in a directory that has both `./.cursor` and `./.claude`
- **THEN** the claude-code harness is used

#### Scenario: Cursor plus pi without Claude uses pi
- **WHEN** `five-role-team init --default` runs in a directory that has `./.cursor` and `./.pi` and no `./.claude`
- **THEN** the pi harness is used

#### Scenario: Pi-only tree still detects pi
- **WHEN** `five-role-team init --default` runs in a directory that has `./.pi` and no `./.claude`
- **THEN** the pi harness is used

#### Scenario: No marker directories default to Claude Code
- **WHEN** `five-role-team init --default` runs in a directory with none of `./.cursor`, `./.claude`, or `./.pi`
- **THEN** the claude-code harness is used

#### Scenario: Explicit harness overrides detection
- **WHEN** user runs `five-role-team init --default --harness cursor` in a directory that has `./.claude` and no `./.cursor`
- **THEN** the cursor harness is used

### Requirement: Place selected agents for Cursor Task discovery

When the harness is `cursor`, the installer SHALL write each selected agent's markdown file (same model frontmatter as inside the skill) to `./.cursor/agents/<id>.md` for a local install or `~/.cursor/agents/<id>.md` for a global install. Other harnesses SHALL NOT write those Cursor agent paths.

#### Scenario: Local Cursor install copies selected agents
- **WHEN** user runs `five-role-team init --default --local --harness cursor --agents architect,worker`
- **THEN** `./.cursor/agents/architect.md` and `./.cursor/agents/worker.md` exist with the configured models, and no other five-role-team agent files are added there

#### Scenario: Global Cursor install copies selected agents
- **WHEN** user runs `five-role-team init --default --global --harness cursor`
- **THEN** each default agent file is written under `~/.cursor/agents/`

#### Scenario: Claude Code install does not write Cursor agents
- **WHEN** user runs `five-role-team init --default --local --harness claude-code`
- **THEN** no files are written under `./.cursor/agents/`

#### Scenario: Cursor link install symlinks agent files
- **WHEN** user runs `five-role-team init --local --harness cursor --link`
- **THEN** each source `agents/<id>.md` is a symlink at `./.cursor/agents/<id>.md` pointing at the source file

## MODIFIED Requirements

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

#### Scenario: Default flag with explicit cursor harness
- **WHEN** user runs `five-role-team init --default --harness cursor` in a directory with `./.claude` and no `./.cursor`
- **THEN** the cursor harness is used and the plugin is installed to `./.cursor/skills/five-role-team/`

### Requirement: Install plugin globally

The script SHALL install the plugin to the global skills directory for the selected harness.

#### Scenario: Install to claude-code globally
- **WHEN** user runs `five-role-team init --default --global --harness claude-code`
- **THEN** plugin files are copied to `~/.claude/skills/five-role-team/`

#### Scenario: Install to pi globally
- **WHEN** user runs `five-role-team init --default --global --harness pi`
- **THEN** plugin files are copied to `~/.claude/skills/five-role-team/` AND a symlink is created at `~/.pi/agent/skills/five-role-team` pointing to `~/.claude/skills/five-role-team/`

#### Scenario: Install to cursor globally
- **WHEN** user runs `five-role-team init --default --global --harness cursor`
- **THEN** plugin files are copied to `~/.cursor/skills/five-role-team/`

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

#### Scenario: Install to cursor locally
- **WHEN** user runs `five-role-team init --default --local --harness cursor` from a project directory
- **THEN** plugin files are copied to `./.cursor/skills/five-role-team/` in the current directory and not to `./cursor/five-role-team/`

#### Scenario: [interaction] Default installs into .cursor when detected
- **WHEN** user runs `five-role-team init --default` with stdin not a TTY, in a project directory that has `./.cursor` and neither `./.claude` nor `./.pi`, and no existing five-role-team install
- **THEN** the plugin is installed to `./.cursor/skills/five-role-team/` and each default agent markdown file is installed to `./.cursor/agents/<id>.md`

### Requirement: Support symlink mode for development

The script SHALL create symlinks instead of copying files when the --link flag is provided.

#### Scenario: Symlink install for development
- **WHEN** user runs `five-role-team init --global --harness claude-code --link`
- **THEN** a symlink is created at `~/.claude/skills/five-role-team/` pointing to the source directory, and no Default/Custom, agent or model question is asked because link mode applies no agent selection

#### Scenario: Symlink with pi dual-location requirement
- **WHEN** user runs `five-role-team init --global --harness pi --link`
- **THEN** a symlink is created at `~/.claude/skills/five-role-team/` pointing to source AND another symlink at `~/.pi/agent/skills/five-role-team` pointing to `~/.claude/skills/five-role-team/`

#### Scenario: Symlink install for cursor
- **WHEN** user runs `five-role-team init --local --harness cursor --link`
- **THEN** a symlink is created at `./.cursor/skills/five-role-team/` pointing to the source directory, and each source `agents/<id>.md` is a symlink at `./.cursor/agents/<id>.md`

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

#### Scenario: Uninstall from cursor locally
- **WHEN** user runs `five-role-team uninstall --local --harness cursor`
- **THEN** `./.cursor/skills/five-role-team/` is removed and each five-role-team agent copy previously installed under `./.cursor/agents/` is removed, and any other files in `./.cursor/agents/` are left in place

#### Scenario: Uninstall from cursor globally
- **WHEN** user runs `five-role-team uninstall --global --harness cursor`
- **THEN** `~/.cursor/skills/five-role-team/` is removed and each five-role-team agent copy previously installed under `~/.cursor/agents/` is removed, and any other files in `~/.cursor/agents/` are left in place

#### Scenario: Uninstall with nothing installed
- **WHEN** user runs `five-role-team uninstall --global --harness claude-code` and no installation exists
- **THEN** the script exits non-zero with a "Nothing to uninstall" message and removes nothing

#### Scenario: Uninstall cursor with nothing installed
- **WHEN** user runs `five-role-team uninstall --local --harness cursor` and neither `./.cursor/skills/five-role-team/` nor any five-role-team agent copies under `./.cursor/agents/` exist
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

#### Scenario: pi-specific files excluded for cursor
- **WHEN** user installs with `--harness cursor`
- **THEN** the `pi/` directory is NOT included in the installation, so neither `pi/agents/worker.md` nor `pi/agents/intern.md` is installed

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

#### Scenario: [interaction] Next steps after a Cursor install
- **WHEN** `five-role-team init` finishes installing with the cursor harness
- **THEN** the last output is a "Next steps" block telling the user to start Cursor Agent from the project root (or reload the window) so `.cursor/skills` and `.cursor/agents` load, and it does not mention Claude Code, `/reload-plugins`, `CLAUDE.md`, or `claude plugin uninstall`

#### Scenario: [interaction] Warning when a marketplace copy would shadow the install
- **WHEN** `five-role-team init` finishes installing with the Claude Code harness and a marketplace-installed `five-role-team` plugin is recorded for this user
- **THEN** the "Next steps" block warns that the marketplace copy takes precedence and the new install will not load, and tells the user to run `claude plugin uninstall five-role-team@five-role-team`; the installer itself does not uninstall anything

#### Scenario: Cursor install does not warn about a Claude marketplace copy
- **WHEN** `five-role-team init` finishes installing with the cursor harness and a marketplace-installed `five-role-team` plugin is recorded for this user
- **THEN** the "Next steps" block does not mention marketplace copies or `claude plugin uninstall`

#### Scenario: Show error details on failure
- **WHEN** installation fails
- **THEN** script displays a clear error message explaining what went wrong
