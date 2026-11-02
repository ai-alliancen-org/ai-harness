const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { parseUnifiedDiff, commandHints, failureText, commandResult } = require('../ui/approval-view.js');
const { startGateway } = require('../core/gateway.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

test('filændringens diff fra OpenCode tælles og vises uden filhoveder', () => {
  const diff = 'Index: /p/public/index.html\n===================================================================\n--- /p/public/index.html\n+++ /p/public/index.html\n@@ -1,3 +1,3 @@\n <h1>A</h1>\n-<p>B</p>\n+<p>C</p>\n <p>D</p>\n@@ -10,1 +10,2 @@\n x\n+y\n';
  const parsed = parseUnifiedDiff(diff);
  assert.equal(parsed.added, 2); assert.equal(parsed.removed, 1); assert.equal(parsed.created, false);
  assert.deepEqual(parsed.rows.map(row => [row.type, row.old, row.new, row.text]), [[' ', 1, 1, '<h1>A</h1>'], ['-', 2, null, '<p>B</p>'], ['+', null, 2, '<p>C</p>'], [' ', 3, 3, '<p>D</p>'], ['gap', undefined, undefined, undefined], [' ', 10, 10, 'x'], ['+', null, 11, 'y']]);
  assert.equal(parseUnifiedDiff('--- /dev/null\n+++ /p/ny.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n').created, true);
});

test('kommandoer får et gæt i almindeligt dansk, og afslutningskoden afgør resultatet', () => {
  assert.deepEqual(commandHints('npm install express'), ['Installerer pakker fra internettet']);
  assert.deepEqual(commandHints('rm -rf dist && npm run build'), ['Kan slette eller overskrive filer', 'Kører projektets kode']);
  assert.deepEqual(commandHints('git push origin main'), ['Kontakter andre computere på internettet', 'Ændrer projektets Git-historik']);
  assert.deepEqual(commandHints('npm test'), ['Kører projektets tests']);
  assert.deepEqual(commandHints('ls -la'), ['Ser ud til kun at læse eller vise noget']);
  assert.deepEqual(commandHints('./ukendt-program'), []);
  assert.deepEqual(commandResult({ status: 'completed', exit: 0 }), { ok: true, text: 'Afsluttet uden fejl (kode 0)' });
  assert.deepEqual(commandResult({ status: 'completed', exit: 2 }), { ok: false, text: 'Afsluttet med fejl (kode 2)' });
  assert.equal(commandResult({ status: 'completed', exit: null }).ok, null);
  assert.match(commandResult({ status: 'error', error: 'Afvist' }).text, /Mislykkedes: Afvist/);
  assert.equal(failureText('key').action, 'connection'); assert.equal(failureText('quota').action, 'account'); assert.equal(failureText('ukendt').title, failureText('model').title);
});

test('modelserverens fejl får en type, så appen kan vise den rigtige vej videre', async t => {
  let status = 401;
  const server = http.createServer(async (req, res) => { for await (const _ of req) {} res.writeHead(status); res.end('privat'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); server.close(); });
  // Endelige fejl kaldes af gatewayen med en type. Forbigående fejl (429 og 5xx) videresendes til OpenCode, som genforsøger,
  // og typen kommer i stedet fra OpenCodes egen fejl, når den giver op (sessionFailure læser error.data.statusCode).
  for (const [code, kind] of [[401, 'key'], [403, 'access'], [402, 'quota'], [404, 'notfound'], [400, 'rejected']]) {
    status = code; const failures = [];
    const gateway = await startGateway({ kind: 'compatible', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'm' }, '', null, (message, failure) => failures.push([message, failure]));
    await fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'm' }) });
    assert.equal(failures[0][1].kind, kind, String(code)); assert.equal(failures[0][1].status, code); assert.match(failures[0][0], new RegExp(`HTTP ${code}`));
    await gateway.close();
  }
});

test('forbigående fejl får typen fra OpenCodes endelige fejl, så resultatkortet kan vise den rigtige vej videre', async () => {
  const { sessionFailure } = require('../core/chat-session.cjs');
  assert.equal(sessionFailure({ data: { statusCode: 429 } }), 'limit');
  assert.equal(sessionFailure({ data: { statusCode: 503 } }), 'server');
  assert.equal(sessionFailure({ data: { statusCode: 500 } }), 'server');
});

