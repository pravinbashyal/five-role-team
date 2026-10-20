#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-3-'));
const fakeHome = path.join(tmpRoot, 'home');
fs.mkdirSync(fakeHome);
// Redirect os.homedir() so the real home directory is never touched.
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;

const { buildInstallSet } = require('./install-files.js');

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
function throws(fn, re) {
  try { fn(); } catch (e) { return re.test(e.message) && !/\n\s+at /.test(e.message); }
  return false;
}
function write(rel, content) {
  const p = path.join(src, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content || 'x');
}

// Fake plugin source tree, including things that must never be installed.
const src = path.join(tmpRoot, 'src');
write('SKILL.md');
write('README.md');
write('package.json');
write('install.js');
write('install-files.js');
write('verify-task-5-3.js');
write('test-parse-args.js');
write('.claude-plugin/plugin.json', '{}');
write('.claude-plugin/marketplace.json', '{}');
write('commands/apply.md');
write('commands/explore.md');
write('conventions/review-comments.md');
write('openspec/changes/x/tasks.md');
write('.git/HEAD');
write('node_modules/prompts/index.js');
write('.claude/settings.json');
write('.pi/settings.json');
write('.DS_Store');
for (const id of ['architect', 'designer', 'worker', 'reviewer', 'supervisor']) write(`agents/${id}.md`);
write('pi/agents/intern.md');

const paths = (set) => set.map((e) => e.path);
const before = JSON.stringify(fs.readdirSync(src).sort());

try {
  // Subset, claude-code
  let set = buildInstallSet(src, ['architect', 'worker'], 'claude-code');
  let p = paths(set);
  assert(p.includes('agents/architect.md') && p.includes('agents/worker.md'), 'selected agents included');
  assert(!p.includes('agents/designer.md'), 'unselected designer excluded');
  assert(!p.includes('agents/reviewer.md') && !p.includes('agents/supervisor.md'), 'unselected reviewer/supervisor excluded');
  assert(p.includes('agents') && set.find((e) => e.path === 'agents').type === 'dir', 'agents/ directory entry present');
  assert(!p.some((x) => x === 'pi' || x.startsWith('pi/')), 'claude-code: pi/ excluded');

  // Non-agent contents
  assert(p.includes('SKILL.md'), 'SKILL.md included');
  assert(p.includes('.claude-plugin/plugin.json') && p.includes('.claude-plugin/marketplace.json'), 'plugin manifest included');
  assert(p.includes('commands/apply.md') && p.includes('commands/explore.md'), 'commands included');
  assert(p.includes('conventions/review-comments.md'), 'conventions included');
  const bad = p.filter((x) => /^(openspec|\.git|node_modules|\.claude|\.pi)(\/|$)/.test(x) || /^(verify-task-|test-).*\.js$/.test(x) || x === '.DS_Store' || x === 'README.md' || x === 'package.json' || /^install.*\.js$/.test(x));
  assert(bad.length === 0, 'excluded: openspec, .git, node_modules, .claude/, .pi/, scratch scripts, installer files' + (bad.length ? ' (found ' + bad.join(',') + ')' : ''));
  assert(set.every((e) => !path.isAbsolute(e.path)), 'paths are relative to source');
  assert(p.indexOf('commands') < p.indexOf('commands/apply.md'), 'parent directories listed before children');

  // All agents + pi
  set = buildInstallSet(src, ['architect', 'designer', 'worker', 'reviewer', 'supervisor', 'intern'], 'pi');
  p = paths(set);
  assert(['architect', 'designer', 'worker', 'reviewer', 'supervisor'].every((id) => p.includes(`agents/${id}.md`)), 'all agents selected: all agent files included');
  assert(p.includes('pi') && p.includes('pi/agents') && p.includes('pi/agents/intern.md'), 'pi: pi/agents/intern.md included when selected');

  // pi with intern deselected
  p = paths(buildInstallSet(src, ['worker'], 'pi'));
  assert(!p.includes('pi/agents/intern.md') && p.includes('agents/worker.md'), 'pi: unselected intern excluded');

  // Intern selected but harness not pi
  p = paths(buildInstallSet(src, ['worker', 'intern'], '/custom/skills'));
  assert(!p.some((x) => x.startsWith('pi')), 'custom non-pi path: pi/ excluded even if intern selected');

  // Empty selection
  p = paths(buildInstallSet(src, [], 'claude-code'));
  assert(!p.some((x) => /^agents\/.+/.test(x)) && p.includes('SKILL.md'), 'empty selection: no agent files, rest intact');

  // Nothing copied or written
  assert(JSON.stringify(fs.readdirSync(src).sort()) === before, 'source tree unchanged');
  assert(!fs.existsSync(path.join(fakeHome, '.claude')) && fs.readdirSync(fakeHome).length === 0, 'nothing written to (temp) home');

  // Real repo source: sanity check
  const repo = buildInstallSet(__dirname, ['worker'], 'claude-code').map((e) => e.path);
  assert(repo.includes('agents/worker.md') && !repo.includes('agents/architect.md') && !repo.some((x) => x.startsWith('openspec')), 'real repo: only selected agent, no openspec');

  // Errors
  assert(throws(() => buildInstallSet('', ['a'], 'pi'), /required/), 'empty source: clear error');
  assert(throws(() => buildInstallSet(tmpRoot, ['a'], 'pi'), /Not a plugin source directory/), 'non-plugin dir: clear error');
  assert(throws(() => buildInstallSet(src, 'worker', 'pi'), /must be an array/), 'non-array selection: clear error');
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

process.exit(failed ? 1 : 0);
