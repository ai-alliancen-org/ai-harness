// «Godkend alt i denne samtale» automatiserer kort med et match, men aldrig låste handlinger (beskyttede filer og
// handlinger i Planlæg eller Samtale). Svaret laver ingen vedvarende regel og gælder kun samtalen (beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { approveAllApplies } = require('../core/chat-session.cjs');

const kort = { match: { kind: 'bash', command: 'npm test' }, blockedMode: false, persistable: true };

test('«Godkend alt» automatiserer et kort med et match', () => {
  assert.equal(approveAllApplies(true, kort, { sandbox: true }), true);
});

test('uden «Godkend alt» spørges der som før', () => {
  assert.equal(approveAllApplies(false, kort, { sandbox: true }), false);
});

test('et kort uden match, fx en beskyttet fil, spørges altid', () => {
  assert.equal(approveAllApplies(true, { match: null, blockedMode: false }, { sandbox: true }), false);
});

test('en handling der er låst i Planlæg eller Samtale spørges altid', () => {
  assert.equal(approveAllApplies(true, { ...kort, blockedMode: true }, { sandbox: true }), false);
});

test('en kommando automatiseres kun, når sandkassen kører i denne motor', () => {
  assert.equal(approveAllApplies(true, kort, { sandbox: false }), false);
  assert.equal(approveAllApplies(true, kort), false);
  assert.equal(approveAllApplies(true, { ...kort, match: { kind: 'edit' } }), true, 'filændringer i projektet kræver ikke sandkasse');
});

test('søgning automatiseres aldrig, fordi resultatet kan vise beskyttede filer', () => {
  assert.equal(approveAllApplies(true, { ...kort, match: { kind: 'grep' } }, { sandbox: true }), false);
});

// Tilstanden skal kunne ses og slås fra: kernen melder hver ændring, og en gentagelse melder intet.
test('«Godkend alt» melder tilstanden og kan slås fra', () => {
  const { ChatSession } = require('../core/chat-session.cjs');
  const sendte = [], session = Object.create(ChatSession.prototype);
  session.approveAll = false; session.emit = event => sendte.push(event);
  session.setApproveAll(true); session.setApproveAll(true);
  assert.deepEqual(sendte, [{ type: 'approve-all', enabled: true }]);
  assert.deepEqual(session.approveAllOff(), { approveAll: false });
  session.approveAllOff();
  assert.deepEqual(sendte, [{ type: 'approve-all', enabled: true }, { type: 'approve-all', enabled: false }]);
  assert.equal(session.approveAll, false);
});
