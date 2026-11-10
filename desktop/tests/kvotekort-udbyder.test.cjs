// Fund 14: kortet «Kontoen hos udbyderen er brugt op» åbner kontoen hos den udbyder, opgaven blev sendt til.
// Før læste knappen den forbindelse, der er valgt under skrivefeltet nu. Skiftede brugeren forbindelse, mens
// opgaven kørte, åbnede knappen den forkerte udbyders side. Prøven kører den ordrette renderRunReview fra ui/app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = source.indexOf(fra), b = source.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return source.slice(a, b); };
const linje = fra => { const a = source.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return source.slice(a, source.indexOf('\n', a)); };

class El {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this._text = ''; this.hidden = false; this.dataset = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set textContent(value) { this.children = []; this._text = String(value); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  scrollIntoView() {}
}
const knapper = el => [...(el.tagName === 'button' ? [el] : []), ...el.children.flatMap(knapper)];

function fixture() {
  const elementer = new Map(), kald = [], opsaetning = [];
  const $ = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  const view = { review: new El('section'), waitingFor: [] };
  const context = {
    $, document: { createElement: tag => new El(tag) }, view, requestAnimationFrame() {},
    state: { connections: [{ id: 'or', kind: 'openrouter', name: 'OpenRouter' }, { id: 'claude', kind: 'anthropic', name: 'Claude' }, { id: 'lokal', kind: 'ollama', name: 'Ollama' }] },
    // Værdien kopieres til prøvens egen realm, så deepEqual sammenligner indholdet.
    call: async (method, value) => { kald.push([method, { ...value }]); }, action: fn => fn(),
    showSetup(reason) { opsaetning.push(reason); }, openTaskSettings() {}, retrySend() {}, updatePlanOffer() {}, reviewFiles() {}, resultActions: () => new El(),
    window: { ApprovalView: require('../ui/approval-view.js') }
  };
  vm.createContext(context);
  for (const kode of [linje('function node(tag, text, className)'), linje('const reviewButton = '), linje('const filesText = '), udsnit('function renderRunReview(result, v = view) {', 'let localDiscoveryGeneration')]) vm.runInContext(kode, context);
  const kort = (failure, v = view) => { context.renderRunReview({ status: 'error', files: [], failure }, v); return knapper(v.review); };
  return { context, $, view, kald, opsaetning, kort };
}

test('kontoknappen åbner udbyderen for den forbindelse, opgaven brugte', async () => {
  const f = fixture();
  // Opgaven gik til OpenRouter. Mens den kørte, valgte brugeren Claude under skrivefeltet.
  f.view.runConnection = 'or'; f.$('#connection-select').value = 'claude';
  const konto = f.kort({ kind: 'quota', message: 'HTTP 402' }).find(knap => knap.textContent === 'Åbn kontoen hos udbyderen');
  assert.ok(konto, 'kortet har knappen til kontoen');
  await konto.onclick();
  assert.deepEqual(f.kald, [['providerAccount', { kind: 'openrouter', page: 'start' }]], 'OpenRouters side, ikke Anthropics');
});

test('har opgavens udbyder ingen kontoside, fører kortet til forbindelsen, selv om den valgte har en', () => {
  const f = fixture();
  f.view.runConnection = 'lokal'; f.$('#connection-select').value = 'claude';
  const navne = f.kort({ kind: 'quota', message: 'HTTP 402' }).map(knap => knap.textContent);
  assert.ok(!navne.includes('Åbn kontoen hos udbyderen'), 'ingen kontoknap for en lokal model');
  assert.ok(navne.includes('Gennemgå AI-forbindelse'));
});

test('uden kendt forbindelse for opgaven bruges den valgte forbindelse som før', async () => {
  const f = fixture();
  f.$('#connection-select').value = 'claude';
  await f.kort({ kind: 'quota', message: 'HTTP 402' }).find(knap => knap.textContent === 'Åbn kontoen hos udbyderen').onclick();
  assert.deepEqual(f.kald, [['providerAccount', { kind: 'anthropic', page: 'billing' }]]);
});
