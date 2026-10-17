# Tasks

## 1. Setup

- [x] 1.1 Create `install.js` with basic CLI structure and verify script runs with `--help` flag showing usage
- [x] 1.2 Add `package.json` (if not exists) with `engines` field requiring Node.js >=14 and verify `npm install` succeeds
- [ ] 1.3 Add `prompts` npm dependency for interactive prompts and verify import works in script

## 2. CLI Argument Parsing

- [ ] 2.1 Implement flag parsing for `--global`, `--local`, `--harness <name>`, `--link`, `--force`, `--uninstall` and verify each flag is correctly parsed
- [ ] 2.2 Add validation that exactly one of `--global` or `--local` is required and verify error message shows for invalid combinations
- [ ] 2.3 Implement non-interactive flags `--agents <list>` and `--agent-models <map>` and verify comma-separated parsing works correctly
- [ ] 2.4 Add harness path resolution (pi → `~/.pi/agent/skills/`, claude-code → `~/.claude/skills/`, custom paths as-is) and verify each resolves correctly

## 3. Agent Selection

- [ ] 3.1 Implement interactive agent selection prompt with multi-select for available agents (architect, designer, worker, reviewer, supervisor, intern) and verify all agents shown with descriptions
- [ ] 3.2 Add agent validation that disables intern option when harness is not pi and verify warning shows for invalid selection
- [ ] 3.3 Implement non-interactive agent selection from `--agents` flag with comma-separated parsing and verify subset installation works
- [ ] 3.4 Set default to all available agents when no selection made and verify default selection includes all agents

## 4. Model Configuration

- [ ] 4.1 Read default models from source agent frontmatter files and verify correct extraction of current model values
- [ ] 4.2 Implement interactive model configuration prompts for each selected agent showing defaults and verify each prompt displays current default
- [ ] 4.3 Implement model name expansion (opus → full anthropic path, sonnet → full path, haiku as-is, full paths unchanged) and verify expansion works correctly
- [ ] 4.4 Implement non-interactive model configuration from `--agent-models` flag with key=value parsing and verify model override works
- [ ] 4.5 Add validation that model string is non-empty and verify error on empty model

## 5. Installation Logic

- [ ] 5.1 Implement directory validation and creation for target installation path and verify missing directories are created
- [ ] 5.2 Implement agent file filtering to only copy selected agents and verify unselected agents are excluded from installation
- [ ] 5.3 Implement agent frontmatter modification to update `model:` field with configured model and verify modified frontmatter is valid YAML
- [ ] 5.4 Implement copy mode installation (default) with all selected agent files and verify files copied with correct content
- [ ] 5.5 Implement symlink mode installation with `--link` flag and verify symlinks point to source directory
- [ ] 5.6 Implement pi dual-location handling (copy/symlink to `~/.claude/skills/` AND symlink from `~/.pi/agent/skills/`) and verify both locations exist for pi harness
- [ ] 5.7 Implement harness-specific file handling (include `pi/` only for pi harness) and verify pi-specific files excluded for claude-code
- [ ] 5.8 Add existing installation detection and confirmation prompt (skip with `--force`) and verify overwrite warning shows
- [ ] 5.9 Implement rollback on partial installation failure and verify partial files removed on error

## 6. Configuration File Generation

- [ ] 6.1 Create configuration file structure with agents array, models object, harness, and installedAt timestamp and verify JSON structure is valid
- [ ] 6.2 Save configuration file to `.agent-config.json` alongside installed plugin and verify file created at correct location
- [ ] 6.3 Add configuration file to uninstall cleanup list and verify it's removed on uninstall

## 7. Uninstallation Logic

- [ ] 7.1 Implement `--uninstall` mode that detects copy vs symlink installation and verify both types removed correctly
- [ ] 7.2 Implement pi dual-location cleanup (remove both main location and symlink) and verify both locations cleaned for pi harness
- [ ] 7.3 Add safety check that only removes five-role-team directory, not parent skills directory and verify parent preserved after uninstall
- [ ] 7.4 Implement configuration file removal during uninstall and verify `.agent-config.json` is deleted

## 8. User Feedback and Validation

- [ ] 8.1 Add progress messages during installation (detecting harness, copying files, creating symlinks) and verify messages shown at each step
- [ ] 8.2 Add success confirmation with installation path and configuration summary and verify final message shows correct paths
- [ ] 8.3 Add error messages for invalid harness paths, missing permissions, or failed operations and verify clear error messages on failure
- [ ] 8.4 Validate script is run from five-role-team directory (contains `.claude-plugin/plugin.json`) and verify error on invalid directory

## 9. Documentation and Testing

- [ ] 9.1 Update README.md with installation instructions including interactive and non-interactive examples and verify documented commands work as written
- [ ] 9.2 Add examples for common scenarios (skip designer, custom models, development symlink install) in README and verify each example runs successfully
- [ ] 9.3 Create manual test script that validates each installation mode (global/local, pi/claude-code, copy/symlink, with/without agents) and verify all modes tested
- [ ] 9.4 Test uninstallation for each installation mode and verify clean removal in all cases

## Workflow follow-up

- Run the installation script on test systems (macOS with pi, macOS with claude-code, Linux) to validate cross-platform compatibility
- Archive the change after testing is complete and documented
