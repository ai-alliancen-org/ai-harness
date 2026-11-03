// Planer genkendes, også når modellen skriver overskrifterne lidt anderledes end de fire faste (årsag 3 i hackathon-aarsager.md),
// og en ny besked i Planlæg trækker ikke en færdig plan tilbage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const conversationMode = require('../ui/conversation-mode.js');

const kroppe = { bygger: 'En bookingside.', design: 'Rolig og lys.', teknik: 'Ren HTML.', proev: 'Åbn siden.' };
const variant = (navne, stil) => navne.map(([nøgle, titel]) => stil(titel, kroppe[nøgle])).join('\n\n');
const N = [['bygger', 'Det bygger vi'], ['design', 'Sådan skal det se ud'], ['teknik', 'Teknik og data'], ['proev', 'Det skal du prøve']];

test('almindelige varianter af de fire overskrifter genkendes som en plan', () => {
  const stile = {
    'markdown': (t, b) => `## ${t}\n${b}`,
    'nummereret': (t, b) => `## ${N.findIndex(([, x]) => x === t) + 1}. ${t}\n${b}`,
    'fed med kolon': (t, b) => `**${t}:**\n${b}`,
    'fed med tekst på samme linje': (t, b) => `**${t}**: ${b}`,
    'emoji': (t, b) => `### 🎨 ${t}\n${b}`,
    'ampersand': (t, b) => `## ${t.replace('Teknik og data', 'Teknik & data')}\n${b}`
  };
  for (const [navn, stil] of Object.entries(stile)) assert.equal(conversationMode.concretePlan(variant(N, stil)), true, navn);
});

test('tekst uden de fire afsnit er ikke en plan', () => {
  assert.equal(conversationMode.concretePlan('Det lyder som en god idé. Vil du have, at jeg laver en plan?'), false);
  assert.equal(conversationMode.concretePlan('## Det bygger vi\nNoget.\n\n## Sådan skal det se ud\nNoget.'), false);
});

test('Teknik alene er ikke nok til at falde sammen med andre overskrifter', () => {
  assert.equal(conversationMode.concretePlan('## Teknik\nx\n\n## Design\ny'), false);
});
