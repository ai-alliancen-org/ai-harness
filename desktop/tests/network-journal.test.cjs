const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const network = require('../core/network-journal.cjs');
const { NetworkJournal } = network;

async function server(t, handle) {
  const requests = [];
  const app = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, url: req.url, bytes: Buffer.concat(chunks) });
    handle(req, res, requests.length);
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  return { url: `http://127.0.0.1:${app.address().port}`, requests };
}
async function consume(journal, response) {
  const chunks = [];
  try {
    for await (const chunk of response.body) { journal.observeResponseChunk(response, chunk); chunks.push(chunk); }
    journal.finishResponse(response, { outcome: 'completed' });
  } catch (error) { journal.finishResponse(response, { outcome: error.name === 'AbortError' ? 'cancelled' : 'failed', error }); throw error; }
  return Buffer.concat(chunks).toString();
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-network-journal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('observer preserves synchronous final dispatch, response identity and single body consumption', async () => {
  let dispatched = false, calls = 0, ticks = 10;
  const journal = new NetworkJournal({ clock: () => ticks });
  const original = new Response('answer');
  const options = { method: 'POST', body: 'body', redirect: 'error' };
  const pending = journal.observedFetch('https://api.mistral.ai/v1/chat/completions', options, { category: 'model', purpose: 'model-response', provider: 'mistral' }, (url, received) => {
    calls++; dispatched = true; assert.equal(received, options); assert.equal(original.bodyUsed, false); ticks = 30; return original;
  });
  assert.equal(dispatched, true, 'no await may separate the observer from actual dispatch');
  const response = await pending; assert.equal(response, original); assert.equal(response.bodyUsed, false);
  ticks = 50; assert.equal(await consume(journal, response), 'answer');
  assert.equal(calls, 1); assert.equal(journal.snapshot().records.length, 1);
  const record = journal.snapshot().records[0];
  assert.deepEqual([record.headersMs, record.firstBodyMs, record.totalMs, record.sentBytes, record.receivedBytes], [20, 40, 40, 4, 6]);
  journal.finishResponse(response, { outcome: 'failed', error: Error('private parser error') });
  assert.equal(journal.snapshot().records[0].status, 'completed', 'parsing after completion cannot rewrite the HTTP result');
});

test('metadata is allowlisted and strips credentials, URL paths, query, prompts and raw errors', async () => {
  const journal = new NetworkJournal();
  const secret = 'SYNTHETIC_PRIVATE_SECRET';
  const response = await journal.observedFetch(`https://user:${secret}@api.mistral.ai/private-${secret}?key=${secret}#${secret}`, { method: 'POST', body: secret, headers: { authorization: secret } },
    { category: 'model', purpose: secret, provider: secret, groupID: secret, extra: secret, model: secret }, () => new Response(secret));
  await consume(journal, response);
  await assert.rejects(journal.observedFetch('https://api.mistral.ai', {}, { category: secret }, () => { throw new TypeError(secret); }));
  const snapshot = journal.snapshot(); assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(snapshot.records[0].host, 'api.mistral.ai'); assert.equal(snapshot.records[0].purpose, null);
  assert.equal(snapshot.records[0].provider, null); assert.equal(snapshot.records[1].errorCategory, 'network');
  assert.equal(Object.hasOwn(snapshot, 'directory'), false);
});

test('unknown body, timing and unsupported categories remain null/unknown instead of zero', async () => {
  const journal = new NetworkJournal();
  const original = new Response('unconsumed');
  await journal.observedFetch('https://example.com', { body: new FormData(), method: 'POST' }, { category: 'catalog' }, () => original);
  const snapshot = journal.snapshot(), record = snapshot.records[0];
  assert.equal(record.sentBytes, null); assert.equal(record.receivedBytes, null); assert.equal(record.firstBodyMs, null); assert.equal(record.totalMs, null);
  assert.equal(record.status, 'headers'); assert.equal(original.bodyUsed, false);
  assert.equal(snapshot.coverage.find(item => item.category === 'git').status, 'unknown');
  assert.equal(snapshot.coverage.find(item => item.category === 'model').status, 'partial');
});

test('completed HTTP errors retain their fixed purpose and cannot become successful', async () => {
  const journal = new NetworkJournal();
  const response = await journal.observedFetch('https://api.example.com', {}, { category: 'model', purpose: 'model-response' }, () => new Response('synthetic provider error', { status: 429 }));
  await consume(journal, response);
  const record = journal.snapshot().records[0];
  assert.equal(record.purpose, 'model-response'); assert.equal(record.status, 'failed'); assert.equal(record.errorCategory, 'http'); assert.equal(record.httpStatus, 429);
  journal.finishResponse(response, { outcome: 'cancelled' }); assert.equal(journal.snapshot().records[0].status, 'failed');
});

test('real multipart request is sent once and observed chunks match server output', async t => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200); res.write('first-'); setTimeout(() => res.end('second'), 15); });
  const journal = new NetworkJournal(), body = new FormData(); body.set('file', new Blob(['private-upload']), 'private-file.txt');
  const response = await journal.observedFetch(fixture.url + '/private-file?token=private-token', { method: 'POST', body, redirect: 'error' }, { category: 'integration', purpose: 'integration' });
  assert.equal(await consume(journal, response), 'first-second'); assert.equal(fixture.requests.length, 1);
  const record = journal.snapshot().records[0]; assert.equal(record.host, '127.0.0.1'); assert.equal(record.locality, 'loopback');
  assert.equal(record.sentBytes, null); assert.equal(record.receivedBytes, 12); assert.ok(record.firstBodyMs >= record.headersMs);
  assert.doesNotMatch(JSON.stringify(journal.snapshot()), /private-upload|private-file|private-token/);
});

