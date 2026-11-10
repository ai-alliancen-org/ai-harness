// Q:B1-2: en samtale, hvis AI-session ikke kan fortsætte, må hverken glemme samtalen i stilhed eller afvises med en
// misvisende besked. Det sker, når samtalen har beskeder, men ingen gemt AI-session (efter indfletning, en ny kopi eller fra en
// ældre version), når OpenCode ikke kan finde den gemte session, og når samtalen får sin egen kopi, fordi en anden samtale
// arbejder i projektet. En ny AI-session får da de seneste beskeder som tekst, og «Før du sender» siger det. Mislykkes en
// forudsagt genoptagelse, sendes intet: afsendelsen stopper med en klar besked, den gemte session glemmes, og næste afsendelse
// starter en ny AI-session med de seneste beskeder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const ApprovalView = require('../ui/approval-view.js');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const COPY = 'Tidligere beskeder fra samme samtale';
const NY = 'AI-sessionen er ny, så de seneste beskeder fra samtalen medsendes som tekst. Tidligere værktøjsresultater følger ikke med.';

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-tabt-session-')));
  // lost: sessioner, OpenCode ikke længere kan finde. Motoren opretter så en ny session, som den rigtige motor gør (engine.cjs start).
  const engines = [], lost = new Set();
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    const found = Boolean(options.resume) && !lost.has(options.resume);
    const engine = { active: false, resumed: false, options, session: { id: found ? options.resume : 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; engine.resumed = found; }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Tabt session' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  const input = (text, extra = {}) => ({ connectionID: connection.id, modelID: 'test', mode: 'free', text, ...extra });
  const send = async (review, text, chat) => bench.send({ text, fingerprint: review.fingerprint, contextBinding: review.contextBinding, ...(chat ? { chat } : {}) });
  let answers = 0;
  const finish = async (reply, chat = bench.chat) => {
    const id = `svar-${++answers}`;
    chat.runRoles.set(id, 'assistant'); chat.runText.set(id, { id, messageID: id, text: reply });
    chat.event({ type: 'session.idle' }); await chat.finishing;
  };
  return { registry, bench, root, engines, lost, input, send, finish };
}

test('en samtale med beskeder, men uden gemt AI-session, får de seneste beskeder med i den nye session', async t => {
  const f = await fixture(t);
  // Som efter en indfletning eller en ny kopi (data.opencode = null) eller en samtale fra en ældre version.
  f.bench.chat.data = await f.bench.history.updateChat(f.bench.project.root, f.bench.chat.id, data => {
    data.lastRunMode = 'free'; data.mode = 'free'; data.opencode = null;
    data.messages = [{ id: 'a', role: 'user', text: 'Lav en side med violet-cykel' }, { id: 'b', role: 'assistant', text: 'Siden er lavet med en violet cykel.' }];
  });
  const review = await f.bench.prepare(f.input('Gør cyklen grøn'));
  assert.equal(review.historyIncluded, true, 'gennemgangen siger, at de seneste beskeder sendes med');
  assert.match(review.conversation, /violet-cykel/);
  assert.equal(review.historyText, NY);
  await f.send(review, 'Gør cyklen grøn');
  assert.match(f.engines[0].sent[0].system, new RegExp(COPY));
  assert.match(f.engines[0].sent[0].system, /violet-cykel/, 'AI’en glemmer ikke samtalen');
  assert.equal(f.bench.activityList().find(item => item.title === 'Ny AI-session')?.detail, 'Den tidligere samtale følger med som kontekst.');
});

test('kan OpenCode ikke finde den gemte AI-session, sendes intet, og næste afsendelse starter en ny med samtalen', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input('Lav en side med violet-cykel'));
  await f.send(first, 'Lav en side med violet-cykel'); await f.finish('Siden er lavet med en violet cykel.');
  const chat = f.bench.chat, gemt = chat.data.opencode?.session;
  assert.ok(gemt, 'AI-sessionen er gemt i samtalefilen');
  // Som efter en genstart af appen, hvor OpenCodes egne data om sessionen er væk.
  await chat.close(false); f.lost.add(gemt);
  const review = await f.bench.prepare(f.input('Gør cyklen grøn'));
  assert.equal(review.historyIncluded, false, 'gennemgangen forudsiger, at den gemte session fortsætter');
  const error = await f.send(review, 'Gør cyklen grøn').then(() => null, error => error);
  assert.ok(error, 'afsendelsen stopper i stedet for at fortsætte i en tom session');
  assert.equal(error.failure, 'session', 'resultatkortet får sin egen forklaring');
  assert.doesNotMatch(error.message, /kontekst har ændret sig/, 'beskeden er ikke den misvisende om appens kontekst');
  assert.match(error.message, /AI-session/);
  assert.equal(f.engines[1].sent.length, 0, 'intet er sendt til AI’en');
  assert.equal(chat.data.opencode ?? null, null, 'den gemte session er glemt');
  assert.equal((await f.bench.history.readChat(f.bench.project.root, chat.id)).opencode ?? null, null, 'også i samtalefilen');
  // Resultatkortet og Aktivitet siger det samme i almindeligt dansk (ui/approval-view.js failureText).
  assert.equal(ApprovalView.failureText('session').title, 'AI-sessionen kunne ikke fortsætte');
  assert.equal(ApprovalView.failureText('session').action, 'retry', 'Prøv igen er vejen videre');
  assert.equal(chat.activityList().filter(item => item.kind === 'error').at(-1)?.title, 'AI-sessionen kunne ikke fortsætte', 'Aktivitet siger, hvad der skete');
  // Prøv igen: gennemgangen siger nu, at AI-sessionen er ny, og de seneste beskeder følger med.
  const again = await f.bench.prepare(f.input('Gør cyklen grøn'));
  assert.equal(again.historyIncluded, true);
  assert.match(again.conversation, /violet-cykel/);
  assert.equal(again.historyText, NY);
  await f.send(again, 'Gør cyklen grøn');
  const engine = f.engines.at(-1);
  assert.equal(engine.options.resume, null, 'den tabte session forsøges ikke igen');
  assert.match(engine.sent[0].system, new RegExp(COPY));
  assert.match(engine.sent[0].system, /violet cykel/, 'AI’en får samtalen');
});

