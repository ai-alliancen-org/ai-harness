// K2: svaret fra «Gem forbindelse» kan lande, efter at brugeren er gået videre. connectionSaved nulstillede formularen
// og skiftede til listen uden at se på, hvad formularen viste. Åbnede brugeren imens en anden forbindelse eller skrev
// videre, forsvandt indtastningen. Nu nulstilles og skiftes der kun, når formularen stadig viser det, der blev sendt.
// Prøven kører de ordrette udsnit af ui/app.js (samme metode som tests/setup-error-scope.test.cjs) med et forsinket svar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KILDE = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = KILDE.indexOf(fra), b = KILDE.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return KILDE.slice(a, b); };
const linje = fra => { const a = KILDE.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return KILDE.slice(a, KILDE.indexOf('\n', a)); };

class El {
  constructor(id = '') { this.id = id; this.value = ''; this.checked = false; this.hidden = false; this.open = false; this.readOnly = false; this.required = false; this.disabled = false; this.text = ''; this.dataset = {}; this.children = []; this.classList = { toggle() {}, remove() {}, add() {} }; }
  get textContent() { return this.text; } set textContent(v) { this.text = v; }
  get previousElementSibling() { return this._prev ||= new El(this.id + ':prev'); }
  get nextElementSibling() { return this._next ||= new El(this.id + ':next'); }
  append(...x) { this.children.push(...x); } replaceChildren(...x) { this.children = x; }
  focus() {} reportValidity() { return true; }
}

