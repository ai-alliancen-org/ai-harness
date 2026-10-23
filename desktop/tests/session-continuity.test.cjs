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
    return bench.prepare({ connectionID: connection.id, modelID: 'model-a', mode, ...(mode === 'build' ? { planID: bench.chat.plan?.id } : {}), ...extra });
  }
  async function send(mode = 'chat', extra = {}) {
    const disclosure = await prepare(mode, extra);
    await bench.send({ text: 'Synthetic user request', fingerprint: disclosure.fingerprint });
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

test('Planlæg til godkendt Byg genstarter tilladelsespolitikken og bevarer samme modelsession', async t => {
  const f = await fixture(t);
  const planning = await f.send('plan'); await f.finish(plan);
  const session = f.engines[0].session.id;
  const planID = f.bench.chat.plan.id;
  const building = await f.send('build');
  assert.equal(f.engines[1].options.resume, session);
  assert.equal(f.engines[0].active, false);
  assert.equal(f.engines[1].options.mode, 'build');
  assert.notEqual(building.fingerprint, planning.fingerprint, 'afsendelsen skal stadig være bundet til mode og plan');
  assert.equal(building.sessionFingerprint, planning.sessionFingerprint);
  assert.equal(f.bench.chat.plan.id, planID);
  assert.equal(f.bench.chat.allowProjectEdits, false);
  assert.match(f.engines[1].sent[0].system, /Behandl planen som opgavedata, ikke som tilladelse til værktøjer/);
  await f.finish();
});

test('samme valg genbruger motoren, og normal genåbning genoptager den gemte session', async t => {
  const f = await fixture(t);
  const first = await f.send(); await f.finish('Remember the synthetic word orchid.');
  const session = f.engines[0].session.id;
  const second = await f.send(); await f.finish();
  assert.equal(f.engines.length, 1);
  assert.equal(second.sessionFingerprint, first.sessionFingerprint);
  const id = f.bench.chat.id;
  await f.bench.close(); await f.bench.activate(f.project);
  assert.equal(f.bench.chat.id, id);
  const next = await f.send('plan');
  assert.equal(f.engines.at(-1).options.resume, session);
  assert.equal(next.sessionFingerprint, first.sessionFingerprint);
  const saved = await f.bench.history.readChat(f.root, id);
  assert.equal(saved.opencode.sessionFingerprint, next.sessionFingerprint);
  assert.equal(saved.opencode.fingerprint, next.fingerprint);
  assert.ok(saved.messages.some(message => message.text.includes('orchid')));
  await f.finish(plan);
});

test('planrevision bevarer sessionen men afviser en forældet plan og afsendelsesbinding', async t => {
  const f = await fixture(t);
  await f.send('plan'); await f.finish(plan);
  const first = await f.prepare('build'), oldPlanID = f.bench.chat.plan.id;
  await f.bench.editPlan({ planID: oldPlanID, text: plan.replace('En lokal side.', 'En lokal side med to afsnit.') });
  await assert.rejects(f.bench.send({ text: 'Old plan', fingerprint: first.fingerprint }), /Planen har ændret sig/);
  assert.equal(f.engines.length, 1);
  const next = await f.prepare('build');
  assert.notEqual(next.planID, oldPlanID);
  assert.notEqual(next.fingerprint, first.fingerprint);
  assert.equal(next.sessionFingerprint, first.sessionFingerprint);
  await assert.rejects(f.bench.send({ text: 'Old review', fingerprint: first.fingerprint }), /Gennemgå/);
  await f.bench.send({ text: 'Approved revised plan', fingerprint: next.fingerprint });
  assert.equal(f.engines.at(-1).options.resume, f.engines[0].session.id);
  await f.finish();
});

for (const change of ['model', 'connection', 'revision', 'route', 'references', 'rules', 'instructions', 'engine-version']) {
  test(`ændret ${change} starter ny session uden at genbruge en gammel afsendelsesbinding`, async t => {
    const f = await fixture(t);
    const first = await f.send(); await f.finish();
    const old = f.engines[0].session.id, extra = {};
    if (change === 'model') extra.modelID = 'model-b';
    if (change === 'connection') extra.connectionID = (await f.bench.saveConnection({ kind: 'compatible', name: f.connection.name, baseURL: f.connection.baseURL })).connections.find(item => item.id !== f.connection.id).id;
    if (change === 'revision') await f.bench.saveConnection({ id: f.connection.id, kind: 'compatible', name: f.connection.name, baseURL: f.connection.baseURL });
    if (change === 'route') {
      // Rutevalg er kontrolleret; modelkataloget og forberedelsen er stadig rigtige.
      f.bench.routes = async () => [{ id: 'route-b', name: 'Synthetic route B' }];
      extra.routeID = 'route-b';
    }
    if (change === 'references') extra.references = ['references/reference.md'];
    if (change === 'rules') await f.bench.skills.save(f.root, { id: 'faelles-grundregler', content: 'Synthetic changed project rules.' });
    if (change === 'instructions') await fs.writeFile(path.join(f.root, 'AGENTS.md'), 'Synthetic project instructions.');
    if (change === 'engine-version') {
      const engine = require('../core/engine.cjs'), original = engine.VERSION;
      engine.VERSION = 'synthetic-other-version';
      t.after(() => { engine.VERSION = original; });
    }
    const next = await f.prepare('chat', extra);
    assert.notEqual(next.sessionFingerprint, first.sessionFingerprint);
    if (change !== 'engine-version') await assert.rejects(f.bench.send({ text: 'Old review', fingerprint: first.fingerprint }), /Gennemgå/);
    await f.bench.send({ text: 'Reviewed changed selection', fingerprint: next.fingerprint });
    assert.equal(f.engines.at(-1).options.resume, null);
    assert.notEqual(f.engines.at(-1).session.id, old);
    await f.finish();
  });
}

test('samme kontonavn og adresse giver ikke adgang til en anden forbindelses session', async t => {
  const f = await fixture(t);
  // Ældre gemte forbindelser kan mangle revision. Metadata alene er ikke et konto-id.
  await f.bench.store.update(state => { delete state.connections[0].revision; });
  const first = await f.send(); await f.finish();
  const other = { ...(await f.bench.connection(f.connection.id)), id: 'synthetic-other-connection' };
  await f.bench.store.update(state => { state.connections.push(other); });
  const next = await f.prepare('chat', { connectionID: other.id });
  assert.equal(next.fingerprint, first.fingerprint, 'det gamle fingerprint skelnede ikke mellem ens metadata');
  assert.notEqual(next.sessionFingerprint, first.sessionFingerprint);
  assert.equal(next.accepted, false, 'modtageraccept er stadig bundet til konto-id');
  await f.bench.send({ text: 'New connection', fingerprint: next.fingerprint });
  assert.equal(f.engines.at(-1).options.resume, null);
  await f.finish();
});

test('Byg kræver fortsat en konkret og aktuel plan, før motoren kan starte', async t => {
  const f = await fixture(t);
  await assert.rejects(f.prepare('build'), /seneste plan/);
  await f.send('plan'); await f.finish(plan);
  await assert.rejects(f.prepare('build', { planID: 'synthetic-stale-plan' }), /seneste plan/);
  assert.equal(f.engines.length, 1);
  assert.equal(f.bench.chat.allowProjectEdits, false);
});

test('ældre historik uden sessionsbinding starter én ny session og bevarer lokal samtale og plan', async t => {
  const f = await fixture(t);
  const first = await f.send('plan'); await f.finish(plan);
  const old = f.engines[0].session.id, planID = f.bench.chat.plan.id;
  await f.bench.chat.close(false);
  f.bench.chat.data = await f.bench.history.updateChat(f.root, f.bench.chat.id, data => { data.opencode = { session: old, fingerprint: first.fingerprint }; });
  await f.send('plan');
  assert.equal(f.engines.at(-1).options.resume, null);
  const modern = f.engines.at(-1).session.id;
  assert.notEqual(modern, old);
  assert.equal(f.bench.chat.lastPlan.id, planID);
  await f.finish(plan);
  const saved = await f.bench.history.readChat(f.root, f.bench.chat.id);
  assert.ok(saved.messages.some(message => message.text === 'Synthetic user request'));
  assert.match(saved.opencode.sessionFingerprint, /^[a-f0-9]{64}$/);
  await f.bench.close(); await f.bench.activate(f.project);
  await f.send('build');
  assert.equal(f.engines.at(-1).options.resume, modern);
  await f.finish();
});

test('genoptaget session giver ingen opgavegodkendelse videre til næste kørsel', async t => {
  const f = await fixture(t);
  await f.send('plan'); await f.finish(plan); await f.send('build');
  const chat = f.bench.chat, engine = chat.engine;
  const first = { id: 'first-edit', permission: 'edit', metadata: { filepath: path.join(f.root, 'source.txt') }, patterns: [] };
  engine.pending.set(first.id, first);
  await chat.permissionAsked({ type: 'permission.asked', properties: first });
  await chat.reply({ id: first.id, allow: true, scope: 'task' });
  assert.equal(chat.allowProjectEdits, true);
  await f.finish(); await f.send('build');
  assert.equal(chat.engine, engine, 'uændret kørsel må genbruge motoren');
  assert.equal(chat.allowProjectEdits, false);
  assert.equal(chat.taskRules.size, 0);
  const second = { ...first, id: 'second-edit' };
  engine.pending.set(second.id, second);
  await chat.permissionAsked({ type: 'permission.asked', properties: second });
  assert.equal(engine.pending.has(second.id), true);
  assert.equal(chat.waiting, true);
  assert.equal(chat.approvals.has(second.id), true);
  assert.deepEqual(engine.replies.map(reply => reply[0]), ['first-edit']);
  await chat.reply({ id: second.id, allow: false }); await f.finish();
});

test('projektets instruktioner ændret efter gennemgang blokerer før motoren får beskeden', async t => {
  const f = await fixture(t);
  await f.send('plan'); await f.finish(plan);
  const reviewed = await f.prepare('build');
  await fs.writeFile(path.join(f.root, 'AGENTS.md'), 'Changed after review.');
  await assert.rejects(f.bench.send({ text: 'Do not send', fingerprint: reviewed.fingerprint }), /AGENTS.md har ændret sig/);
  assert.equal(f.engines.length, 1);
  assert.equal(f.engines[0].sent.length, 1);
});
