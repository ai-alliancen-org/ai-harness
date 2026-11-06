// Spor M, trin 1a: gentagelsesvagten (doom_loop) besvares af Aura uden kort. OpenCode 1.18.33 og 1.19.5 slutter opgaven med session.error,
// hvis vagten afvises (også med en besked og experimental.continue_loop_on_deny, målt mod den rigtige motor), så svaret er "én gang".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Workbench } = require('../core/workbench.cjs');
const { permissions, engineConfig, VERSION } = require('../core/engine.cjs');
const profiles = path.join(__dirname, '../../profiles');
const fixture = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'fixtures', `opencode-${VERSION}`, 'byg-git-soeg__doom-loop__1-doom_loop.json'), 'utf8'));

async function session(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m1-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const events = [], calls = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root, name: 'Prøve' }); const chat = bench.chat;
  chat.running = true; chat.runMode = 'build'; chat.doomLoopAnswers = 0;
  chat.engine = { pending: new Map(), reply: async (...args) => calls.push(args), abort: async () => {}, close: async () => {} };
  const ask = async id => {
    const properties = { ...structuredClone(fixture.request), id, sessionID: 'ses' };
    chat.engine.pending.set(id, properties);
    await chat.permissionAsked({ type: 'permission.asked', properties });
  };
  t.after(async () => { chat.engine = null; chat.running = false; await bench.close(); });
  return { bench, chat, events, calls, ask };
}

test('gentagelsesvagten besvares med "én gang", logges som auto i Aktivitet og viser ikke et kort', async t => {
  const { bench, chat, events, calls, ask } = await session(t);
  await ask('per_doom_1');
  assert.deepEqual(calls, [['per_doom_1', true]], 'svaret er "én gang", aldrig en afvisning');
  assert.equal(events.some(event => event.type === 'permission.asked'), false, 'ingen kort');
  const entry = bench.activityList().find(item => item.id === 'approval-per_doom_1');
  assert.equal(entry.status, 'auto'); assert.equal(entry.kind, 'approval'); assert.match(entry.title, /Gentagelsesvagt/); assert.equal(entry.target, 'read');
  assert.equal(chat.approvals.has('per_doom_1'), false); assert.equal(chat.waiting === true, false);
});

test('efter tre automatiske svar i samme opgave vises kortet, så en model, der bliver ved, kan stoppes', async t => {
  const { events, calls, ask } = await session(t);
  for (const id of ['d1', 'd2', 'd3']) await ask(id);
  assert.equal(calls.length, 3); assert.equal(events.filter(event => event.type === 'permission.asked').length, 0);
  await ask('d4');
  assert.equal(calls.length, 3, 'det fjerde svar sendes ikke automatisk');
  const card = events.filter(event => event.type === 'permission.asked');
  assert.equal(card.length, 1); assert.equal(card[0].properties.id, 'd4');
});

test('et automatisk svar, der ikke kan sendes, ender som et kort og tæller ikke med', async t => {
  const { chat, events, ask } = await session(t);
  chat.engine.reply = async () => { throw new Error('motoren svarer ikke'); };
  await ask('d1');
  assert.equal(events.filter(event => event.type === 'permission.asked').length, 1);
  assert.equal(chat.doomLoopAnswers, 0);
});

test('Planlæg og Samtale spørger om gentagelsesvagten i stedet for at ramme "*": "deny"; Byg spørger via "*": "ask"', () => {
  for (const mode of ['plan', 'chat']) {
    const set = permissions('/p', [], mode, { directory: '/m/runtime/a', names: [] });
    assert.equal(set.doom_loop, 'ask', mode); assert.equal(set['*'], 'deny', mode);
  }
  const build = permissions('/p', [], 'build', { directory: '/m/runtime/a', names: [] });
  assert.equal(build.doom_loop, undefined); assert.equal(build['*'], 'ask');
  // Flaget ændrer, hvad en almindelig afvisning gør, og er ikke nødvendigt, når gentagelsesvagten besvares med "én gang".
  assert.equal(engineConfig({}, { id: 'm' }, {}, {}).experimental, undefined);
});