test('afvisning med en besked sendes til motoren og stopper ikke; Stop giver et resultatkort med det, AI’en nåede', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-godkend-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projekt'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'a.txt'), 'før\n');
  const events = [], calls = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root, name: 'Prøve' }); const chat = bench.chat;
  chat.running = true; chat.runMode = 'build';
  chat.engine = { pending: new Map(), reply: async (...args) => calls.push(args), abort: async () => {}, close: async () => {} };
  // Godkendelsen skal komme ad appens egen vej, så den har kontekst, fingeraftryk og en ventende anmodning i motoren.
  const ask = async id => {
    const properties = { id, permission: 'bash', metadata: {}, patterns: [] };
    chat.engine.pending.set(id, properties);
    await chat.permissionAsked({ type: 'permission.asked', properties });
  };
  await ask('p1'); await ask('p2');
  assert.equal(chat.approvals.size, 2, 'begge godkendelser venter på svar');
  await bench.reply({ id: 'p1', allow: false, message: '  Brug ikke npm. Skriv det i ren JavaScript.  ' });
  await bench.reply({ id: 'p2', allow: false });
  assert.deepEqual(calls, [['p1', false, 'Brug ikke npm. Skriv det i ren JavaScript.'], ['p2', false, '']]);
  assert.equal(bench.activityList().find(entry => entry.id === 'approval-p1').status, 'corrected');
  assert.equal(bench.activityList().find(entry => entry.id === 'approval-p2').status, 'rejected');
  // En kørende opgave stoppes, efter at AI'en har skrevet en fil og kørt en kommando med fejl.
  const { capture } = require('../core/changes.cjs');
  chat.runBefore = await capture(root); chat.runTools = new Map(); chat.runFailure = null;
  chat.task = { id: 'opgave', root, label: 'Byg', mode: 'build', startedAt: 1, aiFiles: new Set(), aiHashes: new Map(), reads: [], completed: new Set(), commandParts: new Set(), commands: 0 };
  await fs.writeFile(path.join(root, 'a.txt'), 'efter\n');
  chat.runTools.set('t1', { id: 't1', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' }, title: 'npm test', output: 'linje 1\nlinje 2\nFEJL: 1 test fejlede\ntoken=sk-abcdefghijklmnopqrstuv', metadata: { exit: 1 } } });
  await bench.stop();
  const review = events.find(event => event.type === 'run.review');
  assert.equal(review.status, 'stopped'); assert.deepEqual(review.files, ['a.txt']); assert.equal(review.task, 'opgave');
  assert.deepEqual(review.tools.map(tool => [tool.tool, tool.exit]), [['bash', 1]]);
  assert.match(review.tools[0].output, /FEJL: 1 test fejlede/); assert.doesNotMatch(review.tools[0].output, /sk-abcdefghij/);
  assert.ok(events.findIndex(event => event.type === 'run.review') < events.findIndex(event => event.type === 'run.status' && event.status === 'stopped'), 'kortet kommer før statusskiftet');
  chat.engine = null; await bench.close();
});

test('godkendelsen får værktøjets egne oplysninger med, og en fejl fra OpenCode får en type', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-godkend-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const events = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root: directory, name: 'Prøve' }); const chat = bench.chat;
  chat.running = true; chat.runTools = new Map([['del', { id: 'del', callID: 'kald-1', tool: 'bash', state: { status: 'running', input: { command: 'npm test', description: 'Kører testene', workdir: path.join(directory, 'web') } } }]]);
  const properties = { id: 'p', permission: 'bash', patterns: ['npm test'], metadata: {}, tool: { messageID: 'm', callID: 'kald-1' } };
  // Uden en ventende anmodning i motoren vises godkendelsen ikke; det er netop meningen.
  chat.engine = { pending: new Map(), reply: async () => {}, abort: async () => {}, close: async () => {} };
  await chat.permissionAsked({ type: 'permission.asked', properties });
  assert.equal(events.some(event => event.type === 'permission.asked'), false, 'en godkendelse uden anmodning i motoren vises ikke');
  chat.engine.pending.set('p', properties);
  await chat.permissionAsked({ type: 'permission.asked', properties });
  const asked = events.find(event => event.type === 'permission.asked');
  const input = { command: 'npm test', description: 'Kører testene', workdir: path.join(directory, 'web') };
  assert.deepEqual(asked.properties.toolInput, { ...input, tool: 'bash', input });
  chat.event({ type: 'session.error', properties: { error: { name: 'APIError', data: { message: 'Rate limit', statusCode: 429 } } } });
  assert.deepEqual(chat.runFailure, { kind: 'limit', status: 429, message: 'Rate limit' });
  chat.running = false; chat.engine = null; await bench.close();
});

test('en lang ændring vises 400 rækker ad gangen, og kun rigtige linjer tælles', () => {
  const { diffPage } = require('../ui/approval-view.js');
  const rows = [...Array.from({ length: 450 }, () => ({ type: '+' })), { type: 'gap' }, ...Array.from({ length: 455 }, () => ({ type: ' ' }))];
  let page = diffPage(rows, 0);
  assert.deepEqual(page, { end: 400, status: 'Viser 400 af 905 linjer i ændringen.', more: 'Vis 400 linjer mere' });
  page = diffPage(rows, page.end);
  assert.deepEqual(page, { end: 801, status: 'Viser 800 af 905 linjer i ændringen.', more: 'Vis 105 linjer mere' }, 'skilletegnet tæller ikke, og knappen lover præcis det, der kommer');
  page = diffPage(rows, page.end);
  assert.deepEqual(page, { end: 906, status: 'Alle 905 linjer vises.', more: '' });
  assert.equal(diffPage(Array.from({ length: 401 }, () => ({ type: '+' })), 0).more, 'Vis 1 linje mere');
  assert.deepEqual(diffPage([{ type: '+' }, { type: 'gap' }, { type: '-' }], 0), { end: 3, status: '', more: '' }, 'en kort ændring har hverken tæller eller knap');
  const gaps = Array.from({ length: 1800 }, (_, i) => ({ type: i % 2 ? 'gap' : '+' }));
  const first = diffPage(gaps, 0);
  assert.deepEqual([first.status, first.more], ['Viser 400 af 900 linjer i ændringen.', 'Vis 400 linjer mere'], 'mange skilletegn skjuler ikke resten');
  assert.deepEqual(diffPage(Array.from({ length: 500 }, (_, i) => ({ type: i % 2 ? 'gap' : '+' })), 0), { end: 500, status: '', more: '' }, '250 linjer med skilletegn står på én side');
});