test('redirect policy is unchanged and the journal does not make a hidden retry', async t => {
  const fixture = await server(t, (_req, res) => res.writeHead(302, { location: '/hidden' }).end());
  const journal = new NetworkJournal();
  await assert.rejects(journal.observedFetch(fixture.url, { redirect: 'error' }, { category: 'catalog' }));
  assert.equal(fixture.requests.length, 1); assert.equal(journal.snapshot().records.length, 1); assert.equal(journal.snapshot().records[0].status, 'failed');
});

test('partial stream failure preserves already received bytes and is never retried', async t => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200); res.write('partial'); setTimeout(() => res.destroy(), 30); });
  const journal = new NetworkJournal(); const response = await journal.observedFetch(fixture.url, { redirect: 'error' }, { category: 'model' });
  await assert.rejects(consume(journal, response));
  assert.equal(fixture.requests.length, 1); const record = journal.snapshot().records[0];
  assert.equal(record.status, 'failed'); assert.equal(record.receivedBytes, 7); assert.ok(record.firstBodyMs !== null);
});

test('Stop aborts a running request once; observer does not replace the abort error', async t => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200); res.write('started'); });
  const journal = new NetworkJournal(), controller = new AbortController();
  const response = await journal.observedFetch(fixture.url, { signal: controller.signal, redirect: 'error' }, { category: 'model' });
  const reader = response.body.getReader(), first = await reader.read(); journal.observeResponseChunk(response, first.value); controller.abort();
  let failure; try { await reader.read(); } catch (error) { failure = error; }
  assert.equal(failure.name, 'AbortError'); journal.finishResponse(response, { outcome: 'cancelled', error: failure });
  assert.equal(fixture.requests.length, 1); assert.equal(journal.snapshot().records[0].status, 'cancelled'); assert.equal(journal.snapshot().records[0].errorCategory, 'aborted');
});

test('timeout before response headers is a failure rather than user cancellation', async t => {
  const fixture = await server(t, () => {});
  const journal = new NetworkJournal();
  await assert.rejects(journal.observedFetch(fixture.url, { signal: AbortSignal.timeout(100), redirect: 'error' }, { category: 'model' }), { name: 'TimeoutError' });
  assert.equal(fixture.requests.length, 1);
  const record = journal.snapshot().records[0];
  assert.equal(record.status, 'failed'); assert.equal(record.errorCategory, 'timeout'); assert.equal(record.headersMs, null);
});

test('timeout during response body remains a failure when the consumer reports cancellation', async t => {
  const fixture = await server(t, (_req, res) => { res.writeHead(200); res.write('started'); });
  const journal = new NetworkJournal(), controller = new AbortController();
  const response = await journal.observedFetch(fixture.url, { signal: controller.signal, redirect: 'error' }, { category: 'model' });
  const reader = response.body.getReader(), first = await reader.read(); journal.observeResponseChunk(response, first.value);
  controller.abort(new DOMException('Synthetic deadline reached', 'TimeoutError'));
  let failure; try { await reader.read(); } catch (error) { failure = error; }
  assert.ok(['TimeoutError', 'AbortError'].includes(failure?.name));
  journal.finishResponse(response, { outcome: 'cancelled', error: failure });
  assert.equal(fixture.requests.length, 1);
  const record = journal.snapshot().records[0];
  assert.equal(record.status, 'failed'); assert.equal(record.errorCategory, 'timeout'); assert.equal(record.receivedBytes, 7);
});

