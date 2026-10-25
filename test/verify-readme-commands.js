#!/usr/bin/env node
'use strict';
// README install-path check (task 5.1, design D9, spec "README leads with the npm flow").
//
// Static part, against README.md:
//   - none of `node install.js`, `git clone`, `claude plugin marketplace add`,
//     `claude plugin install` appears anywhere
//   - the closing "## Contributing" section is the last section
//   - outside Contributing, the only install command in a code block is
//     `npm install -g @pravinbashyal/five-role-team` followed by `five-role-team init`
//
// Sandbox part, against the packed tarball:
//   - `npm pack` the repo into the sandbox, `npm install -g <tarball>` into a temp prefix
//   - in a temp project with `.claude/`, run `five-role-team init --default` (stdin not a TTY)
//     and expect exit 0, the plugin under ./.claude/skills/five-role-team/ (with
//     .claude-plugin/plugin.json and non-empty agents/ and commands/), and output that
//     ends with the "Next steps:" block
//   - run the documented `five-role-team uninstall --local --harness claude-code` and expect
//     the install directory to be gone
//
// Every path lives under a fresh sandbox root from verify-sandbox.js; the real HOME and
// ~/.claude are never touched, and the global npm prefix is redirected into the sandbox.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const REPO_ROOT = path.join(__dirname, '..');
const README = path.join(REPO_ROOT, 'README.md');
const PKG_NAME = '@pravinbashyal/five-role-team';
const NPM_TIMEOUT_MS = 240000;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('OK:', msg);
  else { console.error('FAIL:', msg); failed += 1; }
}

// ---- static README checks -------------------------------------------------

