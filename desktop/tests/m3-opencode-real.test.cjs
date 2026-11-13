// Spor M3, årsag 5d: målt mod den rigtige OpenCode (den låste version) gennem Auras egen gateway og en lokal falsk model.
// Spørgsmålene: genforsøger OpenCode 408, 429 og 5xx, og rammer Auras 409-lås et genforsøg ved en fejl? Prøven starter den rigtige
// motor og kræver derfor den forberedte runtime (npm run runtime:prepare); uden den springes den over. Intet forlader maskinen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeEngine, findExecutable, VERSION } = require('../core/engine.cjs');
const { startGateway } = require('../core/gateway.cjs');
const connections = require('../core/connections.cjs');

const binary = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'opencode', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
const real = { skip: process.platform === 'win32' || !require('node:fs').existsSync(binary) ? 'den forberedte OpenCode-runtime findes ikke' : false, timeout: 120_000 };

// Falsk model: hvert kald til hovedsamtalen (med værktøjer) får næste svar fra planen; ellers et almindeligt svar.
async function falskModel(plan) {
  const kald = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), hoved = Array.isArray(body.tools) && body.tools.length > 0;
    if (!hoved) { kald.push({ hoved, status: 200 }); res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end(svar('Prøve')); }
    const trin = plan[Math.min(kald.filter(k => k.hoved).length, plan.length - 1)];
    kald.push({ hoved, status: trin.status });
    if (trin.status !== 200) { res.writeHead(trin.status, { 'content-type': 'application/json', ...(trin.retryAfter ? { 'retry-after': trin.retryAfter } : {}) }); return res.end(JSON.stringify({ error: { message: trin.tekst || `falsk ${trin.status}` } })); }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(svar('Færdig med prøven.'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, kald, port: server.address().port, hovedkald: () => kald.filter(k => k.hoved).map(k => k.status) };
}
function svar(tekst) {
  const ramme = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'falsk', choices: [{ index: 0, delta: { role: 'assistant', content: tekst }, finish_reason: null }] };
  return 'data: ' + JSON.stringify(ramme) + '\n\n' + 'data: ' + JSON.stringify({ ...ramme, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n';
}

async function kør(t, plan, { grænse = 100_000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m3-real-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const model = await falskModel(plan); t.after(() => { model.server.closeAllConnections(); model.server.close(); });
  const forbindelse = { id: 'f', name: 'Lokal', kind: 'compatible', baseURL: `http://127.0.0.1:${model.port}/v1` }, valgt = { id: 'falsk', name: 'falsk' };
  const fejl = [];
  const gateway = await startGateway(forbindelse, valgt, '', null, (message, failure) => fejl.push({ message, failure }));
  t.after(() => gateway.close());
  const root = path.join(dir, 'projekt'); await fs.mkdir(root);
  const hændelser = []; let afslut; const færdig = new Promise(resolve => { afslut = resolve; });
  const engine = new OpenCodeEngine({ root: await fs.realpath(root), directory: path.join(dir, 'motor'), provider: connections.engineProvider(forbindelse, valgt, gateway.url, gateway.token), model: valgt, mode: 'chat', onEvent: event => {
    hændelser.push(event);
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) afslut(event.type);
  } });
  t.after(() => engine.close());
  await engine.start();
  const start = Date.now();
  await engine.send('Sig hej.', 'Prøve.');
  let vagt; const slutning = await Promise.race([færdig, new Promise(resolve => { vagt = setTimeout(() => resolve('hang'), grænse); })]); clearTimeout(vagt);
  return { slutning, fejl, model, hændelser, sekunder: (Date.now() - start) / 1000, engine };
}

// Skeptikerens fund: en 429 med Retry-After over loftet gav altid kvotekortet («Kontoen hos udbyderen er brugt op»), også ved
// en almindelig hastighedsgrænse. Med den rigtige OpenCode: gatewayen melder fejlen med det samme, og typen følger udbyderens
// tekst. I Aura stopper den melding opgaven (ChatSession: engine.error), så prøven venter ikke på OpenCodes egen afslutning.
for (const [tekst, type] of [['Rate limit reached for requests per minute', 'limit'], ['You exceeded your current quota, please check your plan and billing details.', 'quota']]) {
  test(`en 429 med Retry-After 300 og «${tekst.slice(0, 30)} …» giver typen ${type}, og udbyderen kaldes kun én gang`, real, async t => {
    const r = await kør(t, [{ status: 429, retryAfter: '300', tekst }], { grænse: 8_000 });
    assert.deepEqual(r.model.hovedkald(), [429], 'udbyderen kaldes ikke igen');
    assert.equal(r.fejl.length, 1, 'gatewayen melder fejlen én gang');
    assert.equal(r.fejl[0].failure.kind, type);
    assert.ok(Number.isFinite(r.fejl[0].failure.retryAt), 'tidspunktet følger med');
    assert.match(r.fejl[0].failure.detail, new RegExp(tekst.slice(0, 20)), 'udbyderens tekst står under Se detaljer');
  });
}

for (const [status, retryAfter] of [[429, '1'], [408, null], [500, null], [503, null]]) {
  test(`5d: den rigtige OpenCode genforsøger en forbigående ${status} gennem gatewayen, og opgaven slutter uden fejl og uden 409-lås`, real, async t => {
    const r = await kør(t, [{ status, retryAfter }, { status: 200 }]);
    console.log(`[5d] ${status}: slutning=${r.slutning}, hovedkald=${JSON.stringify(r.model.hovedkald())}, ${r.sekunder.toFixed(1)} s, version ${VERSION}`);
    assert.equal(r.slutning, 'session.idle', JSON.stringify(r.hændelser.filter(e => /error/.test(e.type)).map(e => e.properties?.error || e.message)));
    assert.deepEqual(r.model.hovedkald(), [status, 200], 'OpenCode skal have prøvet igen, og kun én gang');
    assert.equal(r.fejl.length, 0, 'Aura må ikke have låst forbindelsen');
    assert.ok(!r.hændelser.some(e => e.type === 'engine.error' || e.type === 'session.error'));
  });
}

test('5d: en vedvarende 503 ender med en klar fejl fra OpenCode inden for en afgrænset tid, og Aura låser ikke (ingen 409)', real, async t => {
  const r = await kør(t, [{ status: 503 }], { grænse: 100_000 });
  const antal = r.model.hovedkald().length;
  console.log(`[5d] vedvarende 503: slutning=${r.slutning}, hovedkald=${antal}, ${r.sekunder.toFixed(1)} s`);
  assert.equal(r.slutning, 'session.error', 'opgaven må ikke hænge');
  assert.ok(antal >= 2, 'OpenCode skal have genforsøgt mindst én gang');
  assert.ok(r.model.hovedkald().every(status => status === 503), 'ingen kald må være blevet afvist af en 409-lås: ' + r.model.hovedkald());
  const fejl = r.hændelser.find(e => e.type === 'session.error');
  assert.ok(String(fejl.properties?.error?.data?.message || '').includes('503') || fejl.properties?.error, 'fejlen skal være synlig');
  console.log('[5d] sluttfejl:', JSON.stringify(fejl.properties?.error).slice(0, 400));
  assert.match(JSON.stringify(fejl.properties?.error), /falsk 503/, 'udbyderens tekst skal nå frem til Se detaljer');
  assert.equal(r.fejl.length, 0, 'gatewayen kalder ikke onFailure for 5xx');
});

test('5d: en endelig 402 låser forbindelsen, og låsen rammer ikke et genforsøg, der ikke skulle ske', real, async t => {
  const r = await kør(t, [{ status: 402 }]);
  console.log(`[5d] 402: slutning=${r.slutning}, hovedkald=${JSON.stringify(r.model.hovedkald())}, gatewayfejl=${r.fejl.length}`);
  assert.equal(r.fejl.length, 1);
  assert.equal(r.fejl[0].failure.kind, 'quota');
  assert.equal(r.fejl[0].failure.detail, 'falsk 402');
  assert.deepEqual(r.model.hovedkald(), [402], 'OpenCode genforsøger ikke en 402; kun ét kald når modellen');
  assert.ok(['session.error', 'engine.error'].includes(r.slutning));
});
