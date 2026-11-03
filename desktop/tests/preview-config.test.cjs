// AI'en kan beskrive projektets opstart i .aura/preview.json (beslutning for beta 2, årsag 6). Filen er projektindhold, så den læses
// defensivt, bruges kun når brugeren ikke selv har sat en opstart, og kommandoerne bliver gennemgået, før noget starter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readStartupFile, effectiveRuntime } = require('../core/preview-config.cjs');

async function projekt(t, files = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-opstart-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
  return root;
}
const gyldig = JSON.stringify({ services: [{ id: 'web', label: 'Webside', command: ['npm', 'run', 'dev', '--', '--host', '{host}', '--port', '{port}'], cwd: 'frontend' }] });

test('en gyldig opstartsfil giver tjenester, og en manglende fil giver ingenting', async t => {
  const root = await projekt(t, { '.aura/preview.json': gyldig });
  assert.equal((await readStartupFile(root)).services[0].id, 'web');
  assert.equal(await readStartupFile(await projekt(t)), null);
});

test('en ugyldig, for stor eller linket fil afvises i stedet for at blive fortolket', async t => {
  assert.equal(await readStartupFile(await projekt(t, { '.aura/preview.json': '{ ikke json' })), null);
  assert.equal(await readStartupFile(await projekt(t, { '.aura/preview.json': JSON.stringify({ services: [{ id: 'x', label: 'x', command: ['rm', '-rf', '/'], cwd: '../uden' }] }) })), null, 'sti uden for projektet afvises');
  assert.equal(await readStartupFile(await projekt(t, { '.aura/preview.json': ' '.repeat(40_000) })), null);
  const root = await projekt(t, { 'andet.json': gyldig }); await fs.mkdir(path.join(root, '.aura'));
  await fs.symlink(path.join(root, 'andet.json'), path.join(root, '.aura', 'preview.json'));
  assert.equal(await readStartupFile(root), null, 'et link afvises');
});

test('brugerens egen opstart går forud for filen; uden en bruges filen', async t => {
  const root = await projekt(t, { '.aura/preview.json': gyldig });
  const brugerens = { mode: 'auto', services: [{ id: 'egen', label: 'Egen', command: ['node', 'server.cjs'] }] };
  assert.equal((await effectiveRuntime(root, brugerens)).services[0].id, 'egen');
  assert.equal((await effectiveRuntime(root, { mode: 'auto' })).services[0].id, 'web');
  assert.equal((await effectiveRuntime(root, { mode: 'static' })).mode, 'static', 'Enkel hjemmeside er et bevidst valg');
});
