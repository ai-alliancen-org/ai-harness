// En fejl fra en samtale må kun rydde det, der hører til DEN forbindelse. Fejlgrenen i ui/app.js ryddede før
// kontrollen og øgede setupGeneration for enhver samtales fejl, også en baggrundssamtale på en helt anden
// forbindelse. Det knækker stillGuided i connectionSaved, så den guidede opsætning aldrig når til trinnet
// "saved": brugeren får "Nøglen er kontrolleret og gemt krypteret." og ingen Fortsæt-knap, kun Tilbage.
// Prøven kører de ordrette udsnit af ui/app.js i en lille DOM, som tests/result-dialog.test.cjs gør.
// Afgørende for at den måler det rigtige: #setup-connection sættes af renderSetup, præcis som i den rigtige app,
// og "Fortsæt er synlig" måles på BÅDE knappen og dens [data-setup-step="saved"]-sektion. Måler man kun knappen,
// består prøven fejlagtigt, fordi setupControls sætter hidden = false på en knap i en skjult sektion.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TRIN = ['choice', 'provider', 'local', 'saved', 'tools', 'features', 'features-pick'];
const KILDE = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const FEJL = { type: 'engine.error', failure: { kind: 'rejected', message: 'Udbyderen afviste opgaven.' } };
const A = 'conn-A', B = 'conn-B';
// Baggrundssamtalen kører på A, altså den forbindelse brugeren arbejder på i forvejen.
const BAGGRUND = { id: 'chat-2', running: true, lastSentText: 'byg', runConnection: A };

