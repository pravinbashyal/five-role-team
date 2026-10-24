#!/usr/bin/env node
'use strict';
// Verify task 9.2: the "### Common scenarios" subsection under README.md
// "## Installation" has fenced `node install.js ...` examples for skipping the
// designer, custom models (short names, and a full model path) and a development
// symlink install, and each example does what the subsection says.
//   - every `node install.js` line in a fenced block of the subsection is run, each
//     in its own sandbox (verify-sandbox.js: temp HOME and temp cwd; the guard aborts
//     if HOME is the real home), against a copy of the plugin source at
//     <sandbox cwd>/plugin-src, with an empty stdin (not a TTY)
//   - the subsection must contain fenced commands; none is a failure
//   - each command is classified as skip-designer, custom-models, full-model-path or
//     link; a command that fits none of these (or is not --global --harness
//     claude-code) fails the check, and every kind must appear at least once
//   - skip-designer: exits 0, designer.md is absent, the installed agents and the
//     .agent-config.json agents are exactly the --agents list, and designer is not in
//     the config; every model is the source default (expanded)
//   - custom-models: exits 0; worker=sonnet and reviewer=opus are installed as the full
//     sonnet and opus names in both the frontmatter and .agent-config.json; the other
//     selected agents keep their defaults
//   - full-model-path: exits 0; the full path is written as-is to the frontmatter and
//     .agent-config.json
//   - link: exits 0; the installation is a symlink to the source copy, the whole source
//     agents directory is linked (agent choices not applied), and no .agent-config.json
//     is written to the link or the source
//   - the full model names used for expansion appear in `install.js --help`
const fs = require('fs');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, 'verify-sandbox.js'));

const README = path.join(__dirname, 'README.md');
const MODEL_SHORT = {
  opus: 'anthropic/claude-opus-4-5-20251101',
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  haiku: 'haiku',
};
const KINDS = ['skip-designer', 'custom-models', 'full-model-path', 'link'];

const sb = createSandbox();
let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }

// lstat-based existence check: true for a symlink even when its target is gone.
function present(p) {
  try { fs.lstatSync(p); return true; } catch (err) { return false; }
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sorted = (a) => [...a].sort();
const listDir = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

// The `model:` value in an agent file's frontmatter, or null.
function readModel(file) {
  if (!present(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^model:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

// Same copy set as verify-task-9-1.js, plus a link to node_modules for `prompts`.
function copyPluginSource(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['SKILL.md', 'agents', 'pi', 'commands', 'conventions', '.claude-plugin',
    'install.js', 'install-files.js', 'select-agents.js', 'configure-models.js', 'agent-config.js']) {
    fs.cpSync(path.join(__dirname, name), path.join(dest, name), { recursive: true });
  }
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

// A fresh scenario (temp home and cwd) with the plugin source copied into its cwd.
function freshSource(name) {
  const sc = sb.scenario(name);
  sb.enter(sc);
  if (sc.home === sb.realHome) throw new Error('scenario HOME is the real home');
  const src = path.join(sc.cwd, 'plugin-src');
  copyPluginSource(src);
  return { sc, src, script: path.join(src, 'install.js') };
}

const runIn = (env, argv) => sb.run(argv, { home: env.sc.home, cwd: env.sc.cwd });

// Text of the "## Installation" section, up to the next level-2 heading.
function section(text) {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => l === '## Installation');
  if (s < 0) return null;
  let e = lines.findIndex((l, i) => i > s && /^## /.test(l));
  if (e < 0) e = lines.length;
  return lines.slice(s, e).join('\n');
}

// Text of the "### Common scenarios" subsection, up to the next heading of level 1-3.
function subsection(sec) {
  const lines = sec.split('\n');
  const s = lines.findIndex((l) => l === '### Common scenarios');
  if (s < 0) return null;
  let e = lines.findIndex((l, i) => i > s && /^#{1,3} /.test(l));
  if (e < 0) e = lines.length;
  return lines.slice(s, e).join('\n');
}

// Non-empty trimmed lines of every fenced code block in the text.
function fencedLines(text) {
  const out = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1].split('\n')) {
      const l = raw.trim();
      if (l) out.push(l);
    }
  }
  return out;
}

// Shell-like split: whitespace separates words; single or double quotes group.
function tokenize(line) {
  const out = [];
  let cur = null;
  let q = null;
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null; else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur = cur === null ? '' : cur; continue; }
    if (/\s/.test(ch)) {
      if (cur !== null) { out.push(cur); cur = null; }
      continue;
    }
    cur = (cur === null ? '' : cur) + ch;
  }
  if (q) throw new Error(`unterminated quote in: ${line}`);
  if (cur !== null) out.push(cur);
  return out;
}

