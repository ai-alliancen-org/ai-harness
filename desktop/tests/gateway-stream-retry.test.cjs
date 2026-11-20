const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { startGateway } = require('../core/gateway.cjs');

async function fixture(t, respond) {
  let requests = 0;
  const server = http.createServer(async (req, res) => { for await (const _ of req) {} respond(res, ++requests); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const failures = [];
  const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'demo' }, '', null, (message, failure) => failures.push({ message, ...failure }));
  t.after(() => gateway.close());
  const send = () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'demo', stream: true }) });
  return { send, failures, requests: () => requests };
}

test('an engine closing a response it has consumed does not create a false network failure or lock the next model call', async t => {
  const f = await fixture(t, (res, n) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (n > 1) return res.end('data: [DONE]\n\n');
    res.write('data: {"choices":[{"delta":{"content":"Svar"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    // Modellen har afsluttet SSE-svaret, men HTTP-forbindelsen er stadig åben.
  });
  const response = await f.send(), reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /\[DONE\]/);
  await reader.cancel(); await delay(50);
  assert.deepEqual(f.failures, []);
  const again = await f.send(); assert.equal(again.status, 200); await again.text();
  assert.equal(f.requests(), 2);
});

test('a dropped upstream after HTTP headers but before response content is forwarded as retryable 502', async t => {
  const f = await fixture(t, (res, n) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
    if (n === 1) setTimeout(() => res.destroy(), 20);
    else res.end('data: [DONE]\n\n');
  });
  const response = await f.send(); assert.equal(response.status, 502); await response.text();
  assert.deepEqual(f.failures, []);
  const again = await f.send(); assert.equal(again.status, 200); await again.text();
  assert.equal(f.requests(), 2);
});
