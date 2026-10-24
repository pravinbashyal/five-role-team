# Tasks

## 1. Package

- [x] 1.1 Update `package.json`: name `@pravinbashyal/five-role-team`, `bin` `five-role-team` → `install.js`, `files` whitelist, `publishConfig.access` public, version; make `install.js` executable; verify `npm pack --dry-run` lists the required files and excludes verify/test scripts, `openspec/`, `.claude/`, `.pi/`
- [x] 1.2 Add a sandboxed verify script that packs the tarball, installs it with `npm install -g --prefix <tmp>`, runs `five-role-team --help` and `five-role-team init --global --harness claude-code`, plus `five-role-team init --harness claude-code` from a temp project dir with temp HOME/cwd, and checks the files landed (never touching the real home or global prefix)

## 2. CLI

- [x] 2.1 Add `init` (local scope by default, `--global` overrides) and `install` alias as optional first arguments in the arg parser and `--help` text; verify `init`, `install` and bare forms parse as specified and `uninstall` is unchanged
- [ ] 2.2 Prompt for missing scope (not for `init`) and harness on a TTY (select global/local; select pi/claude-code/custom path), exit 1 with a hint without a TTY, exit cleanly on cancel; verify with flag-driven, partial-flag, non-TTY and cancel cases (sandboxed)

## 3. Documentation

- [ ] 3.1 Rewrite README Installation to lead with `npm install -g @pravinbashyal/five-role-team` then `five-role-team init` in a project, keep clone + `node install.js` as an alternative, and verify the documented commands in a sandbox against the packed tarball
