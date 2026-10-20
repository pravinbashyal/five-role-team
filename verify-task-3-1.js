#!/usr/bin/env node
'use strict';

const {
  AGENT_CATALOG,
  buildAgentSelectChoices,
  buildAgentSelectPromptQuestion,
  formatAgentChoiceTitle,
} = require('./select-agents');

const EXPECTED = [
  ['architect', 'plan-time exploration, captures change artifacts'],
  ['designer', 'plan-time interaction design, researches UX'],
  ['worker', 'implements tasks'],
  ['reviewer', 'audits worker diffs'],
  ['supervisor', 'composition audit, interaction gate'],
  ['intern', 'pi-only: menial chores for other agents'],
];

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

assert(AGENT_CATALOG.length === 6, 'catalog lists six agents');

EXPECTED.forEach(([id, description], index) => {
  const entry = AGENT_CATALOG[index];
  assert(entry && entry.id === id, `catalog[${index}] id is ${id}`);
  assert(entry && entry.description === description, `catalog[${index}] description matches design`);
  assert(
    formatAgentChoiceTitle(entry) === `${id} (${description})`,
    `choice title for ${id} includes description`
  );
});

const choices = buildAgentSelectChoices();
assert(choices.length === 6, 'multiselect offers six choices');
choices.forEach((choice, index) => {
  const [id, description] = EXPECTED[index];
  assert(choice.value === id, `choice[${index}] value is ${id}`);
  assert(
    choice.title === `${id} (${description})`,
    `choice[${index}] title shows name and description`
  );
});

const question = buildAgentSelectPromptQuestion();
assert(question.type === 'multiselect', 'prompt question type is multiselect');
assert(question.message === 'Select agents to include:', 'prompt message matches design');
assert(question.choices.length === 6, 'prompt question includes six choices');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}

console.log('\nAll task 3.1 checks passed.');
