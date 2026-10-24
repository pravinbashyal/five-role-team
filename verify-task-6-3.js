#!/usr/bin/env node
'use strict';
// Verify task 6.3: .agent-config.json is registered in the uninstall cleanup
// list, and the cleanup helper removes it from an installed plugin directory
// while leaving the rest of the installation alone.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const src = __dirname;
// SANDBOXED ONLY: every HOME/cwd change and every install/cleanup call below runs
// in this temp sandbox. The helper aborts (exit 2) if HOME resolves to the real home.
const sb = createSandbox();

const installFiles = require(path.join(src, 'install-files.js'));
const { main } = require(path.join(src, 'install.js'));
const { UNINSTALL_CLEANUP_FILES, removeUninstallCleanupFiles } = installFiles;

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });
const noPrompt = async () => { throw new Error('prompted'); };
const CFG = '.agent-config.json';

// Points HOME/USERPROFILE and the cwd at this scenario's sandbox folders (guarded).
function env(name) {
  const sc = sb.scenario(name);
  sb.enter(sc);
  return { home: sc.home, work: sc.cwd };
}
async function install(argv) {
  sb.assertSafe();
  const r = await main(argv, { promptsImpl: noPrompt, log: () => {}, error: () => {} });
  return r;
}
// Every removal call goes through the same check before it runs.
function cleanupTarget(target) {
  sb.assertSafe();
  return removeUninstallCleanupFiles(target);
}
function throwsWith(fn, re) {
  try { fn(); return false; } catch (err) { return re.test(err.message); }
}

(async () => {
  // 1. The cleanup list registers the configuration file exactly.
  assert(Array.isArray(UNINSTALL_CLEANUP_FILES) && UNINSTALL_CLEANUP_FILES.length === 1 &&
    UNINSTALL_CLEANUP_FILES[0] === CFG, 'cleanup list contains exactly .agent-config.json');
  assert(Object.isFrozen(UNINSTALL_CLEANUP_FILES), 'cleanup list is frozen');

  // 2. Installed copy-mode plugin: helper removes the config written by 6.2.
  {
    const { home } = env('g-claude');
    const r = await install(['--global', '--harness', 'claude-code', '--agents', 'architect,worker']);
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    const cfgPath = path.join(primary, CFG);
    assert(r.exitCode === 0 && fs.existsSync(cfgPath), 'setup: global install wrote .agent-config.json');
    const removed = cleanupTarget(primary);
    assert(removed.length === 1 && removed[0] === cfgPath, 'helper reports the config path as removed');
    assert(lst(cfgPath) === undefined, '.agent-config.json is gone after cleanup');
    assert(fs.existsSync(path.join(primary, 'SKILL.md')), 'SKILL.md left in place (helper removes only the cleanup list)');
    assert(fs.existsSync(path.join(primary, 'agents', 'worker.md')), 'selected agent files left in place');
    const again = cleanupTarget(primary);
    assert(Array.isArray(again) && again.length === 0, 'second cleanup is a no-op returning []');
  }

  // 3. Pi global: the secondary symlink exposes the same directory, so the
  //    config disappears from the secondary location as well.
  {
    const { home } = env('g-pi');
    const r = await install(['--global', '--harness', 'pi', '--agents', 'worker']);
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    const secondary = path.join(home, '.pi', 'agent', 'skills', 'five-role-team');
    assert(r.exitCode === 0 && fs.existsSync(path.join(secondary, CFG)), 'setup: pi config visible via secondary');
    cleanupTarget(primary);
    assert(!fs.existsSync(path.join(primary, CFG)) && !fs.existsSync(path.join(secondary, CFG)),
      'pi: config absent from primary and from secondary after cleanup');
  }

  // 4. Missing target directory: nothing to clean, no error.
  {
    const { work } = env('missing');
    const missing = path.join(work, 'nope', 'five-role-team');
    const removed = cleanupTarget(missing);
    assert(Array.isArray(removed) && removed.length === 0, 'missing target directory returns []');
    assert(lst(missing) === undefined, 'missing target directory is not created');
  }

  // 5. A symlink named like the config is refused and its target is untouched.
  {
    const { work } = env('symlink-cfg');
    const dir = path.join(work, 'plugin');
    fs.mkdirSync(dir, { recursive: true });
    const victim = path.join(work, 'victim.txt');
    fs.writeFileSync(victim, 'keep me\n');
    fs.symlinkSync(victim, path.join(dir, CFG));
    assert(throwsWith(() => cleanupTarget(dir), /not a regular file/),
      'symlink named .agent-config.json is refused with a clear error');
    assert(lst(path.join(dir, CFG)) && lst(path.join(dir, CFG)).isSymbolicLink(), 'refused symlink is still in place');
    assert(fs.readFileSync(victim, 'utf8') === 'keep me\n', 'symlink target was not removed or modified');
  }

  // 6. A directory named like the config is refused and kept.
  {
    const { work } = env('dir-cfg');
    const dir = path.join(work, 'plugin');
    fs.mkdirSync(path.join(dir, CFG), { recursive: true });
    assert(throwsWith(() => cleanupTarget(dir), /not a regular file/),
      'directory named .agent-config.json is refused with a clear error');
    assert(lst(path.join(dir, CFG)) && lst(path.join(dir, CFG)).isDirectory(), 'refused directory is kept');
  }

  // 7. Bad input is rejected before touching the filesystem.
  {
    assert(throwsWith(() => cleanupTarget(''), /target directory is required/),
      'empty target directory is rejected');
    assert(throwsWith(() => cleanupTarget(undefined), /target directory is required/),
      'undefined target directory is rejected');
  }

  // 7b. A symlinked target (--link install) is never followed: returns [] and
  //     the link target's contents, including a config file, are untouched.
  {
    const { work } = env('symlink-target');
    const source = path.join(work, 'source-checkout');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), 'skill\n');
    const cfgInSource = path.join(source, CFG);
    fs.writeFileSync(cfgInSource, '{"keep":true}\n');
    const link = path.join(work, 'five-role-team');
    fs.symlinkSync(source, link, 'dir');
    let removed;
    let threw = false;
    try { removed = cleanupTarget(link); } catch (err) { threw = true; }
    assert(!threw && Array.isArray(removed) && removed.length === 0, 'symlinked target returns []');
    assert(lst(link) && lst(link).isSymbolicLink(), 'symlinked target is left in place');
    assert(fs.existsSync(cfgInSource) && fs.readFileSync(cfgInSource, 'utf8') === '{"keep":true}\n',
      'link target config file is not removed or modified');
    assert(fs.existsSync(path.join(source, 'SKILL.md')), 'link target contents are untouched');
  }

  // 8. A regular file at the target path is not a plugin directory.
  {
    const { work } = env('file-target');
    const f = path.join(work, 'five-role-team');
    fs.writeFileSync(f, 'x\n');
    assert(throwsWith(() => cleanupTarget(f), /not a directory/),
      'regular file as target is rejected');
    assert(fs.existsSync(f), 'regular file at target is untouched');
  }

})().catch((e) => { console.error('FAIL: unexpected error', e); failed += 1; }).finally(() => {
  sb.cleanup();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll task 6.3 checks passed');
});