// Parse the flags this subsection uses. `rest` is the argv after `node install.js`.
function parseArgs(tokens) {
  const rest = tokens.slice(2);
  const val = (flag) => {
    const i = rest.indexOf(flag);
    return i >= 0 && i + 1 < rest.length ? rest[i + 1] : null;
  };
  return {
    rest,
    global: rest.includes('--global'),
    harness: val('--harness'),
    agents: val('--agents'),
    models: val('--agent-models'),
    link: rest.includes('--link'),
  };
}

// Map a parsed command to one of KINDS, or null when it fits none.
function classify(a) {
  if (!a.global || a.harness !== 'claude-code') return null;
  if (a.link) return a.agents !== null && a.models === null ? 'link' : null;
  if (a.agents === null) return null;
  const list = a.agents.split(',');
  if (a.models === null) return list.includes('designer') ? null : 'skip-designer';
  const pairs = a.models.split(',').map((p) => p.split('='));
  if (pairs.some(([k, v]) => !k || !v)) return null;
  if (pairs.some(([, v]) => v.includes('/'))) return 'full-model-path';
  return 'custom-models';
}

// Expanded value of a source default (short names via MODEL_SHORT, full paths as-is).
function expandDefault(v) {
  if (v === null) return null;
  if (v.includes('/')) return v;
  return Object.prototype.hasOwnProperty.call(MODEL_SHORT, v) ? MODEL_SHORT[v] : v;
}

