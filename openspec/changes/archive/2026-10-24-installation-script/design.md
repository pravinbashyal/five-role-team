# Design

## Context

See proposal.md for motivation. The five-role-team plugin currently has this structure:
- Core files: `SKILL.md`, `agents/`, `commands/`, `conventions/`, `.claude-plugin/`
- Harness-specific: `pi/agents/` with pi-only agents
- Metadata: `.claude-plugin/plugin.json`

Current installation patterns observed:
- **Global pi**: Files in `~/.claude/skills/five-role-team/` + symlink from `~/.pi/agent/skills/five-role-team`
- **Global claude-code**: Files in `~/.claude/skills/five-role-team/`
- **Local**: Files in `./.claude/skills/five-role-team/` or `./.pi/skills/five-role-team/`

## Goals / Non-Goals

**Goals:**
- Provide a single Node.js script for all installation scenarios
- Allow users to select which agents to include (e.g., skip designer if team has human designer)
- Allow users to configure which model each agent uses
- Support both interactive and non-interactive (flag-based) installation
- Support both copy (production) and symlink (development) modes
- Handle harness-specific installation requirements automatically
- Enable clean uninstallation
- Validate prerequisites and provide clear feedback

**Non-Goals:**
- Auto-detection of which harness is installed (user must specify)
- Plugin version management or updates (just install/uninstall current state)
- Runtime reconfiguration (agent/model changes require reinstall)
- Windows support in initial version (macOS/Linux only)
- Validation of model availability (assumes user knows valid model names)

## Decisions

### Decision 1: Node.js script over bash

**Chosen**: Node.js (`install.js`)

**Rationale**:
- User explicitly requested Node.js format
- Better cross-platform path handling (`path` module)
- More robust file operations (`fs` module with promises)
- Easier JSON parsing for plugin.json metadata

**Alternatives considered**:
- Bash: More portable (no Node.js dependency), but weaker error handling and path manipulation
- Both: Would duplicate maintenance; single Node.js script is sufficient

### Decision 2: CLI argument structure

**Chosen**: Hybrid interactive + flag-based interface
```
# Interactive (default)
node install.js --global|--local --harness <name|path> [--link] [--force]

# Non-interactive
node install.js --global|--local --harness <name|path> --agents <list> --agent-models <map> [--link] [--force]

# Uninstall
node install.js uninstall --global|--local --harness <name|path>
```

**Rationale**:
- Interactive mode: Prompts for agent selection and model configuration (better UX)
- Flag mode: Supports CI/CD and scripted installations
- Explicit scope (global vs local) prevents ambiguity
- Harness name/path after `--harness` supports both presets and custom paths
- Optional flags (`--link`, `--force`) make common case simple
- Uninstall is a subcommand (`uninstall`), not a flag, mirroring `npm uninstall`

**Alternatives considered**:
- Interactive-only: Hard to automate
- Flag-only: Poor UX for manual installations
- Separate config file: Extra file to manage; flags are simpler

### Decision 3: Harness-specific file filtering

**Chosen**: Conditional inclusion based on harness

**Implementation**:
- If `--harness pi`: Include `pi/` directory
- If `--harness claude-code` or custom path: Exclude `pi/` directory
- Detection: Check if harness name contains "pi" or if custom path includes `.pi`

**Rationale**:
- Keeps pi-specific agents (intern.md) available only where they can run
- Reduces installation size for non-pi harnesses
- Clear separation of harness concerns

**Alternatives considered**:
- Always copy everything: Simpler but includes unused files
- Ask user which files to include: Too complex for most users

### Decision 4: Pi dual-location handling

**Chosen**: For pi harness, always:
1. Install to `~/.claude/skills/five-role-team/` (copy or symlink to source)
2. Create symlink from `~/.pi/agent/skills/five-role-team` → `~/.claude/skills/five-role-team/`

**Rationale**:
- Matches observed installation pattern in the wild
- Maintains single source of truth at `~/.claude/skills/`
- Pi's skill loader expects symlink at `~/.pi/agent/skills/`

