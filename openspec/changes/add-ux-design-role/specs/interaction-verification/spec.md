## Purpose

Closes the loop between a designed interaction and the code that ships, by making the supervising phase verify a change's implementation against the `[interaction]`-tagged scenarios in its specs — statically always, and against the running app whenever the session has a tool that can drive it.

## ADDED Requirements

### Requirement: The interaction gate is a mode of `supervisor`, not a new role

The interaction gate SHALL be performed by the existing `supervisor` subagent in an interaction-gate mode, not by an additional agent. `supervisor` in this mode keeps its existing stance: it reads, it never edits code, never edits `tasks.md`, never commits, and only reports a verdict.

#### Scenario: Gate runs as a supervisor dispatch

- **WHEN** the interaction gate fires for a change
- **THEN** it runs as a `supervisor` dispatch carrying the change name, the change's spec paths, and the base SHA and file set for the work under audit
- **AND** no additional subagent type is required for it

#### Scenario: Gate never fixes what it finds

- **WHEN** interaction-gate verification finds a mismatch between the implementation and a tagged scenario
- **THEN** `supervisor` reports it as a blocking comment and changes nothing itself

### Requirement: The gate fires on spec content, not on task shape

The orchestrator SHALL decide whether to run the interaction gate by checking whether the change's `specs/**/spec.md` files contain at least one `[interaction]`-tagged scenario. The decision MUST NOT depend on how many tasks a section has, and MUST NOT depend on a marker written into `tasks.md`. When the gate applies, it SHALL run once per change, at the change's final section gate, after every task in `tasks.md` is complete — not once per section.

#### Scenario: Change with tagged scenarios gets the gate

- **WHEN** a change's specs contain one or more `[interaction]`-tagged scenarios and its last task has just been approved
- **THEN** the orchestrator dispatches `supervisor` in interaction-gate mode before declaring the change implemented

#### Scenario: Final section holds a single task

- **WHEN** the change's final section contains exactly one task, which the single-task fast path would normally let the orchestrator pass without any `supervisor` dispatch
- **THEN** the interaction gate still fires, because the trigger is the presence of tagged scenarios

#### Scenario: Change with no tagged scenarios skips the gate

- **WHEN** a change's specs contain no `[interaction]`-tagged scenario
- **THEN** no interaction gate runs, and section gating behaves exactly as it does today

#### Scenario: Gate does not run per section

- **WHEN** an intermediate section of a change with tagged scenarios finishes
- **THEN** only the existing cross-task composition audit rules apply to it, and the interaction gate is not run against a partially implemented change

### Requirement: Static verification against tagged scenarios always runs

In interaction-gate mode `supervisor` SHALL, for every `[interaction]`-tagged scenario in the change's specs, verify against the implementation as written — the surface named in the scenario's WHEN clause, the code paths that render or handle it, and any tests covering it — whether the described WHEN/THEN behavior is actually implemented. This static pass SHALL run regardless of whether any browser driver is available.

#### Scenario: Every tagged scenario is accounted for

- **WHEN** `supervisor` completes an interaction gate
- **THEN** its report lists every `[interaction]`-tagged scenario in the change and, for each, whether it was found satisfied, found violated, or could not be determined
- **AND** a scenario that could not be determined is reported explicitly rather than silently treated as passing

#### Scenario: Static-only run is still a real gate

- **WHEN** no browser driver is available in the session
- **THEN** the static pass still runs over every tagged scenario and can return blocking findings on its own

### Requirement: Live verification runs additionally when a driver is available

When the session has a tool capable of driving the running application (for example a browser-automation MCP server), `supervisor` SHALL additionally exercise the tagged scenarios against the live app and compare observed behavior to each scenario's THEN clause. When no such tool is available, it SHALL report static-only coverage and MUST NOT describe behavior it did not observe as verified.

#### Scenario: Driver present

- **WHEN** a browser-automation or equivalent app-driving tool is available and the app can be started
- **THEN** `supervisor` navigates to each tagged scenario's named surface, performs the WHEN action, and checks the THEN outcome against what the app actually does
- **AND** a divergence between the running app and the scenario is a blocking finding

#### Scenario: Driver absent

- **WHEN** no app-driving tool is available in the session
- **THEN** the report states plainly that verification was static-only and names the live checks that were therefore not performed
- **AND** the absence of a driver is not by itself a blocking finding

#### Scenario: Driver present but app cannot be reached

- **WHEN** a driver exists but the app fails to start or the named surface cannot be reached
- **THEN** that is reported as a blocking finding naming the failure, not downgraded to a static-only pass

### Requirement: Interaction-gate findings route like other supervisor findings

Interaction-gate findings SHALL use the plugin's existing review-comment convention and the existing `## APPROVE` / `## REQUEST CHANGES` verdicts, and blockers SHALL be routed to a `worker` as a remediation exactly as a section-level `supervisor` blocker is today, followed by a `reviewer` audit and a re-run of the gate.

#### Scenario: Gate requests changes

- **WHEN** the interaction gate returns `## REQUEST CHANGES`
- **THEN** each blocking comment names the tagged scenario it came from and the expected-versus-observed behavior, in enough detail for a remediation `worker` to act without re-deriving the reasoning
- **AND** after `reviewer` approves the remediation the interaction gate is re-run

#### Scenario: Repeated gate failure escalates

- **WHEN** the interaction gate returns `## REQUEST CHANGES` twice in a row for the same change
- **THEN** the orchestrator pauses and surfaces it to the Product Owner instead of iterating again, consistent with the existing escalation rule

#### Scenario: Gate approves

- **WHEN** the interaction gate returns `## APPROVE`
- **THEN** the change is reported as implemented, non-blocking interaction notes are surfaced to the Product Owner, and no extra commit is produced by the gate itself
