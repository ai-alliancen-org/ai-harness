// Fund 12 i sammenfatningen. Brugeren vælger «Gør samtalen kortere og prøv igen», og sammenfatningen mislykkes, fx fordi
// udbyderen ikke kan nås. Hovedprocessen kender fejlens type (grenen for compacting i ChatSession.event), men afsendelsens
// fejl bar den ikke med. Kortet sagde derfor altid «Opgaven kunne ikke starte», også når statuslinjen i over et minut havde
// sagt, at forbindelsen var afbrudt, og også når nøglen var afvist. Et Stop under sammenfatningen gav samme fejlkort.
// Prøven kører den rigtige gateway og ChatSession med en falsk motor, der gør som OpenCode under en sammenfatning: hvert
// forsøg går gennem gatewayen, og efter det sidste meldes fejlen med compacting, og sammenfatningen afvises (engine.cjs,
// handleEvent). Handle-indpakningen fra main.cjs og call, sendNow og renderRunReview fra ui/app.js køres ordret.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

// Udbyderen. 'afbryd' lukker forbindelsen, før der kommer et svar; et tal svarer med den status.
async function udbyder(t) {
  const state = { svar: 'afbryd' };
  const server = http.createServer(async (req, res) => {
    if (state.svar === 'afbryd') return req.socket.destroy();
    for await (const _ of req) { /* læst */ }
    res.writeHead(state.svar, { 'content-type': 'application/json', ...(state.retryAfter ? { 'retry-after': state.retryAfter } : {}) }); res.end(JSON.stringify({ error: { message: 'Udbyderens egen fejl' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return Object.assign(state, { baseURL: `http://127.0.0.1:${server.address().port}/v1` });
}

// En samtale med én gennemført besked, så der er noget at sammenfatte.
async function samtale(t, baseURL) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-sammenfatning-'));
  const root = path.join(directory, 'projekt'); await fsp.mkdir(root);
  const events = [], engines = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  // Samtalen lukkes, før mappen fjernes.
  t.after(async () => { await bench.close(); await fsp.rm(directory, { recursive: true, force: true }); });
  bench.engineFactory = options => {
    const engine = { options, active: false, resumed: false, session: { id: `ses-${engines.length + 1}` }, pending: new Map(), start: async () => { engine.active = true; }, send: async () => {}, messages: async () => [{ id: 'm1' }, { id: 'm2' }], request: async () => true, reply: async () => {}, abort: async () => { engine.onAbort?.(); }, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  };
  await bench.activate({ root, name: 'Sammenfatning' });
  const chat = bench.chat;
  const send = (text, extra = {}) => {
    chat.prepared = { mode: 'free', root: chat.root, connection: { id: 'c', kind: 'compatible', name: 'Prøve', baseURL }, model: { id: 'test' }, route: null, references: [], fileRefs: [], view: null, autoCheckpoint: false, startup: null,
      disclosure: { fingerprint: 'regler-1', consentKey: 'samtykke', modelName: 'test', provider: 'Prøve' }, context: { rules: '', skills: [], titles: [], features: { versioner: false }, integrations: [] } };
    return bench.send({ chat: chat.id, text, fingerprint: 'regler-1', ...extra });
  };
  await send('Første besked'); chat.event({ type: 'session.idle' }); await bench.finishing;
  return { bench, chat, engine: engines[0], events, send };
}

// Som OpenCode under en sammenfatning: hvert forsøg går gennem gatewayen. Efter det sidste melder motoren fejlen med
// compacting og afviser sammenfatningen med fejlens tekst.
function sammenfatning(chat, engine, provider, forsoeg) {
  engine.summarize = async () => {
    let status, message;
    for (const svar of forsoeg) {
      provider.svar = svar;
      const response = await fetch(chat.gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${chat.gateway.token}` }, body: JSON.stringify({ model: 'test', messages: [] }) });
      status = response.status; message = (await response.json()).error.message;
    }
    chat.event({ type: 'session.error', compacting: true, properties: { error: { name: 'APIError', data: { statusCode: status, isRetryable: status !== 401, message } } } });
    throw new Error(message);
  };
}

test('afbrydes forbindelsen under sammenfatningen, bærer afsendelsens fejl typen network', async t => {
  const provider = await udbyder(t);
  const { chat, engine, send } = await samtale(t, provider.baseURL);
  sammenfatning(chat, engine, provider, ['afbryd', 'afbryd']);
  const error = await send('Prøv igen', { compact: true }).then(() => null, error => error);
  assert.equal(error?.message, 'Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.');
  assert.equal(error?.failure, 'network', 'kortet skal sige, at forbindelsen blev afbrudt');
});

test('svarer udbyderen selv 502 i det sidste forsøg, er det udbyderens serverfejl og ikke en netfejl', async t => {
  const provider = await udbyder(t);
  const { chat, engine, send } = await samtale(t, provider.baseURL);
  sammenfatning(chat, engine, provider, ['afbryd', 502]);
  const error = await send('Prøv igen', { compact: true }).then(() => null, error => error);
  assert.equal(error?.failure, 'server', 'gatewayen har glemt sin netfejl, da udbyderen svarede');
});

test('afviser udbyderen nøglen under sammenfatningen, fører kortet til forbindelsen', async t => {
  const provider = await udbyder(t);
  const { chat, engine, send } = await samtale(t, provider.baseURL);
  sammenfatning(chat, engine, provider, [401]);
  const error = await send('Prøv igen', { compact: true }).then(() => null, error => error);
  assert.match(error?.message || '', /HTTP 401/);
  assert.equal(error?.failure, 'key');
});

// Skeptikerens fund: under sammenfatningen fulgte tidspunktet fra et langt Retry-After ikke med i runFailure, så kortet ikke
// sagde, hvornår udbyderen tager imod igen. Det stod kun under Se detaljer.
test('beder udbyderen om at vente længere end loftet under sammenfatningen, bærer fejlen tidspunktet med', async t => {
  const provider = await udbyder(t); provider.retryAfter = '3600';
  const { chat, engine, send } = await samtale(t, provider.baseURL);
  sammenfatning(chat, engine, provider, [429]);
  const before = Date.now(), error = await send('Prøv igen', { compact: true }).then(() => null, error => error);
  assert.equal(error?.failure, 'limit', 'en hastighedsgrænse og ikke en opbrugt konto');
  assert.ok(error?.retryAt >= before + 3_600_000 && error?.retryAt <= Date.now() + 3_600_000, `tidspunktet følger med: ${error?.retryAt}`);
});

test('Stop under sammenfatningen er et stop og ikke en fejl', async t => {
  const provider = await udbyder(t);
  const { bench, engine, events, send } = await samtale(t, provider.baseURL);
  let begyndt; const sammenfatter = new Promise(resolve => { begyndt = resolve; });
  // Som OpenCodeEngine: Stop afbryder sammenfatningen (abort kalder cancelCompaction).
  engine.summarize = () => new Promise((resolve, reject) => { engine.onAbort = () => reject(new Error('Sammenfatningen blev stoppet.')); begyndt(); });
  const sending = send('Prøv igen', { compact: true }).then(() => null, error => error);
  await sammenfatter; await bench.stop();
  const error = await sending;
  assert.equal(error?.message, 'Opgaven blev stoppet før afsendelse.', 'brugerfladen genkender et stop på denne tekst');
  assert.equal(error?.failure, undefined);
  assert.equal(events.filter(event => event.type === 'run.review').at(-1)?.status, 'stopped');
});

test('handle-indpakningen i main.cjs sender fejlens type med, og kun en kort typebetegnelse', async () => {
  const kilde = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const a = kilde.indexOf('function handle(channel, action) {'), b = kilde.indexOf("handle('updates:state'", a);
  assert.ok(a >= 0 && b > a, 'handle findes i main.cjs');
  const lyttere = new Map(), sender = {}, uiURL = 'harness://app/index.html';
  const context = {
    ipcMain: { handle: (channel, fn) => lyttere.set(channel, fn) },
    window: { webContents: Object.assign(sender, { mainFrame: { url: uiURL } }) },
    uiURL, updating: false, recordFailure() {}, registry: { selected: { chatFor: () => null, project: { root: '/p' } }, get: () => null },
    requests: { run: (_context, fn) => fn() }
  };
  vm.createContext(context); vm.runInContext(kilde.slice(a, b), context);
  // Svaret kopieres til prøvens egen realm, så deepEqual sammenligner indholdet og ikke vm-kontekstens prototyper.
  const kald = async fejl => { context.handle('agent:send', () => { throw fejl; }); return { ...await lyttere.get('agent:send')({ sender, senderFrame: sender.mainFrame }, {}, null) }; };
  assert.deepEqual(await kald(Object.assign(new Error('Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.'), { failure: 'network' })), { ok: false, error: 'Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.', failure: 'network' });
  assert.deepEqual(await kald(new Error('Opgaven blev stoppet før afsendelse.')), { ok: false, error: 'Opgaven blev stoppet før afsendelse.' });
  assert.deepEqual(await kald(Object.assign(new Error('Andet'), { failure: { kind: 'network' } })), { ok: false, error: 'Andet' }, 'kun en kort typebetegnelse sendes med');
  // Tidspunktet fra et langt Retry-After følger med som tal; andet sendes ikke.
  assert.deepEqual(await kald(Object.assign(new Error('Udbyderen tager først imod igen.'), { failure: 'limit', retryAt: 1_900_000_000_000 })), { ok: false, error: 'Udbyderen tager først imod igen.', failure: 'limit', retryAt: 1_900_000_000_000 });
  assert.deepEqual(await kald(Object.assign(new Error('Andet'), { failure: 'limit', retryAt: 'i morgen' })), { ok: false, error: 'Andet', failure: 'limit' });
});

// Brugerfladen: den ordrette call, sendNow og renderRunReview fra ui/app.js med en falsk window.harness.
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = app.indexOf(fra), b = app.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return app.slice(a, b); };
const linje = fra => { const a = app.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return app.slice(a, app.indexOf('\n', a)); };
class El {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this._text = ''; this.hidden = false; this.open = false; this.value = ''; this.dataset = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set textContent(value) { this.children = []; this._text = String(value); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  scrollIntoView() {}
  close() { this.open = false; }
  focus() {}
}
function brugerflade(svar) {
  const elementer = new Map(), status = [];
  const $ = selector => { if (!elementer.has(selector)) elementer.set(selector, new El()); return elementer.get(selector); };
  const view = { id: 'samtale', review: new El('section'), waitingFor: [], historyPending: [] };
  view.review.hidden = true;
  const context = {
    $, document: { createElement: tag => new El(tag) }, view, requestAnimationFrame() {}, state: { connections: [{ id: 'c', kind: 'compatible' }] }, acceptedFingerprint: null, activePlan: null,
    selectedOwner: () => ({ root: '/projekt', chat: 'samtale' }), renderHistoryControls() {}, setRunning(running, text) { status.push(text); }, appendMessage() {}, async saveChatDraft() {}, reviewKey: data => data.fingerprint,
    action: fn => fn(), showSetup() {}, openTaskSettings() {}, retrySend() {}, updatePlanOffer() {}, reviewFiles() {}, resultActions: () => new El(),
    window: { ApprovalView: require('../ui/approval-view.js'), harness: { send: async () => svar } }
  };
  vm.createContext(context);
  for (const kode of [linje('function node(tag, text, className)'), linje('async function call(method, value, owner) {'), linje('const reviewButton = '), linje('const filesText = '), udsnit('function renderRunReview(result, v = view) {', 'let localDiscoveryGeneration'), udsnit('async function sendNow(data, text) {', '// Under en opgave viser statusfeltet')]) vm.runInContext(kode, context);
  const overskrift = () => view.review.children.find(child => child.tagName === 'h3')?.textContent;
  return { context, view, status, overskrift, send: () => context.sendNow({ fingerprint: 'f', contextBinding: 'b' }, 'Prøv igen') };
}

test('call bærer fejlens type med til brugerfladen', async () => {
  const f = brugerflade({ ok: false, error: 'Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.', failure: 'network' });
  const fejl = await f.context.call('send', {}).then(() => null, error => error);
  assert.equal(fejl?.failure, 'network');
  const uden = await brugerflade({ ok: false, error: 'Andet' }).context.call('send', {}).then(() => null, error => error);
  assert.equal(uden?.failure, undefined);
});

test('en mislykket sammenfatning viser kortet for sin egen fejltype', async () => {
  const net = brugerflade({ ok: false, error: 'Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.', failure: 'network' });
  await net.send();
  assert.equal(net.overskrift(), 'Forbindelsen til AI’en blev afbrudt');
  assert.equal(net.view.review.hidden, false);
  assert.equal(net.status.at(-1), 'Fejl');
  const noegle = brugerflade({ ok: false, error: 'Modelserveren afviste kaldet (HTTP 401).', failure: 'key' });
  await noegle.send();
  assert.equal(noegle.overskrift(), 'AI’en afviste din nøgle');
  // Uden en kendt type er det stadig opstarten, der fejlede.
  const start = brugerflade({ ok: false, error: 'Agentmotoren kunne ikke starte.' });
  await start.send();
  assert.equal(start.overskrift(), 'Opgaven kunne ikke starte');
});

test('en mislykket sammenfatning med et langt Retry-After siger på kortet, hvornår udbyderen tager imod igen', async () => {
  const retryAt = Date.now() + 45 * 60_000;
  const f = brugerflade({ ok: false, error: 'Modelserveren svarede (HTTP 429).', failure: 'limit', retryAt });
  const fejl = await f.context.call('send', {}).then(() => null, error => error);
  assert.equal(fejl?.retryAt, retryAt, 'call bærer tidspunktet med');
  f.context.retryAtText = at => `Udbyderen tager først imod igen ${new Date(at).toISOString()}`;
  await f.send();
  assert.equal(f.overskrift(), 'Udbyderen har nået en grænse');
  assert.ok(f.view.review.children.some(child => child.textContent === `Udbyderen tager først imod igen ${new Date(retryAt).toISOString()}`), 'linjen om tidspunktet står på kortet');
});

test('et stop under opstarten giver intet fejlkort', async () => {
  const f = brugerflade({ ok: false, error: 'Opgaven blev stoppet før afsendelse.' });
  await f.send();
  assert.equal(f.status.at(-1), 'Stoppet');
  assert.equal(f.view.review.hidden, true, 'resultatkortet for stoppet opgave står tilbage');
  assert.equal(f.overskrift(), undefined);
});
