// Seneste beskeder følger kun med som tekst, når den nye session ikke har samtalen: ved skift af model eller forbindelse, eller efter et
// motorstop med nyt arbejdsmåde. Skift af arbejdsmåde i den samme motor og session sender dem ikke igen (årsag 4).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handoffNeeded } = require('../core/chat-session.cjs');

const beskeder = [{ role: 'user', text: 'hej' }];

test('skift af arbejdsmåde i en kørende motor sender ikke historikken igen', () => {
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: true, modelSwitch: false, previousMode: 'chat', mode: 'build' }), false);
});

test('skift af model i en kørende motor sender historikken, fordi den nye session er tom', () => {
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: true, modelSwitch: true, previousMode: 'build', mode: 'build' }), true);
});

test('uden en kørende motor sendes historikken ved skift af arbejdsmåde som før', () => {
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: false, modelSwitch: false, previousMode: 'chat', mode: 'build' }), true);
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: false, modelSwitch: false, previousMode: 'build', mode: 'build' }), false);
});

test('uden tidligere beskeder er der intet at sende', () => {
  assert.equal(handoffNeeded({ messages: [], engineActive: true, modelSwitch: true, previousMode: 'chat', mode: 'build' }), false);
});

test('uden en kørende motor sendes historikken, når den gemte AI-session hører til en anden model (årsag 4)', () => {
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: false, modelSwitch: true, previousMode: 'build', mode: 'build' }), true);
});

test('fortsætter samme AI-session ikke, får den nye session de seneste beskeder, også i samme arbejdsmåde (Q:B1-2)', () => {
  // Fx efter indfletning, en ny kopi eller en samtale fra en ældre version: beskeder, men ingen gemt session at fortsætte.
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: false, modelSwitch: false, previousMode: 'build', mode: 'build', continues: false }), true);
  assert.equal(handoffNeeded({ messages: beskeder, engineActive: false, modelSwitch: false, previousMode: 'build', mode: 'build', continues: true }), false);
  assert.equal(handoffNeeded({ messages: [], engineActive: false, modelSwitch: false, previousMode: 'build', mode: 'build', continues: false }), false);
});
