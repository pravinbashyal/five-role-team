#!/usr/bin/env node
'use strict';
// Shared matrix and plugin-source definitions for the install/uninstall verify scripts:
// test-install-modes.js, test-uninstall-modes.js, verify-task-8-3.js, verify-task-8-4.js,
// verify-task-9-1.js .. verify-task-9-4.js. The values and helpers here are the ones those
// scripts previously each carried inline.
//
// SINGLE SOURCE OF TRUTH: when install.js gains a new local module (a file it loads from its own
// directory), add the file name to SOURCE_ENTRIES below and to nowhere else. Every plugin-source
// copy made by these scripts is built from that list.
//
// Coverage guards are not defined here. test-install-modes.js and test-uninstall-modes.js each keep
// their own literal EXPECTED_AXES and EXPECTED_CELLS and compare MATRIX_AXES against them, so an
// edit to the axes in this file, or a dropped cell, still fails those scripts.
//
// Pure helpers only: requiring this file creates no sandbox and runs no process.
const fs = require('fs');
const path = require('path');

// The plugin checkout this file sits in.
const REPO_ROOT = __dirname;

// Entries of the plugin source that an install needs. See the header: edit only here.
const SOURCE_ENTRIES = Object.freeze(['SKILL.md', 'agents', 'pi', 'commands', 'conventions', '.claude-plugin',
  'install.js', 'install-files.js', 'select-agents.js', 'configure-models.js', 'agent-config.js']);

// Copy SOURCE_ENTRIES from srcDir into destDir. No node_modules link is made.
function copySourceEntries(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of SOURCE_ENTRIES) {
    fs.cpSync(path.join(srcDir, name), path.join(destDir, name), { recursive: true });
  }
}

// Copy SOURCE_ENTRIES from srcDir (default: this checkout) into destDir, then link this checkout's
// node_modules into destDir so the `prompts` dependency resolves. The link always points at
// REPO_ROOT, never at the copied source.
function copyPluginSource(destDir, srcDir = REPO_ROOT) {
  copySourceEntries(srcDir, destDir);
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(destDir, 'node_modules'), 'dir');
}

// Axis values for the 16-cell matrix: scope x harness x mode x agents.
const MATRIX_AXES = Object.freeze({
  scope: ['global', 'local'],
  harness: ['pi', 'claude-code'],
  mode: ['copy', 'link'],
  agents: ['all', 'subset'],
});

// Agents installed by the "subset" cells (--agents), and the --agent-models override that the
// "all" cells apply.
const SUBSET = Object.freeze(['architect', 'worker', 'reviewer']);
const OVERRIDE = Object.freeze({ agent: 'worker', model: 'sonnet' });

// Expand axis values into cells. Each cell carries its key, e.g. "global/pi/copy/all".
function cellsFrom(axes) {
  const out = [];
  for (const scope of axes.scope) {
    for (const harness of axes.harness) {
      for (const mode of axes.mode) {
        for (const agents of axes.agents) {
          out.push({ scope, harness, mode, agents, key: `${scope}/${harness}/${mode}/${agents}` });
        }
      }
    }
  }
  return out;
}

const MATRIX = cellsFrom(MATRIX_AXES);

// Scope and harness of the global claude-code install (the common primary location).
const GLOBAL_CLAUDE_CODE = Object.freeze({ scope: 'global', harness: 'claude-code' });

// argv for `install.js` in a cell. `src` is the plugin source directory that holds install.js.
function installArgv(src, cell) {
  const argv = [path.join(src, 'install.js'), cell.scope === 'global' ? '--global' : '--local',
    '--harness', cell.harness];
  if (cell.mode === 'link') argv.push('--link');
  if (cell.agents === 'all') argv.push('--agent-models', `${OVERRIDE.agent}=${OVERRIDE.model}`);
  else argv.push('--agents', SUBSET.join(','));
  return argv;
}

// argv for `install.js uninstall` in a cell.
function uninstallArgv(src, cell) {
  return [path.join(src, 'install.js'), 'uninstall', cell.scope === 'global' ? '--global' : '--local',
    '--harness', cell.harness];
}

// Primary install directory for a cell. `sc` supplies home and cwd (a sandbox or scenario).
function primaryPath(sc, cell) {
  return cell.scope === 'global'
    ? path.join(sc.home, '.claude', 'skills', 'five-role-team')
    : path.join(sc.cwd, cell.harness === 'pi' ? '.pi' : '.claude', 'skills', 'five-role-team');
}

// The pi global secondary symlink under ~/.pi/agent/skills (install.js resolveHarnessPath), or null
// for every other cell. Use piSecondaryPath() to look at that location regardless of the cell.
function secondaryPath(sc, cell) {
  return cell.scope === 'global' && cell.harness === 'pi' ? piSecondaryPath(sc.home) : null;
}

// ~/.pi/agent/skills/five-role-team under the given home.
function piSecondaryPath(home) {
  return path.join(home, '.pi', 'agent', 'skills', 'five-role-team');
}

module.exports = {
  REPO_ROOT,
  SOURCE_ENTRIES,
  copySourceEntries,
  copyPluginSource,
  MATRIX_AXES,
  SUBSET,
  OVERRIDE,
  cellsFrom,
  MATRIX,
  GLOBAL_CLAUDE_CODE,
  installArgv,
  uninstallArgv,
  primaryPath,
  secondaryPath,
  piSecondaryPath,
};
