// AI'ens værktøj aura_preview (gennemgangens fund 23 og 25, beta 3).
// 23: Et statisk projekt har ingen server og ingen Start-knap, så AI'en må aldrig få besked om samtykke eller Start dér.
// 25: Pluginet må ikke give op, før Aura selv er færdig med at vente på installation og start; Stop afbryder ventetiden.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { aiPreview } = require('../core/ai-preview.cjs');
const bridge = require('../core/preview-bridge.cjs');
const nu = { wait: async () => {} };

function statiskRum({ url = null } = {}) {
  const log = [];
  const server = { state: 'idle', url: null, message: '', output: '', snapshot() { return { state: this.state, url: this.url, message: this.message, output: this.output }; },
    async status() { return { project: { kind: 'static', supported: false, installed: true, fingerprint: 'f', reason: 'Projektet har ingen package.json.' } }; },
    async prepare(action) { log.push(['prepare', action]); throw Error('må ikke kaldes'); }, async execute() { log.push(['execute']); } };
  return { log, value: { devServer: server, preview: url ? { url } : null, forceStatic: false, owner: { project: { root: '/p' }, store: { project: async () => ({}) } } } };
}

test('fund 23: start i et statisk projekt uden vist side beder hverken om samtykke eller om at trykke Start', async () => {
  const rum = statiskRum();
  const svar = await aiPreview(rum.value, 'start', nu);
  assert.notEqual(svar.state, 'needs_consent');
  assert.equal(svar.url, null, 'ingen opdigtet adresse');
  assert.doesNotMatch(svar.message, /ikke godkendt|Bed brugeren trykke Start/);
  assert.match(svar.message, /intet at starte/); assert.match(svar.message, /brugeren skal ikke trykke Start/); assert.match(svar.message, /public\/index\.html/);
  assert.deepEqual(rum.log, [], 'intet forsøges installeret eller startet');
  const status = await aiPreview(rum.value, 'status', nu);
  assert.equal(status.state, 'idle'); assert.match(status.message, /intet at starte/);
});

test('fund 23: kan Aura vise den statiske side med det samme, får AI’en adressen; status viser intet frem', async () => {
  const rum = statiskRum(); let kald = 0;
  const startStatic = async () => { kald++; rum.value.preview = { url: 'aura-preview://p/' }; return true; };
  assert.equal((await aiPreview(rum.value, 'status', { ...nu, startStatic })).url, null);
  assert.equal(kald, 0, 'status registrerer ikke siden');
  const svar = await aiPreview(rum.value, 'start', { ...nu, startStatic });
  assert.deepEqual([svar.state, svar.url, kald], ['running', 'aura-preview://p/', 1]);
  // Findes public/index.html endnu ikke, svarer Aura ærligt uden adresse.
  const tom = statiskRum();
  const venter = await aiPreview(tom.value, 'start', { ...nu, startStatic: async () => false });
  assert.deepEqual([venter.state, venter.url], ['idle', null]); assert.match(venter.message, /intet at starte/);
});

function viteRum() {
  const server = { state: 'idle', url: null, message: '', output: '', installed: false,
    snapshot() { return { state: this.state, url: this.url, message: this.message, output: this.output }; },
    async status() { return { project: { kind: 'vite', supported: true, fingerprint: 'f1', installed: this.installed } }; },
    async prepare(action) { return { token: action }; },
    async execute(token) { if (token === 'install') this.installed = true; else { this.state = 'running'; this.url = 'http://localhost:5173/'; } } };
  return { devServer: server, forceStatic: false, owner: { project: { root: '/p' }, store: { project: async () => ({ previewConsent: { fingerprint: 'f1', scripts: false } }) } } };
}

// Pluginet køres, som motoren kører det: som ES-modul med det rigtige @opencode-ai/plugin.
async function aabnPlugin(t, info) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-plugin-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const plugin = pathToFileURL(path.join(__dirname, '../node_modules/@opencode-ai/plugin/dist/index.js')).href;
  const file = path.join(directory, 'aura-preview.mjs');
  await fs.writeFile(file, bridge.pluginSource(info).replace("'@opencode-ai/plugin'", JSON.stringify(plugin)));
  const { AuraPreview } = await import(pathToFileURL(file).href);
  return (await AuraPreview()).tool.aura_preview;
}

test('fund 25: pluginet venter længere end Aura højst venter på installation og start, også i motorens Bun', async t => {
  const waits = [];
  const svar = await aiPreview(viteRum(), 'start', { wait: async (done, ms) => { waits.push(ms); } });
  assert.equal(svar.state, 'running');
  const aura = waits.reduce((sum, ms) => sum + ms, 0);
  const timeout = Number(bridge.pluginSource({ url: 'http://127.0.0.1:1/', token: 't', root: '/p' }).match(/AbortSignal\.timeout\((\d+)\)/)?.[1]);
  assert.ok(timeout > aura, `pluginet giver op efter ${timeout} ms, men Aura venter op til ${aura} ms på installation og start`);
  // Motoren (OpenCode 1.19.5) kører pluginet i Bun 1.4.4, og dér giver fetch selv op efter cirka 360 sekunder, også med et
  // længere signal (målt med motoren). Kun med timeout: false gælder pluginets egen grænse. Prøven ser, hvad fetch faktisk får.
  const tool = await aabnPlugin(t, { url: 'http://127.0.0.1:1/', token: 't', root: '/p' });
  const kald = [], original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => { kald.push(init); return new Response(JSON.stringify({ state: 'running', url: 'http://localhost:5173/' })); };
  const stop = new AbortController();
  assert.equal(JSON.parse(await tool.execute({ action: 'start' }, { abort: stop.signal })).state, 'running');
  assert.equal(kald.length, 1);
  assert.equal(kald[0].timeout, false, 'Bun-motorens egen grænse for fetch skal være slået fra, ellers giver pluginet op efter cirka 360 sekunder');
  assert.ok(kald[0].signal instanceof AbortSignal && !kald[0].signal.aborted, 'pluginets egen ventetid styrer kaldet');
  stop.abort(); assert.equal(kald[0].signal.aborted, true, 'Stop afbryder kaldet');
});

test('fund 25: pluginet giver Auras svar videre, og Stop afslutter ventetiden med det samme', { timeout: 15000 }, async t => {
  const svarer = await bridge.listen({ start: async () => ({ state: 'running', url: 'http://localhost:5173/' }), status: () => new Promise(() => {}) });
  t.after(() => svarer.close());
  const tool = await aabnPlugin(t, { url: svarer.url, token: svarer.token, root: '/p' });
  const ok = JSON.parse(await tool.execute({ action: 'start' }, { abort: new AbortController().signal }));
  assert.deepEqual([ok.state, ok.url], ['running', 'http://localhost:5173/']);
  // Aura svarer aldrig på status her; brugeren trykker Stop.
  const stop = new AbortController(), started = Date.now();
  setTimeout(() => stop.abort(), 100);
  const stopped = JSON.parse(await tool.execute({ action: 'status' }, { abort: stop.signal }));
  assert.ok(Date.now() - started < 5000, 'værktøjet venter ikke videre efter Stop');
  assert.equal(stopped.state, 'error'); assert.match(stopped.message, /stoppet/);
  assert.doesNotMatch(stopped.message, /Bed brugeren starte forhåndsvisningen/);
});
