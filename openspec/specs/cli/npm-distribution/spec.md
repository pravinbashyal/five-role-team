# npm-distribution Specification

## Purpose

Lets users install the five-role-team installer from npm and run it as a `five-role-team` command, with interactive choice of scope and harness, mirroring the install-then-run flow of OpenSpec.

## Requirements

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
- **THEN** the list includes `install.js`, `install-files.js`, `SKILL.md`, `agents/`, `commands/`, `conventions/`, `.claude-plugin/` and `pi/`, and excludes `test/`, `openspec/`, `.claude/` and `.pi/`

### Requirement: init subcommand starts the plugin in a project
The installer SHALL accept exactly two subcommands, `init` (install) and `uninstall`. `init` installs into the current project directory unless the user picks or passes global scope. There SHALL be no `install` alias and no bare install form.

#### Scenario: Init in a project
- **WHEN** user runs `five-role-team init --harness claude-code --agents architect,worker,reviewer --agent-models worker=sonnet` from a project directory with stdin not a TTY
- **THEN** the plugin is installed to `./.claude/skills/five-role-team/` (local scope) without prompting

#### Scenario: Init with global flag
- **WHEN** user runs `five-role-team init --global --harness pi --agents architect,worker --agent-models worker=sonnet` with no TTY
- **THEN** the plugin is installed to `~/.claude/skills/five-role-team/` with a symlink at `~/.pi/agent/skills/five-role-team`, without prompting

#### Scenario: Install alias and bare form
- **WHEN** user runs `five-role-team install --global --harness pi` or `five-role-team --global --harness pi`
- **THEN** nothing is installed and the exit code is 1; `install` is reported as an unknown argument with a pointer to `five-role-team init`, and the bare form prints usage (see "Bare command prints help")

#### Scenario: Uninstall subcommand unchanged
- **WHEN** user runs `five-role-team uninstall --local --harness pi`
- **THEN** the installation is removed without any prompt, and a missing `--global|--local` or `--harness` is still an error (exit 1)

### Requirement: README leads with the npm flow
The README SHALL document exactly one install path: `npm install -g @pravinbashyal/five-role-team` followed by `five-role-team init`. It SHALL describe the Default/Custom flow, `--default` and the other flags, and `five-role-team uninstall`. It SHALL NOT document `git clone` into a skills directory, the Claude Code marketplace install, the bare form, or `node install.js`, except that a closing "Contributing" section MAY show `npm link` followed by `five-role-team init --link`.

#### Scenario: Documented commands work
- **WHEN** the README's install commands are run in a sandbox against the packed tarball, with `five-role-team init --default` standing in for the interactive run
- **THEN** they complete successfully and the plugin is installed under the sandbox project's `./.claude/skills/five-role-team/`

#### Scenario: No alternative install routes in the README
- **WHEN** the README is searched for `node install.js`, `git clone`, `claude plugin marketplace add` and `claude plugin install`
- **THEN** none of them appear anywhere in the README, and the only install command shown outside the closing "Contributing" section is `npm install -g @pravinbashyal/five-role-team` followed by `five-role-team init`

### Requirement: Default or Custom is the first init question
On an interactive terminal, `five-role-team init` without `--default` SHALL first print the default setup (detected harness, then each default agent with its model) and then ask "How do you want to set up five-role-team?" with "Default (recommended)" first and highlighted, and "Custom". Nothing is asked before this question.

#### Scenario: [interaction] Default summary and first question
- **WHEN** user runs `five-role-team init` with no flags in a terminal, in a project directory that has a `./.claude` directory and no existing five-role-team install
- **THEN** before any other question the terminal shows the default setup: harness Claude Code, and the agents architect, designer, worker, reviewer and supervisor, each with its default model (architect, designer and supervisor opus, reviewer sonnet, worker haiku); then it asks "How do you want to set up five-role-team?" with "Default (recommended)" highlighted and "Custom" below it

#### Scenario: [interaction] Default summary shows detected pi harness
- **WHEN** user runs `five-role-team init` with no flags in a terminal, in a directory that contains `./.pi` and no `./.claude`
- **THEN** the default summary names harness pi and includes the intern agent with its default model

#### Scenario: [interaction] Choosing Default asks only scope
- **WHEN** user runs `five-role-team init` in a terminal with no flags and picks "Default (recommended)"
- **THEN** the next and only setup question is the scope question; after it is answered the default setup is installed with no harness, agent, model or review questions

#### Scenario: [interaction] Flags given in a terminal skip their questions
- **WHEN** user runs `five-role-team init --global` in a terminal
- **THEN** the first question is still "How do you want to set up five-role-team?", and the scope question is not asked in either branch

### Requirement: Scope question for every interactive init
Whenever `init` runs interactively without `--global` or `--local`, both Default and Custom SHALL ask "Where should five-role-team be installed?" with "This project" (preselected) and "All projects for this user", each labelled with the absolute install path for the harness in effect.

#### Scenario: [interaction] Scope choices name real paths
- **WHEN** user runs `five-role-team init` in a terminal in `/work/app` (which has `./.claude`), picks "Default (recommended)", and the scope question appears
- **THEN** the choices read "This project (/work/app/.claude/skills/five-role-team)" and "All projects for this user (~/.claude/skills/five-role-team)", with "This project" preselected

