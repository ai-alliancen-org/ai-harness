// Fund 19: Tailwind-sætningen i prompten må kun stå, når værten faktisk er på projektets netliste, og modellen ser den faktiske liste.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guidanceFor } = require('../core/project-guidance.cjs');
const { DESIGN_PREVIEW_NETWORK } = require('../core/project-runtime.cjs');

test('uden Tailwind på netlisten står der ingen påstand om, at Tailwind er godkendt', () => {
  for (const config of [undefined, {}, { mode: 'auto' }, { network: { scripts: ['https://unpkg.com'], styles: [], images: [], connect: [] } }]) {
    const tekst = guidanceFor('desktop', config);
    assert.doesNotMatch(tekst, /Tailwind[^.]*godkendt i nye projekter/, JSON.stringify(config));
    assert.doesNotMatch(tekst, /Tailwind fra https:\/\/cdn\.tailwindcss\.com står på projektets netliste/, JSON.stringify(config));
    assert.match(tekst, /Tailwind fra et CDN er ikke godkendt/);
  }
});

test('med Tailwind på netlisten nævnes det, og hele den faktiske liste vises', () => {
  const tekst = guidanceFor('desktop', { network: { ...DESIGN_PREVIEW_NETWORK, connect: ['https://api.example.dk'] } });
  assert.match(tekst, /Tailwind fra https:\/\/cdn\.tailwindcss\.com står på projektets netliste/);
  assert.match(tekst, /kodebiblioteker: [^;]*https:\/\/cdn\.tailwindcss\.com/); assert.match(tekst, /https:\/\/fonts\.gstatic\.com/);
  assert.doesNotMatch(tekst, /billeder og medier/, 'nye projekter har ingen eksterne billeder på listen (valg 4)'); assert.match(tekst, /forbindelser: https:\/\/api\.example\.dk/);
});

test('en tom netliste siges ærligt, og sætningen er den samme for CLI', () => {
  assert.match(guidanceFor('desktop', { network: { scripts: [], styles: [], images: [], connect: [] } }), /netliste er tom/);
  assert.match(guidanceFor('cli', {}), /netliste er tom/);
  assert.equal(guidanceFor(), guidanceFor('desktop', {}), 'standardvejledningen er neutral og stabil');
});
