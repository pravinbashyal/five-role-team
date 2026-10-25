'use strict';

const fs = require('fs');
const path = require('path');
const { isPiHarness } = require('./select-agents');

// Plain-language cause for the fs error codes an install can realistically hit.
const FS_ERROR_CAUSES = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  ENOTDIR: 'a parent path is a file, not a directory',
  ENOENT: 'no such file or directory',
  EEXIST: 'something already exists at this path',
  EROFS: 'the file system is read-only',
  ENOSPC: 'no space left on device',
  ELOOP: 'too many levels of symbolic links',
  ENAMETOOLONG: 'file name too long',
};

/**
 * Human-readable text for an error raised by an fs or symlink call (task 8.3).
 * Keeps the Node message, which already names the path and the operation, and
 * appends the likely cause when the error code is one an install can hit. Errors
 * without a known code (including the installer's own messages) are returned as is.
 *
 * @param {Error|{code?: string, message?: string}} err
 * @returns {string}
 */
function describeFsError(err) {
  const message = err && err.message ? err.message : String(err);
  const cause = err && typeof err.code === 'string' && Object.prototype.hasOwnProperty.call(FS_ERROR_CAUSES, err.code)
    ? FS_ERROR_CAUSES[err.code]
    : null;
  // Node's own text often already states the cause (e.g. "permission denied"), so
  // it is only appended when it is not there yet.
  return cause && !message.includes(cause) ? `${message} (likely cause: ${cause})` : message;
}

/**
 * Validate that a directory exists (or can be created) and is writable, and
 * create it (with any missing parents) when it does not exist.
 *
 * Validation failures throw an Error with a clear, user-facing message:
 * - the path (or one of its ancestors) exists but is not a directory
 * - the path (or its nearest existing ancestor) is not writable
 * - creation fails for any other reason (e.g. dangling symlink)
 *
 * @param {string} dir - Directory path (absolute, or relative to cwd)
 * @returns {{path: string, created: boolean, createdPaths?: string[]}} Absolute path, whether it was
 *   created, and (when created) every directory this call created, outermost first
 * @throws {Error} with a clear message if the directory is invalid or cannot be created
 */
