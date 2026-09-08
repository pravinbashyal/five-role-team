---
name: five-role-team
description: Use when implementing tasks from an OpenSpec change and the project wants a five-role model (Product Owner / orchestrator / worker / reviewer / supervisor) instead of the main session writing and approving its own code. Trigger phrases — "implement this OpenSpec change", "start/continue implementation", "work through tasks.md", "dispatch a worker for this task" — or a project's own CLAUDE.md says implementation goes through this protocol. Requires the `openspec-apply-change` skill (or equivalent OpenSpec tooling) and the `Agent` tool with `worker`/`reviewer`/`supervisor` subagent types (bundled with this plugin).
---

# Five-role orchestrator protocol

This skill puts the main session into an **orchestrator** role for OpenSpec task implementation, using a five-role development model (Product Owner / orchestrator / worker / reviewer / supervisor), based on the workflow described at claude.rendle.dev.

- **Product Owner** — the user. Writes/approves specs, decides on nits.
- **Orchestrator** — the main session (you, right now). Coordinates, never writes or approves implementation code itself.
- **worker** (this plugin's `agents/worker.md`, Sonnet) — implements exactly one task at a time.
- **reviewer** (this plugin's `agents/reviewer.md`, Sonnet) — audits the worker's diff with fresh context; never implements.
- **supervisor** (this plugin's `agents/supervisor.md`, Opus) — audits a completed multi-task section's composition; never implements.

**Core rule: no actor approves its own code.** The orchestrator must never implement a task's code directly and then consider it done — always dispatch to `worker` via the `Agent` tool (`subagent_type: "worker"`), then dispatch the review to `reviewer` (`subagent_type: "reviewer"`) in a separate call so it starts with zero context of how the code was written.

## This overrides step 6 of the `openspec-apply-change` skill

That skill's default "Implement tasks (loop until done or blocked)" step normally has the main session write the code inline. Replace it with this loop, one task at a time:

1. **Dispatch `worker`.**
   - Before the first task of a `## N.` section with more than one task, record `git rev-parse HEAD` in your own context (nothing written to disk) — the base SHA `supervisor` needs in step 4.
   - Dispatch with: the change name, the single task ID, and the context file paths from `openspec instructions apply`. Wait for its report.
   - **Re-iteration** (a `reviewer` `CHANGES REQUESTED` from step 3, or a `supervisor` `REQUEST CHANGES` remediation from step 4): don't spawn a fresh `worker` — resume the original instance via `SendMessage` to its first dispatch's agent-id, since it already holds the task's context and re-spawning wastes tokens re-reading everything.
     - For a section-wide supervisor remediation there may be several prior worker agent-ids: resume whichever worker's task owns the file(s) the remediation's blockers touch. Only if the remediation spans files from more than one task (genuine cross-task drift, no single owner) spawn a fresh `worker` instead of guessing.
   - `reviewer` and `supervisor` are the opposite: always spawn them fresh each round, never `SendMessage`-resumed — fresh eyes checking whether a fix landed is the point.
2. **Dispatch `reviewer`** with: the same change name and task ID, the context file paths, and the worker's report (files changed, verify performed) — not the worker's dispatch transcript beyond that report; fresh eyes is the point.
3. **Parse `reviewer`'s verdict.** It writes findings as [Conventional Comments](https://conventionalcomments.org/) (`issue`, `suggestion`, `todo`, `question`, `nitpick`, `chore`, with optional `(blocking)`/`(non-blocking)`/`(if-minor)` decorations) and ends `## APPROVED` or `## CHANGES REQUESTED`.
   - **APPROVED** →
     1. Mark the task `- [x]` in `tasks.md`.
     2. Resume that task's `worker` via `SendMessage` to commit: stage exactly the files its report listed as changed, plus the `tasks.md` checkbox edit (omit that edit for a remediation, which has no `tasks.md` entry), with a message naming the change and task ID and the project's required attribution trailer. Wait for its confirmation.
     3. Surface any non-blocking comments (nitpicks, todos, questions, chores) to the user for a decide-or-skip call.
     4. Move to the next task. If that was the section's last task, go to step 4.
   - **CHANGES REQUESTED** → relay the exact numbered blocking comments back to `worker` for another iteration on *this same task only*; repeat from step 1. Don't batch review rounds or move ahead to other tasks while one is blocked.
4. **Section gate**, once every task in a `## N.` section is reviewer-approved (or orchestrator-Verify-approved via the trivial-task fast path below):
   - **Exactly one task** → proceed straight to the next section, no `supervisor` dispatch. Tell the user the section's context is safe to compact — `tasks.md` plus the working-tree diff hold the durable record.
   - **More than one task** → dispatch `supervisor` with: the change name, the section's task IDs, the context file paths, the `git rev-parse HEAD` recorded in step 1, and the set of files the section's tasks touched (from each worker report) as its diff scope — never a blind repo-wide diff. `supervisor` audits only cross-task composition (drift, duplicated abstraction, dead scaffolding, section-level requirements no single task satisfies alone) against `design.md` Decisions and `specs/*/spec.md`; it doesn't re-review single-task correctness (`reviewer` already did), never edits code or `tasks.md`, and only reports a verdict — checkboxes are already set from step 3.
   - Parse `supervisor`'s verdict:
     - **`## APPROVE`** → section done, **no additional commit** (each task already committed individually in step 3). Tell the user the section's context is safe to compact, surface any non-blocking notes, continue to the next section.
     - **`## REQUEST CHANGES`** → route the exact numbered blocking comments to `worker` as a remediation task scoped to the section (repeat steps 1–2; it gets no `tasks.md` entry, the blockers are handed to `worker` directly, same as a `reviewer` `CHANGES REQUESTED` relay), have `reviewer` audit that diff, then re-dispatch `supervisor` over the whole section again. Once `reviewer` approves the remediation, step 3's APPROVED commit fires for it too (minus the `tasks.md` edit) — the one case a section gets a commit after its tasks are already committed.
5. **Escalate instead of iterating** when: the same task fails review twice in a row; a blocker looks like a spec/design problem rather than an implementation bug; or `supervisor` returns `## REQUEST CHANGES` for the same section twice in a row. Pause and surface to the user instead of another round.
6. Destructive or irreversible steps (force-push, history rewrite, deleting resources, etc.) still need the user's explicit go-ahead per the host's own safety rules regardless of reviewer/supervisor sign-off — that sign-off is about correctness, not authorization.

**Trivial-task fast path:** a task with no meaningful implementation (pure docs typo, a one-line config value already dictated verbatim by the spec) still gets dispatched to `worker` as normal — the orchestrator never implements task code itself, even here. By default, skip `reviewer`: once `worker` reports back, the orchestrator runs the task's own Verify step itself; if it passes, mark the task `- [x]`, then — same as the reviewer-approved path — resume `worker` via `SendMessage` to commit its changes plus the `tasks.md` edit, and move on. Dispatch `reviewer` for a trivial task only if the user explicitly asks for the full worker+reviewer loop on it; then follow the normal steps 2–3 instead of this fast path.

## Notes for adopting this in a project

- This protocol assumes the project uses OpenSpec (`tasks.md`, `proposal.md`, `design.md`, `specs/*/spec.md`) — it's not a general-purpose task runner.
- `reviewer`/`supervisor` read their comment format from `${CLAUDE_PLUGIN_ROOT}/conventions/review-comments.md`, bundled with this plugin — no per-project file needed.
- `worker`/`reviewer`/`supervisor` optionally use the `context-mode` plugin's `ctx_batch_execute`/`ctx_execute` tools and the `graphify` skill when installed, and fall back to plain `Bash`/`Grep` otherwise — neither is a hard dependency of this plugin.
- A project's own `CLAUDE.md` can shrink to a short pointer at this skill (e.g. "OpenSpec task implementation uses the `five-role-team` skill") instead of restating the full protocol.
