// Rettelser i terminalversionen fra gennemgangen af beta 3: fund 42 (CLI-siden), 43, 44, 45, 46, 47, 49, 52 og K4.
// Ingen prøve rører den rigtige nøglering, en AI-udbyder eller netværket uden for denne computer: nøgleringen er falsk,
// og alle servere lytter på 127.0.0.1. Fund 44 på en rigtig Windows-maskine står i f-windows-dpapi.test.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { safeText, Cancelled } = require('../terminal.cjs');
const { Vault, privateDirectory, lock, unlockStale } = require('../storage.cjs');
const { windows, macos } = require('../keychain.cjs');
const { Application } = require('../app.cjs');
const { login, selectModel, unlockConnection } = require('../connections.cjs');
const { logout } = require('../aura.cjs');
const core = require('../../desktop/core/connections.cjs');
const komplai = require('../../desktop/core/komplai.cjs');
const localDiscovery = require('../../desktop/core/local-discovery.cjs');
const { Store } = require('../../desktop/core/store.cjs');

const KEY = 'sk-ant-hemmelig-proeve-0123456789';
const PASSPHRASE = 'en lang adgangssaetning';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Svarene gives af en funktion, så hver prøve kan svare ud fra spørgsmålets tekst.
class UI {
  constructor(answer = () => '') { this.answer = answer; this.output = ''; this.asked = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question, options = {}) { this.asked.push(question); const value = await this.answer(question, options); return value ?? options.fallback ?? ''; }
  async confirm(question) { return /^ja$/.test(await this.ask(question)); }
  async choose(question, choices) { this.asked.push(question); return this.answer(question, { choices }); }
  interrupt() {}
}
function fake() {
  const items = new Map();
  return {
    name: 'prøvenøglering', items,
    set(service, account, secret) { items.set(service + '/' + account, secret); },
    get(service, account) { return items.has(service + '/' + account) ? items.get(service + '/' + account) : null; },
    delete(service, account) { return items.delete(service + '/' + account); }
  };
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-f-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return privateDirectory(path.join(root, 'state'));
}
// Et lager som fra 0.2.0-beta.6: værdierne er krypteret med adgangssætningen (AURA1).
async function legacyStore(state, connections, passphrase = PASSPHRASE) {
  const old = new Vault(state);
  await old.unlock(new UI(() => passphrase));
  const store = new Store(state, old);
  await store.update(s => { s.connections = connections.map(({ plain, ...c }) => ({ ...c, secret: store.encrypt(plain) })); });
  old.close();
}
function keychainApp(t, state, ui, backend = fake()) {
  const app = new Application({ directory: state, vault: new Vault(state, { keychain: backend }), ui });
  t.after(() => app.close());
  return { app, backend };
}
const passphraseAsked = ui => ui.asked.filter(q => /Adgangssætning til nøglelager/.test(q)).length;

// Fund 43
test('fund 43: aura logout tilbagekalder og fjerner en gammel Komplai-browserforbindelse, når nøgleringen bruges', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'k', kind: 'komplai', name: 'Komplai', plain: 'kp_live_proeve_0123456789', account: { organisationId: 'org' } }]);
  const ui = new UI(q => /skal fjernes/.test(q) ? 'k' : /tilbagekald/.test(q) ? 'ja' : /Adgangssætning/.test(q) ? PASSPHRASE : '');
  const { app, backend } = keychainApp(t, state, ui);
  const revoked = [];
  t.mock.method(komplai, 'disconnect', async (_connection, token) => { revoked.push(token); });
  await logout(app);
  assert.deepEqual(revoked, ['kp_live_proeve_0123456789'], 'adgangen er tilbagekaldt med den rigtige nøgle');
  assert.deepEqual((await app.bench.store.read()).connections, []);
  assert.equal(backend.items.size, 0, 'den flyttede nøgle er også slettet fra nøgleringen');
  assert.match(ui.output, /Forbindelsen er fjernet/);
});
test('fund 43: uden adgangssætningen kan den gamle Komplai-forbindelse fjernes fra Aura efter et ja, uden tilbagekaldelse', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'k', kind: 'komplai', name: 'Komplai', plain: 'kp_live_proeve_0123456789', account: {} }]);
  let answer = 'nej';
  const ui = new UI(q => /skal fjernes/.test(q) ? 'k' : /tilbagekald denne/.test(q) ? 'ja' : /Adgangssætning/.test(q) ? 'glemt adgangssaetning' : /alligevel/.test(q) ? answer : '');
  const { app } = keychainApp(t, state, ui);
  t.mock.method(komplai, 'disconnect', async () => { throw new Error('må ikke kaldes uden nøgle'); });
  await logout(app);
  assert.equal((await app.bench.store.read()).connections.length, 1, 'et nej bevarer forbindelsen');
  answer = 'ja';
  await logout(app);
  assert.deepEqual((await app.bench.store.read()).connections, []);
  assert.match(ui.output, /kan ikke læses/);
  assert.match(ui.output, /ikke tilbagekaldt/);
});

