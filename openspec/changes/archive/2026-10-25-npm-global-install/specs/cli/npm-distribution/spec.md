# Spec Delta

## Purpose

Lets users install the five-role-team installer from npm and run it as a `five-role-team` command, with interactive choice of scope and harness, mirroring the install-then-run flow of OpenSpec.

## ADDED Requirements

### Requirement: Installable npm package with a command
The package SHALL be named `@pravinbashyal/five-role-team` and expose a `five-role-team` executable.

#### Scenario: Global npm install provides the command
- **WHEN** the packed tarball is installed with `npm install -g` into a temporary prefix
- **THEN** a `five-role-team` executable exists in that prefix's bin directory and `five-role-team --help` prints usage and exits 0

#### Scenario: Installed command installs the plugin
- **WHEN** the installed `five-role-team init --global --harness claude-code --agents architect,worker,reviewer --agent-models worker=sonnet` runs with a temporary HOME
- **THEN** the plugin is installed under that HOME's `.claude/skills/five-role-team/` using the files shipped in the package

### Requirement: Tarball ships only installer inputs
The published tarball SHALL contain the files the installer needs and SHALL NOT contain tests, verify scripts, OpenSpec artifacts or local tooling directories.

#### Scenario: Pack contents
- **WHEN** `npm pack --dry-run` is run
- **THEN** the list includes `install.js`, `install-files.js`, `SKILL.md`, `agents/`, `commands/`, `conventions/`, `.claude-plugin/` and `pi/`, and excludes `verify-*.js`, `test-*.js`, `openspec/`, `.claude/` and `.pi/`

### Requirement: init subcommand starts the plugin in a project
The installer SHALL accept `init` as a subcommand that installs into the current project directory by default, and SHALL accept `install` as an alias.

#### Scenario: Init in a project
- **WHEN** user runs `five-role-team init --harness claude-code --agents architect,worker,reviewer --agent-models worker=sonnet` from a project directory
- **THEN** the plugin is installed to `./.claude/skills/five-role-team/` (local scope) without prompting for scope

#### Scenario: Init with global flag
- **WHEN** user runs `five-role-team init --global --harness pi`
- **THEN** the result is identical to `node install.js --global --harness pi`

#### Scenario: Install alias and bare form
- **WHEN** user runs `five-role-team install --global --harness pi` or `five-role-team --global --harness pi`
- **THEN** the result is identical to `five-role-team init --global --harness pi`

#### Scenario: Uninstall subcommand unchanged
- **WHEN** user runs `five-role-team uninstall --local --harness pi`
- **THEN** the installation is removed exactly as `node install.js uninstall` does today

### Requirement: Interactive scope and harness
On an interactive terminal the installer SHALL prompt for any of scope (global or local) and harness (pi, claude-code, or a custom path) that were not given as flags.

#### Scenario: Init with no flags on a TTY
- **WHEN** user runs `five-role-team init` on a TTY with no flags
- **THEN** the installer assumes local scope, prompts for harness, then continues with the existing agent and model prompts

#### Scenario: Bare or install form with no flags on a TTY
- **WHEN** user runs `five-role-team install` on a TTY with neither scope nor harness flags
- **THEN** the installer prompts for scope, then harness, then continues with the existing agent and model prompts

#### Scenario: Partial flags
- **WHEN** user runs `five-role-team install --harness pi` on a TTY
- **THEN** only scope is prompted for

#### Scenario: No TTY without flags
- **WHEN** harness (or, outside `init`, scope) is missing and stdin is not a TTY
- **THEN** the installer exits 1 with a message naming the missing flag and does not prompt

#### Scenario: Cancelled prompt
- **WHEN** user cancels a scope or harness prompt
- **THEN** the installer exits without changing anything

### Requirement: README leads with the npm flow
The README Installation section SHALL present `npm install -g @pravinbashyal/five-role-team` followed by `five-role-team init` first, and keep the clone-and-run flow as an alternative.

#### Scenario: Documented commands work
- **WHEN** the README's first-listed install commands are run in a sandbox against the packed tarball
- **THEN** they complete successfully