function staticChecks() {
  const readme = fs.readFileSync(README, 'utf8');

  for (const pattern of ['node install.js', 'git clone', 'claude plugin marketplace add', 'claude plugin install']) {
    assert(!readme.includes(pattern), `README does not contain "${pattern}"`);
  }

  // Split on level-2 headings. The first chunk is the title and intro.
  const chunks = readme.split(/^(?=## )/m).filter((c) => c.startsWith('## '));
  const headings = chunks.map((c) => c.split('\n')[0].replace(/^## /, '').trim());
  assert(headings[headings.length - 1] === 'Contributing', 'closing section is "Contributing"');

  const outside = readme.slice(0, readme.lastIndexOf('\n## Contributing'));
  const contributing = readme.slice(readme.lastIndexOf('\n## Contributing'));

  const blockRe = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  const outsideBlocks = [...outside.matchAll(blockRe)].map((m) => m[1]);
  const contribBlocks = [...contributing.matchAll(blockRe)].map((m) => m[1]);

  const installLines = outsideBlocks
    .flatMap((b) => b.split('\n').map((l) => l.trim()))
    .filter((l) => /^npm (install|i|add)\b/.test(l));
  assert(installLines.length === 1 && installLines[0] === `npm install -g ${PKG_NAME}`,
    `only install command outside Contributing is "npm install -g ${PKG_NAME}"`);

  const installBlock = outsideBlocks.find((b) => b.includes(`npm install -g ${PKG_NAME}`));
  const cmdLines = installBlock ? installBlock.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const i1 = cmdLines.indexOf(`npm install -g ${PKG_NAME}`);
  const i2 = cmdLines.indexOf('five-role-team init');
  assert(i1 !== -1 && i2 > i1, 'install block runs npm install -g then five-role-team init');

  const contribLines = contribBlocks.flatMap((b) => b.split('\n').map((l) => l.trim()));
  const npmLinkIdx = contribLines.indexOf('npm link');
  const initLinkIdx = contribLines.indexOf('five-role-team init --link');
  assert(npmLinkIdx !== -1 && initLinkIdx > npmLinkIdx,
    'Contributing shows npm link then five-role-team init --link');
}

// ---- sandbox checks against the packed tarball ----------------------------

function sandboxChecks() {
  const sb = createSandbox();
  try {
    const packDir = path.join(sb.root, 'pack');
    const prefix = path.join(sb.root, 'prefix');
    const project = path.join(sb.root, 'project');
    fs.mkdirSync(packDir);
    fs.mkdirSync(prefix);
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });

    sb.activate();
    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], {
      cwd: REPO_ROOT,
      env: { ...sb.env },
      input: '',
      encoding: 'utf8',
      timeout: NPM_TIMEOUT_MS,
    });
    assert(packed.status === 0, `npm pack exits 0 (got ${packed.status})`);
    let tarball = null;
    try {
      tarball = path.join(packDir, JSON.parse(packed.stdout)[0].filename);
    } catch (err) {
      assert(false, 'npm pack --json output names a tarball');
    }
    if (!tarball || !fs.existsSync(tarball)) {
      assert(false, 'packed tarball exists in the sandbox');
      return;
    }

    // npm install -g <packed tarball>, with the global prefix redirected into the sandbox.
    sb.assertSafe();
    const installed = spawnSync('npm', ['install', '-g', tarball], {
      cwd: project,
      env: { ...sb.env, NPM_CONFIG_PREFIX: prefix, npm_config_prefix: prefix },
      input: '',
      encoding: 'utf8',
      timeout: NPM_TIMEOUT_MS,
    });
    assert(installed.status === 0, `npm install -g <packed tarball> exits 0 (got ${installed.status})`);
    const bin = path.join(prefix, 'bin', 'five-role-team');
    assert(fs.existsSync(bin), 'npm install -g puts five-role-team on the sandbox prefix bin');
    if (installed.status !== 0 || !fs.existsSync(bin)) return;

    // five-role-team --version from the installed tarball prints the package version (task 7.1).
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
    const version = sb.run([bin, '--version'], { cwd: project, timeout: NPM_TIMEOUT_MS });
    assert(version.status === 0 && version.stdout === pkgVersion + '\n',
      `five-role-team --version from the packed tarball exits 0 and prints ${pkgVersion} (got ${version.status} ${JSON.stringify(version.stdout)})`);

    // five-role-team init --default, standing in for the interactive run (stdin not a TTY).
    const init = sb.run([bin, 'init', '--default'], { cwd: project, timeout: NPM_TIMEOUT_MS });
    assert(init.status === 0, `five-role-team init --default exits 0 (got ${init.status}; ${init.stderr.trim()})`);
    const pluginDir = path.join(project, '.claude', 'skills', 'five-role-team');
    const plugin = path.join(pluginDir, '.claude-plugin', 'plugin.json');
    assert(fs.existsSync(plugin), 'plugin installed under ./.claude/skills/five-role-team/');
    for (const dir of ['agents', 'commands']) {
      const p = path.join(pluginDir, dir);
      const populated = fs.existsSync(p) && fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0;
      assert(populated, `plugin includes a non-empty ${dir}/ directory`);
    }
    // The Next steps block is the last thing printed: its header line is followed
    // only by numbered items until the end of the output.
    const outLines = init.stdout.replace(/\n+$/, '').split('\n');
    const nextIdx = outLines.lastIndexOf('Next steps:');
    const afterNext = nextIdx === -1 ? [] : outLines.slice(nextIdx + 1);
    assert(nextIdx !== -1 && afterNext.length > 0 && afterNext.every((l) => /^\s+\d+\. /.test(l)),
      'init --default output ends with the "Next steps" block (header, then only numbered items)');

    // The documented uninstall command removes the install.
    const uninstall = sb.run([bin, 'uninstall', '--local', '--harness', 'claude-code'], {
      cwd: project,
      timeout: NPM_TIMEOUT_MS,
    });
    assert(uninstall.status === 0, `five-role-team uninstall --local --harness claude-code exits 0 (got ${uninstall.status})`);
    assert(!fs.existsSync(path.join(project, '.claude', 'skills', 'five-role-team')),
      'uninstall removes ./.claude/skills/five-role-team/');
  } finally {
    sb.cleanup();
  }
}

staticChecks();
sandboxChecks();

if (failed > 0) {
  console.error(`\n${failed} README command check(s) failed`);
  process.exit(1);
}
console.log('\nAll README command checks passed');
