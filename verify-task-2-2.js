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

  // parse-level checks (task 2.1) and uninstall invariance
  {
    const { parseArgs } = require(INSTALL);
    const initParsed = parseArgs(['init']);
    assert(initParsed.init === true && initParsed.local === true && initParsed.global === false, 'parse: init defaults to local');
    const installParsed = parseArgs(['install', '--global', '--harness', 'pi']);
    assert(installParsed.uninstall === false && installParsed.global === true && installParsed.harness === 'pi', 'parse: install accepted as subcommand');
    const bareParsed = parseArgs(['--global', '--harness', 'pi']);
    assert(bareParsed.uninstall === false && bareParsed.global === true && bareParsed.harness === 'pi', 'parse: bare form accepted');
    const uninstallParsed = parseArgs(['uninstall', '--global', '--harness', 'pi']);
    assert(uninstallParsed.uninstall === true, 'parse: uninstall recognized');
    const badInit = parseArgs(['--global', 'init']);
    assert(badInit.errors.length > 0, 'parse: init not in first position is rejected');
    const badInstall = parseArgs(['--global', 'install']);
    assert(badInstall.errors.length > 0, 'parse: install not in first position is rejected');
  }

  // uninstall: never prompts, fails on missing flags
  {
    const sc = sb.scenario('uninstall-missing-scope');
    const r = sb.run([INSTALL, 'uninstall', '--harness', 'pi'], { home: sc.home, cwd: sc.cwd });
    assert(r.status === 1, 'uninstall missing scope exits 1');
    assert(r.stderr.includes('Error parsing arguments:\n  - Either --global or --local must be specified'), 'uninstall missing scope exact message');
  }
  {
    const sc = sb.scenario('uninstall-missing-harness');
    const r = sb.run([INSTALL, 'uninstall', '--global'], { home: sc.home, cwd: sc.cwd });
    assert(r.status === 1, 'uninstall missing harness exits 1');
    assert(r.stderr.includes('Error parsing arguments:\n  - --harness is required (harness name or path, e.g. --harness pi)'), 'uninstall missing harness exact message');
  }
  {
    const sc = sb.scenario('uninstall-tty-noprompt');
    sb.enter(sc);
    const { main } = require(INSTALL);
    const asked = [];
    const res = await main(['uninstall', '--global', '--harness', 'claude-code'], { isTTY: true, promptsImpl: async (q) => { asked.push(q.name); return {}; }, log: () => {}, error: () => {} });
    assert(Array.isArray(asked) && asked.length === 0, 'uninstall never calls prompt on TTY');
  }
  {
    const sc = sb.scenario('uninstall-tty-missing-scope');
    sb.enter(sc);
    const { main } = require(INSTALL);
    const asked = [];
    const res = await main(['uninstall', '--harness', 'claude-code'], { isTTY: true, promptsImpl: async (q) => { asked.push(q.name); return { scope: 'local' }; }, log: () => {}, error: () => {} });
    assert(res.exitCode === 1, 'uninstall missing scope on TTY exits 1');
    assert(asked.length === 0, 'uninstall missing scope does not prompt on TTY');
  }
  {
    const sc = sb.scenario('uninstall-tty-missing-harness');
    sb.enter(sc);
    const { main } = require(INSTALL);
    const asked = [];
    const res = await main(['uninstall', '--global'], { isTTY: true, promptsImpl: async (q) => { asked.push(q.name); return { harness: 'pi' }; }, log: () => {}, error: () => {} });
    assert(res.exitCode === 1, 'uninstall missing harness on TTY exits 1');
    assert(asked.length === 0, 'uninstall missing harness does not prompt on TTY');
  }

  // uninstall: neither flags exact errors
  {
    const sc = sb.scenario('uninstall-neither');
    const r = sb.run([INSTALL, 'uninstall'], { home: sc.home, cwd: sc.cwd });
    assert(r.status === 1, 'uninstall neither exits 1');
    assert(r.stderr.includes('Error parsing arguments:\n  - Either --global or --local must be specified\n  - --harness is required (harness name or path, e.g. --harness pi)'), 'uninstall neither exact message');
  }
  // uninstall: unknown flag + missing flags keeps unknown listed (here unknown only since flags present)
  {
    const sc = sb.scenario('uninstall-unknown');
    const r = sb.run([INSTALL, 'uninstall', '--badarg'], { home: sc.home, cwd: sc.cwd });
    assert(r.status === 1, 'uninstall unknown exits 1');
    assert(r.stderr.includes('Error parsing arguments:\n  - Unknown flag: --badarg'), 'uninstall unknown arg listed');
  }
  // data-loss guard: failed uninstall leaves existing local install intact
  {
    const sc = sb.scenario('uninstall-dataloss');
    sb.run([INSTALL, 'install', '--local', '--harness', 'pi', '--agents', 'worker', '--agent-models', 'worker=sonnet'], { home: sc.home, cwd: sc.cwd });
    const before = fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md'));
    const r = sb.run([INSTALL, 'uninstall', '--harness', 'pi'], { home: sc.home, cwd: sc.cwd });
    assert(r.status === 1, 'dataloss uninstall exits 1');
    assert(before && fs.existsSync(path.join(sc.cwd, '.pi', 'skills', 'five-role-team', 'SKILL.md')), 'existing install preserved after failed uninstall');
  }

  // help text
  {
    const help = require('child_process').spawnSync(process.execPath, [INSTALL, '--help'], { encoding: 'utf8' });
    const text = (help.stdout || '') + (help.stderr || '');
    assert(/prompts for installation scope if omitted/i.test(text), 'help: scope prompt mention');
    assert(/required, never prompted for uninstall/i.test(text), 'help: uninstall scope never prompted');
    assert(/Same as the bare form; prompts for scope if omitted/i.test(text), 'help: install described as bare form');
    assert(/prompts for missing scope\/harness on a TTY/i.test(text), 'help: bare form prompts');
    assert(/Prompts for installation scope if omitted/i.test(text), 'help: interactive mode scope prompt');
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
