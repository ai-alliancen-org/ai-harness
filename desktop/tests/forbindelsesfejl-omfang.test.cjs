// Fund 13, hovedprocessens del: fejl i AI-forbindelsen, kataloget og modelvalget før afsendelse bærer
// scope: 'connection', og handle-indpakningen i main.cjs sender omfanget med til brugerfladen. Fejl senere i
// forberedelsen, fx en forældet filhenvisning, har intet omfang. Brugerfladens del står i
// tests/forberedelse-fejlomfang.test.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

async function miljoe(t) {
  let status = 200;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (status !== 200) { res.writeHead(status); return res.end(JSON.stringify({ error: { message: 'Unauthorized' } })); }
    res.end(JSON.stringify({ data: [{ id: 'm', name: 'Model' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-fejlomfang-'));
  t.after(async () => { server.closeAllConnections(); server.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, 'projekt'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'index.html'), Array.from({ length: 10 }, (_, i) => `<p>${i}</p>`).join('\n'));
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  t.after(() => bench.close?.());
  await bench.activate({ root, name: 'Prøve' });
  const id = await bench.storeConnection({ kind: 'compatible', name: 'Lokal', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
  return { bench, id, afvis: () => { status = 401; } };
}

test('fejl i forbindelsen og kataloget før afsendelse er mærket som forbindelsens', async t => {
  const { bench, id, afvis } = await miljoe(t);
  await assert.rejects(bench.selection({ connectionID: 'findes-ikke', modelID: 'm' }), error => error.scope === 'connection');
  await assert.rejects(bench.selection({ connectionID: id, modelID: 'en-anden-model' }), error => /findes ikke længere/.test(error.message) && error.scope === 'connection');
  afvis();
  await assert.rejects(bench.selection({ connectionID: id, modelID: 'm' }), error => /afviste adgangen/.test(error.message) && error.scope === 'connection');
});

test('en forældet filhenvisning efter et katalog, der svarede, er ikke forbindelsens fejl', async t => {
  const { bench, id } = await miljoe(t);
  await assert.rejects(bench.chat.prepare({ connectionID: id, modelID: 'm', mode: 'chat', fileRefs: [{ path: 'index.html', from: 120, to: 140 }] }),
    error => /^index\.html: /.test(error.message) && error.scope === undefined);
});

test('handle-indpakningen i main.cjs sender omfanget med, og kun det', async () => {
  const kilde = fsSync.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const a = kilde.indexOf('function handle(channel, action) {'), b = kilde.indexOf("handle('updates:state'", a);
  assert.ok(a >= 0 && b > a, 'handle findes i main.cjs');
  const lyttere = new Map(), sender = {}, uiURL = 'harness://app/index.html';
  const context = {
    ipcMain: { handle: (channel, fn) => lyttere.set(channel, fn) },
    window: { webContents: Object.assign(sender, { mainFrame: { url: uiURL } }) },
    uiURL, updating: false, recordFailure() {}, registry: { selected: { chatFor: () => null, project: { root: '/p' } }, get: () => null },
    requests: { run: (_context, fn) => fn() }
  };
  vm.createContext(context); vm.runInContext(kilde.slice(a, b), context);
  // Svaret kopieres til prøvens egen realm, så deepEqual sammenligner indholdet og ikke vm-kontekstens prototyper.
  const kald = async fejl => { context.handle('agent:prepare', () => { throw fejl; }); return { ...await lyttere.get('agent:prepare')({ sender, senderFrame: sender.mainFrame }, {}, null) }; };
  assert.deepEqual(await kald(Object.assign(new Error('Serveren afviste adgangen.'), { scope: 'connection' })), { ok: false, error: 'Serveren afviste adgangen.', scope: 'connection' });
  assert.deepEqual(await kald(new Error('index.html: Linjerne findes ikke i filen.')), { ok: false, error: 'index.html: Linjerne findes ikke i filen.' });
  assert.deepEqual(await kald(Object.assign(new Error('Andet'), { scope: 'noget-andet' })), { ok: false, error: 'Andet' }, 'kun det kendte omfang sendes med');
});
