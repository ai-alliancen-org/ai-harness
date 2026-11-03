// Små rettelser fra gennemgangen 3. november 2026, hver med en prøve der fejlede før rettelsen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { startGateway } = require('../core/gateway.cjs');
const { networkFailure } = require('../core/connections.cjs');
const { cleanOutput } = require('../core/dev-server.cjs');

test('et langt Retry-After videresendes højst som 120 sekunder, så opgaven ikke hænger i en time', async t => {
  const server = http.createServer(async (req, res) => { for await (const _ of req) { } res.writeHead(429, { 'retry-after': '3600' }); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'm' }, '', null, () => { });
  t.after(async () => { await gateway.close(); server.closeAllConnections(); server.close(); });
  const response = await fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'm' }) });
  await response.text();
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) <= 120, 'Retry-After var ' + response.headers.get('retry-after'));
});

test('maskeringen af adresser med login er lineær: 1 MB uden afslutning tager under to sekunder', () => {
  assert.equal(typeof cleanOutput, 'function', 'cleanOutput skal være eksporteret');
  const input = 'http://' + 'a:'.repeat(500_000);
  const start = process.hrtime.bigint();
  cleanOutput(input);
  assert.ok(Number(process.hrtime.bigint() - start) / 1e9 < 2);
  assert.match(cleanOutput('fejl ved https://bruger:hemmelig@server.dk/x'), /\[skjult\]@server\.dk/);
});

test('en midlertidig DNS-fejl (EAI_AGAIN) peger på nettet, ikke på stavningen', () => {
  const fejl = code => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  assert.match(networkFailure(fejl('ENOTFOUND')).message, /stavning/i);
  assert.doesNotMatch(networkFailure(fejl('EAI_AGAIN')).message, /stavning/i);
});

test('valget Enkel hjemmeside findes i projektets indstillinger', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const select = /<select id="project-runtime-mode">(.*?)<\/select>/s.exec(html)[1];
  assert.equal((select.match(/<option /g) || []).length, 2, select);
  assert.match(select, /<option value="static">Enkel hjemmeside<\/option>/);
});

test('prompten bevarer værnene mod at skjule en fejl og mod at åbne netadgang for at skjule den', () => {
  const guidance = fs.readFileSync(path.join(__dirname, '..', 'core', 'project-guidance.cjs'), 'utf8');
  for (const sætning of ['erstat ikke rigtige data med eksempeldata', 'åbn ikke netadgang for at skjule en fejl', 'En blokering i previewet er ikke bevis for manglende internet']) assert.ok(guidance.includes(sætning), sætning);
});

test('Ret med AI i forhåndsvisningen lægger rettelsen i Byg, hvor filer kan ændres, ikke i Planlæg', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'server.js'), 'utf8');
  const call = /window\.draftMessage\([^;]*\);/.exec(source.slice(source.indexOf("'Ret med AI'")))[0];
  assert.match(call, /mode: 'free'/);
});

test('en serverfejl kan sendes til AI\'en med de sidste linjer af den maskerede log, og kun dem', () => {
  const view = require('../ui/approval-view.js');
  const lang = Array.from({ length: 400 }, (_, n) => `linje ${n}`).join('\n') + '\nSLUTNINGEN';
  const kladde = view.serverRepairDraft({ state: 'error', message: 'De lokale tjenester blev ikke klar.', output: lang });
  assert.match(kladde, /De lokale tjenester blev ikke klar/); assert.match(kladde, /SLUTNINGEN/); assert.doesNotMatch(kladde, /linje 0\n/);
  assert.ok(kladde.length < 2200); assert.match(kladde, /aura_preview/);
  assert.equal(view.serverRepairDraft({ state: 'running', output: 'x' }), '', 'ingen kladde, når der ikke er en fejl');
});
