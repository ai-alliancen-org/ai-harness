// Byg uden plan bygger med det samme: den får ikke Samtale-reglerne (som fraråder byggeplaner), og spørgeværktøjet er slået fra
// i Byg. Planlæg og Samtale beholder begge (årsag 3 i hackathon-aarsager.md, beslutning for beta 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { permissions } = require('../core/engine.cjs');
const { composeAppContext } = require('../core/chat-session.cjs');

test('spørgeværktøjet er slået fra i Byg og til i Planlæg og Samtale', () => {
  assert.equal(permissions('/p', [], 'build', null).question, 'deny');
  assert.equal(permissions('/p', [], 'free', null).question, 'deny');
  assert.equal(permissions('/p', [], 'plan', null).question, 'allow');
  assert.equal(permissions('/p', [], 'chat', null).question, 'allow');
});

test('Byg får ikke Samtale-reglerne, men en kort besked om at bygge nu', () => {
  const kontekst = mode => composeAppContext({ prepared: { mode, disclosure: { projectDesign: '', projectChoices: '', projectGuidance: '' }, context: { rules: 'regler', features: {}, skills: [], projectInstructions: null, integrations: [] }, runtime: {} }, project: { name: 'p', purpose: 'x', links: [] }, plan: { id: 'p1', text: 'En plan.', context: '', source: 'ai' }, planConversation: [], dismissed: false, handoff: '', surface: 'desktop' });
  for (const mode of ['free', 'build']) {
    const system = kontekst(mode).system;
    assert.doesNotMatch(system, /SAMTALE OG VALG/, mode);
    assert.match(system, /Du er i Byg/, mode);
  }
  for (const mode of ['chat', 'plan']) assert.match(kontekst(mode).system, /SAMTALE OG VALG/, mode);
});
