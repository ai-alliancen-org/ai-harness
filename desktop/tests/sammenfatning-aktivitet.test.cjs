// RN:B1-3: når samtalen ikke kan gøres kortere («Gør samtalen kortere og prøv igen»), fordi sammenfatningen mislykkes,
// (a) siger Aktivitet fejlens type som resultatkortet, fx «AI’en afviste din nøgle», i stedet for «Opgaven kunne ikke starte», og
// (b) får brugerfladen fejlen fra forbindelsen ligesom ved en almindelig opgave, så en afvist nøgle markerer forbindelsen
// «Ikke forbundet». Før slugte grenen for compacting i ChatSession.event fejlen. Prøven kører den rigtige gateway og ChatSession
// med en falsk motor, der gør som OpenCode under en sammenfatning (som tests/sammenfatning-fejlkort.test.cjs), og brugerfladens
// egen håndtering af fejlen (ui/app.js) køres ordret.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Workbench } = require('../core/workbench.cjs');
const ApprovalView = require('../ui/approval-view.js');
const profiles = path.join(__dirname, '../../profiles');

async function udbyder(t) {
  const state = { svar: 'afbryd' };
  const server = http.createServer(async (req, res) => {
    if (state.svar === 'afbryd') return req.socket.destroy();
    for await (const _ of req) { /* læst */ }
    res.writeHead(state.svar, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Udbyderens egen fejl' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return Object.assign(state, { baseURL: `http://127.0.0.1:${server.address().port}/v1` });
}

async function samtale(t, baseURL) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-sammenfatning-aktivitet-'));
  const root = path.join(directory, 'projekt'); await fsp.mkdir(root);
  const events = [], engines = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  t.after(async () => { await bench.close(); await fsp.rm(directory, { recursive: true, force: true }); });
  bench.engineFactory = options => {
    const engine = { options, active: false, resumed: false, session: { id: `ses-${engines.length + 1}` }, pending: new Map(), start: async () => { engine.active = true; }, send: async () => {}, messages: async () => [{ id: 'm1' }, { id: 'm2' }], request: async () => true, reply: async () => {}, abort: async () => {}, close: async () => { engine.active = false; } };
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

// Som OpenCode under en sammenfatning: hvert forsøg går gennem gatewayen; efter det sidste meldes fejlen med compacting.
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

for (const [navn, forsoeg, kind] of [['afvist nøgle', [401], 'key'], ['afbrudt forbindelse', ['afbryd', 'afbryd'], 'network']]) {
  test(`Aktivitet siger fejlens type, når sammenfatningen mislykkes (${navn})`, async t => {
    const provider = await udbyder(t);
    const { chat, engine, send } = await samtale(t, provider.baseURL);
    sammenfatning(chat, engine, provider, forsoeg);
    const error = await send('Prøv igen', { compact: true }).then(() => null, error => error);
    assert.equal(error?.failure, kind);
    const entry = chat.activityList().filter(item => item.kind === 'error').at(-1);
    assert.equal(entry?.title, ApprovalView.failureText(kind).title, 'samme type som resultatkortet');
    assert.notEqual(entry?.title, 'Opgaven kunne ikke starte');
    assert.match(entry?.detail || '', /^Samtalen kunne ikke gøres kortere\. /, 'Aktivitet siger, hvad der mislykkedes');
    assert.ok(entry.detail.includes(error.message), 'og beskeden bag fejlen');
  });
}

test('en afvist nøgle under sammenfatningen markerer forbindelsen som ved en almindelig opgave', async t => {
  const provider = await udbyder(t);
  const { chat, engine, events, send } = await samtale(t, provider.baseURL);
  sammenfatning(chat, engine, provider, [401]);
  const before = events.length;
  await send('Prøv igen', { compact: true }).catch(() => {});
  const failure = events.slice(before).find(event => event.type === 'engine.error' && event.failure?.kind === 'key');
  assert.ok(failure, 'brugerfladen får fejlen fra forbindelsen');
  assert.equal(failure.chat, chat.id, 'fejlen hører til samtalen');
  // Brugerfladens egen håndtering af en fejl under en opgave (ui/app.js), ordret.
  const kilde = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  const start = kilde.indexOf("  if (['engine.error', 'session.error'].includes(event.type)) {");
  assert.ok(start >= 0, 'håndteringen findes i ui/app.js');
  let end = kilde.indexOf('{', start), depth = 0;
  for (; end < kilde.length; end++) { if (kilde[end] === '{') depth++; else if (kilde[end] === '}' && --depth === 0) break; }
  const elementer = new Map(), markeret = [];
  const context = { $: selector => { if (!elementer.has(selector)) elementer.set(selector, { value: selector === '#connection-select' ? 'c' : '' }); return elementer.get(selector); },
    invalidateConnection: (id, detail) => markeret.push([id, detail]), setupControls() {}, setStatusDetail() {}, acceptedFingerprint: 'gammel', pendingSend: {}, verifiedConnection: 'c', setupActive: false, setupStep: '', setupGeneration: 0 };
  vm.createContext(context);
  const haandter = vm.runInContext(`(function (event, v, active) {\n${kilde.slice(start, end + 1)}\n})`, context);
  const view = { running: true, runConnection: 'c', lastSentText: 'Prøv igen' };
  for (const event of events.slice(before).filter(item => ['engine.error', 'session.error'].includes(item.type))) haandter(event, view, true);
  assert.deepEqual(markeret.map(([id]) => id), ['c'], 'forbindelsen markeres Ikke forbundet');
  assert.equal(context.verifiedConnection, '', 'kontrollen af forbindelsen gælder ikke længere');
});
