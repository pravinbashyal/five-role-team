# Tasks

## 1. Named harness, detection, and help

- [x] 1.1 In `install.js`, make `cursor` a first-class harness (design D1, D2, D6):
  - `resolveHarnessPath('cursor')` → local `./.cursor/skills/five-role-team`, global `~/.cursor/skills/five-role-team` (no secondary). `--harness cursor` MUST NOT resolve to `./cursor/five-role-team`.
  - `detectDefaultHarness` follows the exclusive-cursor rule: `cursor` only when `./.cursor` exists and `./.claude` and `./.pi` do not; then existing pi / claude-code rule. cwd only.
  - `showUsage` lists `cursor` alongside `pi` and `claude-code`, including its skill paths.
  - `buildScopeQuestion` then labels Cursor scope choices with those skill paths.

  Verify with sandboxed tests (temp HOME and cwd) covering:
  - every detection scenario under "Detect the default harness from project markers"
  - "Default flag with explicit cursor harness" (plugin at `./.cursor/skills/five-role-team/`, nothing at `./cursor/five-role-team/`)
  - "[interaction] Help lists cursor"
  - `npm test` passes

## 2. Cursor skill and agent file layout

- [ ] 2.1 Implement Cursor copy/link install and uninstall (design D3, D4, D5):
  - Copy the skill to the D1 paths. Also write selected `agents/<id>.md` (same model frontmatter as inside the skill) to `./.cursor/agents/` or `~/.cursor/agents/`. Link mode: symlink the skill and every source `agents/<id>.md` into that agents dir (no agent filter).
  - Exclude `pi/` for cursor. Do not write `.cursor/agents/` for claude-code or pi.
  - Include Cursor agent-file writes in the install transaction so a failed install rolls them back.
  - Uninstall `--harness cursor` with matching scope removes the skill primary and the agent copies this install placed (config ids, or the catalog ids for `--link`). Leave other files in `.cursor/agents/`. "Nothing to uninstall" only when neither the skill nor those agent files exist.
  - Add `cursor` to `MATRIX_AXES.harness` in `test/verify-matrix.js` and to the EXPECTED_AXES/EXPECTED_CELLS in both `test/test-install-modes.js` and `test/test-uninstall-modes.js`.

  Verify sandboxed coverage of:
  - "Install to cursor locally/globally", "[interaction] Default installs into .cursor when detected", "Place selected agents…" (local subset, global default, Claude does not write Cursor agents, link symlinks)
  - "Symlink install for cursor", "pi-specific files excluded for cursor"
  - "Uninstall from cursor locally/globally", "Uninstall cursor with nothing installed", leftover unrelated agents-dir files remain
  - `npm test` passes

## 3. Interactive select and Cursor next steps

- [ ] 3.1 Update the TTY harness select and post-install next steps (design D6):
  - `promptHarnessSelection` choices: pi, claude-code, cursor, Custom path. Preselect `detectDefaultHarness()`. Treat `'cursor'` like `'pi'` / `'claude-code'` (do not prompt for a path).
  - `logNextSteps`: cursor branch tells the user to start Cursor Agent from the project root (or reload) so `.cursor/skills` and `.cursor/agents` load. No Claude Code, `/reload-plugins`, `CLAUDE.md`, or `claude plugin uninstall` lines. Marketplace shadow ids stay claude-code only. pi-generic else branch unchanged.

  Verify with prompt-injection tests in `test/test-interactive-init.js` for:
  - "[interaction] Custom harness select lists cursor"
  - "[interaction] Detected Cursor harness is preselected"
  - "[interaction] Scope paths for Cursor"
  - "[interaction] Default summary shows detected Cursor harness"
  - "[interaction] Next steps after a Cursor install"
  - "Cursor install does not warn about a Claude marketplace copy"
  - `npm test` passes

## 4. README

- [ ] 4.1 Document the cursor harness in `README.md` (design D6, D7): `--harness` values include `cursor`; detection matches D2; harness notes give local/global skill paths and the agents dir; uninstall example may use `--harness cursor`. Do not add Cursor slash commands or marketplace uninstall to Cursor notes.

  Verify:
  - scenario "README documents the cursor harness"
  - existing README scenarios still pass (`test/verify-readme-commands.js`)
  - `npm test` passes
  - `openspec validate add-cursor-init-harness --strict` passes

## Workflow follow-up

- Apply this change with `/five-role-team:apply add-cursor-init-harness` (do not implement from explore).
- Archive after the project's review requirements are satisfied.
