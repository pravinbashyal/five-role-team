# Design

## Context

`main()` in `install.js` parses args, resolves the harness and scope, and installs the files inside a rollback transaction (`tx`). It then discards backups and prints `logInstallSummary`. After that come the post-install `runOpenspecStep`, which never changes the exit status, and `logNextSteps`, which must be the last output. Uninstall branches early in `main()`, removes the primary install, the pi secondary and the Cursor agent files, and exits 1 with "Nothing to uninstall" when nothing was removed. See proposal.md for motivation.

Facts from Claude Code's documentation that shape the approach:

- **Agent rule names.** Plugin components are namespaced under `plugin.json` `name` (`five-role-team`). An agent is therefore `five-role-team:<id>` whether the plugin loads from a skills directory or from the marketplace, and the permission rule is `Agent(five-role-team:<id>)`.
- **The plugin cannot ship the rules.** A plugin's own `settings.json` honours only `agent` and `subagentStatusLine`, so permission rules have to go into the user's settings files.
- **Project-local file.** `.claude/settings.local.json` applies without the workspace trust dialog when it is untracked. Claude Code reads it from the git repository root.
- **User-wide file.** `~/.claude/settings.local.json` is read only in sessions started in the home directory. The only file that applies across all projects is `~/.claude/settings.json`.
- **Bash rule syntax.** `Bash(<prefix>:*)` is a valid trailing-wildcard rule. `git status/diff/log/rev-parse` are already in the built-in read-only set, but they can still prompt in some forms (for example a `cd <dir> && git ...` compound). Allowing them is harmless and matches the Product Owner's observed prompts.

## Goals / Non-Goals

**Goals:**
- A Claude Code user can run the apply loop after `init` without approving each dispatch or commit-worker git call.
- Never lose or reorder anything already in the user's settings file.
- Never fail or roll back an install because of the settings step.
- Testable inside the existing temp-HOME / temp-cwd sandbox.

**Non-Goals:**
- Permissions for pi, Cursor or custom-path harnesses.
- Reading or reconciling `deny` / `ask` rules. A matching deny or ask rule still wins over our allow rules, as Claude Code defines.
- Finding the git repository root for local scope. The current directory is used, the same directory the skills install uses.
- Recording which rules this installer added. Uninstall identifies its rules by pattern instead.
- Supporting JSON-with-comments settings files. Claude Code settings are strict JSON.

## Decisions

**D1. New module `claude-permissions.js`, pure core plus thin file wrappers.**
- Pure functions:
  - build the rule list from agent ids;
  - merge rules into parsed settings and return the added rules;
  - remove the plugin's agent rules from parsed settings and return the removed rules.
- Two file wrappers that read, parse, apply and write, each returning a status object.
- Keeps `install.js` from growing and lets most tests run with no file system.
- Must be added to `package.json` `files` and `SOURCE_ENTRIES` in `test/verify-matrix.js`, which `verify-pack-contents.js` checks against each other.
- Alternative considered: inline in `install.js`. Rejected because the file is already over 1,500 lines.

**D2. Rule list and order.**
- First, one `Agent(five-role-team:<id>)` per installed agent, in selection order. Under `--link` there is no selection, so this is the full `AGENT_CATALOG` order.
- Then the six git rules, in this fixed order: `Bash(git add:*)`, `Bash(git commit:*)`, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git rev-parse:*)`, `Bash(git log:*)`.
- The `:*` form matches this checkout's working file. The space form ` *` would be equivalent, but exact-match idempotence against existing files needs one fixed spelling.

**D3. Settings file by scope.**
- Local: `path.join('.', '.claude', 'settings.local.json')`, resolved to an absolute path for output.
- Global: `path.join(os.homedir(), '.claude', 'settings.json')`.
- Only when the harness is exactly `claude-code`. pi, cursor and custom paths skip the step with no output, including global pi, whose primary copy also sits in `~/.claude/skills`.
- `.claude/` is created if it is missing.

**D4. Merge semantics.**
- Missing file: write `{ "permissions": { "allow": [ ...rules ] } }`.
- Existing file:
  - It must parse as a JSON object. `permissions`, if present, must be an object, and `permissions.allow`, if present, must be an array.
  - Append each rule not already present as an exact string, keeping existing entries and order.
  - Every other key (`deny`, `ask`, `additionalDirectories`, unrelated top-level keys) is left as it is.
- If nothing was added, the file is not rewritten.
- Otherwise it is written with `JSON.stringify(obj, null, 2) + '\n'`, directly to the path, so a symlinked file is written through, not replaced.
- Alternative considered: write to a temp file and rename. Rejected because it would replace a symlinked settings file with a regular file.

**D5. Failure is a warning, never an error.**
- Triggers: unparseable JSON, a non-object root, a non-object `permissions`, a non-array `allow`, or any read or write error.
- Effect: the file is left byte-for-byte unchanged. One warning names the file and the reason, followed by the rules to add by hand.
- `init` exit status is unchanged.
- The step runs after the install transaction and the backup discard have completed, so it can never trigger `rollbackInstall`. This copies `runOpenspecStep`'s contract.

**D6. Output placement and wording.**
- One line, printed right after `logInstallSummary` and before the OpenSpec step, so "Next steps" stays last:
  - `Claude Code permissions: added N rule(s) to <abs path>`, or
  - `Claude Code permissions: all N rule(s) already present in <abs path>`.
- `--no-permissions` prints nothing for the step.
- The exact strings are pinned in tests.

**D7. `--no-permissions` flag.**
- Parsed by `parseArgs` and listed in `--help` under OTHER OPTIONS.
- On `init` it skips the step.
- On `uninstall` it also skips the agent-rule removal. This is consistent with "init options are accepted on uninstall", and gives a way to keep the rules.
- Alternative considered: no flag. Rejected by the Product Owner, who wants silent default-on behaviour with an escape hatch.

**D8. Uninstall removes only agent rules.**
- Applies when the harness is `claude-code` and not `--no-permissions`.
- Uses the same scope-to-file mapping as D3.
- Removes every `allow` entry matching `^Agent\(five-role-team:[^)]+\)$`. That pattern cannot belong to anything else, and it catches rules for agents that were deselected later.
- Git `Bash` rules are always kept, because the user may rely on them for other work.
- Runs only after the file uninstall actually removed something. When nothing is installed, the existing "Nothing to uninstall" exit 1 still means "removes nothing".
- Prints `Claude Code permissions: removed N rule(s) from <abs path> (<rules>)` when N > 0, and nothing when N is 0 or the file is missing.
- Malformed file: same warning-only behaviour as D5, exit status unchanged.

## Risks / Trade-offs

- [`--global` grants `Bash(git commit:*)` in every project for this user] → The Product Owner chose this deliberately. README states it, and `--no-permissions` opts out.
- [Running local `init` from a subdirectory writes a `settings.local.json` that Claude Code does not read, because it reads from the repo root] → Documented in README. It matches the existing skills-install behaviour, which has the same current-directory assumption.
- [Re-serialising the file changes its formatting (indent, key spacing)] → The file is only rewritten when a rule is actually added. Key order and values are preserved, because `JSON.parse` / `JSON.stringify` keep insertion order.
- [Uninstall removes an `Agent(five-role-team:…)` rule the user had added by hand] → Accepted: such a rule is meaningless once the plugin is removed.
- [A user `deny` / `ask` rule overrides an allow rule we add] → This is intended Claude Code precedence. Not reported.

## Migration Plan

No migration is needed. Existing installs gain the rules the next time `init` is re-run. Rollback is `five-role-team uninstall`, which removes the agent rules. The git rules can be deleted by hand.
