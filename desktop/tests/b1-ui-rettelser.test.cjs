// K5 og test-resume (beta 3): rettelserne i ui/app.js prøvet på de ordrette udsnit af filen, som i tests/kvotekort-udbyder.test.cjs.
// 1. Grænsekortet («Udbyderen har nået en grænse») har Prøv igen som hovedknap og kontoen hos udbyderen som andet valg.
// 2. Statuslinjen siger, at Aura venter på næste forsøg efter en forbigående fejl, i stedet for «Ingen nye signaler».
// 3. Før du sender siger kun, at tidligere samtale sendes, når den faktisk sendes (kernens historyText).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = source.indexOf(fra), b = source.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return source.slice(a, b); };
const linje = fra => { const a = source.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return source.slice(a, source.indexOf('\n', a)); };

class El {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this._text = ''; this.hidden = false; this.dataset = {}; this.className = ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set textContent(value) { this.children = []; this._text = String(value); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {}
  scrollIntoView() {}
}
const knapper = el => [...(el.tagName === 'button' ? [el] : []), ...el.children.flatMap(knapper)];

function fixture() {
  const elementer = new Map(), kald = [];
  const $ = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  const view = { review: new El('section'), waitingFor: [] };
  const context = {
    $, document: { createElement: tag => new El(tag) }, view, requestAnimationFrame() {}, Date,
    state: { connections: [{ id: 'mistral', kind: 'mistral', name: 'Mistral' }, { id: 'lokal', kind: 'ollama', name: 'Ollama' }] },
    // Værdien kopieres til prøvens egen realm, så deepEqual sammenligner indholdet.
    call: async (method, value) => { kald.push([method, { ...value }]); }, action: fn => fn(),
    showSetup() {}, openTaskSettings() {}, retrySend() {}, updatePlanOffer() {}, reviewFiles() {}, resultActions: () => new El(),
    elapsedText: ms => `${Math.floor(ms / 1000)} s`,
    window: { ApprovalView: require('../ui/approval-view.js'), ChatDisplay: require('../ui/chat-display.js') }
  };
  vm.createContext(context);
  for (const kode of [linje('function node(tag, text, className)'), linje('const reviewButton = '), linje('const filesText = '), udsnit('function renderRunReview(result, v = view) {', 'let localDiscoveryGeneration'), udsnit('function renderStatus() {', '// Stop lægger beskeden tilbage')]) vm.runInContext(kode, context);
  const kort = (failure, v = view) => { context.renderRunReview({ status: 'error', files: [], failure }, v); return knapper(v.review); };
  return { context, $, view, kald, kort };
}

test('grænsekortet har Prøv igen som hovedknap og kontoen hos udbyderen som andet valg (K5)', async () => {
  const f = fixture();
  f.view.runConnection = 'mistral';
  const knap = f.kort({ kind: 'limit', message: 'HTTP 429' });
  assert.deepEqual(knap.map(item => item.textContent), ['Prøv igen', 'Åbn kontoen hos udbyderen']);
  assert.deepEqual(knap.map(item => item.className === 'primary'), [true, false], 'kun Prøv igen er hovedknap');
  // N:B1-6: første lag har én linje; forklaringen af de to slags grænser står under Se detaljer sammen med udbyderens egen tekst.
  assert.equal(f.view.review.children.find(el => el.tagName === 'p').textContent, 'Vent lidt, og prøv igen, eller se kontoens grænse hos udbyderen. Din besked står klar i skrivefeltet.');
  const detaljer = f.view.review.children.find(el => el.tagName === 'details');
  assert.ok(detaljer, 'Se detaljer findes'); assert.match(detaljer.textContent, /^Se detaljer.*kort tid.*måneden eller planen.*HTTP 429$/s);
  await knap[1].onclick();
  assert.deepEqual(f.kald, [['providerAccount', { kind: 'mistral', page: 'billing' }]]);
});

test('en lokal model uden kontoside får kun Prøv igen på grænsekortet (K5)', () => {
  const f = fixture();
  f.view.runConnection = 'lokal';
  assert.deepEqual(f.kort({ kind: 'limit', message: 'HTTP 429' }).map(item => item.textContent), ['Prøv igen']);
});

test('statuslinjen siger, at Aura venter på næste forsøg, og falder tilbage til «Ingen nye signaler», når genforsøget er slut (K5)', () => {
  const f = fixture(), now = Date.now();
  // Hændelsen fra kernen (ChatSession: model.retry) sætter genforsøget på samtalens visning og tæller som et signal.
  const modtag = new Function('event', 'v', 'active', 'renderStatus', linje("if (event.type === 'model.retry')"));
  Object.assign(f.view, { running: true, runStartedAt: now - 60000, lastSignalAt: now - 40000, runLabel: 'Arbejder', statusDetail: '', receivedChars: 0, modelProgress: null });
  let tegnet = 0;
  modtag({ type: 'model.retry', retry: { attempt: 2, next: now + 25000, status: 429, kind: 'limit' } }, f.view, true, () => { tegnet++; });
  assert.equal(tegnet, 1, 'statuslinjen tegnes igen');
  assert.ok(f.view.lastSignalAt >= now, 'genforsøget tæller som et signal');
  f.context.renderStatus();
  // HTTP-status hører til detaljerne og står ikke i statuslinjens første lag (N:B1-3, ui/approval-view.js retryText).
  assert.match(f.$('#agent-progress').textContent, /^Udbyderen afviser lige nu\. Aura prøver igen om 2\d s \(forsøg 3\)\. Du kan vente eller stoppe\.$/);
  // Kaldet går videre: kernen sender retry: null, og stilheden måles igen som før.
  modtag({ type: 'model.retry', retry: null }, f.view, true, () => {});
  f.view.lastSignalAt = Date.now() - 40000;
  f.context.renderStatus();
  assert.match(f.$('#agent-progress').textContent, /^Ingen nye signaler i 40 s/);
});

test('et gammelt genforsøg følger ikke med til næste opgave (K5)', () => {
  // setRunning nulstiller genforsøget, både når en opgave starter, og når den slutter.
  const start = linje('if (value && !v.running) { v.runStartedAt = Date.now();'), slut = linje('if (!value) {');
  const v = { running: false, modelRetry: { attempt: 1 }, waitingFor: [{ id: 'x' }] };
  new Function('value', 'v', start)(true, v);
  assert.equal(v.modelRetry, null, 'nulstillet ved start');
  v.running = true; v.modelRetry = { attempt: 4 };
  new Function('value', 'v', slut)(false, v);
  assert.deepEqual([v.modelRetry, v.waitingFor], [null, []], 'nulstillet ved slut');
});

test('Før du sender siger kun, at tidligere samtale sendes, når den sendes (test-resume, N:B1-4, N:B1-5)', () => {
  const f = fixture();
  // Linjen er kernens historyText alene; uden tidligere samtale står den ikke (DESIGN.md:57).
  const vis = data => { new Function('$', 'data', linje("$('#data-history-text').textContent = ") + '\n' + linje("$('#data-history-text').hidden = "))(f.$, data); return f.$('#data-history-text').hidden ? null : f.$('#data-history-text').textContent; };
  // Samme AI-session fortsætter: linjen siger, hvad sessionen har, og intet om en kopi.
  const fortsat = vis({ historyIncluded: false, historyText: 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater.' });
  assert.equal(fortsat, 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater. Start Ny samtale for et nyt forløb.');
  assert.doesNotMatch(fortsat, /Se indholdet/);
  // Et modelskift giver en ny AI-session, så de seneste beskeder medsendes uden brugerens tilvalg. Ingen sætning foran modsiger det.
  const skift = vis({ historyIncluded: true, historyText: 'AI-sessionen er ny, så de seneste beskeder fra samtalen medsendes som tekst. Tidligere værktøjsresultater følger ikke med.' });
  assert.equal(skift, 'AI-sessionen er ny, så de seneste beskeder fra samtalen medsendes som tekst. Tidligere værktøjsresultater følger ikke med. Start Ny samtale for et nyt forløb. Se indholdet under alle oplysninger.');
  assert.doesNotMatch(skift, /efter dit tilvalg|kan AI’en bruge tidligere beskeder og værktøjsresultater/);
  assert.equal(vis({}), null, 'intet om tidligere samtale, når intet følger med');
});

test('findes Ollama-forbindelsen ikke efter gemningen, siges det på dansk i stedet for en teknisk fejl (fund 42)', async () => {
  // Før kernerettelsen gemte Aura Ollamas adresse med /v1, så brugerfladen ikke fandt forbindelsen igen og viste en TypeError.
  // Kernen finder den nu (tests/ollama-adresse.test.cjs). Vagten her sikrer, at en afvigelse aldrig bliver en rå engelsk fejl.
  const slut = "  } finally { $('#local-discovery-use').disabled = false; }\n});";
  const kode = udsnit("$('#local-discovery-use').onclick = () => action(async () => {", slut) + slut;
  const elementer = new Map(), sider = [];
  const $ = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  const context = { $, running: false, localDiscoveryResult: { status: 'found', baseURL: 'http://127.0.0.1:11434' }, state: { connections: [] }, verifiedConnection: 'x',
    call: async () => ({ connections: [{ id: 'ollama', kind: 'ollama', baseURL: 'http://127.0.0.1:11434/v1' }] }), action: fn => fn(),
    renderConnections() {}, setupPage(name) { sider.push(name); }, async testSetupConnection() {} };
  vm.createContext(context);
  vm.runInContext(kode, context);
  await assert.rejects($('#local-discovery-use').onclick(), /^Error: Forbindelsen til Ollama blev gemt, men kunne ikke findes igen\. Åbn AI-forbindelser, og vælg den derfra\.$/);
  assert.deepEqual(sider, [], 'opsætningen går ikke videre med en forbindelse, der ikke findes');
  assert.equal($('#local-discovery-use').disabled, false, 'knappen kan bruges igen');
});