function ensureDirectory(dir) {
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    throw new Error('Installation directory path is required');
  }
  const target = path.resolve(dir);

  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      throw new Error(`Cannot access ${target}: ${describeFsError(err)}`);
    }
  }

  if (stat) {
    if (!stat.isDirectory()) {
      throw new Error(`Cannot install to ${target}: path exists but is not a directory`);
    }
    assertWritable(target, `Cannot install to ${target}: directory is not writable`);
    return { path: target, created: false };
  }

  // Missing: find the nearest existing ancestor and validate it first.
  // `missing` collects every path this call will create (innermost first).
  const missing = [target];
  let ancestor = path.dirname(target);
  for (;;) {
    let ancestorStat = null;
    try {
      ancestorStat = fs.statSync(ancestor);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
        throw new Error(`Cannot access ${ancestor}: ${describeFsError(err)}`);
      }
    }
    if (ancestorStat) {
      if (!ancestorStat.isDirectory()) {
        throw new Error(
          `Cannot create ${target}: ${ancestor} exists but is not a directory`
        );
      }
      assertWritable(
        ancestor,
        `Cannot create ${target}: parent directory ${ancestor} is not writable`
      );
      break;
    }
    missing.push(ancestor);
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }

  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create ${target}: ${describeFsError(err)}`);
  }
  return { path: target, created: true, createdPaths: missing.reverse() };
}

function assertWritable(dir, message) {
  try {
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
  } catch (err) {
    throw new Error(message);
  }
}

/**
 * Validate and create the directories needed for an installation, given the
 * result of `resolveHarnessPath`.
 *
 * Creates the skills base directory (parent of the plugin directory) and, for
 * pi global installs, the parent of the secondary symlink. The plugin
 * directory itself (`primary`) and the symlink (`secondary`) are NOT created
 * here: later steps copy into / link at those paths.
 *
 * @param {{base: string, primary: string, secondary: string|null}} resolved
 * @returns {{created: string[], existing: string[], createdPaths: string[]}} Absolute directory paths by
 *   outcome; `createdPaths` lists every directory created (including missing ancestors), outermost first
 * @throws {Error} with a clear message if a directory is invalid or cannot be created
 */
function ensureInstallDirectories(resolved) {
  if (!resolved || !resolved.primary) {
    throw new Error('Resolved installation paths are required');
  }
  const dirs = [path.dirname(resolved.primary)];
  if (resolved.secondary) {
    dirs.push(path.dirname(resolved.secondary));
  }

  const created = [];
  const existing = [];
  const createdPaths = [];
  for (const dir of dirs) {
    let r;
    try {
      r = ensureDirectory(dir);
    } catch (err) {
      err.createdPaths = createdPaths.slice(); // so callers can roll back earlier creations
      throw err;
    }
    (r.created ? created : existing).push(r.path);
    if (r.createdPaths) createdPaths.push(...r.createdPaths);
  }
  return { created, existing, createdPaths };
}

/**
 * Top-level plugin entries that are part of an installation (allowlist taken
 * from design.md "Context": SKILL.md, agents/, commands/, conventions/,
 * .claude-plugin/). Anything not listed here (openspec/, .git, node_modules,
 * .claude/, .pi/, test/, installer
 * sources, package files, README) is never part of the install set.
 * `agents/` and `pi/agents/` are handled separately (per-agent filtering).
 */
const INSTALL_FILES = ['SKILL.md'];
const INSTALL_DIRS = ['commands', 'conventions', '.claude-plugin'];
const IGNORED_NAMES = new Set(['.DS_Store', '.git', 'node_modules']);

/**
 * Build the list of files and directories that make up an installation.
 * Pure with respect to the file system: only reads the source directory,
 * copies/links nothing.
 *
 * - `agents/<id>.md` is kept only for ids in `selectedAgents`.
 * - For the pi harness, `pi/agents/<id>.md` is likewise kept only for
 *   selected ids; for other harnesses `pi/` is excluded entirely.
 *
 * @param {string} sourceDir - Plugin source directory (must contain SKILL.md and .claude-plugin/plugin.json)
 * @param {string[]} selectedAgents - Agent ids to include
 * @param {string} harness - Harness name or path from `--harness`
 * @returns {{path: string, type: 'file'|'dir'}[]} Entries relative to sourceDir (POSIX separators), parents before children
 * @throws {Error} if sourceDir is not a valid plugin directory
 */
function buildInstallSet(sourceDir, selectedAgents, harness) {
  if (typeof sourceDir !== 'string' || sourceDir.trim().length === 0) {
    throw new Error('Plugin source directory is required');
  }
  if (!Array.isArray(selectedAgents)) {
    throw new Error('Selected agents must be an array');
  }
  const root = path.resolve(sourceDir);
  for (const required of ['SKILL.md', path.join('.claude-plugin', 'plugin.json')]) {
    if (!fs.existsSync(path.join(root, required))) {
      throw new Error(`Not a plugin source directory: ${required} not found in ${root}`);
    }
  }

  const selected = new Set(selectedAgents);
  const entries = [];

  for (const file of INSTALL_FILES) {
    if (fs.existsSync(path.join(root, file))) entries.push({ path: file, type: 'file' });
  }
  for (const dir of INSTALL_DIRS) {
    collectTree(root, dir, entries);
  }
  collectAgents(root, 'agents', selected, entries);
  if (isPiHarness(harness)) {
    collectAgents(root, 'pi/agents', selected, entries, true);
  }
  return entries;
}

/**
 * Check that the plugin source directory is a five-role-team plugin directory
 * (task 8.4): `.claude-plugin/plugin.json` must exist there as a readable regular
 * file. Pure read-only check, so it is safe to run before any prompt or write.
 *
 * @param {string} sourceDir - Plugin source root (the directory install.js sits in)
 * @throws {Error} with a clear message naming the expected file and the directory checked
 */
function validatePluginSource(sourceDir) {
  if (typeof sourceDir !== 'string' || sourceDir.trim().length === 0) {
    throw new Error('Plugin source directory is required');
  }
  const root = path.resolve(sourceDir);
  const manifest = path.join(root, '.claude-plugin', 'plugin.json');
  const notFound = `Not a five-role-team plugin directory: .claude-plugin/plugin.json not found in ${root}. ` +
    'Reinstall with "npm install -g @pravinbashyal/five-role-team", or run from a complete five-role-team checkout (the directory that contains .claude-plugin/plugin.json).';

  let st;
  try {
    st = fs.statSync(manifest);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new Error(notFound);
    throw new Error(`Cannot access ${manifest}: ${describeFsError(err)}`);
  }
  if (!st.isFile()) {
    throw new Error(`Not a five-role-team plugin directory: ${manifest} is not a file (checked in ${root})`);
  }
  try {
    fs.accessSync(manifest, fs.constants.R_OK);
  } catch (err) {
    throw new Error(`Cannot read ${manifest}: ${describeFsError(err)}`);
  }
}

function collectTree(root, rel, entries) {
  const abs = path.join(root, rel);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    return;
  }
  if (!stat.isDirectory()) return;
  entries.push({ path: rel, type: 'dir' });
  for (const name of fs.readdirSync(abs).sort()) {
    if (IGNORED_NAMES.has(name)) continue;
    const childRel = `${rel}/${name}`;
    if (fs.statSync(path.join(root, childRel)).isDirectory()) {
      collectTree(root, childRel, entries);
    } else {
      entries.push({ path: childRel, type: 'file' });
    }
  }
}

function collectAgents(root, rel, selected, entries, addParent) {
  const abs = path.join(root, rel);
  let names;
  try {
    names = fs.readdirSync(abs).sort();
  } catch (err) {
    return;
  }
  const files = names.filter(
    (n) => n.endsWith('.md') && selected.has(n.slice(0, -3)) && fs.statSync(path.join(abs, n)).isFile()
  );
  if (files.length === 0 && addParent) return; // no pi agent selected: omit pi/ entirely
  if (files.length === 0) {
    // Keep agents/ itself so the installed layout is stable even when empty.
    entries.push({ path: rel, type: 'dir' });
    return;
  }
  if (addParent) entries.push({ path: 'pi', type: 'dir' });
  entries.push({ path: rel, type: 'dir' });
  for (const n of files) entries.push({ path: `${rel}/${n}`, type: 'file' });
}

/**
 * Format a model string as a YAML scalar. Plain when it is unambiguous
 * (e.g. `opus`, `anthropic/claude-opus-4-5-20251101`, `qwen3.5:4b-mlx`),
 * double-quoted (JSON-escaped, which is valid YAML) otherwise.
 */
function formatYamlScalar(value) {
  const plain =
    /^[A-Za-z0-9][A-Za-z0-9_.\/@+-]*(:[A-Za-z0-9_.\/@+-]+)*$/.test(value) &&
    !/^(true|false|yes|no|on|off|null|y|n)$/i.test(value) &&
    !/^[0-9][0-9_.eE+-]*$/.test(value) &&
    !/^0[xXoObB]/.test(value);
  return plain ? value : JSON.stringify(value);
}

/**
 * Return agent file content with its frontmatter `model:` field set to `model`.
 * Pure string transform: everything else (other keys, body, line endings) is
 * preserved byte-for-byte. If the frontmatter has no `model:` line, one is
 * appended at the end of the frontmatter using the file's line ending.
 *
 * @param {string} content - Full agent file text
 * @param {string} model - Configured model
 * @returns {string} Modified content
 * @throws {Error} if model is empty/multi-line or content has no frontmatter block
 */
function applyModelToFrontmatter(content, model) {
  if (typeof content !== 'string') {
    throw new Error('Agent file content must be a string');
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('Model must be a non-empty string');
  }
  if (/[\r\n]/.test(model)) {
    throw new Error('Model must be a single line');
  }
  const m = content.match(/^(---(\r?\n))([\s\S]*?)(\r?\n---)/);
  if (!m) {
    throw new Error('Agent file has no YAML frontmatter block (expected leading --- ... ---)');
  }
  const eol = m[2];
  const line = `model: ${formatYamlScalar(model.trim())}`;
  const body = m[3];
  const hasModel = /^model:[^\r\n]*/m.test(body);
  const newBody = hasModel ? body.replace(/^model:[^\r\n]*/m, () => line) : body + eol + line;
  return m[1] + newBody + m[4] + content.slice(m[0].length);
}

/**
 * Copy mode installation: materialise an install set under `targetDir`.
 *
 * - Directories in the set are created (recursively) under targetDir.
 * - `agents/<id>.md` and `pi/agents/<id>.md` are written with their
 *   frontmatter `model:` set to `models[id]` (applyModelToFrontmatter).
 * - Every other file is copied byte-for-byte.
 * - Existing-install detection / overwrite policy is NOT handled here.
 *
 * @param {string} sourceDir - Plugin source root
 * @param {string} targetDir - Plugin install directory (e.g. <skills>/five-role-team)
 * @param {{path: string, type: 'file'|'dir'}[]} installSet - From buildInstallSet
 * @param {Object<string,string>} models - Agent id to model
 * @returns {{target: string, files: string[], dirs: string[]}} Relative paths written
 * @throws {Error} with a clear message on any failure
 */
function copyInstall(sourceDir, targetDir, installSet, models) {
  if (typeof sourceDir !== 'string' || sourceDir.trim().length === 0) {
    throw new Error('Plugin source directory is required');
  }
  if (typeof targetDir !== 'string' || targetDir.trim().length === 0) {
    throw new Error('Installation target directory is required');
  }
  if (!Array.isArray(installSet)) {
    throw new Error('Install set must be an array');
  }
  const root = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  if (target === root) {
    throw new Error(`Cannot install to ${target}: target is the plugin source directory`);
  }
  const modelMap = models || {};
  const agentRe = /^(?:pi\/)?agents\/([^/]+)\.md$/;
  const written = { target, files: [], dirs: [] };

  try {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of installSet) {
      const rel = entry.path;
      const parts = rel.split('/');
      if (path.isAbsolute(rel) || parts.includes('..')) {
        throw new Error(`Invalid install path: ${rel}`);
      }
      const src = path.join(root, ...parts);
      const dest = path.join(target, ...parts);
      if (entry.type === 'dir') {
        fs.mkdirSync(dest, { recursive: true });
        written.dirs.push(rel);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const agent = rel.match(agentRe);
      if (agent) {
        const model = modelMap[agent[1]];
        if (!model) throw new Error(`No model configured for agent ${agent[1]}`);
        const content = fs.readFileSync(src, 'utf8');
        fs.writeFileSync(dest, applyModelToFrontmatter(content, model));
      } else {
        fs.copyFileSync(src, dest);
      }
      written.files.push(rel);
    }
  } catch (err) {
    if (err && /^(Invalid install path|No model configured|Agent file|Model must)/.test(err.message)) throw err;
    throw new Error(`Copy installation failed: ${describeFsError(err)}`);
  }
  return written;
}

/** File name of the per-install configuration (design.md Decision 8). */
const AGENT_CONFIG_FILE = '.agent-config.json';

/**
 * Write the configuration file (`.agent-config.json`) into an installed plugin
 * directory. The file is created exclusively (`wx`): it is never silently
 * overwritten, so a stale file left in the target is reported as an error.
 *
 * For pi global installs the secondary symlink points at this directory, so
 * the same file is visible at ~/.pi/agent/skills/five-role-team/ without a
 * second write.
 *
 * @param {string} targetDir - Installed plugin directory (copy mode; must exist)
 * @param {object} config - Structure from agent-config.js buildAgentConfig
 * @returns {{path: string}} Absolute path of the written file
 * @throws {Error} with a clear message on any failure
 */
function writeAgentConfigFile(targetDir, config) {
  if (typeof targetDir !== 'string' || targetDir.trim().length === 0) {
    throw new Error('Installation target directory is required');
  }
  if (config === null || typeof config !== 'object') {
    throw new Error('Agent config must be an object');
  }
  const dir = path.resolve(targetDir);
  const file = path.join(dir, AGENT_CONFIG_FILE);
  let st;
  try {
    st = fs.statSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Cannot write configuration file: ${dir} does not exist`);
    }
    throw new Error(`Cannot write configuration file: cannot access ${dir}: ${describeFsError(err)}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Cannot write configuration file: ${dir} is not a directory`);
  }
  try {
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`Cannot write configuration file: ${file} already exists`);
    }
    throw new Error(`Cannot write configuration file ${file}: ${describeFsError(err)}`);
  }
  return { path: file };
}