// N:F-1: udvejen i aura logout fjernede forbindelsen uden at slette nøgleringens post. Ligger Komplai-tokenet allerede i
// nøgleringen (AURAK1), og afviser nøgleringen læsningen, blev posten med et gyldigt token liggende uden en forbindelse.
async function keychainKomplai(t, ui) {
  const state = await directory(t);
  const { app, backend } = keychainApp(t, state, ui);
  await app.vault.unlock(ui);
  const secret = app.bench.store.encrypt('kp_live_proeve_0123456789');
  await app.bench.store.update(s => { s.connections = [{ id: 'k', kind: 'komplai', name: 'Komplai', secret, account: {} }]; });
  assert.equal(backend.items.size, 1, 'forudsætning: tokenet ligger i nøgleringen');
  return { app, backend };
}
test('N:F-1: kan nøgleringen ikke læses, sletter udvejen i aura logout også nøgleringens post', async t => {
  const ui = new UI(q => /skal fjernes/.test(q) ? 'k' : /tilbagekald denne/.test(q) ? 'ja' : /alligevel/.test(q) ? 'ja' : '');
  const { app, backend } = await keychainKomplai(t, ui);
  backend.get = () => { throw Object.assign(new Error('Nøgleringen afviste adgangen.'), { code: 'DENIED' }); };
  t.mock.method(komplai, 'disconnect', async () => { throw new Error('må ikke kaldes uden nøgle'); });
  await logout(app);
  assert.deepEqual((await app.bench.store.read()).connections, []);
  assert.equal(backend.items.size, 0, 'tokenet ligger ikke tilbage i nøgleringen uden en forbindelse');
  assert.match(ui.output, /ikke tilbagekaldt/);
  assert.match(ui.output, /Nøglen er også slettet fra computerens nøglering\./);
});
test('N:F-1: kan posten heller ikke slettes, siger udvejen det, og forbindelsen er stadig fjernet efter brugerens ja', async t => {
  const ui = new UI(q => /skal fjernes/.test(q) ? 'k' : /tilbagekald denne/.test(q) ? 'ja' : /alligevel/.test(q) ? 'ja' : '');
  const { app, backend } = await keychainKomplai(t, ui);
  const locked = () => { throw Object.assign(new Error('Nøgleringen er låst. Lås den op, og prøv igen.'), { code: 'LOCKED' }); };
  backend.get = locked; backend.delete = locked;
  await logout(app);
  assert.deepEqual((await app.bench.store.read()).connections, []);
  assert.match(ui.output, /Nøglen ligger stadig i computerens nøglering og kunne ikke slettes automatisk\. Nøgleringen er låst/);
});
test('N:F-1: blev en gammel nøgle flyttet, før læsningen fejlede, slettes den flyttede post', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'k', kind: 'komplai', name: 'Komplai', plain: 'kp_live_proeve_0123456789', account: {} }]);
  const ui = new UI(q => /skal fjernes/.test(q) ? 'k' : /tilbagekald denne/.test(q) ? 'ja' : /Adgangssætning/.test(q) ? PASSPHRASE : /alligevel/.test(q) ? 'ja' : '');
  const { app, backend } = keychainApp(t, state, ui);
  // Flytningen lykkes; derefter afviser nøgleringen at læse posten.
  const get = backend.get, migrate = app.vault.migrate.bind(app.vault); let moved = false;
  app.vault.migrate = async (...args) => { const result = await migrate(...args); moved = true; return result; };
  backend.get = (service, account) => { if (moved) throw new Error('Nøgleringen afviste adgangen.'); return get(service, account); };
  t.mock.method(komplai, 'disconnect', async () => { throw new Error('må ikke kaldes uden nøgle'); });
  await logout(app);
  assert.match(ui.output, /flyttet til computerens nøglering/, 'forudsætning: nøglen blev flyttet');
  assert.deepEqual((await app.bench.store.read()).connections, []);
  assert.equal(backend.items.size, 0, 'den flyttede post er slettet');
});

