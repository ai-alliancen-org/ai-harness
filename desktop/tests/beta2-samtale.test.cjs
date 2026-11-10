// Fund 51: en samtale fra 0.7.0-beta.2 har et gemt aftryk af AI-sessionen, der er regnet med beta.2's formel (med
// commandIsolation og autoCommandsSnapshot). Beta 3 regner aftrykket uden dem, så det gemte aftryk passer aldrig. Første
// besked efter opdateringen starter derfor en ny AI-session, og de seneste beskeder følger med som kontekst. Prøven låser,
// at historikken faktisk kommer med, og at gennemgangen siger det.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const { engineIdentityOf } = require('../core/chat-session.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

test('beta.2-formlen for motorens identitet giver aldrig samme aftryk som beta 3', () => {
  const disclosure = { connection: 'Lokal prøve', model: 'test', endpoint: 'http://127.0.0.1:1/v1', protocol: 'openai', recipients: 'Egen server · 127.0.0.1', region: 'Lokal' };
  const extras = { connectionRevision: 'r1', rules: 'regler', skills: [], features: {}, projectInstructions: null, surface: 'desktop', autoCheckpoint: true };
  const beta3 = engineIdentityOf(disclosure, extras);
  for (const [commandIsolation, autoCommandsSnapshot] of [[false, false], [true, true], [false, true]]) assert.notEqual(engineIdentityOf(disclosure, { ...extras, commandIsolation, autoCommandsSnapshot }), beta3);
});

test('en samtale fra beta.2 får sine seneste beskeder med i den nye AI-session efter opdateringen', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-beta2-samtale-')));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'ny-session' }, sent: [], start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Fra beta.2' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  // Samtalefilen, som beta.2 efterlod den: beskeder og en gemt AI-session med beta.2's aftryk.
  bench.chat.data = await bench.history.updateChat(bench.project.root, bench.chat.id, data => {
    data.lastRunMode = 'free'; data.mode = 'free';
    data.messages = [{ id: 'a', role: 'user', text: 'Lav en oversigt over mødelokaler med orange-sofa' }, { id: 'b', role: 'assistant', text: 'Oversigten er lavet med tre lokaler.' }];
    data.opencode = { session: 'ses-beta2', fingerprint: 'aftryk-fra-beta2' };
  });
  const review = await bench.prepare({ connectionID: connection.id, modelID: 'test', mode: 'free', text: 'Tilføj et fjerde lokale' });
  assert.equal(review.historyIncluded, true, 'gennemgangen siger, at de seneste beskeder sendes med');
  assert.match(review.conversation, /orange-sofa/);
  await bench.send({ text: 'Tilføj et fjerde lokale', fingerprint: review.fingerprint, contextBinding: review.contextBinding });
  assert.equal(engines[0].options.resume, null, 'beta.2-sessionen genoptages ikke');
  assert.match(engines[0].sent[0].system, /Tidligere beskeder fra samme samtale/);
  assert.match(engines[0].sent[0].system, /orange-sofa/);
  assert.match(engines[0].sent[0].system, /tre lokaler/);
  const entry = bench.activityList().find(item => item.title === 'Ny AI-session');
  assert.equal(entry?.detail, 'Den tidligere samtale følger med som kontekst.');
  bench.chat.event({ type: 'session.idle' }); await bench.chat.finishing;
  // Næste besked fortsætter den nye session uden at sende kopien som en ny tekst.
  const next = await bench.prepare({ connectionID: connection.id, modelID: 'test', mode: 'free', text: 'Og et femte' });
  await bench.send({ text: 'Og et femte', fingerprint: next.fingerprint, contextBinding: next.contextBinding });
  assert.equal(engines.length, 1, 'samme motor og session fortsætter');
});
