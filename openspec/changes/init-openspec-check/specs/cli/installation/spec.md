# Spec Delta

## ADDED Requirements

### Requirement: Detect the OpenSpec CLI after install

After installing the plugin, `init` SHALL check whether the `openspec` command is available on `PATH`, and SHALL do so before printing the "Next steps" block. The check SHALL NOT change the install's exit status or undo any installed file.

#### Scenario: CLI already present
- **WHEN** `five-role-team init` finishes installing and `openspec --version` succeeds
- **THEN** no OpenSpec question or warning is shown

#### Scenario: Check never fails the install
- **WHEN** the `openspec` command is missing and the user declines, the install fails, or a warning is printed
- **THEN** the plugin files remain installed and `init` exits with status 0

### Requirement: Ask before installing the OpenSpec CLI

On a terminal, in the interactive flow (no `--default`, no `--link`), when the OpenSpec CLI is missing `init` SHALL ask whether to install it with `npm install -g @fission-ai/openspec`, defaulting to yes, and SHALL install it only after the user answers yes.

#### Scenario: [interaction] User approves the install
- **WHEN** `five-role-team init` runs in a terminal, the `openspec` command is missing, and the user answers yes to "OpenSpec CLI not found. Install it now with `npm install -g @fission-ai/openspec`?"
- **THEN** `npm install -g @fission-ai/openspec` runs and its success is reported before the "Next steps" block

#### Scenario: [interaction] User declines the install
- **WHEN** `five-role-team init` runs in a terminal, the `openspec` command is missing, and the user answers no
- **THEN** nothing is installed, the manual command `npm install -g @fission-ai/openspec` is printed, and the plugin install stays in place

#### Scenario: [interaction] Install fails
- **WHEN** the user answers yes and `npm install -g @fission-ai/openspec` exits non-zero
- **THEN** the error output and the manual command are printed, and `init` continues to the "Next steps" block

#### Scenario: Cancel at the OpenSpec question
- **WHEN** the user presses Ctrl-C or Esc at the OpenSpec question
- **THEN** nothing is installed, and the plugin install already completed is left in place

### Requirement: Never install the OpenSpec CLI silently

Without a terminal, or with `--default` or `--link`, `init` SHALL NOT ask about the OpenSpec CLI and SHALL NOT install it unless `--install-openspec` is given. When the CLI is missing it SHALL print a warning that includes the install command.

#### Scenario: Default setup with the CLI missing
- **WHEN** user runs `five-role-team init --default` and the `openspec` command is missing
- **THEN** no question is asked, nothing is installed, and a warning containing `npm install -g @fission-ai/openspec` is printed

#### Scenario: No terminal with the CLI missing
- **WHEN** user runs `five-role-team init --global --harness pi --agents worker` with stdin not a TTY and the `openspec` command is missing
- **THEN** no question is asked, nothing is installed, and the same warning is printed

### Requirement: Support opt-in OpenSpec install flag

The script SHALL accept `--install-openspec` on `init`, which installs the OpenSpec CLI without asking when it is missing, in any mode.

#### Scenario: Flag installs when missing
- **WHEN** user runs `five-role-team init --default --install-openspec` and the `openspec` command is missing
- **THEN** `npm install -g @fission-ai/openspec` runs without a question

#### Scenario: Flag is a no-op when present
- **WHEN** user runs `five-role-team init --default --install-openspec` and `openspec --version` succeeds
- **THEN** no install is attempted and nothing about OpenSpec is printed

#### Scenario: Flag failure does not fail the install
- **WHEN** `--install-openspec` is given and the npm install exits non-zero
- **THEN** the error and the manual command are printed and `init` still exits 0
