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
- Node.js 14 or newer, for the `five-role-team` command.

Optional, used when present, never required:
- The [`context-mode`](https://github.com/mksglu/context-mode) plugin — `worker`/`reviewer`/`supervisor` route large/disposable command output through its `ctx_batch_execute`/`ctx_execute` tools when available, and fall back to plain `Bash` otherwise.
- A `graphify` knowledge graph for the codebase — queried for cross-file navigation before falling back to `grep`, never built just for one task.
- A browser-automation MCP server (a Playwright MCP server, `claude-in-chrome`, or an equivalent app-driving tool/skill) — `supervisor`'s interaction-conformance gate drives the running app with it when present; without one, the gate still runs and reports static-only, and a missing driver is never itself a blocking finding.

## Install

Install the command once, then set up each project:

```bash
npm install -g @pravinbashyal/five-role-team
cd your-project
five-role-team init
```

Then point a project's own `CLAUDE.md` at **`/five-role-team:apply`**, not just at the skill by name — see "Getting this skill to actually load" in `SKILL.md`. A CLAUDE.md pointer to the skill alone is unreliable: skills only take effect when invoked, and a plain `/opsx:apply` loads its own instructions directly without first triggering this one. The `/five-role-team:apply` command is the deterministic fix.

### The two questions

On a terminal, `five-role-team init` first prints the default setup: the detected harness, then each agent with its default model. Then it asks:

1. **How do you want to set up five-role-team?**
   - **Default (recommended)** installs every agent for the detected harness with its default model. It asks nothing else except where to install.
   - **Custom** asks, in order, for the harness, which agents to include, and whether to keep the default models (answer no to pick a model for each agent). It then shows a review and asks `Install? (Y/n)`. Nothing is written until you confirm.
2. **Where should five-role-team be installed?** (asked in both branches)
   - **This project** (preselected) installs into `./.claude/skills/five-role-team/`, or `./.pi/skills/five-role-team/` for pi. Only this project sees it.
   - **All projects for this user** installs into `~/.claude/skills/five-role-team/`, so every project sees it.

The paths in the question are the real paths for the harness in use.

The harness is detected from the current directory: pi when `./.pi` exists and `./.claude` does not, otherwise Claude Code. `--harness` overrides it.

If five-role-team is already installed at the chosen path, `init` asks `Overwrite existing installation at <path>?` with No as the default. Choosing No, or pressing Ctrl-C or Esc at any question, prints "Installation cancelled. Nothing was changed." and changes nothing.

### Without a terminal, or with `--default`

`five-role-team init --default` installs the default setup with no questions, whether or not you are in a terminal. Scope is this project unless you pass `--global`.

```bash
five-role-team init --default
five-role-team init --default --global
five-role-team init --default --harness pi --agent-models "worker=sonnet"
```

`--harness`, `--agents` and `--agent-models` replace their part of the default setup.

Without `--default` and without a terminal, `init` runs only with explicit flags. Pass `--harness` and `--agents` or `--agent-models`:

```bash
five-role-team init --global --harness pi --agents architect,worker,reviewer --agent-models "worker=sonnet"
```

If required flags are missing, `init` exits 1 and writes nothing. The hint suggests `five-role-team init --default` first.

### Flags

| Flag | Meaning |
| --- | --- |
| `--default` | Install the default setup with no setup questions. |
| `--global` / `--local` | Scope: `--global` installs for all projects for this user, `--local` installs into this project. Without a terminal, `init` defaults to `--local`. |
| `--harness <name\|path>` | `pi`, `claude-code`, or a custom skills directory path. |
| `--agents <list>` | Comma-separated agents to install, e.g. `architect,worker,reviewer`. Skips the agent question. Without it, every agent for the harness is installed. |
| `--agent-models <map>` | Comma-separated `agent=model` pairs, e.g. `"worker=sonnet,reviewer=opus"`. Skips the model questions. Short names are `opus`, `sonnet` and `haiku`; a name containing `/` is used as-is. |
| `--force` | Overwrite an existing installation without asking. Needed in scripts, because a run without a terminal cannot confirm. |
| `--verbose` | Print one "Copying ..." line per directory. Without it, the install is quiet. |
| `--help`, `-h` | Show usage. |

Running `five-role-team` with no subcommand prints usage and installs nothing. `install` is not a command; use `init`.

### Uninstall

```bash
five-role-team uninstall --local --harness claude-code
five-role-team uninstall --global --harness pi
```

Uninstall never prompts. It needs both a scope (`--global` or `--local`) and a `--harness`. It removes the installed copy, including `.agent-config.json`, and for pi also removes the `~/.pi/agent/skills/five-role-team` symlink. With nothing installed it exits 1 with "Nothing to uninstall".

### Harness notes

- **`claude-code`** installs to `~/.claude/skills/five-role-team` (global) or `./.claude/skills/five-role-team` (local). For a local install, start Claude Code from the project root.
- **`pi`** installs to `~/.claude/skills/five-role-team` (global) with a symlink at `~/.pi/agent/skills/five-role-team`, or to `./.pi/skills/five-role-team` (local).
- **A custom path** installs to `<path>/five-role-team`.

### Troubleshooting

- **A marketplace copy shadows the install.** If you previously installed five-role-team from the Claude Code marketplace, that copy takes precedence over the npm install, and the new install will not load. After a Claude Code install, `init` warns in its "Next steps" block when it finds such a copy and prints the exact command. Remove it with `claude plugin uninstall five-role-team@five-role-team`. The installer never uninstalls anything itself.
- **Managed settings block the plugin.** If your organisation manages Claude Code settings, a managed setting can stop skills-directory plugins from loading, without showing an error. Check `/status` in Claude Code, and see the Claude Code plugin documentation for managed settings.
- **`/five-role-team:apply` is missing.** Start Claude Code from the project root, or run `/reload-plugins` in an open session.

## Testing the installer

`npm test` runs every check, including `test/verify-readme-commands.js`, which packs the tarball, installs it globally into a temporary prefix, and runs the documented commands in a sandbox. Each check runs in its own temp HOME and temp working directory, never in your real `~/.claude` or `~/.pi`.

## Why a plugin instead of copy-pasting the agent files

The three agent personas alone aren't the whole system — the dispatch loop (record base SHA, one task at a time, re-review exceptions, section gating, escalation rules) lived in a single project's `CLAUDE.md` prose. Packaging it as a skill means installing this plugin gives a new project the whole protocol, not just personas that still need a hand-copied `CLAUDE.md` section.

## Contributing

To work on five-role-team itself, link the checkout instead of installing a copy:

```bash
cd five-role-team
npm install
npm link
five-role-team init --link
```

`npm install` fetches the `prompts` dependency, and `npm link` puts `five-role-team` on your PATH from the checkout. `init --link` then symlinks the checkout into the harness's skills directory, so edits there are picked up without reinstalling. On a terminal it asks only the scope and harness questions; it asks nothing about Default/Custom, agents or models, because a link installs the whole checkout.
