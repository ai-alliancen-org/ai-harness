const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('../terminal.cjs');
const { privateDirectory, Vault } = require('../storage.cjs');
const { login } = require('../connections.cjs');
const { Application } = require('../app.cjs');
const core = require('../../desktop/core/connections.cjs');

class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; this.asked = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question, options) { this.asked.push({ question, options }); const next = this.answers.shift(); return typeof next === 'function' ? next(options) : (next ?? options?.fallback ?? ''); }
  async choose(question, choices) { this.asked.push({ question, choices }); return this.answers.shift(); }
  interrupt() {}
}
async function fixture(t, answers = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c1-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const ui = new UI(answers), vault = new Vault(state), app = new Application({ directory: state, vault, ui });
  app.vault.unlock = async () => {};
  app.bench.store.encrypt = value => 'test:' + value;
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { app, ui };
}
const stored = app => app.bench.store.read().then(state => state.connections);

test('c1-10a: nøglen kontrolleres, før noget gemmes, og Bearer foran rettes med en linje', async t => {
  const calls = [];
  const { app, ui } = await fixture(t, ['http://127.0.0.1:9/v1', 'Min server', 'Bearer abcdefghijklmnopqrstuvwxyz123456']);
  const original = app.bench.storeConnection.bind(app.bench);
  app.bench.storeConnection = async (...args) => { calls.push('gem'); return original(...args); };
  t.mock.method(core, 'listModels', async (connection, key) => { calls.push('kontrol:' + key); return [{ id: 'm1', name: 'm1' }]; });
  const id = await login(app, 'compatible');
  assert.deepEqual(calls, ['kontrol:abcdefghijklmnopqrstuvwxyz123456', 'gem']);
  assert.match(ui.output, /Rettet i den indsatte nøgle: foranstillet Bearer/);
  assert.equal((await stored(app))[0].id, id);
});

test('c1-10a: en afvist nøgle gemmer intet og giver en rettelseslinje', async t => {
  const { app, ui } = await fixture(t, ['http://127.0.0.1:9/v1', 'Min server', 'abcdefghijklmnopqrstuvwxyz123456']);
  let saved = 0;
  const original = app.bench.storeConnection.bind(app.bench);
  app.bench.storeConnection = async (...args) => { saved++; return original(...args); };
  t.mock.method(core, 'listModels', async () => { throw Object.assign(new Error('Nøglen blev afvist.'), { reason: 'rejected' }); });
  await assert.rejects(login(app, 'compatible'), /afvist/);
  assert.equal(saved, 0, 'intet gemmes før kontrollen er bestået');
  assert.equal((await stored(app)).length, 0);
  assert.match(ui.output, /Det kan du gøre: kopiér nøglen igen/);
});

test('c1-10a: en nøgle, der ikke kan renses, afvises før kontrol med forklaring', async t => {
  const { app, ui } = await fixture(t, ['http://127.0.0.1:9/v1', 'Min server', 'abc def ghijklmnopqrstuvwxyz1234']);
  t.mock.method(core, 'listModels', async () => { throw new Error('må ikke kaldes'); });
  await assert.rejects(login(app, 'compatible'), /mellemrum/);
  assert.match(ui.output, /Forbindelsen er ikke gemt/);
});

test('c1-10a: Corti-standardnavnet følger regionen som i appen, et selvvalgt navn bevares', async t => {
  const key = Buffer.from('eu-s:' + 'A'.repeat(40)).toString('base64');
  for (const [name, forventet] of [[undefined, 'Corti S1 · EU-S'], ['Mit navn', 'Mit navn']]) {
    const { app } = await fixture(t, [name, key]);
    t.mock.method(core, 'listModels', async () => [{ id: 'm1', name: 'm1' }]);
    await login(app, 'corti');
    assert.equal((await stored(app))[0].name, forventet);
    t.mock.restoreAll();
  }
});

