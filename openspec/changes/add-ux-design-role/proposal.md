## Why

The team has a role that decides *what* to build (`architect`), roles that build and audit *code* (`worker`/`reviewer`/`supervisor`), and no role that decides *how the thing behaves for a person using it*. Interaction design currently happens by accident inside whichever `worker` happens to touch a UI file, and nothing ever checks the running result against an agreed interaction. This change adds a plan-time UX designer/researcher role and closes the loop with a supervising-phase gate that verifies the implementation against the interaction scenarios that role produced.

## What Changes

- **New plan-time role `designer`** (`agents/designer.md`, Opus, read-only): researches the problem's users, existing UI/flows in the codebase, and prior art, then designs the interaction and reports it as written interaction scenarios. It writes no files — its output is its report.
- **`designer` runs before `architect`**, not alongside it. `/five-role-team:explore` gains a step 0: for an interaction-relevant topic, dispatch `designer` first, then dispatch `architect` with the designer's report as input. `architect` remains the sole author of `specs/*/spec.md`.
- **New tagging convention for interaction scenarios**, documented in a bundled `conventions/interaction-specs.md` (the same pattern `conventions/review-comments.md` already uses): `architect` folds the designer's handoff into normal OpenSpec `#### Scenario:` blocks inside the spec files it already writes, prefixing each with an `[interaction]` tag. No new spec file, no parallel design doc — the interaction spec *is* the spec.
- **`supervisor` gains an interaction-conformance gate** rather than a new sixth agent: when the change's specs contain `[interaction]`-tagged scenarios, `supervisor` is dispatched once more at the change's final section gate, in interaction-gate mode. It always statically verifies the implementation against every tagged scenario; it additionally drives the running app when a browser-driver tool is available in the session, and must state which of the two it actually did.
- **Dispatch trigger changes in `SKILL.md` step 4**: the interaction gate fires on spec content (tagged scenarios present), not on task count and not on a `tasks.md` marker — so a change whose last section holds a single task still gets the gate.
- **Housekeeping**: `SKILL.md`'s role enumeration is corrected to list `architect` and `designer` as plan-time roles alongside the five implementation-loop roles; the plugin keeps the name `five-role-team` (renaming would break the plugin id, the marketplace entry, `/five-role-team:apply|explore`, and every project CLAUDE.md pointer — the "five" is the implementation loop, and that stays five). Plugin version bumps `0.2.0` → `0.3.0` in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

## Capabilities

### New Capabilities
- `plan-time-ux-design`: the `designer` role, its position before `architect` in the plan-time flow, the shape of its handoff, and the `[interaction]` scenario convention `architect` uses to fold that handoff into the specs it writes.
- `interaction-verification`: when the supervising-phase interaction gate fires, what it statically verifies, when and how it additionally drives the live app, and what verdict/coverage it must report.

### Modified Capabilities
<!-- None: this repo has no specs under openspec/specs/ yet; both capabilities above are new. -->

## Impact

- New file: `agents/designer.md`; new file: `conventions/interaction-specs.md`.
- Modified: `SKILL.md` (role enumeration, step 4 gate trigger, adoption notes), `agents/supervisor.md` (interaction-gate mode, browser-driver tools, verdict/coverage reporting), `agents/architect.md` (accept a designer handoff, author `[interaction]` scenarios), `commands/explore.md` (designer-then-architect dispatch), `README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
- No dependency added: the live-verification path is opportunistic and degrades to static-only when no browser driver (e.g. `claude-in-chrome`, a Playwright MCP server) is present — same optional-tool stance the plugin already takes toward `context-mode` and `graphify`.
- This change's own specs are deliberately **not** `[interaction]`-tagged (a Markdown-and-JSON plugin has no user-facing UI), so implementing it will not itself fire the new gate.
