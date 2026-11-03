#!/usr/bin/env node
'use strict';
// Unit checks for claude-permissions.js (openspec change init-claude-permissions, task 1.1).
//
// Every file operation runs inside a verify-sandbox.js scenario (a temp HOME and temp cwd). The
// real HOME is never read or written, and the process environment is not changed.
//
// Covers:
//   - rule order (agent rules in the given order, then the six git Bash rules)
//   - pure merge: keeps other keys, deny entries and existing allow order; input not mutated
//   - create when the file is missing (with its .claude/ directory)
//   - idempotent re-apply leaves identical bytes
//   - a file that needs no change is not rewritten
//   - malformed JSON, non-object root, non-object permissions, non-array allow: bytes unchanged,
//     status 'warned' with a reason, and no throw
//   - symlinked settings file is written through, not replaced
//   - removal takes only Agent(five-role-team:*) rules and keeps git Bash, user and other rules
//   - removal with a missing file, or with no agent rules, leaves the file alone
//   - settingsPathFor local and global mappings
//
// Exit 0 only when every check passes.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));
const P = require(path.join(__dirname, '..', 'claude-permissions.js'));

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

const GIT = [
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git rev-parse:*)',
  'Bash(git log:*)',
];

const sb = createSandbox();

// Fresh scenario directory pair. Its settings file lives at <cwd>/.claude/settings.local.json.
function fresh(name) {
  const s = sb.scenario(name);
  return { cwd: s.cwd, home: s.home, file: path.join(s.cwd, '.claude', 'settings.local.json') };
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function bytesOf(file) {
  return fs.readFileSync(file, 'utf8');
}

function run() {
  // --- rule order -------------------------------------------------------------------------
  const rules = P.buildPermissionRules(['worker', 'reviewer']);
  check(
    'rule order: agent rules in given order, then the six git Bash rules',
    isDeepStrictEqual(rules, [
      'Agent(five-role-team:worker)',
      'Agent(five-role-team:reviewer)',
      ...GIT,
    ]),
    JSON.stringify(rules),
  );
  check(
    'rule order: git rules are the fixed six in D2 order',
    isDeepStrictEqual([...P.GIT_BASH_RULES], GIT),
  );
  check(
    'rule order: empty agent list still yields the git rules',
    isDeepStrictEqual(P.buildPermissionRules([]), GIT),
  );

  // --- pure merge -------------------------------------------------------------------------
  const original = {
    env: { FOO: 'bar' },
    permissions: { allow: ['Bash(npm test:*)', 'Agent(five-role-team:worker)'], deny: ['Bash(rm -rf:*)'] },
    model: 'opus',
  };
  const originalSnapshot = JSON.stringify(original);
  const merged = P.mergeAllowRules(original, P.buildPermissionRules(['worker', 'reviewer']));
  check(
    'merge: input object is not mutated',
    JSON.stringify(original) === originalSnapshot,
  );
  check(
    'merge: reports only the rules that were missing, in rule order',
    isDeepStrictEqual(merged.added, ['Agent(five-role-team:reviewer)', ...GIT]),
    JSON.stringify(merged.added),
  );
  check(
    'merge: keeps existing allow entries first, in their order',
    isDeepStrictEqual(merged.settings.permissions.allow, [
      'Bash(npm test:*)',
      'Agent(five-role-team:worker)',
      'Agent(five-role-team:reviewer)',
      ...GIT,
    ]),
  );
  check(
    'merge: keeps deny, other top-level keys and key order',
    isDeepStrictEqual(merged.settings.permissions.deny, ['Bash(rm -rf:*)'])
      && isDeepStrictEqual(Object.keys(merged.settings), ['env', 'permissions', 'model']),
  );
  const onceMerged = P.mergeAllowRules(merged.settings, P.buildPermissionRules(['worker', 'reviewer']));
  check('merge: second merge adds nothing', onceMerged.added.length === 0);

  // --- create when missing ----------------------------------------------------------------
  {
    const s = fresh('create-missing');
    const res = P.applyClaudePermissions(s.file, ['worker', 'reviewer']);
    check('create: status is added', res.status === 'added', res.status);
    check('create: added every rule', isDeepStrictEqual(res.added, rules));
    check('create: .claude/ directory was created', fs.existsSync(path.dirname(s.file)));
    check(
      'create: result path is absolute and is the settings file',
      path.isAbsolute(res.path) && res.path === s.file,
      res.path,
    );
    const expected = JSON.stringify({ permissions: { allow: rules } }, null, 2) + '\n';
    check('create: bytes are 2-space JSON with a trailing newline', bytesOf(s.file) === expected);

    // --- idempotent re-apply -------------------------------------------------------------
    const before = bytesOf(s.file);
    const again = P.applyClaudePermissions(s.file, ['worker', 'reviewer']);
    check('re-apply: status is present', again.status === 'present', again.status);
    check('re-apply: adds nothing', again.added.length === 0);
    check('re-apply: bytes identical', bytesOf(s.file) === before);
  }

  // --- merge into an existing file ---------------------------------------------------------
  {
    const s = fresh('merge-existing');
    writeFile(s.file, JSON.stringify(original, null, 2) + '\n');
    const res = P.applyClaudePermissions(s.file, ['worker', 'reviewer']);
    const after = readJson(s.file);
    check('merge file: status is added with 7 rules', res.status === 'added' && res.added.length === 7,
      `${res.status} ${res.added.length}`);
    check('merge file: other keys and deny kept, key order kept',
      isDeepStrictEqual(Object.keys(after), ['env', 'permissions', 'model'])
        && isDeepStrictEqual(after.env, { FOO: 'bar' })
        && after.model === 'opus'
        && isDeepStrictEqual(after.permissions.deny, ['Bash(rm -rf:*)']));
    check('merge file: existing allow entries keep their order at the front',
      isDeepStrictEqual(after.permissions.allow.slice(0, 2), ['Bash(npm test:*)', 'Agent(five-role-team:worker)']));
    check('merge file: no rule appears twice',
      new Set(after.permissions.allow).size === after.permissions.allow.length);
  }

  // --- no rewrite when nothing changes -----------------------------------------------------
  {
    const s = fresh('no-rewrite');
    const hand = JSON.stringify({ permissions: { allow: [...rules] } }, null, 4);
    writeFile(s.file, hand);
    const res = P.applyClaudePermissions(s.file, ['worker', 'reviewer']);
    check('no rewrite: status is present', res.status === 'present', res.status);
    check('no rewrite: a file with every rule keeps its own formatting', bytesOf(s.file) === hand);
  }

  // --- malformed files: warned, bytes unchanged -------------------------------------------
  const malformed = [
    ['invalid JSON', '{ "permissions": { "allow": [ '],
    ['empty file', ''],
    ['root is an array', '[]'],
    ['root is null', 'null'],
    ['permissions is a string', '{ "permissions": "yes" }'],
    ['permissions is null', '{ "permissions": null }'],
    ['permissions.allow is a string', '{ "permissions": { "allow": "Bash(npm test:*)" } }'],
    ['permissions.allow is an object', '{ "permissions": { "allow": {} } }'],
  ];
  for (const [label, text] of malformed) {
    const s = fresh(`malformed-${label.replace(/[^a-z]+/g, '-')}`);
    writeFile(s.file, text);
    let res;
    let threw = false;
    try {
      res = P.applyClaudePermissions(s.file, ['worker', 'reviewer']);
    } catch (err) {
      threw = true;
    }
    check(`malformed apply (${label}): does not throw`, !threw);
    check(`malformed apply (${label}): status is warned`, res && res.status === 'warned', res && res.status);
    check(`malformed apply (${label}): reason is given`, res && typeof res.reason === 'string' && res.reason.length > 0);
    check(`malformed apply (${label}): rules to add by hand are listed`,
      res && isDeepStrictEqual(res.rules, rules));
    check(`malformed apply (${label}): bytes unchanged`, bytesOf(s.file) === text);

    let rmRes;
    let rmThrew = false;
    try {
      rmRes = P.removeClaudePermissions(s.file);
    } catch (err) {
      rmThrew = true;
    }
    check(`malformed remove (${label}): does not throw`, !rmThrew);
    check(`malformed remove (${label}): status is warned`, rmRes && rmRes.status === 'warned',
      rmRes && rmRes.status);
    check(`malformed remove (${label}): bytes unchanged`, bytesOf(s.file) === text);
  }

  // --- unreadable path: a parent that is a regular file -----------------------------------
  {
    const s = fresh('parent-is-file');
    writeFile(path.join(s.cwd, '.claude'), 'not a directory');
    let res;
    let threw = false;
    try {
      res = P.applyClaudePermissions(s.file, ['worker']);
    } catch (err) {
      threw = true;
    }
    check('unreadable apply: does not throw', !threw);
    check('unreadable apply: status is warned', res && res.status === 'warned', res && res.status);
    check('unreadable apply: nothing written under the file path', !fs.existsSync(s.file));
  }

  // --- symlinked settings file is written through -----------------------------------------
  {
    const s = fresh('symlink');
    const target = path.join(s.cwd, 'elsewhere', 'shared-settings.json');
    writeFile(target, JSON.stringify({ model: 'opus' }, null, 2) + '\n');
    fs.mkdirSync(path.dirname(s.file), { recursive: true });
    fs.symlinkSync(target, s.file);
    const res = P.applyClaudePermissions(s.file, ['worker']);
    check('symlink: status is added', res.status === 'added', res.status);
    check('symlink: link is still a symlink', fs.lstatSync(s.file).isSymbolicLink());
    const body = readJson(target);
    check('symlink: target file gained the rules and kept its keys',
      body.model === 'opus' && isDeepStrictEqual(body.permissions.allow, ['Agent(five-role-team:worker)', ...GIT]));
  }

  // --- removal ----------------------------------------------------------------------------
  {
    const s = fresh('remove-mixed');
    const mixed = {
      env: { FOO: 'bar' },
      permissions: {
        allow: [
          'Agent(five-role-team:worker)',
          'Bash(npm test:*)',
          'Agent(five-role-team:designer)',
          'Agent(other-plugin:thing)',
          ...GIT,
        ],
        deny: ['Bash(rm -rf:*)'],
      },
      model: 'opus',
    };
    writeFile(s.file, JSON.stringify(mixed, null, 2) + '\n');
    const res = P.removeClaudePermissions(s.file);
    const after = readJson(s.file);
    check('remove: status is removed', res.status === 'removed', res.status);
    check('remove: removed exactly the five-role-team agent rules',
      isDeepStrictEqual(res.removed, ['Agent(five-role-team:worker)', 'Agent(five-role-team:designer)']),
      JSON.stringify(res.removed));
    check('remove: keeps git Bash rules, user rules and other-plugin agent rule in order',
      isDeepStrictEqual(after.permissions.allow, ['Bash(npm test:*)', 'Agent(other-plugin:thing)', ...GIT]),
      JSON.stringify(after.permissions.allow));
    check('remove: keeps deny, other keys and key order',
      isDeepStrictEqual(after.permissions.deny, ['Bash(rm -rf:*)'])
        && after.model === 'opus'
        && isDeepStrictEqual(after.env, { FOO: 'bar' })
        && isDeepStrictEqual(Object.keys(after), ['env', 'permissions', 'model']));
  }
  {
    const s = fresh('remove-missing-file');
    const res = P.removeClaudePermissions(s.file);
    check('remove missing: status is removed with nothing removed',
      res.status === 'removed' && res.removed.length === 0, res.status);
    check('remove missing: no file or directory created', !fs.existsSync(path.dirname(s.file)));
  }
  {
    const s = fresh('remove-none-matching');
    const text = JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', ...GIT] } }, null, 4);
    writeFile(s.file, text);
    const res = P.removeClaudePermissions(s.file);
    check('remove none: status is removed with nothing removed',
      res.status === 'removed' && res.removed.length === 0, res.status);
    check('remove none: bytes unchanged', bytesOf(s.file) === text);
  }

  // --- pure removal does not mutate its input ---------------------------------------------
  {
    const input = { permissions: { allow: ['Agent(five-role-team:worker)', ...GIT] } };
    const snapshot = JSON.stringify(input);
    P.removeAgentRules(input);
    check('remove pure: input object is not mutated', JSON.stringify(input) === snapshot);
  }

  // --- settingsPathFor --------------------------------------------------------------------
  {
    const cwd = path.join(sb.root, 'some', 'project');
    check('settingsPathFor local: <cwd>/.claude/settings.local.json',
      P.settingsPathFor('local', { cwd }) === path.join(cwd, '.claude', 'settings.local.json'));
    check('settingsPathFor global: <home>/.claude/settings.json',
      P.settingsPathFor('global', { home: sb.home }) === path.join(sb.home, '.claude', 'settings.json'));
    check('settingsPathFor local: result is absolute',
      path.isAbsolute(P.settingsPathFor('local', { cwd: 'relative/dir' })));
  }
}

try {
  run();
} finally {
  sb.cleanup();
}

console.log(`SUMMARY ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
