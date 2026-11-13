const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Store } = require('../core/store.cjs');
const { Workbench } = require('../core/workbench.cjs');
const connections = require('../core/connections.cjs');
const { startGateway } = require('../core/gateway.cjs');

const key = 'kp_live_' + 'a'.repeat(43);
const old = { id: 'tidligere-ai', name: 'Min gamle AI-forbindelse', kind: 'komplai', baseURL: 'https://api.komplai.dk/v1/aura/v1', account: { organisationId: 'org-test', organisationName: 'Prøvekommune', authMethod: 'token' } };
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('krypteret:' + Buffer.from(value).toString('base64')), decryptString: value => Buffer.from(value.toString().slice(10), 'base64').toString() };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-tidligere-komplai-'));
  const bench = new Workbench({ directory, safeStorage, profiles: path.join(__dirname, '../../profiles'), emit() {} });
  t.after(async () => { await bench.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const store = new Store(directory, safeStorage);
  await store.update(state => {
    state.connections.push({ ...old, secret: store.encrypt(key), account: { ...old.account, privateMetadata: 'må-ikke-vises' } });
    state.connections.push({ id: 'anden-ai', name: 'Egen model', kind: 'ollama', baseURL: 'http://127.0.0.1:11434' });
    state.hosting = { komplai: { secret: store.encrypt('komp_publish_grant_' + 'b'.repeat(64)), grantId: 'run-id', organisationId: 'org-test', organisationName: 'Prøvekommune', address: 'komplai.run', expiresAt: '2099-01-01' } };
  });
  return { bench, store };
}

test('Tidligere Komplai AI: alle inferensindgange afvises før netkald', async t => {
  const { bench } = await fixture(t), original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); throw Error('Der må ikke sendes noget.'); };
  try {
    assert.equal(connections.definitions.komplai, undefined);
    assert.throws(() => connections.normalize({ ...old, apiKey: key }), /kun.*udgivelse|anden AI-forbindelse/);
    assert.throws(() => connections.disclosure(old, { id: 'tidligere-model' }), /kun.*udgivelse|anden AI-forbindelse/);
    assert.throws(() => connections.engineProvider(old, { id: 'tidligere-model' }, 'http://127.0.0.1', 'syntetisk'), /kun.*udgivelse|anden AI-forbindelse/);
    await assert.rejects(connections.listModels(old, key), /kun.*udgivelse|anden AI-forbindelse/);
    await assert.rejects(connections.routes(old, key, 'tidligere-model'), /kun.*udgivelse|anden AI-forbindelse/);
    await assert.rejects(startGateway(old, { id: 'tidligere-model' }, key, null), /kun.*udgivelse|anden AI-forbindelse/);
    await assert.rejects(bench.models(old.id), /kun.*udgivelse|anden AI-forbindelse/);
    await assert.rejects(bench.routes(old.id, 'tidligere-model'), /kun.*udgivelse|anden AI-forbindelse/);
    assert.deepEqual(calls, [], 'Hverken modelkatalog, inference eller kontooplysninger må hentes.');
  } finally { globalThis.fetch = original; }
});

test('Tidligere Komplai AI: gemt forbindelse bliver inaktiv og viser ingen nøgle eller kontometadata', async t => {
  const { bench, store } = await fixture(t), before = await store.read();
  const state = await bench.state();
  assert.deepEqual(state.connections.map(c => c.id), ['anden-ai']);
  assert.equal(state.retiredConnections.length, 1); assert.equal(state.retiredConnections[0].id, old.id);
  assert.equal(state.retiredConnections[0].name, old.name);
  assert.equal(state.retiredConnections[0].secret, undefined); assert.deepEqual(state.retiredConnections[0].account, { authMethod: 'token' });
  assert.doesNotMatch(JSON.stringify(state), /kp_live_|komp_publish_grant_|må-ikke-vises/);
  assert.deepEqual(await store.read(), before, 'Visning skal bevare de gamle oplysninger på disken til brugerens oprydning.');
});

