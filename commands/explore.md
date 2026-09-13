---
description: Explore an idea or problem through the five-role-team's dedicated architect role (Opus) instead of running explore mode inline in the main session. Use this instead of /opsx:explore directly when you want the extra reasoning depth of a dedicated exploration role.
argument-hint: [topic or change-name]
---

# five-role-team explore

Plain `/opsx:explore` runs explore mode inline in whatever model the current session is using. This command instead dispatches the dedicated `architect` role — same explore-mode stance and OpenSpec capture workflow, but on Opus, kept separate from whatever model is driving day-to-day work in this session.

Topic (if given): $ARGUMENTS

## Steps

1. Dispatch the `architect` subagent with the topic/arguments above (or, if none given, just "enter explore mode"). Tell it explicitly to load and follow the `openspec-explore` skill (or `opsx:explore`, whichever this project has installed) for the full explore-mode stance and capture workflow — `architect`'s own definition points at this too, but the instruction should not depend on it remembering.
2. Let the conversation happen through `architect` — it asks its own clarifying questions (one at a time, via `AskUserQuestion`) and does its own investigation. Do not run explore mode inline yourself, and do not pre-answer questions on the Product Owner's behalf.
3. If `architect` reports back with artifacts written or open threads, relay that summary to the Product Owner. If the exploration surfaces a clear implementation-ready change, mention `/five-role-team:apply <change-name>` as the next step.
