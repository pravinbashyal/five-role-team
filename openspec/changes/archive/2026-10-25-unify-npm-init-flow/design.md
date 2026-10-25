# Design

## Context

See proposal.md for motivation. Current state, from `install.js`:

- `parseArgs` accepts `init`, `install` and a bare form; `init` silently sets local scope (lines 165-167).
- `main` prompts for missing scope (not for `init`) and harness (lines 643-661), then agents (`promptAgentSelection`), then one model prompt per agent (`promptModelConfiguration`).
- Without a TTY, a missing harness, or neither `--agents` nor `--agent-models`, exits 1 with hints that say `node install.js` (lines 646, 655, 740-744).
- `logCopyPlan` prints one "Copying" line per directory; `logInstallSummary` ends the run with no next steps.
- `confirmOverwrite` defaults to No and needs `--force` without a TTY.

Claude Code loads a folder under `~/.claude/skills/` or the project's `.claude/skills/` that contains `.claude-plugin/plugin.json` as a full plugin with id `<manifest name>@skills-dir`: agents, commands and `${CLAUDE_PLUGIN_ROOT}` substitution all work, in place (code.claude.com/docs/en/plugins/loading, "Find where a plugin came from", "In-place and copied plugins"). `INSTALL_DIRS` in `install-files.js` already copies `.claude-plugin/`, `agents/`, `commands/` and `conventions/`, so the npm install is a complete plugin. Precedence rules from the same page: an installed marketplace plugin with the same manifest name wins over a skills-directory plugin (the skills-dir copy shows "Not loaded" in `/plugin` Errors); between two skills-dir copies, the user one wins over the project one; a project copy loads only when Claude Code starts from the repo root and the folder is trusted.

## Goals / Non-Goals

**Goals:**
- One state machine for `init` that both the terminal flow and `--default` resolve through, so Default in the terminal and `--default` produce the same install.
- Every user-facing string names `five-role-team`, never `node install.js`.

**Non-Goals:**
- Changing uninstall behaviour (still never prompts, still needs scope and harness).
- Auto-uninstalling or disabling a marketplace copy; detection is read-only.
- Removing `.claude-plugin/marketplace.json` from the repo; it stays, undocumented.
- pi-specific "Next steps" beyond a generic line; pi's loading rules are not changed.

## Decisions

### D1. Flow

```
five-role-team init [flags]
  |
  +-- --link? ------------------> scope? -> harness? -> confirm overwrite -> link install
  |                               (no Default/Custom, agents or models: link mode ignores them)
  |
  +-- --default? ---------------> resolve bundle (no questions) -> confirm overwrite -> install
  |
  +-- no TTY -------------------> enough flags? (harness + agents/models) -> install
  |                               else exit 1, hint: "five-role-team init --default" first
  |
  +-- TTY:
        print default summary (detected harness, agents + models)
        "How do you want to set up five-role-team?"  [Default (recommended)] [Custom]
          |                                   |
          v                                   v
        scope? (unless flag)               scope? (unless flag)
          |                                harness? (unless flag; detected preselected)
          |                                agents?  (unless --agents)
          |                                "Keep default models? (Y/n)" (unless --agent-models)
          |                                  n -> per-agent prompts
          |                                review + "Install? (Y/n)"
          v                                   v
        confirm overwrite if an install exists (default No; --force skips)
          v
        install -> summary -> Next steps (+ shadow warning)
```

Default/Custom is always the first question in the terminal, even when flags are given; flags only remove their own question. Under Default, explicit `--harness`, `--agents`, `--agent-models` replace their part of the bundle, and the summary shown before the question reflects those overrides.

### D2. Default bundle

- Harness: `--harness` if given; else pi when `./.pi` exists and `./.claude` does not; else claude-code. Detection looks only at the current directory.
- Agents: every agent, including intern, the same set the Custom multiselect preselects.
- Models: the frontmatter defaults from `readDefaultModels`.
- Scope: not part of the bundle in the terminal (always asked unless flagged). For `--default` with no scope flag, local. This matches today's `init` default and keeps scripted runs inside the current directory. The PO chose this.

Alternative considered: putting scope inside Default as "local". Rejected by the PO; scope is the one choice whose right answer depends on the user.

### D3. Scope labels