function miljoe() {
  const els = new Map();
  const $ = sel => { if (!els.has(sel)) els.set(sel, new El(sel)); return els.get(sel); };
  // form.reset() efter HTML: felter uden value-attribut bliver '', <select> får første <option> (corti), og
  // afkrydsning slukkes. Det skjulte #connection-id har værditilstanden "default" og røres ikke af reset.
  $('#connection-form').reset = () => {
    for (const id of ['#connection-name', '#base-url', '#azure-endpoint', '#azure-deployment']) $(id).value = '';
    $('#azure-protocol').value = 'responses'; $('#provider-kind').value = 'corti'; $('#clear-key').checked = false;
  };
  const definitions = {
    corti: { name: 'Corti S1 · EU', baseURL: 'https://ai.eu.corti.app/v1' },
    mistral: { name: 'Mistral', baseURL: 'https://api.mistral.ai/v1' },
    anthropic: { name: 'Anthropic', baseURL: 'https://api.anthropic.com/v1' },
    compatible: { name: 'Egen server', baseURL: 'http://127.0.0.1:8080/v1' },
    ollama: { name: 'Ollama', baseURL: 'http://127.0.0.1:11434' }
  };
  const A = { id: 'conn-A', kind: 'mistral', name: 'Mistral · arbejde', baseURL: definitions.mistral.baseURL, hasKey: true };
  const B = { id: 'conn-B', kind: 'anthropic', name: 'Claude · privat', baseURL: definitions.anthropic.baseURL, hasKey: true };
  const C = { id: 'conn-C', kind: 'compatible', name: 'Kommunens server', baseURL: 'http://127.0.0.1:9000/v1', hasKey: false };
  const gemte = [], ventende = [];
  let forbindelser = [A, B, C];
  const c = {
    $, console, document: { querySelectorAll: () => [] },
    state: { connections: forbindelser, definitions },
    setupActive: false, setupStep: 'choice', setupGeneration: 0, verifiedConnection: '', acceptedFingerprint: null,
    editingConnection: '', projectLoading: false,
    connectionChecks: { clear() {}, get() { return null; } },
    moveConnectionForm() {}, renderConnections() {}, renderConnectionList() {}, setupControls() {},
    recordCatalog() {}, setupPage(step) { c.setupStep = step; ++c.setupGeneration; }, testSetupConnection: async () => {}, catalogMessage: () => '',
    renderKeyGuide() {}, updateSetupStatus() {}, message() {},
    window: { harness: {
      // Svaret holdes tilbage, til prøven slipper det, som når OpenCode lukker en motor, der har brugt forbindelsen.
      saveConnection: input => new Promise(resolve => ventende.push(() => {
        gemte.push(input);
        const id = input.id || `ny-${gemte.length}`;
        forbindelser = [...forbindelser.filter(x => x.id !== id), { ...forbindelser.find(x => x.id === id), id, kind: input.kind, name: input.name, baseURL: input.baseURL, hasKey: !input.clearKey && Boolean(forbindelser.find(x => x.id === id)?.hasKey) }];
        resolve({ ok: true, value: { connections: forbindelser, definitions } });
      }))
    } }
  };
  c.globalThis = c;
  vm.createContext(c);
  for (const kode of [
    linje('async function call(method, value, owner) {'), linje('async function action(fn) {'),
    udsnit('function connectionView(view) {', "$('#connection-add').onclick"),
    udsnit('function updateProvider() {', '// Nøglen indtastes i nøglevinduet.'),
    udsnit('function updateKeyRow() {', 'function connectionInput() {'),
    udsnit('function connectionInput() {', '// Kataloget fra nøglevinduets kontrol'),
    udsnit('async function connectionSaved({', '// Nøglevinduet renser, kontrollerer og gemmer nøglen.')
  ]) vm.runInContext(kode, c);
  const slip = async () => { while (ventende.length) ventende.shift()(); for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  const gem = () => $('#connection-form').onsubmit({ preventDefault() {} });
  const billede = () => ({ visning: $('#connection-edit').hidden ? 'liste' : 'redigering', id: $('#connection-id').value, udbyder: $('#provider-kind').value, navn: $('#connection-name').value, formularBesked: $('#connection-feedback').textContent, listeBesked: $('#connections-feedback').textContent });
  return { c, $, A, B, C, gemte, slip, gem, billede, aabn: x => { c.editConnection(x); $('#connections-dialog').open = true; } };
}

test('grundlinje: uden navigation imens nulstilles formularen, og listen vises med beskeden', async () => {
  const h = miljoe();
  h.aabn(h.A); h.$('#connection-name').value = 'Mistral · arbejde 2';
  h.gem(); await h.slip();
  assert.equal(h.gemte[0].name, 'Mistral · arbejde 2');
  assert.deepEqual(h.billede(), { visning: 'liste', id: '', udbyder: 'corti', navn: 'Corti S1 · EU', formularBesked: 'Forbindelsen er gemt.', listeBesked: 'Forbindelsen er gemt.' });
});

test('Tilbage og Åbn på en anden forbindelse, mens Gem venter: den nye formular og visning bevares', async () => {
  const h = miljoe();
  h.aabn(h.A); h.$('#connection-name').value = 'Mistral · arbejde 2';
  h.gem();
  h.$('#connection-back').onclick();
  h.aabn(h.B); h.$('#connection-name').value = 'Claude · privat · nyt navn';
  await h.slip();
  assert.equal(h.gemte[0].name, 'Mistral · arbejde 2', 'A er gemt med det nye navn');
  assert.deepEqual(h.billede(), { visning: 'redigering', id: 'conn-B', udbyder: 'anthropic', navn: 'Claude · privat · nyt navn', formularBesked: '', listeBesked: 'Forbindelsen er gemt.' },
    'B står urørt med brugerens indtastning; kvitteringen for A står i listen, ikke under B');
});

// Står der ændringer i formularen, som ikke er gemt, siger beskeden det (N:B2-2).
const IKKE_GEMT = 'Forbindelsen er gemt. Det, du har ændret siden, er ikke gemt endnu. Tryk Gem forbindelse for at gemme det.';

test('skriver brugeren videre i samme forbindelse, mens Gem venter, bevares indtastningen', async () => {
  const h = miljoe();
  h.aabn(h.A); h.$('#connection-name').value = 'Mistral · arbejde 2';
  h.gem();
  h.$('#connection-name').value = 'Mistral · arbejde 3';
  await h.slip();
  assert.deepEqual(h.billede(), { visning: 'redigering', id: 'conn-A', udbyder: 'mistral', navn: 'Mistral · arbejde 3', formularBesked: IKKE_GEMT, listeBesked: 'Forbindelsen er gemt.' },
    'kvitteringen siger ikke blot «gemt» over ændringer, der ikke er gemt');
  // Næste Gem opdaterer samme forbindelse.
  h.gem(); await h.slip();
  assert.deepEqual(h.gemte.map(x => [x.id, x.name]), [['conn-A', 'Mistral · arbejde 2'], ['conn-A', 'Mistral · arbejde 3']]);
});

test('en ny forbindelse i opsætningen: skriver brugeren videre, får formularen det nye id, så næste Gem ikke laver en kopi', async () => {
  const h = miljoe();
  h.c.setupActive = true; h.c.setupStep = 'provider';
  h.$('#connection-id').value = ''; h.$('#provider-kind').value = 'compatible'; h.c.updateProvider();
  h.$('#base-url').value = 'http://127.0.0.1:9000/v1';
  h.gem();
  h.$('#connection-name').value = 'Kommunens server';
  await h.slip();
  assert.equal(h.c.setupStep, 'provider', 'opsætningen springer ikke videre over brugerens indtastning');
  assert.equal(h.$('#connection-id').value, 'ny-1', 'formularen hører nu til den gemte forbindelse');
  assert.equal(h.$('#connection-name').value, 'Kommunens server');
  assert.equal(h.$('#save-connection').textContent, 'Gem forbindelse', 'knappen gemmer nu ændringen');
  h.gem(); await h.slip();
  assert.deepEqual(h.gemte.map(x => [x.id || '', x.name]), [['', 'Egen server'], ['ny-1', 'Kommunens server']], 'andet Gem opdaterer, det laver ikke en kopi');
  assert.equal(h.c.setupStep, 'saved', 'når formularen er uændret, går opsætningen videre som før');
});

test('en ny forbindelse i opsætningen: vælger brugeren en anden udbyder imens, får den nye formular ikke det gemte id', async () => {
  const h = miljoe();
  h.c.setupActive = true; h.c.setupStep = 'provider';
  h.$('#connection-id').value = ''; h.$('#provider-kind').value = 'ollama'; h.c.updateProvider();
  h.gem();
  h.$('#provider-kind').value = 'compatible'; h.c.updateProvider();
  await h.slip();
  assert.equal(h.$('#connection-id').value, '', 'Egen server-formularen må ikke overskrive den gemte Ollama-forbindelse');
  assert.equal(h.$('#provider-kind').value, 'compatible');
  assert.equal(h.c.setupStep, 'provider');
});

// N:B2-1: listen er tegnet fra tilstanden før gemningen. Åbner brugeren samme forbindelse igen, før svaret lander, fylder
// Åbn formularen med de gamle værdier. Før beholdt svaret dem under «Forbindelsen er gemt.», og næste Gem rullede ændringen
// tilbage.
test('Gem, Tilbage og Åbn på samme forbindelse, før svaret lander: formularen viser det gemte, og næste Gem ruller ikke tilbage', async () => {
  const h = miljoe();
  h.aabn(h.A); h.$('#connection-name').value = 'Mistral · arbejde 2';
  h.gem();
  h.$('#connection-back').onclick();
  h.aabn(h.A);
  assert.equal(h.$('#connection-name').value, 'Mistral · arbejde', 'forudsætning: genåbningen viser værdierne fra før gemningen');
  await h.slip();
  assert.deepEqual(h.billede(), { visning: 'redigering', id: 'conn-A', udbyder: 'mistral', navn: 'Mistral · arbejde 2', formularBesked: 'Forbindelsen er gemt.', listeBesked: 'Forbindelsen er gemt.' });
  h.gem(); await h.slip();
  assert.deepEqual(h.gemte.map(x => [x.id, x.name]), [['conn-A', 'Mistral · arbejde 2'], ['conn-A', 'Mistral · arbejde 2']], 'andet Gem ruller ikke A tilbage');
});

test('skriver brugeren i den genåbnede forbindelse, før svaret lander, bevares det, og resten får de gemte værdier', async () => {
  const h = miljoe();
  h.aabn(h.C); h.$('#connection-name').value = 'Kommunens server 2';
  h.gem();
  h.$('#connection-back').onclick();
  h.aabn(h.C); h.$('#base-url').value = 'http://127.0.0.1:9100/v1';
  await h.slip();
  assert.equal(h.$('#connection-name').value, 'Kommunens server 2', 'navnet, der lige er gemt, står i formularen');
  assert.equal(h.$('#base-url').value, 'http://127.0.0.1:9100/v1', 'brugerens nye indtastning er bevaret');
  assert.equal(h.$('#connection-feedback').textContent, IKKE_GEMT);
  h.gem(); await h.slip();
  assert.deepEqual(h.gemte.map(x => [x.name, x.baseURL]), [['Kommunens server 2', 'http://127.0.0.1:9000/v1'], ['Kommunens server 2', 'http://127.0.0.1:9100/v1']], 'navnet rulles ikke tilbage');
});

// N:B2-2: også for en gemt forbindelse skal nøglelinjen følge det gemte. Er «Fjern gemt nøgle» gemt, mens brugeren skrev
// videre, stod der stadig «Nøglen er gemt krypteret …».
test('Fjern gemt nøgle er gemt, mens brugeren skriver videre: nøglelinjen viser, at der ikke er en nøgle', async () => {
  const h = miljoe();
  h.aabn(h.A);
  assert.match(h.$('#key-state').textContent, /Nøglen er gemt krypteret/, 'forudsætning');
  h.$('#clear-key').checked = true;
  h.gem();
  h.$('#connection-name').value = 'Mistral · uden nøgle';
  await h.slip();
  assert.equal(h.gemte[0].clearKey, true);
  assert.doesNotMatch(h.$('#key-state').textContent, /Nøglen er gemt krypteret/);
  assert.equal(h.$('#clear-key-row').hidden, true, 'der er ingen gemt nøgle at fjerne');
  assert.equal(h.$('#clear-key').checked, false, 'den gemte fjernelse står ikke som valgt igen');
  assert.equal(h.$('#enter-key').textContent, 'Indtast nøgle');
  assert.equal(h.$('#connection-feedback').textContent, IKKE_GEMT);
});

test('Rediger i opsætningen på samme forbindelse, mens Gem venter: formularen viser det gemte, ikke listens gamle værdier', async () => {
  const h = miljoe();
  Object.assign(h.c, { setupActive: true, setupStep: 'provider', providerCards: [], previewKind: '', renderProviderCards() {}, providerPicker() {} });
  for (const kode of [udsnit('function chooseProvider(kind) {', '// Ollama nås gennem'), udsnit('function setupProvider(connection) {', 'function renderSetup() {')]) vm.runInContext(kode, h.c);
  h.c.setupProvider(h.C); h.$('#connection-name').value = 'Kommunens server 2';
  h.gem();
  h.c.setupProvider(h.C);
  assert.equal(h.$('#connection-name').value, 'Kommunens server', 'forudsætning: Rediger viser værdierne fra før gemningen');
  await h.slip();
  assert.equal(h.$('#connection-name').value, 'Kommunens server 2');
  assert.equal(h.$('#connection-id').value, 'conn-C');
  assert.equal(h.$('#connection-feedback').textContent, 'Forbindelsen er gemt.');
});
