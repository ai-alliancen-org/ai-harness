const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
// Årsag 4: et modelskift mister ikke historikken, når motoren ikke er aktiv (efter fejl, samtaleskift eller genstart af appen).
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m2-modelskift-'));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: () => {
    const engine = { active: false, session: { id: 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Modelskift' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  let model = { id: 'model-a' };
  bench.selection = async () => ({ connection, model, route: null });
  const input = () => ({ connectionID: connection.id, modelID: model.id, mode: 'free', text: 'Byg en oversigt over tre lokaler.' });
  return { bench, engines, input, setModel: id => { model = { id }; } };
}

test('et modelskift efter at motoren er lukket sender samtalen med til den nye session', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input());
  assert.equal(first.historyIncluded, false);
  await f.bench.send({ text: f.input().text, fingerprint: first.fingerprint, contextBinding: first.contextBinding });
  const chat = f.bench.chat;
  await chat.stop();
  // Samtalen har nu beskeder og en gemt AI-session for model-a.
  chat.data.messages.push({ role: 'user', text: 'Tidligere ønske om tre lokaler' }, { role: 'assistant', text: 'Her er oversigten' });
  assert.ok(chat.data.opencode?.fingerprint);
  // Motoren er ikke aktiv (fx efter en fejl eller en genstart), og brugeren skifter model.
  await chat.close(false);
  assert.equal(Boolean(chat.engine?.active), false);
  f.setModel('model-b');
  const switched = await f.bench.prepare(f.input());
  assert.equal(switched.historyIncluded, true, 'den nye session har ikke samtalen, så den følger med som tekst');
  assert.match(switched.conversation, /Tidligere ønske om tre lokaler/);
  await f.bench.send({ text: f.input().text, fingerprint: switched.fingerprint, contextBinding: switched.contextBinding });
  assert.match(f.engines.at(-1).sent[0].system, /Tidligere ønske om tre lokaler/);
});

test('uden modelskift genoptages sessionen, og historikken sendes ikke igen', async t => {
  const f = await fixture(t);
  const first = await f.bench.prepare(f.input());
  await f.bench.send({ text: f.input().text, fingerprint: first.fingerprint, contextBinding: first.contextBinding });
  const chat = f.bench.chat;
  await chat.stop();
  chat.data.messages.push({ role: 'user', text: 'Tidligere ønske' });
  await chat.close(false);
  const again = await f.bench.prepare(f.input());
  assert.equal(again.historyIncluded, false);
});
