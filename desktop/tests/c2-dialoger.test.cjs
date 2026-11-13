// Forhåndsvisningen viser ikke browserens dialogbokse: rammen og den statiske side har en sandkasse uden allow-modals, så
// alert(), confirm() og prompt() ignoreres, og confirm() svarer altid nej (gennemgangens fund 20, beta 3). AI'en skal
// derfor lave bekræftelser og beskeder i selve siden. Vejledningen sendes i Planlæg og Byg i både app og CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guidanceFor } = require('../core/project-guidance.cjs');
const { policyFor, contentSecurityPolicy } = require('../core/preview-policy.cjs');

test('vejledningen beder AI’en lave dialoger i selve siden i stedet for alert, confirm og prompt', () => {
  for (const surface of ['desktop', 'cli']) {
    const tekst = guidanceFor(surface, {});
    assert.match(tekst, /alert\(\), confirm\(\) (?:og|eller) prompt\(\)/, surface);
    assert.match(tekst, /confirm\(\) svarer altid nej/, surface);
    assert.match(tekst, /i selve siden/, surface);
  }
});

test('forudsætningen holder: den statiske forhåndsvisnings sandkasse tillader ikke dialogbokse', () => {
  const csp = contentSecurityPolicy(policyFor({ origin: 'aura-preview://p/', static: true }));
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-modals/, 'tillades dialogbokse en dag, skal vejledningen ændres');
});
