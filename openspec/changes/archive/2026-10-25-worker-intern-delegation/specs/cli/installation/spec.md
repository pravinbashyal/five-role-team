# Spec Delta

## MODIFIED Requirements

### Requirement: Handle harness-specific files

The script SHALL only install harness-specific files for the target harness.

#### Scenario: pi-specific files included for pi
- **WHEN** user installs with `--harness pi` and the worker and intern agents are selected
- **THEN** the `pi/agents/worker.md` and `pi/agents/intern.md` files are included in the installation

#### Scenario: pi-specific agent file follows agent selection
- **WHEN** user installs with `--harness pi --agents intern` (worker not selected)
- **THEN** `pi/agents/intern.md` is included and `pi/agents/worker.md` is NOT included in the installation

#### Scenario: pi-specific files excluded for claude-code
- **WHEN** user installs with `--harness claude-code`
- **THEN** the `pi/` directory is NOT included in the installation, so neither `pi/agents/worker.md` nor `pi/agents/intern.md` is installed
