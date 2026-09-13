## Purpose

Gives the team a dedicated plan-time role that researches and designs how a change behaves for the person using it, and a written convention for carrying that design into the specs `architect` already owns, so interaction decisions are made deliberately before implementation instead of incidentally inside a `worker`.

## ADDED Requirements

### Requirement: A `designer` role owns plan-time interaction research and design

The plugin SHALL provide a `designer` subagent (`agents/designer.md`, Opus) whose job is to research the users, the existing surfaces in the codebase, and relevant prior art for an interaction-relevant topic, and to design the resulting interaction. `designer` MUST NOT write or edit any file, MUST NOT write application code, and MUST NOT produce mockups, image assets, or a parallel design document as its deliverable — its sole deliverable is its report.

#### Scenario: Designer investigates before designing

- **WHEN** `designer` is dispatched with an interaction-relevant topic
- **THEN** it inspects the actual existing surfaces in the codebase (screens, routes, components, commands) and any existing specs before proposing an interaction
- **AND** every claim it makes about current behavior traces to a file or command output it actually read, not to assumption

#### Scenario: Designer never writes files

- **WHEN** `designer` finishes its work
- **THEN** no file in the repository has been created or modified by it
- **AND** its findings exist only as its report text

#### Scenario: Designer asks the Product Owner about a genuine design fork

- **WHEN** `designer` reaches a design decision that is the Product Owner's judgment call rather than something the codebase can answer
- **THEN** it asks one question at a time with concrete, mutually exclusive options and waits for the answer before continuing

### Requirement: `designer` runs before `architect` and hands off to it

`/five-role-team:explore` SHALL dispatch `designer` before `architect` when the topic is interaction-relevant, and SHALL pass `designer`'s report into the `architect` dispatch as input. `architect` SHALL remain the only role that creates or edits OpenSpec change artifacts.

#### Scenario: Interaction-relevant topic gets a designer pass first

- **WHEN** `/five-role-team:explore` is invoked with a topic that changes what a person sees or does (a screen, a flow, a CLI interaction, an error surface)
- **THEN** `designer` is dispatched first and runs to completion
- **AND** `architect` is dispatched afterwards with `designer`'s full report included in its dispatch

#### Scenario: Non-interaction topic skips the designer pass

- **WHEN** the topic has no user-facing surface (an internal refactor, a build script, a data migration with no UI)
- **THEN** `designer` is not dispatched and `architect` runs as it does today

#### Scenario: Interaction-relevance is ambiguous

- **WHEN** it is unclear whether the topic is interaction-relevant
- **THEN** the Product Owner is asked once, before either role is dispatched, rather than the pass being silently skipped or silently run

#### Scenario: Architect receives a topic with no handoff but a user-facing surface

- **WHEN** `architect` is dispatched with an interaction-relevant topic and no `designer` handoff in its input
- **THEN** it says so and offers a `designer` pass before capturing interaction scenarios of its own invention

### Requirement: `architect` folds the handoff into tagged interaction scenarios

`architect` SHALL express a `designer` handoff as ordinary OpenSpec scenarios inside the `specs/<capability>/spec.md` files it already writes for the change — not as a separate interaction document and not as a separate interaction-only capability. Each such scenario's name SHALL be prefixed with the literal tag `[interaction]` immediately after `#### Scenario: `.

#### Scenario: Handoff becomes tagged scenarios in the change's own specs

- **WHEN** `architect` captures a change for which it received a `designer` handoff
- **THEN** each designed interaction appears as a `#### Scenario: [interaction] <name>` block, in WHEN/THEN form, inside a `specs/<capability>/spec.md` of that change
- **AND** no separate interaction spec file, design-only document, or mockup artifact is created for it

#### Scenario: Tagged scenario names the surface it happens on

- **WHEN** `architect` writes an `[interaction]`-tagged scenario
- **THEN** its **WHEN** clause names the concrete surface the interaction occurs on (route, screen, component, or command invocation) in enough detail for someone — or a browser driver — to reach it without guessing

#### Scenario: Untagged scenarios stay untagged

- **WHEN** a scenario describes non-interaction behavior (a data contract, an internal invariant, an API response shape)
- **THEN** it is written without the `[interaction]` tag

### Requirement: The interaction-scenario convention is documented as a bundled convention file

The plugin SHALL document the `[interaction]` tag — its exact syntax, what qualifies as an interaction scenario, and the surface-naming rule — in `conventions/interaction-specs.md`, referenced by the roles that produce or consume it (`designer`, `architect`, `supervisor`) via `${CLAUDE_PLUGIN_ROOT}`, in the same way `conventions/review-comments.md` is already referenced.

#### Scenario: Roles read the convention from the plugin, not from the project

- **WHEN** `designer`, `architect`, or `supervisor` needs the interaction-scenario format
- **THEN** it reads `${CLAUDE_PLUGIN_ROOT}/conventions/interaction-specs.md`
- **AND** no per-project copy of that convention is required for the plugin to work

#### Scenario: Convention is greppable

- **WHEN** any role or tool needs to find a change's interaction scenarios
- **THEN** the documented tag is a fixed literal string at a fixed position in the scenario heading, so a single grep over the change's `specs/**/spec.md` finds all of them and nothing else
