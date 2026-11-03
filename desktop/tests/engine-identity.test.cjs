// Motorens identitet er det, motoren faktisk er bundet til: forbindelse, model (arbejdsmåden vælges for hver besked),
// grundregler, skills, funktioner og sandkasse. Designstatus, plan-id og beskedtekster hører til den enkelte besked og må ikke
// få motoren til at genstarte, så AI'en glemmer samtalen (årsag 4 i hackathon-aarsager.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { engineIdentityOf } = require('../core/chat-session.cjs');

const basis = {
  disclosure: { connection: 'Corti', model: 'glm', endpoint: 'https://x/v1', protocol: 'chat', recipients: 'Corti · x', region: 'EU', mode: 'build', projectDesign: 'tom', planID: 'p1', material: 'tekst 1' },
  extras: { connectionRevision: 1, rules: 'regler', skills: [{ name: 'a' }], features: { design: true }, projectInstructions: null, surface: 'desktop', autoCheckpoint: true, commandIsolation: false, autoCommandsSnapshot: false }
};
const med = (delta, extra = {}) => engineIdentityOf({ ...basis.disclosure, ...delta }, { ...basis.extras, ...extra });

test('designstatus, plan-id og beskedtekster ændrer ikke motorens identitet', () => {
  const grund = med({});
  assert.equal(med({ projectDesign: 'skrevet af AI' }), grund);
  assert.equal(med({ planID: 'p2' }), grund);
  assert.equal(med({ material: 'helt anden tekst' }), grund);
});

test('forbindelse, model, skills, regler og sandkasse ændrer den, men arbejdsmåden gør ikke (én motor, agent pr. besked)', () => {
  const grund = med({});
  assert.equal(med({ mode: 'plan' }), grund, 'arbejdsmåden vælges for hver besked');
  for (const [navn, aendret] of Object.entries({
    model: med({ model: 'anden' }), forbindelse: med({ connection: 'Mistral', endpoint: 'https://y/v1' }), skills: med({}, { skills: [{ name: 'a' }, { name: 'b' }] }), sandkasse: med({}, { commandIsolation: true }), regler: med({}, { rules: 'nye regler' })
  })) assert.notEqual(aendret, grund, navn);
});
