#!/usr/bin/env node
'use strict';
// Uninstall matrix for install.js (task 9.4).
//
// Runs every combination of
//   scope {global, local} x harness {pi, claude-code, cursor} x mode {copy, link} x agents {all, subset}
// which is 24 cells. Each cell installs, then uninstalls with the `uninstall` subcommand, and
// checks that the removal is clean.
//
// Each cell runs in its own sandbox (verify-sandbox.js: a fresh temp HOME and temp cwd; the guard
// aborts if HOME resolves to the real home). The plugin source is copied to <sandbox cwd>/plugin-src
// and install.js runs from that copy with an empty stdin (not a TTY). The repository is never
// written to, and install.js is never run outside a sandbox. Every uninstall gets an explicit
// sandbox HOME in its environment.
//
// The install argv is the same as test-install-modes.js (agents "all" uses --agent-models, "subset"
// uses --agents), so no prompt is ever shown.
//
// Per cell, after the first uninstall:
//   - exit 0, no error output, and the removal messages match the mode
//   - primary install gone: the copy directory (with .agent-config.json), or the link. In link mode
//     the source copy is still present and unchanged (manifest checksum before/after)
//   - pi global only: the ~/.pi/agent/skills/five-role-team secondary symlink is gone
//   - parent skills dirs still exist, and sibling content created before uninstall survives
//     unchanged (a sibling dir with a file, and a loose file, in every skills dir the install used)
//   - the whole sandbox home and cwd (minus plugin-src) equals the pre-uninstall snapshot with only
//     the primary and secondary entries removed: nothing new appears and nothing else disappears
//   - no leftover backups, temp files, .agent-config.json or five-role-team entries anywhere
// Then uninstall a second time: exit 1 with "Nothing to uninstall", and the sandbox is unchanged.
//
// claude-code cells (openspec change init-claude-permissions, task 2.2): the install writes the
// settings file, user rules are added to it, and the first uninstall must remove only the
// Agent(five-role-team:*) rules, keep the git Bash and user rules, and leave every other byte as
// it was. SETTINGS scenarios cover a malformed file (warning, exit kept), --no-permissions,
// deselected-agent rules, and nothing installed.
//
// Output: one PASS/FAIL line per cell, then COVERAGE and SUMMARY lines. Exit 0 only when every
// cell passes and coverage holds.
//
// UNINSTALL_MODES_SOURCE=<dir> copies the plugin source from <dir> instead of this checkout. It is
// (a sabotaged source must fail the script when this is set to a broken copy).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSandbox, REAL_HOME } = require(path.join(__dirname, 'verify-sandbox.js'));
const {
  copyPluginSource, installArgv, uninstallArgv, primaryPath, cursorAgentsPath, secondaryPath, cellsFrom, MATRIX, MATRIX_AXES, SUBSET,
} = require(path.join(__dirname, 'verify-matrix.js'));

const SOURCE = process.env.UNINSTALL_MODES_SOURCE
  ? path.resolve(process.env.UNINSTALL_MODES_SOURCE)
  : path.join(__dirname, '..');

// Independent literal copy of the axis values, used only by the coverage check. Kept here on
// purpose: it must not be derived from verify-matrix.js, or a dropped axis value would go unnoticed.
const EXPECTED_AXES = Object.freeze({
  scope: ['global', 'local'],
  harness: ['pi', 'claude-code', 'cursor'],
  mode: ['copy', 'link'],
  agents: ['all', 'subset'],
});
const EXPECTED_CELLS = 24;

const ALL_CURSOR_AGENTS = Object.freeze(['architect', 'designer', 'intern', 'reviewer', 'supervisor', 'worker']);

// Sibling content that must survive uninstall (created in every skills dir the install used).
const SIB_DIR = 'other-skill';
const SIB_SKILL = '# sibling skill, must survive uninstall\n';
const SIB_FILE = 'keep-me.txt';
const SIB_FILE_TEXT = 'unrelated file, must survive uninstall\n';

const sorted = (a) => [...a].sort();
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Claude Code settings (openspec change init-claude-permissions, task 2.2, design D8). Literal copies
// on purpose: the test states the expected rules itself rather than importing the module under test.
const AGENT_RULE_RE = /^Agent\(five-role-team:[^)]+\)$/;
const GIT_RULES = Object.freeze([
  'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)',
  'Bash(git diff:*)', 'Bash(git rev-parse:*)', 'Bash(git log:*)',
]);
const USER_ALLOW = 'Bash(npm test:*)';
const USER_DENY = 'Bash(rm -rf:*)';
const USER_THEME = 'dark';

