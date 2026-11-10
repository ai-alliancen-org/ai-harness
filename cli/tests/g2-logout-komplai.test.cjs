// Q:D2-3 i terminalen: fjernes den udgåede komplai-AI-forbindelse, uden at adgangen kan tilbagekaldes hos komplai (fx uden net),
// siger aura logout det i stedet for blot «Forbindelsen er fjernet.».
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('../terminal.cjs');
const { Vault, privateDirectory } = require('../storage.cjs');
const { Application } = require('../app.cjs');
const { logout } = require('../aura.cjs');

class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask() { assert.ok(this.answers.length, 'Prøven mangler et svar'); return this.answers.shift(); }
  async confirm(question) { return await this.ask(question) === 'ja'; }
  async choose(question) { return this.ask(question); }
  interrupt() {}
}

test('logout uden net: den udgåede forbindelse fjernes, og terminalen siger, at adgangen ikke er tilbagekaldt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-g2-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const ui = new UI(['gammel', 'ja']), app = new Application({ directory: state, vault: new Vault(state), ui });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  await app.vault.unlock(new UI(['adgangssætning-til-prøven', 'adgangssætning-til-prøven']));
  const secret = app.bench.store.encrypt('kp_live_' + 'a'.repeat(43));
  await app.bench.store.update(s => { s.connections = [{ id: 'gammel', kind: 'komplai', name: 'Tidligere komplai', baseURL: 'https://api.komplai.dk/v1/aura/v1', account: { authMethod: 'oauth' }, secret }]; });
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try { await logout(app); } finally { globalThis.fetch = original; }
  assert.deepEqual((await app.bench.store.read()).connections, []);
  assert.match(ui.output, /ikke tilbagekaldt hos komplai/);
  assert.doesNotMatch(ui.output, /^Forbindelsen er fjernet\.$/m);
});