test('får samtalen sin egen kopi, fordi en anden samtale arbejder, får den nye AI-session samtalen med', async t => {
  const f = await fixture(t);
  // Samtale A arbejder i projektet.
  const a = f.bench.chat;
  const review = await f.bench.prepare(f.input('Byg en forside', { chat: a.id }));
  await f.send(review, 'Byg en forside', a.id);
  assert.equal(a.running, true);
  await f.bench.newChat(); const b = f.bench.chat;
  assert.notEqual(b, a);
  // Samtale B har beskeder og en gemt AI-session fra før, som den ville fortsætte i projektmappen.
  const pre = await f.bench.prepare(f.input('Forberedelse', { chat: b.id }));
  b.data = await f.bench.history.updateChat(f.bench.project.root, b.id, data => {
    data.lastRunMode = 'free'; data.mode = 'free'; data.opencode = { session: 'session-b', fingerprint: pre.sessionFingerprint };
    data.messages = [{ id: 'a', role: 'user', text: 'Lav en side med orange-sofa' }, { id: 'b', role: 'assistant', text: 'Siden har nu en orange sofa.' }];
  });
  const forB = await f.bench.prepare(f.input('Gør sofaen blå', { chat: b.id }));
  assert.equal(forB.historyIncluded, true, 'opgaven får sin egen kopi og en ny AI-session, så de seneste beskeder sendes med');
  assert.equal(forB.historyText, NY);
  await f.send(forB, 'Gør sofaen blå', b.id);
  assert.ok(b.copy, 'samtale B arbejder i sin egen kopi');
  const engine = f.engines.at(-1);
  assert.equal(engine.options.root, b.root);
  assert.match(engine.sent[0].system, new RegExp(COPY));
  assert.match(engine.sent[0].system, /orange-sofa/, 'AI’en glemmer ikke samtalen');
});

test('blev den forudsagte kopi alligevel ikke nødvendig, starter en ny AI-session med samtalen, som gennemgangen viste', async t => {
  const f = await fixture(t);
  const a = f.bench.chat;
  const review = await f.bench.prepare(f.input('Byg en forside', { chat: a.id }));
  await f.send(review, 'Byg en forside', a.id);
  await f.bench.newChat(); const b = f.bench.chat;
  const pre = await f.bench.prepare(f.input('Forberedelse', { chat: b.id }));
  b.data = await f.bench.history.updateChat(f.bench.project.root, b.id, data => {
    data.lastRunMode = 'free'; data.mode = 'free'; data.opencode = { session: 'session-b', fingerprint: pre.sessionFingerprint };
    data.messages = [{ id: 'a', role: 'user', text: 'Lav en side med orange-sofa' }, { id: 'b', role: 'assistant', text: 'Siden har nu en orange sofa.' }];
  });
  const forB = await f.bench.prepare(f.input('Gør sofaen blå', { chat: b.id }));
  assert.equal(forB.historyIncluded, true, 'gennemgangen viser en ny AI-session med de seneste beskeder');
  // Samtale A bliver færdig, før B sendes, så B får ingen kopi.
  await f.finish('Forsiden er bygget.', a);
  assert.equal(a.running, false);
  await f.send(forB, 'Gør sofaen blå', b.id);
  assert.equal(b.copy ?? null, null, 'samtale B arbejder i projektet');
  const engine = f.engines.at(-1);
  assert.equal(engine.options.resume, null, 'den gemte session genoptages ikke, for gennemgangen viste en ny');
  assert.match(engine.sent[0].system, new RegExp(COPY));
  assert.match(engine.sent[0].system, /orange-sofa/, 'det, der blev vist, er det, der sendes');
});
