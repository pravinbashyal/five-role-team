# Tasks

## 1. Command grammar and help

- [x] 1.1 In `install.js`, make `parseArgs` and `showUsage` follow design D6:
  - Accept only `init` and `uninstall`. Add `--default` and `--verbose`.
  - `install` becomes an unknown argument that points to `five-role-team init`.
  - No subcommand: print usage. Exit 0 with no flags; exit 1 with an "install needs `five-role-team init`" note when flags are given.
  - Rewrite `showUsage`: every line uses `five-role-team`, only `init` and `uninstall` are listed, examples include `init`, `init --default` and `uninstall`.
  - Replace every `node install.js` in errors and hints (unknown-argument message, scope/harness/agents hints) and the "Run install.js from the five-role-team directory" message in `install-files.js`.

  Update `test/test-install-modes.js` and the other `test/` files that use the `install` alias, the bare form or the old hint text.

  Verify:
  - `npm test` passes.
  - `grep -rn "node install.js" install.js install-files.js select-agents.js configure-models.js` returns nothing.
  - Tests cover the spec scenarios "Install alias and bare form", "[interaction] Bare command", "[interaction] Bare command with flags", "[interaction] Help text uses the command name" and "[interaction] Unknown argument hint".

## 2. Default bundle and non-interactive `--default`

- [x] 2.1 Add default-bundle resolution (design D2) and the `--default` path (design D5):
  - Detect the harness: pi when `./.pi` exists and `./.claude` does not, otherwise claude-code. `--harness` overrides.
  - Agents: all available for the harness. Models: frontmatter defaults.
  - Scope: local unless `--global`.
  - `--agents` and `--agent-models` override their part.
  - `--default` asks no setup question in or out of a terminal; overwrite still follows `confirmOverwrite`.
  - Without `--default` and without a TTY, the existing explicit-flag path keeps working. Missing flags exit 1 with a hint whose first suggestion is `five-role-team init --default`.

  Verify with sandboxed tests (temp HOME and temp cwd, stdin not a TTY) for these scenarios:
  - "[interaction] Default flag without a terminal"
  - "[interaction] Default flag with overrides"
  - "Default flag needs no other flag"
  - "Default flag with explicit harness"
  - "[interaction] Missing flags without a terminal"
  - "[interaction] Existing install without a terminal"
  - "Init in a project"
  - "Init with global flag"

  `npm test` passes.

## 3. Interactive init flow

- [x] 3.1 Implement the terminal flow in `main` (design D1, D3, D4) using injected `promptsImpl` for tests:
  - Print the default summary, then ask Default/Custom first.
  - Ask the shared scope question with path-labelled choices, "This project" preselected, in both branches unless `--global`/`--local` is given.
  - Custom only: harness with the detected one preselected, the agent multiselect, "Keep default models? (Y/n)" with per-agent prompts only on No, then a review and "Install? (Y/n)".
  - Flags skip only their own question.
  - `--link` skips Default/Custom, agents and models.
  - Every cancel or decline prints "Installation cancelled. Nothing was changed." and exits 0.
  - Re-running goes through the same flow, then the overwrite confirmation (default No).

  Verify with prompt-injection tests that assert question order, labels, defaults and filesystem state for every `[interaction]` scenario under these requirements:
  - "Default or Custom is the first init question"
  - "Scope question for every interactive init"
  - "Custom setup steps"
  - "Cancelling init changes nothing"
  - "Detect existing installations"

  Also cover the installation scenarios "Install all agents by default", "Accept default models", "Configure architect model" and "Symlink install for development". `npm test` passes.

## 4. Install output

- [x] 4.1 Change install output (design D7, D8):
  - `logCopyPlan` only with `--verbose`.
  - The success summary keeps path, harness and agents/models, followed by a "Next steps" block. For claude-code: start Claude Code from the project root or `/reload-plugins`, `/five-role-team:apply`, the `CLAUDE.md` pointer. For pi: a generic line.
  - For claude-code, read `$HOME/.claude/plugins/installed_plugins.json` read-only. Any `five-role-team@<origin>` other than `skills-dir` adds a warning naming `claude plugin uninstall <that id>`. A missing, unreadable or unexpected file means no warning and no error.

  Verify with tests using a temp HOME for:
  - "[interaction] Quiet progress by default"
  - "Show installation progress" (with `--verbose`)
  - "Show success confirmation"
  - "[interaction] Next steps after a Claude Code install"
  - "[interaction] Warning when a marketplace copy would shadow the install" (fixture file containing `five-role-team@five-role-team`, and a second fixture with no such id that must print no warning)
  - a corrupt-JSON fixture that must not fail the install

  `npm test` passes.

## 5. README

- [x] 5.1 Rewrite the README install sections (design D9):
  - The single path: `npm install -g @pravinbashyal/five-role-team`, then `five-role-team init`.
  - The Default/Custom and scope questions explained in plain words.
  - A flags reference including `--default` and `--verbose`, and the uninstall command.
  - A short troubleshooting note on a marketplace copy shadowing the install and on managed settings.
  - Remove the clone, marketplace and `node install.js` sections.
  - Add a closing "Contributing" section with `npm link` then `five-role-team init --link`.

  Verify:
  - `grep -n "node install.js\|git clone\|claude plugin marketplace add\|claude plugin install" README.md` returns nothing.
  - `test/verify-sandbox.js` (or the README-commands check it hosts) runs the documented `npm install -g <packed tarball>` then `five-role-team init --default` in a sandbox and succeeds, covering "Documented commands work" and "No alternative install routes in the README".

## 6. Integration check

- [ ] 6.1 End-to-end check against the packed tarball:
  - `npm pack`, then install it globally into a temp prefix with a temp HOME.
  - In a temp project containing `.claude/`, run `five-role-team init --default`. Confirm `./.claude/skills/five-role-team/.claude-plugin/plugin.json`, `agents/` and `commands/` exist, and that the output ends with "Next steps".
  - Run `five-role-team uninstall --local --harness claude-code` and confirm the directory is gone.
  - Confirm `npm test` and `test/verify-pack-contents.js` pass.

## 7. Version flag

- [ ] 7.1 Add `--version` / `-v` to `install.js`:
  - Prints the `version` from the package's own `package.json` (one line, e.g. `1.1.0`) to stdout and exits 0, with no other output and nothing installed.
  - Works with no subcommand and takes precedence over other flags; it needs no TTY.
  - Listed in `showUsage` next to `--help`.

  Verify:
  - `node install.js --version` and `node install.js -v` print the version from `package.json` and exit 0.
  - Add checks to `test/test-command-grammar.js`; `npm test` passes.
  - Re-run the packed-tarball check from 6.1 and confirm `five-role-team --version` works there.

## Workflow follow-up

- Archive the change after review, then sync the delta specs into `openspec/specs/cli/`.
