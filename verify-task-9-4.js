#!/usr/bin/env node
'use strict';
// Verify task 9.4: test-uninstall-modes.js uninstalls every install mode cleanly, and the script
// can actually fail.
//   - positive: `node test-uninstall-modes.js` runs as a child process in a sandbox (temp HOME and
//     temp cwd, empty stdin) and exits 0. It prints one PASS line per combination for all 16
//     combinations (scope x harness x mode x agents), the COVERAGE check is OK, and the SUMMARY
//     reports "exercised 16 of 16 uninstall modes; 16 passed, 0 failed".
//   - negative: the same script, pointed at a sandboxed copy of the plugin source in which
//     uninstallPiSecondary() returns null (so the pi global secondary symlink is never removed),
//     exits non-zero, prints FAIL lines for the four pi global cells, still PASSes every
//     claude-code and local cell (those have no secondary symlink), and still exercises all 16.
//
// Every run goes through verify-sandbox.js. The repository files are not modified.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const SCRIPT = path.join(__dirname, 'test-uninstall-modes.js');
const EXPECTED_CELLS = 16;
const RUN_TIMEOUT_MS = 300000;
// Same plugin source entries that test-uninstall-modes.js copies.
const SOURCE_ENTRIES = ['SKILL.md', 'agents', 'pi', 'commands', 'conventions', '.claude-plugin',
  'install.js', 'install-files.js', 'select-agents.js', 'configure-models.js', 'agent-config.js'];

// The sabotage: uninstallPiSecondary() reports nothing to remove, so the secondary link stays.
const SABOTAGE_FROM = 'function uninstallPiSecondary(primary, secondary) {\n  if (!secondary) return null;';
const SABOTAGE_TO = 'function uninstallPiSecondary(primary, secondary) {\n  return null; // sabotaged';

const sb = createSandbox();
let failed = 0;
function assert(c, m) {
  if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m);
}

try {
  assert(fs.existsSync(SCRIPT), 'test-uninstall-modes.js exists at the repo root');
  if (!fs.existsSync(SCRIPT)) throw new Error('test-uninstall-modes.js is missing');

  // ---- positive run: the full uninstall matrix passes ----
  const pos = sb.run([SCRIPT], { env: { UNINSTALL_MODES_SOURCE: '' }, timeout: RUN_TIMEOUT_MS });
  assert(pos.status === 0, `test-uninstall-modes.js exits 0 (got ${pos.status}, signal ${pos.signal})`);
  const passLines = pos.out.split('\n').filter((l) => /^PASS (global|local)\/(pi|claude-code)\/(copy|link)\/(all|subset)\b/.test(l));
  assert(passLines.length === EXPECTED_CELLS, `${passLines.length} PASS lines for the matrix cells (expected ${EXPECTED_CELLS})`);
  assert(!/^FAIL/m.test(pos.out), 'no FAIL lines in the positive run');
  assert(/^COVERAGE: ok, every one of the 16 cells was exercised$/m.test(pos.out), 'COVERAGE check is OK for all 16 cells');
  assert(/^SUMMARY: exercised 16 of 16 uninstall modes; 16 passed, 0 failed$/m.test(pos.out),
    'SUMMARY reports exercised 16 of 16 uninstall modes, 16 passed, 0 failed');

  // ---- negative run: a sabotaged uninstall must make the script fail ----
  const broken = path.join(sb.root, 'broken-src');
  fs.mkdirSync(broken, { recursive: true });
  for (const name of SOURCE_ENTRIES) {
    fs.cpSync(path.join(__dirname, name), path.join(broken, name), { recursive: true });
  }
  const installFiles = path.join(broken, 'install-files.js');
  const original = fs.readFileSync(installFiles, 'utf8');
  assert(original.split(SABOTAGE_FROM).length === 2, 'install-files.js contains the uninstallPiSecondary guard exactly once');
  fs.writeFileSync(installFiles, original.replace(SABOTAGE_FROM, SABOTAGE_TO));
  assert(fs.readFileSync(installFiles, 'utf8').includes(SABOTAGE_TO), 'sabotaged copy has uninstallPiSecondary returning null');

  const neg = sb.run([SCRIPT], { env: { UNINSTALL_MODES_SOURCE: broken }, timeout: RUN_TIMEOUT_MS });
  assert(neg.status !== 0, `script exits non-zero on the sabotaged source (got ${neg.status})`);
  for (const key of ['global/pi/copy/all', 'global/pi/copy/subset', 'global/pi/link/all', 'global/pi/link/subset']) {
    assert(new RegExp(`^FAIL ${key}$`, 'm').test(neg.out), `FAIL line for ${key} (pi secondary symlink left behind)`);
  }
  assert(/^PASS global\/claude-code\/copy\/all /m.test(neg.out), 'global/claude-code/copy/all still PASSes (no secondary to leave)');
  assert(/^PASS local\/pi\/copy\/all /m.test(neg.out), 'local/pi/copy/all still PASSes (local pi has no secondary)');
  assert(/^SUMMARY: exercised 16 of 16 uninstall modes; \d+ passed, [1-9]\d* failed$/m.test(neg.out),
    'SUMMARY still exercises all 16 cells and reports a non-zero failed count');
} catch (err) {
  console.error('FAIL: unexpected error', err);
  failed += 1;
} finally {
  sb.cleanup();
  if (fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
  else console.log('OK: sandbox root removed by cleanup');
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\nAll task 9.4 checks passed');
  }
}
