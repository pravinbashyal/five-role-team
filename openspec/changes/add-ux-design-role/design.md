## Context

See `proposal.md` — Why. Structural facts of this repo that shape the design:

- The plugin is entirely Markdown + two JSON manifests. `agents/*.md` are subagent definitions (frontmatter `name`/`description`/`tools`/`model`); `SKILL.md` is the orchestrator protocol; `commands/*.md` are the two entry points; `conventions/review-comments.md` is a bundled convention that `reviewer` and `supervisor` both read via `${CLAUDE_PLUGIN_ROOT}`.
- `reviewer` and `supervisor` do not machine-parse specs — they `Read` them and reason. Any detection convention therefore has to be readable by a model *and* greppable by the orchestrator, and must not require a parser.
- Subagents in this plugin have no `Agent`/dispatch tool. Only the main session (orchestrator, or the `/five-role-team:explore` command) can dispatch a subagent, so `designer` → `architect` sequencing has to live in `commands/explore.md`, not inside `architect.md`.
- `supervisor` is currently dispatched only for `## N.` sections with more than one task (`SKILL.md` step 4).

## Goals / Non-Goals

**Goals:**

- One detectable, human-readable marker that ties a designed interaction to the code that must satisfy it.
- Keep the number of writers of `openspec/` artifacts at exactly one (`architect`).
- Keep live app verification opportunistic — a plugin that only ships Markdown must not acquire a hard dependency on a browser driver.

**Non-Goals:**

- Mockups, image generation, or a design-system artifact of any kind.
- A machine-readable spec schema or a validator plugin — grep plus a model reading the spec is the whole mechanism.
- Design review of code aesthetics; the gate checks behavior against scenarios, not visual polish.
- Renaming the plugin away from `five-role-team`.

## Decisions

### D1. The interaction spec is a tagged scenario inside the normal spec, not a separate file

`architect` prefixes each interaction scenario's name with the literal `[interaction]`: `#### Scenario: [interaction] Saving a draft from the editor toolbar`.

*Why:* the Product Owner's call was that `architect` folds the handoff into the single `spec.md` it owns, so a `specs/<feature>-interaction/spec.md` file convention is out — it would fragment one capability's behavior contract across two files and make `reviewer`'s "read the relevant spec" step lossy. A scenario-level tag keeps one spec per capability, survives `openspec validate` (scenario names are free text), reads naturally to a human, and is detectable with one fixed-position grep: `grep -rn '^#### Scenario: \[interaction\]' openspec/changes/<change>/specs/`.

*Alternatives considered:* a requirement-level tag (`### Requirement: [interaction] …`) — rejected because a single requirement routinely mixes an interaction scenario with data-shape scenarios, so the tag would over-claim; a `tasks.md` marker — rejected by the Product Owner's decision 4, and it would put the trigger in the artifact most likely to be hand-edited during apply; a frontmatter/YAML flag on the change — rejected because it says "this change has interactions" without saying *which* scenarios the gate must check, which is exactly what the gate's coverage report needs.

### D2. Scenario tag placement is load-bearing and belongs in a bundled convention file

`conventions/interaction-specs.md` is the single source of truth for the tag: exact syntax, what qualifies, and the rule that an interaction scenario's WHEN clause must name its surface. `designer`, `architect`, and `supervisor` all reference it via `${CLAUDE_PLUGIN_ROOT}`.

*Why:* `conventions/review-comments.md` already proves this pattern in this repo — one file, three readers, no per-project copy. Three role files each restating the format would drift.

### D3. Extend `supervisor`; do not add a sixth agent

*Why:* the gate is a spec-driven, read-only, never-implements audit that fires at a gate point the orchestrator already owns — that is `supervisor`'s existing job description almost verbatim. A separate agent would duplicate its dispatch plumbing (base SHA, file scope, review-comment convention, verdict grammar, remediation routing) and force `SKILL.md` to describe two nearly identical gate protocols. The added surface inside `supervisor.md` is a mode, not a second personality: same inputs, same comment format, same verdicts.

*Alternative considered:* a `ux-reviewer` agent that only does interaction checks. Rejected on duplication grounds; also, cross-task composition drift and interaction drift are frequently the *same* finding seen from two angles, and one auditor holding both views reports it once.

