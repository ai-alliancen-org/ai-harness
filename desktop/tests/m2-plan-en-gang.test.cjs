const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Workbench } = require('../core/workbench.cjs');

const profiles = path.resolve(__dirname, '../../profiles');
const MARKOER = 'UNIK-PLANMARKOER-7731';
// En realistisk plan på omkring 3000 tegn med en markør, så antallet af kopier i prompten kan tælles.
const plan = ['## Det bygger vi', 'En oversigt over lokaler. ' + MARKOER, '## Sådan skal det se ud', 'Rolig side med store knapper. ' + 'Tekst om layout og farver. '.repeat(40), '## Teknik og data', 'HTML og CSS uden netværk. ' + 'Tekst om data og filer. '.repeat(40), '## Det skal du prøve', 'Åbn forhåndsvisningen og læs overskriften. ' + 'Tekst om prøven. '.repeat(30)].join('\n');

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


const count = (text, part) => text.split(part).length - 1;

// Årsag 8a: planen sendes kun én gang i Byg. Brugerens egne svar fra afklaringen bevares, planteksten gentages ikke i context.
test('Byg sender planteksten én gang, og brugerens svar fra afklaringen bevares', async t => {
  const f = await fixture(t);
  await f.send('plan'); await f.finish(plan);
  const chat = f.bench.chat;
  assert.ok(chat.plan, 'planen er klar');
  const review = await f.prepare('build');
  const system = review.appContext.components.map(part => part.text).join('');
  t.diagnostic(`prompt i Byg: ${system.length} tegn, plantekst ${plan.length} tegn, context ${chat.plan.context.length} tegn, kopier af planen: ${count(system, MARKOER)}`);
  assert.equal(count(chat.plan.context, MARKOER), 0, 'context indeholder ikke planteksten');
  assert.match(chat.plan.context, /Synthetic user request/, 'brugerens eget svar fra afklaringen bevares');
  assert.equal(count(system, MARKOER), 1);
});

test('en anden planrunde tager ikke den første plans tekst med i context', async t => {
  const f = await fixture(t);
  await f.send('plan'); await f.finish(plan);
  const second = plan.replace(MARKOER, 'ANDEN-PLANMARKOER-5512');
  await f.send('plan'); await f.finish(second);
  const chat = f.bench.chat;
  assert.equal(count(chat.plan.context, MARKOER), 0);
  assert.equal(count(chat.plan.context, 'ANDEN-PLANMARKOER-5512'), 0);
  const system = (await f.prepare('build')).appContext.components.map(part => part.text).join('');
  assert.equal(count(system, 'ANDEN-PLANMARKOER-5512'), 1);
  assert.equal(count(system, MARKOER), 0, 'den gamle plan er ikke med');
});