Both branches share one prompt: "Where should five-role-team be installed?" with "This project (<abs primary path>)" preselected and "All projects for this user (<~-abbreviated primary path>)". Paths come from `resolveHarnessPath` for the harness in effect at that moment: the detected or flagged harness. In Custom the harness question comes after scope, so a later harness change can move the path; the review screen always shows the final resolved path. Alternative considered: asking harness before scope in Custom. Rejected because the PO fixed the order as scope first.

### D4. Models in Custom

One `confirm` "Keep default models? (Y/n)", initial Yes. Only on No does the existing per-agent prompt loop run. `--agent-models` skips the confirm; agents named there use the flagged value and the rest use defaults (same as today's `resolveAgentModels`).

### D5. Non-interactive rules

- `--default`: never asks setup questions, TTY or not. Overwrite still follows `confirmOverwrite`: it asks in a terminal, and without one it requires `--force`. Overwriting is destructive, so `--default` does not imply `--force`.
- Without `--default` and without a TTY: the existing explicit-flag path keeps working (`--harness` plus `--agents` and/or `--agent-models`; scope defaults to local for `init`). Anything missing exits 1 with a hint that suggests `five-role-team init --default` first, then an explicit-flags example.

### D6. Command grammar

- `parseArgs` accepts `init` and `uninstall` only.
- `install` is an unknown argument (exit 1, pointer to `five-role-team init`).
- No subcommand with no flags prints usage and exits 0. No subcommand with flags prints usage plus "to install, run `five-role-team init`" and exits 1, because an attempted install that does nothing should not look like success to a script.
- `--help` exits 0 as today.
- New flags: `--default`, `--verbose`.

### D7. Output

- `logCopyPlan` runs only with `--verbose`.
- `logInstallSummary` keeps the path, harness and agent/model list.
- A new Next steps block follows. For claude-code: start Claude Code from the project root or run `/reload-plugins`, then run `/five-role-team:apply`, then point `CLAUDE.md` at `/five-role-team:apply`. For pi: a generic "start pi in this project" line.
- Cancel and decline messages become "Installation cancelled. Nothing was changed."; exit code stays 0. These were designer recommendations (F4/F5), taken as defaults; the PO was not asked.

### D8. Shadow detection

For the claude-code harness only, after a successful install, read `~/.claude/plugins/installed_plugins.json` (JSON, `plugins` keyed by id). Any key whose name part is `five-role-team` and whose origin is not `skills-dir` counts as a shadowing copy. Print the warning with that exact id in `claude plugin uninstall <id>`. A missing or unreadable file, or an unexpected shape, means no warning and never an error. Reading the file is preferred over spawning `claude plugin list --json`, because it needs no `claude` binary on PATH, starts no process, and is cheap to fake in tests (point HOME at a temp dir). The `five-role-team@five-role-team` id is present on the maintainer's own machine today, so the warning path will be hit in practice.

Also considered: a user-level skills-dir copy shadowing a new project-level one. Not warned in this change. That case is visible in `/plugin` Errors and is less likely after a single documented path.

### D9. README

- Install: `npm install -g @pravinbashyal/five-role-team`, then `five-role-team init`.
- What the two questions mean: the Default/Custom choice, then the scope question.
- Flags reference: `--default`, `--global`/`--local`, `--harness`, `--agents`, `--agent-models`, `--force`, `--verbose`.
- Uninstall: `five-role-team uninstall --global|--local --harness <h>`.
- Remove the `## Install` (clone and marketplace) and "Alternative: clone + node install.js" sections.
- A closing "Contributing" section shows `npm link` then `five-role-team init --link`.
- `install-files.js`'s "Run install.js from the five-role-team directory" message is reworded so it does not tell npm users to run a script.

## Risks / Trade-offs

- [Scripts using `five-role-team install` or the bare form break] → Version bump and a README note. The error message points straight at `five-role-team init`.
- [Users who installed through the marketplace keep it and the npm copy silently does not load] → D8 warning in Next steps with the exact uninstall command.
- [Managed settings block skills-directory plugins with no error] → Out of the installer's control; README troubleshooting line points to `/status` and the Claude Code docs.
- [Harness detection guesses wrong in a directory with both `./.pi` and `./.claude`] → Defaults to Claude Code, the summary names it before the first question, and Custom or `--harness` changes it.
- [The scope label shows a path that changes after the Custom harness question] → The review screen shows the final path before anything is written.

## Migration Plan

Ship as a minor/major npm version bump, since removing the `install` alias is a breaking CLI change. Rollback means republishing the previous version. No data migration: existing installs stay valid, and re-running `init` overwrites them after confirmation.