// Fund 46
test('fund 46: en gammel nøgle, der ikke kan flyttes, giver ikke spørgsmål om adgangssætningen ved hver besked', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  const ui = new UI(q => /Adgangssætning/.test(q) ? 'glemt adgangssaetning' : '');
  const { app } = keychainApp(t, state, ui);
  await app.vault.unlock(ui);
  const secret = app.bench.store.encrypt(KEY);
  await app.bench.store.update(s => { s.connections.push({ id: 'b', kind: 'compatible', name: 'Ny', baseURL: 'http://127.0.0.1:9/v1', secret }); });
  for (let besked = 0; besked < 3; besked++) await unlockConnection(app, 'b');
  assert.equal(passphraseAsked(ui), 0, 'den aktuelle forbindelse ligger i nøgleringen; adgangssætningen er ikke nødvendig');
  assert.doesNotMatch(ui.output, /denne ene gang/);
});
test('fund 46: aura login tilbyder at flytte gamle nøgler; Ikke nu huskes resten af kørslen og peger på aura logout', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  const offers = [];
  const ui = new UI((q, options) => {
    if (/Serveradresse/.test(q)) return 'http://127.0.0.1:9/v1';
    if (/navn/.test(q)) return 'Ny server';
    if (/API-nøgle/.test(q)) return 'abcdefghijklmnopqrstuvwxyz123456';
    if (options.choices && /flytte/.test(q)) { offers.push(options.choices.map(c => c.label)); return 'later'; }
    return '';
  });
  const { app } = keychainApp(t, state, ui);
  t.mock.method(core, 'listModels', async () => [{ id: 'm1', name: 'm1' }]);
  await login(app, 'compatible');
  await login(app, 'compatible');
  assert.equal(offers.length, 1, 'tilbuddet gives én gang pr. kørsel');
  assert.deepEqual(offers[0], ['Flyt nu (anbefalet)', 'Ikke nu']);
  assert.equal(passphraseAsked(ui), 0);
  assert.match(ui.output, /aura logout/);
  assert.equal((await app.bench.store.read()).connections.length, 3);
});
test('fund 46: en gammel værdi, som adgangssætningen ikke kan åbne, stopper ikke flytningen af den aktuelle forbindelse', async t => {
  const state = await directory(t), other = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  // En værdi fra et andet nøglelager, fx efter et genskabt vault.json. Den kan aldrig åbnes med denne adgangssætning.
  await legacyStore(other, [{ id: 'x', kind: 'compatible', name: 'Fremmed', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-fremmed-0123456789' }], 'en helt anden adgangssaetning');
  const foreign = JSON.parse(await fs.readFile(path.join(other, 'settings.json'), 'utf8')).connections[0];
  const settings = path.join(state, 'settings.json'), data = JSON.parse(await fs.readFile(settings, 'utf8'));
  data.connections.push(foreign); await fs.writeFile(settings, JSON.stringify(data), { mode: 0o600 });
  const ui = new UI(q => /Adgangssætning/.test(q) ? PASSPHRASE : '');
  const { app } = keychainApp(t, state, ui);
  await unlockConnection(app, 'a');
  assert.equal(app.bench.store.decrypt(await app.bench.connection('a')), 'sk-gammel-0123456789');
  await unlockConnection(app, 'a');
  assert.equal(passphraseAsked(ui), 1, 'spurgt én gang, ikke igen ved næste besked');
  assert.match(ui.output, /1 gammel nøgle kunne ikke åbnes/);
});

// N:F-2: et nej huskes resten af kørslen, og det skal en mislykket eller delvis flytning også. Ellers tilbyder et senere
// /login i samme kørsel flytningen igen og spørger om adgangssætningen igen.
function loginUI(offers, passphrase) {
  return new UI((q, options) => {
    if (/Serveradresse/.test(q)) return 'http://127.0.0.1:9/v1';
    if (/navn/.test(q)) return 'Ny server';
    if (/API-nøgle/.test(q)) return 'abcdefghijklmnopqrstuvwxyz123456';
    if (options.choices && /flytte/.test(q)) { offers.push(q); return 'move'; }
    if (/Adgangssætning/.test(q)) return passphrase;
    return '';
  });
}
test('N:F-2: en mislykket flytning huskes resten af kørslen; næste login spørger ikke igen', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  const offers = [], ui = loginUI(offers, 'forkert adgangssaetning');
  const { app } = keychainApp(t, state, ui);
  t.mock.method(core, 'listModels', async () => [{ id: 'm1', name: 'm1' }]);
  await login(app, 'compatible');
  assert.match(ui.output, /Nøglerne blev ikke flyttet|kunne ikke åbnes/, 'forudsætning: flytningen mislykkedes');
  await login(app, 'compatible');
  assert.equal(offers.length, 1, 'flytningen tilbydes ikke igen i samme kørsel');
  assert.equal(passphraseAsked(ui), 1, 'adgangssætningen spørges ikke igen');
});
test('N:F-2: efter en delvis flytning tilbydes resten ikke igen i samme kørsel', async t => {
  const state = await directory(t), other = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  // En værdi, som adgangssætningen ikke kan åbne (fx efter et genskabt vault.json), bliver tilbage efter flytningen.
  await legacyStore(other, [{ id: 'x', kind: 'compatible', name: 'Fremmed', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-fremmed-0123456789' }], 'en helt anden adgangssaetning');
  const foreign = JSON.parse(await fs.readFile(path.join(other, 'settings.json'), 'utf8')).connections[0];
  const settings = path.join(state, 'settings.json'), data = JSON.parse(await fs.readFile(settings, 'utf8'));
  data.connections.push(foreign); await fs.writeFile(settings, JSON.stringify(data), { mode: 0o600 });
  const offers = [], ui = loginUI(offers, PASSPHRASE);
  const { app } = keychainApp(t, state, ui);
  t.mock.method(core, 'listModels', async () => [{ id: 'm1', name: 'm1' }]);
  await login(app, 'compatible');
  assert.match(ui.output, /1 nøgle er flyttet/); assert.match(ui.output, /1 gammel nøgle kunne ikke åbnes/);
  await login(app, 'compatible');
  assert.equal(offers.length, 1, 'den ulæselige værdi tilbydes ikke igen');
  assert.equal(passphraseAsked(ui), 1);
});

// Fund 49
test('fund 49: Ctrl+C ved adgangssætningen til flytningen afbryder aura login, og intet gemmes', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  const ui = new UI((q, options) => {
    if (/Serveradresse/.test(q)) return 'http://127.0.0.1:9/v1';
    if (/navn/.test(q)) return 'Ny server';
    if (/API-nøgle/.test(q)) return 'abcdefghijklmnopqrstuvwxyz123456';
    if (options.choices && /flytte/.test(q)) return 'move';
    if (/Adgangssætning/.test(q)) throw new Cancelled();
    return '';
  });
  const { app } = keychainApp(t, state, ui);
  let checked = 0;
  t.mock.method(core, 'listModels', async () => { checked++; return [{ id: 'm1', name: 'm1' }]; });
  await assert.rejects(login(app, 'compatible'), { code: 'CANCELLED' });
  assert.equal(checked, 0, 'nøglen sendes ikke til kontrol efter Ctrl+C');
  assert.deepEqual((await app.bench.store.read()).connections.map(c => c.id), ['a']);
});

// Fund 44
test('fund 44: Windows-nøglen går hverken gennem en cmdlet-parameter eller PowerShells pipeline-output', () => {
  const scripts = [];
  const runner = (command, args) => {
    scripts.push(args[args.length - 1]);
    return { status: 0, stdout: /Unprotect|SecureStringToBSTR/.test(args[args.length - 1]) ? Buffer.from(KEY).toString('base64') : '01000000d08c9ddf', stderr: '' };
  };
  const memory = { mkdirSync() {}, writeFileSync() {}, renameSync() {}, readFileSync() { return '01000000d08c9ddf\n'; }, unlinkSync() {} };
  const backend = windows({ runner, directory: path.join(os.tmpdir(), 'aura-f-ukendt'), fsModule: memory });
  backend.set('Aura CLI abcdef123456', 'konto-1', KEY);
  assert.equal(backend.get('Aura CLI abcdef123456', 'konto-1'), KEY);
  assert.equal(scripts.length, 2);
  const allowed = [
    /^\$ErrorActionPreference='Stop'$/, /^Add-Type -AssemblyName System\.Security$/, /^\$[a-z]=[^|]+$/,
    /^\[Array\]::Clear\(\$[a-z],0,\$[a-z]\.Length\)$/, /^\[Console\]::Out\.(?:Write\(.+\)|Flush\(\))$/,
    /^if\(.+\)\{throw '[^']*'\}$/, /^for\(.+\)\{\$[a-z]\[\$i\]=.+\}$/
  ];
  for (const script of scripts) {
    // Kun Add-Type er en cmdlet, og den får ingen hemmelighed. Modullogning (4103) skriver cmdlet-parametre ordret.
    assert.deepEqual([...new Set(script.match(/\b[A-Z][A-Za-z]+-[A-Z][A-Za-z]+\b/g))], ['Add-Type'], script);
    assert.doesNotMatch(script, /SecureString|AsPlainText|Write-Output|Write-Host|Out-/);
    // Hver sætning er en tildeling, en kontrol eller et kald uden returværdi. Kun [Console]::Out skriver, uden om værten og
    // dermed uden om transskription.
    for (const statement of script.split('; ')) assert.ok(allowed.some(pattern => pattern.test(statement)), `sætningen kan give pipeline-output: ${statement}`);
    assert.match(script, /\[Console\]::Out\.Write\(/);
    // Samme filformat som ConvertFrom-SecureString: DPAPI over UTF-16LE, gemt som hex.
    assert.match(script, /\[Text\.Encoding\]::Unicode/);
    assert.match(script, /DataProtectionScope\]::CurrentUser/);
  }
});

// RN:F-3: fejler PowerShell-kaldet på Windows, skrev CLI'en kun «Nøgleringen kunne ikke bruges», og en tester kunne ikke se
// årsagen, fx Constrained Language Mode. PowerShells egen fejltekst står nu som detaljer under beskeden.
const noFile = { mkdirSync() {}, writeFileSync() {}, renameSync() {}, readFileSync() { throw Object.assign(new Error('mangler'), { code: 'ENOENT' }); }, unlinkSync() {} };
test('RN:F-3: kan nøgleringen ikke bruges på Windows, står PowerShells fejltekst under detaljer, og adgangssætningen tager over', async t => {
  const state = await directory(t);
  const stderr = 'Cannot invoke method. Method invocation is supported only on core types in this language mode.\r\nAt line:1 char:39\r\n+ ... ReadToEnd().Trim(); $u=[Text.Encoding]::Unicode.GetBytes(...)\r\n';
  const backend = windows({ runner: () => ({ status: 1, stdout: '', stderr }), directory: state, fsModule: noFile });
  const vault = new Vault(state, { keychain: backend }), ui = new UI(q => /adgangssætning/i.test(q) ? PASSPHRASE : '');
  await vault.unlock(ui); t.after(() => vault.close());
  assert.equal(vault.mode, 'passphrase');
  assert.match(ui.output, /Computerens nøglering kan ikke bruges\. Nøgleringen kunne ikke bruges\./);
  assert.match(ui.output, /^Detaljer: PowerShell svarede: Cannot invoke method\. Method invocation is supported only on core types in this language mode\. At line:1 char:39/m);
});
test('RN:F-3: detaljerne er renset for styretegn og lange værdier og afkortet; uden fejltekst står afslutningskoden', () => {
  const lang = 'QUJD'.repeat(20);
  const fejl = stderr => { try { windows({ runner: () => ({ status: 1, stdout: '', stderr }), directory: os.tmpdir(), fsModule: noFile }).set('Aura CLI abcdef123456', 'konto-1', KEY); } catch (error) { return error; } };
  const renset = fejl(`Fejl \u001b[31m${lang} slut` + ' x'.repeat(400));
  assert.doesNotMatch(renset.details, /\u001b/); assert.ok(!renset.details.includes(lang)); assert.ok(renset.details.length < 460);
  assert.equal(fejl('').details, 'PowerShell svarede: afsluttede med kode 1 uden fejltekst.');
  // macOS og Linux viser ikke værktøjets rå tekst her.
  let mac; try { macos({ runner: () => ({ status: 1, stdout: '', stderr: 'security: SecKeychainItemCreateFromContent: noget' }) }).set('Aura CLI abcdef123456', 'konto-1', KEY); } catch (error) { mac = error; }
  assert.equal(mac.details, undefined);
});

// Fund 47
function writeLock(state, pid) { return fs.writeFile(path.join(state, 'cli.lock'), JSON.stringify({ pid, token: 'gammel' }), { mode: 0o600 }); }
test('fund 47: en lås, hvis nummer nu bruges af et andet program end Node, overtages automatisk', { skip: process.platform === 'win32' }, async t => {
  const state = await directory(t);
  const child = spawn('sleep', ['30']); t.after(() => child.kill());
  await once(child, 'spawn');
  await writeLock(state, child.pid);
  const release = await lock(state);
  assert.equal(JSON.parse(await fs.readFile(path.join(state, 'cli.lock'), 'utf8')).pid, process.pid, 'låsen er overtaget');
  release();
});
test('fund 47: en lås fra en proces under en anden bruger giver ingen rå «kill EPERM», og aura unlock kan fjerne den', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  // pid 1 (launchd eller init) kører som root. kill(1, 0) giver EPERM for en almindelig bruger.
  const state = await directory(t);
  await writeLock(state, 1);
  const ui = new UI(q => /Fjern/.test(q) ? 'ja' : '');
  await unlockStale(state, ui);
  await assert.rejects(fs.access(path.join(state, 'cli.lock')), { code: 'ENOENT' });
  assert.match(ui.asked[0], /\b1\b/, 'pid står i spørgsmålet');
  assert.doesNotMatch(ui.output + ui.asked.join('\n'), /EPERM/);
});
test('fund 47: programnavnet læses fra tasklist på Windows og ps andre steder; ukendt navn regnes for en mulig Aura', () => {
  const { processName } = require('../storage.cjs');
  const tasklist = stdout => () => ({ status: 0, stdout, stderr: '' });
  assert.equal(processName(4242, { platform: 'win32', runner: tasklist('"RuntimeBroker.exe","4242","Console","1","12.345 K"\r\n') }), 'RuntimeBroker.exe');
  assert.equal(processName(4242, { platform: 'win32', runner: tasklist('"node.exe","4242","Console","1","45.672 K"\r\n') }), 'node.exe');
  // Et andet nummer i svaret, eller Windows' lokaliserede besked om, at intet passer, giver intet navn.
  assert.equal(processName(4242, { platform: 'win32', runner: tasklist('"node.exe","42420","Console","1","45.672 K"\r\n') }), null);
  assert.equal(processName(4242, { platform: 'win32', runner: tasklist('OPLYSNINGER: Der kører ingen opgaver, der svarer til de angivne kriterier.\r\n') }), null);
  assert.equal(processName(4242, { platform: 'darwin', runner: () => ({ status: 0, stdout: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper\n' }) }), 'Google Chrome Helper');
  assert.equal(processName(4242, { platform: 'linux', runner: () => ({ status: 1, stdout: '' }) }), null);
  assert.equal(processName(4242, { platform: 'linux', runner: () => { throw new Error('ps mangler'); } }), null);
});
test('fund 47: en levende Node-proces kan være Aura; den beholder låsen, og aura unlock viser dens nummer', async t => {
  const state = await directory(t);
  await writeLock(state, process.pid);
  await assert.rejects(lock(state), /anden Aura-terminal/);
  await assert.rejects(unlockStale(state, new UI(() => 'ja')), error => error.message.includes(String(process.pid)) && /findes stadig/.test(error.message));
  await fs.access(path.join(state, 'cli.lock'));
});

// K4: Ctrl+C under modelvalg stopper selve netkaldet. Serveren svarer aldrig og lukker intet selv. Kun forbindelser, der bar
// en forespørgsel, tælles; undici kan åbne en tom forbindelse bagefter, som intet sender og ikke holder processen i live.
async function hangingServer(t) {
  const sockets = [];
  const server = http.createServer(() => {});
  server.on('connection', socket => { const entry = { bytes: 0, closedAt: null }; sockets.push(entry); socket.on('data', chunk => { entry.bytes += chunk.length; }); socket.on('close', () => { entry.closedAt = Date.now(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { port: server.address().port, requests: () => sockets.filter(s => s.bytes > 0) };
}
test('K4: Ctrl+C under modelvalg (/model) afbryder selve katalogkaldet, ikke kun ventetiden', async t => {
  const state = await directory(t), server = await hangingServer(t);
  const ui = new UI();
  const app = new Application({ directory: state, vault: new Vault(state), ui });
  t.after(() => app.close());
  await app.bench.store.update(s => { s.connections = [{ id: 'c', kind: 'compatible', name: 'Hængende', baseURL: `http://127.0.0.1:${server.port}/v1` }]; });
  const running = selectModel(app, 'c');
  const result = assert.rejects(running, { code: 'CANCELLED' });
  while (!server.requests().length) await pause(10);
  await pause(100);
  const stopped = Date.now();
  await app.stop();
  await result;
  while (Date.now() - stopped < 3000 && server.requests().some(s => s.closedAt === null)) await pause(20);
  assert.ok(server.requests().every(s => s.closedAt !== null && s.closedAt - stopped < 2000), 'forbindelsen med forespørgslen er lukket af Aura, før tidsgrænsen på 15 sekunder');
  assert.equal(app.pendingLogin, null);
});

// Fund 42, CLI-siden
async function ollamaServer(t, { tags = true } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (tags && req.method === 'GET' && req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] })); return; }
    if (tags && req.method === 'GET' && req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'qwen3:8b' }] })); return; }
    res.statusCode = 404; res.end('404 page not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { port: server.address().port, requests };
}
function ollamaApp(t, state, address) {
  const ui = new UI(q => /Serveradresse/.test(q) ? address : /API-nøgle/.test(q) ? '' : undefined);
  const app = new Application({ directory: state, vault: new Vault(state), ui });
  t.after(() => app.close());
  // Den rigtige Ollama på standardadressen må ikke spørges i prøven.
  t.mock.method(localDiscovery, 'discoverLocalModels', async () => ({ status: 'unavailable', models: [] }));
  return { app, ui };
}
test('fund 42: aura login med Ollama gemmer serverens rod og finder modellerne, uanset om adressen skrives med /v1', async t => {
  const { port, requests } = await ollamaServer(t);
  for (const address of [`127.0.0.1:${port}`, `http://127.0.0.1:${port}`, `http://127.0.0.1:${port}/v1`]) {
    const state = await directory(t), { app, ui } = ollamaApp(t, state, address);
    requests.length = 0;
    const id = await login(app, 'ollama');
    const saved = (await app.bench.store.read()).connections.find(c => c.id === id);
    assert.equal(saved.baseURL, `http://127.0.0.1:${port}`, address);
    assert.deepEqual(requests, ['GET /api/tags'], address);
    // Ental og flertal følger antallet (N:F-4).
    assert.match(ui.output, /1 model fundet\. /); assert.doesNotMatch(ui.output, /\b1 modeller\b/);
    assert.match(ui.output, /Kontrollerer forbindelsen/, 'uden nøgle kontrolleres forbindelsen, ikke en nøgle');
  }
});
// N:F-4: opdagelsen af Ollama og kontrollen skriver «1 model», ikke «1 modeller».
test('N:F-4: én model i Ollama hedder «1 model fundet», også i opdagelsen', async t => {
  const { port } = await ollamaServer(t);
  const state = await directory(t), { app, ui } = ollamaApp(t, state, `http://127.0.0.1:${port}`);
  t.mock.method(localDiscovery, 'discoverLocalModels', async () => ({ status: 'found', models: [{ name: 'qwen3:8b' }] }));
  await login(app, 'ollama');
  assert.match(ui.output, /^1 model fundet i Ollama på denne computer\.$/m);
  assert.match(ui.output, /^1 model fundet\. Det beviser ikke/m);
  assert.doesNotMatch(ui.output, /\b1 modeller\b/);
});
test('fund 42: svarer adressen ikke som Ollama, får brugeren ikke rådet om at kopiere en nøgle, som Ollama ikke har', async t => {
  const { port } = await ollamaServer(t, { tags: false });
  const state = await directory(t), { app, ui } = ollamaApp(t, state, `http://127.0.0.1:${port}`);
  await assert.rejects(login(app, 'ollama'), /HTTP 404/);
  assert.equal((await app.bench.store.read()).connections.length, 0);
  assert.doesNotMatch(ui.output, /kopiér nøglen/);
  assert.match(ui.output, /kontrollér serveradressen/);
});

test('fund 42: rådet efter en mislykket kontrol følger fejlen; kun en afvist nøgle giver rådet om at kopiere nøglen', async t => {
  const failure = (message, reason, details) => Object.assign(new Error(message), { reason, details });
  const cases = [
    [failure('Serveren afviste adgangen.', 'rejected', 'HTTP 401: invalid api key'), /kopiér nøglen igen/],
    [failure('Serveren svarede med HTTP 404.', 'rejected', 'HTTP 404: 404 page not found'), /kontrollér serveradressen/],
    [new Error('Serveren returnerede ikke gyldige modeloplysninger.'), /kontrollér serveradressen/],
    [failure('Serveren svarede med HTTP 503.', 'server', 'HTTP 503'), null],
    [failure('Kontoen har ikke kredit eller kvote tilbage hos udbyderen.', 'rejected', 'HTTP 402: payment required'), null]
  ];
  for (const [error, expected] of cases) {
    const state = await directory(t);
    const ui = new UI(q => /Serveradresse/.test(q) ? 'http://127.0.0.1:9/v1' : /navn/.test(q) ? 'Min server' : /API-nøgle/.test(q) ? 'abcdefghijklmnopqrstuvwxyz123456' : '');
    const app = new Application({ directory: state, vault: new Vault(state), ui });
    t.after(() => app.close());
    app.vault.unlock = async () => {};
    t.mock.method(core, 'listModels', async () => { throw error; });
    await assert.rejects(login(app, 'compatible'));
    if (expected) assert.match(ui.output, expected, error.message);
    if (!expected || !/kopiér/.test(expected.source)) assert.doesNotMatch(ui.output, /kopiér nøglen/, error.message);
    t.mock.restoreAll();
  }
});

// Fund 52
test('fund 52: udgivelseskontrollen afviser platformsguider med en anden OpenCode-version end den, pakken låser', () => {
  const { lockedOpenCode, guideProblem } = require('../../scripts/cli-release-contract.cjs');
  assert.equal(lockedOpenCode({ optionalDependencies: { 'opencode-darwin-arm64': '1.19.5', 'opencode-linux-x64-baseline': '1.19.5', andet: '2.0.0' } }), '1.19.5');
  assert.throws(() => lockedOpenCode({ optionalDependencies: { 'opencode-darwin-arm64': '1.19.5', 'opencode-linux-x64-baseline': '1.18.33' } }), /samme OpenCode-version/);
  assert.throws(() => lockedOpenCode({}), /OpenCode/);
  const tarball = 'aura-harness-0.3.0-beta.1.tgz';
  const guide = version => `npm install ./${tarball}\n\`doctor\` skal finde Node, Git og OpenCode ${version}. Stop ved fejl.`;
  assert.equal(guideProblem('MACOS.md', guide('1.19.5'), { tarball, opencode: '1.19.5' }), null);
  assert.match(guideProblem('MACOS.md', guide('1.18.33'), { tarball, opencode: '1.19.5' }), /cli\/MACOS\.md.*OpenCode 1\.19\.5/);
  assert.match(guideProblem('LINUX.md', `npm install ./${tarball}`, { tarball, opencode: '1.19.5' }), /OpenCode 1\.19\.5/);
  assert.match(guideProblem('WINDOWS.md', guide('1.19.5').replace(tarball, 'aura-harness-0.2.0-beta.6.tgz'), { tarball, opencode: '1.19.5' }), /filnavnet/);
  // En lokal prøvepakke kontrollerer kun filnavnet, så den kan bygges, før guiderne er skrevet om til næste udgivelse.
  assert.equal(guideProblem('MACOS.md', guide('1.18.33'), { tarball, opencode: null }), null);
});
test('fund 52: platformsguiderne passer til den CLI, de gælder for: den udgivne ved tagget, ellers den der klargøres', async t => {
  const { lockedOpenCode, guideProblem, names } = require('../../scripts/cli-release-contract.cjs');
  const repo = path.join(__dirname, '..', '..');
  const git = args => require('node:child_process').execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let tags = '';
  try { tags = git(['tag', '-l', 'cli-v*']); } catch { /* ingen Git */ }
  if (!tags) { t.skip('Ingen CLI-tags i denne kloning.'); return; }
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')), tag = `cli-v${pkg.version}`;
  // Er versionen udgivet, gælder guiderne den pakke, testerne henter, også når grenen har nyere kode (fx en nyere OpenCode).
  const released = tags.split('\n').includes(tag);
  const opencode = lockedOpenCode(released ? JSON.parse(git(['show', `${tag}:package.json`])) : pkg);
  for (const name of ['WINDOWS.md', 'LINUX.md', 'MACOS.md']) {
    const problem = guideProblem(name, await fs.readFile(path.join(__dirname, '..', name), 'utf8'), { tarball: names(pkg.version)[0], opencode });
    assert.equal(problem, null, `${released ? `udgivet som ${tag}` : 'klargøres'}: ${problem}`);
  }
});

// Fund 45: teksterne til næste CLI-udgivelse ligger i et udkast, indtil versionen løftes. Glemmes udkastet ved løftet, sender
// udgivelsen guider og noter om adgangssætningslageret med ud, selv om CLI'en bruger nøgleringen.
const DRAFT = path.join('docs', 'releases', 'cli-naeste-udkast.md');
const readOptional = file => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
// En kopi af udgivelsesscripts i en midlertidig rod med sin egen package.json og eventuelt et udkast.
async function releaseRoot(t, { version, draft }) {
  const repo = path.join(__dirname, '..', '..'), root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-f45-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  for (const name of ['build-cli-release.cjs', 'cli-release-contract.cjs', 'release-contract.cjs']) await fs.copyFile(path.join(repo, 'scripts', name), path.join(root, 'scripts', name));
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ ...pkg, version }));
  if (draft !== undefined) { await fs.mkdir(path.join(root, 'docs', 'releases'), { recursive: true }); await fs.writeFile(path.join(root, DRAFT), draft); }
  return root;
}
// Samme kontrol, som udgivelsens build- og publish-job kører (build kalder den til sidst, publish med --check).
function releaseCheck(root, ...flags) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-cli-release.cjs'), path.join(root, 'udgivelse'), '--check', ...flags], { cwd: root, encoding: 'utf8', timeout: 30000 });
  return `${result.stdout}${result.stderr}`;
}
test('fund 45: udgivelseskontrollen afviser en løftet version, mens udkastet til næste udgivelse stadig findes', async t => {
  const draft = '# Udkast\n\n**Udkast. Gælder ikke den udgivne CLI 0.2.0-beta.6.** Teksterne skal ind i guiderne ved versionsløftet.\n';
  const forgotten = await releaseRoot(t, { version: '0.3.0-beta.1', draft });
  assert.match(releaseCheck(forgotten), /cli-naeste-udkast\.md findes stadig/);
  // En lokal prøvepakke må bygges, før teksterne er flyttet.
  assert.doesNotMatch(releaseCheck(forgotten, '--local'), /udkast/);
  // Uden udkast, eller før versionen løftes, siger kontrollen intet om udkastet.
  assert.doesNotMatch(releaseCheck(await releaseRoot(t, { version: '0.3.0-beta.1' })), /udkast/);
  assert.doesNotMatch(releaseCheck(await releaseRoot(t, { version: '0.2.0-beta.6', draft })), /udkast/);
});
test('fund 45: udkastet findes kun, så længe package.json har den udgivne version, som guiderne og noterne beskriver', async () => {
  const { draftProblem } = require('../../scripts/cli-release-contract.cjs');
  const repo = path.join(__dirname, '..', '..');
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  // Fejler her efter et versionsløft: flyt udkastets tekster ind i guiderne og noterne, og slet udkastet i samme commit.
  assert.equal(draftProblem(await readOptional(path.join(repo, DRAFT)), pkg.version), null);
  assert.equal(draftProblem(null, '0.3.0-beta.1'), null);
  assert.match(draftProblem('**Udkast. Gælder ikke den udgivne CLI 0.2.0-beta.6.**', '0.3.0-beta.1'), /findes stadig/);
  // Uden den udgivne version kan kontrollen ikke afgøre noget, og den siger det.
  assert.match(draftProblem('# Udkast uden version', '0.2.0-beta.6'), /skal nævne/);
});
test('fund 45: ingen vejledning lover, at den gamle adgangssætning kun bruges én gang; efter en forkert spørger CLI\'en igen', async t => {
  const state = await directory(t);
  await legacyStore(state, [{ id: 'a', kind: 'compatible', name: 'Gammel', baseURL: 'http://127.0.0.1:9/v1', plain: 'sk-gammel-0123456789' }]);
  const answers = ['forkert adgangssaetning', PASSPHRASE];
  const ui = new UI(q => /Adgangssætning/.test(q) ? answers.shift() : '');
  const { app } = keychainApp(t, state, ui);
  await assert.rejects(unlockConnection(app, 'a'), /Kontrollér adgangssætningen/);
  await unlockConnection(app, 'a');
  assert.equal(passphraseAsked(ui), 2, 'flytningen kan kræve adgangssætningen mere end én gang');
  const repo = path.join(__dirname, '..', '..');
  for (const file of [path.join('cli', 'README.md'), path.join('cli', 'MACOS.md'), path.join('cli', 'WINDOWS.md'), path.join('cli', 'LINUX.md'), path.join('docs', 'releases', 'cli-beta.md'), DRAFT]) {
    const text = await readOptional(path.join(repo, file)) ?? '';
    const promises = text.split(/(?<=[.!?])\s+|\n/).filter(sentence => /adgangssætning/i.test(sentence) && /én gang|ene gang/i.test(sentence));
    assert.deepEqual(promises, [], file);
  }
});
