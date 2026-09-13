# five-role-team

A Claude Code plugin that packages a seven-role development model — Product Owner / `designer` / `architect` / orchestrator / `worker` / `reviewer` / `supervisor` — for planning and implementing [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes — based on the workflow described at claude.rendle.dev. The plugin is still named `five-role-team` for the five-role implementation loop it governs (Product Owner / orchestrator / worker / reviewer / supervisor); `designer` and `architect` are its two plan-time roles, run before any task exists to implement.

The core rule: **no actor approves its own code.** The main session (orchestrator) never writes or approves implementation code directly. It dispatches a `worker` subagent to implement one task, then a `reviewer` subagent (fresh context, no memory of how the code was written) to audit it. Multi-task sections get an additional `supervisor` pass (Opus) that audits cross-task composition once every task in the section is individually reviewer-approved.

Before any of that, plan time has its own order: a `designer` role (Opus, read-only) runs first on interaction-relevant topics — researching users, existing surfaces, and prior art, then handing off a designed interaction as draft scenarios — and an `architect` role (also Opus) runs after it, owning exploration and planning generally and, once scope is confirmed, writing the proposal/design/specs/tasks that `worker` later implements. When `architect` receives a `designer` handoff, it folds each designed interaction into its specs as an ordinary OpenSpec scenario whose name is prefixed with the literal tag `[interaction]` — see `conventions/interaction-specs.md`. If any of a change's specs carry that tag, `supervisor` runs once more at the change's final section gate, in an interaction-conformance mode: it always statically verifies the implementation against every tagged scenario, and additionally drives the running app when a browser-automation tool is available in the session, reporting per-scenario as satisfied, violated, or undetermined.

## What's in this plugin

- `agents/designer.md` — plan-time, runs before `architect` on interaction-relevant topics: researches users, existing surfaces, and prior art, then hands off a designed interaction as draft `[interaction]`-tagged scenarios; writes no files, no code, no mockups
- `agents/architect.md` — explores an idea/problem in OpenSpec explore-mode stance, folds in any `designer` handoff, and captures confirmed scope as change artifacts; never implements code
- `agents/worker.md` — implements exactly one task at a time, never marks its own work done
- `agents/reviewer.md` — audits a worker's diff with fresh context, never implements
- `agents/supervisor.md` — audits a completed multi-task section's composition, and (once per change, only when the change's specs carry `[interaction]`-tagged scenarios) gates the change's implementation against them; never implements
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

## Why a plugin instead of copy-pasting the agent files

The three agent personas alone aren't the whole system — the dispatch loop (record base SHA, one task at a time, re-review exceptions, section gating, escalation rules) lived in a single project's `CLAUDE.md` prose. Packaging it as a skill means installing this plugin gives a new project the whole protocol, not just personas that still need a hand-copied `CLAUDE.md` section.
