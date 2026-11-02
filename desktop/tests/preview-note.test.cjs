// Resultatet af forhåndsvisningskontrollen går til modellen som data ved næste besked (beslutning for beta 2).
// Teksten er kort, uden kode eller stier, og markeret som data, ikke instruktioner.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previewNoteFor } = require('../core/preview-note.cjs');

test('en vist side med en konsolfejl giver en kort besked til modellen', () => {
  const note = previewNoteFor({ loaded: true, status: 200, errorCount: 1, errors: [{ message: 'Kunne ikke hente lokalerne' }] });
  assert.match(note, /blev vist/);
  assert.match(note, /Kunne ikke hente lokalerne/);
  assert.match(note, /data/i, 'markeret som data, ikke instruktioner');
});

test('en side der ikke svarede får en besked om det', () => {
  assert.match(previewNoteFor({ loaded: false, status: null, errorCount: 0, errors: [] }), /svarede ikke/);
});

test('en side uden fejl siges også', () => {
  assert.match(previewNoteFor({ loaded: true, status: 200, errorCount: 0, errors: [] }), /uden fejl/);
});

test('beskeden er kort, så en lang konsolfejl ikke fylder prompten', () => {
  const lang = 'x'.repeat(5000);
  assert.ok(previewNoteFor({ loaded: true, status: 200, errorCount: 1, errors: [{ message: lang }] }).length <= 600);
});

test('uden kontrol er der ingen besked', () => {
  assert.equal(previewNoteFor(null), '');
});
