// Spor M3, årsag 5a og 5b: udbyderens egen fejltekst bag Se detaljer (renset og afkortet), og en egen fejl, når den samlede tidsgrænse rammer midt i strømmen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startGateway } = require('../core/gateway.cjs');
const { failureMessage } = require('../core/chat-session.cjs');
const { failureText } = require('../ui/approval-view.js');

const KEY = 'sk-abc123DEF456ghi789';
async function opstil(t, handler, { key = '', options = {} } = {}) {
  const server = http.createServer(async (req, res) => { for await (const _ of req) { } handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [];
  const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'test' }, key, null, (message, failure) => events.push({ message, failure }), options);
  t.after(async () => { await gateway.close(); server.closeAllConnections(); server.close(); });
  const send = () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'test' }) });
  return { send, events };
}

test('5a: en endelig fejl (402) bringer udbyderens egen tekst med som detalje, renset for nøgler, mens første lag er uændret', async t => {
  const { send, events } = await opstil(t, (req, res) => { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `Insufficient credits for ${KEY}.\nAdd funds.` } })); });
  const svar = await send(); await svar.text();
  assert.equal(events.length, 1);
  const { message, failure } = events[0];
  assert.equal(failure.kind, 'quota', 'typen afhænger ikke af udbyderens tekst');
  assert.match(failure.detail, /Insufficient credits/);
  assert.match(failure.detail, /Add funds/);
  assert.ok(!failure.detail.includes(KEY) && !failure.detail.includes('abc123'), 'nøglen skal være maskeret');
  assert.ok(!message.includes('Insufficient'), 'første lags tekst er Auras egen danske forklaring');
});

test('5a: den rigtige nøgle fjernes fra udbyderens tekst, også når den ikke ligner et kendt mønster', async t => {
  const hemmelig = 'abcdefghijkl-mnopqrst';
  const { send, events } = await opstil(t, (req, res) => { res.writeHead(401); res.end(`Incorrect API key provided: ${hemmelig}`); }, { key: hemmelig });
  await (await send()).text();
  assert.match(events[0].failure.detail, /Incorrect API key provided/);
  assert.ok(!events[0].failure.detail.includes(hemmelig));
});

test('5a: en meget lang udbydertekst afskæres, og kun en begrænset del læses', async t => {
  const { send, events } = await opstil(t, (req, res) => { res.writeHead(404); res.end('x'.repeat(200_000)); });
  await (await send()).text();
  assert.ok(events[0].failure.detail.length <= 500);
});

test('5a: en videresendt 503 bringer udbyderens tekst (renset) med i kroppen, og Aura låser ikke forbindelsen', async t => {
  const { send, events } = await opstil(t, (req, res) => { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `Overloaded, key ${KEY}` } })); });
  const svar = await send(); const krop = await svar.json();
  assert.equal(svar.status, 503);
  assert.match(krop.error.message, /HTTP 503/);
  assert.match(krop.error.message, /Overloaded/);
  assert.ok(!krop.error.message.includes('abc123'));
  assert.equal(events.length, 0);
});

test('5a: chat-sessionen lægger udbyderens tekst efter Auras egen i Se detaljer', () => {
  const tekst = failureMessage({ message: 'Modelserveren afviste kaldet (HTTP 402).', failure: { kind: 'quota', detail: 'Insufficient credits' } }, {});
  assert.match(tekst, /^Modelserveren afviste kaldet \(HTTP 402\)\./);
  assert.match(tekst, /Udbyderens egen tekst: Insufficient credits$/);
  assert.equal(failureMessage({ message: 'Kun egen tekst' }, {}), 'Kun egen tekst');
});

test('5b: rammer den samlede tidsgrænse midt i strømmen, får brugeren en egen fejl og ikke netværksvejledningen', async t => {
  const { send, events } = await opstil(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const puls = setInterval(() => res.write('data: {}\n\n'), 20); res.on('close', () => clearInterval(puls));
  }, { options: { totalLimit: 300, idleLimit: 5000 } });
  const svar = await send();
  await svar.text().catch(() => {});
  for (let i = 0; i < 100 && !events.length; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(events.length, 1);
  assert.equal(events[0].failure.kind, 'total');
  assert.ok(!/Kontrollér forbindelsen/.test(events[0].message), events[0].message);
  assert.match(events[0].message, /Din besked er bevaret/);
});

test('5b: fejltypen total har sin egen danske forklaring i brugerfladen, ikke modelteksten', () => {
  const info = failureText('total');
  assert.notEqual(info, failureText('model'));
  assert.match(info.title, /lang tid/);
});
