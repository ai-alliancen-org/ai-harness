// K3 del b: statuslinjen over forhåndsvisningen sagde «Lokal forhåndsvisning» eller «Tilsluttet lokal server», så snart
// rammens src var sat, og afstemningen skrev det igen hvert 1,5 s. Viste kontrollen efter en opgave, at siden ikke blev
// vist, eller meldte hovedprocessen en fejlet indlæsning (did-fail-load), stod statuslinjen stadig, som om alt kørte.
// Prøven kører de ordrette udsnit af ui/app.js: showPreview, checkPreview, afstemningen, ↻ og hændelseslytteren.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KILDE = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = KILDE.indexOf(fra), b = KILDE.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return KILDE.slice(a, b); };
const linje = fra => { const a = KILDE.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return KILDE.slice(a, KILDE.indexOf('\n', a)); };

class El {
  constructor(id = '') { this.id = id; this.hidden = false; this.inert = false; this.dataset = {}; this.attrs = {}; this.listeners = {}; this._text = ''; this.title = ''; this.isConnected = true; }
  get textContent() { return this._text; } set textContent(v) { this._text = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(name, fn) { (this.listeners[name] ||= new Set()).add(fn); } removeEventListener(name, fn) { this.listeners[name]?.delete(fn); }
}
// En iframe: når src sættes, kommer load-hændelsen bagefter, også når siden ikke kan vises (som i Chromium).
class Ramme extends El {
  get src() { return this.attrs.src ?? ''; }
  set src(url) { this.attrs.src = String(url); this.indlaesninger = (this.indlaesninger || 0) + 1; setImmediate(() => { for (const fn of [...(this.listeners.load || [])]) fn(); }); }
}

function miljoe() {
  const els = new Map([['#preview', new Ramme('preview')]]);
  const $ = sel => { if (!els.has(sel)) els.set(sel, new El(sel)); return els.get(sel); };
  const svar = { revision: 'r1', previewCheck: { preview: true, loaded: true, status: 200, errors: [], errorCount: 0 } };
  const c = {
    $, URL, console, document: { getElementById: id => $('#' + id) },
    current: { root: '/p', workspaceRoot: '/p' }, view: { id: 'chat-1' }, revision: null, polling: false,
    setTimeout: fn => { setImmediate(fn); return 1; }, clearTimeout() {},
    call: async method => { if (method === 'revision') return svar.revision; if (method === 'previewCheck') return svar.previewCheck; return null; },
    viewFor: () => c.view, message() {}, usePreviewContext() {},
    window: { previewEdit: null, previewServer: null, workspace: null, chats: null, harness: {} }
  };
  c.globalThis = c;
  vm.createContext(c);
  const start = KILDE.indexOf("setInterval(async () => { if (!current || polling) return;");
  const afstemning = KILDE.slice(start + 'setInterval('.length, KILDE.indexOf('}, 1500);', start) + 1);
  const lytter = udsnit('window.harness.onEvent(event => {', '\n});\nfunction setProjectColor(').replace('window.harness.onEvent(event => {', '');
  for (const kode of [
    udsnit('const previewFrames = new Map();', 'async function displayProject(project'),
    udsnit('async function checkPreview(result) {', 'const targetLine = '),
    linje("$('#refresh').onclick = "),
    'var afstem = ' + afstemning,
    'function haendelse(event) {' + lytter + '\n}'
  ]) vm.runInContext(kode, c);
  const vent = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { c, $, svar, vent, status: () => $('#preview-status').textContent };
}
const URL_P = 'aura-preview://projekt-a/';

test('grundlinje: en side, kontrollen så blive vist, står som Lokal forhåndsvisning', async () => {
  const h = miljoe();
  h.c.showPreview(URL_P);
  assert.equal(h.status(), 'Lokal forhåndsvisning');
  await h.c.checkPreview({ chat: 'chat-1' }); await h.vent();
  assert.equal(h.status(), 'Lokal forhåndsvisning');
  await h.c.afstem();
  assert.equal(h.status(), 'Lokal forhåndsvisning');
});

test('viser kontrollen efter opgaven, at siden ikke blev vist, siger statuslinjen det og bliver ved', async () => {
  const h = miljoe();
  h.c.showPreview(URL_P);
  h.svar.previewCheck = { preview: true, loaded: false, status: null, errors: [], errorCount: 0 };
  await h.c.checkPreview({ chat: 'chat-1' }); await h.vent();
  assert.match(h.status(), /Siden blev ikke vist\. Tryk ↻/, 'statuslinjen følger kontrollen');
  // Afstemningen hvert 1,5 s må ikke skrive Lokal forhåndsvisning hen over problemet.
  await h.c.afstem(); await h.c.afstem();
  assert.match(h.status(), /Siden blev ikke vist/);
  // ↻ indlæser siden igen, og så gælder kilden igen.
  h.$('#refresh').onclick();
  assert.equal(h.status(), 'Lokal forhåndsvisning');
});

test('svarer siden med en fejl, siger statuslinjen, at den ikke blev vist, og fejlkoden står i detaljen', async () => {
  const h = miljoe();
  h.c.showPreview(URL_P);
  h.svar.previewCheck = { preview: true, loaded: true, status: 404, errors: [], errorCount: 0 };
  await h.c.checkPreview({ chat: 'chat-1' }); await h.vent();
  assert.match(h.status(), /Siden blev ikke vist/);
  assert.match(h.$('#preview-status').title, /404/);
});

test('en fejlet indlæsning, som hovedprocessen melder, vises, fx et link til et andet websted', async () => {
  const h = miljoe();
  h.c.showPreview('http://localhost:5173/', true);
  assert.equal(h.status(), 'Tilsluttet lokal server');
  h.c.haendelse({ type: 'preview.failed', url: 'https://www.borger.dk/', code: -30 });
  assert.match(h.status(), /Andre websteder åbnes ikke her\. Tryk ↻/);
  // En ny adresse er en ny indlæsning, og problemet gælder ikke længere.
  h.c.showPreview('http://localhost:5174/', true);
  assert.equal(h.status(), 'Tilsluttet lokal server');
  h.c.haendelse({ type: 'preview.failed', url: 'http://localhost:5174/mangler', code: -6 });
  assert.match(h.status(), /Siden kunne ikke vises\. Tryk ↻/);
});

test('en fejlet indlæsning i en anden arbejdsmappes ramme ændrer ikke den viste statuslinje', async () => {
  // Hovedprocessen melder rammens egen arbejdsmappe (tests/c1-ramme-tilskrivning.test.cjs); kun den viste arbejdsmappe vises her.
  const h = miljoe();
  h.c.showPreview(URL_P);
  h.c.haendelse({ type: 'preview.failed', root: '/p', workspaceRoot: '/kopi', url: 'https://www.borger.dk/', code: -30 });
  assert.equal(h.status(), 'Lokal forhåndsvisning');
  h.c.haendelse({ type: 'preview.failed', root: '/p', workspaceRoot: '/p', url: 'https://www.borger.dk/', code: -30 });
  assert.match(h.status(), /Andre websteder åbnes ikke her\. Tryk ↻/);
});

test('en fejl i selve kilden går forrest, og en ny revision indlæser siden igen', async () => {
  const h = miljoe();
  h.c.showPreview(URL_P);
  h.c.haendelse({ type: 'preview.failed', url: URL_P + 'side.html', code: -6 });
  h.c.call = async () => { throw new Error('ENOENT'); };
  await h.c.afstem();
  assert.match(h.status(), /^Kan ikke læse siden\b/, 'filer, der ikke kan læses, står forrest');
  h.c.call = async () => 'r2'; h.c.revision = 'r1';
  const foer = h.$('#preview').indlaesninger;
  await h.c.afstem();
  assert.equal(h.$('#preview').indlaesninger, foer + 1, 'en ændret fil genindlæser siden');
  assert.equal(h.status(), 'Lokal forhåndsvisning', 'genindlæsningen rydder det gamle problem');
});

test('serverens tilstand fra server.js: «kører» lader problemet stå, mens en server, der starter, går forrest', async () => {
  const h = miljoe();
  h.c.showPreview('http://127.0.0.1:5173/', true);
  h.c.haendelse({ type: 'preview.failed', url: 'https://www.borger.dk/', code: -30 });
  // server.js skriver serverens tilstand gennem window.setPreviewStatus(tekst, går forrest).
  h.c.window.setPreviewStatus('Forhåndsvisningen kører', false);
  assert.match(h.status(), /Andre websteder åbnes ikke her/, 'en server, der kører, siger ikke noget om siden');
  h.c.window.setPreviewStatus('Starter forhåndsvisningen …', true);
  assert.equal(h.status(), 'Starter forhåndsvisningen …');
  h.c.window.setPreviewStatus('Forhåndsvisningen kører', false);
  assert.match(h.status(), /Andre websteder åbnes ikke her/, 'siden er ikke indlæst igen, så problemet står stadig');
  h.$('#refresh').onclick();
  assert.equal(h.status(), 'Forhåndsvisningen kører');
});

test('en blokeret navigation, som hovedprocessen forklarer, ændrer statuslinjen; en blokeret ressource gør ikke', async () => {
  const h = miljoe();
  h.c.showPreview(URL_P);
  h.c.haendelse({ type: 'preview.diagnostic', root: '/p', workspaceRoot: '/p', diagnostic: { kind: 'scripts', origin: 'https://unpkg.com' } });
  assert.equal(h.status(), 'Lokal forhåndsvisning', 'et blokeret kodebibliotek betyder ikke, at siden ikke vises');
  h.c.haendelse({ type: 'preview.diagnostic', root: '/andet', workspaceRoot: '/andet', diagnostic: { kind: 'navigation', origin: 'https://www.borger.dk' } });
  assert.equal(h.status(), 'Lokal forhåndsvisning', 'et andet projekts forhåndsvisning ændrer ikke denne');
  h.c.haendelse({ type: 'preview.diagnostic', root: '/p', workspaceRoot: '/p', diagnostic: { kind: 'navigation', origin: 'https://www.borger.dk' } });
  assert.match(h.status(), /Andre websteder åbnes ikke her\. Tryk ↻/);
  assert.match(h.$('#preview-status').title, /https:\/\/www\.borger\.dk/);
});
