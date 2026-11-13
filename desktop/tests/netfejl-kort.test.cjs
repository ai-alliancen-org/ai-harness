// Fund 12: en netfejl, før modellen har svaret, sendes videre som 502, så OpenCode kan prøve igen (beslutning for beta 3).
// Giver OpenCode op, kommer fejlen tilbage som HTTP 502. Kortet skal så sige, at forbindelsen blev afbrudt, ikke at
// fejlen lå hos udbyderen, for det var gatewayen selv, der ikke kunne nå udbyderen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startGateway } = require('../core/gateway.cjs');
const { sessionFailure } = require('../core/chat-session.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

const freePort = () => new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const post = gateway => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'm', messages: [] }) });

test('gatewayen husker, at den selv sendte en netfejl videre, og glemmer det, når udbyderen svarer', async t => {
  // Én gateway og én udbyder hele vejen. Udbyderen lukker først forbindelsen og svarer derefter selv. En ny gateway starter
  // altid uden en husket netfejl, så kun den samme gateway kan vise, at den glemmer netfejlen igen.
  let svar = 'afbryd';
  const server = http.createServer(async (req, res) => {
    if (svar === 'afbryd') return req.socket.destroy();
    for await (const _ of req) { /* læst */ }
    if (svar === 502) { res.writeHead(502); return res.end('Bad Gateway'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'svar', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Hej' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const failures = [];
  const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'm' }, '', null, (message, failure) => failures.push(failure));
  t.after(() => gateway.close());
  const kald = async () => { const response = await post(gateway); await response.text(); return response.status; };
  assert.equal(await kald(), 502);
  assert.deepEqual(failures, [], 'forbindelsen låses ikke, så OpenCode kan prøve igen');
  assert.equal(gateway.forwardedFailure(), 'network');
  // Udbyderen svarer selv 502. Det er en fejl hos udbyderen og ikke en netfejl, så den tidligere netfejl glemmes.
  svar = 502;
  assert.equal(await kald(), 502);
  assert.equal(gateway.forwardedFailure(), null, 'udbyderens eget svar sletter den tidligere netfejl');
  assert.equal(sessionFailure({ data: { statusCode: 502 } }, { forwarded: gateway.forwardedFailure() }), 'server');
  // En ny netfejl huskes igen, og et almindeligt svar fra udbyderen glemmer den også.
  svar = 'afbryd';
  assert.equal(await kald(), 502);
  assert.equal(gateway.forwardedFailure(), 'network');
  svar = 200;
  assert.equal(await kald(), 200);
  assert.equal(gateway.forwardedFailure(), null, 'et almindeligt svar sletter den tidligere netfejl');
  assert.deepEqual(failures, [], 'ingen af kaldene låser forbindelsen');
});

test('en udbyder, der slet ikke kan nås, er også gatewayens egen netfejl', async t => {
  const failures = [];
  const down = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${await freePort()}/v1` }, { id: 'm' }, '', null, (message, failure) => failures.push(failure));
  t.after(() => down.close());
  const response = await post(down); await response.text();
  assert.equal(response.status, 502);
  assert.deepEqual(failures, [], 'forbindelsen låses ikke, så OpenCode kan prøve igen');
  assert.equal(down.forwardedFailure(), 'network');
});

test('OpenCodes endelige 502 efter gatewayens egen netfejl giver forbindelseskortet; ægte 5xx giver stadig serverkortet', () => {
  assert.equal(sessionFailure({ data: { statusCode: 502 } }, { forwarded: 'network' }), 'network');
  assert.equal(sessionFailure({ data: { statusCode: 502 } }), 'server');
  assert.equal(sessionFailure({ data: { statusCode: 503 } }, { forwarded: 'network' }), 'server', 'kun gatewayens egen 502 er en netfejl');
});

test('samtalen viser forbindelseskortet, når OpenCode giver op efter gatewayens netfejl', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-netfejl-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const events = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root, name: 'Netfejl' }); const chat = bench.chat;
  chat.running = true; chat.runMode = 'build';
  chat.gateway = { forwardedFailure: () => 'network', abort() {}, close: async () => {} };
  chat.event({ type: 'session.error', properties: { error: { name: 'APIError', data: { statusCode: 502, isRetryable: true, message: 'Modelforbindelsen blev afbrudt. Ingen reserveudbyder blev brugt.' } } } });
  assert.equal(chat.runFailure.kind, 'network');
  await chat.finishing?.catch(() => {});
  const review = events.find(event => event.type === 'run.review');
  assert.equal(review?.failure?.kind, 'network');
});
