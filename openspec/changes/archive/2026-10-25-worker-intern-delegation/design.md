# Design

## Context

See proposal.md (Why). Constraints found during exploration:

- **Claude Code nesting.** Subagents may spawn subagents up to a depth limit (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, default 3 layers). In a *subagent definition*, `tools: Agent(intern)` does not restrict the spawnable type: the type list inside the parentheses is ignored. The only hard type block is a session-wide `permissions.deny: ["Agent(<type>)"]`, which would also block the orchestrator from dispatching `reviewer`/`supervisor`, so it is unusable here.
- **pi nesting (`pi-subagents`).** A child can call `subagent` only when its frontmatter `tools` explicitly includes `subagent` (or `allowNestedSubagents: true`); `allowedAgents: <names>` is an enforced allowlist of descendant agent names; depth is capped (default 2, `maxSubagentDepth`/`PI_SUBAGENT_MAX_DEPTH`). pi tool names are lowercase (`read, edit, write, bash, grep`).
- **Repo layout.** `agents/<id>.md` is the shared source; `pi/agents/<id>.md` holds pi-only overrides and today contains only `intern.md`. `install-files.js` `collectAgents(root, 'pi/agents', selected, ...)` already includes any selected `pi/agents/<id>.md` for pi and omits `pi/` for other harnesses; `copyInstall` rewrites each agent file's `model:`. `.claude/skills/five-role-team/` in this repo is an untracked install output, not a source.
- **Default model lookup.** `readDefaultModels` in `install.js` reads `agents/<id>.md` before `pi/agents/<id>.md`, so the pi worker's default model shown/installed comes from `agents/worker.md` (`haiku`); the `model:` line in `pi/agents/worker.md` is overwritten at install time.
- **Review gate.** `agents/reviewer.md` step 2 reads the real `git diff`, never the worker's summary. Intern edits land in the same working tree, so they are reviewed exactly like worker edits.

## Goals / Non-Goals

**Goals:**
- Worker can delegate in-task mechanical chores to intern on both Claude Code and pi.
- Delegation never weakens the core rule "no actor approves its own code".
- The reviewer can tell which parts of the diff were intern-produced.

**Non-Goals:**
- The orchestrator dispatching the intern (direction (2) from exploration).
- Changing the intern's model (`beam:cloud`) or Ollama setup.
- Fixing the intern-selectability disagreement between specs (see Known issues).
- Any installer source change; only spec wording and test coverage for `pi/agents/worker.md`.

## Decisions

1. **Worker is the intern's caller on both harnesses (direction A).** Alternative considered: orchestrator dispatches intern and worker stays unchanged. Rejected because splitting one task's implementation across two orchestrator-dispatched actors breaks "one worker per task" and hides the split from the reviewer's dispatch context.
2. **Claude Code: add `Agent` to `agents/worker.md` tools; restrict by instruction.** The instruction text MUST state: delegate only to `intern`; never spawn `reviewer`, `supervisor`, or any other type; only chores inside the single dispatched task. Alternative considered: `Agent(intern)` syntax. Rejected as ineffective in subagent definitions (the list is silently ignored), and writing it would suggest an enforcement that doesn't exist.
3. **pi: ship `pi/agents/worker.md` with `tools: read, edit, write, bash, grep, subagent` and `allowedAgents: intern`.** This enforces the restriction in pi. Same prompt body as `agents/worker.md` so the two stay behaviorally identical; differences are frontmatter only. Alternative considered: document the change for users' hand-maintained pi worker. Rejected by the Product Owner in favor of shipping the file.
4. **Worker keeps ownership of Verify and of the report.** After any intern delegation the worker runs the task's Verify itself. The report's "Files changed" (or "Notes") names files/hunks the intern produced, and marks those the intern obtained from `qwen2.5-coder:7b`.
5. **Homeserver-unreachable fallback.** The intern already reports "unreachable / model not installed" instead of writing code. On that report the worker does the chore itself and notes the fallback in its report. No retry loop.
6. **Intern prompt wording.** `agents/intern.md` and `pi/agents/intern.md` keep their behavior; only the framing of who calls them changes (the worker, for in-task chores). README.md line 16 and SKILL.md's role list drop "outside the role model" in favor of "dispatched by worker".

## Risks / Trade-offs

- **[Risk] Claude Code guard is instruction-only.** A worker with `Agent` can technically spawn `reviewer` or `supervisor` (self-approval) or any other type. → Mitigation: explicit prohibition in the worker prompt; the orchestrator never accepts a verdict that didn't come from its own `reviewer` dispatch, so a worker-spawned "review" carries no gate authority; the real reviewer still audits the full `git diff`. Residual risk accepted by the Product Owner.
- **[Risk] Scope expansion by proxy.** Worker could hand intern chores outside the task. → Mitigation: instruction limits delegation to the dispatched task; reviewer sees all edits in the diff regardless of author.
- **[Risk] Unreviewed-by-worker intern edits.** → Mitigation: worker runs Verify after delegation and attributes intern hunks in its report.
- **[Trade-off] Cost/latency.** Each delegation is an extra spawn and a second context re-reading files; the worker is already on haiku, so savings come mainly from offloading token-heavy mechanical edits to the local 7b model. Delegation is permitted, not required.
- **[Risk] Hand-maintained pi worker gets shadowed.** Users with their own `~/.pi/agent/agents/worker.md` get the shipped one only after reinstalling for pi. → Mitigation: README note in the same task as the README intern-line update.

## Known issues (out of scope)

- `agents/intern.md` has `model: beam:cloud`, which is not a Claude Code model alias/id; an intern spawned under Claude Code may fail to resolve its model. Left as-is by Product Owner decision.
- `openspec/specs/cli/npm-distribution/spec.md` (Custom flow, ~line 88) says intern is disabled unless the harness is pi, while `openspec/specs/cli/installation/spec.md` (~lines 25-27) says intern is selectable for every harness. This change's delta does not touch either requirement.

## Migration Plan

No data migration. Users pick up the new worker by re-running `five-role-team init`. Rollback: revert the agent files; the installer needs no change.
