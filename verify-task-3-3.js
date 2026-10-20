#!/usr/bin/env node
'use strict';

const { parseArgs, resolveSelectedAgents } = require('./install.js');

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

function resolveFromArgv(argv) {
  const parsed = parseArgs(argv);
  return resolveSelectedAgents({
    agents: parsed.agents,
    harness: parsed.harness,
  });
}

const subsetArgv = [
  '--global',
  '--harness',
  'pi',
  '--agents',
  'architect,worker,reviewer',
];
let result = resolveFromArgv(subsetArgv);
assert(result.errors.length === 0, 'subset parse has no resolution errors');
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') === 'architect,worker,reviewer',
  'subset returns exactly architect,worker,reviewer'
);

result = resolveSelectedAgents({ agents: null, harness: 'pi' });
assert(result.errors.length === 0, 'null agents produces no errors');
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') ===
      'architect,designer,worker,reviewer,supervisor,intern',
  'omitted --agents defaults to all agents for pi harness'
);

result = resolveSelectedAgents({
  agents: ['designer', 'supervisor'],
  harness: 'claude-code',
});
assert(result.errors.length === 0, 'claude-code subset without intern is valid');
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') === 'designer,supervisor',
  'returns requested claude-code subset'
);

result = resolveSelectedAgents({
  agents: ['architect', 'intern'],
  harness: 'pi',
});
assert(result.errors.length === 0, 'intern allowed with pi harness');
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') === 'architect,intern',
  'pi subset includes intern'
);

result = resolveSelectedAgents({
  agents: ['architect', 'intern'],
  harness: 'claude-code',
});
assert(result.errors.length === 1, 'intern with claude-code yields one error');
assert(result.selectedAgents === null, 'invalid intern selection returns null');
assert(
  result.errors[0].includes('Intern agent requires the pi harness'),
  'intern error uses intern requires pi message'
);

result = resolveSelectedAgents({
  agents: ['architect', 'bogus', 'worker'],
  harness: 'pi',
});
assert(result.errors.length === 1, 'unknown agent yields one error');
assert(result.selectedAgents === null, 'unknown agent rejects selection');
assert(
  result.errors[0].includes('unknown agent') && result.errors[0].includes('bogus'),
  'error names unknown agent id'
);

result = resolveSelectedAgents({
  agents: ['worker', 'worker', 'reviewer'],
  harness: 'pi',
});
assert(result.errors.length === 0, 'duplicate ids in list are accepted');
assert(
  result.selectedAgents &&
    result.selectedAgents.join(',') === 'worker,reviewer',
  'duplicates collapsed while preserving order'
);

result = resolveSelectedAgents({ agents: [], harness: 'pi' });
assert(result.errors.length === 1, 'empty agents list errors');
assert(result.selectedAgents === null, 'empty agents list returns null');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log('\nAll task 3.3 checks passed.');
