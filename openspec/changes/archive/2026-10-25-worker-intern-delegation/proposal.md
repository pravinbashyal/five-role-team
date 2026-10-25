# Proposal

## Why

`agents/intern.md` defines a helper for menial chores that sends small code-writing chores to a local `qwen2.5-coder:7b`, but no role ever dispatches it: `agents/worker.md` has no subagent-spawning tool, and nothing in `agents/`, `commands/` or `SKILL.md` names the intern as a callee (README.md calls it "helper outside the role model"). The worker is the role that actually does mechanical work during apply, so it is the natural caller. Both harnesses now support nested subagents (Claude Code up to a depth limit; pi via `pi-subagents` with an explicit `subagent` tool grant), so the worker can delegate without changing the orchestrator loop.

## What Changes

- The `worker` role may delegate mechanical chores to `intern`, under these rules written into its instructions:
  - only chores that fall inside the worker's single dispatched task (no scope expansion by proxy)
  - never spawn `reviewer`, `supervisor`, or any agent type other than `intern`
  - after the intern returns, the worker still runs the task's Verify step itself
  - the worker's report names which files/hunks came from the intern, and from `qwen2.5-coder:7b` when the intern used it
  - if the intern reports the homeserver unreachable (or the model missing), the worker does the chore itself and notes that fallback in its report
- Claude Code: `agents/worker.md` gains the `Agent` tool. The restriction to `intern` is instruction-only (Claude Code ignores `Agent(type)` lists in subagent definitions).
- pi: a new `pi/agents/worker.md` ships in the repo with pi tool names plus `subagent` and `allowedAgents: intern`, so the restriction is enforced by `pi-subagents`.
- `agents/intern.md` / `pi/agents/intern.md`, `README.md` and `SKILL.md` describe the worker as the intern's caller instead of "outside the role model".
- The installer ships `pi/agents/worker.md` for pi installs and keeps excluding `pi/` for other harnesses (existing per-agent `pi/agents` handling already covers this; only the spec wording changes).

## Capabilities

### New Capabilities

None. Agent prompt files are not governed by a spec capability.

### Modified Capabilities

- `cli/installation`: the "Handle harness-specific files" requirement now names `pi/agents/worker.md` alongside `pi/agents/intern.md` as a pi-specific file.

## Impact

- `agents/worker.md` (tools + instructions), new `pi/agents/worker.md`, `agents/intern.md`, `pi/agents/intern.md`, `README.md`, `SKILL.md`
- Installer test coverage for the new pi file (no installer source change expected: `collectAgents` in `install-files.js` already includes any selected `pi/agents/<id>.md`)
- Users with a hand-maintained `~/.pi/agent/agents/worker.md` will see the shipped pi worker once they reinstall for pi
- Out of scope, noted as known issues in design.md: the intern's `model: beam:cloud` on Claude Code; the intern-selectability disagreement between `cli/npm-distribution` and `cli/installation`
