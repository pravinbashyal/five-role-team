# Design

## Context

`install.js` already holds all install and uninstall logic, resolves its source via `__dirname`, and has `prompts` as a dependency. npm runs a `bin` through a symlink, and Node resolves `__dirname` to the real package directory, so the existing source lookup keeps working. OpenSpec's flow is `npm install -g @fission-ai/openspec@latest` then `openspec init`.

## Goals / Non-Goals

**Goals:** npm-global install flow; interactive scope/harness; small tarball; flags and `node install.js` keep working.
**Non-Goals:** publishing to npm (user runs `npm publish`); `npx` support beyond what a `bin` gives for free; an `update` command; changing agent/model behavior.

## Decisions

### Decision 1: One executable, existing logic
Add `"bin": {"five-role-team": "install.js"}`; `install.js` already has a shebang and gets the exec bit. No wrapper script, so there is one code path.

### Decision 2: `init` is the primary subcommand
Like `openspec init`, `five-role-team init` is run inside a project and installs there: it defaults scope to local, `--global` overrides. `install` is an alias and the bare form still installs, so existing commands and docs keep working. Parsed as an optional first argument like `uninstall`.

### Decision 3: Prompt only for what is missing, only on a TTY
Reuse `prompts`. Scope (skipped for `init`, which defaults to local): select global/local. Harness: select pi / claude-code / custom path (text). Non-TTY keeps today's validation error with a hint. Prompt cancel exits cleanly like the agent prompts.

### Decision 4: `files` whitelist, not `.npmignore`
Whitelist is safer against leaking local dirs (`.claude/`, `.pi/`, `openspec/`). Verified with `npm pack --dry-run`.

### Decision 5: Scoped name, prepare only
Name `@pravinbashyal/five-role-team` with `publishConfig.access: public`. No publish happens in this change.

### Decision 6: Sandboxed packaging verification
Pack to a temp dir, `npm install -g --prefix <tmp>` the tarball, run the installed command with temp HOME and cwd via the existing sandbox helper. Real `~/.claude` and `~/.pi` and the real global npm prefix are never touched.

## Risks / Trade-offs

- Scoped name must be publishable by the user's npm account → user confirms at publish time.
- `files` whitelist can drift when installer gains a new source path → a verify script compares `npm pack --dry-run` against `SOURCE_ENTRIES` in `verify-matrix.js`.
