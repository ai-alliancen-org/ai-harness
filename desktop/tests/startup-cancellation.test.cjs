const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Ventede for længe på ${label}`)), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, { holdClose = false, lateEvents = false, holdPrompt = false } = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-startup-cancel-')));
  const root = path.join(directory, 'projekt'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Bevar projektet</h1>');
  const entered = deferred(), start = deferred(), closing = deferred(), closed = deferred();
  const promptEntered = deferred(), promptAcknowledged = deferred(), abortEntered = deferred(), abortCompleted = deferred();
  if (!holdClose) closed.resolve();
  const events = [], engines = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, safeStorage: {}, emit: event => events.push(event), engineFactory: options => {
    const first = engines.length === 0;
    const engine = {
      options, active: false, session: { id: `ses-${engines.length}` }, pending: new Map(), sent: [], aborts: 0, closes: 0,
      async start() { if (first) { entered.resolve(); if (!holdPrompt) await start.promise; } this.active = true; },
      async send(text) { this.sent.push(text); if (first && holdPrompt) { promptEntered.resolve(); await promptAcknowledged.promise; } },
      async abort() {
        this.aborts++;
        if (first && holdPrompt) {
          promptAcknowledged.reject(new DOMException('Promptkvitteringen blev stoppet.', 'AbortError'));
          abortEntered.resolve(); await abortCompleted.promise;
        } else if (first) start.reject(new Error('Motoropstarten blev afbrudt.'));
        if (lateEvents) options.onEvent({ type: 'engine.error', message: 'Sent svar fra stoppet motor' });
      },
      async close() { this.closes++; this.active = false; if (first) { closing.resolve(); await closed.promise; } }
    };
    engines.push(engine); return engine;
  } });
  await bench.activate({ root, name: 'Opstartsprøve' });
  t.after(async () => {
    start.resolve(); closed.resolve(); promptAcknowledged.resolve(); abortCompleted.resolve();
    await bench.close(); await fs.rm(directory, { recursive: true, force: true });
  });
  const chat = bench.chat;
  const send = text => {
    chat.prepared = { mode: 'free', root: chat.root, disclosure: { fingerprint: 'test', consentKey: 'test' },
      connection: { id: 'test-connection', kind: 'compatible', name: 'Prøve', baseURL: 'http://127.0.0.1:1/v1' },
      model: { id: 'test' }, references: [], context: { rules: '', skills: [], titles: [], features: { versioner: false } } };
    return bench.send({ text, fingerprint: 'test' });
  };
  return { bench, chat, root, entered, closing, closed, promptEntered, abortEntered, abortCompleted, engines, events, send };
}

test('Stop under opstart venter på motoroprydningen og beholder projektets reservation, indtil den er færdig', async t => {
  const f = await fixture(t, { holdClose: true });
  const sending = f.send('Må ikke sendes'), rejected = assert.rejects(sending, /stoppet før afsendelse/);
  await bounded(f.entered.promise, 'motorstart');
  let settled = false;
  const stopping = f.bench.stop().then(() => { settled = true; });
  try {
    await bounded(f.closing.promise, 'motoroprydning'); await turn();
    assert.equal(settled, false, 'Stop må ikke kvittere, mens den gamle motor stadig lukker');
    assert.equal(f.bench.claims.get(f.root), f.chat, 'en ny opgave må ikke overtage mappen før oprydningen');
    assert.equal(f.bench.busyRoot(f.root), true);
    await assert.rejects(f.bench.send({ text: 'For tidligt', fingerprint: 'test' }), /allerede en opgave/);
  } finally { f.closed.resolve(); await bounded(Promise.all([stopping, rejected]), 'afslutning efter Stop'); }
  assert.equal(f.bench.running, false); assert.equal(f.bench.claims.has(f.root), false);
  assert.equal(f.engines[0].sent.length, 0);
  assert.equal(f.events.filter(event => event.type === 'run.review' && event.status === 'stopped').length, 1);
  assert.equal(f.events.filter(event => event.type === 'run.status' && event.status === 'stopped').length, 1);
  assert.equal((await f.bench.history.readChat(f.root, f.chat.id)).status, 'stopped');
});

test('gentagne Stop under opstart afslutter én gang, ignorerer sene motorfejl og lader næste opgave starte', async t => {
  const f = await fixture(t, { lateEvents: true });
  const sending = f.send('Stoppet besked'), rejected = assert.rejects(sending, /stoppet før afsendelse/);
  await bounded(f.entered.promise, 'motorstart');
  await bounded(Promise.all([f.bench.stop(), f.bench.stop(), rejected]), 'gentagne Stop');
  assert.equal(f.engines[0].aborts, 1, 'gentagne klik deler samme stopoperation');
  assert.equal(f.engines[0].closes, 1, 'opstartens fejlvej lukker motoren én gang');
  assert.equal(f.engines[0].sent.length, 0);
  assert.equal(f.events.some(event => event.type === 'engine.error'), false, 'et sent svar fra den stoppede start må ikke blive en brugerfejl');
  assert.equal(f.events.filter(event => event.type === 'run.review' && event.status === 'stopped').length, 1);
  assert.equal(f.events.filter(event => event.type === 'run.status' && event.status === 'stopped').length, 1);
  assert.equal(f.events.some(event => event.type === 'run.status' && ['working', 'error'].includes(event.status)), false);
  await f.send('Næste besked');
  assert.equal(f.engines.length, 2); assert.deepEqual(f.engines[1].sent, ['Næste besked']);
  assert.equal(f.chat.running, true);
  f.engines[1].options.onEvent({ type: 'session.idle' }); await f.chat.finishing;
  assert.equal(f.bench.running, false); assert.equal(f.bench.claims.has(f.root), false);
  assert.equal(await fs.readFile(path.join(f.root, 'index.html'), 'utf8'), '<h1>Bevar projektet</h1>');
});

test('Stop før promptkvitteringen lader motorens værktøjsoprydning afslutte før close og frigivelse af projektet', async t => {
  const f = await fixture(t, { holdPrompt: true });
  const sending = f.send('En modtaget besked uden kvittering'), rejected = assert.rejects(sending, /stoppet før afsendelse/);
  await bounded(f.promptEntered.promise, 'promptmodtagelse');
  let stopped = false;
  const stopping = f.bench.stop().then(() => { stopped = true; });
  try {
    await bounded(f.abortEntered.promise, 'motorens abortoprydning');
    await bounded(rejected, 'den afbrudte promptkvittering');
    await turn();
    assert.equal(f.engines[0].aborts, 1);
    assert.equal(f.engines[0].closes, 0, 'send-fejlvejen må ikke lukke processen, mens abort stadig rydder værktøjer op');
    assert.equal(stopped, false);
    assert.equal(f.bench.claims.get(f.root), f.chat, 'projektet tilhører stadig den stoppende opgave');
    assert.equal(f.bench.busyRoot(f.root), true);
    await assert.rejects(f.send('For tidligt'), /allerede en opgave/);
  } finally {
    f.abortCompleted.resolve();
    await bounded(Promise.all([stopping, rejected]), 'afslutning efter værktøjsoprydning');
  }
  assert.equal(f.engines[0].closes, 1);
  assert.equal(f.bench.running, false); assert.equal(f.bench.claims.has(f.root), false);
  assert.equal(f.events.filter(event => event.type === 'run.review' && event.status === 'stopped').length, 1);
  assert.equal(f.events.filter(event => event.type === 'run.status' && event.status === 'stopped').length, 1);
  assert.equal(f.events.some(event => event.type === 'run.status' && event.status === 'error'), false);
  await f.send('Næste besked efter oprydning');
  assert.equal(f.engines.length, 2); assert.deepEqual(f.engines[1].sent, ['Næste besked efter oprydning']);
  f.engines[1].options.onEvent({ type: 'session.idle' }); await f.chat.finishing;
  assert.equal(f.bench.running, false); assert.equal(f.bench.claims.has(f.root), false);
  assert.equal(await fs.readFile(path.join(f.root, 'index.html'), 'utf8'), '<h1>Bevar projektet</h1>');
});