### D4. The gate fires once per change, at the final section gate — not per section

The trigger is "the change's specs contain a tagged scenario", per decision 4. But *when* it fires still needs a choice, and per-section is wrong: an interaction is rarely implemented within one section, so a mid-change run would report violations that are merely "not built yet", and would re-pay live-driving cost every section.

*Consequence to encode in `SKILL.md` step 4:* the existing single-task-section fast path ("exactly one task → proceed, no `supervisor` dispatch") gets an exception — if this is the change's last section and the change has tagged scenarios, the interaction gate dispatch still happens. The gate's dispatch scope is the whole change's diff (base SHA = the SHA before the change's first task), not one section's file set, because an interaction spans whatever files it spans.

### D5. Live verification is capability-detected at run time, never assumed

`supervisor` checks its own session for an app-driving tool (a browser-automation MCP server such as `claude-in-chrome` or a Playwright MCP, or a project skill that launches the app) and reports which mode it ran in. Static-only is a complete, valid gate run; a missing driver is never a blocking finding, but *claiming* verification it did not perform is the failure mode the role file must explicitly forbid — the same "don't soften a real blocker, don't invent one" stance already in `supervisor.md`.

*Why not require a driver:* this plugin's existing stance toward `context-mode` and `graphify` is "use if present, degrade gracefully", and many adopting projects have no browser at all (CLI tools, libraries).

### D6. `designer` before `architect`, sequenced by the explore command

`commands/explore.md` gains a step 0: judge interaction-relevance (ask the Product Owner once if ambiguous), dispatch `designer`, then dispatch `architect` with the designer's report pasted into its dispatch. `architect.md` gains the reciprocal instruction: if you got a handoff, fold it in per the convention; if the topic is clearly user-facing and you got none, say so and offer the pass rather than inventing interactions.

*Why here:* subagents in this plugin cannot dispatch subagents, so the sequencing has to be in the command. Putting the reciprocal note in `architect.md` too means a direct `architect` dispatch (bypassing the command) still degrades safely.

### D7. Housekeeping calls

- **Role enumeration in `SKILL.md`:** fix it. Line 8 and its bullet list will name all seven roles, framed as "five implementation-loop roles plus two plan-time roles (`architect`, `designer`)". Keep the plugin *name* `five-role-team` — it is the plugin id, the marketplace entry, the command namespace (`/five-role-team:apply`), and the string every adopting project's CLAUDE.md points at; renaming buys nothing and breaks all of that. The "five" is now explicitly the implementation loop.
- **Version:** minor bump `0.2.0` → `0.3.0` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. New agent plus a protocol change is more than a patch; nothing existing breaks, so it is not a major.

### D8. This change's own specs are not `[interaction]`-tagged

A Markdown-and-JSON plugin has no user-facing surface a driver could reach. Tagging its scenarios would fire the new gate on itself with nothing to drive. Recorded here so it reads as a decision, not an omission.

## Risks / Trade-offs

- **The tag is a convention, not a constraint — `architect` could forget it** → `conventions/interaction-specs.md` is referenced from `architect.md` directly, and `designer`'s handoff is itself written as draft `[interaction]`-tagged scenarios, so the tag arrives already attached to the text `architect` is folding in.
- **A tagged scenario whose WHEN clause names no reachable surface makes live verification impossible** → the surface-naming rule is a spec requirement, and a scenario the gate cannot reach is reported as undetermined (visible) rather than passed (invisible).
- **Live driving is slow and can be flaky** → it runs once per change at the final gate, not per section, and only when a driver already exists in the session.
- **Fixing the role enumeration while keeping the name `five-role-team` reads as inconsistent** → `SKILL.md` states the reason inline, so a reader hits the explanation at the same place they notice the mismatch.
- **`supervisor` grows two jobs and could blur them** → the mode is selected by the dispatch, and the role file keeps the two audits in separate sections with separate "not your job" lists.

## Migration Plan

Additive: existing changes with no `[interaction]` tags behave exactly as before, and the only behavior change for them is the corrected prose in `SKILL.md`. No rollback step beyond reverting the commits.