/**
 * Files that uninstall removes from an installed plugin directory (task 6.3).
 * Holds file names only, relative to the plugin directory.
 */
const UNINSTALL_CLEANUP_FILES = Object.freeze([AGENT_CONFIG_FILE]);

/**
 * Remove one cleanup file from a plugin directory. Missing file is not an error.
 * A symlink or non-regular entry under that name is refused, never followed.
 *
 * @returns {boolean} true if the file was removed, false if it did not exist
 * @throws {Error} with a clear message on any failure
 */
function removeCleanupFile(dir, name) {
  const file = path.join(dir, name);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st) return false;
  if (!st.isFile()) {
    throw new Error(`Refusing to remove ${file}: not a regular file`);
  }
  try {
    fs.unlinkSync(file);
  } catch (err) {
    throw new Error(`Failed to remove ${file}: ${err.message}`);
  }
  return true;
}

/**
 * Remove every file in UNINSTALL_CLEANUP_FILES from an installed plugin
 * directory. Only those names are touched; nothing else in the directory is
 * removed here. A missing directory has nothing to clean and returns [].
 * A symlinked target (a --link install) is never followed: it returns [] and
 * nothing in the link target is touched.
 *
 * @param {string} targetDir - Installed plugin directory
 * @returns {string[]} Absolute paths of the files that were removed
 * @throws {Error} with a clear message on any failure
 */
