// «Godkend alt i denne samtale» automatiserer kort med et match, men aldrig låste handlinger (beskyttede filer og
// handlinger i Planlæg eller Samtale). Svaret laver ingen vedvarende regel og gælder kun samtalen (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { approveAllApplies } = require('../core/chat-session.cjs');

const kort = { match: { kind: 'bash', command: 'npm test' }, blockedMode: false, persistable: true };

test('«Godkend alt» automatiserer et kort med et match', () => {
  assert.equal(approveAllApplies(true, kort), true);
});

test('uden «Godkend alt» spørges der som før', () => {
  assert.equal(approveAllApplies(false, kort), false);
});

test('et kort uden match, fx en beskyttet fil, spørges altid', () => {
  assert.equal(approveAllApplies(true, { match: null, blockedMode: false }), false);
});

test('en handling der er låst i Planlæg eller Samtale spørges altid', () => {
  assert.equal(approveAllApplies(true, { ...kort, blockedMode: true }), false);
});
