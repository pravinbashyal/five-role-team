'use strict';

const fs = require('fs');
const path = require('path');

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

module.exports = {
  ensureDirectory,
  ensureInstallDirectories,
};
