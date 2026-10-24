#!/usr/bin/env node
'use strict';
// Verify task 7.3: uninstall removes only the five-role-team directory (or its
// symlink) and never the parent skills directory or anything next to it, and it
// refuses dangerous resolved targets (the source checkout, its ancestors, a skills
// directory or one of its ancestors, `/`, `.`, a path not named five-role-team).
//
// Checks:
//   - CLI matrix (global/local x copy/link x claude-code/pi): after uninstall the
//     parent skills directory still exists and a sibling skill inside it is intact.
//     For pi global the ~/.pi/agent/skills directory and its sibling survive too.
//   - Custom harness paths (absolute, trailing slash, `..` segment, `.` and `..`
//     relative to cwd, not installed): only the five-role-team entry is removed.
//   - Dangerous targets through the exported functions (uninstallInstall, main):
//     refused with nothing removed.
//
// SANDBOXED ONLY. This script:
//   - captures the real home directory, then points HOME/USERPROFILE at a fresh
//     temp directory and chdirs into a temp work folder before anything else;
//   - aborts (exit 2, nothing removed) if HOME or cwd ever resolves outside the
//     sandbox or to the real home;
//   - runs the CLI only as a child process with that sandboxed HOME and cwd;
//   - never passes the real checkout or the real home to a removal call. Every
//     dangerous-path case uses sandbox-only paths (a fake source checkout inside
//     the sandbox, and a path that is refused before anything is touched).
// Nothing touches the real ~/.claude or ~/.pi.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = __dirname;
const PLUGIN = 'five-role-team';
const CFG = '.agent-config.json';

// 1. Capture the real home BEFORE HOME is changed.
const REAL_HOME = fs.realpathSync(os.homedir());

// 2. Create the sandbox and point HOME/cwd at it.
const TMP_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-7-3-')));
const SANDBOX_HOME = path.join(TMP_ROOT, 'home');
const SANDBOX_WORK = path.join(TMP_ROOT, 'work');
fs.mkdirSync(SANDBOX_HOME, { recursive: true });
fs.mkdirSync(SANDBOX_WORK, { recursive: true });
process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;
process.chdir(SANDBOX_WORK);

// 3. Guard: refuse to run if HOME resolves to the real home or the cwd is not the sandbox.
function assertSandboxed() {
  const resolvedHome = fs.realpathSync(os.homedir());
  const resolvedCwd = fs.realpathSync(process.cwd());
  const inTmp = (p) => p === TMP_ROOT || p.startsWith(TMP_ROOT + path.sep);
  if (resolvedHome === REAL_HOME || !inTmp(resolvedHome) || !inTmp(resolvedCwd)) {
    console.error(`ABORT: sandbox guard tripped (home=${resolvedHome}, cwd=${resolvedCwd}, realHome=${REAL_HOME}). Nothing was removed.`);
    process.exit(2);
  }
}
assertSandboxed();

// Guard for any HOME handed to a child process: it must be inside the sandbox.
function assertChildHomeSandboxed(home) {
  const resolved = path.resolve(home);
  if (resolved === REAL_HOME || !(resolved === TMP_ROOT || resolved.startsWith(TMP_ROOT + path.sep))) {
    console.error(`ABORT: child HOME ${resolved} is outside the sandbox. Nothing was removed.`);
    process.exit(2);
  }
}

const REAL_CONFIG_BEFORE = fs.existsSync(path.join(SRC, CFG));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('OK:', msg);
}
const lst = (p) => fs.lstatSync(p, { throwIfNoEntry: false });
const isRealDir = (p) => { const s = lst(p); return !!s && s.isDirectory() && !s.isSymbolicLink(); };
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (err) { return null; } };
const thrown = (fn) => { try { fn(); return null; } catch (err) { return err.message; } };

// Run the real CLI entry point as a child process with the given sandbox HOME and
// cwd. Input is empty so an unexpected prompt cannot be answered.
function cliRun(home, work, args) {
  assertSandboxed();
  assertChildHomeSandboxed(home);
  const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), ...args], {
    cwd: work,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input: '',
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  return { status: r.status, out, err, text: out + err };
}

// Fresh sandbox scenario folders so runs cannot interact.
function resetScenario(name) {
  const root = path.join(TMP_ROOT, name);
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  return { root, home, work };
}

const install = (home, work, scope, harness, extra = []) =>
  cliRun(home, work, [scope, '--harness', harness, '--agents', 'architect,worker', ...extra]);
