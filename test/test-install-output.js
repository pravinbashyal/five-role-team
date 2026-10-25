#!/usr/bin/env node
'use strict';
// Install output for install.js (openspec change unify-npm-init-flow, task 4.1, design D7, D8).
//
// Every run is a child process of install.js inside a sandbox (verify-sandbox.js): a fresh
// temp HOME and temp cwd per scenario, stdin empty (not a TTY). The Claude Code marketplace
// file is faked under the sandbox HOME, never the real one.
//
// Scenarios covered (names as in specs/cli/installation and specs/cli/npm-distribution):
//   - "[interaction] Quiet progress by default"
//   - "Show installation progress" (with --verbose)
//   - "Show success confirmation"
//   - "[interaction] Next steps after a Claude Code install"
//   - "[interaction] Warning when a marketplace copy would shadow the install"
//     (fixture with five-role-team@five-role-team, and a fixture with no such id)
//   - a corrupt-JSON fixture (and an unexpected-shape fixture) that must not fail the install
//
// Exit 0 only when every check passes.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const REPO = path.join(__dirname, '..');
const INSTALL = path.join(REPO, 'install.js');
const ALL_AGENTS = ['architect', 'designer', 'intern', 'reviewer', 'supervisor', 'worker'];
const ALIASES = {
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
};

// Marketplace fixtures (the shape Claude Code writes is { version, plugins: { id: [...] } }).
const SHADOW_FIXTURE = JSON.stringify({
  version: 2,
  plugins: {
    'five-role-team@five-role-team': [{ scope: 'user', installPath: '/nowhere', version: '1.1.0' }],
    'other-plugin@some-market': [{ scope: 'user', installPath: '/nowhere', version: '0.1.0' }],
  },
}, null, 2);
const NO_SHADOW_FIXTURE = JSON.stringify({
  version: 2,
  plugins: {
    'five-role-team@skills-dir': [{ scope: 'project', installPath: '/nowhere', version: '1.1.0' }],
    'other-plugin@some-market': [{ scope: 'user', installPath: '/nowhere', version: '0.1.0' }],
  },
}, null, 2);
const CORRUPT_FIXTURE = '{"version": 2, "plugins": {"five-role-team@five-role-team": [';
const UNEXPECTED_SHAPE_FIXTURE = JSON.stringify({ version: 2, plugins: ['five-role-team@five-role-team'] });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function expandAlias(model) {
  return Object.prototype.hasOwnProperty.call(ALIASES, model) ? ALIASES[model] : model;
}

