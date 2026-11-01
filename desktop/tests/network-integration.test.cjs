const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const network = require('../core/network-journal.cjs');
const { startGateway } = require('../core/gateway.cjs');
const { listModels } = require('../core/connections.cjs');

async function fixture(t, handle) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ body, url: req.url, authorization: req.headers.authorization });
    handle(req, res, requests);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const ids = new Set(network.snapshot().records.map(row => row.id));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, records: () => network.snapshot().records.filter(row => !ids.has(row.id)) };
}
async function gatewayFor(t, server, options) {
  const gateway = await startGateway({ kind: 'compatible', baseURL: server.url }, { id: 'fixture-model' }, 'fixture-secret-key', null, () => {}, options);
  t.after(() => gateway.close());
  return { gateway, send: () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'fixture-model', stream: true, messages: [{ role: 'user', content: 'fixture-private-prompt' }] }) }) };
}

test('gateway observes waiting, headers and body while forwarding exactly one original stream', async t => {
  let headers, body;
  const server = await fixture(t, (_req, res) => {
    headers = () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); };
    body = () => res.end('data: {"choices":[{"delta":{"content":"fixture-private-answer"}}]}\n\ndata: [DONE]\n\n');
  });
  const { send } = await gatewayFor(t, server);
  const response = send();
  for (let i = 0; !headers && i < 100; i++) await delay(5);
  assert.ok(headers); assert.equal(server.records()[0].status, 'attempted'); assert.equal(server.records()[0].headersMs, null);
  headers();
  for (let i = 0; server.records()[0].status !== 'headers' && i < 100; i++) await delay(5);
  assert.equal(server.records()[0].status, 'headers'); assert.equal(server.records()[0].firstBodyMs, null);
  body(); const text = await (await response).text();
  assert.match(text, /fixture-private-answer/);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].authorization, 'Bearer fixture-secret-key');
  assert.match(server.requests[0].body, /fixture-private-prompt/);
  const row = server.records()[0]; assert.equal(row.status, 'completed'); assert.ok(row.headersMs <= row.firstBodyMs); assert.ok(row.firstBodyMs <= row.totalMs);
  assert.equal(row.receivedBytes, Buffer.byteLength(text)); assert.equal(row.sentBytes, Buffer.byteLength(server.requests[0].body));
  assert.doesNotMatch(JSON.stringify(network.snapshot()), /fixture-private|fixture-secret-key|fixture-model|chat\/completions/);
});

test('gateway error, partial stream, Stop and timeout keep existing transport behavior', async t => {
  for (const scenario of ['http', 'stream', 'stop', 'timeout', 'timeout-headers']) {
    await t.test(scenario, async t => {
      const server = await fixture(t, (_req, res) => {
        if (scenario === 'http') return res.writeHead(429).end('fixture-provider-error');
        if (scenario === 'timeout-headers') return;
        res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"partial":true}\n\n');
        if (scenario === 'stream') setTimeout(() => res.destroy(), 10);
      });
      const { gateway, send } = await gatewayFor(t, server, { idleLimit: scenario.startsWith('timeout') ? 50 : 1000 });
      const response = await send();
      if (scenario === 'timeout-headers') { assert.equal(response.status, 502); await response.text(); }
      else if (scenario === 'http') { assert.equal(response.status, 429); await response.text(); }
      else { if (scenario === 'stop') gateway.abort(); await assert.rejects(response.text()); }
      for (let i = 0; ['headers','receiving'].includes(server.records()[0].status) && i < 100; i++) await delay(5);
      const row = server.records()[0];
      assert.equal(row.status, scenario === 'stop' ? 'cancelled' : 'failed');
      if (scenario.startsWith('timeout')) assert.equal(row.errorCategory, 'timeout');
      assert.equal(server.requests.length, 1, 'observation must never retry');
      assert.equal((await send()).status, 409, 'the original gateway failure/Stop latch remains unchanged');
      assert.equal(server.requests.length, 1);
    });
  }
});

test('catalog failures are terminal without logging returned content or following redirects', async t => {
  for (const scenario of ['http', 'json', 'redirect']) {
    const server = await fixture(t, (_req, res) => {
      if (scenario === 'redirect') return res.writeHead(302, { location: '/must-not-follow' }).end();
      res.writeHead(scenario === 'http' ? 401 : 200).end('fixture-private-body');
    });
    await assert.rejects(listModels({ kind: 'compatible', baseURL: server.url }, 'fixture-secret-key'));
    const row = server.records()[0]; assert.equal(row.status, 'failed'); assert.equal(server.requests.length, 1);
    assert.doesNotMatch(JSON.stringify(row), /fixture-private|fixture-secret|must-not-follow/);
  }
});
