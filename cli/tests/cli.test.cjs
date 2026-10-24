const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { Terminal, safeText } = require('../terminal.cjs');
const { Vault, privateDirectory, lock, separateState, dataDirectory } = require('../storage.cjs');
const { browserCommand } = require('../browser.cjs');
const { packageName } = require('../runtime.cjs');
const { Application } = require('../app.cjs');
const { parse, HELP, logout } = require('../aura.cjs');
const { disclose, login, selectModel, unlockConnection } = require('../connections.cjs');
const actions = require('../actions.cjs');
const { Store } = require('../../desktop/core/store.cjs');

class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; this.secrets = []; this.ended = false; }
  protect(value) { this.secrets.push(value); }
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask() { assert.ok(this.answers.length, 'Testen mangler et svar'); return this.answers.shift(); }
  async confirm() { return await this.ask() === 'ja'; }
  async choose() { return await this.ask(); }
  interrupt() {}
}
async function fixture(t, answers = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-test-'));
  const state = await privateDirectory(path.join(root, 'state'));
  const project = path.join(root, 'projekt med mellemrum'); await fs.mkdir(project);
  const ui = new UI(answers), vault = new Vault(state), app = new Application({ directory: state, vault, ui });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, state, project, ui, vault, app };
}
test('argumenter accepterer mapper med mellemrum og afviser skjulte tilladelser og nøgler', () => {
  assert.equal(parse(['chat', '--project', '/tmp/a b']).project, '/tmp/a b');
  assert.equal(parse([]).command, 'chat');
  assert.deepEqual(parse(['skills', 'install', '--tools', 'codex']), { command: 'skills', args: ['install', '--tools', 'codex'] });
  for (const args of [['chat', '--yes'], ['login', '--key', 'secret'], ['doctor', '/tmp'], ['chat', 'a', '--project', 'b']]) assert.throws(() => parse(args));
});
test('ikke-interaktiv start afslås før der oprettes data eller foretages netkald', async t => {
  const { root } = await fixture(t); const directory = path.join(root, 'no-state');
  await assert.rejects(run(process.execPath, [path.join(__dirname, '../aura.cjs'), 'chat'], { env: { ...process.env, AURA_HOME: directory } }), error => /interaktiv terminal/.test(error.stdout));
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});
test('terminaltekst fjerner OSC, CSI, skjulte tegn og kendte eller registrerede nøgler', () => {
  const ui = new Terminal(null, null); ui.protect('min-private-noegle');
  const text = ui.text('\x1b]52;c;SGVtbWVsaWc=\x07\x1b[31mHej\x1b[0m\u202e min-private-noegle sk-or-v1-12345678901234567890');
  assert.equal(text, 'Hej [skjult nøgle] [skjult nøgle]');
});
test('udbydervalg viser fire muligheder; lange kataloger har højst fire valg pr. side', async () => {
  const ui = new Terminal(null, { write() {} }); let answer = '4'; ui.ask = async () => answer;
  assert.equal(await ui.choose('Vælg', Array.from({ length: 4 }, (_, i) => ({ label: String(i), value: i }))), 3);
  let calls = 0; ui.ask = async () => ++calls === 1 ? '4' : '2';
  assert.equal(await ui.choose('Vælg', Array.from({ length: 9 }, (_, i) => ({ label: String(i), value: i }))), 4);
});
test('nøglelager krypterer, genåbner og afviser forkert adgangssætning og ændret ciphertext', async t => {
  const { state, vault, ui } = await fixture(t, ['lang adgangssætning', 'lang adgangssætning']);
  await vault.unlock(ui); const ciphertext = vault.encryptString('syntetisk nøgle');
  assert.equal(vault.decryptString(ciphertext), 'syntetisk nøgle');
  assert.ok(!ciphertext.includes(Buffer.from('syntetisk nøgle'))); vault.close();
  await assert.rejects(vault.unlock(new UI(['forkert adgangssætning'])), /kunne ikke åbnes/);
  assert.equal(vault.key, null);
  await vault.unlock(new UI(['lang adgangssætning'])); assert.equal(vault.decryptString(ciphertext), 'syntetisk nøgle');
  ciphertext[ciphertext.length - 1] ^= 1; assert.throws(() => vault.decryptString(ciphertext));
  assert.doesNotMatch(await fs.readFile(path.join(state, 'vault.json'), 'utf8'), /adgangssætning|syntetisk nøgle/);
});
test('Electrons Linux-fallback afvises selv når isEncryptionAvailable er true', () => {
  let calls = 0;
  const store = new Store('/unused', { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: () => { calls++; }, decryptString: () => { calls++; } }, 'linux');
  assert.throws(() => store.encrypt('syntetisk nøgle'), /ikke tilgængelig/);
  assert.throws(() => store.decrypt({ secret: 'AAAA' }), /mangler sikker/);
  assert.equal(calls, 0);
});
test('Windows-nøglelageret kalder ikke Electrons Linux-metode', () => {
  const store = new Store('/unused', { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => { throw Error('Kun Linux'); }, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, 'win32');
  const secret = store.encrypt('syntetisk'); assert.equal(store.decrypt({ secret }), 'syntetisk');
});
test('separat lager må ikke ligge i projektet; lås beskytter mod to klienter', async t => {
  const { state, project } = await fixture(t);
  separateState(project, state);
  assert.throws(() => separateState(project, path.join(project, 'data')));
  assert.throws(() => separateState(path.join(state, 'projekt'), state));
  const release = await lock(state); await assert.rejects(lock(state), /anden Aura/); release(); (await lock(state))();
  assert.throws(() => dataDirectory({ AURA_HOME: 'relative' }), /absolutte/);
});
test('browserkommando og motorvalg er eksplicitte for macOS, Linux og Windows', () => {
  const url = 'https://example.com/?a=1&b=2';
  assert.deepEqual(browserCommand(url, 'win32', { SystemRoot: 'C:\\Windows' }), ['C:\\Windows\\explorer.exe', [url]]);
  assert.equal(browserCommand(url, 'linux')[0], 'xdg-open');
  assert.equal(browserCommand(url, 'darwin')[0], '/usr/bin/open');
  assert.throws(() => browserCommand('file:///etc/passwd')); assert.throws(() => browserCommand('https://user:pass@example.com'));
  assert.equal(packageName('linux', 'x64', true), 'opencode-linux-x64-baseline-musl');
  assert.equal(packageName('win32', 'arm64'), 'opencode-windows-arm64');
  assert.throws(() => packageName('freebsd', 'x64'));
});
test('eksisterende mappe uden manifest genåbner kladde og skills uden at ændre projektet', async t => {
  const { project, app, ui } = await fixture(t);
  await fs.writeFile(path.join(project, 'bevar.txt'), 'Min fil');
  await app.open(project); await app.bench.saveDraft({ text: 'Lav en kalender', mode: 'plan' });
  await app.bench.skills.save(project, { id: 'faelles-grundregler', content: 'Bevar mine data.' });
  await app.open(project);
  assert.equal(app.bench.workspace.draft, 'Lav en kalender');
  assert.match(ui.output, /kladde/);
  assert.equal((await app.bench.skills.list(project))[0].content, 'Bevar mine data.');
  assert.deepEqual(await fs.readdir(project), ['bevar.txt']);
});
test('datagennemgang kræver et aktivt ja; ukendte forhold og kilde vises', async () => {
  const ui = new UI(['details', 'cancel']);
  assert.equal(await disclose(ui, { recipients: 'Prøveserver', region: 'Ukendt', price: 'Ukendt', source: 'test', accepted: false }), false);
  assert.match(ui.output, /Ukendt/); assert.match(ui.output, /Kilde: test/);
  assert.equal(await disclose(new UI(['send']), { accepted: false }), true);
});
test('CLI viser kun nøgle og lokal AI; Komplai afvises før nøglelager og netkald', async t => {
  const { app, ui } = await fixture(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Prøven må ikke sende netkald'); });
  let unlocked = 0; app.vault.unlock = async () => { unlocked++; };
  const menus = [], answers = ['key', 'other', null];
  ui.choose = async (_question, choices) => { menus.push(choices.map(c => c.value)); return answers.shift(); };
  assert.equal(await login(app), null);
  assert.deepEqual(menus, [['key', 'ollama'], ['anthropic', 'mistral', 'corti', 'alexandra', 'other'], ['openai', 'azure', 'openrouter', 'zen', 'compatible']]);
  await assert.rejects(login(app, 'komplai'), /kun til udgivelse/);
  assert.equal(unlocked, 0);
  assert.equal((await app.bench.store.read()).connections.length, 0);
  assert.doesNotMatch(HELP, /komplai/i);
});
test('CLI afviser en gammel Komplai-forbindelse uden dekryptering eller automatisk modelskift', async t => {
  const { app, ui } = await fixture(t);
  const legacy = { id: 'gammel', kind: 'komplai', name: 'Gammel konto', secret: 'bevaret-krypteret-vaerdi', account: { authMethod: 'token' } };
  const current = { id: 'aktuel', kind: 'compatible', name: 'Egen server' };
  await app.bench.store.update(state => { state.connections = [legacy, current]; });
  let unlocked = 0, catalogs = 0;
  app.vault.unlock = async () => { unlocked++; };
  app.bench.models = async () => { catalogs++; throw Error('Ingen model må vælges automatisk'); };
  await assert.rejects(unlockConnection(app, legacy.id), /kun til udgivelse/);
  await assert.rejects(selectModel(app, legacy.id), /kun til udgivelse/);
  let choices; ui.choose = async (_question, values) => { choices = values.map(v => v.value); return null; };
  assert.equal(await selectModel(app), null);
  assert.deepEqual(choices, ['aktuel', 'new']);
  assert.match(ui.output, /aura logout/);
  await app.bench.store.update(state => { state.connections = [legacy]; });
  assert.equal(await selectModel(app), null);
  assert.deepEqual(choices, ['key', 'ollama']);
  assert.equal(unlocked, 0); assert.equal(catalogs, 0);
  assert.deepEqual((await app.bench.store.read()).connections, [legacy]);
});
test('CLI kan fjerne et gammelt Komplai-token uden at røre Run-adgang eller andre forbindelser', async t => {
  const { app, ui } = await fixture(t);
  const legacy = { id: 'gammel', kind: 'komplai', name: 'Gammel konto', secret: 'bevaret-krypteret-vaerdi', account: { authMethod: 'token' } };
  const current = { id: 'aktuel', kind: 'compatible', name: 'Egen server' };
  const hosting = { komplai: { secret: 'saerskilt-krypteret-run-adgang', organisationId: 'org' } };
  await app.bench.store.update(state => { state.connections = [legacy, current]; state.hosting = hosting; });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Et indsat token må ikke tilbagekaldes automatisk'); });
  app.vault.unlock = async () => { throw Error('Fjernelse af indsat token kræver ikke dekryptering'); };
  let choices; ui.choose = async (_question, values) => { choices = values; return legacy.id; };
  ui.answers = ['nej']; await logout(app);
  assert.deepEqual((await app.bench.store.read()).connections, [legacy, current]);
  assert.match(choices[0].label, /udgået AI-forbindelse/);
  ui.answers = ['ja']; await logout(app);
  const after = await app.bench.store.read();
  assert.deepEqual(after.connections, [current]); assert.deepEqual(after.hosting, hosting);
  assert.match(ui.output, /Forbindelsen er fjernet/);
});
test('nye projekter og browserpreview bruger faktiske filer uden Git-commit', async t => {
  const { root, project, app, ui } = await fixture(t, ['Kalender', 'Vis aktiviteter', 'ja', 'nej']);
  const created = await actions.init(app, project);
  assert.match(created.root, /projekt-kalender$/);
  await assert.rejects(fs.stat(path.join(created.root, '.git')), { code: 'ENOENT' });
  await actions.preview(app);
  const response = await fetch(app.preview.url);
  assert.match(await response.text(), /Kalender/);
  assert.ok(created.root.startsWith(await fs.realpath(root)));
  assert.ok(ui.output.includes('Forhåndsvisning'));
});
test('Historisk forbrug vises i DKK, ikke som nul USD', async t => {
  const { project, app, ui } = await fixture(t);
  await app.open(project);
  app.bench.chat.usageBase = { input: 20, output: 10, calls: 1, otherCalls: 1, cost: 0, otherCosts: { DKK: 0.025 } };
  await app.status(); assert.match(ui.output, /0.025000 DKK/); assert.doesNotMatch(ui.output, /0.000000 USD/);
});
test('versionsgemning og gendannelse gennem CLI-handlinger bruger kun gennemgåede filer', async t => {
  const { project, app, ui } = await fixture(t);
  await run('git', ['init', project]);
  for (const [key, value] of [['user.name', 'Syntetisk prøve'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(project, 'ingen-hooks')]]) await run('git', ['-C', project, 'config', '--local', key, value]);
  await app.open(project);
  await fs.writeFile(path.join(project, 'index.html'), '<h1>Før</h1>');
  await fs.writeFile(path.join(project, '.env'), 'SECRET=syntetisk');
  ui.answers.push('ja', 'Første syntetiske version', 'ja');
  await actions.save(app);
  const first = (await app.bench.git.status(project)).head;
  assert.ok(first); assert.match(ui.output, /Udeladt/);
  assert.doesNotMatch((await run('git', ['-C', project, 'ls-files'])).stdout, /\.env/);
  await fs.writeFile(path.join(project, 'index.html'), '<h1>Efter</h1>');
  ui.answers.push('ja', 'Anden syntetiske version', 'ja'); await actions.save(app);
  const head = (await app.bench.git.status(project)).head;
  assert.notEqual(head, first);
  ui.answers.push(first, 'restore', 'ja'); await actions.versions(app);
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), '<h1>Før</h1>');
  assert.equal((await app.bench.git.status(project)).head, head, 'Gendannelse må ikke omskrive historikken');
  assert.equal(await fs.readFile(path.join(project, '.env'), 'utf8'), 'SECRET=syntetisk');
});
test('udgivelse viser version, destination og adgang og sender intet ved nej', async t => {
  const { app, project, ui } = await fixture(t, ['review', 'vercel', 'static', 'public', 'demo', 'team', 'nej']);
  await app.open(project); let uploads = 0;
  app.deployments = {
    state: async () => ({}),
    review: async (_root, config) => ({ token: 'test', config, head: 'syntetisk-version', target: { name: 'Testprojekt', access: 'Offentlig' } }),
    deploy: async () => { uploads++; }
  };
  await actions.deploy(app); assert.equal(uploads, 0);
  assert.match(ui.output, /syntetisk-version/); assert.match(ui.output, /Offentlig/);
  ui.answers.push('review', 'azure', 'static', 'public', 'demo', 'subscription', 'group', 'ja');
  await actions.deploy(app); assert.equal(uploads, 1);
});
test('stop under katalogkontrol forhindrer en efterfølgende modelafsendelse', async t => {
  const { app, project } = await fixture(t); await app.open(project);
  app.selection = { connectionID: 'test', modelID: 'test' };
  app.bench.connection = async () => ({ kind: 'compatible' });
  let release, started, sent = 0;
  const begun = new Promise(resolve => started = resolve);
  app.bench.prepare = () => { started(); return new Promise(resolve => release = resolve); };
  app.bench.send = async () => { sent++; };
  const task = app.submit('Syntetisk opgave');
  await begun; await app.stop(); release({ accepted: true });
  await assert.rejects(task, { code: 'CANCELLED' }); assert.equal(sent, 0);
});
test('en afvist opgave viser sit eget resultat, også når forrige opgave ændrede filer', async t => {
  const { app, project, ui } = await fixture(t); await app.open(project);
  app.event({ type: 'run.review', chat: app.bench.chatID, files: ['index.html'], status: 'done' });
  app.result(); assert.match(ui.output, /1 ændrede filer/);
  ui.output = '';
  app.event({ type: 'run.review', chat: app.bench.chatID, files: [], status: 'done' });
  app.result(); assert.match(ui.output, /Der blev ikke ændret filer/); assert.doesNotMatch(ui.output, /1 ændrede filer/);
  ui.output = '';
  app.event({ type: 'run.review', chat: app.bench.chatID, files: [], status: 'stopped', unavailable: true });
  app.result(); assert.match(ui.output, /Opgaven er stoppet/); assert.match(ui.output, /kunne ikke opgøres/);
  assert.doesNotMatch(ui.output, /Der blev ikke ændret filer/);
});
module.exports = { UI };

test('CLI sends the same message and context binding that were prepared and disclosed',async t=>{
 const {app,project}=await fixture(t);await app.open(project);app.selection={connectionID:'test',modelID:'test'};app.mode='chat';
 app.bench.connection=async()=>({kind:'compatible'});let prepared,sent;
 app.bench.prepare=async input=>{prepared=input;return {accepted:true,fingerprint:'recipient',contextBinding:'reviewed-context'};};
 app.bench.send=async input=>{sent=input;};await app.submit('Syntetisk besked');
 assert.equal(prepared.text,'Syntetisk besked');assert.deepEqual(sent,{text:prepared.text,fingerprint:'recipient',contextBinding:'reviewed-context'});
});
