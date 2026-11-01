# Design

## Context

See proposal.md for motivation. Current `install.js` behavior that this change has to extend:

- `resolveHarnessPath` names only `pi` and `claude-code`. Any other string that is not an absolute/separator path is treated as a relative custom path, so `--harness cursor` installs at `./cursor/five-role-team`.
- `detectDefaultHarness` inspects only `./.pi` and `./.claude` in cwd (never HOME): pi when `.pi` exists and `.claude` does not, else claude-code.
- `promptHarnessSelection` choices are pi, claude-code, Custom path. `buildScopeQuestion` labels come from `resolveHarnessPath(...).primary`.
- `logNextSteps` has a claude-code branch and a pi-generic else; marketplace `shadowIds` are already empty unless harness is claude-code.
- Copy/link writes the skill at `primary` (and pi's secondary symlink). Agent markdown lives *inside* the skill at `agents/<id>.md`. Cursor Task instead loads a flat `.cursor/agents/*.md` (project) or `~/.cursor/agents/` (user).
- Install transaction/rollback tracks the skill primary and the pi secondary only.

Cursor skills load from `.cursor/skills/` / `~/.cursor/skills/`. No Cursor slash-command tree is in scope.

## Goals / Non-Goals

**Goals:**
- One named `cursor` harness that resolves, detects, installs, uninstalls, and explains itself the same way `pi` and `claude-code` already do.
- A Cursor install that Task can actually dispatch: skill *and* flat agent files, same global/local scope.

**Non-Goals:**
- Cursor slash commands (`apply` / `explore`) or a `.cursor/commands/` tree.
- Cursor-specific agent bodies or model-id mapping; the same `agents/*.md` frontmatter is reused.
- Changing pi's dual-location layout or Claude marketplace shadow detection.
- Auto-detecting from HOME (`~/.cursor`); detection stays cwd-only.

## Decisions

### D1. Named harness, not a custom path

Treat `cursor` as a first-class name in `resolveHarnessPath`, parallel to `claude-code` (one primary, no secondary):

```
--harness cursor --local  -> ./.cursor/skills/five-role-team
--harness cursor --global -> ~/.cursor/skills/five-role-team
```

Unknown names and real paths stay custom. Alternative considered: leaving `cursor` as a path and documenting `./.cursor/skills`. Rejected because that is the current trap (`./cursor/five-role-team`) and Custom select would still omit it.

### D2. Exclusive-cursor detection, Claude default otherwise

```
hasCursor = exists(cwd/.cursor)
hasClaude = exists(cwd/.claude)
hasPi     = exists(cwd/.pi)

if (hasCursor && !hasClaude && !hasPi) return 'cursor'
if (hasPi && !hasClaude) return 'pi'
return 'claude-code'
```

`--harness` still overrides. cwd only. Alternative B (cursor whenever `.cursor` exists) and C (cursor even with `.claude` if no `.pi`) were rejected by the PO ("default to claude").

### D3. Cursor agent copies beside the skill

After the skill is written (copy or link), for harness `cursor` only:

- Copy mode: write each *selected* `agents/<id>.md` (model frontmatter already rewritten) to `<agentsRoot>/<id>.md`.
- Link mode: symlink every source `agents/<id>.md` into `<agentsRoot>` (link still applies no agent selection).
- `agentsRoot` is `./.cursor/agents` (local) or `~/.cursor/agents` (global).

The skill still contains `agents/` as today. There is no `cursor/agents/` source tree and no `pi/` tree for this harness.

Existing-install detection and overwrite confirmation stay on the skill primary. A leftover agents-dir file alone is not "already installed".

Alternative considered: skills-dir only this change. Rejected by the PO; Task would not see the agents.

### D4. Uninstall removes skill and our agent files only

`--harness cursor` with `--local`/`--global`:

1. Remove the skill primary (directory or symlink), same as other harnesses.
2. Remove agent files we placed: if `.agent-config.json` was present, those ids; else the known catalog ids (covers `--link`, which writes no config).
3. Do not delete other names in `.cursor/agents/` and do not remove the directory just because it is empty.

"Nothing to uninstall" only when *neither* the skill primary *nor* any of those agent files exists (so a skill-less leftover still gets cleaned).

Overwrite a user-authored `worker.md` of the same name is accepted; uninstall then removes that filename.

### D5. Transaction includes Cursor agent writes

Extend the install transaction so Cursor agent-file creates/overwrites roll back with the skill. A failed Cursor install must not leave a half-written `.cursor/agents/`. Uninstall is not transactional beyond today's skill removal plus best-effort agent-file unlinks.

### D6. Surfaces

- Harness select choices: `pi`, `claude-code`, `cursor`, Custom path (cursor before Custom). Return `'cursor'` the same way as `'pi'` / `'claude-code'`. Preselect uses `detectDefaultHarness`.
- `showUsage` lists `cursor` and its local/global skill paths (agents dir can be one extra bullet).
- `logNextSteps`: add a `cursor` branch (start Cursor Agent / reload so `.cursor/skills` and `.cursor/agents` load). Keep claude-code as today. Keep the else as pi-generic. Do not add slash-command or CLAUDE.md lines for cursor. Shadow ids stay claude-code only.
- README: harness table, detection sentence (D2), harness notes for cursor, uninstall example.

### D7. Tests

Keep sandboxed HOME/cwd. Add cursor cells to install/uninstall matrices (`scope x harness x mode x agents`). Prompt-injection tests cover the new `[interaction]` scenarios. Detection tests cover the D2 table, including mixed `.cursor`+`.claude` → claude-code and `--harness cursor` not creating `./cursor/five-role-team`.

## Risks / Trade-offs

- [User already has `.cursor/agents/worker.md`] → Same-name overwrite, then uninstall deletes that filename. Mitigation: only those catalog ids; never wipe the directory.
- [Mixed Claude+Cursor repo gets Claude on Default] → Intended (D2). Custom or `--harness cursor` overrides; the summary names the detected harness first.
- [Cursor ignores Claude-style `model:` frontmatter] → Accepted; no Cursor model map in this change. Agents still install and are discoverable.
- [Rollback misses a new agents-dir write] → D5: treat those writes as part of the existing transaction.

## Migration Plan

No data migration. Existing Claude/pi installs are untouched. Anyone who already ran `--harness cursor` and got `./cursor/five-role-team` can `--force` a real cursor install and delete the stray directory by hand. Ship as a minor npm version: `cursor` changing from "custom path" to "named harness" is a behavior fix, not a grammar break.
