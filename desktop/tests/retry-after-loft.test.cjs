// Q:B1-4: en udbyder, der svarer 429 og beder om at vente længere end gatewayens loft på 120 sekunder (Retry-After i
// sekunder eller som HTTP-dato). Før blev ventetiden afkortet til 120 sekunder, og OpenCode prøvede igen fem gange, så
// opgaven stod i Arbejder i op til 10 minutter og fejlede alligevel. Nu er svaret endeligt med det samme, og kortet siger,
// hvornår udbyderen tager imod igen. Kortere ventetider og serverfejl sendes stadig til OpenCodes genforsøg som før.
// Skeptikerens fund efter reparationen: typen var altid quota («Kontoen hos udbyderen er brugt op»), også ved en almindelig
// hastighedsgrænse. Nu afgør udbyderens egen tekst det som i sessionFailure: kun en tekst om opbrugt kvote eller kredit giver
// kvotekortet; ellers er det grænsekortet («Vent lidt, og prøv igen») med linjen om tidspunktet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { startGateway } = require('../core/gateway.cjs');
const { Workbench } = require('../core/workbench.cjs');

// En udbyder, der svarer det samme hver gang og tæller kaldene.
async function provider(t, status, headers = {}, text = 'Rate limit exceeded') {
  const calls = { count: 0 };
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* hele beskeden læses */ }
    calls.count++; res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify({ error: { message: text } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const failures = [];
  const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'm' }, '', null, (message, failure) => failures.push({ message, ...failure }));
  t.after(async () => { await gateway.close(); server.closeAllConnections(); server.close(); });
  const send = async () => { const response = await fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'm' }) }); await response.text(); return response; };
  return { send, failures, calls };
}
const clock = at => new Date(at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });

test('en 429, der beder om at vente en time, stopper opgaven med det samme med grænsekortet og tidspunktet', async t => {
  const { send, failures, calls } = await provider(t, 429, { 'retry-after': '3600' });
  const before = Date.now(), first = await send();
  assert.equal(first.status, 429);
  assert.equal(failures.length, 1, 'fejlen meldes med det samme, ikke efter OpenCodes genforsøg');
  assert.equal(failures[0].kind, 'limit', 'en hastighedsgrænse er ikke en opbrugt konto');
  assert.equal(failures[0].status, 429);
  assert.ok(failures[0].retryAt >= before + 3_600_000 && failures[0].retryAt <= Date.now() + 3_600_000, 'tidspunktet, hvor udbyderen tager imod igen');
  assert.match(failures[0].message, new RegExp(`tager først imod igen kl\\. ${clock(failures[0].retryAt).replace('.', '\\.')}`));
  assert.match(failures[0].message, /Din besked er bevaret/);
  assert.ok(!(Number(first.headers.get('retry-after')) > 120), 'motoren bliver ikke bedt om at vente længere end loftet');
  assert.equal((await send()).status, 409, 'et nyt forsøg når ikke udbyderen');
  assert.equal(calls.count, 1);
});

test('Retry-After som HTTP-dato over loftet er også endeligt og bærer udbyderens tidspunkt', async t => {
  const at = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 1000) * 1000);
  const { send, failures } = await provider(t, 429, { 'retry-after': at.toUTCString() });
  assert.equal((await send()).status, 429);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'limit');
  assert.ok(Math.abs(failures[0].retryAt - at.getTime()) <= 1000, `${new Date(failures[0].retryAt).toISOString()} ≠ ${at.toISOString()}`);
});

// Den tekst, skeptikeren afprøvede med rigtig OpenCode 1.19.5, og OpenAI's tekst for en opbrugt konto, der også kommer som 429.
test('kun udbyderens tekst om opbrugt kvote eller kredit giver kvotekortet ved et langt Retry-After', async t => {
  for (const [text, kind] of [
    ['Rate limit reached for requests per minute', 'limit'],
    ['Too many requests', 'limit'],
    ['You exceeded your current quota, please check your plan and billing details.', 'quota'],
    ['insufficient_quota', 'quota'],
    ['Your credit balance is too low to access the API.', 'quota']
  ]) {
    const { send, failures } = await provider(t, 429, { 'retry-after': '300' }, text);
    assert.equal((await send()).status, 429);
    assert.equal(failures[0]?.kind, kind, text);
    assert.ok(Number.isFinite(failures[0]?.retryAt), 'tidspunktet følger med i begge tilfælde');
  }
});

test('en kort ventetid sendes stadig til OpenCodes genforsøg, også som HTTP-dato, og låser ikke forbindelsen', async t => {
  for (const headers of [{ 'retry-after': '30' }, { 'retry-after': new Date(Date.now() + 61_000).toUTCString() }]) {
    const { send, failures, calls } = await provider(t, 429, headers);
    const first = await send(), wait = Number(first.headers.get('retry-after'));
    assert.equal(first.status, 429);
    assert.ok(wait >= 29 && wait <= 61, `ventetiden følger med: ${first.headers.get('retry-after')}`);
    assert.deepEqual(failures, [], 'ingen fejl i Aura; OpenCode prøver igen');
    assert.equal((await send()).status, 429, 'næste forsøg når udbyderen');
    assert.equal(calls.count, 2);
  }
});

