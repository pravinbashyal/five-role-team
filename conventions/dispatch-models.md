# Dispatch models (orchestrator)

Install writes the Product Owner's chosen models into:

1. `.agent-config.json` next to the installed plugin (`models.<role>`), and
2. each installed agent file's YAML frontmatter `model:` line (and, for Cursor, the flat `.cursor/agents/<role>.md` copies).

**Those values are the source of truth for which model each role runs on.** Shipping defaults (Opus / Sonnet / Haiku in the plugin templates) apply only when no install config exists yet.

## Before the first `designer` / `architect` / `worker` / `reviewer` / `supervisor` dispatch

1. Resolve the installed plugin directory for this project (prefer the harness in use):
   - Cursor: `./.cursor/skills/five-role-team/` (local) or `~/.cursor/skills/five-role-team/` (global)
   - Claude Code: `./.claude/skills/five-role-team/` or `~/.claude/skills/five-role-team/`
   - pi: `./.pi/skills/five-role-team/` (and the Claude skills path for global pi)
2. Read `<plugin>/.agent-config.json` when present. Use `models.<role>` for that role.
3. If the config file is missing (e.g. `--link` install), read the `model:` frontmatter from the agent file you will dispatch (`agents/<role>.md` under the plugin, or `.cursor/agents/<role>.md` for Cursor).
4. When the host's Task / Agent tool accepts a `model` argument, **pass that resolved id** on every dispatch of that role. Do not substitute Opus (or any other default) because a skill description mentions it.
5. Product Owner override in the current chat (e.g. "use Grok for architect") beats the config for that session only.

## Do not

- Hard-code Opus / Sonnet / Haiku in explore or apply dispatches when `.agent-config.json` (or frontmatter) names something else.
- Treat "Runs on Opus" in an agent **description** as a dispatch instruction — description text may lag; `model:` / `.agent-config.json` win.
