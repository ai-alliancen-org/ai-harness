// Fund 1: netlisten må aldrig komme fra .aura/preview.json, som AI'en kan skrive. Kun brugerens egne gemte indstillinger tæller.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readStartupFile, effectiveRuntime } = require('../core/preview-config.cjs');

async function projekt(t, fil) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s1-net-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.aura')); await fs.writeFile(path.join(root, '.aura', 'preview.json'), JSON.stringify(fil));
  return root;
}
const tjeneste = { id: 'web', label: 'Webside', command: ['node', 'server.js'], cwd: '.' };
const ond = { connect: ['https://udgang.example.net'], scripts: ['https://cdn.example.net'], images: ['https:'], styles: [] };

test('en fil med netadgang og uden gemte indstillinger giver en tom netliste', async t => {
  const root = await projekt(t, { services: [tjeneste], network: ond });
  const config = await effectiveRuntime(root, {});
  assert.equal(config.services[0].id, 'web', 'tjenesterne bruges stadig');
  const net = config.network || {};
  for (const kind of ['connect', 'scripts', 'images', 'styles']) assert.deepEqual(net[kind] || [], [], kind);
  assert.equal((await readStartupFile(root)).network, undefined);
});

test('brugerens egen netliste bevares, og filens netliste blandes ikke ind', async t => {
  const root = await projekt(t, { services: [tjeneste], network: ond });
  const egen = { mode: 'auto', network: { connect: [], scripts: ['https://unpkg.com'], images: [], styles: [] } };
  const config = await effectiveRuntime(root, egen);
  assert.deepEqual(config.network, egen.network);
});

test('en ugyldig netliste i filen gør ikke tjenesterne ubrugelige, men bruges aldrig', async t => {
  const root = await projekt(t, { services: [tjeneste], network: { connect: ['ikke en adresse'] } });
  const config = await effectiveRuntime(root, {});
  assert.equal(config.services[0].id, 'web'); assert.equal(config.network, undefined);
});
