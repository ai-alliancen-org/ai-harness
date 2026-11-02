// Forbigående udbyderfejl (408, 429 og 5xx) videresendes til OpenCode, som genforsøger (docs/decisions.md). Aura låser
// ikke forbindelsen og kalder ikke fejlen, så en næste forsøg kan lykkes. 401, 402, 403 og 404 er endelige og låser som før.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startGateway } = require('../core/gateway.cjs');

async function prøv(status, headers, andet) {
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { }
    if (andet.kald++ === 0) { res.writeHead(status, headers); return res.end('{"error":"midlertidig"}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {}\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [];
  const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'test' }, '', null, text => events.push(text));
  const send = () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'test' }) });
  try { return { send, events, gateway, server }; }
  catch (error) { await gateway.close(); server.closeAllConnections(); server.close(); throw error; }
}

for (const [status, headers] of [[408, {}], [429, { 'retry-after': '1' }], [503, {}], [500, {}]]) {
  test(`${status} videresendes uden at låse forbindelsen, og næste forsøg lykkes`, async t => {
    const kald = { kald: 0 };
    const { send, events, gateway, server } = await prøv(status, headers, kald);
    t.after(async () => { await gateway.close(); server.closeAllConnections(); server.close(); });
    const første = await send();
    assert.equal(første.status, status, 'status skal videresendes');
    if (headers['retry-after']) assert.equal(første.headers.get('retry-after'), headers['retry-after'], 'Retry-After skal videresendes');
    await første.text();
    assert.equal(events.length, 0, 'fejlen må ikke kaldes som en fejl i Aura');
    const andet = await send();
    assert.equal(andet.status, 200, 'næste forsøg skal kunne lykkes, ikke give 409');
    await andet.text();
  });
}

for (const [status, art] of [[402, 'quota'], [403, 'access'], [404, 'notfound'], [401, 'key']]) {
  test(`${status} er endelig og låser forbindelsen som før (${art})`, async t => {
    const server = http.createServer(async (req, res) => { for await (const _ of req) { } res.writeHead(status); res.end('{}'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const events = [];
    const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'test' }, '', null, text => events.push(text));
    t.after(async () => { await gateway.close(); server.closeAllConnections(); server.close(); });
    const send = () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'test' }) });
    const første = await send(); await første.text();
    assert.equal(første.status, status);
    assert.equal(events.length, 1, 'endelige fejl kaldes én gang');
    assert.equal((await send()).status, 409, 'forbindelsen er låst');
  });
}
