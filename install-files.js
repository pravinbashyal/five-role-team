'use strict';

const fs = require('fs');
const path = require('path');
const { isPiHarness } = require('./select-agents');

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
 * @returns {{path: string, created: boolean}} Absolute path and whether it was created
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
      throw new Error(`Cannot access ${target}: ${err.message}`);
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
  let ancestor = path.dirname(target);
  for (;;) {
    let ancestorStat = null;
    try {
      ancestorStat = fs.statSync(ancestor);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
        throw new Error(`Cannot access ${ancestor}: ${err.message}`);
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
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }

  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create ${target}: ${err.message}`);
  }
  return { path: target, created: true };
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
 * @returns {{created: string[], existing: string[]}} Absolute directory paths by outcome
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
  for (const dir of dirs) {
    const r = ensureDirectory(dir);
    (r.created ? created : existing).push(r.path);
  }
  return { created, existing };
}

/**
 * Top-level plugin entries that are part of an installation (allowlist taken
 * from design.md "Context": SKILL.md, agents/, commands/, conventions/,
 * .claude-plugin/). Anything not listed here (openspec/, .git, node_modules,
 * .claude/, .pi/, verify-task-*.js / test-*.js scratch scripts, installer
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
    throw new Error(`Copy installation failed: ${err.message}`);
  }
  return written;
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
    throw new Error(`Symlink installation failed: ${err.message}`);
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
    throw new Error(`Secondary symlink creation failed: ${err.message}`);
  }
  return { target, source };
}

module.exports = {
  linkSecondary,
  copyInstall,
  linkInstall,
  ensureDirectory,
  ensureInstallDirectories,
  buildInstallSet,
  applyModelToFrontmatter,
};
