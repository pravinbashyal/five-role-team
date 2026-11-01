# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-11-01

### Added

- Named **`cursor`** harness alongside `pi` and `claude-code`: `--harness cursor` resolves to `./.cursor/skills/five-role-team` (local) or `~/.cursor/skills/five-role-team` (global), not a custom `./cursor/five-role-team` path.
- Default harness detection for Cursor-only projects: `cursor` when `./.cursor` exists and `./.claude` and `./.pi` do not (cwd only; `--harness` still overrides).
- Cursor install copies or symlinks selected agent markdown into `./.cursor/agents/` or `~/.cursor/agents/` so Cursor Agent Task can dispatch them; agent writes participate in install rollback.
- Interactive init: Custom harness select lists `cursor`; detected Cursor projects preselect it; scope labels show Cursor skill paths.
- Help, README, and post-install next steps for the cursor harness (no Claude Code marketplace or `/reload-plugins` lines on Cursor installs).

### Changed

- Uninstall `--harness cursor` removes the skill install and agent files this install placed; unrelated files in `.cursor/agents/` are left intact.
- Cursor installs exclude the `pi/` tree and do not emit the Claude marketplace shadow warning.

## [2.1.1] - 2026-10-30

### Changed

- Intern agent no longer delegates to a hard-coded Ollama model; it runs on its configured model from the harness config.

## [2.1.0] - 2026-10-25

### Added

- Worker may delegate in-task mechanical chores to the intern subagent.
- Pi installs ship `pi/agents/worker.md` with `allowedAgents: intern`.

## [2.0.0] - 2026-10-25

### Removed

- **Breaking:** The `install` subcommand alias and bare `five-role-team --global ...` (init without `init`) are removed; use `five-role-team init`.

### Added

- Unified npm init flow improvements shipped in the 2.0 release line (including `--version`).

[2.2.0]: https://github.com/pravinbashyal/five-role-team/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/pravinbashyal/five-role-team/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/pravinbashyal/five-role-team/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/pravinbashyal/five-role-team/releases/tag/v2.0.0
