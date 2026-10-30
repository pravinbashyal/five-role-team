# Tasks

## 1. OpenSpec check in `init`

- [x] 1.1 Add the post-install OpenSpec step to `install.js` per design D1-D6: detect via `openspec --version`, ask (default yes) in the interactive flow, install with `npm install -g @fission-ai/openspec` on yes, warn-only otherwise, catch install failures and print the error plus the manual command, run before `logNextSteps`, never change the exit status. Verify with a new test in `test/test-interactive-init.js` using injected `promptsImpl`, `detectOpenspec` and `runInstall` that covers present, approve, decline, install-fails and cancel, and that "Next steps" is still the last output.
- [x] 1.2 Add the `--install-openspec` flag to `parseArgs` and the `--help` text, installing without a question when the CLI is missing and doing nothing when present. Verify with `test/test-command-grammar.js` (flag parses and appears in help) and `test/test-default-setup.js` (`--default` warns without installing; `--default --install-openspec` installs; no-TTY run asks nothing).
- [x] 1.3 If a helper module was added in 1.1, list it in `package.json` `files`. Verify `node test/verify-pack-contents.js` passes; skip when no module was added.

## 2. Documentation

- [x] 2.1 Update `README.md`: Requirements lists the OpenSpec CLI explicitly with a link to https://openspec.dev; Install gains an `openspec init` step for the project; "The two questions" section describes the conditional OpenSpec question and `--install-openspec`; the `--help` flag list matches. Verify with `node test/verify-readme-commands.js` and by reading the section against the shipped behavior.

## 3. Whole-change verification

- [x] 3.1 Run `npm test` and `openspec validate init-openspec-check --strict`; manually run `five-role-team init` in a temp directory with `openspec` hidden from `PATH` and confirm the question, the decline path, and that "Next steps" is last. Verify all pass and the plugin files are present after declining.
