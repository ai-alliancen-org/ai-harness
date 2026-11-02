const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
// Appens egne instruktioner gennemgås før afsendelse. Prøverne kontrollerer, at det viste er det sendte, og at en
// ændring mellem gennemgang og afsendelse afviser beskeden i stedet for at sende noget andet.
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-appkontekst-'));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: () => {
    const engine = { active: false, session: { id: 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Appkontekstprøve' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  const input = { connectionID: connection.id, modelID: 'test', mode: 'free', text: 'Byg en oversigt over tre lokaler.' };
  return { bench, engines, root, input };
}

test('gennemgangen viser appens egne instruktioner som fragmenter med egen kontrolsum', async t => {
  const { bench, input } = await fixture(t);
  const review = await bench.prepare(input);
  assert.ok(review.appContext.components.length >= 4);
  for (const part of review.appContext.components) {
    assert.equal(typeof part.title, 'string'); assert.ok(part.title);
    assert.match(part.hash, /^[0-9a-f]{64}$/);
    assert.ok(part.text.length > 0);
  }
  assert.ok(review.appContext.components.some(part => part.text.includes('FÆLLES-GRUNDLAG-02')), 'grundreglerne står i et fragment');
  // Rækkevidden står i gennemgangen, så den ikke læses som hele modelkaldet.
  assert.match(review.appContext.scope, /Ikke hele modelkaldet/);
  assert.match(review.contextBinding, /^[0-9a-f]{64}$/);
  assert.notEqual(review.contextBinding, review.fingerprint);
});

test('det viste er det sendte: fragmenterne står ordret forrest i systeminstruktionen', async t => {
  const { bench, engines, input } = await fixture(t);
  const review = await bench.prepare(input);
  await bench.send({ text: input.text, fingerprint: review.fingerprint, contextBinding: review.contextBinding });
  const system = engines[0].sent[0].system;
  assert.ok(system.startsWith(review.appContext.components.map(part => part.text).join('')), 'de gennemgåede fragmenter står ordret og i samme rækkefølge');
  // Linjerne, der først kendes under opstarten, står efter fragmenterne og uden for gennemgangen.
  // AI-filer ligger i projektets .aura/tmp, og systemprompten må ikke nævne en absolut appdata-sti (beslutning for beta 2).
  assert.match(system, /\.aura\/tmp\//);
  assert.doesNotMatch(system, /appdata|scratch/i);
  assert.equal(review.appContext.components.some(part => part.text.includes('.aura/tmp')), false);
});

test('en afsendelse uden eller med en forældet binding afvises', async t => {
  const { bench, engines, input } = await fixture(t);
  const review = await bench.prepare(input);
  await assert.rejects(bench.send({ text: input.text, fingerprint: review.fingerprint }), /Gennemgå den aktuelle kontekst/);
  await assert.rejects(bench.send({ text: input.text, fingerprint: review.fingerprint, contextBinding: 'a'.repeat(64) }), /Gennemgå den aktuelle kontekst/);
  assert.equal(engines.length, 0, 'ingen motor startes for en ugennemgået kontekst');
});

test('en ændret besked eller ændrede grundregler afvises mellem gennemgang og afsendelse', async t => {
  const { bench, engines, input, root } = await fixture(t);
  const review = await bench.prepare(input);
  await assert.rejects(bench.send({ text: 'En anden besked', fingerprint: review.fingerprint, contextBinding: review.contextBinding }), /Beskeden er ændret/);
  const rules = (await bench.skills.context(root)).rules + '\nPRØVEREGEL: en ændring efter gennemgangen.\n';
  await bench.skills.save(root, { id: 'faelles-grundregler', content: rules });
  await assert.rejects(bench.send({ text: input.text, fingerprint: review.fingerprint, contextBinding: review.contextBinding }), /ændret sig/);
  assert.equal(engines.length, 0);
  // Efter en ny gennemgang kan beskeden sendes, og den nye regeltekst står i det, der sendes.
  const again = await bench.prepare(input);
  await bench.send({ text: input.text, fingerprint: again.fingerprint, contextBinding: again.contextBinding });
  assert.match(engines[0].sent[0].system, /PRØVEREGEL: en ændring efter gennemgangen\./);
});

test('en ændret AGENTS.md efter gennemgangen afviser afsendelsen', async t => {
  const { bench, engines, input, root } = await fixture(t);
  const review = await bench.prepare(input);
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Projektregler\nNY-REGEL efter gennemgangen.\n');
  await assert.rejects(bench.send({ text: input.text, fingerprint: review.fingerprint, contextBinding: review.contextBinding }), /ændret sig/);
  assert.equal(engines.length, 0);
});
