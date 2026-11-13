// Fund 11: gatewayen afgør, hvornår et modelkald har ventet for længe (lokale modeller 10 min, andre 2 min), og giver den
// rigtige forklaring. OpenCodes egne grænser for svarhoved og bidder (standard 5 min) skal ligge over gatewayens, ellers
// afbryder motoren først, og en langsom lokal model ligner en afbrudt internetforbindelse.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const connections = require('../core/connections.cjs');
const { startGateway, idleLimitFor } = require('../core/gateway.cjs');

test('motorens grænser for svarhoved og bidder ligger over gatewayens egen grænse for alle forbindelser', () => {
  for (const connection of [{ kind: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434' }, { kind: 'compatible', name: 'Egen', baseURL: 'http://127.0.0.1:1/v1' }, { kind: 'anthropic', name: 'Claude' }, { kind: 'mistral', name: 'Mistral' }]) {
    const { options } = connections.engineProvider(connection, { id: 'model' }, 'http://127.0.0.1:2/v1', 'midlertidig');
    for (const key of ['headerTimeout', 'chunkTimeout']) {
      assert.equal(typeof options[key], 'number', `${connection.kind}: ${key}`);
      assert.ok(options[key] > idleLimitFor(connection), `${connection.kind}: ${key} skal ligge over gatewayens ${idleLimitFor(connection)} ms`);
      assert.ok(options[key] >= 300_000, `${connection.kind}: ${key} sænker ikke OpenCodes standard`);
    }
  }
});

test('opgiver motoren et kald, før modellen har sendt noget, er det en model, der ikke svarer, ikke en netfejl', async t => {
  // Modellen tager imod kaldet, men svarer aldrig.
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const failures = [];
  const gateway = await startGateway({ kind: 'ollama', baseURL: `http://127.0.0.1:${server.address().port}` }, { id: 'langsom' }, '', null, (message, failure) => failures.push({ message, ...failure }), { idleLimit: 60_000 });
  t.after(() => gateway.close());
  // Motoren (her fetch) holder op med at vente, før gatewayens egen grænse er nået.
  await fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'langsom', messages: [] }), signal: AbortSignal.timeout(300) }).catch(() => {});
  for (let round = 0; round < 100 && !failures.length; round++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'idle', 'kortet siger, at AI’en ikke svarede, ikke at internettet er afbrudt');
  assert.doesNotMatch(failures[0].message, /Kontrollér forbindelsen/);
});

test('Stop er stadig ikke en fejl: et kald, Aura selv afbryder, giver intet fejlkort', async t => {
  let arrived; const reached = new Promise(resolve => { arrived = resolve; });
  const server = http.createServer(() => arrived());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const failures = [];
  const gateway = await startGateway({ kind: 'ollama', baseURL: `http://127.0.0.1:${server.address().port}` }, { id: 'langsom' }, '', null, (message, failure) => failures.push(failure), { idleLimit: 60_000 });
  const request = fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'langsom', messages: [] }) }).catch(() => {});
  await reached;
  gateway.abort(); await request; await gateway.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(failures, []);
});
