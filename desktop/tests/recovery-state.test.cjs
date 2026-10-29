const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Workbench } = require('../core/workbench.cjs');

const profiles = path.resolve(__dirname, '../../profiles');
const plan = '## Det bygger vi\nEn lokal side.\n## Sådan skal det se ud\nEn tydelig overskrift.\n## Teknik og data\nHTML uden netværk.\n## Det skal du prøve\nLæs overskriften.';

// Kun motorprocessen er erstattet. Forberedelse, modtagervalg, plan, historik,
// godkendelsespolitik og motorens livscyklus bruger den rigtige kerne på disk.
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-session-continuity-'));
  const root = path.join(directory, 'project');
  await fs.mkdir(path.join(root, 'references'), { recursive: true });
  await fs.writeFile(path.join(root, 'references/reference.md'), 'Synthetic reference.\n');
  await fs.writeFile(path.join(root, 'source.txt'), 'Synthetic project.\n');
  const catalog = [{ id: 'model-a' }, { id: 'model-b' }];
  const server = http.createServer((request, response) => {
    if (request.url !== '/v1/models') { response.writeHead(404); response.end(); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: catalog }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [], engines = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, safeStorage: {}, emit: event => events.push(event), engineFactory: options => {
    const engine = { options, sandbox: options.sandbox, active: false, resumed: Boolean(options.resume), session: { id: options.resume || `session-${engines.length + 1}` }, pending: new Map(), sent: [], replies: [],
      async start() { this.active = true; }, async send(text, system) { this.sent.push({ text, system }); }, async abort() {}, async close() { this.active = false; },
      async reply(...args) { this.replies.push(args); this.pending.delete(args[0]); } };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await bench.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const project = { root, name: 'Session fixture', purpose: 'Synthetic session continuity', assets: [{ kind: 'reference', file: 'references/reference.md', name: 'Reference' }] };
  await bench.activate(project);
  const connection = (await bench.saveConnection({ kind: 'compatible', name: 'Synthetic local connection', baseURL: `http://127.0.0.1:${server.address().port}/v1` })).connections[0];
  async function prepare(mode = 'chat', extra = {}) {
    return bench.prepare({ text: 'Synthetic user request', connectionID: connection.id, modelID: 'model-a', mode, ...(mode === 'build' ? { planID: bench.chat.plan?.id } : {}), ...extra });
  }
  async function send(mode = 'chat', extra = {}) {
    const disclosure = await prepare(mode, extra);
    await bench.send({ text: 'Synthetic user request', fingerprint: disclosure.fingerprint, contextBinding: disclosure.contextBinding });
    return disclosure;
  }
  let answers = 0;
  async function finish(text = 'Synthetic answer.') {
    const chat = bench.chat;
    const id = `answer-${++answers}`;
    chat.runRoles.set(id, 'assistant');
    chat.runText.set(id, { id, messageID: id, text });
    chat.event({ type: 'session.idle' });
    await chat.finishing;
  }
  return { bench, root, project, events, engines, connection, prepare, send, finish, catalog };
}

test('recovery preserves the active plan, session and approvals; exhausted transport retains the plan for review', async t => {
  const f = await fixture(t); await f.send('plan'); await f.finish(plan);
  const selected = f.bench.chat.plan; await f.send('build'); const chat = f.bench.chat, engine = chat.engine;
  const binding = { id: 'pending', engine, generation: chat.generation }; chat.approvals.set('pending', binding);
  const fingerprint = chat.engineIdentity, session = chat.data.opencode.session;
  chat.event({ type: 'engine.recovery', recovery: { phase: 'retrying', attempt: 2 } });
  chat.event({ type: 'engine.recovery', recovery: { phase: 'recovered', attempt: 2 } });
  assert.equal(chat.running, true); assert.equal(chat.runStopped, false); assert.equal(chat.plan, selected);
  assert.equal(chat.approvals.get('pending'), binding); assert.equal(chat.engineIdentity, fingerprint); assert.equal(chat.engine, engine);
  assert.equal(engine.sent.length, 1); assert.equal(engine.replies.length, 0);
  chat.event({ type: 'engine.error', message: 'Bounded timeout', failure: { kind: 'idle' } }); await chat.finishing;
  assert.equal(chat.plan.id, selected.id); assert.equal(chat.runStopped, false); assert.equal(chat.data.opencode.session, session);
  assert.equal(f.events.filter(e => e.type === 'run.status').at(-1).status, 'error');
  const saved = await f.bench.history.readChat(f.root, chat.id); assert.equal(saved.plan.id, selected.id);
});


test('Stop during Build retains the reviewed plan but expires every pending approval', async t => {
  const f = await fixture(t); await f.send('plan'); await f.finish(plan); await f.send('build');
  const chat = f.bench.chat, selected = chat.plan;
  chat.approvals.set('pending', { engine: chat.engine, generation: chat.generation });
  await chat.stop();
  assert.equal(chat.plan.id, selected.id); assert.equal(chat.approvals.size, 0);
  await assert.rejects(chat.reply({ id: 'pending', allow: true }), /findes ikke længere/);
  const status = f.events.filter(e => e.type === 'run.status').at(-1);
  assert.equal(status.status, 'stopped'); assert.equal(status.planRetained, true);
  const saved = await f.bench.history.openChat(f.root, chat.id);
  assert.equal(saved.plan.id, selected.id); assert.equal(saved.mode, 'build');
  await f.send('build'); assert.equal(f.bench.chat.runMode, 'build');
});

test('stopped or failed planning never turns partial output into an approved build plan', async t => {
  for (const outcome of ['stopped', 'error']) await t.test(outcome, async t => {
    const f = await fixture(t); await f.send('plan');
    const chat = f.bench.chat;
    chat.runRoles.set('partial', 'assistant'); chat.runText.set('partial', { id: 'partial', messageID: 'partial', text: plan });
    if (outcome === 'stopped') await chat.stop();
    else { chat.event({ type: 'engine.error', message: 'Synthetic transport failure' }); await chat.finishing; }
    assert.equal(chat.plan, null);
    assert.equal(f.events.filter(e => e.type === 'run.status').at(-1).planRetained, false);
    await assert.rejects(f.prepare('build'), /plan/i);
  });
});

test('the existing renderer retains Build only when main confirms the plan survived', async () => {
  const source = await fs.readFile(path.join(__dirname, '../ui/app.js'), 'utf8');
  const start = source.indexOf("  if (event.type === 'run.status') {"), end = source.indexOf("  if (event.type === 'message.updated')", start);
  const handler = source.slice(start, end), vm = require('node:vm');
  for (const status of ['error', 'stopped']) for (const active of [true, false]) for (const retained of [true, false]) {
    const elements = new Map([['#prompt', { value: '' }], ['#plan-card', { hidden: false }], ['#work-mode', { value: 'build' }]]);
    const selected = { id: 'reviewed-plan' };
    const v = { plan: selected, planCard: true, lastSentText: 'Continue this build', draft: { mode: 'build' }, approvals: { replaceChildren() {} } };
    const context = { event: { type: 'run.status', status, planRetained: retained }, active, v, activePlan: selected, $: selector => elements.get(selector), setRunning() {}, updateWorkMode() {}, saveChatDraft() {}, window: {} };
    vm.runInNewContext(handler, context);
    assert.equal(v.plan?.id || null, retained ? selected.id : null);
    if (active) { assert.equal(context.activePlan?.id || null, retained ? selected.id : null); assert.equal(elements.get('#work-mode').value, retained ? 'build' : 'plan'); }
    else assert.equal(v.draft.mode, retained ? 'build' : 'plan');
  }
});
