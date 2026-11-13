const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startGateway, idleLimitFor } = require('../core/gateway.cjs');

async function opsaet(t, connection, model = { id: 'm' }, route = null) {
  const kald = [];
  const server = http.createServer(async (req, res) => { for await (const _ of req) { } kald.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [];
  const gateway = await startGateway({ baseURL: `http://127.0.0.1:${server.address().port}/v1`, ...connection }, model, '', route, (message, failure) => events.push({ message, failure }));
  t.after(async () => { await gateway.close(); server.closeAllConnections(); server.close(); });
  const send = (body, url = '/chat/completions') => fetch(gateway.url + url, { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body });
  return { send, events, kald };
}
const gyldig = JSON.stringify({ model: 'm' });

for (const [navn, udfør] of [
  ['ukendt sti', s => s.send(gyldig, '/embeddings')],
  ['ugyldig JSON', s => s.send('{ikke json')],
  ['krop over 4 MB', s => s.send(JSON.stringify({ model: 'm', x: 'a'.repeat(4_100_000) }))],
  ['modelskift', s => s.send(JSON.stringify({ model: 'anden' }))]
]) {
  test(`fund 12a: lokal fejl (${navn}) får egen dansk tekst og låser ikke forbindelsen`, async t => {
    const s = await opsaet(t, { kind: 'compatible' });
    const svar = await udfør(s); const tekst = await svar.text();
    assert.equal(svar.status, 400);
    assert.doesNotMatch(tekst, /afbrudt/i, 'ikke netfejl-teksten');
    assert.match(JSON.parse(tekst).error.message, /[a-zæøå]/i);
    assert.equal(JSON.parse(tekst).error.type, 'invalid_request_error');
    assert.equal(s.events.length, 0, 'forbindelsen må ikke låses som netfejl');
    const næste = await s.send(gyldig); await næste.text();
    assert.equal(næste.status, 200, 'næste gyldige kald virker');
    assert.equal(s.kald.length, 1, 'den lokale fejl nåede aldrig udbyderen');
  });
}
test('fund 12a: manglende OpenRouter-udbyder er en lokal fejl med egen tekst', async t => {
  const s = await opsaet(t, { kind: 'openrouter' }, { id: 'm' }, null);
  const svar = await s.send(gyldig); const tekst = await svar.text();
  assert.equal(svar.status, 400); assert.match(tekst, /OpenRouter/); assert.doesNotMatch(tekst, /afbrudt/i);
  assert.equal(s.events.length, 0); assert.equal(s.kald.length, 0);
});
test('fund 12b: lokale og kompatible forbindelser får længere tid til første byte, skyudbydere uændret', () => {
  assert.equal(idleLimitFor({ kind: 'anthropic' }), 120_000);
  assert.equal(idleLimitFor({ kind: 'openrouter' }), 120_000);
  assert.equal(idleLimitFor({ kind: 'mistral' }), 120_000);
  assert.ok(idleLimitFor({ kind: 'ollama' }) >= 600_000);
  assert.ok(idleLimitFor({ kind: 'compatible' }) >= 600_000);
  assert.ok(idleLimitFor({ kind: 'ollama' }) < 20 * 60_000, 'under det samlede loft');
});