**Alternatives considered**:
- Two separate copies: Wastes space and can drift
- Reverse the symlink direction: Would break if user removes `~/.pi` directory

### Decision 5: Overwrite protection

**Chosen**: Detect existing installation and prompt for confirmation unless `--force` provided

**Rationale**:
- Prevents accidental data loss if user has local modifications
- `--force` flag allows scripted/automated installations
- Clear messaging helps user understand what will be overwritten

### Decision 6: Agent selection interface

**Chosen**: Interactive multi-select prompt using a library like `inquirer` or `prompts`

**Display**:
```
Select agents to include:
❯ ◉ architect (plan-time exploration, captures change artifacts)
  ◉ designer (plan-time interaction design, researches UX)
  ◉ worker (implements tasks)
  ◉ reviewer (audits worker diffs)
  ◉ supervisor (composition audit, interaction gate)
  ◯ intern (pi-only: menial chores for other agents)
```

**Rationale**:
- Multi-select allows choosing any combination
- Descriptions help users understand each agent's role
- All agents selected by default (safe default)
- Intern disabled if harness is not pi

**Alternatives considered**:
- Text input with comma-separated list: Error-prone, poor UX
- One-by-one yes/no prompts: Too many prompts
- No selection (install all): Doesn't meet requirement for customization

### Decision 7: Model configuration interface

**Chosen**: Prompt for each selected agent with current default shown

**Display**:
```
Configure models for selected agents:

? Model for architect (default: anthropic/claude-opus-4-5-20251101): 
? Model for designer (default: anthropic/claude-sonnet-4-6): 
? Model for worker (default: haiku): 
...
```

**Rationale**:
- Shows current defaults so user knows what they're changing
- Empty input accepts default (fast path)
- Each agent configured separately for clarity
- Validates model string is non-empty

**Alternatives considered**:
- Edit all in one multi-line prompt: Complex, error-prone
- JSON config file: Extra file, no validation until runtime
- Skip if using defaults: Hides configuration step

### Decision 8: Configuration storage format

**Chosen**: JSON file `.agent-config.json` alongside installed plugin

**Format**:
```json
{
  "agents": ["architect", "worker", "reviewer"],
  "models": {
    "architect": "anthropic/claude-opus-4-5-20251101",
    "worker": "haiku",
    "reviewer": "sonnet"
  },
  "harness": "pi",
  "installedAt": "2024-10-16T12:34:56.789Z"
}
```

**Location**: 
- Global: `~/.claude/skills/five-role-team/.agent-config.json`
- Local: `./.pi/skills/five-role-team/.agent-config.json`
- Symlink mode (`--link`): no file is written. The install path is a symlink to the source checkout, so writing would modify the source tree.

**Rationale**:
- Simple, human-readable format
- Easy to parse for potential future tooling
- Stored with plugin for portability
- Dot-prefix indicates it's metadata, not plugin code

**Alternatives considered**:
- No config file (only in agent frontmatter): Can't see full setup at glance
- YAML: Requires extra dependency
- Store in plugin.json: Mixes plugin metadata with instance config

### Decision 9: Agent file modification

**Chosen**: Modify agent frontmatter `model:` field during installation

**Implementation**:
1. Read source agent file (e.g., `agents/worker.md`)
2. Parse YAML frontmatter
3. Update `model: <configured-value>`
4. Write to destination with modified frontmatter

**Rationale**:
- Agent files remain self-contained (model is in the file, not external config)
- Matches how agents are currently used (model in frontmatter)
- No runtime config lookup needed

**Alternatives considered**:
- Keep source files unchanged, use config lookup at runtime: Requires changing how agents are dispatched
- Template replacement: Fragile, breaks on formatting changes

### Decision 10: Flag format for non-interactive mode

**Chosen**: 
- `--agents architect,worker,reviewer` (comma-separated list)
- `--agent-models "worker=sonnet,reviewer=opus"` (key=value pairs)