function removeUninstallCleanupFiles(targetDir) {
  if (typeof targetDir !== 'string' || targetDir.trim().length === 0) {
    throw new Error('Installation target directory is required');
  }
  const dir = path.resolve(targetDir);
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st) return [];
  if (st.isSymbolicLink()) return []; // --link install: never follow into the source tree
  if (!st.isDirectory()) {
    throw new Error(`Cannot clean up ${dir}: not a directory`);
  }
  const removed = [];
  for (const name of UNINSTALL_CLEANUP_FILES) {
    if (removeCleanupFile(dir, name)) removed.push(path.join(dir, name));
  }
  return removed;
}

/**
 * Uninstall the primary installation at `target` (task 7.1). The installation
 * kind is detected without following symlinks and removal follows the design
 * (Decision 11):
 * - symlink (`--link` install): only the link is unlinked. The source it points
 *   at is never followed, read or deleted.
 * - directory (copy install): the UNINSTALL_CLEANUP_FILES are removed first
 *   (removeUninstallCleanupFiles, which must only run for copy installs), then
 *   the directory is removed recursively. Nested symlinks are unlinked, not
 *   followed.
 * - nothing at the path: throws (nothing to uninstall).
 * - any other entry (e.g. a regular file): refused, nothing is removed.
 *
 * Safety checks come from checkRemovable: the path must be named
 * `five-role-team`, must equal `opts.expected` when given, must neither be
 * nor contain `opts.sourceDir` (required), and must neither be nor contain any
 * `opts.protect` skills directory. The parent directory is never removed here.
 *
 * @param {string} target - Primary installed plugin path (from resolveHarnessPath)
 * @param {object} opts - `sourceDir` (required), `expected`, `protect` (see checkRemovable)
 * @returns {{kind: 'symlink'|'directory', path: string, linkTarget?: string, cleaned: string[]}}
 * @throws {Error} with a clear message; nothing is removed on a refusal
 */
