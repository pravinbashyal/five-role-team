#!/usr/bin/env node
'use strict';

const {
  buildAgentSelectChoices,
  formatInternRequiresPiMessage,
  isPiHarness,
  promptAgentSelection,
  selectionIncludesInvalidIntern,
} = require('./select-agents');

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

assert(isPiHarness('pi'), "isPiHarness('pi') is true");
assert(!isPiHarness('claude-code'), "isPiHarness('claude-code') is false");
assert(
  isPiHarness(`/home/user/.pi/skills`),
  'isPiHarness detects .pi in custom path'
);

const claudeChoices = buildAgentSelectChoices({ harness: 'claude-code' });
const internChoice = claudeChoices.find((c) => c.value === 'intern');
assert(internChoice && internChoice.disabled === true, 'intern disabled when harness is claude-code');
assert(internChoice.selected === false, 'intern not pre-selected when disabled');

const piChoices = buildAgentSelectChoices({ harness: 'pi' });
const piIntern = piChoices.find((c) => c.value === 'intern');
assert(piIntern && piIntern.disabled !== true, 'intern enabled when harness is pi');

assert(
  selectionIncludesInvalidIntern(['worker', 'intern'], 'claude-code'),
  'invalid intern selection detected for claude-code'
);
assert(
  !selectionIncludesInvalidIntern(['worker', 'intern'], 'pi'),
  'intern with pi harness is valid'
);
assert(
  !selectionIncludesInvalidIntern(['worker'], 'claude-code'),
  'no intern in selection is valid'
);

const warningText = formatInternRequiresPiMessage();
assert(
  warningText.includes('Intern agent requires the pi harness'),
  'warning mentions intern requires pi'
);
assert(
  warningText.toLowerCase().includes('deselect intern') &&
    warningText.toLowerCase().includes('harness'),
  'warning prompts to deselect intern or change harness'
);

(async () => {
  let promptCalls = 0;
  const warnings = [];
  const promptsImpl = async () => {
    promptCalls += 1;
    if (promptCalls === 1) {
      return { agents: ['architect', 'intern'] };
    }
    return { agents: ['architect'] };
  };

  const selected = await promptAgentSelection({
    promptsImpl,
    choiceOptions: { harness: 'claude-code', selectAllExceptIntern: false },
    warn: (message) => warnings.push(message),
  });

  assert(promptCalls === 2, 're-prompts after invalid intern selection');
  assert(warnings.length === 1, 'shows one warning for invalid selection');
  assert(
    warnings[0] === warningText,
    'warning text matches formatInternRequiresPiMessage'
  );
  assert(
    Array.isArray(selected) && selected.join(',') === 'architect',
    'returns corrected selection after warning'
  );

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }

  console.log('\nAll task 3.2 checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
