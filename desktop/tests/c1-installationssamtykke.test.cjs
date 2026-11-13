// R#19: kun brugerens gennemgåede Start huskes som samtykke. En installationsgennemgang viser hverken startkommandoen eller
// teksten om, at projektkode køres, så den må ikke lade AI'en starte projektets kode bagefter (beslutningen fra 3. november:
// "Brugerens Start i forhåndsvisningens dialog huskes som samtykke"). Prøven kører main.cjs' egen tekst for preview:prepare og
// preview:execute mod det rigtige lager og den rigtige aiPreview; kun DevServer er en attrap, så intet installeres eller startes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { desktopRequire, tempDir, previewMain } = require('./c1-main-kilde.cjs');
const { Store } = desktopRequire('./core/store.cjs');
const { aiPreview } = desktopRequire('./core/ai-preview.cjs');

function fakeServer(fingerprint) {
  const server = { state: 'idle', root: '/projekt', executed: [], output: '', message: '' };
  server.prepare = async (action, scripts = false) => ({ token: `gennemgang-${action}`, root: server.root, action, scripts, project: { fingerprint, installed: true, kind: 'services' }, command: action === 'install' ? 'npm ci' : 'node server.js' });
  server.execute = async token => { server.executed.push(token); server.state = token.endsWith('start') ? 'running' : 'installed'; return server.snapshot(); };
  server.status = async () => ({ ...server.snapshot(), project: { fingerprint, installed: true, kind: 'services', diagnostics: [] } });
  server.snapshot = () => ({ state: server.state, url: server.state === 'running' ? 'http://127.0.0.1:3000/' : null, message: '', output: '' });
  return server;
}
async function world(t) {
  const dir = await tempDir(t, 'aura-c1-samtykke-'), root = path.join(dir, 'projekt');
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  const main = previewMain({ root, store });
  const server = fakeServer('aftryk-1');
  const space = { root, owner: main.owner, devServer: server, ready: Promise.resolve() };
  main.spaces.set(root, space);
  return { main, store, root, space, server };
}

test('en godkendt installation giver ikke samtykke til at starte projektets kode', async t => {
  const { main, store, root, space, server } = await world(t);
  const review = await main.handlers['preview:prepare']({ action: 'install' });
  await main.handlers['preview:execute'](review.token);
  assert.deepEqual(server.executed, ['gennemgang-install']);
  assert.equal((await store.project(root)).previewConsent, undefined, 'installationen huskes ikke som startsamtykke');
  // AI'ens aura_preview skal derfor bede brugeren trykke Start i stedet for at starte serveren selv.
  server.state = 'idle';
  const answer = await aiPreview(space, 'start', { wait: async () => {} });
  assert.equal(answer.state, 'needs_consent');
  assert.deepEqual(server.executed, ['gennemgang-install'], 'AI’en startede intet');
});

test('en godkendt start huskes stadig som samtykke for netop dette fingeraftryk', async t => {
  const { main, store, root, server } = await world(t);
  const review = await main.handlers['preview:prepare']({ action: 'start', scripts: true });
  await main.handlers['preview:execute'](review.token);
  const consent = (await store.project(root)).previewConsent;
  assert.equal(consent.fingerprint, 'aftryk-1'); assert.equal(consent.scripts, true);
  assert.deepEqual(server.executed, ['gennemgang-start']);
});

test('et andet token end den gennemgåede handling giver intet samtykke', async t => {
  const { main, store, root } = await world(t);
  await main.handlers['preview:prepare']({ action: 'start' });
  await main.handlers['preview:execute']('et-andet-token');
  assert.equal((await store.project(root)).previewConsent, undefined);
});