// Serveren svarer aldrig og lukker intet selv, før prøven er færdig. Kun Auras egen afbrydelse kan lukke forbindelsen.
// Hver forbindelse noterer, om den bar en forespørgsel; undici kan åbne en tom forbindelse bagefter, som intet sender.
async function hangingServer(t) {
  const sockets = [];
  const server = http.createServer(() => {});
  server.on('connection', socket => { const entry = { bytes: 0, closedAt: null }; sockets.push(entry); socket.on('data', chunk => { entry.bytes += chunk.length; }); socket.on('close', () => { entry.closedAt = Date.now(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { port: server.address().port, requests: () => sockets.filter(s => s.bytes > 0) };
}
test('c1-11a: Ctrl+C (app.stop) afbryder selve den hængende modelhentning under login, gemmer intet og venter ikke på tidsgrænsen', async t => {
  const server = await hangingServer(t);
  const { app, ui } = await fixture(t, [`http://127.0.0.1:${server.port}/v1`, 'Hængende', 'abcdefghijklmnopqrstuvwxyz123456']);
  const started = Date.now();
  const running = login(app, 'compatible');
  const result = assert.rejects(running, { code: 'CANCELLED' });
  while (!/Kontrollerer nøglen/.test(ui.output) || !server.requests().length) await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 100));
  const stopped = Date.now();
  await app.stop();
  await result;
  assert.ok(Date.now() - started < 3000, 'afbrydelsen afventer ikke de 15 sekunders timeout');
  while (Date.now() - stopped < 3000 && server.requests().some(s => s.closedAt === null)) await new Promise(resolve => setTimeout(resolve, 20));
  // Lever kaldet videre, venter terminalen op til 15 sekunder på prompten efter «Afbrudt.» (K4).
  assert.ok(server.requests().every(s => s.closedAt !== null && s.closedAt - stopped < 2000), 'netkaldet er stoppet, ikke kun ventetiden');
  assert.equal((await stored(app)).length, 0, 'ingen halvt gemt forbindelse');
  assert.match(ui.output, /Afbrudt\. Intet er gemt/);
  assert.equal(app.pendingLogin, null);
});
test('c1-11b: efter Ctrl+C under login slutter processen straks og venter ikke på den hængende server (K4)', async t => {
  const server = await hangingServer(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c1-proces-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Samme forløb som aura login i en terminal: nøglen kontrolleres, Ctrl+C kalder app.stop(), og Aura lukker. Processen
  // må derefter ikke leve videre, til kaldets tidsgrænse på 15 sekunder udløber.
  const child = require('node:child_process').spawn(process.execPath, ['-e', `
    const { Application } = require(${JSON.stringify(path.join(__dirname, '..', 'app.cjs'))});
    const { Vault, privateDirectory } = require(${JSON.stringify(path.join(__dirname, '..', 'storage.cjs'))});
    const { login } = require(${JSON.stringify(path.join(__dirname, '..', 'connections.cjs'))});
    (async () => {
      const state = await privateDirectory(process.argv[1]);
      let output = '';
      const answers = ['http://127.0.0.1:' + process.argv[2] + '/v1', 'Hængende', 'abcdefghijklmnopqrstuvwxyz123456'];
      const ui = { protect() {}, write(v) { output += v; }, line(v = '') { output += v + '\\n'; }, async ask() { return answers.shift() ?? ''; }, async choose() { return null; }, interrupt() {} };
      const app = new Application({ directory: state, vault: new Vault(state), ui });
      app.vault.unlock = async () => {};
      const running = login(app, 'compatible').catch(error => error.code);
      while (!/Kontrollerer nøglen/.test(output)) await new Promise(resolve => setTimeout(resolve, 10));
      await new Promise(resolve => setTimeout(resolve, 300));
      await app.stop();
      const code = await running;
      await app.close();
      process.stdout.write('afbrudt:' + code + '\\n');
    })();
  `, path.join(root, 'state'), String(server.port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let stdout = '', stopped = null;
  child.stdout.on('data', chunk => { stdout += chunk; if (stopped === null && /afbrudt:/.test(stdout)) stopped = Date.now(); });
  t.after(() => child.kill('SIGKILL'));
  const [code] = await require('node:events').once(child, 'exit');
  assert.equal(code, 0);
  assert.match(stdout, /afbrudt:CANCELLED/);
  assert.ok(Date.now() - stopped < 2000, `processen levede ${Date.now() - stopped} ms efter afbrydelsen`);
});
