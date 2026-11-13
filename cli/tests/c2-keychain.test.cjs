// Spor C: terminalens nøgler gemmes i computerens nøglering. Ingen prøve her rører den rigtige nøglering:
// der bruges en falsk backend i hukommelsen eller falske programmer (security, secret-tool) i en midlertidig mappe.
// Undtagelsen er den ene prøve bag AURA_REAL_KEYCHAIN=1, som kun bruger et unikt midlertidigt tjenestenavn og rydder det.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const sync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeText } = require('../terminal.cjs');
const { Vault, privateDirectory } = require('../storage.cjs');
const { createKeychain, serviceName, KeychainError, macos, linux, windows } = require('../keychain.cjs');
const { Application } = require('../app.cjs');
const { unlockConnection } = require('../connections.cjs');
const { logout } = require('../aura.cjs');

const KEY = 'sk-ant-hemmelig-proeve-0123456789';
class UI {
  constructor(answers = []) { this.answers = answers; this.output = ''; this.asked = []; }
  protect() {}
  write(value) { this.output += safeText(value); }
  line(value = '') { this.write(value + '\n'); }
  async ask(question) { this.asked.push(question); return this.answers.length ? this.answers.shift() : ''; }
  async confirm(question) { this.asked.push(question); return await this.ask(question) === 'ja'; }
  async choose(question, choices) { this.asked.push(question); return this.answers.shift(); }
  interrupt() {}
}
// Falsk nøglering i hukommelsen med samme grænseflade som de rigtige backends.
function fake(options = {}) {
  const items = new Map(), calls = [];
  const backend = {
    name: 'prøvenøglering', items, calls, options,
    set(service, account, secret) { calls.push(['set', service, account]); if (options.setError) throw options.setError; items.set(service + '/' + account, options.corrupt ? secret + 'x' : secret); },
    get(service, account) { calls.push(['get', service, account]); if (options.getError) throw options.getError; return items.has(service + '/' + account) ? items.get(service + '/' + account) : null; },
    delete(service, account) { calls.push(['delete', service, account]); if (options.deleteError) throw options.deleteError; return items.delete(service + '/' + account); }
  };
  return backend;
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return privateDirectory(path.join(root, 'state'));
}
function storeOf(vault, state) { return new (require('../../desktop/core/store.cjs').Store)(state, vault); }

// Valg 2: nøglen står aldrig i et kommandolinjeargument.
test('c2-1: ingen backend sætter nøglen i argv; den går på stdin som base64', () => {
  const log = [];
  const runner = (command, args, options = {}) => {
    log.push({ command, args, input: options.input, env: options.env });
    if (args.includes('find-generic-password') || args.includes('lookup')) return { status: 0, stdout: Buffer.from(KEY).toString('base64') + '\n', stderr: '' };
    return { status: 0, stdout: Buffer.from(KEY).toString('base64'), stderr: '' };
  };
  const dir = path.join(os.tmpdir(), 'aura-c2-ukendt');
  const memory = { mkdirSync() {}, writeFileSync() {}, renameSync() {}, readFileSync() { return 'blob'; }, unlinkSync() {} };
  for (const backend of [macos({ runner }), linux({ runner }), windows({ runner, directory: dir, fsModule: memory })]) {
    log.length = 0;
    backend.set('Aura CLI abcdef123456', 'konto-1', KEY);
    assert.equal(backend.get('Aura CLI abcdef123456', 'konto-1'), KEY);
    backend.delete('Aura CLI abcdef123456', 'konto-1');
    assert.ok(log.length >= 2, backend.name);
    for (const call of log) {
      const argv = [call.command, ...call.args].join('\u0000');
      for (const variant of [KEY, Buffer.from(KEY).toString('base64'), Buffer.from(KEY).toString('hex'), encodeURIComponent(KEY)]) assert.ok(!argv.includes(variant), `${backend.name}: nøglen står i argv for ${call.command}`);
      assert.equal(call.env, undefined, 'nøglen sendes ikke i et miljø');
    }
    assert.ok(log.some(call => call.input && call.input.includes(Buffer.from(KEY).toString('base64'))), `${backend.name}: nøglen sendes på stdin`);
  }
});

