// verify-multi-project: skiftes nøglen eller forbindelsen, mens en opgave starter motoren, stopper afsendelsen, før noget
// sendes til modellen. Beskeden skal sige, at det er forbindelsen, der er ændret, ikke projektets kontekst.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

test('en forbindelse, der ændres under motorens opstart, stopper afsendelsen med en besked om forbindelsen', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-noegleskift-')));
  let release, entered; const starting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: () => {
    const engine = { active: false, session: { id: 'session-' + engines.length }, sent: [], start: async () => { entered(); await gate; engine.active = true; }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Nøgleskift' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Før', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  const review = await bench.prepare({ connectionID: connection.id, modelID: 'test', mode: 'free', text: 'Byg siden' });
  const sending = bench.send({ text: 'Byg siden', fingerprint: review.fingerprint, contextBinding: review.contextBinding });
  const outcome = assert.rejects(sending, error => {
    assert.match(error.message, /Forbindelsen blev ændret, mens opgaven startede/);
    assert.doesNotMatch(error.message, /Projektets kontekst/);
    return true;
  });
  await starting;
  // Som et nøgleskift i nøglevinduet: forbindelsen gemmes igen med en ny revision, mens motoren starter.
  await bench.saveConnection({ id: connection.id, kind: 'compatible', name: 'Efter', baseURL: connection.baseURL });
  release();
  await outcome;
  assert.equal(engines[0].sent.length, 0, 'intet blev sendt til modellen');
});
