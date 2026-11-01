# Proposal

## Why

`five-role-team init` treats Cursor as an unknown harness name, so `--harness cursor` falls through to the relative path `./cursor/five-role-team`. Detection ignores `./.cursor`, the Custom select lists only pi / claude-code / Custom path, and post-install next steps are Claude-specific or pi-generic. Cursor Agent loads skills from `.cursor/skills/` and Task subagents from a flat `.cursor/agents/*.md`, so a first-class cursor harness is the missing install path for this project's own Cursor users.

## What Changes

- Named harness `cursor` alongside `pi`, `claude-code`, and Custom path. `--harness cursor` resolves to local `./.cursor/skills/five-role-team/` or global `~/.cursor/skills/five-role-team/`.
- Default detection (option A): detect `cursor` only when `./.cursor` exists and `./.claude` does not and `./.pi` does not; mixed `.cursor`+`.claude` stays `claude-code`; otherwise keep today's pi / claude-code rule. `--harness` still overrides. Detection looks only at the current directory.
- Custom harness select lists `cursor`; a detected Cursor project preselects it. Scope labels show the Cursor skill paths.
- Copy (and `--link`) also places selected agent markdown files in `./.cursor/agents/` (local) or `~/.cursor/agents/` (global) so Task can dispatch them. Uninstall `--harness cursor` with that scope removes the skill install and those agent copies.
- Help, README harness list, and post-install next steps name Cursor. Cursor next steps do not mention Claude Code, `/reload-plugins`, `CLAUDE.md`, or marketplace uninstall.
- Cursor installs exclude the `pi/` tree and do not emit the Claude marketplace shadow warning.

No breaking CLI grammar: unknown names other than `cursor` remain custom paths. `cursor` itself stops being a custom path (that fall-through is the bug this change closes).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli/installation`: named `cursor` harness paths, default detection including `./.cursor`, Cursor skill + agent-file install and uninstall, Cursor-specific next steps, no `pi/` tree and no marketplace shadow for cursor.
- `cli/npm-distribution`: help lists `cursor`; Custom harness select includes it (detected Cursor preselected); scope labels and Default summary/install use Cursor paths when detected; README documents `cursor` and the detection rule.

## Impact

- Code: `install.js` (`resolveHarnessPath`, `detectDefaultHarness`, `promptHarnessSelection`, `buildScopeQuestion`, `showUsage`, `logNextSteps`, uninstall), plus the copy/link path that writes agent files (`install-files.js` / install orchestration).
- Tests: `test/test-interactive-init.js`, `test/test-default-setup.js`, `test/test-install-modes.js`, `test/test-uninstall-modes.js`, `test/verify-matrix.js`, and next-steps coverage.
- Docs: `README.md` harness detection, `--harness` table, uninstall notes.
- Users: `--harness cursor` and Default in a Cursor-only tree install into `.cursor/` instead of `./cursor/five-role-team` or Claude paths.
- No new dependencies. Cursor slash commands (`apply` / `explore`) are out of scope.
