// Q:B1-3: arbejder en samtale allerede i projektet, får en anden samtales opgave sin egen kopi ved afsendelsen
// (Workbench.allocate). Før blev netop den første afsendelse, der gav kopien, altid afvist med «Projektets kontekst har ændret
// sig», fordi gennemgangens grundlag var projektet i den oprindelige mappe, mens den sidste kontrol åbnede kopien. Kopien er
// projektet, som det var, da den blev lavet; kun placeringen er en anden (og uden harness.json også navnet, der så kommer af
// mappens navn). Prøven dækker begge slags projekter og projektets egen AGENTS.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

async function fixture(t, { manifest }) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-egen-kopi-')));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'mit-projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Projektets regler\nSkriv dansk.\n');
  if (manifest) await fs.writeFile(path.join(root, 'harness.json'), JSON.stringify({ schemaVersion: 1, name: 'Min app', purpose: 'En prøve på egen kopi.', links: [], tests: 'manuel', assets: [] }));
  const bench = await registry.select({ root, name: 'Egen kopi' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  const input = (chat, text) => ({ chat: chat.id, connectionID: connection.id, modelID: 'test', mode: 'free', text });
  const send = async (chat, text) => { const review = await bench.prepare(input(chat, text)); return bench.send({ chat: chat.id, text, fingerprint: review.fingerprint, contextBinding: review.contextBinding }); };
  return { bench, root, engines, send };
}

for (const manifest of [false, true]) {
  test(`første afsendelse, der giver samtalen sin egen kopi, sendes (${manifest ? 'med' : 'uden'} harness.json)`, async t => {
    const f = await fixture(t, { manifest });
    const a = f.bench.chat;
    await f.send(a, 'Byg en forside');
    assert.equal(a.running, true, 'samtale A arbejder i projektet');
    await f.bench.newChat(); const b = f.bench.chat;
    assert.notEqual(b, a);
    const sent = await f.send(b, 'Lav en kontaktside').then(() => null, error => error);
    assert.equal(sent, null, `afsendelsen afvises ikke (${sent?.message})`);
    assert.ok(b.copy, 'samtale B arbejder i sin egen kopi');
    assert.notEqual(b.root, f.root);
    assert.equal(b.running, true);
    const engine = f.engines.at(-1);
    assert.equal(engine.options.root, b.root, 'motoren arbejder i kopien');
    assert.equal(engine.sent[0].text, 'Lav en kontaktside');
    assert.match(engine.sent[0].system, /Skriv dansk\./, 'projektets egne regler følger med fra kopien');
    assert.equal(f.engines[0].active, true, 'samtale A arbejder videre');
  });
}
