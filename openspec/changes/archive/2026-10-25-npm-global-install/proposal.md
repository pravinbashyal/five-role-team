# Proposal

## Why

Installing today means cloning the repo and running `node install.js` with required flags. OpenSpec's model is simpler: `npm install -g <pkg>`, then run one command. Matching it makes the plugin installable without a clone and lets scope and harness be chosen interactively.

## What Changes

- Make the package publishable as `@pravinbashyal/five-role-team` with a `bin` named `five-role-team`, so `npm install -g @pravinbashyal/five-role-team` provides `five-role-team init` (run inside a project, like `openspec init`) and `five-role-team uninstall`.
- Add an `init` subcommand: run in a project directory it installs into that project (local scope by default, `--global` for the user-wide install). `install` is accepted as an alias, and no subcommand still installs as today, so `node install.js ...` keeps working.
- When `--global`/`--local` and/or `--harness` are omitted on an interactive terminal, prompt for them (`init` assumes local scope and only prompts for harness). Flags still work. Without a TTY, missing flags still fail with a hint.
- Add a `files` whitelist so the tarball ships only what the installer needs; `prompts` stays a runtime dependency.
- README Installation leads with the npm global flow; clone plus `node install.js` stays as an alternative.
- Prepare only: no `npm publish` is run by this change.

## Capabilities

### New Capabilities
- `cli/npm-distribution`: npm-installable package, `five-role-team` command, `init` subcommand, interactive scope and harness prompts.

### Modified Capabilities
<!-- None. Existing cli/installation requirements are unchanged; flags remain valid. -->

## Impact

- `package.json` (name, bin, files, publishConfig), `install.js` (arg parsing, prompts, bin shebang/exec bit), README.
- Verification runs in a sandbox: `npm pack`, then `npm install -g --prefix <tmp>` of the tarball with temp HOME and cwd.
