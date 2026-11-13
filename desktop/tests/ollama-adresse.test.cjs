// Ollama-adressen (fund 42 og test-introduction): forbindelsen gemmes som serverens rod uden /v1, som opdagelsen,
// opsætningens opslag, modelkataloget (/api/tags) og gatewayen (/v1/chat/completions) forventer. En forbindelse, der er
// gemt med /v1 i 0.7.0-beta.2, skal stadig virke efter opdateringen, så adressen læses om til roden.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const connections = require('../core/connections.cjs');
const { startGateway } = require('../core/gateway.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

// En lokal server med Ollamas egne ruter. Alt andet svarer 404 som hos Ollama (/v1/api/tags og /v1/v1/... findes ikke).
async function ollama(t) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* Kroppen læses færdig. */ }
    seen.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] })); }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ id: 'svar', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Hej' }, finish_reason: 'stop' }] })); }
    res.writeHead(404); res.end('404 page not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { root: `http://127.0.0.1:${server.address().port}`, seen };
}
async function bench(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-ollama-adresse-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new Workbench({ directory: path.join(directory, 'data'), profiles, emit() {}, safeStorage });
}

test('en ny Ollama-forbindelse gemmes som serverens rod, også når adressen er skrevet med /v1 eller uden http', () => {
  for (const [input, expected] of [
    ['http://127.0.0.1:11434', 'http://127.0.0.1:11434'], ['127.0.0.1:11434', 'http://127.0.0.1:11434'], ['localhost:11434/', 'http://localhost:11434'],
    ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434'], ['http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434'], ['localhost:11434/v1', 'http://localhost:11434'],
    ['https://ollama.example.dk/proxy', 'https://ollama.example.dk/proxy'], ['https://ollama.example.dk/proxy/v1', 'https://ollama.example.dk/proxy']
  ]) assert.equal(connections.normalize({ kind: 'ollama', name: 'Ollama', baseURL: input }).baseURL, expected, input);
});

test('modelkataloget hentes fra /api/tags, både for roden og for en adresse, der er gemt med /v1 i beta.2', async t => {
  const server = await ollama(t);
  for (const baseURL of [server.root, server.root + '/v1']) {
    const models = await connections.listModels({ kind: 'ollama', name: 'Ollama', baseURL }, '');
    assert.deepEqual(models.map(model => model.id), ['qwen3:8b'], baseURL);
  }
  assert.deepEqual(server.seen, ['GET /api/tags', 'GET /api/tags']);
});

test('gatewayen sender chatten til /v1/chat/completions, både for roden og for en adresse, der er gemt med /v1', async t => {
  const server = await ollama(t);
  for (const baseURL of [server.root, server.root + '/v1']) {
    const failures = [];
    const gateway = await startGateway({ kind: 'ollama', baseURL }, { id: 'qwen3:8b' }, '', null, (message, failure) => failures.push(failure));
    t.after(() => gateway.close());
    const response = await fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'qwen3:8b', messages: [] }) });
    await response.text();
    assert.equal(response.status, 200, baseURL);
    assert.deepEqual(failures, [], baseURL);
  }
  assert.deepEqual(server.seen, ['POST /v1/chat/completions', 'POST /v1/chat/completions']);
});

test('«Brug Ollama» finder den gemte forbindelse på opdagelsens adresse, og modellerne kan hentes', async t => {
  const server = await ollama(t), workbench = await bench(t);
  // Som ui/app.js: gem med opdagelsens rodadresse, og find forbindelsen igen på samme adresse.
  const state = await workbench.saveConnection({ kind: 'ollama', name: 'Ollama på denne computer', baseURL: server.root });
  const saved = state.connections.find(c => c.kind === 'ollama' && c.baseURL === server.root);
  assert.ok(saved, 'forbindelsen står med den adresse, opsætningen leder efter');
  assert.deepEqual((await workbench.models(saved.id)).map(model => model.id), ['qwen3:8b']);
  assert.deepEqual(server.seen, ['GET /api/tags']);
});

test('en afvisning fra serveren har sin HTTP-status, så et råd om nøglen kun gives, når nøglen faktisk blev afvist', async t => {
  const server = http.createServer((req, res) => { res.writeHead(req.url.startsWith('/noegle') ? 401 : 404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const missing = await connections.requestJSON(base + '/v1/api/tags', { kind: 'ollama' }).catch(error => error);
  assert.equal(missing.status, 404); assert.equal(missing.reason, 'rejected');
  const refused = await connections.requestJSON(base + '/noegle/models', { key: 'sk-' + 'a'.repeat(30), kind: 'compatible' }).catch(error => error);
  assert.equal(refused.status, 401);
});

test('en Ollama-forbindelse gemt med /v1 i beta.2 læses som roden, virker og beholder sin nøgle ved en ny gemning', async t => {
  const server = await ollama(t), workbench = await bench(t);
  await workbench.store.update(state => { state.connections.push({ id: 'fra-beta2', kind: 'ollama', name: 'Ollama fra beta.2', baseURL: server.root + '/v1', revision: 'r1', secret: workbench.store.encrypt('lokal-proxy-noegle') }); });
  const listed = (await workbench.state()).connections.find(c => c.id === 'fra-beta2');
  assert.equal(listed.baseURL, server.root, 'opsætningen finder forbindelsen på rodadressen og gemmer ingen dublet');
  assert.equal((await workbench.connection('fra-beta2')).baseURL, server.root);
  assert.deepEqual((await workbench.models('fra-beta2')).map(model => model.id), ['qwen3:8b']);
  // Et nyt navn ændrer ikke adressen. Nøglen bevares, selv om den gemte form havde /v1.
  const renamed = await workbench.saveConnection({ id: 'fra-beta2', kind: 'ollama', name: 'Ollama, nyt navn', baseURL: server.root });
  const after = renamed.connections.find(c => c.id === 'fra-beta2');
  assert.equal(after.hasKey, true);
  assert.equal(after.baseURL, server.root);
});
