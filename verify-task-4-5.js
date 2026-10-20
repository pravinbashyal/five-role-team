#!/usr/bin/env node
'use strict';

const {
  parseArgs,
  readDefaultModels,
  resolveAgentModels,
  promptModelConfiguration,
  buildModelPromptQuestion,
  validateModel,
} = require('./install.js');

let failed = 0;
function assert(c, m) { if (!c) { console.error('FAIL:', m); failed += 1; } else console.log('OK:', m); }
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

(async () => {
  const defaults = readDefaultModels(['worker', 'intern']);

  // validateModel
  assert(validateModel('haiku') === true, 'non-empty model valid');
  assert(typeof validateModel('') === 'string', 'empty model invalid');
  assert(typeof validateModel('   ') === 'string', 'blank model invalid');
  assert(typeof validateModel(undefined) === 'string', 'undefined model invalid');

  // Non-interactive
  assert(parseArgs(['--agent-models', 'worker=']).errors.length > 0, 'parseArgs rejects empty value');
  const e1 = throws(() => resolveAgentModels(['worker'], defaults, { worker: '  ' }));
  assert(e1 && /worker/.test(e1.message) && /empty/.test(e1.message), 'blank override errors naming agent');
  const e2 = throws(() => resolveAgentModels(['intern'], defaults, {}));
  assert(e2 && /intern/.test(e2.message), 'no default and no override errors');
  assert(resolveAgentModels(['worker'], defaults, {}).worker === defaults.worker, 'default still used when no override');
  assert(!throws(() => resolveAgentModels(['worker'], defaults, { intern: '' })), 'unselected agent blank override ignored');

  // Interactive
  const q = buildModelPromptQuestion('intern', undefined);
  assert(typeof q.validate === 'function' && typeof q.validate('') === 'string' && q.validate('x') === true, 'prompt question validates non-empty');
  let err = null;
  try { await promptModelConfiguration(['intern'], {}, { promptsImpl: async () => ({ model: '' }) }); } catch (e) { err = e; }
  assert(err && /intern/.test(err.message), 'empty answer with no default errors');
  const ok = await promptModelConfiguration(['worker'], defaults, { promptsImpl: async () => ({ model: 'sonnet' }) });
  assert(ok.worker === 'anthropic/claude-sonnet-4-20250514', 'non-empty answer accepted and expanded');

  process.exit(failed ? 1 : 0);
})();
