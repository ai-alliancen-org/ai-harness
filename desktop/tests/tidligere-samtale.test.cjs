// test-resume: «Før du sender» må aldrig sige, at en kopi af tidligere samtale sendes, når den ikke sendes. Fortsætter samme
// AI-session, har AI'en allerede samtalen, og tilvalget af en ekstra kopi tilføjer intet (README: en igangværende
// modelsession beholder sin egen kontekst). I en ny AI-session sendes kopien, og så siger gennemgangen det. Siden Q:B1-2 får en
// ny AI-session altid de seneste beskeder, når samtalen har nogen, også uden tilvalget (tests/tabt-ai-session.test.cjs), og
// linjen i historyText nævner kun tidligere samtale, når den følger med (N:B1-4, tests/tidligere-samtale-linje.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const COPY = 'Tidligere beskeder fra samme samtale';

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-tidligere-samtale-')));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    // Motoren genoptager den gemte session, når appen beder om det, som OpenCode gør.
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Tidligere samtale' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  const input = (text, extra = {}) => ({ connectionID: connection.id, modelID: 'test', mode: 'free', text, ...extra });
  const send = async (review, text) => bench.send({ text, fingerprint: review.fingerprint, contextBinding: review.contextBinding });
  const finish = async () => { bench.chat.event({ type: 'session.idle' }); await bench.chat.finishing; };
  return { bench, engines, input, send, finish };
}

test('i en fortsat AI-session lover gennemgangen ingen ekstra kopi, og der sendes ingen', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input('Byg en side med violet-cykel'));
  await f.send(first, 'Byg en side med violet-cykel'); await f.finish();
  const review = await f.bench.prepare(f.input('Vurder næste skridt', { includeHistory: true }));
  assert.equal(review.historyIncluded, false, 'gennemgangen siger ikke, at en kopi sendes');
  assert.equal(review.conversation, '', 'rækken «Tidligere samtale, der sendes» er tom');
  assert.equal(review.historyRequested, true);
  assert.equal(review.historyText, 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater.', 'linjen siger, hvad den fortsatte session har, og intet om en kopi');
  await f.send(review, 'Vurder næste skridt');
  assert.equal(f.engines.length, 1, 'samme AI-session fortsætter');
  assert.equal(f.engines[0].sent[1].system.includes(COPY), false);
  await f.finish();
});

test('efter en genstart med skift af arbejdsmåde fortsætter den gemte session, og gennemgangen lover ingen kopi', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input('Planlæg en side med violet-cykel', { mode: 'plan' }));
  await f.send(first, 'Planlæg en side med violet-cykel'); await f.finish();
  // Som efter en genstart af appen: motoren er lukket, og AI-sessionen er gemt i samtalefilen.
  await f.bench.chat.close(false);
  const review = await f.bench.prepare(f.input('Byg planen'));
  assert.equal(review.historyIncluded, false, 'den genoptagne session har samtalen; der sendes ingen kopi');
  assert.equal(review.conversation, '');
  assert.equal(review.historyRequested, false);
  await f.send(review, 'Byg planen');
  assert.equal(f.engines.at(-1).resumed, true, 'den gemte AI-session genoptages');
  assert.equal(f.engines.at(-1).sent[0].system.includes(COPY), false);
  await f.finish();
});

test('i en ny AI-session sendes kopien med og uden tilvalget, og gennemgangen siger det', async t => {
  const f = await fixture(t);
  // En samtale med beskeder, men uden gemt AI-session (fx fra en ældre version).
  f.bench.chat.data = await f.bench.history.updateChat(f.bench.project.root, f.bench.chat.id, data => {
    data.lastRunMode = 'free'; data.mode = 'free'; data.opencode = null;
    data.messages = [{ id: 'a', role: 'user', text: 'Lav en side med violet-cykel' }, { id: 'b', role: 'assistant', text: 'Siden er lavet.' }];
  });
  // AI'en må ikke glemme samtalen, fordi tilvalget ikke er sat (Q:B1-2).
  const plain = await f.bench.prepare(f.input('Fortsæt'));
  assert.equal(plain.historyIncluded, true);
  assert.match(plain.conversation, /violet-cykel/);
  const review = await f.bench.prepare(f.input('Fortsæt', { includeHistory: true }));
  assert.equal(review.historyRequested, true);
  assert.equal(review.historyIncluded, true);
  assert.match(review.conversation, /violet-cykel/);
  assert.equal(review.historyText, plain.historyText, 'tilvalget ændrer ikke linjen');
  assert.doesNotMatch(review.historyText, /efter dit tilvalg/);
  await f.send(review, 'Fortsæt');
  assert.match(f.engines[0].sent[0].system, new RegExp(COPY));
  assert.match(f.engines[0].sent[0].system, /violet-cykel/);
  await f.finish();
});