function checkExample(kind, cmd, idx, a) {
  const label = `[${idx + 1}] ${kind}: ${cmd}`;
  const env = freshSource(`ex-${idx + 1}`);
  const primary = path.join(env.sc.home, '.claude', 'skills', 'five-role-team');
  const r = runIn(env, [env.script, ...a.rest]);
  assert(r.status === 0 && /^Installation successful/m.test(r.stdout), `${label}: exits 0 with success message (exit ${r.status})`);
  if (r.status !== 0) { console.error(r.stderr.trimEnd()); return; }

  if (kind === 'link') {
    const isLink = present(primary) && fs.lstatSync(primary).isSymbolicLink();
    assert(isLink && fs.realpathSync(primary) === fs.realpathSync(env.src),
      `${label}: ${primary} is a symlink to the source copy`);
    const srcCfg = path.join(env.src, '.agent-config.json');
    assert(!present(path.join(primary, '.agent-config.json')) && !present(srcCfg),
      `${label}: no .agent-config.json in the link or the source`);
    assert(present(primary) && sameList(listDir(path.join(primary, 'agents')), listDir(path.join(env.src, 'agents'))),
      `${label}: the whole source agents directory is linked (--agents not applied)`);
    return;
  }

  const agentsDir = path.join(primary, 'agents');
  const cfgPath = path.join(primary, '.agent-config.json');
  assert(present(cfgPath), `${label}: copy install writes .agent-config.json`);
  if (!present(cfgPath)) return;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const wanted = a.rest[a.rest.indexOf('--agents') + 1].split(',');

  const got = present(agentsDir) ? listDir(agentsDir) : [];
  assert(sameList(got, sorted(wanted)), `${label}: installed agents are exactly ${wanted.join(',')} (got ${got.join(',')})`);
  assert(sameList(sorted(cfg.agents), sorted(wanted)), `${label}: .agent-config.json agents are exactly ${wanted.join(',')}`);
  assert(sameList(sorted(Object.keys(cfg.models)), sorted(wanted)), `${label}: .agent-config.json models cover exactly the selected agents`);

  if (kind === 'skip-designer') {
    assert(!present(path.join(agentsDir, 'designer.md')) && !cfg.agents.includes('designer') && !('designer' in cfg.models),
      `${label}: designer is absent from the install and from .agent-config.json`);
  }

  const overrides = {};
  if (a.models !== null) {
    for (const pair of a.models.split(',')) {
      const [id, v] = pair.split('=');
      overrides[id] = v.includes('/') ? v : MODEL_SHORT[v];
    }
  }
  for (const id of wanted) {
    const def = expandDefault(readModel(path.join(env.src, 'agents', `${id}.md`)));
    const want = Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : def;
    const fm = readModel(path.join(agentsDir, `${id}.md`));
    const cm = cfg.models[id];
    const how = Object.prototype.hasOwnProperty.call(overrides, id) ? 'override' : 'default';
    assert(fm === want && cm === want,
      `${label}: ${id} model is ${want} (${how}) in frontmatter (${fm}) and config (${cm})`);
  }

  if (kind === 'custom-models') {
    assert(cfg.models.worker === MODEL_SHORT.sonnet && cfg.models.reviewer === MODEL_SHORT.opus,
      `${label}: worker=sonnet and reviewer=opus expand to ${MODEL_SHORT.sonnet} and ${MODEL_SHORT.opus}`);
  }
  if (kind === 'full-model-path') {
    const full = Object.values(overrides).filter((v) => v.includes('/'));
    assert(full.length > 0 && full.every((v) => Object.values(cfg.models).includes(v)),
      `${label}: the full model path is written as-is to .agent-config.json`);
  }
}

function checkSubsection(sub) {
  const commands = fencedLines(sub).filter((l) => /^node install\.js(\s|$)/.test(l));
  assert(commands.length > 0,
    `"### Common scenarios" has ${commands.length} fenced node install.js commands (expected at least 4)`);
  if (commands.length === 0) return;

  const helpEnv = freshSource('help');
  const help = runIn(helpEnv, [helpEnv.script, '--help']);
  assert(help.status === 0, `install.js --help exits 0 (got ${help.status})`);
  for (const full of [MODEL_SHORT.opus, MODEL_SHORT.sonnet]) {
    assert(help.stdout.includes(full), `install.js --help documents the expansion ${full}`);
  }

  const plan = commands.map((cmd) => {
    const tokens = tokenize(cmd);
    const a = parseArgs(tokens);
    return { cmd, a, kind: classify(a) };
  });
  plan.forEach(({ cmd, kind }, i) => {
    assert(kind !== null, `[${i + 1}] ${cmd}: is one of the expected scenarios (skip designer, custom models, full model path, link)`);
  });
  for (const k of KINDS) {
    assert(plan.some((p) => p.kind === k), `subsection has a ${k} example`);
  }

  plan.forEach(({ cmd, a, kind }, i) => {
    if (kind !== null) checkExample(kind, cmd, i, a);
  });
}

try {
  const text = fs.readFileSync(README, 'utf8');
  const sec = section(text);
  assert(sec !== null, 'README.md has a "## Installation" section');
  const sub = sec === null ? null : subsection(sec);
  assert(sub !== null, 'the Installation section has a "### Common scenarios" subsection');
  if (sub !== null) checkSubsection(sub);
} catch (err) {
  console.error('FAIL: unexpected error', err);
  failed += 1;
} finally {
  sb.cleanup();
  if (sb.root && fs.existsSync(sb.root)) { console.error('FAIL: sandbox root not removed'); failed += 1; }
  else console.log('OK: sandbox root removed by cleanup');
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll task 9.2 checks passed');
}
