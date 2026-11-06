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

test('c1-11a: Ctrl+C (app.stop) afbryder en hængende modelhentning under login med CANCELLED og gemmer intet', async t => {
  const server = http.createServer(() => {}); // svarer aldrig
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const { app, ui } = await fixture(t, [`http://127.0.0.1:${server.address().port}/v1`, 'Hængende', 'abcdefghijklmnopqrstuvwxyz123456']);
  const started = Date.now();
  const running = login(app, 'compatible');
  const result = assert.rejects(running, { code: 'CANCELLED' });
  while (!/Kontrollerer nøglen/.test(ui.output)) await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 100));
  await app.stop();
  await result;
  assert.ok(Date.now() - started < 3000, 'afbrydelsen afventer ikke de 15 sekunders timeout');
  assert.equal((await stored(app)).length, 0, 'ingen halvt gemt forbindelse');
  assert.match(ui.output, /Afbrudt\. Intet er gemt/);
  assert.equal(app.pendingLogin, null);
});
