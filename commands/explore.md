---
description: Explore an idea or problem through the five-role-team's dedicated architect role (Opus) instead of running explore mode inline in the main session. Use this instead of /opsx:explore directly when you want the extra reasoning depth of a dedicated exploration role.
argument-hint: [topic or change-name]
---

# five-role-team explore

Plain `/opsx:explore` runs explore mode inline in whatever model the current session is using. This command instead dispatches the dedicated `architect` role — same explore-mode stance and OpenSpec capture workflow, but on Opus, kept separate from whatever model is driving day-to-day work in this session.

Topic (if given): $ARGUMENTS

## Steps

0. **Judge interaction-relevance before dispatching anything.** Decide whether the topic changes what a person sees or does — a screen, a flow, a CLI interaction, an error surface.
   - **Clearly interaction-relevant** → dispatch the `designer` subagent first, with the topic/arguments above, and wait for its report to completion before doing anything else.
   - **Clearly not** (an internal refactor, a build script, a data migration with no UI) → skip `designer` entirely; go straight to step 1.
   - **Ambiguous** → ask the Product Owner once, via `AskUserQuestion` with concrete mutually-exclusive options, before dispatching either role. Don't silently skip the `designer` pass and don't silently run it — the ambiguous case is resolved by asking, not by guessing.
1. Dispatch the `architect` subagent with the topic/arguments above (or, if none given, just "enter explore mode"). If step 0 dispatched `designer`, include its full report verbatim in this dispatch as additional input — `architect` folds it into the specs it writes per `${CLAUDE_PLUGIN_ROOT}/conventions/interaction-specs.md`. Tell `architect` explicitly to load and follow the `openspec-explore` skill (or `opsx:explore`, whichever this project has installed) for the full explore-mode stance and capture workflow — `architect`'s own definition points at this too, but the instruction should not depend on it remembering.
2. Let the conversation happen through `designer` (if dispatched) and then `architect` — each asks its own clarifying questions (one at a time, via `AskUserQuestion`) and does its own investigation. Do not run explore mode inline yourself, and do not pre-answer questions on the Product Owner's behalf. `designer` always runs to completion and reports back before `architect` is dispatched — never in parallel, never interleaved.
3. If `architect` reports back with artifacts written or open threads, relay that summary to the Product Owner. If the exploration surfaces a clear implementation-ready change, mention `/five-role-team:apply <change-name>` as the next step.
