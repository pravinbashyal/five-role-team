#!/usr/bin/env node
'use strict';
// Verify task 9.3: test-install-modes.js runs the full install-mode matrix and it passes,
// and the script can actually fail.
//   - positive: `node test-install-modes.js` runs as a child process in a sandbox (temp HOME
//     and temp cwd, empty stdin) and exits 0. It prints one PASS line per combination for all
//     16 combinations (scope x harness x mode x agents), the COVERAGE check is OK, and the
//     SUMMARY reports "exercised 16 of 16 install modes; 16 passed, 0 failed".
//   - negative: the same script, pointed at a sandboxed copy of the plugin source with
//     agents/worker.md removed (INSTALL_MODES_SOURCE), exits non-zero, prints FAIL lines for
//     the copy cells that select worker, still runs all 16 cells, and still PASSes link/all
//     (a link does not apply agent selection, and --agent-models supplies worker's model, so
//     it does not depend on worker.md). The --agents cells fail because install.js itself
//     exits 1 with "Model for worker must not be empty" when no default model exists.
//
// Every run goes through verify-sandbox.js. The repository files are not modified.
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const SCRIPT = path.join(__dirname, 'test-install-modes.js');
const EXPECTED_CELLS = 16;
const RUN_TIMEOUT_MS = 300000;
// Same plugin source entries that test-install-modes.js copies.
const SOURCE_ENTRIES = ['SKILL.md', 'agents', 'pi', 'commands', 'conventions', '.claude-plugin',
  'install.js', 'install-files.js', 'select-agents.js', 'configure-models.js', 'agent-config.js'];

const sb = createSandbox();
let failed = 0;
function assert(c, m) {
  if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m);
}

try {
  assert(fs.existsSync(SCRIPT), 'test-install-modes.js exists at the repo root');
  if (!fs.existsSync(SCRIPT)) throw new Error('test-install-modes.js is missing');

  // ---- positive run: the full matrix passes ----
  const pos = sb.run([SCRIPT], { env: { INSTALL_MODES_SOURCE: '' }, timeout: RUN_TIMEOUT_MS });
  assert(pos.status === 0, `test-install-modes.js exits 0 (got ${pos.status}, signal ${pos.signal})`);
  const passLines = pos.out.split('\n').filter((l) => /^PASS (global|local)\/(pi|claude-code)\/(copy|link)\/(all|subset)\b/.test(l));
  assert(passLines.length === EXPECTED_CELLS, `${passLines.length} PASS lines for the matrix cells (expected ${EXPECTED_CELLS})`);
  assert(!/^FAIL/m.test(pos.out), 'no FAIL lines in the positive run');
  assert(/^COVERAGE: ok, every one of the 16 cells was exercised$/m.test(pos.out), 'COVERAGE check is OK for all 16 cells');
  assert(/^SUMMARY: exercised 16 of 16 install modes; 16 passed, 0 failed$/m.test(pos.out),
    'SUMMARY reports exercised 16 of 16 install modes, 16 passed, 0 failed');

  // ---- negative run: a sabotaged source must make the script fail ----
  const broken = path.join(sb.root, 'broken-src');
  fs.mkdirSync(broken, { recursive: true });
  for (const name of SOURCE_ENTRIES) {
    fs.cpSync(path.join(__dirname, name), path.join(broken, name), { recursive: true });
  }
  fs.rmSync(path.join(broken, 'agents', 'worker.md'));
  assert(!fs.existsSync(path.join(broken, 'agents', 'worker.md')), 'sabotaged copy has agents/worker.md removed');

  const neg = sb.run([SCRIPT], { env: { INSTALL_MODES_SOURCE: broken }, timeout: RUN_TIMEOUT_MS });
  assert(neg.status !== 0, `script exits non-zero on the sabotaged source (got ${neg.status})`);
  assert(/^FAIL global\/claude-code\/copy\/subset$/m.test(neg.out), 'FAIL line for global/claude-code/copy/subset (worker selected, file missing)');
  assert(/^FAIL local\/pi\/copy\/all$/m.test(neg.out), 'FAIL line for local/pi/copy/all');
  assert(/^PASS global\/pi\/link\/all /m.test(neg.out), 'link/all still PASSes on the sabotaged source (link does not apply agent selection and --agent-models supplies worker)');
  assert(/^SUMMARY: exercised 16 of 16 install modes; \d+ passed, [1-9]\d* failed$/m.test(neg.out),
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
    console.log('\nAll task 9.3 checks passed');
  }
}
