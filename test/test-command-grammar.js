#!/usr/bin/env node
'use strict';
// Command grammar and help checks for install.js (openspec change unify-npm-init-flow, task 1.1,
// design D6). Runs in-process through parseArgs/main with injected log and error writers.
// Every path checked here returns before any filesystem write, so nothing is installed.
//
// Scenarios covered:
//   - "Install alias and bare form"
//   - "[interaction] Bare command" and "[interaction] Bare command with flags"
//   - "[interaction] Help text uses the command name"
//   - "[interaction] Unknown argument hint"
//   - parseArgs accepts --default and --verbose
//
// Exit 0 only when every check passes.
const path = require('path');
const { parseArgs, showUsage, main } = require(path.join(__dirname, '..', 'install.js'));

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ' (' + detail + ')' : ''}`);
  }
}

// Run main() with captured output. Returns { result, out, err }.
async function run(argv) {
  const out = [];
  const err = [];
  const result = await main(argv, {
    log: (line) => out.push(String(line)),
    error: (line) => err.push(String(line)),
    isTTY: false,
  });
  return { result, out: out.join('\n'), err: err.join('\n') };
}

async function main_() {
  // ---- install alias and bare form ----
  {
    const { result, err } = await run(['install', '--global', '--harness', 'pi']);
    check('install alias: exit 1', result.exitCode === 1, `got ${result.exitCode}`);
    check('install alias: reported as unknown argument pointing to init',
      /Unknown argument: install/.test(err) && /five-role-team init/.test(err), err);
    check('install alias: installs nothing', result.selectedAgents === null && result.cancelled === false);
  }

  // ---- [interaction] Bare command ----
  {
    const { result, out, err } = await run([]);
    check('bare command: exit 0', result.exitCode === 0, `got ${result.exitCode}`);
    check('bare command: prints usage on stdout', /USAGE:/.test(out) && err === '', err);
    const usageLines = out.split('\n').filter(l => /^  five-role-team /.test(l));
    const commands = new Set(usageLines.map(l => l.trim().split(/\s+/)[1]));
    check('bare command: usage lists only init and uninstall as subcommands',
      commands.has('init') && commands.has('uninstall') && !commands.has('install'),
      [...commands].join(','));
    check('bare command: installs nothing', result.selectedAgents === null && !result.cancelled);
  }

  // ---- [interaction] Bare command with flags ----
  {
    const { result, out, err } = await run(['--global', '--harness', 'pi']);
    check('bare with flags: exit 1', result.exitCode === 1, `got ${result.exitCode}`);
    check('bare with flags: usage printed to stderr with an init note',
      /USAGE:/.test(err) && /five-role-team init/.test(err), err);
    check('bare with flags: nothing printed to stdout', out === '', out);
  }

  // ---- [interaction] Help text uses the command name ----
  {
    const { result, out } = await run(['--help']);
    check('--help: exit 0', result.exitCode === 0, `got ${result.exitCode}`);
    check('--help: examples include init, init --default and uninstall',
      /five-role-team init\b/.test(out) && /five-role-team init --default/.test(out) && /five-role-team uninstall/.test(out));
    check('--help: no node install.js', !/node install\.js/.test(out));
  }
  {
    const lines = [];
    showUsage((l) => lines.push(l));
    const text = lines.join('\n');
    check('showUsage: no node install.js', !/node install\.js/.test(text));
    const usageBlock = text.split('\n');
    const start = usageBlock.findIndex(l => l === 'USAGE:');
    const end = usageBlock.findIndex(l => l === 'OPTIONS:');
    const block = usageBlock.slice(start + 1, end).filter(l => l.trim().length > 0 && !/^  Running /.test(l));
    check('showUsage: every USAGE line starts with five-role-team',
      start >= 0 && end > start && block.length > 0 && block.every(l => /^  five-role-team /.test(l)),
      block.join(' | '));
  }

  // ---- [interaction] Unknown argument hint ----
  {
    const { result, err } = await run(['init', '--globl']);
    check('unknown flag: exit 1', result.exitCode === 1, `got ${result.exitCode}`);
    check('unknown flag: hint points at five-role-team --help',
      /five-role-team --help/.test(err) && !/node install\.js/.test(err), err);
  }

  // ---- parseArgs flags ----
  {
    const p = parseArgs(['init', '--default', '--verbose']);
    check('parseArgs: init with --default --verbose parses without errors',
      p.errors.length === 0 && p.init === true && p.defaultSetup === true && p.verbose === true,
      JSON.stringify(p.errors));
    const u = parseArgs(['uninstall', '--local', '--harness', 'pi']);
    check('parseArgs: uninstall still parses', u.errors.length === 0 && u.uninstall === true, JSON.stringify(u.errors));
    const bare = parseArgs(['--global']);
    check('parseArgs: no subcommand sets neither init nor uninstall', !bare.init && !bare.uninstall);
  }

  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main_().then(code => process.exit(code)).catch(err => {
  console.error('Error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