**Rationale**:
- Comma-separated is common CLI pattern
- Key=value pairs map naturally to JSON object
- Quoted string allows shell to pass as single argument
- Short model names (`sonnet`, `opus`, `haiku`) with expansion to full names

**Model name expansion**:
- `opus` → `anthropic/claude-opus-4-5-20251101`
- `sonnet` → `anthropic/claude-sonnet-4-20250514`
- `haiku` → `haiku` (already short form)
- Full names (containing `/`) used as-is

**Alternatives considered**:
- JSON string: Harder to type on command line
- Separate flag per agent: Too verbose (`--worker-model`, `--reviewer-model`, ...)
- Require full model names: Tedious for common cases

### Decision 11: Uninstall scope

**Chosen**: the `uninstall` subcommand (a different action, not a mode of install) removes:
- Copy mode: Deletes the directory
- Symlink mode: Removes the symlink (does not delete source)
- Pi harness: Removes both the main location and the symlink
- Nothing installed: exits 1 with a clear "Nothing to uninstall" message

**Rationale**:
- Symmetric with install operation
- Safe for development (symlink removal doesn't delete source code)
- Complete cleanup for pi's dual-location setup

### Decision 12: Verification safety

**Chosen**: All install and uninstall verification runs sandboxed: a temporary `HOME`, or a local install into a temporary folder followed by an uninstall there. Nothing may run against the real `~/.claude` or `~/.pi`.

**Rationale**:
- Uninstall is destructive; an unsandboxed smoke test already removed a real install once

## Risks / Trade-offs

**Risk**: User runs script from wrong directory  
→ **Mitigation**: Script validates it's in a directory containing `.claude-plugin/plugin.json` before proceeding

**Risk**: Partial installation failure (e.g., symlink creation fails after copy succeeds)  
→ **Mitigation**: Use try/catch blocks and rollback on failure (remove partially installed files)

**Risk**: Hardcoded harness paths may not work on all systems  
→ **Mitigation**: Use `os.homedir()` for home directory and support custom paths via `--harness <path>`

**Trade-off**: Node.js dependency  
→ **Accepted**: Most developers already have Node.js; explicit in README prerequisites

**Trade-off**: Prompt library dependency (inquirer/prompts)  
→ **Accepted**: Better UX worth the dependency; fallback to basic prompts if not available

**Trade-off**: Modifying agent files during install  
→ **Accepted**: Simpler than runtime config lookup; users can reinstall to change models

**Trade-off**: No auto-detection of harness  
→ **Accepted**: Safer to be explicit; user knows which assistant they're installing for

## Migration Plan

**Deployment**:
1. Add `install.js` to repository root
2. Update README.md with installation instructions
3. Add `package.json` if not present (for `engines` and `bin` fields)
4. Tag release with new installation method documented

**Rollback**: N/A (new feature, no existing installation method to preserve)

**User migration**: Existing manual installations continue to work; new installs use script

## Open Questions

None - design is complete and ready for task breakdown.

## Configuration Examples

**Interactive install with custom agents**:
```bash
$ node install.js --global --harness pi
? Select agents to include: architect, worker, reviewer, supervisor
? Model for architect: anthropic/claude-opus-4-5-20251101
? Model for worker: haiku
? Model for reviewer: sonnet
? Model for supervisor: anthropic/claude-opus-4-5-20251101
✓ Installed to ~/.claude/skills/five-role-team/
✓ Symlink created at ~/.pi/agent/skills/five-role-team
✓ Configuration saved to ~/.claude/skills/five-role-team/.agent-config.json
```

**Non-interactive install**:
```bash
$ node install.js --global --harness claude-code --agents architect,worker,reviewer --agent-models "worker=sonnet"
✓ Installed to ~/.claude/skills/five-role-team/
```

**Team without designer** (human designer on team):
```bash
$ node install.js --global --harness pi --agents architect,worker,reviewer,supervisor
```
