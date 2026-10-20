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
  if (files.length === 0 && !addParent) {
    // Keep agents/ itself so the installed layout is stable even when empty.
    entries.push({ path: rel, type: 'dir' });
    return;
  }
  if (addParent) entries.push({ path: 'pi', type: 'dir' });
  entries.push({ path: rel, type: 'dir' });
  for (const n of files) entries.push({ path: `${rel}/${n}`, type: 'file' });
}

module.exports = {
  ensureDirectory,
  ensureInstallDirectories,
  buildInstallSet,
};