test('en serverfejl med langt Retry-After sendes stadig videre med loftet; kun 429 er en grænse hos udbyderen', async t => {
  const { send, failures } = await provider(t, 503, { 'retry-after': '3600' });
  const first = await send();
  assert.equal(first.status, 503);
  assert.equal(first.headers.get('retry-after'), '120');
  assert.deepEqual(failures, []);
});

test('samtalen giver tidspunktet videre til resultatkortet', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-retry-after-')); t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projekt'); await fsp.mkdir(root);
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles: path.join(__dirname, '../../profiles'), emit() {}, safeStorage: {} });
  await bench.activate({ root, name: 'Grænse' }); const chat = bench.chat;
  chat.running = true; chat.runMode = 'build';
  const retryAt = Date.now() + 3_600_000;
  chat.event({ type: 'engine.error', message: 'Udbyderen tager først imod igen kl. 15.10. Aura venter ikke så længe, så opgaven er stoppet. Din besked er bevaret.', failure: { kind: 'quota', status: 429, retryAt } });
  const failure = chat.runFailure;
  // Fejlen afslutter opgaven i baggrunden; mappen ryddes først, når afslutningen er færdig.
  await chat.finishing?.catch(() => {}); await bench.close();
  assert.equal(failure?.kind, 'quota');
  assert.equal(failure?.retryAt, retryAt, 'resultatkortet får tidspunktet med');
});

// Resultatkortet i ui/app.js med en lille DOM, som tests/result-dialog.test.cjs gør.
class Element {
  constructor(tag = 'div', text = '') { this.tagName = tag; this.text = text || ''; this.children = []; this.hidden = false; this.dataset = {}; this.className = ''; this.classList = { add() {}, toggle() {}, contains: () => false }; }
  get textContent() { return this.text + this.children.map(item => typeof item === 'string' ? item : item.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  querySelectorAll(selector) { return this.children.filter(item => typeof item !== 'string').flatMap(item => [...(item.tagName === selector ? [item] : []), ...item.querySelectorAll(selector)]); }
  scrollIntoView() {} focus() {}
}
function card() {
  const elements = new Map(), $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const view = { id: 'samtale', review: new Element('section'), log: new Element(), runConnection: 'c', followChat: false, historyPending: [] };
  const context = { $, view, current: { root: '/p' }, state: { connections: [{ id: 'c', kind: 'anthropic' }] }, node: (tag, text) => new Element(tag, text), action: fn => fn(), call: async () => {}, showSetup() {}, openTaskSettings() {}, requestAnimationFrame: fn => fn(), window: { ApprovalView: require('../ui/approval-view.js'), workspace: { show() {} } } };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function updatePlanOffer('), source.indexOf('let localDiscoveryGeneration')), context);
  return { context, view };
}

test('kvotekortet siger, hvornår udbyderen tager imod igen, og har vejen til kontoen', () => {
  const { context, view } = card();
  const retryAt = Date.now() + 45 * 60_000;
  context.renderRunReview({ status: 'error', files: [], failure: { kind: 'quota', status: 429, retryAt, message: 'Udbyderens egen tekst' } }, view);
  const text = view.review.textContent;
  assert.match(text, /Kontoen hos udbyderen er brugt op/);
  assert.ok(text.includes(`Udbyderen tager først imod igen kl. ${clock(retryAt)}, om cirka 45 min.`), text);
  assert.deepEqual(view.review.querySelectorAll('button').map(button => button.textContent), ['Åbn kontoen hos udbyderen', 'Prøv igen']);
  // Uden tidspunkt er kortet som før.
  context.renderRunReview({ status: 'error', files: [], failure: { kind: 'quota', status: 402 } }, view);
  assert.doesNotMatch(view.review.textContent, /tager først imod igen/);
});

test('grænsekortet siger også, hvornår udbyderen tager imod igen, og hovedknappen er Prøv igen', () => {
  const { context, view } = card();
  const retryAt = Date.now() + 5 * 60_000;
  context.renderRunReview({ status: 'error', files: [], failure: { kind: 'limit', status: 429, retryAt, message: 'Udbyderens egen tekst' } }, view);
  const text = view.review.textContent;
  assert.match(text, /Udbyderen har nået en grænse/);
  assert.doesNotMatch(text, /brugt op/);
  assert.ok(text.includes(`Udbyderen tager først imod igen kl. ${clock(retryAt)}, om cirka 5 min.`), text);
  assert.deepEqual(view.review.querySelectorAll('button').map(button => button.textContent), ['Prøv igen', 'Åbn kontoen hos udbyderen']);
});
