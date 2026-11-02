// Grundreglerne står én gang i systeminstruktionen. Når projektets AGENTS.md er identisk med grundreglerne (fordi
// oprettelsen kopierer dem dertil), gentages teksten ikke (beslutning for beta 2, årsag 8 i hackathon-aarsager.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agentsDuplicatesRules } = require('../core/chat-session.cjs');

const grundregler = 'Regel et.\nRegel to.\n';

test('en AGENTS.md der er kopien af grundreglerne gentages ikke', () => {
  assert.equal(agentsDuplicatesRules({ content: grundregler }, grundregler), true);
});

test('en AGENTS.md med projektets egne regler beholdes', () => {
  assert.equal(agentsDuplicatesRules({ content: 'Projektets egen regel.\n' }, grundregler), false);
});

test('uden en AGENTS.md er der intet at gentage', () => {
  assert.equal(agentsDuplicatesRules(null, grundregler), false);
  assert.equal(agentsDuplicatesRules({ content: grundregler }, ''), false);
});
