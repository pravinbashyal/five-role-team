# Tasks

## 1. Worker-intern delegation

- [x] 1.1 Claude Code worker and intern framing. In `agents/worker.md`, add `Agent` to the frontmatter `tools`. Add a delegation section to the instructions that states every rule in design.md Decisions 2, 4 and 5:
  - delegate only mechanical chores inside the single dispatched task
  - spawn only `intern`, never `reviewer`, `supervisor` or any other type
  - run the task's Verify yourself after the intern returns
  - in the report, name the files or hunks the intern produced, and mark those it got from `qwen2.5-coder:7b`
  - if the intern reports the homeserver unreachable or the model missing, do the chore yourself and note the fallback in the report

  Also state that on Claude Code this restriction is instruction-only. In `agents/intern.md` and `pi/agents/intern.md`, reword the framing so the worker is named as the caller for in-task chores, with no change to the intern's behavior. Don't change either intern's `model:`. Verify:
  - the `agents/worker.md` frontmatter still parses (name, description, tools, model) and `tools` includes `Agent`
  - each rule listed above appears in the worker prompt (show with `grep -n`)
  - the `git diff` of both intern files touches only caller-framing text

- [x] 1.2 Ship pi worker. Create `pi/agents/worker.md`:
  - frontmatter: `name: worker`, the same description, `tools: read, edit, write, bash, grep, subagent`, `allowedAgents: intern`, and a `model:` line
  - body: identical to the post-1.1 `agents/worker.md` body, except that the instruction-only note is replaced with a statement that pi enforces the restriction through `allowedAgents`

  Extend `test/test-install-modes.js` to match the delta in `specs/cli/installation/spec.md`:
  - a pi install with all agents includes `pi/agents/worker.md`, with its `model:` rewritten to the configured worker model
  - a pi install with `--agents intern` omits `pi/agents/worker.md`
  - a claude-code install has no `pi/`

  Don't change installer source files. Verify:
  - `node test/test-install-modes.js </dev/null` and `node test/verify-pack-contents.js </dev/null` pass
  - `diff <(awk 'f>=2;/^---$/{f++}' agents/worker.md) <(awk 'f>=2;/^---$/{f++}' pi/agents/worker.md)` shows only the harness-guard note

- [ ] 1.3 Docs. In `README.md`:
  - replace the intern line (currently "helper outside the role model") with wording saying the worker dispatches it for in-task chores
  - add `pi/agents/worker.md` to the file list
  - add a note that pi users who maintain their own `~/.pi/agent/agents/worker.md` get the shipped pi worker after re-running `five-role-team init` for pi

  In `SKILL.md`, update the role list or core-rule text so that:
  - the worker may delegate to the intern
  - the orchestrator only accepts verdicts from its own `reviewer`/`supervisor` dispatches (design.md Risks)

  Verify:
  - `npm test` passes, including `test/verify-readme-commands.js`
  - `grep -n "outside the role model" README.md SKILL.md` returns nothing