test('Tidligere Komplai AI: forberedt afsendelse afvises før historik, dekryptering og genbrug af en aktiv motor', async t => {
  const { bench, store } = await fixture(t), project = path.join(store.root, 'projekt');
  await fs.mkdir(project); await bench.activate({ root: project, name: 'Tidligere samtale' });
  const chat = bench.chat, saved = await store.read(), data = structuredClone(chat.data), effects = [];
  const stop = name => () => { effects.push(name); throw Error('Uventet sideeffekt: ' + name); };
  bench.store.decrypt = stop('dekryptering'); bench.engineFactory = stop('ny motor'); bench.chatsChanged = stop('ændret samtale');
  chat.saveHistory = stop('historik');
  for (const cached of [false, true]) {
    chat.prepared = { root: project, connection: old, model: { id: 'tidligere-model' }, mode: 'chat', context: {}, disclosure: { fingerprint: 'tidligere-godkendelse' } };
    chat.engineIdentity = cached ? 'tidligere-godkendelse' : null;
    chat.engine = cached ? { active: true, send: stop('eksisterende motor'), close: stop('lukning af motor') } : null;
    await assert.rejects(chat.send({ text: 'Fortsæt den tidligere samtale.', fingerprint: 'tidligere-godkendelse' }), /kun.*udgivelse|anden AI-forbindelse/);
    assert.equal(chat.running, false); assert.equal(chat.sending, false); assert.equal(chat.runUser, null); assert.equal(chat.generation, 0);
    assert.deepEqual(chat.data, data); assert.deepEqual(await store.read(), saved);
  }
  chat.engine = null;
  assert.deepEqual(effects, []);
});

test('Tidligere Komplai AI: fjernelse af eget token er lokal, browseradgang tilbagekaldes, og Run bevares', async t => {
  const { bench, store } = await fixture(t), original = globalThis.fetch; const calls = [];
  const runBefore = (await store.read()).hosting.komplai;
  globalThis.fetch = async (url, options) => { calls.push({ url, method: options.method }); return Response.json({ revoked: true }); };
  try {
    await bench.removeConnection(old.id); assert.deepEqual(calls, []);
    await store.update(state => state.connections.push({ ...old, id: 'browser', secret: store.encrypt(key), account: {} }));
    await bench.removeConnection('browser');
    assert.deepEqual(calls, [{ url: 'https://api.komplai.dk/v1/aura/session', method: 'DELETE' }]);
    const after = await store.read(); assert.deepEqual(after.hosting.komplai, runBefore);
    assert.deepEqual(after.connections.map(c => c.id), ['anden-ai']);
  } finally { globalThis.fetch = original; }
});

// Q:D2-3: den udgåede forbindelse skal kunne fjernes uden net. Den fjernes fra Aura, svaret siger ærligt, at adgangen ikke er
// tilbagekaldt hos komplai, og Run bevares (flere tilfælde i tests/komplai-ai-fjern-uden-net.test.cjs).
test('Tidligere Komplai AI: fejlet tilbagekaldelse fjerner forbindelsen fra Aura, siger det og bevarer Run', async t => {
  const { bench, store } = await fixture(t), original = globalThis.fetch;
  await store.update(state => { state.connections[0].account.authMethod = 'browser'; });
  const runBefore = (await store.read()).hosting.komplai;
  globalThis.fetch = async () => { throw Error('offline'); };
  try {
    const result = await bench.removeConnection(old.id);
    const after = await store.read();
    assert.deepEqual(after.connections.map(c => c.id), ['anden-ai']); assert.deepEqual(after.hosting.komplai, runBefore);
    assert.match(result.removalNotice, /ikke tilbagekaldt hos komplai/);
  } finally { globalThis.fetch = original; }
});

test('Historisk forbrug i DKK bevares og blandes ikke med USD efter genåbning', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-historisk-pris-'));
  const bench = new Workbench({ directory: path.join(root, 'state'), profiles: path.join(__dirname, '../../profiles'), emit() {}, safeStorage: {} });
  t.after(async () => { await bench.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = path.join(root, 'project'); await fs.mkdir(project); await bench.activate({ root: project, name: 'Prøve' });
  const chat = bench.chat; chat.usageBase = { ...chat.usageBase, calls: 1, cost: 0.02 };
  chat.runPrice = { currency: 'DKK', input: 2, output: 5, cacheRead: 0.5, cacheWrite: 2 };
  chat.runSteps.set('1', { input: 60, output: 40, reasoning: 10, cache: { read: 40 } });
  const first = chat.currentUsage(); assert.equal(first.cost, 0.02); assert.equal(first.otherCosts.DKK, 0.00039);
  assert.deepEqual(chat.currentUsage(), first, 'Visning må ikke tælle samme kald flere gange.');
  chat.runUser = { id: 'u', role: 'user', text: 'Prøve' }; chat.running = true; await chat.saveHistory('idle'); chat.running = false;
  await bench.activate({ root: project, name: 'Prøve' });
  assert.equal(bench.chat.currentUsage().cost, 0.02); assert.equal(bench.chat.currentUsage().otherCosts.DKK, 0.00039);
});
