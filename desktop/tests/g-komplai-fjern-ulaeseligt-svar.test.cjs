// Skeptikerens fund efter G1 og G2: svarer komplai, men kan svaret ikke læses (fx en HTML-side fra en proxy eller et svar uden JSON),
// sagde beskeden «fordi komplai ikke kunne nås», selv om komplai svarede. Beskeden skal sige, hvad der skete. Kun et netkald, der
// slet ikke kommer igennem, er «ikke kunne nås». Ingen prøve kalder komplai; fetch er erstattet.
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


test('svarer komplai med noget, der ikke kan læses, siger beskeden det og ikke, at komplai ikke kunne nås', async t => {
  for (const svar of [() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }), () => new Response('ok', { status: 200 })]) {
    const { bench, store } = await fixture(t);
    const result = await medFetch(async () => svar(), () => bench.removeConnection(old.id));
    assert.deepEqual((await store.read()).connections.map(c => c.id), ['anden-ai'], 'forbindelsen er fjernet');
    assert.match(result.removalNotice || '', ikkeTilbagekaldt);
    assert.doesNotMatch(result.removalNotice, /ikke kunne nås/);
    assert.match(result.removalNotice, /fordi svaret fra komplai ikke kunne læses/);
  }
});

test('kommer netkaldet slet ikke igennem, siger beskeden stadig, at komplai ikke kunne nås', async t => {
  const { bench } = await fixture(t);
  const result = await medFetch(async () => { throw new TypeError('fetch failed'); }, () => bench.removeConnection(old.id));
  assert.match(result.removalNotice, /fordi komplai ikke kunne nås/);
});
