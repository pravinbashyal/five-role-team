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

- [x] 2.1 Implement Cursor copy/link install and uninstall (design D3, D4, D5):
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

- [x] 3.1 Update the TTY harness select and post-install next steps (design D6):
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

- [x] 4.1 Document the cursor harness in `README.md` (design D6, D7): `--harness` values include `cursor`; detection matches D2; harness notes give local/global skill paths and the agents dir; uninstall example may use `--harness cursor`. Do not add Cursor slash commands or marketplace uninstall to Cursor notes.

  Verify:
  - scenario "README documents the cursor harness"
  - existing README scenarios still pass (`test/verify-readme-commands.js`)
  - `npm test` passes
  - `openspec validate add-cursor-init-harness --strict` passes

## 5. Release

- [x] 5.1 Ship a minor npm release for the cursor harness (design Migration Plan), with changelog and tag:
  - Bump `package.json` (and `package-lock.json` root version) from `2.1.1` to `2.2.0`.
  - Add a root `CHANGELOG.md` (Keep a Changelog style). Entry **[2.2.0]** documents the named `cursor` harness (paths, detection, agents dir, uninstall, next steps). Briefly backfill **[2.1.1]**, **[2.1.0]**, and **[2.0.0]** from existing `Release …` / `v2.0.0` history so the file is not a single-release stub.
  - Confirm `npm test` and `npm pack --dry-run` still look right after the bump (include `CHANGELOG.md` in `package.json` `files` only if the project already ships docs that way — default: keep pack whitelist unchanged unless README is already listed).
  - Publish is already done on the registry (`@pravinbashyal/five-role-team@2.2.0`); verify with `npm view @pravinbashyal/five-role-team version` → `2.2.0`. Re-publish only if the registry is missing that version.
  - Create annotated git tag `v2.2.0` on the release commit (message like prior releases). Also add annotated tags `v2.1.1` and `v2.1.0` on the existing `Release 2.1.1` / `Release 2.1.0` commits if those tags are missing (do not move `v2.0.0`).
  - Do not `git push` or `git push --tags` unless the Product Owner explicitly asks.

  Verify:
  - `package.json` / lockfile version is `2.2.0`
  - `CHANGELOG.md` exists with a `[2.2.0]` section covering the cursor harness
  - `git tag -l 'v2.*'` includes `v2.2.0`, `v2.1.1`, `v2.1.0`, `v2.0.0`
  - registry reports `2.2.0`
  - `openspec validate add-cursor-init-harness --strict` still passes

## Workflow follow-up

- Archive after the project's review requirements are satisfied.
