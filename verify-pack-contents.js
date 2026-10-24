#!/usr/bin/env node
'use strict';
// Verify npm pack contents against SOURCE_ENTRIES in verify-matrix.js (design Risks mitigation).
//
// Runs `npm pack --dry-run --json` from the repo root with a temp HOME and asserts:
//   - every SOURCE_ENTRIES entry appears (exact file or directory prefix)
//   - nothing matches verify-*.js, test-*.js, openspec/, .claude/, .pi/
//   - package.json `files` equals SOURCE_ENTRIES as a set
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const { SOURCE_ENTRIES } = require(path.join(__dirname, 'verify-matrix.js'));
const pkg = require(path.join(__dirname, 'package.json'));

const REPO_ROOT = __dirname;
const TIMEOUT_MS = 120000;

const sb = createSandbox();
let failed = 0;
function assert(c, m) {
  if (c) console.log('OK:', m);
  else { console.error('FAIL:', m); failed += 1; }
}

try {
  const run = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: sb.home, USERPROFILE: sb.home },
    input: '',
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  assert(run.status === 0, `npm pack --dry-run --json exits 0 (got ${run.status})`);

  let files = [];
  try {
    const parsed = JSON.parse(run.stdout);
    files = (Array.isArray(parsed) && parsed.length ? parsed[0].files : []).map((f) => f.path);
  } catch (err) {
    console.error('FAIL: could not parse npm pack JSON output');
    failed += 1;
  }

  // Every SOURCE_ENTRY must appear (exact file, or a directory prefix).
  for (const entry of SOURCE_ENTRIES) {
    const isDir = !path.extname(entry) || fs.statSync(path.join(REPO_ROOT, entry), { throwIfNoEntry: false })?.isDirectory();
    const present = files.some((p) => {
      if (p === entry) return true;
      return isDir && (p === entry || p.startsWith(entry + path.sep) || p.startsWith(entry + '/'));
    });
    assert(present, `pack includes ${entry}`);
  }

  // Excluded patterns must not appear.
  const forbidden = [
    { re: /^verify-.*\.js$/, label: 'verify-*.js' },
    { re: /^test-.*\.js$/, label: 'test-*.js' },
    { re: /^openspec\//, label: 'openspec/' },
    { re: /^\.claude\//, label: '.claude/' },
    { re: /^\.pi\//, label: '.pi/' },
  ];
  for (const f of forbidden) {
    const bad = files.filter((p) => f.re.test(p));
    assert(bad.length === 0, `pack excludes ${f.label} (${bad.length} found)`);
  }

  // package.json files must equal SOURCE_ENTRIES as a set.
  const declared = Array.isArray(pkg.files) ? [...pkg.files] : [];
  const a = [...SOURCE_ENTRIES].sort();
  const b = [...declared].sort();
  assert(a.length === b.length && a.every((v, i) => v === b[i]),
    `package.json files equals SOURCE_ENTRIES as a set (declared=${declared.join(',')})`);

} catch (err) {
  console.error('FAIL: unexpected error', err && err.message ? err.message : err);
  failed += 1;
} finally {
  sb.cleanup();
  if (fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
  else console.log('OK: sandbox root removed by cleanup');
}

// Confirm no tarball left behind.
const leftover = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith('.tgz'));
if (leftover.length > 0) { console.error('FAIL: leftover tarball(s): ' + leftover.join(', ')); failed += 1; }
else console.log('OK: no tarball left behind');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nAll pack-contents checks passed');
  process.exitCode = 0;
}
