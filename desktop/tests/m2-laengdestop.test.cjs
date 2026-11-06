const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
// Årsag 7b: længdestoppet meldes også ved et delvist svar, og teksten nævner kun tænkning, når modellen tænker.
async function lengthStopText() {
  const source = await fs.readFile(path.join(__dirname, '../ui/app.js'), 'utf8');
  const start = source.indexOf('function lengthStopText');
  assert.ok(start >= 0, 'funktionen findes i ui/app.js');
  const end = source.indexOf('\n}\n', start) + 2;
  const context = {}; vm.runInNewContext(source.slice(start, end) + '\nthis.f = lengthStopText;', context);
  return { fn: context.f, source };
}
test('et tomt afskåret svar nævner kun tænkning, når modellen oplyser indsats', async () => {
  const { fn } = await lengthStopText();
  assert.match(fn(false, true), /tænke/);
  assert.doesNotMatch(fn(false, false), /tænke/);
  assert.match(fn(false, false), /grænsen for svarets længde/);
});
test('et delvist afskåret svar får en synlig besked i begge tilfælde', async () => {
  const { fn } = await lengthStopText();
  for (const reasons of [true, false]) {
    assert.match(fn(true, reasons), /afskåret/);
    assert.match(fn(true, reasons), /ufuldstændigt/);
  }
  assert.doesNotMatch(fn(true, false), /tænke/);
});
test('resultatkortet bruger beskeden ved delvise svar med filer og uden filer', async () => {
  const { source } = await lengthStopText();
  const review = source.slice(source.indexOf('function renderRunReview'), source.indexOf('\n}\n', source.indexOf('function renderRunReview')));
  assert.ok((review.match(/lengthStopText\(/g) || []).length >= 3, 'tomt, delvist med filer og delvist i samtale');
  assert.match(review, /result\.finish === 'length'/);
});
