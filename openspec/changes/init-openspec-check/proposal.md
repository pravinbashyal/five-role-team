# Proposal

## Why

five-role-team only works on a project that uses OpenSpec, and every agent, command and skill it ships calls the `openspec` CLI. `five-role-team init` never checks that the CLI exists, so a missing CLI surfaces later as a confusing failure in the middle of an `/five-role-team:apply` or `/five-role-team:explore` run. The README also only says "a project using OpenSpec", without naming the CLI as a requirement or saying how to get it.

## What Changes

- `five-role-team init` checks whether the `openspec` CLI is on `PATH` after the plugin is installed and before the "Next steps" block.
- On a terminal (the interactive flow, i.e. no `--default` and no `--link`), a missing CLI triggers one question: install it now with `npm install -g @fission-ai/openspec`? Yes runs the install; No continues. A failed install prints the error and the manual command and continues. Neither answer undoes or fails the plugin install.
- Without a terminal, or with `--default` or `--link`, `init` never asks and never installs on its own: it prints a warning with the install command.
- New opt-in `--install-openspec` flag installs the CLI without asking when it is missing, for scripted installs.
- README: list the OpenSpec CLI as an explicit requirement (linking https://openspec.dev), add `openspec init` to the install steps, and describe the new question where it describes the setup questions. `--help` text documents the flag.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli/installation`: adds requirements for detecting the OpenSpec CLI during `init`, for asking before installing it, and for the `--install-openspec` flag. Existing requirements are unchanged.

## Impact

- Code: `install.js` (post-install step, flag parsing, `--help`), possibly a small new helper module listed in `package.json` `files`.
- Tests: `test/test-interactive-init.js`, `test/test-default-setup.js`, `test/test-command-grammar.js`, `test/verify-readme-commands.js`, and `test/verify-pack-contents.js` if a module is added.
- Docs: `README.md` (Requirements, Install, setup questions).
- Dependencies: none added to the package; the installer shells out to the user's own `npm` only after consent (or `--install-openspec`).
