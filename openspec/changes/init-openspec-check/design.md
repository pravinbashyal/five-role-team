# Design

## Context

`install.js` runs `main()`: parse args, resolve harness and scope, install files, then `logInstallSummary` and `logNextSteps`. The terminal questions live in `runInitTerminalFlow` and use `askQuestion(promptsImpl, question)` so tests inject answers. The installation spec requires "Next steps" to be the last output, so the OpenSpec step must run between the install summary and `logNextSteps`. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Detect a missing `openspec` CLI and offer to install it, with consent, without ever endangering the plugin install.
- Keep scripted installs deterministic: no surprise prompt, no surprise global install.
- Keep the check testable without touching the real machine.

**Non-Goals:**
- Running `openspec init` in the user's project (the README documents it; the installer does not do it).
- Version checks or upgrades of an existing OpenSpec CLI.
- Supporting package managers other than npm for the install.

## Decisions

**D1. Separate post-install step, not part of `runInitTerminalFlow`.** The question is asked after the files are written, so declining or cancelling can never roll back or block the plugin install, and the existing "two questions" sequence and its tests are untouched. Alternative: ask up front with the other questions; rejected because a cancel there would abort the whole install ("Installation cancelled. Nothing was changed.") over an optional extra.

**D2. Detection by running `openspec --version`** (spawn without a shell, exit status 0 = present). Checking `PATH` entries by hand would miss shims and Windows extensions. Alternative: `which`; rejected as non-portable.

**D3. Interactive means the same signal `init` already uses** (terminal, no `--default`, no `--link`). Anything else warns only. `--install-openspec` overrides in every mode and skips the question.

**D4. Install by running `npm install -g @fission-ai/openspec`** with inherited stdio so npm's own progress and errors show. Non-zero exit or spawn error is caught, reported with the manual command, and swallowed (exit stays 0). After a successful install, no re-check is required beyond the exit status, since the shell's `PATH` may need a new session.

**D5. Injection for tests.** The step takes injectable `detectOpenspec` and `runInstall` functions (and the existing `promptsImpl`), defaulting to the real implementations, so tests never spawn npm. A small helper module is acceptable if `install.js` grows too large; if added it must be listed in `package.json` `files`.

**D6. Prompt default is yes**, matching the `(Y/n)` wording and the install question's convention. Cancel at this question leaves the completed install in place and skips the OpenSpec install.

## Risks / Trade-offs

- [Global `npm install` needs permissions or a configured prefix on some machines] → failure path prints the error and the manual command; the plugin install is unaffected.
- [Newly installed `openspec` not on `PATH` until a new shell] → success message does not promise it works immediately; README install steps mention restarting the shell if needed.
- [Another prompt in a flow users know as "two questions"] → it appears only when the CLI is missing, after the install, and the README section is updated to say so.
- [Package name could change upstream] → one constant, covered by a test that pins the printed command.
