#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-5-4-'));
const fakeHome = path.join(tmpRoot, 'home');
fs.mkdirSync(fakeHome);
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;

const { applyModelToFrontmatter: apply } = require('./install-files.js');

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
function throws(fn, re) {
  try { fn(); } catch (e) { return re.test(e.message) && !/\n\s+at /.test(e.message); }
  return false;
}

// Mirrors install.js readDefaultModels parsing (frontmatter regex + model line + unquote).
function readModel(content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const ml = fm[1].match(/^model:[ \t]*(.*?)[ \t]*$/m);
  if (!ml) return null;
  return ml[1].replace(/^(['"])(.*)\1$/, '$2');
}
// Hand YAML check of the frontmatter: every non-blank line is `key: value` or
// a continuation/comment; model value is a plain scalar without ': ' / ' #', or a valid double-quoted string.
function frontmatterValid(content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  const lines = fm[1].split(/\r?\n/);
  const models = lines.filter((l) => /^model:/.test(l));
  if (models.length !== 1) return false;
  const v = models[0].replace(/^model:[ \t]*/, '');
  if (v.startsWith('"')) { try { JSON.parse(v); return true; } catch (e) { return false; } }
  return v.length > 0 && !/: |\s#|^[\[\]{}&*!|>'%@`,?-]/.test(v) && !/:$/.test(v);
}

try {
  const doc = '---\nname: worker\ndescription: Does: things\ntools: Read, Edit\nmodel: haiku\n---\n\nBody line\nmodel: not-frontmatter\n';

  let out = apply(doc, 'opus');
  assert(out === doc.replace('model: haiku', 'model: opus'), 'replace changes only the model line');
  assert(out.endsWith('Body line\nmodel: not-frontmatter\n'), 'body (incl. model-looking line) unchanged');
  assert(readModel(out) === 'opus', 'readDefaultModels-style parse returns new model');

  out = apply(doc.replace('model: haiku\n', ''), 'sonnet');
  assert(out === doc.replace('model: haiku', 'model: sonnet'), 'missing model line added at end of frontmatter');

  const crlf = doc.replace(/\n/g, '\r\n');
  out = apply(crlf, 'opus');
  assert(out === crlf.replace('model: haiku', 'model: opus'), 'CRLF replace preserves line endings');
  out = apply(crlf.replace('model: haiku\r\n', ''), 'opus');
  assert(out === crlf.replace('model: haiku', 'model: opus'), 'CRLF add uses CRLF');
  assert(!/[^\r]\n/.test(out), 'no bare LF introduced in CRLF file');

  assert(apply('---\nmodel:\n---\nx', 'a') === '---\nmodel: a\n---\nx', 'empty model value replaced');
  assert(apply('---\nname: x\n---', 'a') === '---\nname: x\nmodel: a\n---', 'no trailing body ok');
  assert(apply('---\nmodel: "old # x"   \nname: x\n---\nb', 'a') === '---\nmodel: a\nname: x\n---\nb', 'quoted old value replaced');

  for (const bad of ['no frontmatter\n', '', '\n---\nmodel: x\n---\n', '---\nname: x\nno close\n']) {
    assert(throws(() => apply(bad, 'opus'), /no YAML frontmatter/), 'no-frontmatter error: ' + JSON.stringify(bad.slice(0, 20)));
  }
  assert(throws(() => apply(doc, ''), /non-empty/), 'empty model rejected');
  assert(throws(() => apply(doc, 'a\nb'), /single line/), 'multi-line model rejected');
  assert(throws(() => apply(null, 'a'), /string/), 'non-string content rejected');

  const models = [
    'opus', 'anthropic/claude-opus-4-5-20251101', 'qwen3.5:4b-mlx', 'ollama/llama3:8b',
    'a: b', 'x #y', 'true', 'null', '123', '1.5', '- x', '[a]', '{a}', '*x', "it's", 'say "hi"', 'back\\slash', 'trailing:', '@x', 'ünï',
  ];
  for (const model of models) {
    for (const src of [doc, crlf]) {
      const o = apply(src, model);
      assert(frontmatterValid(o), `valid frontmatter for model ${JSON.stringify(model)}`);
      assert(readModel(o) === model || /["']/.test(model) || /\\/.test(model), `round-trip model ${JSON.stringify(model)}`);
    }
  }
  assert(apply(doc, 'qwen3.5:4b-mlx').includes('\nmodel: qwen3.5:4b-mlx\n'), 'qwen model left unquoted');
  assert(apply(doc, 'anthropic/claude-opus-4-5-20251101').includes('\nmodel: anthropic/claude-opus-4-5-20251101\n'), 'slash model left unquoted');
  assert(apply(doc, 'a: b').includes('\nmodel: "a: b"\n'), 'colon-space model quoted');
  assert(apply(doc, 'true').includes('model: "true"'), 'boolean-like model quoted');
  assert(apply(doc, '  opus  ').includes('model: opus\n'), 'model trimmed');

  // Real files, in memory only.
  const root = __dirname;
  const files = fs.readdirSync(path.join(root, 'agents')).filter((n) => n.endsWith('.md')).map((n) => path.join(root, 'agents', n));
  files.push(path.join(root, 'pi', 'agents', 'intern.md'));
  for (const f of files) {
    const orig = fs.readFileSync(f, 'utf8');
    const origModel = readModel(orig);
    const same = apply(orig, origModel);
    assert(same === orig, `${path.relative(root, f)}: reapplying own model is byte-identical`);
    for (const model of ['opus', 'qwen3.5:4b-mlx', 'anthropic/claude-opus-4-5-20251101']) {
      const o = apply(orig, model);
      assert(readModel(o) === model && frontmatterValid(o), `${path.relative(root, f)}: model ${model} applied, valid`);
      const body = orig.slice(orig.indexOf('\n---', 4));
      assert(o.endsWith(body), `${path.relative(root, f)}: body unchanged`);
      assert(o.split('\n').length === orig.split('\n').length, `${path.relative(root, f)}: line count unchanged`);
    }
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll task 5.4 checks passed');
