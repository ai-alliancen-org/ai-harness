const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('../terminal.cjs');
const { privateDirectory, lock, unlockStale } = require('../storage.cjs');
const { login } = require('../connections.cjs');
const { allowedSource } = require('../../scripts/cli-release-contract.cjs');
const { Vault } = require('../storage.cjs');
const { Application } = require('../app.cjs');
const core = require('../../desktop/core/connections.cjs');

class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; this.asked = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question) { this.asked.push({ question, seen: this.output }); return this.answers.length ? this.answers.shift() : ''; }
  async confirm(question) { this.asked.push({ question, seen: this.output }); return await this.ask(question) === 'ja'; }
  async choose(question, choices) { this.asked.push({ question, choices, seen: this.output }); return this.answers.shift(); }
  interrupt() {}
}
async function fixture(t, answers = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s5-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const ui = new UI(answers), vault = new Vault(state), app = new Application({ directory: state, vault, ui });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, state, ui, app };
}

// Fund 4
test('s5-4: terminaltekst skjuler Authorization, x-api-key, NAVN=værdi, AKIA og nøgler uden præfiks i en .env-linje', () => {
  const secrets = ['q8Zk3pLm92VxT7rNb4Hd', 'Zk3pQ9vL2mX7rTb5Nc8Wd1Ye4Fg6Hj0K', 'AKIAIOSFODNN7EXAMPLE', 'hunter2hunter2xx', 'a1B2c3D4e5F6g7H8'];
  const text = safeText([
    `Authorization: Bearer ${secrets[0]}`, `x-api-key: ${secrets[1]}`, `MISTRAL_API_KEY=${secrets[1]}`,
    `Nøgle ${secrets[2]} i loggen`, `DATABASE_PASSWORD=${secrets[3]}`, `SESSION_SECRET=${secrets[4]}`
  ].join('\n'));
  for (const secret of secrets) assert.ok(!text.includes(secret), `skal skjules: ${secret}`);
  assert.match(text, /\[skjult nøgle\]/);
  assert.match(text, /Authorization: Bearer/);
});
test('s5-4: almindelig tekst og stier står uændret', () => {
  const ok = 'Jeg læste desktop/core/connections.cjs og kaldte process.env.HOME. Bearer authentication er valgt.';
  assert.equal(safeText(ok), ok);
});

test('s5-4: lange stier med store og små bogstaver og ciffer står uændret, men en lang nøgle i en sti skjules', () => {
  const sti = 'Skriver til /Users/bjornskalkam/GitHub/os_harness/cli/tests/s5-cli.test.cjs og ./desktop/core/Abc1Def2Ghi3Jkl4Mno5Pqr6Stu7Vwx8Yza9/x.js';
  assert.equal(safeText(sti), sti);
  assert.equal(safeText('Læser /Users/bjornskalkam/GitHub/os_harness/cli/tests/s5-cli'), 'Læser /Users/bjornskalkam/GitHub/os_harness/cli/tests/s5-cli');
  const nøgle = 'Zk3pQ9vL2mX7rTb5Nc8Wd1Ye4Fg6Hj0KaB3cD4eF5';
  assert.ok(!safeText(`Læser /tmp/${nøgle}/fil`).includes(nøgle));
});

// Fund 18
test('s5-18: udbyderens region og træning vises før nøgleprompten', async t => {
  const { app, ui } = await fixture(t, ['Min Claude', 'sk-ant-forkert-proeve-1234567890']);
  app.vault.unlock = async () => {};
  t.mock.method(core, 'listModels', async () => { throw new Error('stop'); });
  await assert.rejects(login(app, 'anthropic'), /stop/);
  const keyPrompt = ui.asked.find(a => /API-nøgle/.test(a.question));
  assert.ok(keyPrompt, 'nøgleprompten blev stillet');
  assert.match(keyPrompt.seen, /Globalt, også uden for EU/);
  assert.match(keyPrompt.seen, /Bruges ikke til træning som standard/);
});