const uninstall = (home, work, scope, harness) =>
  cliRun(home, work, ['uninstall', scope, '--harness', harness]);

// A sibling skill that must survive every uninstall in its parent skills directory.
function plantSibling(skillsDir) {
  const dir = path.join(skillsDir, 'sibling-skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'sibling\n');
  return dir;
}
function assertSiblingIntact(label, siblingDir) {
  assert(readOr(path.join(siblingDir, 'SKILL.md')) === 'sibling\n', `${label}: sibling skill kept with its contents`);
}

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

async function main73() {
  // ---------------------------------------------------------------------------
  // A. CLI matrix: parent skills directory and sibling survive uninstall.
  // ---------------------------------------------------------------------------
  const MATRIX = [
    { name: 'global claude-code copy', scope: '--global', harness: 'claude-code', link: false,
      base: (h) => path.join(h, '.claude', 'skills') },
    { name: 'global claude-code link', scope: '--global', harness: 'claude-code', link: true,
      base: (h) => path.join(h, '.claude', 'skills') },
    { name: 'global pi copy', scope: '--global', harness: 'pi', link: false,
      base: (h) => path.join(h, '.claude', 'skills') },
    { name: 'global pi link', scope: '--global', harness: 'pi', link: true,
      base: (h) => path.join(h, '.claude', 'skills') },
    { name: 'local claude-code copy', scope: '--local', harness: 'claude-code', link: false,
      base: (h, w) => path.join(w, '.claude', 'skills') },
    { name: 'local claude-code link', scope: '--local', harness: 'claude-code', link: true,
      base: (h, w) => path.join(w, '.claude', 'skills') },
    { name: 'local pi copy', scope: '--local', harness: 'pi', link: false,
      base: (h, w) => path.join(w, '.pi', 'skills') },
    { name: 'local pi link', scope: '--local', harness: 'pi', link: true,
      base: (h, w) => path.join(w, '.pi', 'skills') },
  ];

  for (const c of MATRIX) {
    const { home, work } = resetScenario('matrix-' + slug(c.name));
    const base = c.base(home, work);
    const primary = path.join(base, PLUGIN);
    const sibling = plantSibling(base);
    const globalPi = c.harness === 'pi' && c.scope === '--global';
    const piSkills = path.join(home, '.pi', 'agent', 'skills');
    const piSibling = globalPi ? plantSibling(piSkills) : null;
    const srcSkillBefore = readOr(path.join(SRC, 'SKILL.md'));

    const inst = install(home, work, c.scope, c.harness, c.link ? ['--link'] : []);
    assert(inst.status === 0 && lst(primary), `${c.name}: setup install exits 0 with ${primary} (got ${inst.status}; ${inst.err.trim()})`);

    const un = uninstall(home, work, c.scope, c.harness);
    assert(un.status === 0, `${c.name}: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, `${c.name}: five-role-team entry removed`);
    assert(isRealDir(base), `${c.name}: parent skills directory ${base} still exists`);
    assertSiblingIntact(c.name, sibling);
    if (globalPi) {
      assert(lst(path.join(piSkills, PLUGIN)) === undefined, `${c.name}: pi secondary symlink removed`);
      assert(isRealDir(piSkills), `${c.name}: parent ~/.pi/agent/skills directory still exists`);
      assertSiblingIntact(`${c.name} (pi skills)`, piSibling);
    }
    if (c.link) {
      assert(readOr(path.join(SRC, 'SKILL.md')) === srcSkillBefore, `${c.name}: source SKILL.md unchanged`);
    }
  }

  // ---------------------------------------------------------------------------
  // B. Custom harness paths (not installed by name): only five-role-team goes.
  // ---------------------------------------------------------------------------
  const CUSTOM = [
    { name: 'custom absolute copy', scope: '--global', harness: (s) => `${s.root}/custom-a/skills`,
      base: (s) => `${s.root}/custom-a/skills`, link: false },
    { name: 'custom trailing slash copy', scope: '--global', harness: (s) => `${s.root}/custom-b/skills/`,
      base: (s) => `${s.root}/custom-b/skills`, link: false },
    { name: 'custom dot-dot link', scope: '--global', harness: (s) => `${s.root}/custom-c/x/../skills`,
      base: (s) => `${s.root}/custom-c/skills`, link: true },
    { name: 'local dot harness copy', scope: '--local', harness: () => '.',
      base: (s) => s.work, link: false },
    { name: 'local dot-dot harness link', scope: '--local', harness: () => '..',
      base: (s) => path.dirname(s.work), link: true },
  ];
  for (const c of CUSTOM) {
    const s = resetScenario('custom-' + slug(c.name));
    const base = c.base(s);
    const primary = path.join(base, PLUGIN);
    const sibling = plantSibling(base);
    const harness = c.harness(s);
    const inst = install(s.home, s.work, c.scope, harness, c.link ? ['--link'] : []);
    assert(inst.status === 0 && lst(primary), `${c.name}: setup install exits 0 at ${primary} (got ${inst.status}; ${inst.err.trim()})`);

    const un = uninstall(s.home, s.work, c.scope, harness);
    assert(un.status === 0, `${c.name}: uninstall exits 0 (got ${un.status}; ${un.text.trim()})`);
    assert(lst(primary) === undefined, `${c.name}: five-role-team entry removed`);
    assert(isRealDir(base), `${c.name}: parent ${base} still exists`);
    assertSiblingIntact(c.name, sibling);
  }

  // B2. Custom path with nothing installed: exit 1, the parent and its sibling are kept.
  {
    const s = resetScenario('custom-absent');
    const base = path.join(s.root, 'none', 'skills');
    const sibling = plantSibling(base);
    const un = uninstall(s.home, s.work, '--global', `${base}/`);
    assert(un.status === 1 && /Error: Nothing to uninstall/.test(un.err), `custom absent: exit 1 with "Nothing to uninstall" (got ${un.status}; ${un.text.trim()})`);
    assert(isRealDir(base) && lst(path.join(base, PLUGIN)) === undefined, 'custom absent: parent kept, nothing created');
    assertSiblingIntact('custom absent', sibling);
  }

  // ---------------------------------------------------------------------------
  // C. Dangerous targets through the exported functions. Every path is inside
  //    the sandbox. Each refusal must happen before anything is removed.
  // ---------------------------------------------------------------------------
  const { uninstallInstall } = require(path.join(SRC, 'install-files.js'));
  const { main } = require(path.join(SRC, 'install.js'));
  const C = path.join(TMP_ROOT, 'refusals');
  fs.mkdirSync(C, { recursive: true });

  // C1. The target IS the source checkout (sandbox copy named five-role-team).
  const fakeSrc = path.join(C, 'src', PLUGIN);
  fs.mkdirSync(fakeSrc, { recursive: true });
  fs.writeFileSync(path.join(fakeSrc, 'SKILL.md'), 'source\n');
  fs.writeFileSync(path.join(fakeSrc, 'marker.txt'), 'keep\n');
  let msg = thrown(() => uninstallInstall(fakeSrc, { sourceDir: fakeSrc, expected: fakeSrc }));
  assert(msg && /it is, or contains, the plugin source directory/.test(msg), 'refusal: target equal to source checkout is refused');
  assert(readOr(path.join(fakeSrc, 'marker.txt')) === 'keep\n', 'refusal: source checkout contents untouched');

  // C2. The target is an ancestor of the source checkout (inner-src is inside it).
  const anc = path.join(C, 'anc', PLUGIN);
  const innerSrc = path.join(anc, 'inner-src');
  fs.mkdirSync(innerSrc, { recursive: true });
  fs.writeFileSync(path.join(innerSrc, 'marker.txt'), 'keep\n');
  msg = thrown(() => uninstallInstall(anc, { sourceDir: innerSrc, expected: anc }));
  assert(msg && /it is, or contains, the plugin source directory/.test(msg), 'refusal: target containing the source checkout is refused');
  assert(readOr(path.join(innerSrc, 'marker.txt')) === 'keep\n', 'refusal: source inside the refused ancestor untouched');

  // C3. Same ancestor reached through a `..` segment and a trailing slash, via main.
  {
    const harness = `${C}/anc/x/..`;
    const logs = [];
    const errs = [];
    const r = await main(['uninstall', '--global', '--harness', harness], {
      sourceDir: innerSrc, log: (l) => logs.push(l), error: (l) => errs.push(l),
    });
    assert(r.exitCode === 1 && errs.some((l) => /Refusing to remove/.test(l)), `refusal: main with "${harness}" (ancestor of source) exits 1 with Refusing (got ${r.exitCode})`);
    assert(readOr(path.join(innerSrc, 'marker.txt')) === 'keep\n' && isRealDir(anc), 'refusal: ancestor-of-source and its contents kept');
  }
  {
    const harness = `${C}/src/`;
    const logs = [];
    const errs = [];
    const r = await main(['uninstall', '--global', '--harness', harness], {
      sourceDir: fakeSrc, log: (l) => logs.push(l), error: (l) => errs.push(l),
    });
    assert(r.exitCode === 1 && errs.some((l) => /Refusing to remove/.test(l)), `refusal: main with "${harness}" (equal to source) exits 1 with Refusing (got ${r.exitCode})`);
    assert(readOr(path.join(fakeSrc, 'marker.txt')) === 'keep\n', 'refusal: source checkout kept after main refusal');
  }

  // C4. Root, cwd and a custom skills directory: basename is not five-role-team.
  msg = thrown(() => uninstallInstall('/', { sourceDir: fakeSrc }));
  assert(msg && /not a five-role-team installation path/.test(msg), 'refusal: root "/" is refused (basename check)');
  msg = thrown(() => uninstallInstall('.', { sourceDir: fakeSrc }));
  assert(msg && /not a five-role-team installation path/.test(msg) && isRealDir(SANDBOX_WORK), 'refusal: "." (cwd, basename "work") is refused and kept');
  const customSkills = path.join(C, 'x', 'skills');
  const customSibling = plantSibling(customSkills);
  msg = thrown(() => uninstallInstall(customSkills, { sourceDir: fakeSrc }));
  assert(msg && /not a five-role-team installation path/.test(msg), 'refusal: a custom skills directory is refused');
  assertSiblingIntact('refusal custom skills dir', customSibling);

  // C5. A target that is an ancestor of a protected skills directory is refused;
  //     a target that is not an ancestor of one is removed normally.
  const protTarget = path.join(C, 'p', PLUGIN);
  const protSkills = path.join(protTarget, '.claude', 'skills');
  const protSibling = plantSibling(protSkills);
  msg = thrown(() => uninstallInstall(protTarget, { sourceDir: fakeSrc, expected: protTarget, protect: [protSkills] }));
  assert(msg && /it is, or contains, the skills directory/.test(msg), 'refusal: target containing a protected skills directory is refused');
  assertSiblingIntact('refusal protected skills dir', protSibling);

  const okTarget = path.join(C, 'ok', 'skills', PLUGIN);
  const okParent = path.join(C, 'ok', 'skills');
  const okSibling = plantSibling(okParent);
  fs.mkdirSync(okTarget, { recursive: true });
  fs.writeFileSync(path.join(okTarget, 'placeholder.txt'), 'x\n');
  const removed = uninstallInstall(okTarget, { sourceDir: fakeSrc, expected: okTarget, protect: [okParent, protSkills] });
  assert(removed && removed.kind === 'directory' && lst(okTarget) === undefined, 'protect: an unrelated five-role-team directory is still removed');
  assert(isRealDir(okParent), 'protect: parent skills directory kept after removal');
  assertSiblingIntact('protect unrelated removal', okSibling);

  // C6. HOME inside a five-role-team directory: the default ~/.claude/skills lives
  //     inside the target, so the CLI must refuse rather than remove it.
  {
    const s = resetScenario('home-inside-target');
    const inside = path.join(s.root, 'h', PLUGIN);
    const homeSkills = path.join(inside, '.claude', 'skills');
    const keep = plantSibling(homeSkills);
    assertChildHomeSandboxed(inside);
    const r = spawnSync(process.execPath, [path.join(SRC, 'install.js'), 'uninstall', '--global', '--harness', path.join(s.root, 'h')], {
      cwd: s.work,
      env: { ...process.env, HOME: inside, USERPROFILE: inside },
      input: '',
      encoding: 'utf8',
      timeout: 60000,
    });
    assert(r.status === 1 && /Refusing to remove/.test(r.stderr || ''), `refusal: CLI target containing ~/.claude/skills exits 1 with Refusing (got ${r.status})`);
    assertSiblingIntact('refusal default skills dir inside target', keep);
    assert(isRealDir(homeSkills), 'refusal: ~/.claude/skills inside the target kept');
  }

  // C7. The source checkout is never given a configuration file by any uninstall step.
  assert(REAL_CONFIG_BEFORE === fs.existsSync(path.join(SRC, CFG)), 'source checkout: no .agent-config.json created or removed in the repo');
  assert(fs.existsSync(path.join(SRC, 'SKILL.md')) && fs.existsSync(path.join(SRC, 'install.js')), 'source checkout: SKILL.md and install.js still present');
}

main73()
  .catch((err) => {
    console.error('FAIL: unexpected error:', err && err.stack ? err.stack : err);
    failed += 1;
  })
  .finally(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`);
      process.exit(1);
    }
    console.log('\nAll task 7.3 checks passed');
  });