test('bounded private persistence reloads metadata and marks unfinished previous calls interrupted', async t => {
  const root = await directory(t), journal = new NetworkJournal({ limit: 2, now: () => Date.parse('2026-10-25T12:00:00Z') });
  await journal.configure({ directory: path.join(root, 'journal') });
  for (let i = 0; i < 3; i++) await journal.observedFetch('https://example.com/private', {}, { category: 'catalog' }, () => new Response('not read'));
  await journal.flush(); const first = journal.snapshot(); assert.equal(first.records.length, 2); assert.equal(first.dropped, 1);
  const file = path.join(root, 'journal', 'requests.json'), stored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.records.length, 2); assert.doesNotMatch(JSON.stringify(stored), /private|not read/);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o077, 0);
  const next = new NetworkJournal({ limit: 2, now: () => Date.parse('2026-10-26T12:00:00Z') }); await next.configure({ directory: path.join(root, 'journal') }); await next.flush();
  assert.ok(next.snapshot().records.every(record => record.status === 'interrupted')); assert.equal(next.snapshot().dropped, 1);
  assert.equal(next.snapshot().startedAt, '2026-10-26T12:00:00.000Z', 'app-run filter must not include the previous run');
  assert.equal(next.snapshot().recordingStartedAt, '2026-10-25T12:00:00.000Z');
  assert.equal(next.snapshot().records.filter(record => record.startedAt >= next.snapshot().startedAt).length, 0);
});

test('unsafe or unreadable persistence never blocks a model call or exposes paths', async t => {
  const root = await directory(t), target = path.join(root, 'target'), linked = path.join(root, 'linked');
  await fs.mkdir(target, { mode: 0o700 }); await fs.symlink(target, linked);
  const journal = new NetworkJournal(); await journal.configure({ directory: linked });
  assert.equal(journal.snapshot().persistence.status, 'unavailable');
  let calls = 0; const response = await journal.observedFetch('https://example.com', {}, {}, () => { calls++; return new Response('ok'); });
  assert.equal(await consume(journal, response), 'ok'); assert.equal(calls, 1); assert.equal(JSON.stringify(journal.snapshot()).includes(root), false);
  assert.deepEqual(await fs.readdir(target), []);
});

test('corrupt prior journal is preserved without exposing its contents', async t => {
  const root = await directory(t), journalDir = path.join(root, 'journal'); await fs.mkdir(journalDir, { mode: 0o700 });
  const file = path.join(journalDir, 'requests.json'), contents = 'private raw corrupt content'; await fs.writeFile(file, contents, { mode: 0o600 });
  const journal = new NetworkJournal(); await journal.configure({ directory: journalDir }); await journal.flush();
  assert.equal(await fs.readFile(file, 'utf8'), contents); assert.doesNotMatch(JSON.stringify(journal.snapshot()), /private raw/);
});

test('loaded journal records discard untrusted extra fields and invalid metadata', async t => {
  const root = await directory(t), journalDir = path.join(root, 'journal'); await fs.mkdir(journalDir, { mode: 0o700 });
  const file = path.join(journalDir, 'requests.json'), secret = 'SYNTHETIC_PRIVATE_SECRET';
  const saved = { schemaVersion: 1, prompt: secret, records: [{ id: '11111111-2222-3333-4444-555555555555', startedAt: '2026-10-25T12:00:00.000Z', status: 'completed',
    category: 'catalog', purpose: secret, provider: secret, host: `example.com/${secret}`, locality: 'remote', method: secret,
    headers: { authorization: secret }, error: secret, prompt: secret, receivedBytes: secret, totalMs: -1 }] };
  await fs.writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  const journal = new NetworkJournal(); await journal.configure({ directory: journalDir }); await journal.flush();
  const snapshot = journal.snapshot(); assert.equal(snapshot.records.length, 1); assert.equal(snapshot.persistence.status, 'ready');
  for (const key of ['purpose', 'provider', 'host', 'method', 'receivedBytes', 'totalMs']) assert.equal(snapshot.records[0][key], null);
  assert.equal(JSON.stringify(snapshot).includes(secret), false); assert.equal((await fs.readFile(file, 'utf8')).includes(secret), false);
});

test('catalog metadata distinguishes models and routes without retaining route paths', async t => {
  const connections = require('../core/connections.cjs'), before = new Set(network.snapshot().records.map(record => record.id));
  const fixture = await server(t, (req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.url.endsWith('/models') ? { data: [{ id: 'test-model' }] } : { data: { endpoints: [] } })));
  const connection = { kind: 'openrouter', baseURL: fixture.url };
  await connections.listModels(connection, 'synthetic-secret'); await connections.routes(connection, 'synthetic-secret', 'private/model-id');
  const records = network.snapshot().records.filter(record => !before.has(record.id));
  assert.deepEqual(records.map(record => record.purpose), ['model-catalog', 'route-catalog']); assert.equal(fixture.requests.length, 2);
  assert.ok(records.every(record => record.status === 'completed')); assert.doesNotMatch(JSON.stringify(records), /private|model-id|synthetic-secret/);
});