const settingsJson = (doc) => JSON.stringify(doc, null, 2) + '\n';
const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The settings file the installer writes for a scope (claude-code harness only).
function settingsFileFor(sc, scope) {
  return scope === 'global'
    ? path.join(sc.home, '.claude', 'settings.json')
    : path.join(sc.cwd, '.claude', 'settings.local.json');
}

// Text the settings file must have after uninstall: every Agent(five-role-team:<id>) allow entry
// dropped, and every other key and entry kept in order.
function settingsTextAfterUninstall(text) {
  const doc = JSON.parse(text);
  doc.permissions.allow = doc.permissions.allow.filter((r) => !AGENT_RULE_RE.test(r));
  return settingsJson(doc);
}

// lstat-based: true for a symlink even when its target is gone.
function present(p) {
  return fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Every entry under base (base included), keyed by absolute path. Symlinks are recorded by
// their target and never followed. Files are recorded by content hash. Entries whose absolute
// path equals skipAbs are left out entirely.
function snapshotTree(base, skipAbs) {
  const out = new Map();
  if (!present(base)) return out;
  out.set(base, 'dir');
  const rec = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      if (skipAbs && abs === skipAbs) continue;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        out.set(abs, `link:${fs.readlinkSync(abs)}`);
      } else if (st.isDirectory()) {
        out.set(abs, 'dir');
        rec(abs);
      } else if (st.isFile()) {
        out.set(abs, `file:${sha256(abs)}`);
      } else {
        out.set(abs, 'other');
      }
    }
  };
  rec(base);
  return out;
}

// Sandbox state: the scenario home, and the scenario cwd minus plugin-src (the source copy is
// checked separately by checksum).
function snapshotSandbox(sc, src) {
  return new Map([...snapshotTree(sc.home, null), ...snapshotTree(sc.cwd, src)]);
}

// Map of entries in `map` that are not at or under any of `roots`.
function withoutUnder(map, roots) {
  return new Map([...map].filter(([k]) => !roots.some((r) => k === r || k.startsWith(r + path.sep))));
}

// Human-readable differences between two snapshots (empty when equal).
function diffMaps(before, after) {
  const d = [];
  for (const [k, v] of before) {
    if (!after.has(k)) d.push(`missing ${k}`);
    else if (after.get(k) !== v) d.push(`changed ${k}`);
  }
  for (const k of after.keys()) {
    if (!before.has(k)) d.push(`unexpected ${k}`);
  }
  return d;
}

// Entries (relative to the scenario dir) that look like uninstall leftovers.
function leftovers(map, scenarioDir) {
  const bad = [];
  for (const k of map.keys()) {
    const rel = path.relative(scenarioDir, k);
    const comps = rel.split(path.sep);
    const suspect = comps.some((c) => c === 'five-role-team' || c === '.agent-config.json' ||
      c.includes('.five-role-team.backup') || /\.(tmp|bak)$|^\.tmp|~$/.test(c));
    if (suspect) bad.push(rel);
  }
  return bad;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (err) { return null; }
}

// Refuse to uninstall unless HOME and cwd resolve inside this sandbox and not to the real home.
function assertUninstallSandboxed(sb, sc) {
  for (const p of [sc.home, sc.cwd]) {
    const real = fs.realpathSync(p);
    if (real === REAL_HOME) throw new Error(`refusing to run uninstall: ${p} resolves to the real home`);
    if (!(real === sb.root || real.startsWith(sb.root + path.sep))) {
      throw new Error(`refusing to run uninstall: ${p} is outside the sandbox root ${sb.root}`);
    }
  }
  if (sc.env.HOME !== sc.home) throw new Error('refusing to run uninstall: explicit sandbox HOME is missing');
}