// Samme kontrol mod rigtige processer: falske programmer skriver deres egen argv og stdin til en fil.
async function fakeTools(t) {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  const log = path.join(bin, 'log.txt'), data = path.join(bin, 'store.txt');
  // Programmet gemmer stdin og svarer med den gemte værdi, så en hel runde set, get og delete kan følges.
  const script = (name, body) => sync.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf 'ARGV:' >> "${log}"; for a in "$@"; do printf '[%s]' "$a" >> "${log}"; done; printf '\\n' >> "${log}"\n${body}\n`, { mode: 0o755 });
  script('security', `if [ "$1" = "-i" ]; then cat > "${data}.in"; sed -n 's/.*-w "\\([^"]*\\)".*/\\1/p' "${data}.in" > "${data}"; printf 'STDIN:' >> "${log}"; cat "${data}.in" >> "${log}"; printf '\\n' >> "${log}"; exit 0; fi\nif [ "$1" = "find-generic-password" ]; then [ -s "${data}" ] && cat "${data}" && exit 0; exit 44; fi\nif [ "$1" = "delete-generic-password" ]; then rm -f "${data}"; exit 0; fi`);
  script('secret-tool', `if [ "$1" = "store" ]; then cat > "${data}"; printf 'STDIN:' >> "${log}"; cat "${data}" >> "${log}"; printf '\\n' >> "${log}"; exit 0; fi\nif [ "$1" = "lookup" ]; then [ -s "${data}" ] && cat "${data}" && exit 0; exit 1; fi\nif [ "$1" = "clear" ]; then rm -f "${data}"; exit 0; fi`);
  const saved = process.env.PATH; process.env.PATH = bin + path.delimiter + saved;
  t.after(() => { process.env.PATH = saved; });
  return () => sync.readFileSync(log, 'utf8');
}
for (const kind of ['macos', 'linux']) {
  test(`c2-2: ${kind}: den rigtige processens argv indeholder aldrig nøglen, men stdin gør`, { skip: process.platform === 'win32' }, async t => {
    const read = await fakeTools(t);
    const backend = kind === 'macos' ? macos() : linux();
    backend.set('Aura CLI abcdef123456', 'konto-1', KEY);
    assert.equal(backend.get('Aura CLI abcdef123456', 'konto-1'), KEY);
    backend.delete('Aura CLI abcdef123456', 'konto-1');
    assert.equal(backend.get('Aura CLI abcdef123456', 'konto-1'), null);
    const text = read(), base64 = Buffer.from(KEY).toString('base64');
    const argvLines = text.split('\n').filter(line => line.startsWith('ARGV:'));
    assert.ok(argvLines.length >= 4);
    for (const line of argvLines) { assert.ok(!line.includes(KEY) && !line.includes(base64), `argv afslører nøglen: ${line}`); }
    assert.ok(text.includes('STDIN:') && text.includes(base64), 'nøglen nåede programmet gennem stdin');
  });
}
test('c2-2: et navn med citationstegn eller linjeskift afvises, før noget køres', () => {
  const backend = macos({ runner() { throw new Error('må ikke køres'); } });
  assert.throws(() => backend.set('Aura CLI x', 'a" -w "angreb', KEY), /Ugyldigt navn/);
  assert.throws(() => backend.get('Aura\nCLI', 'a'), /Ugyldigt navn/);
});

// Fejl fra nøgleringen oversættes til almindeligt dansk.
test('c2-3: låst, afvist og manglende værktøj får hver sin forklaring', () => {
  const cases = [
    [{ status: 1, stdout: '', stderr: 'security: SecKeychainItemCreateFromContent: User interaction is not allowed. (-25308)' }, /låst/],
    [{ status: 1, stdout: '', stderr: 'User canceled the operation. (-128)' }, /afviste/],
    [{ status: null, stdout: '', stderr: '', error: Object.assign(new Error('x'), { code: 'ENOENT' }) }, /findes ikke/]
  ];
  for (const [result, expected] of cases) {
    assert.throws(() => macos({ runner: () => result }).set('Aura CLI x', 'a', KEY), error => error instanceof KeychainError && expected.test(error.message));
  }
  assert.throws(() => linux({ runner: () => ({ status: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }) }).get('Aura CLI x', 'a'), /nøgletjeneste/);
});

// Vault i nøgleringstilstand
test('c2-4: med en nøglering spørges der ikke om adgangssætning, og nøglen står ikke i settings.json', async t => {
  const state = await directory(t), backend = fake(), ui = new UI(), vault = new Vault(state, { keychain: backend });
  await vault.unlock(ui);
  assert.deepEqual(ui.asked, [], 'ingen adgangssætning');
  assert.match(ui.output, /computerens nøglering/);
  const store = storeOf(vault, state);
  const secret = store.encrypt(KEY);
  await store.update(s => { s.connections = [{ id: 'a', kind: 'compatible', name: 'x', secret }]; });
  assert.ok(![...backend.items.keys()].some(name => !name.startsWith(serviceName(state) + '/')), 'posten bærer datamappens navn');
  assert.ok([...backend.items.values()].includes(KEY));
  assert.ok(!(await fs.readFile(path.join(state, 'settings.json'), 'utf8')).includes(KEY));
  assert.ok(!Buffer.from(secret, 'base64').includes(Buffer.from(KEY)));
  assert.equal(store.decrypt({ secret }), KEY);
  await assert.rejects(fs.access(path.join(state, 'vault.json')), 'ingen vault.json oprettes');
});
test('c2-4: kontrolkrypteringen "kontrol" efterlader ingen post', async t => {
  const state = await directory(t), backend = fake(), vault = new Vault(state, { keychain: backend });
  await vault.unlock(new UI());
  const before = backend.items.size;
  const probe = storeOf(vault, state).encrypt('kontrol');
  assert.equal(backend.items.size, before);
  assert.equal(storeOf(vault, state).decrypt({ secret: probe }), 'kontrol');
});
test('c2-4: en nøgle, som nøgleringen ikke giver tilbage uændret, gemmes ikke, og posten ryddes', async t => {
  const state = await directory(t), backend = fake(), vault = new Vault(state, { keychain: backend });
  await vault.unlock(new UI());
  backend.corrupt = true; const bad = fake({ corrupt: true }); vault.keychain = bad;
  assert.throws(() => vault.encryptString(KEY), /ikke gemt i computerens nøglering/);
  assert.equal(bad.items.size, 0);
});

// Reserve: ingen stille nedgradering
test('c2-5: en låst nøglering fører til adgangssætningen med besked, aldrig stille', async t => {
  const state = await directory(t), locked = new KeychainError('LOCKED', 'Nøgleringen er låst. Lås den op, og prøv igen.');
  const backend = fake({ setError: locked }), ui = new UI(['en lang adgangssaetning', 'en lang adgangssaetning']);
  const vault = new Vault(state, { keychain: backend });
  await vault.unlock(ui);
  assert.match(ui.output, /Nøgleringen er låst/);
  assert.match(ui.output, /adgangssætning, som du selv vælger/);
  assert.equal(vault.mode, 'passphrase');
  assert.equal(vault.encryptString(KEY).subarray(0, 5).toString(), 'AURA1');
  assert.equal(backend.items.size, 0);
});
test('c2-5: en nøgle i nøgleringen kan ikke læses, når nøgleringen er låst: forklaringen siger hvorfor', async t => {
  const state = await directory(t), backend = fake(), vault = new Vault(state, { keychain: backend });
  await vault.unlock(new UI());
  const secret = storeOf(vault, state).encrypt(KEY);
  backend.options.getError = new KeychainError('LOCKED', 'Nøgleringen er låst. Lås den op, og prøv igen.');
  assert.throws(() => vault.verify(secret), /ikke læses nu\. Nøgleringen er låst/);
  backend.options.getError = null; backend.items.clear();
  assert.throws(() => vault.verify(secret), /findes ikke længere/);
});
test('c2-5: uden nøglering (som før) bruges kun adgangssætningen, og den rigtige nøglering røres aldrig af en almindelig Vault', async t => {
  const state = await directory(t), vault = new Vault(state);
  assert.equal(vault.keychain, null); assert.equal(vault.mode, 'passphrase');
  await vault.unlock(new UI(['en lang adgangssaetning', 'en lang adgangssaetning']));
  assert.equal(vault.encryptString('x').subarray(0, 5).toString(), 'AURA1');
});

// Flytning af gamle forbindelser
async function legacyState(t) {
  const state = await directory(t), old = new Vault(state);
  await old.unlock(new UI(['en lang adgangssaetning', 'en lang adgangssaetning']));
  const store = storeOf(old, state);
  const first = store.encrypt('sk-gammel-1'), second = store.encrypt('ghp-gammel-2');
  await store.update(s => { s.connections = [{ id: 'a', kind: 'compatible', name: 'x', secret: first }]; s.hosting = { github: { login: 'bj', secret: second } }; });
  old.close();
  return { state, first, second };
}
test('c2-6: gamle forbindelser flyttes med adgangssætningen én gang, og den gamle kopi forsvinder først efter tilbagelæsning', async t => {
  const { state, first, second } = await legacyState(t), backend = fake(), vault = new Vault(state, { keychain: backend }), ui = new UI(['en lang adgangssaetning']);
  await vault.unlock(ui);
  const store = storeOf(vault, state);
  assert.equal(await vault.migrate(store, ui), 2);
  assert.deepEqual(ui.asked, ['Adgangssætning til nøglelager'], 'adgangssætningen spørges én gang');
  const after = await store.read();
  assert.notEqual(after.connections[0].secret, first); assert.notEqual(after.hosting.github.secret, second);
  assert.equal(store.decrypt(after.connections[0]), 'sk-gammel-1'); assert.equal(store.decrypt(after.hosting.github), 'ghp-gammel-2');
  assert.deepEqual(new Set(backend.items.values()), new Set(['sk-gammel-1', 'ghp-gammel-2']));
  const order = backend.calls.map(c => c[0]);
  assert.ok(order.indexOf('get') > order.indexOf('set'), 'læst tilbage efter skrivning');
  assert.equal(vault.key, null, 'adgangssætningens nøgle glemmes igen');
  assert.equal(await vault.migrate(store, new UI()), 0, 'anden gang er der intet at flytte');
  assert.match(ui.output, /2 nøgler er flyttet/);
});
test('c2-6: stemmer tilbagelæsningen ikke, bevares den gamle kopi uændret, og de nye poster ryddes', async t => {
  const { state } = await legacyState(t), backend = fake({ corrupt: true }), vault = new Vault(state, { keychain: backend }), ui = new UI(['en lang adgangssaetning']);
  vault.mode = 'keychain';
  const store = storeOf(vault, state), before = await fs.readFile(path.join(state, 'settings.json'), 'utf8');
  await assert.rejects(vault.migrate(store, ui), /De gamle er bevaret uændret/);
  assert.equal(await fs.readFile(path.join(state, 'settings.json'), 'utf8'), before);
  assert.equal(backend.items.size, 0);
});
test('c2-6: en forkert adgangssætning flytter intet og efterlader ingen poster', async t => {
  const { state } = await legacyState(t), backend = fake(), vault = new Vault(state, { keychain: backend }), ui = new UI(['forkert adgangssaetning']);
  vault.mode = 'keychain';
  const before = await fs.readFile(path.join(state, 'settings.json'), 'utf8');
  await assert.rejects(vault.migrate(storeOf(vault, state), ui), /Nøglelageret kunne ikke åbnes/);
  assert.equal(await fs.readFile(path.join(state, 'settings.json'), 'utf8'), before);
  assert.equal(backend.items.size, 0);
});
test('c2-6: unlockConnection flytter en gammel forbindelse og giver nøglen', async t => {
  const { state } = await legacyState(t), backend = fake(), ui = new UI(['en lang adgangssaetning']);
  const app = new Application({ directory: state, vault: new Vault(state, { keychain: backend }), ui });
  t.after(() => app.close());
  const connection = await unlockConnection(app, 'a');
  assert.equal(app.bench.store.decrypt(await app.bench.connection('a')), 'sk-gammel-1');
  assert.ok(![...backend.items.values()].includes('x'));
  assert.notEqual(connection.id, undefined);
  assert.equal(Buffer.from((await app.bench.connection('a')).secret, 'base64').subarray(0, 5).toString(), 'AURAK');
});

// Flere datamapper og flere brugere
test('c2-7: to datamapper (AURA_HOME) har hver deres tjenestenavn og ser ikke hinandens poster', async t => {
  const one = await directory(t), two = await directory(t), backend = fake();
  assert.notEqual(serviceName(one), serviceName(two));
  assert.match(serviceName(one), /^Aura CLI [a-f0-9]{12}$/);
  const a = new Vault(one, { keychain: backend }), b = new Vault(two, { keychain: backend });
  await a.unlock(new UI()); await b.unlock(new UI());
  const secret = storeOf(a, one).encrypt(KEY);
  assert.throws(() => b.verify(secret), /findes ikke længere|anden datamappe/);
  assert.equal(storeOf(a, one).decrypt({ secret }), KEY);
});

// Logout
test('c2-8: aura logout sletter nøgleringens post sammen med forbindelsen', async t => {
  const state = await directory(t), backend = fake(), ui = new UI(['a', 'ja']);
  const app = new Application({ directory: state, vault: new Vault(state, { keychain: backend }), ui });
  t.after(() => app.close());
  await app.vault.unlock(ui);
  const secret = app.bench.store.encrypt(KEY);
  const other = app.bench.store.encrypt('sk-en-anden-nøgle-123456');
  await app.bench.store.update(s => { s.connections = [{ id: 'a', kind: 'compatible', name: 'Egen', secret }, { id: 'b', kind: 'compatible', name: 'Anden', secret: other }]; });
  assert.equal(backend.items.size, 2);
  await logout(app);
  assert.deepEqual([...backend.items.values()], ['sk-en-anden-nøgle-123456']);
  assert.deepEqual((await app.bench.store.read()).connections.map(c => c.id), ['b']);
  assert.match(ui.output, /slettet fra computerens nøglering/);
});
test('c2-8: kan posten ikke slettes, siger logout det i stedet for at tie', async t => {
  const state = await directory(t), backend = fake(), ui = new UI(['a', 'ja']);
  const app = new Application({ directory: state, vault: new Vault(state, { keychain: backend }), ui });
  t.after(() => app.close());
  await app.vault.unlock(ui);
  const secret = app.bench.store.encrypt(KEY);
  await app.bench.store.update(s => { s.connections = [{ id: 'a', kind: 'compatible', name: 'Egen', secret }]; });
  backend.options.deleteError = new KeychainError('LOCKED', 'Nøgleringen er låst. Lås den op, og prøv igen.');
  await logout(app);
  assert.match(ui.output, /Forbindelsen er fjernet/);
  assert.match(ui.output, /ligger stadig i computerens nøglering/);
});

// Standardvalget i selve terminalen
test('c2-9: aura.cjs bygger sin Vault med en nøglering, og createKeychain vælger efter platform', () => {
  const source = sync.readFileSync(path.join(__dirname, '..', 'aura.cjs'), 'utf8');
  assert.match(source, /new Vault\(directory, \{ keychain: chooseKeychain\(process\.env, directory\) \}\)/);
  assert.equal(createKeychain({ platform: 'darwin' }).name, 'macOS Nøglering');
  assert.match(createKeychain({ platform: 'linux' }).name, /libsecret/);
  assert.match(createKeychain({ platform: 'win32', directory: os.tmpdir() }).name, /DPAPI/);
  assert.throws(() => createKeychain({ platform: 'win32' }), /datamappen/);
});

// Kun med AURA_REAL_KEYCHAIN=1 på macOS: ét rigtigt kald med et unikt tjenestenavn, som ryddes bagefter.
test('c2-10: rigtig macOS Nøglering med unikt midlertidigt tjenestenavn', { skip: !(process.env.AURA_REAL_KEYCHAIN === '1' && process.platform === 'darwin') }, () => {
  const backend = macos(), service = 'Aura CLI prove-' + randomUUID().slice(0, 12), account = randomUUID();
  try {
    backend.set(service, account, KEY + ' æøå "x" $y');
    assert.equal(backend.get(service, account), KEY + ' æøå "x" $y');
  } finally { backend.delete(service, account); }
  assert.equal(backend.get(service, account), null);
});

test('c2-11: AURA_KEYCHAIN=off giver ingen nøglering, så prøver med AURA_HOME aldrig rører den rigtige', () => {
  const { chooseKeychain } = require('../aura.cjs');
  assert.equal(chooseKeychain({ AURA_KEYCHAIN: 'off' }, os.tmpdir()), null);
  assert.ok(chooseKeychain({}, os.tmpdir()));
  assert.equal(new Vault(os.tmpdir(), { keychain: chooseKeychain({ AURA_KEYCHAIN: 'off' }, os.tmpdir()) }).mode, 'passphrase');
});
