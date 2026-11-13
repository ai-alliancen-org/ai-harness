// N:B1-4, N:B1-5 og Q:A-7 (2): linjen om tidligere samtale i «Før du sender» kommer fra kernen (historyText) og nævner kun
// tidligere samtale, når den faktisk følger med (DESIGN.md:57). I en fortsat AI-session har AI'en beskederne og
// værktøjsresultaterne. I en ny AI-session sendes de seneste beskeder som tekst, og værktøjsresultater følger ikke med. Linjen
// afhænger aldrig af tilvalget «Medsend en ekstra kopi», som appen selv sætter i flere forløb (fx «Byg første udkast»), og siger
// derfor aldrig «efter dit tilvalg». En ny samtale nævner ikke tidligere samtale.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const COPY = 'Tidligere beskeder fra samme samtale';
const FORTSAT = 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater.';
const NY = 'AI-sessionen er ny, så de seneste beskeder fra samtalen medsendes som tekst. Tidligere værktøjsresultater følger ikke med.';
const plan = ['## Det bygger vi', 'En side med violet-cykel.', '## Sådan skal det se ud', 'Rolig og enkel.', '## Teknik og data', 'HTML uden netværk.', '## Det skal du prøve', 'Se cyklen i forhåndsvisningen.'].join('\n');

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-tidligere-linje-')));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Tidligere samtale' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  let model = { id: 'model-a' };
  bench.selection = async () => ({ connection, model, route: null });
  const input = (text, extra = {}) => ({ connectionID: connection.id, modelID: model.id, mode: 'free', text, ...extra });
  const send = async (review, text) => bench.send({ text, fingerprint: review.fingerprint, contextBinding: review.contextBinding });
  let answers = 0;
  const finish = async (reply = 'Svaret er klar.') => {
    const chat = bench.chat, id = `svar-${++answers}`;
    chat.runRoles.set(id, 'assistant'); chat.runText.set(id, { id, messageID: id, text: reply });
    chat.event({ type: 'session.idle' }); await chat.finishing;
  };
  return { bench, engines, input, send, finish, setModel: id => { model = { id }; } };
}

test('første besked i en ny samtale nævner ikke tidligere samtale, heller ikke med tilvalget', async t => {
  const f = await fixture(t);
  for (const includeHistory of [false, true]) {
    const review = await f.bench.prepare(f.input('Lav en side med violet-cykel', { includeHistory }));
    assert.equal(review.historyIncluded, false);
    assert.equal(review.conversation, '');
    assert.equal(review.historyText, '', `intet om tidligere samtale (includeHistory: ${includeHistory})`);
  }
});

test('«Byg første udkast» i den samme AI-session lover ingen kopi og nævner kun det, AI-sessionen selv har (Q:A-7)', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input('Planlæg en side med violet-cykel', { mode: 'plan' }));
  await f.send(first, 'Planlæg en side med violet-cykel'); await f.finish(plan);
  const chat = f.bench.chat;
  assert.ok(chat.plan, 'planen er klar');
  // Som knappen «Byg første udkast» i ui/app.js: Byg med den valgte plan og tilvalget sat.
  const text = 'Byg første udkast efter den plan, jeg har gennemgået. Afslut med konkrete ting, jeg skal prøve i forhåndsvisningen.';
  const review = await f.bench.prepare(f.input(text, { mode: 'build', planID: chat.plan.id, includeHistory: true }));
  assert.equal(review.historyIncluded, false, 'der sendes ingen ekstra kopi');
  assert.equal(review.conversation, '');
  assert.equal(review.appContext.components.some(part => part.title === 'Tidligere samtale'), false, 'fragmentet «Tidligere samtale» sendes ikke');
  assert.doesNotMatch(review.historyText, /ekstra kopi|ingen tidligere beskeder|efter dit tilvalg/, 'linjen taler ikke om en kopi, der ikke sendes');
  assert.equal(review.historyText, FORTSAT, 'linjen siger, hvad den fortsatte AI-session har');
  await f.send(review, text);
  assert.equal(f.engines.length, 1, 'samme AI-session fortsætter');
  assert.equal(f.engines[0].sent[1].system.includes(COPY), false);
});

test('en ny AI-session efter modelskift siger det samme med og uden tilvalget og lover ikke værktøjsresultater (N:B1-4, N:B1-5)', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input('Lav en side med violet-cykel'));
  await f.send(first, 'Lav en side med violet-cykel'); await f.finish('Siden er lavet med en violet cykel.');
  f.setModel('model-b');
  const texts = [];
  for (const includeHistory of [false, true]) {
    const review = await f.bench.prepare(f.input('Gør cyklen grøn', { includeHistory }));
    assert.equal(review.historyIncluded, true, 'de seneste beskeder sendes med til den nye session');
    assert.match(review.conversation, /violet-cykel/);
    assert.doesNotMatch(review.historyText, /efter dit tilvalg/);
    assert.doesNotMatch(review.historyText, /kan AI’en bruge tidligere beskeder og værktøjsresultater/, 'en ny session har ikke de tidligere værktøjsresultater');
    texts.push(review.historyText);
  }
  assert.deepEqual(texts, [NY, NY], 'tilvalget ændrer ikke linjen');
});

test('i en fortsat AI-session, der startede med de seneste beskeder, siger linjen begge dele (N:B1-5)', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input('Lav en side med violet-cykel'));
  await f.send(first, 'Lav en side med violet-cykel'); await f.finish('Siden er lavet med en violet cykel.');
  f.setModel('model-b');
  const switched = await f.bench.prepare(f.input('Gør cyklen grøn'));
  await f.send(switched, 'Gør cyklen grøn'); await f.finish('Cyklen er grøn.');
  assert.match(f.engines[1].sent[0].system, new RegExp(COPY));
  const next = await f.bench.prepare(f.input('Og hjulene blå'));
  assert.equal(next.historyIncluded, true, 'den nye sessions kopi følger stadig med hver besked');
  assert.equal(next.historyText, `${FORTSAT} De seneste beskeder fra før denne AI-session følger også med som tekst.`);
  await f.send(next, 'Og hjulene blå');
  assert.equal(f.engines.length, 2, 'samme AI-session fortsætter');
  assert.match(f.engines[1].sent[1].system, new RegExp(COPY));
});