// Run one cell. Returns { ok, checks, problems }. Never throws for a layout mismatch.
function runCell(sb, cell) {
  const problems = [];
  let checks = 0;
  const need = (cond, msg) => {
    checks += 1;
    if (!cond) problems.push(msg);
  };

  const sc = sb.scenario(`uninst-${cell.key.replace(/\//g, '-')}`);
  const scenarioDir = path.dirname(sc.home);
  const src = path.join(sc.cwd, 'plugin-src');
  copyPluginSource(src, SOURCE);
  const srcBefore = snapshotTree(src, null);

  // ---- install ----
  const ir = sb.run(installArgv(src, cell), { home: sc.home, cwd: sc.cwd });
  need(ir.status === 0, `install exit 0 (got ${ir.status}): ${ir.stderr.trim().split('\n').slice(-2).join(' | ')}`);
  need(/^Installation successful/m.test(ir.stdout), 'install printed the success message');
  if (ir.status !== 0) return { ok: false, checks, problems };

  const primary = primaryPath(sc, cell);
  const secondary = secondaryPath(sc, cell);
  const cursorFlat = cell.harness === 'cursor' ? cursorAgentsPath(sc, cell) : null;
  const expectedCursorAgents = cell.harness === 'cursor'
    ? (cell.mode === 'link' ? ALL_CURSOR_AGENTS : (cell.agents === 'subset' ? [...SUBSET] : ALL_CURSOR_AGENTS))
    : [];
  const cursorAgentFiles = cursorFlat
    ? expectedCursorAgents.map((id) => path.join(cursorFlat, `${id}.md`))
    : [];
  const roots = [primary, ...(secondary ? [secondary] : []), ...cursorAgentFiles];
  const parents = [...new Set(roots.map((r) => path.dirname(r)))];
  need(present(primary), `install created the primary at ${primary}`);
  if (secondary) need(present(secondary), 'install created the pi secondary symlink');
  if (cursorFlat) {
    for (const f of cursorAgentFiles) need(present(f), `install created Cursor agent file ${f}`);
  }

  // ---- sibling content in every skills dir the install used ----
  for (const dir of parents) {
    fs.mkdirSync(path.join(dir, SIB_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, SIB_DIR, 'SKILL.md'), SIB_SKILL);
    fs.writeFileSync(path.join(dir, SIB_FILE), SIB_FILE_TEXT);
  }
  if (cursorFlat) {
    fs.writeFileSync(path.join(cursorFlat, 'custom-agent.md'), '# unrelated agent, must survive uninstall\n');
  }

  // ---- claude-code: user content in the settings file, which uninstall must keep ----
  const settingsFile = cell.harness === 'claude-code' ? settingsFileFor(sc, cell.scope) : null;
  let settingsAfterText = null;
  let agentRuleCount = 0;
  if (settingsFile) {
    need(present(settingsFile), `claude-code install wrote the settings file ${settingsFile}`);
    if (present(settingsFile)) {
      const doc = JSON.parse(readText(settingsFile));
      doc.permissions.allow.push(USER_ALLOW);
      doc.permissions.deny = [USER_DENY];
      doc.theme = USER_THEME;
      fs.writeFileSync(settingsFile, settingsJson(doc));
      const text = readText(settingsFile);
      agentRuleCount = doc.permissions.allow.filter((r) => AGENT_RULE_RE.test(r)).length;
      settingsAfterText = settingsTextAfterUninstall(text);
      // --link allows the whole catalog whatever --agents says (design D2).
      const expectedAgents = cell.mode === 'link' || cell.agents === 'all' ? ALL_CURSOR_AGENTS.length : SUBSET.length;
      need(agentRuleCount === expectedAgents,
        `settings file holds one agent rule per installed agent (got ${agentRuleCount})`);
    }
  }
  const before = snapshotSandbox(sc, src);

  // ---- first uninstall ----
  assertUninstallSandboxed(sb, sc);
  const u = sb.run(uninstallArgv(src, cell), { home: sc.home, cwd: sc.cwd });
  need(u.status === 0, `uninstall exit 0 (got ${u.status}): ${u.text.trim().split('\n').slice(-2).join(' | ')}`);
  need(u.stderr.trim() === '', 'uninstall printed no error output');
  if (cell.mode === 'copy') {
    need(/^Removed installation at /m.test(u.stdout), 'copy: uninstall reports the removed installation');
    need(/^Removed .*\.agent-config\.json$/m.test(u.stdout), 'copy: uninstall reports .agent-config.json removed');
  } else {
    need(/^Removed symlink /m.test(u.stdout), 'link: uninstall reports the removed symlink');
    need(/^Source directory .* was left untouched\./m.test(u.stdout), 'link: uninstall reports the source left untouched');
  }
  if (secondary) need(/^Removed pi secondary symlink /m.test(u.stdout), 'pi global: uninstall reports the secondary removed');
  if (cursorFlat) {
    for (const id of expectedCursorAgents) {
      need(new RegExp(`^Removed .*${id}\\.md$`, 'm').test(u.stdout), `cursor: uninstall reports ${id}.md removed`);
    }
  }

  // Primary gone (copy dir incl. .agent-config.json, or the link).
  need(!present(primary), 'primary install is gone');
  if (secondary) need(!present(secondary), 'pi global: ~/.pi/agent/skills/five-role-team secondary symlink is gone');
  if (cursorFlat) {
    for (const f of cursorAgentFiles) need(!present(f), `cursor agent file gone: ${f}`);
    need(present(path.join(cursorFlat, 'custom-agent.md')), 'unrelated .cursor/agents/custom-agent.md survives');
  }

  // Parent skills dirs still exist as directories, and the siblings survive unchanged.
  for (const dir of parents) {
    const st = fs.lstatSync(dir, { throwIfNoEntry: false });
    need(st !== undefined && st.isDirectory(), `parent skills dir still exists: ${dir}`);
    need(readText(path.join(dir, SIB_DIR, 'SKILL.md')) === SIB_SKILL, `sibling dir survives: ${path.join(dir, SIB_DIR)}`);
    need(readText(path.join(dir, SIB_FILE)) === SIB_FILE_TEXT, `sibling file survives: ${path.join(dir, SIB_FILE)}`);
  }

  // claude-code: only the agent rules are gone; git rules, user rules and other keys remain.
  if (settingsFile && settingsAfterText !== null) {
    const line = u.stdout.match(/^Claude Code permissions: removed (\d+) rule\(s\) from (.+) \((.+)\)$/m);
    need(line !== null && Number(line[1]) === agentRuleCount,
      `uninstall prints "removed ${agentRuleCount} rule(s)" for the settings file (got ${line ? line[1] : 'no line'})`);
    need(line !== null && fs.realpathSync(line[2]) === fs.realpathSync(settingsFile),
      'permissions line names the settings file');
    need(line !== null && line[3].split(', ').length === agentRuleCount,
      'permissions line lists each removed agent rule');
    const afterText = readText(settingsFile);
    need(afterText === settingsAfterText, 'settings file: only Agent(five-role-team:*) rules removed, all else byte-identical');
    const doc = afterText === null ? {} : JSON.parse(afterText);
    const allow = (doc.permissions && doc.permissions.allow) || [];
    need(!allow.some((r) => AGENT_RULE_RE.test(r)), 'settings file: no Agent(five-role-team:*) rule left');
    need(GIT_RULES.every((r) => allow.includes(r)), 'settings file: all six git Bash rules kept');
    need(allow.includes(USER_ALLOW) && JSON.stringify(doc.permissions.deny) === JSON.stringify([USER_DENY]),
      'settings file: user allow rule and deny rule kept');
    need(doc.theme === USER_THEME, 'settings file: unrelated top-level key kept');
  }

  // Sandbox: exactly the pre-uninstall state minus the primary and secondary entries, with the
  // settings file (claude-code) holding its expected text.
  const after = snapshotSandbox(sc, src);
  const expected = withoutUnder(before, roots);
  if (settingsFile && settingsAfterText !== null) {
    expected.set(settingsFile, `file:${sha256Text(settingsAfterText)}`);
  }
  const diffs = diffMaps(expected, after);
  need(diffs.length === 0, `sandbox unchanged apart from the installation (${diffs.length} difference(s): ${diffs.slice(0, 3).join('; ')})`);
  const left = leftovers(after, scenarioDir);
  need(left.length === 0, `no leftover backups, temp files or install entries (found ${left.slice(0, 3).join(', ')})`);

  // Source tree unchanged (link mode must not have touched the source it pointed at).
  const srcAfter = snapshotTree(src, null);
  const srcDiffs = diffMaps(srcBefore, srcAfter);
  need(srcDiffs.length === 0, `source tree unchanged (${srcDiffs.length} difference(s): ${srcDiffs.slice(0, 3).join('; ')})`);
  need(present(path.join(src, 'install.js')) && present(path.join(src, 'agents')), 'source copy still present');

  // ---- second uninstall: nothing to remove ----
  const beforeSecond = snapshotSandbox(sc, src);
  assertUninstallSandboxed(sb, sc);
  const u2 = sb.run(uninstallArgv(src, cell), { home: sc.home, cwd: sc.cwd });
  need(u2.status === 1, `second uninstall exit 1 (got ${u2.status})`);
  need(/Nothing to uninstall/.test(u2.text), 'second uninstall says "Nothing to uninstall"');
  const secondDiffs = diffMaps(beforeSecond, snapshotSandbox(sc, src));
  need(secondDiffs.length === 0, `second uninstall removed nothing (${secondDiffs.length} difference(s))`);
  const srcAfter2 = snapshotTree(src, null);
  need(diffMaps(srcBefore, srcAfter2).length === 0, 'source tree still unchanged after the second uninstall');

  return { ok: problems.length === 0, checks, problems };
}

