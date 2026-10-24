# Proposal

## Why

The five-role-team plugin currently has no automated installation mechanism and no way to customize which agents are included or which models they use. Users must manually copy files to the correct locations, understand harness-specific requirements (like pi's dual-location symlink pattern), and manually edit agent frontmatter to change models. An installation script with configuration eliminates manual errors, lets teams customize their agent setup (e.g., exclude designer if they have a real human designer), supports both development and production installations, and provides clean uninstallation.

## What Changes

- Add `install.js` Node.js script for automated installation with interactive configuration
- **Agent selection**: Prompt user to select which agents to include (architect, designer, worker, reviewer, supervisor, intern)
- **Model configuration**: Prompt user to configure model for each selected agent
- Support global installation (to `~/.claude/skills/` or `~/.pi/agent/skills/`)
- Support local per-project installation (to `./.claude/skills/` or `./.pi/skills/`)
- Allow user selection of target harness: pi, claude-code, or custom path
- Implement copy mode (default) and symlink mode (`--link` flag) for development
- Implement an `uninstall` subcommand (`node install.js uninstall ...`, like `npm uninstall`) for clean removal
- Generate configuration file with selected agents and models
- Handle pi-specific requirements: install to `~/.claude/skills/` AND create symlink from `~/.pi/agent/skills/`
- Handle harness-specific files (e.g., `pi/agents/intern.md` only for pi installations)
- Only install agent files for selected agents

## Capabilities

### New Capabilities
- `cli/installation`: Command-line installation script that automates plugin deployment to various harnesses with multiple installation modes

### Modified Capabilities
<!-- No existing capabilities are being modified -->

## Impact

- **New files**: `install.js` in project root, `package.json` (if not present) for Node.js script metadata, configuration file (`.five-role-team-config.json` or similar) generated during installation
- **Agent files**: Only selected agents are installed; unused agent files are omitted
- **Documentation**: README.md will need installation instructions updated with agent selection and model configuration examples
- **Distribution**: Plugin becomes easier to distribute and adopt with customizable agent setups
- **Compatibility**: Supports both pi and claude-code harnesses, plus custom paths for future harnesses
- **Team flexibility**: Teams can customize which roles they use (e.g., skip designer if they have a human designer)
