# Proposal

## Why

After `five-role-team init`, a Claude Code user still has to approve the orchestrator loop step by step: every `Agent` dispatch of `worker`, `reviewer` and `supervisor` (and `architect`, `designer` and `intern`), plus the `git add` / `git commit` / `git status` / `git diff` / `git rev-parse` / `git log` calls the commit workers make. This checkout already has the right allow-list in `.claude/settings.local.json`, by hand. A Claude Code plugin cannot ship permission rules itself (a plugin's `settings.json` only honours `agent` and `subagentStatusLine`), so the installer has to write them.

## What Changes

- `five-role-team init` with the `claude-code` harness merges an allow-list into Claude Code settings, with no question:
  - one `Agent(five-role-team:<id>)` rule per installed agent (the whole agent catalog under `--link`), and
  - `Bash(git add:*)`, `Bash(git commit:*)`, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git rev-parse:*)`, `Bash(git log:*)`.
- Local scope writes `./.claude/settings.local.json`; `--global` writes `~/.claude/settings.json`.
- The merge is idempotent and exact-match: only missing rules are appended, and every other key, rule and rule order is kept. A malformed settings file is left unchanged, a warning lists the rules to add by hand, and `init` still exits 0.
- One summary line reports the outcome, before the "Next steps" block.
- New `--no-permissions` flag skips the step. Permissions are written by default.
- `five-role-team uninstall --harness claude-code` removes only `Agent(five-role-team:*)` rules from the same settings file and prints one line saying what was removed. The git `Bash` rules are left in place.
- pi, cursor and custom-path harnesses are unchanged: no settings file is read or written.
- README documents the step, the flag, the uninstall behaviour, and that local scope uses the current directory.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli/installation`: adds requirements for writing Claude Code permissions during `init`, for the `--no-permissions` flag, and for removing the plugin's agent rules on `uninstall`. Existing requirements are unchanged.

## Impact

- Code: `install.js` (post-install step, uninstall step, flag parsing, `--help`), and a new helper module `claude-permissions.js`. It must be listed in `package.json` `files` and in `SOURCE_ENTRIES` in `test/verify-matrix.js`.
- Tests: a new `test/test-permissions.js` added to `npm test`, plus updates to `test/test-command-grammar.js`, `test/test-default-setup.js`, `test/test-uninstall-modes.js` and `test/verify-readme-commands.js`.
- User files: `./.claude/settings.local.json` or `~/.claude/settings.json` are now written by the installer (merge only, never replaced).
- Dependencies: none.