// `model:` from the YAML frontmatter of an agent source file, quotes stripped, aliases expanded.
function expectedDefaultModel(id) {
  const candidates = [path.join(REPO, 'agents', `${id}.md`), path.join(REPO, 'pi', 'agents', `${id}.md`)];
  const file = candidates.find((c) => fs.existsSync(c));
  const content = fs.readFileSync(file, 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = fm && fm[1].match(/^model:[ \t]*(.*?)[ \t]*$/m);
  if (!line) throw new Error(`no model frontmatter in ${file}`);
  return expandAlias(line[1].replace(/^(['"])(.*)\1$/, '$2'));
}

// Write the fake Claude Code marketplace file under a sandbox HOME (or nothing when content is null).
function writeMarketplaceFile(home, content) {
  const dir = path.join(home, '.claude', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), content);
  return path.join(dir, 'installed_plugins.json');
}

function runInit(sb, sc, argv) {
  return sb.run([INSTALL, ...argv], { home: sc.home, cwd: sc.cwd });
}

// Lines of the stdout after the "Next steps:" heading, or null when there is no such block.
function nextStepsLines(stdout) {
  const lines = stdout.split('\n');
  const idx = lines.indexOf('Next steps:');
  return idx < 0 ? null : lines.slice(idx + 1).filter((l) => l.length > 0);
}

function main() {
  const sb = createSandbox();
  try {
    // ---- [interaction] Quiet progress by default ----
    {
      const sc = sb.scenario('quiet-default');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const r = runInit(sb, sc, ['init', '--default']);
      check('quiet progress by default: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}: ${r.stderr.trim().slice(-200)}`);
      check('quiet progress by default: no per-directory "Copying ..." line',
        !/^Copying /m.test(r.stdout), r.stdout.split('\n').filter((l) => /Copying/.test(l)).join(' | '));
      check('quiet progress by default: no "Copying" line on stderr either', !/Copying /.test(r.stderr));
      check('quiet progress by default: the install is present',
        fs.existsSync(path.join(sc.cwd, '.claude', 'skills', 'five-role-team', 'agents')));
    }

    // ---- Show installation progress (with --verbose) ----
    {
      const sc = sb.scenario('verbose-default');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const r = runInit(sb, sc, ['init', '--default', '--verbose']);
      check('show installation progress: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}`);
      const copyLines = r.stdout.split('\n').filter((l) => /^Copying /.test(l));
      check('show installation progress: at least one "Copying ..." line', copyLines.length > 0);
      const labels = copyLines.map((l) => l.slice(0, l.indexOf(':')));
      check('show installation progress: one line per directory (no duplicate directory label)',
        new Set(labels).size === labels.length, labels.join(' | '));
      const agentsLine = copyLines.find((l) => l.startsWith('Copying agents: '));
      check('show installation progress: the agents line names every agent file',
        agentsLine !== undefined && ALL_AGENTS.every((id) => agentsLine.includes(`${id}.md`)), agentsLine);
    }

    // ---- Show success confirmation (path, harness, each agent with its model) ----
    {
      const sc = sb.scenario('success-default');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const r = runInit(sb, sc, ['init', '--default']);
      const primary = path.join(sc.cwd, '.claude', 'skills', 'five-role-team');
      const lines = r.stdout.split('\n');
      check('show success confirmation: names the installation path',
        lines.includes(`Installation successful: five-role-team installed at ${primary}`),
        lines.filter((l) => /^Installation successful/.test(l)).join(' | '));
      check('show success confirmation: names the harness', lines.some((l) => /^ {2}Mode: copy, local scope, harness claude-code$/.test(l)));
      for (const id of ALL_AGENTS) {
        const model = expectedDefaultModel(id);
        check(`show success confirmation: ${id} listed with its default model ${model}`,
          lines.includes(`    ${id}: ${model}`));
      }
    }

    // ---- [interaction] Next steps after a Claude Code install ----
    {
      const sc = sb.scenario('next-steps-claude');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const r = runInit(sb, sc, ['init', '--default']);
      const next = nextStepsLines(r.stdout);
      check('next steps (claude-code): a "Next steps:" block is printed', next !== null, `status ${r.status}`);
      const text = next ? next.join('\n') : '';
      check('next steps (claude-code): says start Claude Code from the project root', /Start Claude Code from the project root/.test(text));
      check('next steps (claude-code): mentions /reload-plugins', /\/reload-plugins/.test(text));
      check('next steps (claude-code): says to run /five-role-team:apply', /Run \/five-role-team:apply to implement an OpenSpec change/.test(text));
      check('next steps (claude-code): points CLAUDE.md at /five-role-team:apply', /CLAUDE\.md at \/five-role-team:apply/.test(text));
      check('next steps (claude-code): no shadow warning without a marketplace copy', !/takes precedence|claude plugin uninstall/.test(r.stdout));
      const stdoutLines = r.stdout.trimEnd().split('\n');
      const headingAt = stdoutLines.lastIndexOf('Next steps:');
      check('next steps (claude-code): the Next steps block is the last output',
        headingAt >= 0 && stdoutLines.slice(headingAt + 1).every((l) => l.startsWith('  ')),
        stdoutLines.slice(-3).join(' | '));
    }

    // ---- Next steps for pi: generic line only ----
    {
      const sc = sb.scenario('next-steps-pi');
      const r = runInit(sb, sc, ['init', '--default', '--harness', 'pi']);
      const next = nextStepsLines(r.stdout);
      check('next steps (pi): exit 0 with a "Next steps:" block', r.status === 0 && next !== null, `status ${r.status}`);
      const text = next ? next.join('\n') : '';
      check('next steps (pi): generic pi line', /Start a new pi session to load the five-role-team skill\./.test(text));
      check('next steps (pi): no Claude Code steps', !/\/five-role-team:apply|CLAUDE\.md|\/reload-plugins/.test(text));
    }

    // ---- Shadow warning: five-role-team@five-role-team in the marketplace file ----
    {
      const sc = sb.scenario('shadow-marketplace');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const mkt = writeMarketplaceFile(sc.home, SHADOW_FIXTURE);
      const before = fs.readFileSync(mkt, 'utf8');
      const r = runInit(sb, sc, ['init', '--default']);
      check('shadow warning: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout), `status ${r.status}`);
      check('shadow warning: says the marketplace copy takes precedence',
        /Warning: the marketplace copy five-role-team@five-role-team takes precedence over this install/.test(r.stdout));
      check('shadow warning: names the exact uninstall command',
        r.stdout.split('\n').some((l) => /claude plugin uninstall five-role-team@five-role-team/.test(l)));
      check('shadow warning: the warning sits inside the Next steps block',
        (nextStepsLines(r.stdout) || []).some((l) => /takes precedence/.test(l)));
      check('shadow warning: the installer leaves the marketplace file untouched',
        fs.readFileSync(mkt, 'utf8') === before);
      check('shadow warning: the new install is still written',
        fs.existsSync(path.join(sc.cwd, '.claude', 'skills', 'five-role-team', 'agents')));
    }

    // ---- No shadow: a skills-dir copy and another marketplace plugin only ----
    {
      const sc = sb.scenario('no-shadow-marketplace');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      writeMarketplaceFile(sc.home, NO_SHADOW_FIXTURE);
      const r = runInit(sb, sc, ['init', '--default']);
      check('no shadow: exit 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout), `status ${r.status}`);
      check('no shadow: no warning and no uninstall command', !/takes precedence|claude plugin uninstall/.test(r.stdout));
    }

    // ---- No marketplace file at all: no warning ----
    {
      const sc = sb.scenario('no-marketplace-file');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      const r = runInit(sb, sc, ['init', '--default']);
      check('no marketplace file: exit 0 with no warning', r.status === 0 && !/takes precedence|claude plugin uninstall/.test(r.stdout));
    }

    // ---- Corrupt JSON must not fail the install ----
    {
      const sc = sb.scenario('corrupt-marketplace');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      writeMarketplaceFile(sc.home, CORRUPT_FIXTURE);
      const r = runInit(sb, sc, ['init', '--default']);
      check('corrupt JSON: install still exits 0 with success', r.status === 0 && /^Installation successful/m.test(r.stdout),
        `status ${r.status}: ${r.stderr.trim().slice(-200)}`);
      check('corrupt JSON: no warning and no error output', !/takes precedence|claude plugin uninstall/.test(r.stdout) && r.stderr === '');
      check('corrupt JSON: the install is present',
        fs.existsSync(path.join(sc.cwd, '.claude', 'skills', 'five-role-team', 'agents')));
    }

    // ---- Unexpected shape must not fail the install or warn ----
    {
      const sc = sb.scenario('unexpected-marketplace');
      fs.mkdirSync(path.join(sc.cwd, '.claude'));
      writeMarketplaceFile(sc.home, UNEXPECTED_SHAPE_FIXTURE);
      const r = runInit(sb, sc, ['init', '--default']);
      check('unexpected shape: exit 0 with success and no warning',
        r.status === 0 && /^Installation successful/m.test(r.stdout) && !/takes precedence/.test(r.stdout), `status ${r.status}`);
    }

    // ---- The marketplace copy only matters for Claude Code (pi never warns) ----
    {
      const sc = sb.scenario('shadow-pi');
      writeMarketplaceFile(sc.home, SHADOW_FIXTURE);
      const r = runInit(sb, sc, ['init', '--default', '--harness', 'pi']);
      check('pi harness: exit 0 with success and no Claude Code marketplace warning',
        r.status === 0 && /^Installation successful/m.test(r.stdout) && !/takes precedence|claude plugin uninstall/.test(r.stdout),
        `status ${r.status}`);
    }
  } finally {
    sb.cleanup();
  }

  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  // exitCode rather than process.exit(): exit() can drop buffered output on pipes.
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
