// Spor S2 (motor og session): fund 3 (Godkend alt), 8 (arbejdsmåde og motoridentitet), 9 (policy-mønster), 13 (snapshottilstand).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { approveAllApplies, engineRestartNeeded, ChatSession } = require('../core/chat-session.cjs');
const { trustedPolicyPatterns } = require('../core/engine.cjs');
const { EngineEvents } = require('../core/engine-events.cjs');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };

// Fund 3: Godkend alt automatiserer aldrig adgang uden for projektet eller hentning fra nettet.
test('Godkend alt automatiserer hverken mappeadgang uden for projektet eller webhentning', () => {
  const kort = kind => ({ match: { kind }, blockedMode: false });
  assert.equal(approveAllApplies(true, kort('external_directory'), { sandbox: true }), false);
  assert.equal(approveAllApplies(true, kort('webfetch'), { sandbox: true }), false);
  assert.equal(approveAllApplies(true, kort('edit'), { sandbox: true }), true, 'kort inde i projektet automatiseres stadig');
  assert.equal(approveAllApplies(true, kort('read'), { sandbox: true }), true);
});

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s2-')));
  const engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit() {}, engineFactory: () => {
    const engine = { active: false, session: { id: 'session-' + engines.length }, sent: [], start: async () => { engine.active = true; }, send: async () => {}, abort: async () => {}, close: async () => { engine.active = false; } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = await fs.realpath(await fs.mkdtemp(path.join(directory, 'projekt-')));
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Start</h1>');
  const bench = await registry.select({ root, name: 'S2-prøve' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Lokal prøve', baseURL: 'http://127.0.0.1:1/v1' });
  const connection = await bench.connection(saved.connections[0].id);
  const state = { model: 'test' };
  bench.selection = async () => ({ connection, model: { id: state.model }, route: null });
  const sandbox = require('../core/command-sandbox.cjs'), original = sandbox.support;
  sandbox.support = async () => ({ available: true });
  t.after(() => { sandbox.support = original; });
  return { bench, state, connection, input: m => ({ connectionID: connection.id, modelID: state.model, mode: m }) };
}

// Fund 8: identiteten må ikke afhænge af arbejdsmåde, automatiske kommandoer eller Godkend alt.
test('motoridentiteten er den samme på tværs af arbejdsmåder med automatiske kommandoer og Godkend alt', async t => {
  const f = await fixture(t);
  f.bench.approvalsPolicy.settings = async () => ({ autoCommands: true });
  const chat = await f.bench.prepare({ ...f.input('chat'), text: 'Hej' });
  const build = await f.bench.prepare({ ...f.input('free'), text: 'Hej' });
  assert.equal(f.bench.chat.prepared.commandIsolation, true, 'sandkassen skal stadig tændes i Byg/fri');
  assert.equal(build.sessionFingerprint, chat.sessionFingerprint, 'skift af arbejdsmåde giver ikke ny AI-session');
  f.bench.chat.prepared = { connection: f.connection, model: { id: 'test' } };
  f.bench.chat.setApproveAll(true);
  const withAll = await f.bench.prepare({ ...f.input('chat'), text: 'Hej' });
  assert.equal(withAll.sessionFingerprint, chat.sessionFingerprint, 'Godkend alt ændrer ikke identiteten');
  // Sandkassen kan stadig kræve en genstart af motoren uden at ændre sessionen (historikken følger med samme fingeraftryk).
  assert.equal(engineRestartNeeded({ identityChanged: build.sessionFingerprint !== chat.sessionFingerprint, engineActive: true, engineSandbox: false, sandboxNext: true }), true);
});

// Fund 3: tilstanden følger ikke med til en anden model eller forbindelse.
test('Godkend alt nulstilles, når modellen skifter', async t => {
  const f = await fixture(t);
  const chat = f.bench.chat, sendte = [];
  chat.prepared = { connection: f.connection, model: { id: 'test' } };
  chat.setApproveAll(true);
  const emit = chat.emit.bind(chat); chat.emit = e => { sendte.push(e); return emit(e); };
  await f.bench.prepare({ ...f.input('chat'), text: 'Hej' });
  assert.equal(chat.approveAll, true, 'samme model: tilstanden består');
  f.state.model = 'anden';
  await f.bench.prepare({ ...f.input('chat'), text: 'Hej' });
  assert.equal(chat.approveAll, false);
  assert.ok(sendte.some(e => e.type === 'approve-all' && e.enabled === false), 'skærmen får besked');
  assert.ok(chat instanceof ChatSession);
});

// Fund 9: kun den rigtige policy-mappe spærres, ikke enhver projektsti med /policy/.
test('policy-mønstret rammer kun kommandobeskyttelsens egen mappe', () => {
  const policyPath = '/Users/b/Library/Application Support/Aura/sandboxes/nøgle/chat-1/policy/policy.json';
  const patterns = trustedPolicyPatterns({ policyPath });
  const glob = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const rammer = sti => patterns.some(p => glob(p).test(sti));
  assert.equal(rammer('/Users/b/Library/Application Support/Aura/sandboxes/nøgle/chat-1/policy/policy.json'), true);
  assert.equal(rammer('../../../Users/b/Library/Application Support/Aura/sandboxes/nøgle/chat-1/policy/plugin.mjs'), true, 'relativ visning af den rigtige mappe');
  assert.equal(rammer('Users/b/Library/Application Support/Aura/sandboxes/nøgle/chat-1/policy/ready.json'), true, 'uden foranstillet skråstreg');
  assert.equal(rammer('public/policy/privatliv.html'), false);
  assert.equal(rammer('/Users/b/projekt/public/policy/privatliv.html'), false);
  assert.equal(rammer('../andet/chat-2/policy/policy.json'), false, 'en anden samtales mappe med samme navn');
});

// Fund 13: efter en vellykket genoprettelse og én live-hændelse udløser en delta ikke et fuldt GET.
test('snapshottilstanden slås fra efter genoprettelse og første live-hændelse', async t => {
  const gets = [], handled = [];
  const engine = { url: 'http://x', auth: 'a', root: '/r', promptEpoch: 1, promptID: 'p', active: true, pending: new Map(), pendingQuestions: new Map(), session: { id: 's' }, compaction: null,
    handleEvent: e => handled.push(e),
    request: async url => { if (url.endsWith('/message')) { gets.push(url); return []; } if (url === '/session/status') return {}; return []; } };
  const events = new EngineEvents(engine, { delays: [5], idleLimit: 60_000 });
  let stream, fetches = 0;
  const realFetch = global.fetch;
  global.fetch = async () => {
    if (fetches++ === 0) return { ok: false };
    return { ok: true, body: new ReadableStream({ start: c => { stream = c; } }) };
  };
  t.after(() => { global.fetch = realFetch; events.close(); try { stream?.close(); } catch { /* lukket */ } });
  const enc = new TextEncoder(), push = e => stream.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const run = events.run().catch(() => {});
  for (let i = 0; i < 100 && !handled.some(e => e.recovery?.phase === 'recovered'); i++) await wait(10);
  assert.ok(handled.some(e => e.recovery?.phase === 'recovered'), 'genoprettelsen blev gennemført');
  push({ type: 'server.heartbeat' }); await wait(60);
  assert.equal(events.snapshotMode, false);
  const before = gets.length;
  push({ type: 'message.part.delta', properties: { sessionID: 's', delta: 'x' } }); await wait(450);
  assert.equal(gets.length, before, 'ingen nyt fuldt GET');
  assert.ok(handled.some(e => e.type === 'message.part.delta'), 'deltaen leveres direkte');
  void run;
});
