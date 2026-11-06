const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { normalize, listModels, engineProvider, disclosure } = require('../core/connections.cjs');
const { startGateway } = require('../core/gateway.cjs');

test('OpenAI fastholder sin adresse, og Azure kræver en ressourceadresse og et deployment-navn', () => {
  assert.equal(normalize({ kind: 'openai', name: 'Min OpenAI', baseURL: 'https://andre.invalid' }).baseURL, 'https://api.openai.com/v1');
  for (const host of ['min.openai.azure.com', 'min.services.ai.azure.com']) for (const suffix of ['', '/', '/openai/v1', '/openai/v1/']) {
    const c = normalize({ kind: 'azure', name: 'Azure', baseURL: `https://${host}${suffix}`, deployment: 'min-kodemodel' });
    assert.equal(c.baseURL, `https://${host}/openai/v1`); assert.equal(c.protocol, 'responses');
    assert.equal(engineProvider(c, { id: c.deployment }, 'http://127.0.0.1:1/v1', 'midlertidig').npm, '@ai-sdk/openai');
    assert.notEqual(disclosure(c, { id: c.deployment }).fingerprint, disclosure({ ...c, protocol: 'openai' }, { id: c.deployment }).fingerprint);
  }
  for (const baseURL of ['http://min.openai.azure.com', 'https://min.openai.azure.com.evil.test', 'https://min.openai.azure.com?key=skjult', 'https://user:pass@min.openai.azure.com', 'https://min.openai.azure.com:8443']) {
    assert.throws(() => normalize({ kind: 'azure', name: 'Azure', baseURL, deployment: 'model' }));
  }
  assert.throws(() => normalize({ kind: 'azure', name: 'Azure', baseURL: 'https://min.openai.azure.com' }), /Deployment|deployment/);
  assert.throws(() => normalize({ kind: 'azure', name: 'Azure', baseURL: 'https://min.openai.azure.com', deployment: 'model', protocol: 'ukendt' }), /Format|Responses/);
  assert.equal(engineProvider({ kind: 'azure', protocol: 'openai' }, { id: 'model' }, 'http://127.0.0.1:1/v1', 't').npm, '@ai-sdk/openai-compatible');
});

for (const kind of ['openai', 'azure']) test(`${kind}: katalog, nøgle, Responses-strøm, historik og afvist adgang`, async t => {
  let failure = false; const received = [], errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers[kind === 'azure' ? 'api-key' : 'authorization'], kind === 'azure' ? 'syntetisk-noegle' : 'Bearer syntetisk-noegle');
      assert.equal(req.headers[kind === 'azure' ? 'authorization' : 'api-key'], undefined);
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-4.1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-audio' }, { id: 'codex-mini-latest' }] }));
      assert.equal(req.url, '/v1/responses'); let raw = ''; for await (const c of req) raw += c; received.push(JSON.parse(raw));
      if (failure) { res.writeHead(401); return res.end('syntetisk-noegle'); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"type":"response.output_text.delta","delta":"Hej"}\n\n');
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const connection = { kind, name: kind, baseURL: `http://127.0.0.1:${server.address().port}/v1`, deployment: 'min-kodemodel' };
  const models = await listModels(connection, 'syntetisk-noegle');
  assert.deepEqual(models.map(m => m.id), kind === 'azure' ? ['min-kodemodel'] : ['gpt-4.1', 'codex-mini-latest']);
  if (kind === 'azure') { assert.equal(models[0].configuredDeployment, true); assert.equal(models[0].capabilities.tools, null); }
  const failures = []; const gateway = await startGateway(connection, models[0], 'syntetisk-noegle', null, (...args) => failures.push(args));
  t.after(() => gateway.close());
  const input = [{ role: 'user', content: 'Ret min side' }, { type: 'function_call_output', call_id: 't', output: 'fil skrevet' }];
  const send = () => fetch(gateway.url + '/responses', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: models[0].id, input, stream: true, store: true, previous_response_id: 'gammel', conversation: 'anden', background: true }) });
  const response = await send(); assert.match(await response.text(), /output_text.delta/);
  assert.equal(received[0].store, false); assert.equal(received[0].previous_response_id, undefined); assert.equal(received[0].conversation, undefined); assert.equal(received[0].background, undefined); assert.deepEqual(received[0].input, input);
  failure = true; const denied = await send(); assert.equal(denied.status, 401); assert.doesNotMatch(await denied.text(), /syntetisk-noegle/);
  assert.equal(failures[0][1].kind, 'key'); assert.equal((await send()).status, 409); assert.equal(received.length, 2); assert.deepEqual(errors, []);
});

test('Responses kan hverken skifte model eller falde tilbage til Chat Completions', async t => {
  for (const request of [{ route: '/responses', model: 'anden-model' }, { route: '/chat/completions', model: 'gpt-test' }]) {
    const gateway = await startGateway({ kind: 'openai', baseURL: 'http://127.0.0.1:1/v1' }, { id: 'gpt-test' }, 'syntetisk', null);
    try {
      const res = await fetch(gateway.url + request.route, { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: request.model }) });
      // En lokal afvisning før udbyderen: 400 med dansk tekst, ingen reserveudbyder og ingen netfejl-vejledning.
      assert.equal(res.status, 400); assert.match(await res.text(), /Modelskift kræver|ikke understøtter/);
    } finally { await gateway.close(); }
  }
});
