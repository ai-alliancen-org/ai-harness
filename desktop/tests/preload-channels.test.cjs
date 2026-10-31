// Hver IPC-kanal i preload skal have en kalder i brugerfladen. Bliver den sidste kalder slettet, lever kanalen
// videre som død kode, og en synlig funktion forsvinder uden at noget siger fra. Det skete med preview:check:
// udløseren forsvandt i 5ffe905, mens handleren i main.cjs, posten i Aktivitet og beslutningen i docs/decisions.md
// blev stående. Kun verify-approvals fangede det, og den blev afskrevet som forældet i otte dage.
// Vagten måler brugen, ikke erklæringen. tests/key-window.test.cjs:398 kontrollerer, at tre kanaler ER erklæret
// i både main og preload; det siger intet om, hvorvidt nogen kalder dem.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = path.join(__dirname, '../ui');
const preload = fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8');
// Brugerfladen kalder enten ved navn i et script eller via et data-attribut i markup, fx data-material-picker.
const kilder = fs.readdirSync(ui).filter(file => /\.(js|html)$/.test(file))
  .map(file => fs.readFileSync(path.join(ui, file), 'utf8')).join('\n');

// Kanaler, der med vilje står uden kalder. Hver skal have en grund, ellers er den et tab, ingen har opdaget.
const UDEN_KALDER = {
  keyCancel: 'Ingen kalder. Nøglevinduet lukkes i dag af hovedprocessen, og key:cancel (main.cjs:627) nås ikke fra brugerfladen. Noteret i handover.md, ikke afklaret.'
};

test('hver IPC-kanal i preload har en kalder i brugerfladen', () => {
  const navne = [...preload.matchAll(/^\s{2}(\w+):\s*'[a-z-]+:[a-z-]+',?$/gm)].map(match => match[1]);
  assert.ok(navne.length > 100, `forventede hele kanallisten, fandt ${navne.length}`);
  const uden = navne.filter(navn => !new RegExp(`\\b${navn}\\b`).test(kilder));
  const uventede = uden.filter(navn => !Object.hasOwn(UDEN_KALDER, navn));
  assert.deepEqual(uventede, [], 'Disse kanaler har ingen kalder i ui/. Enten er en funktion forsvundet, eller også skal kanalen væk:\n' + uventede.join('\n'));
});

test('undtagelserne er stadig uden kalder, så listen ikke vokser i stilhed', () => {
  const navne = [...preload.matchAll(/^\s{2}(\w+):\s*'[a-z-]+:[a-z-]+',?$/gm)].map(match => match[1]);
  for (const [navn, grund] of Object.entries(UDEN_KALDER)) {
    assert.ok(navne.includes(navn), `${navn} findes ikke længere i preload; fjern undtagelsen`);
    assert.ok(!new RegExp(`\\b${navn}\\b`).test(kilder), `${navn} har fået en kalder; fjern undtagelsen og dens begrundelse`);
    assert.ok(grund.length > 20, `${navn} mangler en rigtig begrundelse`);
  }
});

test('forhåndsvisningen kontrolleres efter en opgave med filændringer', () => {
  const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8');
  assert.match(app, /call\('previewCheck'/, 'docs/decisions.md: efter en opgave genindlæser Aura siden og siger, om den blev vist');
  assert.match(app, /v\.checkedTask !== result\.task.*checkPreview\(result\)/, 'kontrollen skal køre én gang pr. opgave, ikke ved hver gentegning');
});
