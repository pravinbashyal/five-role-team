# Proposal

## Why

The README currently documents four ways to install five-role-team: `git clone` into `~/.claude/skills`, the Claude Code marketplace, `npm install -g` plus `five-role-team init`, and `node install.js` from a checkout. On top of that, the CLI itself accepts three install forms (`init`, `install`, bare), and its help and error hints still say `node install.js`. New users cannot tell which path is the right one, and the interactive flow asks scope, harness, agents and one model prompt per agent before anything is installed, with no "just give me the recommended setup" option. We want one documented path, `npm install -g @pravinbashyal/five-role-team` then `five-role-team init`, whose first question is Default or Custom.

This is now safe for Claude Code users: Claude Code loads a folder under `~/.claude/skills/` or a project's `.claude/skills/` that contains `.claude-plugin/plugin.json` as a full plugin (`<name>@skills-dir`, with agents and commands), which is exactly what `init` installs. Dropping the marketplace and clone routes from the docs therefore does not lose subagents or `/five-role-team:apply`.

## What Changes

- `five-role-team init` on a terminal starts with a summary of the default setup (detected harness, every agent with its model) and the question "How do you want to set up five-role-team?" with "Default (recommended)" and "Custom".
- Default and Custom both then ask where to install: "This project" or "All projects for this user", each labelled with its real path.
- Custom then asks harness (detected one preselected), agents, and a single "Keep default models?" question, prompting per agent only when the answer is no, and ends with a review and "Install?" confirmation.
- Harness detection for the default: pi when `./.pi` exists and `./.claude` does not, otherwise Claude Code.
- New `--default` flag: installs the default setup with no setup questions; scope is this project (local) unless `--global` is given; `--harness`, `--agents`, `--agent-models` override their part.
- Non-interactive runs that lack the needed flags exit 1 with a hint whose first suggestion is `five-role-team init --default`.
- **BREAKING**: the `install` alias and the bare install form are removed. Bare `five-role-team` prints help and installs nothing. Only `init` and `uninstall` exist.
- Output: per-directory "Copying ..." lines appear only with `--verbose`; a successful install ends with a "Next steps" block (restart or `/reload-plugins` from the repo root, run `/five-role-team:apply`, add the CLAUDE.md pointer).
- When a marketplace-installed `five-role-team` plugin would shadow the new install, "Next steps" warns and gives `claude plugin uninstall five-role-team@five-role-team` (read-only detection; nothing is uninstalled automatically).
- Help text, error messages and hints never mention `node install.js`.
- README documents one install path (npm then `init`), the interactive flow, `--default` and the flag reference, and `five-role-team uninstall`. The marketplace and `git clone` routes are removed; `--link` moves to a closing "Contributing" section (`npm link` then `five-role-team init --link`).
- Cancel at any question keeps exiting 0 and now says "Installation cancelled. Nothing was changed."
- Uninstall behaviour is unchanged (still never prompts, still needs scope and harness).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli/npm-distribution`: the `init` command grammar (no `install` alias, bare prints help), the interactive flow (Default/Custom first, then scope, then Custom steps), non-interactive `--default`, and the README requirement (single npm path, no clone alternative).
- `cli/installation`: default agent/model acceptance through the Custom "Keep default models?" question, non-interactive mode via `--default`, installation feedback (verbose-only copy lines, Next steps, shadow warning), existing-install wording, and every scenario still phrased as `node install.js`.

## Impact

- Code: `install.js` (argument parsing, `showUsage`, `main` prompt flow, hints, `logCopyPlan`, `logInstallSummary`), `select-agents.js` and `configure-models.js` (keep-defaults question), `install-files.js` (source-directory error wording).
- Tests: `test/test-install-modes.js`, `test/verify-sandbox.js`, `test/verify-matrix.js` and any test that exercises the `install` alias, the bare form, or the old hint text.
- Docs: `README.md` install sections rewritten.
- Users: anyone scripting `five-role-team install ...` or bare `five-role-team --global ...` must switch to `five-role-team init ...`.
- No new dependencies; `prompts` already covers select, multiselect and confirm.
