// OpenCode komprimerer selv midt i en opgave: den opretter en ny brugerbesked og en syntetisk "Continue"-besked, og
// senere svar har dén som parentID. De skal nå frem til Aura, ellers ser opgaven ud til at stoppe uden resultat. Sene
// hændelser fra en tidligere besked (ældre id) skal stadig holdes ude (#58, fund fra gennemgangen 3. november).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OpenCodeEngine } = require('../core/engine.cjs');

function motor() {
  const events = [];
  const engine = new OpenCodeEngine({ root: '/projekt', directory: '/motor', provider: {}, model: { id: 'm' }, onEvent: event => events.push(event) });
  engine.session = { id: 's1' }; engine.active = true;
  engine.promptID = 'msg_0000000001000aaaaaaaaaaaaaa'; engine.currentMessageIDs = new Set([engine.promptID]); engine.currentReplySeen = false;
  return { engine, events };
}
const info = (id, role, parentID) => ({ type: 'message.updated', properties: { sessionID: 's1', info: { id, role, sessionID: 's1', ...(parentID ? { parentID } : {}) } } });
const part = (messageID, text) => ({ type: 'message.part.updated', properties: { part: { id: 'prt_' + messageID, messageID, sessionID: 's1', type: 'text', text } } });

test('svar efter en automatisk komprimering når frem, også når de har den syntetiske besked som parentID', () => {
  const { engine, events } = motor();
  engine.handleEvent(info('msg_0000000001000aaaaaaaaaaaaaa', 'user'));
  engine.handleEvent(info('msg_0000000002000bbbbbbbbbbbbbb', 'assistant', 'msg_0000000001000aaaaaaaaaaaaaa'));
  engine.handleEvent(info('msg_0000000003000cccccccccccccc', 'user'));           // komprimeringens syntetiske besked
  engine.handleEvent(info('msg_0000000004000dddddddddddddd', 'assistant', 'msg_0000000003000cccccccccccccc'));
  engine.handleEvent(part('msg_0000000004000dddddddddddddd', 'Svaret efter komprimeringen'));
  assert.ok(events.some(e => e.type === 'message.part.updated' && e.properties.part.text === 'Svaret efter komprimeringen'), 'delen af svaret nåede frem');
  assert.equal(events.filter(e => e.type === 'message.updated').length, 4);
});

test('en sen hændelse fra en tidligere besked holdes stadig ude', () => {
  const { engine, events } = motor();
  engine.handleEvent(info('msg_0000000000500zzzzzzzzzzzzzz', 'assistant', 'msg_0000000000400yyyyyyyyyyyyyy'));
  assert.equal(events.length, 0);
});
