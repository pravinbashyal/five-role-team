#!/usr/bin/env node
'use strict';
// Verify task 6.2: save .agent-config.json alongside the installed plugin and
// check that the file is created at the correct location.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const src = __dirname;
// SANDBOXED ONLY: every HOME/cwd change and every install call below runs in
// this temp sandbox. The helper aborts (exit 2) if HOME resolves to the real home.
const sb = createSandbox();

// Fault injection for the config-write rollback check: when FAIL_AFTER_CONFIG
// is set, the real writer runs (file is created) and then the install errors.
// Patched before install.js loads so its destructured import picks it up.
const installFiles = require(path.join(src, 'install-files.js'));
const realWriteConfig = installFiles.writeAgentConfigFile;
installFiles.writeAgentConfigFile = (dir, cfg) => {
  const r = realWriteConfig(dir, cfg);
  if (process.env.FAIL_AFTER_CONFIG === '1') throw new Error('injected failure after config write');
  return r;
};
const { main } = require(path.join(src, 'install.js'));

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
async function run(argv) {
  const out = []; const err = [];
  sb.assertSafe();
  const r = await main(argv, { promptsImpl: noPrompt, log: (m) => out.push(m), error: (m) => err.push(m) });
  return { r, out: out.join('\n'), err: err.join('\n') };
}
function readCfg(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Source copy whose agents/worker.md has no frontmatter, so copyInstall fails
// after SKILL.md/commands/etc. were written (exercises rollback of the config path).
function brokenSource(name) {
  const d = path.join(sb.root, name);
  fs.mkdirSync(d, { recursive: true });
  for (const n of ['SKILL.md', 'commands', 'conventions', '.claude-plugin', 'agents', 'pi']) {
    fs.cpSync(path.join(src, n), path.join(d, n), { recursive: true });
  }
  fs.writeFileSync(path.join(d, 'agents', 'worker.md'), 'no frontmatter here\n');
  return d;
}

(async () => {
  // 1. Global claude-code, copy mode, subset of agents with a custom model.
  {
    const { home } = env('g-claude');
    const { r, out } = await run(['--global', '--harness', 'claude-code',
      '--agents', 'architect,worker,reviewer', '--agent-models', 'worker=sonnet']);
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    const cfgPath = path.join(primary, CFG);
    assert(r.exitCode === 0, 'global claude-code copy exits 0');
    assert(fs.existsSync(cfgPath), 'config created at ~/.claude/skills/five-role-team/.agent-config.json');
    assert(lst(cfgPath) && lst(cfgPath).isFile(), 'config is a regular file (not a link)');
    const cfg = fs.existsSync(cfgPath) ? readCfg(cfgPath) : {};
    assert(JSON.stringify(cfg.agents) === JSON.stringify(['architect', 'worker', 'reviewer']), 'config agents array matches selection');
    assert(cfg.models && Object.keys(cfg.models).join() === 'architect,worker,reviewer', 'config models has one entry per selected agent');
    assert(cfg.models && cfg.models.worker === 'anthropic/claude-sonnet-4-20250514', 'config records expanded custom worker model');
    assert(cfg.harness === 'claude-code', 'config records harness');
    assert(typeof cfg.installedAt === 'string' && !Number.isNaN(Date.parse(cfg.installedAt)), 'config installedAt is an ISO timestamp');
    assert(fs.existsSync(path.join(primary, 'agents', 'designer.md')) === false, 'unselected agent not installed (config consistent with files)');
    assert(out.includes('Saved configuration to ' + cfgPath), 'success output names the config path');
    assert(!fs.existsSync(path.join(home, '.claude', 'skills', CFG)), 'config not written at the skills base directory');
  }

  // 2. Global pi: config in primary; secondary symlink exposes the same file.
  {
    const { home } = env('g-pi');
    const { r } = await run(['--global', '--harness', 'pi', '--agents', 'worker,intern']);
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    const secondary = path.join(home, '.pi', 'agent', 'skills', 'five-role-team');
    const cfgPath = path.join(primary, CFG);
    assert(r.exitCode === 0, 'global pi copy exits 0');
    assert(fs.existsSync(cfgPath), 'pi: config created in ~/.claude/skills/five-role-team/');
    assert(lst(secondary) && lst(secondary).isSymbolicLink(), 'pi: secondary ~/.pi/agent/skills/five-role-team is a symlink');
    const viaSecondary = path.join(secondary, CFG);
    assert(fs.existsSync(viaSecondary) && fs.readFileSync(viaSecondary, 'utf8') === fs.readFileSync(cfgPath, 'utf8'),
      'pi: config visible via secondary symlink with identical content');
    const cfg = fs.existsSync(cfgPath) ? readCfg(cfgPath) : {};
    assert(cfg.harness === 'pi', 'pi: config harness is pi');
    // Config must agree with the installed file it describes (the intern default
    // itself depends on which intern.md is present in the working tree).
    const installedIntern = fs.readFileSync(path.join(primary, 'pi', 'agents', 'intern.md'), 'utf8');
    const installedModel = (installedIntern.match(/^model:[ \t]*(.*?)[ \t]*$/m) || [])[1];
    assert(installedModel && cfg.models && cfg.models.intern === installedModel,
      'pi: config intern model matches the installed pi/agents/intern.md frontmatter');
    assert(!fs.existsSync(path.join(secondary, 'agents', 'designer.md')), 'pi: unselected designer absent via secondary symlink');
    assert(!fs.existsSync(path.join(home, '.pi', 'agent', 'skills', CFG)), 'pi: no stray config at the secondary base');
  }

  // 3. Local claude-code and local pi land under the project directory.
  {
    const { work } = env('l-claude');
    const { r } = await run(['--local', '--harness', 'claude-code', '--agents', 'worker']);
    const cfgPath = path.join(work, '.claude', 'skills', 'five-role-team', CFG);
    assert(r.exitCode === 0 && fs.existsSync(cfgPath), 'local claude-code: config at ./.claude/skills/five-role-team/.agent-config.json');
  }
  {
    const { work } = env('l-pi');
    const { r } = await run(['--local', '--harness', 'pi', '--agents', 'worker']);
    const cfgPath = path.join(work, '.pi', 'skills', 'five-role-team', CFG);
    assert(r.exitCode === 0 && fs.existsSync(cfgPath), 'local pi: config at ./.pi/skills/five-role-team/.agent-config.json');
  }

  // 4. Symlink mode: no config written, and the source checkout is untouched.
  {
    const { home } = env('g-link');
    const before = fs.readdirSync(src).filter((n) => n === CFG);
    const { r, out } = await run(['--global', '--harness', 'claude-code', '--agents', 'worker', '--link']);
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    assert(r.exitCode === 0 && lst(primary).isSymbolicLink(), 'link mode: primary is a symlink');
    assert(!fs.existsSync(path.join(src, CFG)) && before.length === 0, 'link mode: no .agent-config.json written into the source directory');
    assert(!fs.existsSync(path.join(primary, CFG)), 'link mode: no config reachable through the link');
    assert(out.includes('no .agent-config.json is written in symlink mode'), 'link mode: user is told config is not written');
  }

  // 5. Rollback: a failure in the write phase removes the config with the rest.
  {
    const { home } = env('g-rollback');
    const broken = brokenSource('broken-src');
    const errs = [];
    sb.assertSafe();
    const res = await main(['--global', '--harness', 'pi', '--agents', 'worker'], {
      promptsImpl: noPrompt, sourceDir: broken, log: () => {}, error: (m) => errs.push(m),
    });
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    assert(res.exitCode === 1, 'rollback: broken source fails with exit 1');
    assert(!fs.existsSync(path.join(primary, CFG)), 'rollback: no .agent-config.json left behind');
    assert(!fs.existsSync(primary), 'rollback: partial plugin directory removed');
    assert(lst(path.join(home, '.pi', 'agent', 'skills', 'five-role-team')) === undefined, 'rollback: no pi secondary left behind');
  }

  // 6. Rollback after the config was actually written: the config goes with the install.
  {
    const { home } = env('g-rollback-cfg');
    process.env.FAIL_AFTER_CONFIG = '1';
    let res;
    try {
      sb.assertSafe();
      res = await main(['--global', '--harness', 'pi', '--agents', 'worker'], {
        promptsImpl: noPrompt, log: () => {}, error: () => {},
      });
    } finally {
      delete process.env.FAIL_AFTER_CONFIG;
    }
    const primary = path.join(home, '.claude', 'skills', 'five-role-team');
    assert(res.exitCode === 1, 'rollback after config write: install fails with exit 1');
    assert(!fs.existsSync(path.join(primary, CFG)), 'rollback after config write: .agent-config.json removed');
    assert(!fs.existsSync(primary), 'rollback after config write: plugin directory removed');
  }

})().catch((e) => { console.error('FAIL: unexpected error', e); failed += 1; }).finally(() => {
  sb.cleanup();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll task 6.2 checks passed');
});
