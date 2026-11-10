// K4: Ctrl+C i aura login og /model skal også stoppe selve netkaldet, ikke kun ventetiden. listModels, routes og
// arbejdsbænkens models og routes tager et valgfrit signal ({ signal }), som sendes til requestJSON sammen med
// tidsgrænsen på 15 sekunder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const connections = require('../core/connections.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

// En server, der tager imod kaldet og aldrig svarer. Den melder, når klienten har lukket forbindelsen.
async function silent(t) {
  const state = { requests: 0, closed: 0 };
  const server = http.createServer((req, res) => { state.requests++; res.on('close', () => { state.closed++; }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, state };
}
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10)); return check(); };

test('listModels stopper selve kaldet, når signalet afbrydes, og siger, at kontrollen blev afbrudt', async t => {
  const server = await silent(t), controller = new AbortController();
  const started = Date.now();
  const pending = connections.listModels({ kind: 'compatible', name: 'Tavs', baseURL: server.url + '/v1' }, 'sk-' + 'a'.repeat(30), { signal: controller.signal }).catch(error => error);
  assert.ok(await until(() => server.state.requests === 1), 'kaldet er sendt');
  controller.abort();
  const error = await pending;
  assert.ok(Date.now() - started < 3000, `kaldet sluttede efter ${Date.now() - started} ms, ikke efter tidsgrænsen på 15 s`);
  assert.equal(error.reason, 'cancelled');
  assert.ok(await until(() => server.state.closed === 1), 'forbindelsen til serveren er lukket');
});

test('routes stopper også selve kaldet, når signalet afbrydes', async t => {
  const server = await silent(t), controller = new AbortController();
  const pending = connections.routes({ kind: 'openrouter', name: 'OpenRouter', baseURL: server.url + '/api/v1' }, 'sk-or-' + 'a'.repeat(30), 'leverandoer/model', { signal: controller.signal }).catch(error => error);
  assert.ok(await until(() => server.state.requests === 1));
  controller.abort();
  const started = Date.now(), error = await pending;
  assert.ok(Date.now() - started < 3000);
  assert.equal(error.reason, 'cancelled');
});

test('arbejdsbænkens models sender signalet videre, så /model kan afbrydes', async t => {
  const server = await silent(t), controller = new AbortController();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-katalog-signal-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit() {}, safeStorage });
  const id = (await bench.saveConnection({ kind: 'compatible', name: 'Tavs', baseURL: server.url + '/v1' })).connections[0].id;
  const pending = bench.models(id, { signal: controller.signal }).catch(error => error);
  assert.ok(await until(() => server.state.requests === 1));
  controller.abort();
  const started = Date.now(), error = await pending;
  assert.ok(Date.now() - started < 3000);
  assert.equal(error.reason, 'cancelled');
});

test('uden signal gælder tidsgrænsen som før, og et signal med egen tidsgrænse er stadig en tidsgrænse', async t => {
  const server = await silent(t);
  const error = await connections.requestJSON(server.url + '/v1/models', { key: 'sk-' + 'a'.repeat(30), kind: 'openai', signal: AbortSignal.timeout(200) }).catch(error => error);
  assert.equal(error.reason, 'timeout');
});

// N:B1-2: CLI'en giver altid et signal med (Ctrl+C), som normalt aldrig afbrydes. Erstatter signalet tidsgrænsen, hænger
// aura login mod en tavs server, til brugeren trykker Ctrl+C. Prøven venter ikke 15 sekunder: den tidsgrænse, requestJSON
// beder om, afkortes, og prøven kontrollerer, at det er de 15 sekunder, der bedes om.
test('tidsgrænsen på 15 sekunder gælder også, når kalderen giver et signal, der aldrig afbrydes', async t => {
  const server = await silent(t), controller = new AbortController(), original = AbortSignal.timeout, asked = [];
  t.mock.method(AbortSignal, 'timeout', ms => { asked.push(ms); return original.call(AbortSignal, ms === 15000 ? 150 : ms); });
  const outcome = await Promise.race([
    connections.listModels({ kind: 'compatible', name: 'Tavs', baseURL: server.url + '/v1' }, 'sk-' + 'a'.repeat(30), { signal: controller.signal }).then(() => 'svar', error => error),
    new Promise(resolve => setTimeout(() => resolve('hænger'), 3000))
  ]);
  assert.notEqual(outcome, 'hænger', 'kaldet stoppede ikke ved tidsgrænsen; kalderens signal erstattede den');
  assert.equal(outcome.reason, 'timeout');
  assert.match(outcome.message, /15 sekunder/);
  assert.ok(asked.includes(15000), `tidsgrænsen er 15 sekunder (bedt om: ${asked.join(', ')})`);
  assert.ok(await until(() => server.state.closed === 1), 'forbindelsen til serveren er lukket');
});

test('arbejdsbænkens routes sender signalet videre, så modelvalget kan afbrydes ved OpenRouters udbydere', async t => {
  const server = await silent(t), controller = new AbortController();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-katalog-signal-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit() {}, safeStorage });
  // OpenRouter har en fast adresse. Prøven peger den gemte forbindelse på den tavse server, så intet kald forlader computeren.
  const id = await bench.storeConnection({ kind: 'openrouter', name: 'OpenRouter', apiKey: 'sk-or-' + 'a'.repeat(30) });
  await bench.store.update(state => { state.connections.find(c => c.id === id).baseURL = server.url + '/api/v1'; });
  const pending = bench.routes(id, 'leverandoer/model', { signal: controller.signal }).catch(error => error);
  assert.ok(await until(() => server.state.requests === 1), 'kaldet er sendt');
  controller.abort();
  const started = Date.now(), error = await pending;
  assert.ok(Date.now() - started < 3000, 'kaldet stoppede ved afbrydelsen, ikke ved tidsgrænsen');
  assert.equal(error.reason, 'cancelled');
  assert.ok(await until(() => server.state.closed === 1), 'forbindelsen til serveren er lukket');
});
