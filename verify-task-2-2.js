#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const INSTALL = path.join(__dirname, 'install.js');

const sb = createSandbox();
let failed = 0;
function assert(c, m) { if (c) console.log('OK:', m); else { console.error('FAIL:', m); failed += 1; } }

(async () => {
  try {
    // flag-driven full flags
    {
      const sc = sb.scenario('flags');
      const r = sb.run([INSTALL, 'install', '--local', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], { home: sc.home, cwd: sc.cwd });
      assert(r.status === 0, `flag-driven install exits 0 (got ${r.status})`);
      assert(fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'flag-driven placed SKILL.md');
    }

    // non-TTY hints
    {
      const sc = sb.scenario('notty-scope');
      const r = sb.run([INSTALL, 'install', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], { home: sc.home, cwd: sc.cwd });
      assert(r.status === 1, `non-TTY missing scope exits 1 (got ${r.status})`);
      assert(/--global/.test(r.stderr) && /--local/.test(r.stderr), 'scope hint names --global/--local');
    }
    {
      const sc = sb.scenario('notty-harness');
      const r = sb.run([INSTALL, 'install', '--global', '--agents', 'worker', '--agent-models', 'worker=sonnet'], { home: sc.home, cwd: sc.cwd });
      assert(r.status === 1, `non-TTY missing harness exits 1 (got ${r.status})`);
      assert(/--harness/.test(r.stderr), 'harness hint names --harness');
    }
    {
      const sc = sb.scenario('notty-both');
      const r = sb.run([INSTALL, 'install'], { home: sc.home, cwd: sc.cwd });
      assert(r.status === 1, `non-TTY install with no flags exits 1 (got ${r.status})`);
    }

    // real TTY signal drives interactivity
    {
      const sc = sb.scenario('real-tty');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const orig = process.stdin.isTTY;
      let asked = [];
      let res;
      try {
        process.stdin.isTTY = true;
        res = await main(['install', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
          promptsImpl: async (q) => { asked.push(q.name); if (q.name === 'scope') { if (Array.isArray(q.choices)) assert(q.choices.map(c=>c.value).includes('global') && q.choices.map(c=>c.value).includes('local'), 'scope choices global/local'); return { scope: 'local' }; } if (q.name === 'harness') { if (Array.isArray(q.choices)) assert([].concat(q.choices.map(c=>c.value)).includes('__custom__'), 'harness choices include custom'); return { harness: 'pi' }; } return {}; },
          log: () => {},
          error: () => {},
        });
      } finally {
        if (orig === undefined) delete process.stdin.isTTY; else process.stdin.isTTY = orig;
      }
      assert(res.exitCode === 0, 'real TTY install exits 0');
      assert(asked.includes('scope') && asked.includes('harness'), 'real TTY path asked scope+harness');
    }
    // no TTY signal -> non-TTY failure even with promptsImpl
    {
      const sc = sb.scenario('notty-injected');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const res = await main(['install'], { promptsImpl: async () => ({}) , log: () => {}, error: () => {} });
      assert(res.exitCode === 1, 'no TTY signal -> non-TTY failure despite promptsImpl');
    }

    // scope select both global/local at local harness pi
    for (const scope of ['global', 'local']) {
      const sc = sb.scenario('scope-' + scope);
      sb.enter(sc);
      const { main } = require(INSTALL);
      const res = await main(['install', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q, opts) => ({ scope }),
        log: () => {},
        error: () => {},
      });
      assert(res.exitCode === 0, `scope ${scope} install exits 0`);
      const expected = scope === 'global'
        ? path.join(sc.home, '.claude', 'skills', 'five-role-team', 'SKILL.md')
        : path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md');
      assert(fs.existsSync(expected), `scope ${scope} placed SKILL.md`);
    }

    // harness select local scope distinguishes pi vs claude-code
    {
      const sc = sb.scenario('harness-claude-local');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const res = await main(['install', '--local', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q) => ({ harness: 'claude-code' }),
        log: () => {},
        error: () => {},
      });
      assert(res.exitCode === 0, 'harness claude-code local exits 0');
      assert(fs.existsSync(path.join(sc.cwd, '.claude', 'skills', 'five-role-team', 'SKILL.md')), 'claude local target');
      assert(!fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'pi path absent for claude');
    }
    {
      const sc = sb.scenario('harness-pi-local');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const res = await main(['install', '--local', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q) => ({ harness: 'pi' }),
        log: () => {},
        error: () => {},
      });
      assert(res.exitCode === 0, 'harness pi local exits 0');
      assert(fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'pi local target');
      assert(!fs.existsSync(path.join(sc.cwd, '.claude', 'skills', 'five-role-team', 'SKILL.md')), 'claude path absent for pi');
    }
    // custom path (text follow-up)
    {
      const sc = sb.scenario('harness-custom');
      sb.enter(sc);
      const customDir = path.join(sc.cwd, 'custom-harness');
      const { main } = require(INSTALL);
      const asked = [];
      const res = await main(['install', '--global', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q) => { asked.push(q.name); if (q.name === 'harness') return { harness: '__custom__' }; if (q.name === 'path') return { path: customDir }; return {}; },
        log: () => {},
        error: () => {},
      });
      assert(res.exitCode === 0, 'custom harness exits 0');
      assert(asked.includes('path'), 'custom path follow-up asked');
      assert(fs.existsSync(path.join(customDir, 'five-role-team', 'SKILL.md')), 'custom target');
    }

    // partial flag: scope prompted, harness not
    {
      const sc = sb.scenario('partial');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const asked = [];
      const res = await main(['install', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q) => { asked.push(q.name); if (q.name === 'scope') return { scope: 'local' }; return {}; },
        log: () => {},
        error: () => {},
      });
      assert(res.exitCode === 0, 'partial-flag exits 0');
      assert(asked.includes('scope'), 'partial asked scope');
      assert(!asked.includes('harness'), 'partial did not ask harness');
      assert(fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'partial local target');
    }

    // cancel at scope: onCancel invoked, otherwise-proceeding response
    {
      const sc = sb.scenario('cancel-scope');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const logs = [];
      const res = await main(['install', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q, opts) => {
          if (q.name === 'scope') { if (opts && opts.onCancel) opts.onCancel(); return { scope: 'local' }; }
          return {};
        },
        log: (m) => logs.push(m),
        error: () => {},
      });
      assert(res.exitCode === 0 && res.cancelled, 'cancel at scope exits 0');
      assert(logs.join('\n').includes('Installation cancelled.'), 'cancel scope message');
      assert(!fs.existsSync(path.join(sc.home, '.claude', 'skills', 'five-role-team', 'SKILL.md')) && !fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'nothing installed');
    }

    // cancel at harness
    {
      const sc = sb.scenario('cancel-harness');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const logs = [];
      const res = await main(['install', '--global', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q, opts) => {
          if (q.name === 'harness') { if (opts && opts.onCancel) opts.onCancel(); return { harness: 'claude-code' }; }
          return {};
        },
        log: (m) => logs.push(m),
        error: () => {},
      });
      assert(res.exitCode === 0 && res.cancelled, 'cancel at harness exits 0');
      assert(logs.join('\n').includes('Installation cancelled.'), 'cancel harness message');
    }

    // cancel at custom path follow-up
    {
      const sc = sb.scenario('cancel-custom');
      sb.enter(sc);
      const { main } = require(INSTALL);
      const logs = [];
      const res = await main(['install', '--global', '--agents', 'worker', '--agent-models', 'worker=sonnet'], {
        isTTY: true,
        promptsImpl: async (q, opts) => {
          if (q.name === 'harness') return { harness: '__custom__' };
          if (q.name === 'path') { if (opts && opts.onCancel) opts.onCancel(); return { path: path.join(sc.cwd, 'custom-harness') }; }
          return {};
        },
        log: (m) => logs.push(m),
        error: () => {},
      });
      assert(res.exitCode === 0 && res.cancelled, 'cancel at custom path exits 0');
      assert(logs.join('\n').includes('Installation cancelled.'), 'cancel custom message');
    }

    // init no scope prompt non-TTY
    {
      const sc = sb.scenario('init-noscope');
      const r = sb.run([INSTALL, 'init', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], { home: sc.home, cwd: sc.cwd });
      assert(r.status === 0, `init non-TTY proceeds local (got ${r.status})`);
      assert(fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'init local target');
    }

  } catch (err) {
    console.error('FAIL: unexpected error', err);
    failed += 1;
  } finally {
    sb.cleanup();
    if (fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
    else console.log('OK: sandbox root removed by cleanup');
  }

  if (failed > 0) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  else { console.log('\nAll task 2.2 checks passed'); process.exit(0); }
})();
