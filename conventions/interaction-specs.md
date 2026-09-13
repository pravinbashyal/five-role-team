# Interaction-scenario tagging convention (shared by `designer`, `architect`, `supervisor`)

`architect` folds a `designer` handoff into ordinary OpenSpec scenarios inside the `specs/<capability>/spec.md` files it already writes — never a separate interaction file, design-only document, or mockup artifact. The tag below is what makes those scenarios detectable without a parser.

## Exact syntax

Prefix the scenario's name with the literal tag `[interaction]` immediately after `#### Scenario: `:

```
#### Scenario: [interaction] Saving a draft from the editor toolbar
```

The tag is a fixed literal string (`[interaction]`, including the brackets) at a fixed position (immediately after `#### Scenario: `, before the rest of the name). Nothing else about the scenario's structure changes — it is still a normal WHEN/THEN OpenSpec scenario, still lives under a `### Requirement:` in a normal `specs/<capability>/spec.md`, and still has to pass `openspec validate --strict` like any other scenario.

## What qualifies as an interaction scenario

Tag a scenario `[interaction]` when it describes how a person perceives or acts on a concrete surface — what they see, click, type, navigate to, or are told, and what happens in response. Examples: a screen or route's behavior, a component's on-screen state change, a CLI command's prompts and output, an error message a user sees.

Leave a scenario untagged when it describes something with no directly observable human-facing behavior: a data contract, an internal invariant, an API response shape, a background job's scheduling rule, a database migration's effect. A capability can freely mix tagged and untagged scenarios under the same requirement or different requirements — tag at the scenario level, not the requirement or capability level.

## The WHEN-clause-names-concrete-surface rule

An `[interaction]`-tagged scenario's **WHEN** clause MUST name the concrete surface the interaction happens on — a route, screen, component, or command invocation — in enough detail for a person, or a browser driver, to reach it without guessing. "When the user saves" is not enough; "when the user clicks Save in the editor toolbar at `/documents/:id/edit`" is. This is what lets `supervisor`'s interaction gate (`specs/interaction-verification/spec.md`) actually drive to the scenario later, and what lets it report a scenario as undetermined (rather than silently passing) when the surface can't be reached.

## Canonical detection grep

Any role or tool that needs to find a change's interaction scenarios runs:

```
grep -rn '^#### Scenario: \[interaction\]' openspec/changes/<change>/specs/
```

This is anchored to the start of the line and matches only headings that carry the literal tag immediately after `#### Scenario: ` — it does not match an untagged scenario, a scenario whose name merely mentions the word "interaction" elsewhere, or a `### Requirement:` heading.

## Worked examples

These are illustrative only — they are not scenarios of any real capability, and the detection grep below is run against this file itself as this convention's own self-check, not against `openspec/changes/*/specs/`.

Matches the grep (tagged, qualifies):

```
#### Scenario: [interaction] Saving a draft from the editor toolbar
#### Scenario: [interaction] Dismissing the error banner on the login screen
```

Does not match the grep (untagged, correctly so — no directly observable human-facing behavior):

```
#### Scenario: Draft payload is persisted with a monotonic version number
#### Scenario: Login endpoint rejects a malformed token
```

Does not match the grep (mentions "interaction" in prose, not the tag at the fixed position — shows the grep is not fooled by the word alone):

```
#### Scenario: Handles a rapid double interaction on the submit button
```

### Self-check

Running the canonical grep above against this file itself must match exactly the two tagged headings under "Matches the grep" and nothing else in this file (not the untagged headings, not the "double interaction" heading, not any other line):

```
$ grep -n '^#### Scenario: \[interaction\]' conventions/interaction-specs.md
```
