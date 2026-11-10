// Samtykket til at starte forhåndsvisningen dækker package.json, lockfiler og opstartsfiler (beslutning 3. november 2026),
// ikke projektets netliste. Et «Tillad» af en adresse må derfor ikke gøre samtykket ugyldigt (gennemgangens fund 24, beta 3).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('../core/dev-server.cjs');
const { consentValid } = require('../core/preview-bridge.cjs');
const { DESIGN_PREVIEW_NETWORK } = require('../core/project-runtime.cjs');

async function project(t, files) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-samtykke-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) await fs.writeFile(path.join(root, file), text);
  return root;
}
const tilladt = { ...DESIGN_PREVIEW_NETWORK, images: ['https://billeder.example.dk'] };

test('Vite: samtykket gælder stadig, efter at brugeren har tilladt en billedadresse', async t => {
  const root = await project(t, { 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '8.3.1' } }) });
  const before = await inspect(root, { mode: 'auto', network: DESIGN_PREVIEW_NETWORK });
  assert.equal(before.kind, 'vite');
  const consent = { fingerprint: before.fingerprint, scripts: false };
  assert.equal(consentValid(consent, (await inspect(root, { mode: 'auto', network: tilladt })).fingerprint), true, 'Tillad ændrer ikke samtykket');
  assert.equal(consentValid(consent, (await inspect(root, { mode: 'auto' })).fingerprint), true, 'heller ikke en tom netliste');
  // Pakkefilerne og opstarten tæller stadig med.
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  assert.equal(consentValid(consent, (await inspect(root, { mode: 'auto', network: tilladt })).fingerprint), false, 'en ny lockfil kræver nyt samtykke');
});

test('lokale tjenester: netlisten ændrer ikke samtykket, men en ændret kommando eller startfil gør', async t => {
  const root = await project(t, { 'server.js': 'require("node:http").createServer().listen(process.env.PORT);\n' });
  const service = command => ({ mode: 'auto', services: [{ id: 'web', label: 'Webside', command, cwd: '.' }] });
  const before = await inspect(root, { ...service(['node', 'server.js']), network: DESIGN_PREVIEW_NETWORK });
  assert.equal(before.kind, 'services');
  const consent = { fingerprint: before.fingerprint };
  assert.equal(consentValid(consent, (await inspect(root, { ...service(['node', 'server.js']), network: tilladt })).fingerprint), true);
  assert.equal(consentValid(consent, (await inspect(root, { ...service(['node', 'server.js', '--debug']), network: tilladt })).fingerprint), false);
  await fs.writeFile(path.join(root, 'server.js'), 'require("node:child_process").exec("noget andet");\n');
  assert.equal(consentValid(consent, (await inspect(root, { ...service(['node', 'server.js']), network: DESIGN_PREVIEW_NETWORK })).fingerprint), false);
});
