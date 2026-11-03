# Tasks

## 1. Permissions module

- [x] 1.1 Add `claude-permissions.js` per design D1, D2, D4, D5 and D8.
  - Pure functions:
    - build the ordered rule list from agent ids;
    - merge rules into parsed settings, returning the added rules;
    - remove the `^Agent\(five-role-team:[^)]+\)$` rules, returning the removed rules.
  - File wrappers for apply and remove:
    - create `.claude/` when missing;
    - no rewrite when nothing changes;
    - 2-space JSON plus a trailing newline, written directly to the path;
    - a status result of added / present / removed / warned (with reason); never throws.
  - List the module in `package.json` `files` and in `SOURCE_ENTRIES` in `test/verify-matrix.js`.
  - Add `test/test-permissions.js` (run in a temp dir; never touches the real HOME) to the `npm test` script.
  - Verify: `node test/test-permissions.js` covers:
    - rule order;
    - create when the file is missing;
    - merge that keeps other keys, `deny`, and existing `allow` order;
    - an idempotent re-apply that leaves identical bytes;
    - malformed JSON, non-object `permissions` and non-array `allow` each leaving the file bytes unchanged with a warned status;
    - removal that takes only `Agent(five-role-team:*)` rules and keeps the git `Bash` rules.
  - Verify: `node test/verify-pack-contents.js` passes.

## 2. CLI wiring

- [x] 2.1 Wire the step into `init` in `install.js` per design D3, D6 and D7.
  - Run it only for harness `claude-code` and only when `--no-permissions` is not given.
  - Settings file: local `./.claude/settings.local.json`; global `~/.claude/settings.json`.
  - Agent ids: the selected agents, or the full `AGENT_CATALOG` under `--link`.
  - Run it after `logInstallSummary` and before the OpenSpec step, printing the single `Claude Code permissions: ...` line, or the warning plus the rules to add by hand.
  - Add `--no-permissions` to `parseArgs` and to `--help` under OTHER OPTIONS.
  - Update `README.md`:
    - the Install section describes the rules written, which file is used per scope, and that local scope uses the current directory (Claude Code reads `settings.local.json` from the repo root);
    - the Flags section lists `--no-permissions`.
  - Verify: `test/test-default-setup.js` checks:
    - a local `--default` creates the file with the expected rules;
    - `--agents worker,reviewer` limits the agent rules;
    - `--global` writes `<sandbox HOME>/.claude/settings.json`;
    - pi and cursor write nothing;
    - `--no-permissions` writes nothing;
    - a malformed file is unchanged and the exit is 0;
    - a re-run with `--force` adds nothing;
    - "Next steps" is still last.
  - Verify: `test/test-command-grammar.js` checks that the flag parses and appears in help.
  - Verify: `node test/verify-readme-commands.js` passes.
- [x] 2.2 Wire agent-rule removal into `uninstall` per design D8.
  - Run it only for harness `claude-code`, without `--no-permissions`, and only after the file uninstall removed something.
  - Use the same scope-to-file mapping as `init`.
  - Print `Claude Code permissions: removed N rule(s) from <abs path> (...)` when N > 0.
  - A malformed file only warns.
  - Update the README Uninstall section and the `--help` UNINSTALL text: the agent rules are removed, the git rules are kept, and `--no-permissions` keeps everything.
  - Verify: `test/test-uninstall-modes.js` checks:
    - a local and a global uninstall each remove only the `Agent(five-role-team:*)` rules and keep the git and user rules;
    - "Nothing to uninstall" leaves the settings bytes unchanged;
    - `--no-permissions` leaves the settings unchanged;
    - the malformed-file warning keeps the exit status.

## 3. Whole-change verification

- [ ] 3.1 Run `npm test` and `openspec validate init-claude-permissions --strict`.
  - In a temp project directory with a temp HOME, run:
    - `five-role-team init --default`
    - `five-role-team init --default --force`
    - `five-role-team uninstall --local --harness claude-code`
  - Inspect `.claude/settings.local.json` after each command.
  - Verify: all tests pass and validation is clean.
  - Verify: the file gains the expected rules once, is unchanged by the second run, and keeps only the git `Bash` rules after uninstall.
  - Verify: the permissions line appears once per run, before "Next steps".