// Settings-step scenarios the matrix does not cover (claude-code, local scope): a malformed file,
// the --no-permissions opt-out, rules of deselected agents, and no installation present. Each runs
// in its own scenario sandbox. Returns [{ name, ok, problems }].
function runSettingsScenarios(sb) {
  const cases = [];
  const runCase = (name, fn) => {
    const problems = [];
    const need = (cond, msg) => { if (!cond) problems.push(msg); };
    try {
      fn(need, sb.scenario(name));
    } catch (err) {
      problems.push(`unexpected error: ${err && err.message ? err.message : err}`);
    }
    cases.push({ name, ok: problems.length === 0, problems });
  };

  // Copy the plugin source into the scenario and run install.js from the copy.
  const copySource = (sc) => {
    const src = path.join(sc.cwd, 'plugin-src');
    copyPluginSource(src, SOURCE);
    return src;
  };
  const installLocal = (sc, src, need) => {
    const r = sb.run([path.join(src, 'install.js'), 'init', '--local', '--harness', 'claude-code',
      '--agents', 'worker,reviewer'], { home: sc.home, cwd: sc.cwd });
    need(r.status === 0, `install exit 0 (got ${r.status})`);
  };
  const uninstallLocal = (sc, src, extra = []) => {
    assertUninstallSandboxed(sb, sc);
    return sb.run([path.join(src, 'install.js'), 'uninstall', '--local', '--harness', 'claude-code', ...extra],
      { home: sc.home, cwd: sc.cwd });
  };
  const primaryLocal = (sc) => path.join(sc.cwd, '.claude', 'skills', 'five-role-team');

  const badSettings = [
    ['settings-malformed-json', '{ "permissions": { "allow": [ "Agent(five-role-team:worker)", \n'],
    ['settings-allow-not-array', '{ "permissions": { "allow": "Agent(five-role-team:worker)" } }\n'],
  ];
  for (const [name, badText] of badSettings) {
    runCase(name, (need, sc) => {
      const src = copySource(sc);
      installLocal(sc, src, need);
      const file = settingsFileFor(sc, 'local');
      fs.writeFileSync(file, badText);
      const u = uninstallLocal(sc, src);
      need(u.status === 0, `uninstall exit 0 with a malformed settings file (got ${u.status})`);
      need(/^Warning: Claude Code permissions were not removed from .+settings\.local\.json: /m.test(u.stdout),
        'warning names the settings file and the reason');
      need(/Remove the Agent\(five-role-team:<id>\) entries/.test(u.stdout), 'warning says to remove the rules by hand');
      need(readText(file) === badText, 'malformed settings file left byte-identical');
      need(!present(primaryLocal(sc)), 'installation still removed');
    });
  }

  runCase('settings-uninstall-no-permissions', (need, sc) => {
    const src = copySource(sc);
    installLocal(sc, src, need);
    const file = settingsFileFor(sc, 'local');
    const before = readText(file);
    const u = uninstallLocal(sc, src, ['--no-permissions']);
    need(u.status === 0, `uninstall --no-permissions exit 0 (got ${u.status})`);
    need(!/Claude Code permissions:/.test(u.text), '--no-permissions prints no permissions line');
    need(readText(file) === before, '--no-permissions leaves the settings file byte-identical');
    need(!present(primaryLocal(sc)), 'installation still removed with --no-permissions');
  });

  runCase('settings-removes-deselected-agent-rules', (need, sc) => {
    const src = copySource(sc);
    installLocal(sc, src, need);
    const file = settingsFileFor(sc, 'local');
    const doc = JSON.parse(readText(file));
    doc.permissions.allow.push('Agent(five-role-team:retired-agent)', 'Agent(other-plugin:worker)');
    fs.writeFileSync(file, settingsJson(doc));
    const u = uninstallLocal(sc, src);
    need(u.status === 0, `uninstall exit 0 (got ${u.status})`);
    const line = u.stdout.match(/^Claude Code permissions: removed (\d+) rule\(s\) from /m);
    need(line !== null && Number(line[1]) === 3,
      `removes the two installed agent rules and the deselected one, 3 in all (got ${line ? line[1] : 'no line'})`);
    const allow = JSON.parse(readText(file)).permissions.allow;
    need(!allow.includes('Agent(five-role-team:retired-agent)'), 'deselected-agent rule removed');
    need(allow.includes('Agent(other-plugin:worker)'), 'rule for another plugin kept');
    need(GIT_RULES.every((r) => allow.includes(r)), 'all six git Bash rules kept');
  });

  runCase('settings-nothing-installed-untouched', (need, sc) => {
    const src = copySource(sc);
    const file = settingsFileFor(sc, 'local');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = settingsJson({ permissions: { allow: ['Agent(five-role-team:worker)', ...GIT_RULES, USER_ALLOW] } });
    fs.writeFileSync(file, text);
    const u = uninstallLocal(sc, src);
    need(u.status === 1, `uninstall with nothing installed exit 1 (got ${u.status})`);
    need(/Nothing to uninstall/.test(u.text), 'says "Nothing to uninstall"');
    need(readText(file) === text, 'settings file byte-identical when nothing was uninstalled');
  });

  return cases;
}

