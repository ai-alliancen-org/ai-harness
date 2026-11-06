// Opfølgning på skeptikerens fund: startfilernes moduler, flere private adresseformer og en Overblik-fane, der ikke blinker tom.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { inspect } = require('../core/dev-server.cjs');
const { privateHost, allowedRequest } = require('../core/preview-policy.cjs');
const view = require('../ui/system-overview-view.js');

async function projekt(t, files) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s1-skep-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}
const egen = cmd => ({ mode: 'auto', services: [{ id: 'web', label: 'Web', command: cmd, cwd: '.' }] });
const aftryk = async (root, config = { mode: 'auto' }) => (await inspect(root, config)).fingerprint;
async function ændrerSig(t, files, config, fil, nyt = 'ændret();') {
  const root = await projekt(t, files);
  const før = await aftryk(root, config);
  assert.equal(await aftryk(root, config), før);
  await fs.writeFile(path.join(root, fil), nyt);
  return (await aftryk(root, config)) !== før;
}

test('et modul, som startfilen indlæser, indgår i fingeraftrykket', async t => {
  assert.equal(await ændrerSig(t, { 'server.js': "const r = require('./lib/routes'); r();", 'lib/routes.js': 'a' }, egen(['node', 'server.js']), 'lib/routes.js'), true);
  assert.equal(await ændrerSig(t, { 'server.js': "import r from './lib/routes.js';", 'lib/routes.js': 'a' }, egen(['node', 'server.js']), 'lib/routes.js'), true);
  assert.equal(await ændrerSig(t, { 'server.js': "const r = require('./lib');", 'lib/index.js': 'a' }, egen(['node', 'server.js']), 'lib/index.js'), true);
  assert.equal(await ændrerSig(t, { 'server.js': "require('./a')", 'a.js': "require('./b')", 'b.js': 'x' }, egen(['node', 'server.js']), 'b.js'), true, 'også moduler i flere led');
});

test('en startfil uden endelse og pakkens main dækkes', async t => {
  assert.equal(await ændrerSig(t, { 'server.js': 'a' }, egen(['node', 'server']), 'server.js'), true);
  assert.equal(await ændrerSig(t, { 'package.json': JSON.stringify({ main: 'app.js', scripts: { start: 'node .' } }), 'app.js': 'a' }, { mode: 'auto' }, 'app.js'), true);
  assert.equal(await ændrerSig(t, { 'package.json': JSON.stringify({ scripts: { start: 'node server' } }), 'server.js': 'a' }, { mode: 'auto' }, 'server.js'), true);
  assert.equal(await ændrerSig(t, { 'package.json': JSON.stringify({ scripts: { start: 'node .' } }), 'index.js': 'a' }, { mode: 'auto' }, 'index.js'), true);
});

test('en fil, som ingen start- eller modulkæde peger på, ændrer ikke fingeraftrykket', async t => {
  assert.equal(await ændrerSig(t, { 'server.js': "require('./a')", 'a.js': 'x', 'ude.js': 'y', 'data.json': '1' }, egen(['node', 'server.js']), 'ude.js'), false);
  assert.equal(await ændrerSig(t, { 'server.js': "require('./a'); require('express')", 'a.js': 'x', 'data.json': '1' }, egen(['node', 'server.js']), 'data.json'), false);
});

test('modulløkker og moduler uden for projektet gør ikke fingeraftrykket usikkert', async t => {
  const root = await projekt(t, { 'server.js': "require('./a'); require('../ude')", 'a.js': "require('./server')" });
  assert.equal(typeof await aftryk(root, egen(['node', 'server.js'])), 'string');
});

test('privateHost lukker flere former for lokale og private adresser', () => {
  const værter = ['https://[::127.0.0.1]/x.png', 'https://[64:ff9b::7f00:1]/x', 'https://[64:ff9b::10.0.0.1]/x', 'https://100.64.0.1/x', 'https://100.127.255.254/x', 'https://[::ffff:10.0.0.1]/x', 'https://[2002:7f00:1::]/x', 'https://[::10.1.2.3]/x', 'https://[0:0:0:0:0:0:0:1]/x', 'https://[::ffff:0:192.168.1.1]/x'];
  for (const url of værter) assert.equal(privateHost(new URL(url).hostname), true, url);
  for (const url of ['https://8.8.8.8/x', 'https://100.128.0.1/x', 'https://[2606:4700::1111]/x', 'https://[64:ff9b::808:808]/x', 'https://example.com/x']) assert.equal(privateHost(new URL(url).hostname), false, url);
  const policy = { origin: 'http://127.0.0.1:3000', serviceOrigins: [], network: { images: ['https:'] } };
  assert.equal(allowedRequest({ url: 'https://100.64.0.1/x.png', resourceType: 'image' }, policy), false);
});

function fane() {
  class El { constructor(tag, text) { this.tag = tag; this.textContent = text || ''; this.children = []; this.inert = false; } append(...a) { this.children.push(...a); } replaceChildren(...a) { this.children = a; } }
  const elementer = {}, kald = [];
  const sandbox = { window: { SystemOverviewView: view }, node: (tag, text) => new El(tag, text), $: id => (elementer[id] ||= new El(id)), call: () => new Promise((resolve, reject) => kald.push({ resolve, reject })) };
  vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname, '../ui/system-overview.js'), 'utf8'), sandbox);
  const model = navn => ({ technologies: [{ name: navn, kind: 'x', source: 'y' }], services: [], hosting: [], secrets: [], notes: [], scanned: 1, externalAI: [] });
  const tekst = () => JSON.stringify(elementer['#overview-body']?.children, (k, v) => k === 'tag' ? undefined : v);
  return { api: sandbox.window.systemOverview, elementer, kald, model, tekst };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('en afsluttet opgave opdaterer Overblik, uden at fanen bliver tom undervejs', async () => {
  const f = fane();
  f.api.show(); f.kald[0].resolve({ value: f.model('FØR') }); await tick();
  f.api.stale(); f.api.show();
  assert.equal(f.kald.length, 2, 'der læses igen');
  assert.match(f.tekst(), /FØR/, 'det gamle overblik står, mens det nye læses');
  f.kald[1].resolve({ value: f.model('EFTER') }); await tick();
  assert.match(f.tekst(), /EFTER/);
});

test('et mislykket genindlæs fjerner ikke det overblik, der allerede står', async () => {
  const f = fane();
  f.api.show(); f.kald[0].resolve({ value: f.model('BLIVER') }); await tick();
  f.api.stale(); f.api.show(); f.kald[1].reject(Error('netværk')); await tick();
  assert.match(f.tekst(), /BLIVER/);
  assert.match(f.elementer['#overview-status'].textContent, /netværk/);
});

test('workspace.js bruger stale() i den åbne fane og invalidate() ellers', async () => {
  const kilde = await fs.readFile(path.join(__dirname, '../ui/workspace.js'), 'utf8');
  const fn = kilde.slice(kilde.indexOf('function staleOverview()'), kilde.indexOf('function staleOverview()') + 300).split('\n')[0];
  assert.match(fn, /active === 'overview'[^}]*systemOverview\?\.stale\(\)[^}]*show\(\)/);
  assert.match(fn, /else window\.systemOverview\?\.invalidate\(\)/);
});