// Fund 22
async function ollamaLogin(t, error, answers) {
  const f = await fixture(t, answers);
  f.app.vault.unlock = async () => {};
  const original = f.ui.ask.bind(f.ui);
  f.ui.ask = async question => /adresse/i.test(question) ? 'http://127.0.0.1:9/v1' : /navn/i.test(question) ? 'Min server' : /nøgle/i.test(question) ? '' : original(question);
  t.mock.method(core, 'listModels', async () => { throw error; });
  return f;
}
const down = () => Object.assign(new Error('Serveren svarer ikke. Kontrollér adresse, port, netværk og eventuelt Tailscale.'), { reason: 'unreachable' });
test('s5-22: en server, der ikke kan nås, sletter ikke forbindelsen, når brugeren vælger Gem alligevel', async t => {
  const { app, ui } = await ollamaLogin(t, down(), ['keep']);
  const id = await login(app, 'ollama');
  const saved = (await app.bench.store.read()).connections;
  assert.equal(saved.length, 1); assert.equal(saved[0].id, id);
  const question = ui.asked.find(a => /alligevel/.test(a.question));
  assert.deepEqual(question.choices.map(c => c.label), ['Gem alligevel', 'Fjern forbindelsen']);
});
test('s5-22: timeout behandles som unreachable; vælges Fjern, slettes forbindelsen og fejlen kastes', async t => {
  const { app } = await ollamaLogin(t, Object.assign(down(), { reason: 'timeout' }), ['remove']);
  await assert.rejects(login(app, 'ollama'), /Serveren svarer ikke/);
  assert.equal((await app.bench.store.read()).connections.length, 0);
});
test('s5-22: en afvist nøgle fjerner forbindelsen uden spørgsmål, som før', async t => {
  const { app, ui } = await ollamaLogin(t, Object.assign(new Error('Nøglen blev afvist.'), { reason: 'rejected' }), []);
  await assert.rejects(login(app, 'ollama'), /afvist/);
  assert.equal((await app.bench.store.read()).connections.length, 0);
  assert.ok(!ui.asked.some(a => /alligevel/.test(a.question)));
});

// Fund 24
test('s5-24: CLI-kontrakten og files-listen tillader command-sandbox-runner.mjs', async () => {
  assert.equal(allowedSource('desktop/core/command-sandbox-runner.mjs'), true);
  assert.equal(allowedSource('desktop/core/x.sh'), false);
  assert.equal(allowedSource('desktop/core/../x.mjs'), false);
  const pkg = JSON.parse(await fs.readFile(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.ok(pkg.files.includes('desktop/core/*.mjs'));
  await fs.access(path.join(__dirname, '../../desktop/core/command-sandbox-runner.mjs'));
});

// Fund 25
test('s5-25a: datamappen skal tilhøre den kørende bruger', { skip: process.platform === 'win32' }, async t => {
  const { root } = await fixture(t);
  const dir = path.join(root, 'anden');
  await privateDirectory(dir);
  const mine = process.getuid();
  t.mock.method(process, 'getuid', () => mine + 1);
  await assert.rejects(privateDirectory(dir), /anden bruger/);
});
test('s5-25b: er låsen skiftet ud, mens den blev overtaget, gendannes den nye lås og ingen overtager den', { skip: process.platform === 'win32' }, async t => {
  const { state } = await fixture(t);
  const file = path.join(state, 'cli.lock');
  await fs.writeFile(file, JSON.stringify({ pid: 2 ** 22 + 12345, token: 'gammel' }), { mode: 0o600 });
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    // En anden proces når at overtage låsen mellem læsning og omdøbning.
    await fs.writeFile(from, JSON.stringify({ pid: process.pid, token: 'ny-ejer' }), { mode: 0o600 });
    return rename(from, to);
  });
  await assert.rejects(lock(state), /anden Aura-terminal/);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).token, 'ny-ejer', 'den nye ejers lås er bevaret');
  assert.deepEqual((await fs.readdir(state)).filter(n => n.startsWith('cli.lock.')), [], 'ingen rester');
});
test('s5-25c: aura unlock fjerner en uparsebar lås efter bekræftelse, men ikke uden', async t => {
  const { state, ui } = await fixture(t, ['nej', 'ja']);
  const file = path.join(state, 'cli.lock');
  await fs.writeFile(file, '{ikke json', { mode: 0o600 });
  await unlockStale(state, ui);
  await fs.access(file);
  await unlockStale(state, ui);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  assert.match(ui.asked[0].question, /kan ikke læses/);
});
test('s5-25c: aura unlock fjerner en lås med forkerte rettigheder og død proces efter bekræftelse', { skip: process.platform === 'win32' }, async t => {
  const { state, ui } = await fixture(t, ['ja']);
  const file = path.join(state, 'cli.lock');
  await fs.writeFile(file, JSON.stringify({ pid: 2 ** 22 + 12345, token: 'x' })); await fs.chmod(file, 0o644);
  await unlockStale(state, ui);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
});
test('s5-25c: en lås med forkerte rettigheder og levende proces fjernes aldrig', { skip: process.platform === 'win32' }, async t => {
  const { state, ui } = await fixture(t, ['ja']);
  const file = path.join(state, 'cli.lock');
  await fs.writeFile(file, JSON.stringify({ pid: process.pid, token: 'x' })); await fs.chmod(file, 0o644);
  await assert.rejects(unlockStale(state, ui), /findes stadig/);
  await fs.access(file);
});
