# Spec Delta

## ADDED Requirements

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
