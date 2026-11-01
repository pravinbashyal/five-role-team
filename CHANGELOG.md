# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.1] - 2026-11-01

### Fixed

- Orchestrator no longer hard-codes Opus/Sonnet/Haiku for explore/apply dispatches. `/five-role-team:explore` and `/five-role-team:apply` read the project's `.agent-config.json` (or agent `model:` frontmatter) per `conventions/dispatch-models.md` and pass those models on every Task dispatch, so `init` pins (e.g. Grok) are honored.

### Changed

- Agent descriptions and README no longer imply roles always "run on Opus"; shipping defaults remain in frontmatter until `init` rewrites them.

## [2.2.0] - 2026-11-01

### Added

- Named **`cursor`** harness alongside `pi` and `claude-code`: `--harness cursor` resolves to `./.cursor/skills/five-role-team` (local) or `~/.cursor/skills/five-role-team` (global), not a custom `./cursor/five-role-team` path.
- Default harness detection for Cursor-only projects: `cursor` when `./.cursor` exists and `./.claude` and `./.pi` do not (cwd only; `--harness` still overrides).
- Cursor install places agent markdown into `./.cursor/agents/` or `~/.cursor/agents/` (copy mode: selected agents; `--link`: full catalog symlinks) so Cursor Agent Task can dispatch them; agent writes participate in install rollback.
- Interactive init: Custom harness select lists `cursor`; detected Cursor projects preselect it; scope labels show Cursor skill paths.
- Help, README, and post-install next steps for the cursor harness: start Cursor Agent from the project root (or reload) so `.cursor/skills` and `.cursor/agents` load (no Claude Code marketplace or `/reload-plugins` lines on Cursor installs).

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

- Unified npm init flow: Default / Custom interactive setup, `--default`, clearer help, and `--version` / `-v`.

## [1.1.0] - 2026-10-25

### Changed

- Intern agent is selectable for every harness (not pi-only).

## [1.0.1-beta.1] - 2026-10-25

### Changed

- Intern selectable across harnesses (pre-release leading to 1.1.0).

## [1.0.1-beta.0] - 2026-10-25

### Added

- Intern can run code-writing chores via a delegated local model (qwen2.5-coder).

## [1.0.0] - 2026-10-25

### Added

- First public npm package `@pravinbashyal/five-role-team` with `five-role-team` bin for global/local install into Claude Code and pi harnesses.

## [0.0.0-stage] - 2026-10-25

### Added

- Staging npm publish of the package (registry placeholder; no dedicated git release commit).

[2.2.1]: https://github.com/pravinbashyal/five-role-team/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/pravinbashyal/five-role-team/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/pravinbashyal/five-role-team/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/pravinbashyal/five-role-team/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/pravinbashyal/five-role-team/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/pravinbashyal/five-role-team/compare/v1.0.1-beta.1...v1.1.0
[1.0.1-beta.1]: https://github.com/pravinbashyal/five-role-team/compare/v1.0.1-beta.0...v1.0.1-beta.1
[1.0.1-beta.0]: https://github.com/pravinbashyal/five-role-team/compare/v1.0.0...v1.0.1-beta.0
[1.0.0]: https://github.com/pravinbashyal/five-role-team/releases/tag/v1.0.0
[0.0.0-stage]: https://www.npmjs.com/package/@pravinbashyal/five-role-team/v/0.0.0-stage
