const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appRules } = require('../core/project-guidance.cjs');
const { composeAppContext } = require('../core/chat-session.cjs');
const features = { versioner: true, deling: false, planlaegning: true, design: false };
// Årsag 7a: byg og typetjek før færdigmelding, og «hver kommando skal godkendes» gælder kun, når kommandoer ikke køres automatisk.
test('uden automatiske kommandoer skal hver kommando stadig godkendes, og byggereglen står ikke', () => {
  for (const options of [{}, { autoCommands: false }]) {
    const rules = appRules(features, { mode: 'build', ...options });
    assert.match(rules, /hver kommando skal godkendes/);
    assert.doesNotMatch(rules, /typetjek/i);
  }
});
test('med automatiske kommandoer står der ikke, at hver kommando skal godkendes, og byggetrin og typetjek kræves før færdigmelding', () => {
  const rules = appRules(features, { mode: 'build', autoCommands: true });
  assert.doesNotMatch(rules, /hver kommando skal godkendes/);
  assert.match(rules, /byggetrin/i);
  assert.match(rules, /typetjek/i);
  assert.match(rules, /før du melder/i);
});
test('appens kontekst følger opgavens øjebliksbillede af automatiske kommandoer', () => {
  const base = autoCommandsSnapshot => ({ mode: 'build', runtime: {}, autoCheckpoint: false, autoCommandsSnapshot, references: [], startup: null,
    context: { features, skills: [], integrations: [], rules: 'GRUNDREGLER', projectInstructions: null }, disclosure: { projectDesign: {}, brief: '' } });
  const system = flag => composeAppContext({ prepared: base(flag), project: { name: 'P', purpose: 'Q', links: [] }, plan: { id: 'x', text: 'plan', context: '' }, planConversation: [], dismissed: false, handoff: '', surface: 'desktop' }).system;
  assert.match(system(false), /hver kommando skal godkendes/);
  assert.doesNotMatch(system(true), /hver kommando skal godkendes/);
  assert.match(system(true), /typetjek/i);
});
