// N:B2-5: «Forbindelsen blev ændret. Gennemgå oplysningerne igen.» betyder, at forbindelsen blev gemt igen, mens afsendelsen
// blev gjort klar, fx med en ny nøgle. Forbindelsen fejler ikke, og et nyt Send virker. Teksten kommer to steder fra: fra
// arbejdsbænkens valg af forbindelse og model (Workbench.selection) og fra ChatSession.prepare bagefter. Før bar den første
// omfanget 'connection', så brugerfladen markerede forbindelsen «Ikke forbundet» og bad om at gennemgå den, mens den anden kun
// blev vist som besked. Nu behandles samme tekst ens: uden omfang. Det samme gælder et katalogsvar, der er overhalet af en ny
// gemning eller kontrol. En rigtig fejl i forbindelsen bærer stadig omfanget (tests/forbindelsesfejl-omfang.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');
const TEKST = 'Forbindelsen blev ændret. Gennemgå oplysningerne igen.';

async function miljoe(t) {
  // hold: serveren holder næste katalogsvar tilbage, til prøven slipper det, så en ny gemning kan nå at overhale det.
  let held = null;
  const server = http.createServer(async (req, res) => { if (held) { const h = held; held = null; h.received(); await h.released; } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'm', name: 'Model' }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-forbindelse-aendret-'));
  t.after(async () => { server.closeAllConnections(); server.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  t.after(() => bench.close?.());
  await bench.activate({ root, name: 'Prøve' });
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const id = await bench.storeConnection({ kind: 'compatible', name: 'Lokal', baseURL });
  const gemIgen = () => bench.storeConnection({ id, kind: 'compatible', name: 'Lokal igen', baseURL });
  const hold = () => { let received, release; const modtaget = new Promise(resolve => { received = resolve; }), released = new Promise(resolve => { release = resolve; }); held = { received, released }; return Object.assign(() => release(), { modtaget }); };
  return { bench, id, gemIgen, hold };
}

test('gemmes forbindelsen igen under valget af model, bærer fejlen ikke forbindelsens omfang', async t => {
  const { bench, id, gemIgen } = await miljoe(t);
  const routes = bench.routes.bind(bench);
  bench.routes = async (...args) => { const result = await routes(...args); await gemIgen(); return result; };
  const error = await bench.selection({ connectionID: id, modelID: 'm' }).then(() => null, error => error);
  assert.equal(error?.message, TEKST);
  assert.equal(error?.scope, undefined, 'forbindelsen fejler ikke og markeres ikke Ikke forbundet');
});

test('samme tekst fra ChatSession.prepare behandles på samme måde', async t => {
  const { bench, id, gemIgen } = await miljoe(t);
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const context = bench.skills.context.bind(bench.skills);
  bench.skills.context = async (...args) => { entered(); await blocked; return context(...args); };
  const preparing = bench.prepare({ connectionID: id, modelID: 'm', mode: 'chat', text: 'Hej' }).then(() => null, error => error);
  await ready; await gemIgen(); release();
  const error = await preparing;
  assert.equal(error?.message, TEKST);
  assert.equal(error?.scope, undefined);
});

test('et katalogsvar, som en ny gemning har overhalet, bærer heller ikke forbindelsens omfang', async t => {
  const { bench, id, gemIgen, hold } = await miljoe(t);
  // Forbindelsen gemmes igen, mens kataloget hentes til afsendelsen, og katalogsvaret kommer bagefter.
  const slip = hold();
  const selecting = bench.selection({ connectionID: id, modelID: 'm' }).then(() => null, error => error);
  await slip.modtaget; await gemIgen(); slip();
  const error = await selecting;
  assert.equal(error?.message, 'Forbindelsen blev ændret eller kontrolleret igen. Hent modellerne på ny.');
  assert.equal(error?.scope, undefined);
});

test('en rigtig fejl i forbindelsen bærer stadig omfanget', async t => {
  const { bench } = await miljoe(t);
  await assert.rejects(bench.selection({ connectionID: 'findes-ikke', modelID: 'm' }), error => error.scope === 'connection');
});
