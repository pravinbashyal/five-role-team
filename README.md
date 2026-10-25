# five-role-team

A Claude Code plugin that packages a seven-role development model — Product Owner / `designer` / `architect` / orchestrator / `worker` / `reviewer` / `supervisor` — for planning and implementing [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes — based on the workflow described at claude.rendle.dev. The plugin is still named `five-role-team` for the five-role implementation loop it governs (Product Owner / orchestrator / worker / reviewer / supervisor); `designer` and `architect` are its two plan-time roles, run before any task exists to implement.

The core rule: **no actor approves its own code.** The main session (orchestrator) never writes or approves implementation code directly. It dispatches a `worker` subagent to implement one task, then a `reviewer` subagent (fresh context, no memory of how the code was written) to audit it. Multi-task sections get an additional `supervisor` pass (Opus) that audits cross-task composition once every task in the section is individually reviewer-approved.

Before any of that, plan time has its own order: a `designer` role (Opus, read-only) runs first on interaction-relevant topics — researching users, existing surfaces, and prior art, then handing off a designed interaction as draft scenarios — and an `architect` role (also Opus) runs after it, owning exploration and planning generally and, once scope is confirmed, writing the proposal/design/specs/tasks that `worker` later implements. When `architect` receives a `designer` handoff, it folds each designed interaction into its specs as an ordinary OpenSpec scenario whose name is prefixed with the literal tag `[interaction]` — see `conventions/interaction-specs.md`. If any of a change's specs carry that tag, `supervisor` runs once more at the change's final section gate, in an interaction-conformance mode: it always statically verifies the implementation against every tagged scenario, and additionally drives the running app when a browser-automation tool is available in the session, reporting per-scenario as satisfied, violated, or undetermined.

## What's in this plugin

- `agents/designer.md` — plan-time, runs before `architect` on interaction-relevant topics: researches users, existing surfaces, and prior art, then hands off a designed interaction as draft `[interaction]`-tagged scenarios; writes no files, no code, no mockups
- `agents/architect.md` — explores an idea/problem in OpenSpec explore-mode stance, folds in any `designer` handoff, and captures confirmed scope as change artifacts; never implements code
- `agents/worker.md` (Haiku) — implements exactly one task at a time, never marks its own work done
- `agents/reviewer.md` — audits a worker's diff with fresh context, never implements
- `agents/supervisor.md` — audits a completed multi-task section's composition, and (once per change, only when the change's specs carry `[interaction]`-tagged scenarios) gates the change's implementation against them; never implements
- `agents/intern.md` — helper outside the role model: handles menial chores for other agents (file lookups, boilerplate edits, mechanical cleanups) and delegates small code-writing chores to a local `qwen2.5-coder:7b`; makes no design or review decisions
- `SKILL.md` (this plugin's root skill, `five-role-team`) — the orchestrator's dispatch-loop protocol; overrides step 6 of the `openspec-apply-change` skill's default "implement inline" behavior
- `commands/explore.md` (`/five-role-team:explore [topic]`) — judges interaction-relevance and, when it applies, dispatches `designer` (Opus) before dispatching `architect` (Opus) for exploration/planning, instead of running explore mode inline in the main session's model
- `commands/apply.md` (`/five-role-team:apply [change-name]`) — the reliable entry point; loads the protocol and the OpenSpec apply steps together in one turn instead of hoping the skill gets triggered on its own
- `conventions/review-comments.md` — the [Conventional Comments](https://conventionalcomments.org/) format `reviewer`/`supervisor` write findings in, referenced via `${CLAUDE_PLUGIN_ROOT}`
- `conventions/interaction-specs.md` — the `[interaction]` scenario tagging convention (exact syntax, what qualifies, the surface-naming rule, and the canonical detection grep) that `designer`, `architect`, and `supervisor` all reference via `${CLAUDE_PLUGIN_ROOT}`

## Requirements

- A project using [OpenSpec](https://github.com/Fission-AI/OpenSpec) (`tasks.md`, `proposal.md`, `design.md`, `specs/*/spec.md`) — this isn't a general-purpose task runner.
- The `openspec-apply-change` skill (or equivalent) for the actual OpenSpec CLI plumbing.

Optional, used when present, never required:
- The [`context-mode`](https://github.com/mksglu/context-mode) plugin — `worker`/`reviewer`/`supervisor` route large/disposable command output through its `ctx_batch_execute`/`ctx_execute` tools when available, and fall back to plain `Bash` otherwise.
- A `graphify` knowledge graph for the codebase — queried for cross-file navigation before falling back to `grep`, never built just for one task.
- A browser-automation MCP server (a Playwright MCP server, `claude-in-chrome`, or an equivalent app-driving tool/skill) — `supervisor`'s interaction-conformance gate drives the running app with it when present; without one, the gate still runs and reports static-only, and a missing driver is never itself a blocking finding.

## Install

From a local checkout (auto-loads every session, no marketplace needed):

```
git clone <this repo> ~/.claude/skills/five-role-team
```

From GitHub, in any project:

```
claude plugin marketplace add pravinbashyal/five-role-team
claude plugin install five-role-team@five-role-team
```

Then point a project's own `CLAUDE.md` at **`/five-role-team:apply`**, not just at the skill by name — see "Getting this skill to actually load" in `SKILL.md`. A CLAUDE.md pointer to the skill alone is unreliable: skills only take effect when invoked, and a plain `/opsx:apply` loads its own instructions directly without first triggering this one. The `/five-role-team:apply` command is the deterministic fix.

## Installation

Recommended (no clone needed): install the command globally, then initialize it inside each project:

```bash
npm install -g @pravinbashyal/five-role-team
cd your-project
five-role-team init
```

`five-role-team init` defaults to **local** scope, installing into `./.claude/skills/five-role-team/` (or `./.pi/skills/five-role-team/` for pi). Add `--global` to install into your user-wide skills directory instead. On a terminal it prompts for the harness (`pi`, `claude-code`, or a custom skills directory path) and, when `--agents`/`--agent-models` are omitted, for agents and models. `init` never prompts for scope. With no TTY, a missing harness (or, outside `init`, scope) exits 1 with a hint, so pass the flags:

```bash
# install into the current project for Claude Code
five-role-team init --harness claude-code --agents architect,worker,reviewer --agent-models "worker=sonnet"

# install into the user-wide skills directory for pi
five-role-team init --global --harness pi --agents architect,worker,reviewer,supervisor,intern --agent-models "worker=sonnet"

# install is an alias for init
five-role-team install --local --harness claude-code --agents architect,worker,reviewer --agent-models "worker=sonnet"

# uninstall (scope and harness are both required)
five-role-team uninstall --local --harness claude-code
five-role-team uninstall --global --harness pi
```

`install` is accepted as an alias for `init` (`five-role-team install ...`). Check `five-role-team --help` for the full option list.

### Alternative: clone + node install.js

`install.js` copies (or links) the plugin into a harness's skills directory and lets you choose which agents to include and which model each one uses. Run it from a five-role-team checkout: the script refuses to run from any directory that does not contain `.claude-plugin/plugin.json`. It is an alternative to the npm flow above and the marketplace install under "Install", not a step to combine with them.

### Prerequisites

- Node.js 14 or newer.
- `npm install` once in the checkout. It installs `prompts`, which the interactive prompts use.

### Options

- `--global` or `--local` (one is required): install to the global skills directory (`~/.claude/skills/`; `pi` also gets a symlink, see Harness notes) or to the project's skills directory (`./.claude/skills/` or `./.pi/skills/`).
- `--harness <name|path>` (required): `pi`, `claude-code`, or a custom skills directory path.
- `--link`: symlink the checkout instead of copying files (development mode).
- `--force`: replace an existing installation without asking.
- `--agents <list>`: comma-separated agents to install, e.g. `architect,worker,reviewer`.
- `--agent-models <map>`: comma-separated `agent=model` pairs, e.g. `"worker=sonnet,reviewer=opus"`. Short names are `opus`, `sonnet` and `haiku`; a name containing `/` is used as-is.

Uninstall is a subcommand, not a flag: `node install.js uninstall --global --harness <name|path>`.

### Interactive

With neither `--agents` nor `--agent-models`, the script asks which agents to include, then the model for each selected agent. Press Enter at a model prompt to keep its default. This needs a terminal: without one, the script exits 1 and suggests the flags.

```bash
node install.js --global --harness pi
```

### Non-interactive

Either flag skips the prompts. `--agents` picks the agents and keeps their default models. `--agent-models` overrides models; without `--agents`, every agent the harness supports is installed.

```bash
node install.js --global --harness pi --agents architect,worker,reviewer,supervisor,intern --agent-models "worker=sonnet"
```

For a development symlink install (`--link`), see the last example under Common scenarios.

### Common scenarios

Team without a designer: list only the agents you want. `designer` is not installed and is left out of `.agent-config.json`. Without `--agent-models`, each agent keeps its default model.

```bash
node install.js --global --harness claude-code --agents architect,worker,reviewer,supervisor
```

Custom models: `--agent-models` replaces the model of each named agent, and the other selected agents keep their defaults. Short names are expanded to full model paths.

```bash
node install.js --global --harness claude-code --agents architect,worker,reviewer --agent-models "worker=sonnet,reviewer=opus"
```

A name containing `/` is used as-is, so a full model path works too:

```bash
node install.js --global --harness claude-code --agents architect,worker,reviewer --agent-models "architect=anthropic/claude-opus-4-5-20251101"
```

Development symlink install: `--link` points the harness at the checkout, so edits there are picked up without reinstalling. In `--link` mode the agent and model choices are not applied: the whole source directory is linked and no `.agent-config.json` is written. The `--agents` value below only stops the command from asking agent and model questions, and it has no effect on the link.

```bash
node install.js --global --harness claude-code --link --agents worker
```

### Uninstall

```bash
node install.js uninstall --global --harness pi
```

A copy install is deleted, including `.agent-config.json`. A `--link` install loses only its symlink; the checkout is never touched. For `pi`, the `~/.pi/agent/skills/` symlink is removed too. With nothing installed, the command exits 1 with "Nothing to uninstall".

### Harness notes

- **`pi`** installs to `~/.claude/skills/five-role-team` and adds a symlink at `~/.pi/agent/skills/five-role-team` pointing to it.
- **`claude-code`** installs to `~/.claude/skills/five-role-team` and leaves out the pi-only files.
- **A custom path** installs to `<path>/five-role-team`.
- **`--local`** installs into the current directory, so run it from the project root.
- Copy installs write `.agent-config.json` next to the plugin, recording the agents and models. `--link` installs write none.
- Re-running over an existing installation asks before replacing it. Without a terminal it exits 1, so pass `--force` in scripts.

### Testing the installer

The manual install-mode matrix scripts live in the checkout's `test/` directory: `test/test-install-modes.js` (install) and `test/test-uninstall-modes.js` (install then uninstall). Each covers 16 mode cells. Every cell runs in its own temp HOME and temp working directory, never in your real `~/.claude` or `~/.pi`. Run them from the checkout with an empty stdin:

- `node test/test-install-modes.js </dev/null`
- `node test/test-uninstall-modes.js </dev/null`

## Why a plugin instead of copy-pasting the agent files

The three agent personas alone aren't the whole system — the dispatch loop (record base SHA, one task at a time, re-review exceptions, section gating, escalation rules) lived in a single project's `CLAUDE.md` prose. Packaging it as a skill means installing this plugin gives a new project the whole protocol, not just personas that still need a hand-copied `CLAUDE.md` section.