function main() {
  const sb = createSandbox();
  const ran = [];
  let passed = 0;
  let failed = 0;
  let settingsPassed = 0;
  let settingsFailed = 0;
  let coverageOk = true;
  const coverageFail = (msg) => { coverageOk = false; console.log(`FAIL coverage: ${msg}`); };

  try {
    for (const cell of MATRIX) {
      let res;
      try {
        res = runCell(sb, cell);
      } catch (err) {
        res = { ok: false, checks: 0, problems: [`unexpected error: ${err && err.message ? err.message : err}`] };
      }
      ran.push(cell.key);
      if (res.ok) {
        passed += 1;
        console.log(`PASS ${cell.key} (${res.checks} checks)`);
      } else {
        failed += 1;
        console.log(`FAIL ${cell.key}`);
        res.problems.forEach((p) => console.log(`  - ${p}`));
      }
    }
    for (const c of runSettingsScenarios(sb)) {
      if (c.ok) {
        settingsPassed += 1;
        console.log(`PASS settings: ${c.name}`);
      } else {
        settingsFailed += 1;
        console.log(`FAIL settings: ${c.name}`);
        c.problems.forEach((p) => console.log(`  - ${p}`));
      }
    }
  } finally {
    sb.cleanup();
    if (fs.existsSync(sb.root)) coverageFail(`sandbox root ${sb.root} not removed`);
  }

  // Coverage: the matrix must be exactly the literal axes, and every expected cell must run.
  const axesMatch = ['scope', 'harness', 'mode', 'agents'].every((k) => sameList(MATRIX_AXES[k], EXPECTED_AXES[k]));
  if (!axesMatch) coverageFail('matrix axes differ from scope {global,local} x harness {pi,claude-code,cursor} x mode {copy,link} x agents {all,subset}');
  const expectedKeys = cellsFrom(EXPECTED_AXES).map((c) => c.key);
  if (expectedKeys.length !== EXPECTED_CELLS) coverageFail(`expected cell list has ${expectedKeys.length} cells, not ${EXPECTED_CELLS}`);
  if (MATRIX.length !== EXPECTED_CELLS) coverageFail(`matrix has ${MATRIX.length} cells, not ${EXPECTED_CELLS}`);
  const ranSet = new Set(ran);
  const missing = expectedKeys.filter((k) => !ranSet.has(k));
  if (missing.length > 0) coverageFail(`cells not exercised: ${missing.join(', ')}`);
  if (ran.length !== EXPECTED_CELLS) coverageFail(`exercised ${ran.length} cells, not ${EXPECTED_CELLS}`);
  if (coverageOk) console.log(`COVERAGE: ok, every one of the ${EXPECTED_CELLS} cells was exercised`);

  console.log(`SETTINGS: ${settingsPassed} passed, ${settingsFailed} failed (Claude Code settings scenarios)`);
  console.log(`SUMMARY: exercised ${ran.length} of ${EXPECTED_CELLS} uninstall modes; ${passed} passed, ${failed} failed`);
  const ok = failed === 0 && settingsFailed === 0 && coverageOk && ran.length === EXPECTED_CELLS;
  // exitCode rather than process.exit(): exit() can drop buffered output on pipes.
  process.exitCode = ok ? 0 : 1;
}

main();