function uninstallInstall(target, opts = {}) {
  const checked = checkRemovable(target, opts);
  if (!checked) {
    throw new Error(`Nothing to uninstall: no five-role-team installation at ${path.resolve(target)}`);
  }
  const { abs, existing } = checked;
  if (existing.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(abs);
    try {
      fs.unlinkSync(abs);
    } catch (err) {
      throw new Error(`Failed to remove symlink ${abs}: ${err.message}`);
    }
    return { kind: 'symlink', path: abs, linkTarget, cleaned: [] };
  }
  if (!existing.isDirectory()) {
    throw new Error(`Refusing to remove ${abs}: not a directory or symlink`);
  }
  const cleaned = removeUninstallCleanupFiles(abs);
  try {
    fs.rmSync(abs, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to remove installation ${abs}: ${err.message}`);
  }
  return { kind: 'directory', path: abs, cleaned };
}

/**
 * Remove the pi secondary symlink (~/.pi/agent/skills/five-role-team) during
 * uninstall (task 7.2, design Decision 11). The install creates it pointing at
 * the primary install, so only a symlink that resolves to `primary` is ours.
 *
 * - nothing at `secondary` (or no secondary, e.g. claude-code or local pi): null.
 * - a symlink whose target resolves to `primary`: unlinked, never followed. The
 *   comparison is textual, so a dangling link (primary already removed) is
 *   still recognised and removed.
 * - a real directory or file there, or a symlink to some other location: left
 *   untouched and reported as `kept` with the reason.
 *
 * @param {string} primary - Primary installed plugin path (from resolveHarnessPath)
 * @param {string|null} secondary - Secondary link path (from resolveHarnessPath)
 * @returns {{kind: 'symlink', path: string, linkTarget: string}|{kind: 'kept', path: string, reason: string}|null}
 * @throws {Error} with a clear message if the symlink cannot be removed
 */
function uninstallPiSecondary(primary, secondary) {
  if (!secondary) return null;
  if (typeof primary !== 'string' || primary.trim().length === 0) {
    throw new Error('Primary installation path is required');
  }
  const abs = path.resolve(secondary);
  if (path.basename(abs) !== 'five-role-team') {
    throw new Error(`Refusing to remove ${abs}: not a five-role-team installation path`);
  }
  let st;
  try {
    st = fs.lstatSync(abs, { throwIfNoEntry: false });
  } catch (err) {
    // ENOTDIR: a parent path component is a regular file, so nothing is there.
    if (err.code === 'ENOTDIR') return null;
    throw err;
  }
  if (!st) return null;
  if (!st.isSymbolicLink()) {
    return { kind: 'kept', path: abs, reason: 'it is not a symlink' };
  }
  const linkTarget = fs.readlinkSync(abs);
  if (path.resolve(path.dirname(abs), linkTarget) !== path.resolve(primary)) {
    return { kind: 'kept', path: abs, reason: `it links to ${linkTarget}, not to the installed plugin` };
  }
  try {
    fs.unlinkSync(abs);
  } catch (err) {
    throw new Error(`Failed to remove symlink ${abs}: ${err.message}`);
  }
  return { kind: 'symlink', path: abs, linkTarget };
}

/**
 * Symlink mode installation: create a single symlink at `targetDir` pointing
 * at the plugin source directory (spec: "a symlink is created at
 * ~/.claude/skills/five-role-team/ pointing to the source directory").
 *
 * The whole source directory is exposed, so agent selection and model
 * configuration cannot be applied (rewriting a linked agent file would modify
 * the source). The caller is expected to tell the user.
 * - Never overwrites or removes anything: if `targetDir` exists in any form
 *   (file, directory, symlink, dangling symlink) this throws.
 * - The parent directory of targetDir must already exist (ensureInstallDirectories).
 *
 * @param {string} sourceDir - Plugin source root (must contain SKILL.md)
 * @param {string} targetDir - Path where the symlink is created
 * @returns {{target: string, source: string}} Absolute link path and link destination
 * @throws {Error} with a clear message on any failure
 */
function linkInstall(sourceDir, targetDir) {
  if (typeof sourceDir !== 'string' || sourceDir.trim().length === 0) {
    throw new Error('Plugin source directory is required');
  }
  if (typeof targetDir !== 'string' || targetDir.trim().length === 0) {
    throw new Error('Installation target directory is required');
  }
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error(`Not a plugin source directory: SKILL.md not found in ${source}`);
  }
  if (target === source || target.startsWith(source + path.sep)) {
    throw new Error(`Cannot link ${target}: target is inside the plugin source directory`);
  }
  if (fs.lstatSync(target, { throwIfNoEntry: false })) {
    throw new Error(`Cannot link ${target}: path already exists (remove it first)`);
  }
  try {
    fs.symlinkSync(source, target, 'dir');
  } catch (err) {
    throw new Error(`Symlink installation failed: ${describeFsError(err)}`);
  }
  return { target, source };
}

/**
 * Create the pi secondary symlink (~/.pi/agent/skills/five-role-team) pointing
 * at the primary installed directory (~/.claude/skills/five-role-team).
 *
 * - No-op (returns null) when `secondary` is null/empty (non-pi, local pi, custom).
 * - Never overwrites or removes anything: errors if `secondary` exists in any
 *   form (file, directory, symlink, dangling symlink).
 * - The parent of `secondary` must exist (ensureInstallDirectories).
 *
 * @param {string} primary - Installed plugin path (copy or symlink)
 * @param {string|null} secondary - Path of the symlink to create
 * @returns {{target: string, source: string}|null}
 * @throws {Error} with a clear message on any failure
 */
function linkSecondary(primary, secondary) {
  if (!secondary) return null;
  if (typeof primary !== 'string' || primary.trim().length === 0) {
    throw new Error('Primary installation path is required');
  }
  const source = path.resolve(primary);
  const target = path.resolve(secondary);
  if (!fs.lstatSync(source, { throwIfNoEntry: false })) {
    throw new Error(`Cannot create secondary link ${target}: primary install ${source} does not exist`);
  }
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && existing.isSymbolicLink() &&
      path.resolve(path.dirname(target), fs.readlinkSync(target)) === source) {
    return { target, source, existed: true }; // already the desired link; nothing to change
  }
  if (existing) {
    throw new Error(`Cannot create secondary link ${target}: path already exists (remove it first)`);
  }
  try {
    fs.symlinkSync(source, target, 'dir');
  } catch (err) {
    throw new Error(`Secondary symlink creation failed: ${describeFsError(err)}`);
  }
  return { target, source };
}

/**
 * Describe what exists at `target` without following symlinks.
 *
 * @param {string} target - Path to inspect
 * @returns {{kind: 'directory'|'file'|'symlink'|'dangling-symlink', path: string, linkTarget?: string}|null}
 *   null when nothing exists at the path
 */
function detectExistingInstall(target) {
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new Error('Installation target directory is required');
  }
  const abs = path.resolve(target);
  let st;
  try {
    st = fs.lstatSync(abs, { throwIfNoEntry: false });
  } catch (err) {
    // ENOTDIR: a parent component is a regular file, so nothing is installed here.
    // Return "nothing found" and let the directory validation report the real cause.
    if (err.code === 'ENOTDIR') return null;
    throw err;
  }
  if (!st) return null;
  if (st.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(abs);
    const dangling = !fs.existsSync(abs);
    return { kind: dangling ? 'dangling-symlink' : 'symlink', path: abs, linkTarget };
  }
  return { kind: st.isDirectory() ? 'directory' : 'file', path: abs };
}

/**
 * Detect a pi secondary location that would block linkSecondary: anything at
 * `secondary` that is NOT already a symlink to `primary` (compared textually,
 * so a link to the primary path counts as correct even while the primary is
 * absent or about to be replaced). A correct link is not a conflict.
 *
 * @param {string} primary - Primary installation path
 * @param {string|null} secondary - Secondary link path (null: nothing to check)
 * @returns {{kind: string, path: string, linkTarget?: string}|null}
 */
function detectSecondaryConflict(primary, secondary) {
  if (!secondary) return null;
  const existing = detectExistingInstall(secondary);
  if (!existing) return null;
  if (existing.kind === 'symlink' || existing.kind === 'dangling-symlink') {
    const resolvedLink = path.resolve(path.dirname(existing.path), existing.linkTarget);
    if (resolvedLink === path.resolve(primary)) return null;
  }
  return existing;
}

/**
 * Remove an existing five-role-team installation at `target` (used before an
 * overwrite). Removes ONLY that exact path: a symlink is unlinked (never
 * followed, so its source is untouched); a directory is removed recursively;
 * a plain file is unlinked. Returns false when nothing exists.
 *
 * Refuses (throws, nothing removed) when:
 * - the target is not named `five-role-team`
 * - `expected` is given and the target is not exactly that path
 * - the target equals, or contains, the plugin source directory
 *   (checked lexically and via realpath)
 *
 * @param {string} target - Installed plugin path
 * @param {object} [opts]
 * @param {string} [opts.sourceDir] - Plugin source root to protect
 * @param {string} [opts.expected] - Path produced by resolveHarnessPath
 * @returns {boolean} true if something was removed
 */
function removeExistingInstall(target, opts = {}) {
  const checked = checkRemovable(target, opts);
  if (!checked) return false;
  const { abs, existing } = checked;
  try {
    if (existing.isDirectory()) fs.rmSync(abs, { recursive: true });
    else fs.unlinkSync(abs);
  } catch (err) {
    throw new Error(`Failed to remove existing installation ${abs}: ${describeFsError(err)}`);
  }
  return true;
}

/**
 * Shared safety checks for removing / moving aside an installation path.
 * Throws (nothing is touched) unless every check passes:
 * - the basename of the resolved path is exactly `five-role-team`, so a parent
 *   skills directory (or `/`, `.`, any custom `.../skills`) can never be the target.
 *   Trailing slashes and `..` segments are normalised by path.resolve first.
 * - `opts.expected`, when given, resolves to exactly the same path.
 * - `opts.sourceDir` is required. The target must neither be nor contain the
 *   source checkout (lexically, and via realpath for a non-symlink target).
 * - the target must neither be nor contain any path in `opts.protect` (skills
 *   roots such as the harness base or ~/.claude/skills), lexically or via
 *   realpath, so removing it can never take a skills directory with it.
 *
 * @returns {{abs: string, existing: fs.Stats}|null} null when nothing exists at the path
 */
function checkRemovable(target, opts = {}) {
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new Error('Installation target directory is required');
  }
  const abs = path.resolve(target);
  if (path.basename(abs) !== 'five-role-team') {
    throw new Error(`Refusing to remove ${abs}: not a five-role-team installation path`);
  }
  if (opts.expected !== undefined && path.resolve(opts.expected) !== abs) {
    throw new Error(`Refusing to remove ${abs}: does not match the resolved installation path`);
  }
  if (typeof opts.sourceDir !== 'string' || opts.sourceDir.trim().length === 0) {
    throw new Error(`Refusing to remove ${abs}: the plugin source directory is required for the safety check`);
  }
  const existing = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (!existing) return null;

  const contains = (outer, inner) => inner === outer || inner.startsWith(outer + path.sep);
  const realOrNull = (p) => {
    try { return fs.realpathSync(p); } catch (err) { return null; }
  };

  const src = path.resolve(opts.sourceDir);
  let blocked = contains(abs, src);
  if (!blocked && !existing.isSymbolicLink()) {
    const realSrc = realOrNull(src);
    const realAbs = realOrNull(abs);
    blocked = !!(realSrc && realAbs && contains(realAbs, realSrc));
  }
  if (blocked) {
    throw new Error(`Refusing to remove ${abs}: it is, or contains, the plugin source directory`);
  }

  // Where the entry itself sits, with its parents resolved. The entry is never
  // followed, so this is the location that actually gets removed.
  const location = path.join(realOrNull(path.dirname(abs)) || path.dirname(abs), path.basename(abs));
  const protectedRoots = Array.isArray(opts.protect) ? opts.protect : [];
  for (const root of protectedRoots) {
    const lexical = path.resolve(root);
    const real = realOrNull(lexical) || lexical;
    for (const p of [lexical, real]) {
      if (contains(abs, p) || contains(location, p)) {
        throw new Error(`Refusing to remove ${abs}: it is, or contains, the skills directory ${lexical}`);
      }
    }
  }
  return { abs, existing };
}

const BACKUP_PREFIX = '.five-role-team.backup-';

/**
 * Move an existing installation aside to a hidden sibling
 * (`.five-role-team.backup-<pid>-<time>`) instead of deleting it, so a failed
 * reinstall can restore it. Same safety checks as removeExistingInstall; a
 * symlink is renamed itself (never followed).
 *
 * @param {string} target - Installed plugin path
 * @param {object} [opts] - Same as removeExistingInstall
 * @returns {{from: string, backup: string}|null} null when nothing exists
 */
function moveAsideExistingInstall(target, opts = {}) {
  const checked = checkRemovable(target, opts);
  if (!checked) return null;
  const backup = path.join(path.dirname(checked.abs), `${BACKUP_PREFIX}${process.pid}-${Date.now()}`);
  try {
    fs.renameSync(checked.abs, backup);
  } catch (err) {
    throw new Error(`Failed to remove existing installation ${checked.abs}: ${describeFsError(err)}`);
  }
  return { from: checked.abs, backup };
}

/** Delete a backup made by moveAsideExistingInstall (symlinks unlinked, never followed). */
function discardBackup(backup) {
  if (path.basename(backup.backup).indexOf(BACKUP_PREFIX) !== 0 ||
      path.dirname(backup.backup) !== path.dirname(backup.from)) {
    throw new Error(`Refusing to delete ${backup.backup}: not an installer backup`);
  }
  const st = fs.lstatSync(backup.backup, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) fs.rmSync(backup.backup, { recursive: true });
  else fs.unlinkSync(backup.backup);
}

/**
 * Undo a failed installation. Removes only what this run created, in reverse
 * order: secondary link, primary install, then (after restoring a moved-aside
 * previous install) directories this run created, if still empty. Never
 * follows symlinks and never touches the plugin source directory. Failures
 * are collected, not thrown, so they cannot mask the original error.
 *
 * @param {object} state
 * @param {string|null} [state.secondary] - Secondary link created by this run
 * @param {string|null} [state.primary] - Primary path created by this run (it was absent before)
 * @param {{from: string, backup: string}|null} [state.backup] - Previous install moved aside
 * @param {{from: string, backup: string}|null} [state.secondaryBackup] - Previous pi secondary moved aside
 * @param {string[]} [state.createdDirs] - Directories created by this run, outermost first
 * @param {string} [state.sourceDir] - Plugin source to protect
 * @returns {{removed: string[], restored: string|null, errors: string[]}}
 */
function rollbackInstall(state) {
  const out = { removed: [], restored: null, restoredSecondary: null, errors: [] };
  const src = state.sourceDir ? path.resolve(state.sourceDir) : null;
  const contains = (outer, inner) => inner === outer || inner.startsWith(outer + path.sep);
  const attempt = (label, fn) => {
    try { fn(); } catch (err) { out.errors.push(`${label}: ${describeFsError(err)}`); }
  };
  const removePath = (p) => {
    const abs = path.resolve(p);
    if (src && contains(abs, src)) throw new Error('refusing to remove the plugin source directory');
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) fs.rmSync(abs, { recursive: true });
    else fs.unlinkSync(abs);
    out.removed.push(abs);
  };
  if (state.secondary) attempt(`removing ${state.secondary}`, () => removePath(state.secondary));
  if (state.primary) attempt(`removing ${state.primary}`, () => removePath(state.primary));
  if (state.backup) {
    attempt(`restoring ${state.backup.from}`, () => {
      if (fs.lstatSync(state.backup.from, { throwIfNoEntry: false })) {
        throw new Error('path still exists; previous installation kept at ' + state.backup.backup);
      }
      fs.renameSync(state.backup.backup, state.backup.from);
      out.restored = state.backup.from;
    });
  }
  if (state.secondaryBackup) {
    const sb = state.secondaryBackup;
    attempt(`restoring ${sb.from}`, () => {
      if (fs.lstatSync(sb.from, { throwIfNoEntry: false })) {
        throw new Error('path still exists; previous secondary kept at ' + sb.backup);
      }
      fs.renameSync(sb.backup, sb.from);
      out.restoredSecondary = sb.from;
    });
  }
  for (const dir of (state.createdDirs || []).slice().reverse()) {
    attempt(`removing directory ${dir}`, () => {
      const st = fs.lstatSync(dir, { throwIfNoEntry: false });
      if (!st || !st.isDirectory()) return;
      if (src && contains(path.resolve(dir), src)) return;
      if (fs.readdirSync(dir).length > 0) return; // something else lives here now: keep
      fs.rmdirSync(dir);
      out.removed.push(path.resolve(dir));
    });
  }
  return out;
}

module.exports = {
  describeFsError,
  detectExistingInstall,
  detectSecondaryConflict,
  removeExistingInstall,
  moveAsideExistingInstall,
  discardBackup,
  rollbackInstall,
  linkSecondary,
  copyInstall,
  writeAgentConfigFile,
  UNINSTALL_CLEANUP_FILES,
  removeUninstallCleanupFiles,
  uninstallInstall,
  uninstallPiSecondary,
  linkInstall,
  ensureDirectory,
  ensureInstallDirectories,
  buildInstallSet,
  validatePluginSource,
  applyModelToFrontmatter,
};
