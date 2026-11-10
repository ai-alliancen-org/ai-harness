// Q:D2-3: den udgåede komplai-AI-forbindelse («Log ud og fjern» under AI-forbindelser) kan fjernes, også uden net. Aura prøver
// først at tilbagekalde loginadgangen hos komplai. Kan komplai ikke nås, afviser komplai tilbagekaldelsen, eller kan adgangen ikke
// læses på denne computer, fjernes forbindelsen alligevel fra Aura, og svaret siger ærligt, at adgangen ikke er tilbagekaldt hos
// komplai. komplai Run (udgivelse) røres ikke. Lykkes tilbagekaldelsen, er der intet at sige ud over, at forbindelsen er fjernet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Store } = require('../core/store.cjs');
const { Workbench } = require('../core/workbench.cjs');

const key = 'kp_live_' + 'a'.repeat(43);
const old = { id: 'tidligere-ai', name: 'Min gamle AI-forbindelse', kind: 'komplai', baseURL: 'https://api.komplai.dk/v1/aura/v1', account: { organisationId: 'org-test', organisationName: 'Prøvekommune', authMethod: 'oauth' } };
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('krypteret:' + Buffer.from(value).toString('base64')), decryptString: value => Buffer.from(value.toString().slice(10), 'base64').toString() };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-komplai-uden-net-'));
  const bench = new Workbench({ directory, safeStorage, profiles: path.join(__dirname, '../../profiles'), emit() {} });
  t.after(async () => { await bench.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const store = new Store(directory, safeStorage);
  await store.update(state => {
    state.connections.push({ ...old, secret: store.encrypt(key) });
    state.connections.push({ id: 'anden-ai', name: 'Egen model', kind: 'ollama', baseURL: 'http://127.0.0.1:11434' });
    state.hosting = { komplai: { secret: store.encrypt('komp_publish_grant_' + 'b'.repeat(64)), grantId: 'run-id', organisationId: 'org-test', organisationName: 'Prøvekommune', address: 'komplai.run', expiresAt: '2099-01-01' } };
  });
  return { bench, store };
}
async function medFetch(fetcher, fn) { const original = globalThis.fetch; globalThis.fetch = fetcher; try { return await fn(); } finally { globalThis.fetch = original; } }
const ikkeTilbagekaldt = /fjernet fra denne computer.*ikke tilbagekaldt hos komplai/s;

test('uden net fjernes den udgåede forbindelse fra Aura, og svaret siger, at adgangen ikke er tilbagekaldt', async t => {
  const { bench, store } = await fixture(t);
  const runBefore = (await store.read()).hosting.komplai, calls = [];
  const result = await medFetch(async url => { calls.push(String(url)); throw new TypeError('fetch failed'); }, () => bench.removeConnection(old.id));
  assert.deepEqual(calls, ['https://api.komplai.dk/v1/aura/session'], 'Aura prøvede at tilbagekalde adgangen');
  const after = await store.read();
  assert.deepEqual(after.connections.map(c => c.id), ['anden-ai'], 'forbindelsen er fjernet');
  assert.deepEqual(after.hosting.komplai, runBefore, 'komplai Run bevares');
  assert.match(result.removalNotice || '', ikkeTilbagekaldt);
  assert.match(result.removalNotice, /fordi komplai ikke kunne nås/);
  assert.equal(result.retiredConnections.length, 0);
});

test('afviser komplai tilbagekaldelsen, eller kan adgangen ikke læses, fjernes forbindelsen også og siger det', async t => {
  {
    const { bench, store } = await fixture(t);
    const result = await medFetch(async () => Response.json({ error: 'server_error' }, { status: 500 }), () => bench.removeConnection(old.id));
    assert.deepEqual((await store.read()).connections.map(c => c.id), ['anden-ai']);
    assert.match(result.removalNotice || '', ikkeTilbagekaldt);
    assert.match(result.removalNotice, /fordi komplai afviste tilbagekaldelsen/);
  }
  {
    const { bench, store } = await fixture(t), calls = [];
    bench.store.decrypt = () => { throw new Error('Nøglen kan ikke læses.'); };
    const result = await medFetch(async url => { calls.push(url); return Response.json({ revoked: true }); }, () => bench.removeConnection(old.id));
    assert.deepEqual(calls, [], 'uden en læsbar adgang sendes intet');
    assert.deepEqual((await store.read()).connections.map(c => c.id), ['anden-ai']);
    assert.match(result.removalNotice || '', ikkeTilbagekaldt);
    assert.match(result.removalNotice, /fordi den ikke kunne læses på denne computer/);
  }
});

test('lykkes tilbagekaldelsen, siger svaret intet særligt', async t => {
  const { bench, store } = await fixture(t);
  const result = await medFetch(async () => Response.json({ revoked: true }), () => bench.removeConnection(old.id));
  assert.deepEqual((await store.read()).connections.map(c => c.id), ['anden-ai']);
  assert.equal(result.removalNotice, undefined);
});
