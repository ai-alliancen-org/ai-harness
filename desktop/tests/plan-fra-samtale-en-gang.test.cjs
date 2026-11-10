// Q:A-7 (1): en plan, der opstår i Samtale, sendes kun én gang i Byg (som plan.text). Mens svaret strømmer ind, gemmer
// samtalen sin historik hvert halve sekund (ChatSession.saveHistory). Kom planen på den måde i samtalens gemte beskeder, før
// opgaven sluttede, tog planens baggrund (plan.context) den med, og Byg sendte planteksten to gange. Baggrunden rummer
// brugerens egne beskeder og den tidligere samtale, aldrig opgavens eget svar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const MARKOER = 'UNIK-PLANMARKOER-4410';
const plan = ['## Det bygger vi', 'En oversigt over lokaler. ' + MARKOER, '## Sådan skal det se ud', 'Rolig side med store knapper.', '## Teknik og data', 'HTML og CSS uden netværk.', '## Det skal du prøve', 'Åbn forhåndsvisningen og læs overskriften.', '<!-- aura:offer-plan -->'].join('\n');
const count = (text, part) => String(text).split(part).length - 1;

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-plan-samtale-')));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: options => {
    const engine = { active: false, resumed: false, options, session: { id: options.resume || 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; engine.resumed = Boolean(options.resume); }, send: async (text, system) => engine.sent.push({ text, system }), abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'Plan fra samtale' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  const input = (text, extra = {}) => ({ connectionID: connection.id, modelID: 'test', text, ...extra });
  const send = async (text, extra) => { const review = await bench.prepare(input(text, extra)); await bench.send({ text, fingerprint: review.fingerprint, contextBinding: review.contextBinding }); return review; };
  return { bench, engines, input, send };
}

test('en plan fra Samtale, der blev gemt, mens den strømmede ind, sendes kun én gang i Byg', async t => {
  const f = await fixture(t);
  await f.send('Jeg vil have en oversigt over mødelokaler med lilla-stole.', { mode: 'chat' });
  const chat = f.bench.chat;
  // Svaret strømmer ind. Historikken gemmes undervejs (som historyTimer gør hvert halve sekund), før opgaven slutter.
  chat.runRoles.set('m1', 'assistant'); chat.runText.set('p1', { id: 'p1', messageID: 'm1', text: plan.slice(0, 120) });
  await chat.saveHistory('working');
  chat.runText.get('p1').text = plan;
  await chat.saveHistory('working');
  assert.ok(chat.data.messages.some(message => message.text.includes(MARKOER)), 'planen står allerede i de gemte beskeder');
  chat.event({ type: 'session.idle' }); await chat.finishing;
  assert.ok(chat.plan, 'svaret blev til en valgbar plan');
  assert.equal(count(chat.plan.context, MARKOER), 0, 'planens baggrund rummer ikke planteksten');
  assert.match(chat.plan.context, /lilla-stole/, 'brugerens egen besked er stadig baggrund');
  const text = 'Byg første udkast efter den plan, jeg har gennemgået.';
  const review = await f.bench.prepare(f.input(text, { mode: 'build', planID: chat.plan.id }));
  const system = review.appContext.components.map(part => part.text).join('');
  assert.equal(count(system, MARKOER), 1, 'planteksten sendes én gang');
  await f.bench.send({ text, fingerprint: review.fingerprint, contextBinding: review.contextBinding });
  assert.equal(count(f.engines.at(-1).sent.at(-1).system, MARKOER), 1, 'også i det, motoren fik');
});

test('en tidligere samtale før planen er stadig baggrund for planen', async t => {
  const f = await fixture(t);
  await f.send('Hvad kan man bruge en lokaleoversigt til?', { mode: 'chat' });
  const chat = f.bench.chat;
  chat.runRoles.set('m0', 'assistant'); chat.runText.set('p0', { id: 'p0', messageID: 'm0', text: 'Til at finde ledige lokaler med grøn-tavle.' });
  chat.event({ type: 'session.idle' }); await chat.finishing;
  await f.send('Lav en plan for den.', { mode: 'chat' });
  chat.runRoles.set('m1', 'assistant'); chat.runText.set('p1', { id: 'p1', messageID: 'm1', text: plan });
  await chat.saveHistory('working');
  chat.event({ type: 'session.idle' }); await chat.finishing;
  assert.ok(chat.plan);
  assert.match(chat.plan.context, /grøn-tavle/, 'AI’ens tidligere svar er baggrund');
  assert.match(chat.plan.context, /Lav en plan for den\./);
  assert.equal(count(chat.plan.context, MARKOER), 0);
});
