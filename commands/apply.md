---
description: Implement OpenSpec change tasks using the five-role-team orchestrator protocol (worker/reviewer/supervisor dispatch). Use this instead of /opsx:apply or the openspec-apply-change skill directly — it guarantees the protocol actually loads.
argument-hint: [change-name]
---

# five-role-team apply

A plain `/opsx:apply` (or a request to "continue implementing") does **not** reliably pull in the `five-role-team` skill first — skills only take effect when invoked, and a slash command's own instructions load directly without first triggering other skills' descriptions. This command is the deterministic fix: invoking it loads both the orchestrator protocol and the OpenSpec apply steps in the same turn, so there's no dependence on the model deciding to fetch the skill on its own.

Change (if given): $ARGUMENTS

## Steps

1. Load and follow this plugin's root skill (`SKILL.md` — the five-role-team orchestrator protocol) in full. You are now the orchestrator for everything below.
2. Load and follow the `openspec-apply-change` skill (or `opsx:apply`, whichever this project has installed) for its steps up through "get apply instructions" / context loading — everything before "Implement tasks." Use `$ARGUMENTS` as the change name if given, otherwise follow that skill's own change-selection logic.
3. For that skill's "Implement tasks" step, do **not** use its default inline-implementation behavior. Use the five-role-team dispatch loop instead — dispatch `worker`, `reviewer`, and (for multi-task sections) `supervisor` subagents exactly as the root `SKILL.md` describes.
