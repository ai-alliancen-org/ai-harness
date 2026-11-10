// T:test-desktop (beta 3): verify-desktop.cjs læste sidens størrelse i forhåndsvisningen, før Chromium havde sendt den nye størrelse
// til rammens egen proces, og fejlede med forrige trins mål. Prøven venter nu på sidens egne mål med previewSize fra
// scripts/ui-test-helpers.cjs. Vagten skal kunne fyre: et bevidst forkert mål, fx 391 × 844, giver den sidst sete størrelse, så
// sammenligningen i Electron-prøven fejler med en tydelig forskel. Her køres hjælperen mod en attrap af Playwrights side og ramme.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { previewSize } = require('../scripts/ui-test-helpers.cjs');

// Rammen svarer med de størrelser, siden ser, i rækkefølge; den sidste bliver stående.
function frame(sizes) {
  const seen = [...sizes]; let reads = 0;
  return { reads: () => reads, locator: selector => { assert.equal(selector, 'body'); return { evaluate: async () => { reads++; return seen.length > 1 ? seen.shift() : seen[0]; } }; } };
}
const page = { waitForTimeout: ms => new Promise(resolve => setTimeout(resolve, ms)) };

test('previewSize venter, til siden har fået sine nye mål, og logger ventetiden', async () => {
  const f = frame([[768, 1024], [768, 1024], [390, 844]]), waits = [];
  assert.deepEqual(await previewSize(page, f, [390, 844], { waits }), [390, 844]);
  assert.equal(f.reads(), 3, 'siden blev læst igen, indtil målene kom');
  assert.equal(waits.length, 1); assert.equal(waits[0].want, '390 × 844'); assert.ok(waits[0].ms >= 0);
});

test('vagten fyrer: et bevidst forkert mål giver den målte størrelse, og sammenligningen fejler', async () => {
  const f = frame([[768, 1024], [390, 844]]);
  const size = await previewSize(page, f, [391, 844], { timeout: 300 });
  assert.deepEqual(size, [390, 844], 'den sidst sete størrelse, ikke målet');
  assert.throws(() => assert.deepEqual(size, [391, 844]), /391/);
  // En størrelse, der aldrig kommer, fejler også, med forrige trins mål.
  assert.deepEqual(await previewSize(page, frame([[768, 1024]]), [390, 844], { timeout: 200 }), [768, 1024]);
});

test('previewSize kan nøjes med bredden', async () => {
  assert.deepEqual(await previewSize(page, frame([[844, 390], [1024, 390]]), [1024]), [1024]);
});

test('verify-desktop.cjs bruger previewSize til alle fem mål og beviser vagten med et forkert mål i selve kørslen', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/verify-desktop.cjs'), 'utf8');
  assert.doesNotMatch(source, /assert\.(?:deep)?[eE]qual\(await preview\.locator\('body'\)\.evaluate\(\(\)\s*=>\s*\[?innerWidth/, 'ingen måling uden at vente');
  assert.equal((source.match(/previewSize\(page, ?preview, ?\[/g) || []).length >= 4, true, 'Desktop, Tablet og Mobil (løkken), rotation, egen bredde og modprøven');
  assert.match(source, /previewSize\(page, ?preview, ?\[w, ?h\]/);
  assert.match(source, /previewSize\(page, ?preview, ?\[844, ?390\]/);
  assert.match(source, /previewSize\(page, ?preview, ?\[1024\]/);
  assert.match(source, /previewSize\(page, ?preview, ?\[391, ?844\][^\n]*\n?[^\n]*\[390, ?844\]/, 'modprøven: 391 × 844 skal give de målte 390 × 844');
});