#### Scenario: [interaction] Choosing all projects installs globally
- **WHEN** user runs `five-role-team init` in a terminal, picks "Default (recommended)", then "All projects for this user"
- **THEN** the default setup is installed to `~/.claude/skills/five-role-team/`

### Requirement: Custom setup steps
After the scope question, Custom SHALL ask, in order: harness (the detected harness preselected; options pi, Claude Code, custom path), agents (multiselect, all available agents for that harness preselected, intern disabled unless the harness is pi), "Keep default models? (Y/n)", then show a review and ask "Install? (Y/n)". Nothing is written before the review is confirmed.

#### Scenario: [interaction] Custom walks through harness, agents and models
- **WHEN** user runs `five-role-team init` in a terminal with no flags and picks "Custom", then "This project"
- **THEN** the CLI asks for the harness with the detected harness preselected, then shows the agent multiselect with all available agents checked, then asks "Keep default models? (Y/n)"

#### Scenario: [interaction] Keeping default models skips per-agent prompts
- **WHEN** user answers "Y" (or presses Enter) at "Keep default models? (Y/n)" during `five-role-team init` Custom
- **THEN** no per-agent model prompt is shown and every selected agent uses its default model

#### Scenario: [interaction] Declining default models prompts per agent
- **WHEN** user answers "n" at "Keep default models? (Y/n)" during `five-role-team init` Custom
- **THEN** the CLI shows one "Model for <agent> (default: <model>):" prompt per selected agent, and pressing Enter keeps that agent's default

#### Scenario: [interaction] Custom ends with a review
- **WHEN** user finishes the Custom questions of `five-role-team init` in a terminal
- **THEN** the terminal shows the resolved harness, install path, and each selected agent with its model, and asks "Install? (Y/n)"; answering "n" prints "Installation cancelled. Nothing was changed." and writes nothing

### Requirement: Non-interactive default install
`five-role-team init --default` SHALL install the default setup without asking any setup question, in or out of a terminal. Scope is this project (local) unless `--global` is given. Harness is detected unless `--harness` is given. `--agents` and `--agent-models` override their part of the default.

#### Scenario: [interaction] Default flag without a terminal
- **WHEN** user runs `five-role-team init --default` with stdin not a TTY, in a project directory with `./.claude` and no existing install
- **THEN** the default setup is installed to `./.claude/skills/five-role-team/` with no prompt and exit code 0

#### Scenario: [interaction] Default flag with overrides
- **WHEN** user runs `five-role-team init --default --global --agent-models worker=sonnet` with stdin not a TTY
- **THEN** the default agents are installed to `~/.claude/skills/five-role-team/`, worker uses sonnet and every other agent uses its default model

#### Scenario: [interaction] Missing flags without a terminal
- **WHEN** user runs `five-role-team init` with stdin not a TTY and without `--default`, `--harness` or `--agents`/`--agent-models`
- **THEN** the command exits 1, writes nothing, and prints a hint whose first suggestion is `five-role-team init --default`, followed by an example with explicit flags; the message never mentions `node install.js`

### Requirement: Bare command prints help
Running `five-role-team` with no subcommand SHALL print help and install nothing.

#### Scenario: [interaction] Bare command
- **WHEN** user runs `five-role-team` with no arguments in a terminal
- **THEN** usage is printed listing only `init` and `uninstall`, the exit code is 0, and nothing is written

#### Scenario: [interaction] Bare command with flags
- **WHEN** user runs `five-role-team --global --harness pi`
- **THEN** usage is printed with a note that installing needs `five-role-team init`, the exit code is 1, and nothing is written

### Requirement: Help and errors name the installed command
Help text, error messages and hints SHALL refer to the `five-role-team` command and SHALL NOT mention `node install.js`.

#### Scenario: [interaction] Help text uses the command name
- **WHEN** user runs `five-role-team --help`
- **THEN** every usage line and example starts with `five-role-team`, the examples include `five-role-team init`, `five-role-team init --default` and `five-role-team uninstall`, and `node install.js` appears nowhere

#### Scenario: [interaction] Unknown argument hint
- **WHEN** user runs `five-role-team init --globl`
- **THEN** the error suggests running `five-role-team --help` and does not mention `node install.js`

### Requirement: Cancelling init changes nothing
Cancelling any `init` question (Ctrl-C or Esc), or declining an overwrite or review confirmation, SHALL print "Installation cancelled. Nothing was changed.", exit 0 and leave the filesystem untouched.

#### Scenario: [interaction] Cancel at the first question
- **WHEN** user presses Ctrl-C at "How do you want to set up five-role-team?" after running `five-role-team init` in a terminal
- **THEN** the terminal prints "Installation cancelled. Nothing was changed.", the exit code is 0, and no file or directory is created or removed

#### Scenario: [interaction] Cancel at the scope question
- **WHEN** user presses Esc at "Where should five-role-team be installed?" during `five-role-team init`
- **THEN** the terminal prints "Installation cancelled. Nothing was changed." and the exit code is 0