class El {
  constructor(tag = 'div') { this.tagName = tag; this.value = ''; this.children = []; this.hidden = false; this.text = ''; this.dataset = {}; this.disabled = false; }
  get textContent() { return this.text; }
  set textContent(value) { this.text = value; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  reset() {} focus() {} scrollIntoView() {}
}

function miljoe() {
  const elementer = new Map();
  const $ = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  const trin = TRIN.map(navn => { const el = new El('section'); el.dataset.setupStep = navn; el.hidden = navn !== 'choice'; return el; });
  const document = { querySelectorAll: s => s === '[data-setup-step]' ? trin : [], createElement: tag => new El(tag) };
  const log = { invalidate: [] };
  const c = {
    $, document, console,
    projectLoading: false, setupActive: false, setupStep: 'choice', setupGeneration: 0,
    verifiedConnection: '', acceptedFingerprint: null, pendingSend: null, current: { root: '/p' }, state: null,
    preferredConnection: '',
    syncCreateAvailability() {}, updateSetupStatus() {}, moveConnectionForm() {}, renderConnections() {},
    connectionView() {}, updateProvider() {}, setStatusDetail() {}, renderStartupConnections() {},
    option: (value, text) => { const el = new El('option'); el.value = value; el.text = text; return el; },
    recordCatalog() {}, catalogMessage: () => 'katalogbesked', checkedModels: async () => [{ id: 'm' }],
    invalidateConnection(id, detalje) { log.invalidate.push([id, detalje]); },
    window: { scrollTo() {} },
  };
  c.globalThis = c;
  vm.createContext(c);
  const udsnit = (fra, til) => { const a = KILDE.indexOf(fra), b = KILDE.indexOf(til, a); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return KILDE.slice(a, b); };
  vm.runInContext(udsnit('function setupControls() {', '// Det rolige statuspanel'), c);
  vm.runInContext(udsnit('function setupPage(step) {', '// Udbyderne vises på lige vilkår.'), c);
  vm.runInContext(udsnit('function renderSetup() {', 'async function setupGit() {'), c);
  vm.runInContext(udsnit('async function testSetupConnection() {', "$('#setup-test').onclick"), c);
  vm.runInContext(udsnit('async function connectionSaved({', "$('#connection-form').onsubmit"), c);
  vm.runInContext('function haandterFejl(event, v, active) {\n' + udsnit("  if (['engine.error', 'session.error'].includes(event.type)) {", '\n});\nfunction setProjectColor(') + '\n}', c);
  const gemt = trin.find(t => t.dataset.setupStep === 'saved');
  return { c, $, log, synlig: id => !$(id).hidden && !gemt.hidden };
}

// Brugeren arbejder på A, åbner den guidede opsætning, vælger en udbyder og indtaster en nøgle til en NY
// forbindelse B. Nøglevinduet er åbent, og #enter-key har fanget generationen.
function iOpsaetningMensAArbejder(h) {
  h.c.state = { connections: [{ id: A, name: 'Mistral · arbejde' }] };
  h.c.preferredConnection = A; h.c.setupActive = true;
  h.c.renderSetup(); h.c.setupPage('choice'); h.c.setupPage('provider');
  assert.equal(h.$('#setup-connection').value, A, 'den forbindelse, brugeren arbejder på, står valgt');
  return h.c.setupGeneration;
}

test('grundlinje: uden en fremmed fejl når opsætningen frem til Fortsæt', async () => {
  const h = miljoe();
  const generation = iOpsaetningMensAArbejder(h);
  await h.c.connectionSaved({ id: B, guided: true, generation, catalog: [{ id: 'model-a' }], feedback: 'ok' });
  assert.equal(h.c.setupStep, 'saved', 'attrappen kan overhovedet nå trinnet saved');
  assert.equal(h.synlig('#setup-continue'), true);
});

test('en baggrundssamtales fejl fjerner ikke Fortsæt i den guidede opsætning', async () => {
  const h = miljoe();
  const generation = iOpsaetningMensAArbejder(h);
  h.c.haandterFejl(FEJL, BAGGRUND, false);
  await h.c.connectionSaved({ id: B, guided: true, generation, catalog: [{ id: 'model-a' }], feedback: 'Nøglen er kontrolleret og gemt krypteret.' });
  assert.equal(h.$('#connection-feedback').textContent, 'Nøglen er kontrolleret og gemt krypteret.');
  assert.equal(h.c.setupStep, 'saved', 'opsætningen skal nå trinnet saved');
  assert.equal(h.synlig('#setup-continue'), true, 'Fortsæt skal være synlig, når nøglen er gemt og kontrolleret');
  assert.equal(h.$('#setup-continue').disabled, false);
  assert.equal(h.c.verifiedConnection, B, 'kataloget fra nøglevinduet gælder som kontrollen');
  assert.deepEqual(h.log.invalidate.map(x => x[0]), [A], 'kun den fejlende forbindelse er ugyldiggjort');
});

test('Tilføj en AI mere overlever også en fremmed fejl', async () => {
  const h = miljoe();
  h.c.state = { connections: [{ id: A, name: 'Mistral' }] };
  h.c.setupActive = true; h.c.setupPage('saved');
  h.$('#setup-connection').value = A; h.c.verifiedConnection = A; h.c.setupControls();
  h.c.setupPage('provider');
  const generation = h.c.setupGeneration;
  h.c.haandterFejl(FEJL, BAGGRUND, false);
  await h.c.connectionSaved({ id: B, guided: true, generation, catalog: [{ id: 'model-a' }], feedback: 'ok' });
  assert.equal(h.c.setupStep, 'saved');
  assert.equal(h.synlig('#setup-continue'), true);
  assert.equal(h.c.verifiedConnection, B, 'den nye forbindelse er den kontrollerede; A blev ryddet undervejs');
});

test('fejler den kontrollerede forbindelse, forsvinder Fortsæt stadig', () => {
  const h = miljoe();
  h.c.state = { connections: [{ id: B, name: 'ny' }] };
  h.c.setupActive = true; h.c.setupPage('saved');
  h.$('#setup-connection').value = B; h.c.verifiedConnection = B; h.c.setupControls();
  assert.equal(h.synlig('#setup-continue'), true, 'før fejlen');
  h.c.haandterFejl(FEJL, { id: 'chat-1', running: true, lastSentText: '', runConnection: B }, true);
  assert.equal(h.c.verifiedConnection, '', 'kontrollen ryddet');
  assert.equal(h.synlig('#setup-continue'), false, 'Fortsæt væk');
  assert.equal(h.$('#setup-test').hidden, false, 'Kontrollér forbindelse tilbage');
});

test('en igangværende kontrol sætter ikke den fejlede forbindelse grøn', async () => {
  const h = miljoe();
  h.c.state = { connections: [{ id: B, name: 'ny' }] };
  h.c.setupActive = true; h.c.setupPage('saved');
  h.$('#setup-connection').value = B;
  const foer = h.c.setupGeneration;
  const kontrol = h.c.testSetupConnection();
  h.c.haandterFejl(FEJL, { id: 'chat-1', running: true, lastSentText: '', runConnection: B }, true);
  await kontrol;
  assert.ok(h.c.setupGeneration > foer + 1, 'generationen blev øget');
  assert.equal(h.c.verifiedConnection, '', 'ikke grøn bagefter');
});

test('samtykkelåsen følger forbindelsen, ikke samtalen', () => {
  // Fremmed samtale, fremmed forbindelse: låsen bevares.
  const fremmed = miljoe();
  fremmed.$('#connection-select').value = B;
  fremmed.c.pendingSend = 'bevaret';
  fremmed.c.haandterFejl(FEJL, BAGGRUND, false);
  assert.equal(fremmed.c.pendingSend, 'bevaret', 'en anden forbindelses fejl afvæbner ikke bekræftelsen');
  // Fremmed samtale, men netop den valgte forbindelse: låsen ryddes, så Send alligevel ikke sender på en
  // forbindelse, appen i samme øjeblik har markeret Ikke forbundet. Med én gemt forbindelse er det altid dette.
  const samme = miljoe();
  samme.$('#connection-select').value = A;
  samme.c.pendingSend = 'skal ryddes';
  samme.c.haandterFejl(FEJL, BAGGRUND, false);
  assert.equal(samme.c.pendingSend, null);
});

test('kontrolsvaret skrives kun i den åbne dialog', () => {
  assert.match(KILDE, /checkConnection\(id\); if \(result && \$\('#connections-dialog'\)\.open && id ===/,
    'app.js:618 skal måle dialogen, ikke setupActive: dialogen kan åbnes fra Opsætning med #setup-manage');
});
