// git kræver Command Line Tools. Stien må læses i sandkassen, men ikke hele /Library/Developer, og den må ikke skrives.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DARWIN_SYSTEM_READ } = require('../core/command-sandbox.cjs');

test('Command Line Tools kan læses i sandkassen, så git virker', () => {
  assert.ok(DARWIN_SYSTEM_READ.includes('/Library/Developer/CommandLineTools'), 'CommandLineTools mangler i læselisten');
});

test('læselisten giver ikke hele /Library/Developer', () => {
  assert.equal(DARWIN_SYSTEM_READ.includes('/Library/Developer'), false);
});
