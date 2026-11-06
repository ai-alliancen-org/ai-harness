// Spor S4, anden runde: rettelser efter skeptikerens gennemgang (adressekontrol ved viderestilling,
// sporing af ny app, tilbagekaldelse af komplai-adgang og hemmelighedskontrol i udgivelsen).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { KomplaiDeployment } = require('../core/komplai-publish.cjs');
const { Deployments } = require('../core/deployments.cjs');
const { Store } = require('../core/store.cjs');
const { disconnectPublishing, disconnect, publishingState } = require('../core/komplai.cjs');
const { verifyMaterial } = require('../core/pages-publishing.cjs');
const view = require('../ui/share-view.js');

const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('k:' + Buffer.from(value).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(2), 'base64').toString() };
const grant = 'komp_publish_grant_' + 'a'.repeat(64);
const appA = '11111111-2222-4333-8444-555555555555', appB = '99999999-2222-4333-8444-555555555555';
async function connectedStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s4b-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, safe);
  await store.update(state => { state.hosting = { komplai: { secret: store.encrypt(grant), grantId: 'g', organisationId: 'o', organisationName: 'Gentofte Kommune', address: 'komplai.run', expiresAt: new Date(Date.now() + 86400000).toISOString() } }; });
  return store;
}
const html = Buffer.from('<h1>Budget</h1>');

test('S4-15b: en viderestilling (3xx) fra adressen tæller som svar og kortet siger ikke «ikke kontrolleret»', () => {
  const base = { state: 'READY', id: 'r1', config: { provider: 'komplai', visibility: 'private' }, target: { name: 'Budget' }, version: { name: 'v', at: '2026-10-07T09:00:00Z' } };
  const checked = http => ({ ...base, checks: { provider: { status: 'checked', visibility: 'private' }, site: { status: 'answered', http }, content: { status: 'skipped' } } });
  for (const http of [301, 302, 307]) {
    assert.equal(view.addressUnchecked(checked(http)), false, 'HTTP ' + http);
    assert.notEqual(view.receiptSummary(checked(http)).publication.title, view.UNCHECKED, 'HTTP ' + http);
  }
});

test('S4-16b: en ny app, hvis upload er uvis, mister ikke sporet til den ved at gendanne den gamle kvittering', async t => {
  const store = await connectedStore(t), root = '/projekt';
  const app = { id: appA, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'private', activeRelease: null };
  let phase = 'a';
  const fetcher = async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', '');
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', slugs: true, apps: [app] });
    if (route === `/api/publish/${appA}/releases`) { app.activeRelease = 'release-1'; return Response.json(app); }
    if (route === '/api/publish/native/apps' && options.method === 'POST') return Response.json({ id: appB });
    if (route.startsWith('/api/publish/native/address')) return Response.json({ available: true });
    if (route === `/api/publish/${appB}/releases`) throw Error('offline');
    throw Error('Uventet ' + route);
  };
  const artifact = { head: 'a'.repeat(40), hash: 'fingeraftryk', bytes: html.length, files: [{ file: 'index.html', data: html, sha256: 'x' }] };
  const deployments = new Deployments(store, { artifact: async () => artifact, providers: { komplai: new KomplaiDeployment(store, { fetcher }) }, fetcher: async () => new Response(html) });
  await deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', appId: appA, visibility: 'private' })).token);
  assert.equal((await store.project(root)).deploymentLast.appId, appA);
  await assert.rejects(deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', name: 'Ny', visibility: 'private' })).token));
  const now = (await store.project(root)).deploymentLast;
  assert.equal(now.appId, appB, 'den nye apps id er gemt i kvitteringen');
  assert.equal((await store.project(root)).deploymentConfig.appId, appB);
});

test('S4-20b: en 404 uden komplais egen fejlkode er en forkert adresse og ikke en slettet nøgle', async t => {
  const store = await connectedStore(t);
  await assert.rejects(disconnectPublishing(store, undefined, async () => Response.json({}, { status: 404 })));
  assert.equal((await publishingState(store)).connected, true, 'adgangen bevares');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ message: 'Cannot DELETE /session' }, { status: 404 });
    await assert.rejects(disconnect({ baseURL: 'https://api.komplai.dk/v1/aura/v1' }, 'nøgle'));
    globalThis.fetch = async () => Response.json({ error: 'not_found' }, { status: 404 });
    assert.equal((await disconnect({ baseURL: 'https://api.komplai.dk/v1/aura/v1' }, 'nøgle')).alreadyGone, true);
  } finally { globalThis.fetch = original; }
});

test('S4-20c: «Fjern alligevel» sletter den lokale adgang, når komplai ikke kan kontaktes', async t => {
  const store = await connectedStore(t);
  await assert.rejects(disconnectPublishing(store, undefined, async () => { throw Error('offline'); }));
  assert.equal((await publishingState(store)).connected, true, 'uden force bevares adgangen');
  const state = await disconnectPublishing(store, undefined, async () => { throw Error('offline'); }, { force: true });
  assert.equal(state.connected, false);
  assert.equal((await store.read()).hosting?.komplai, undefined);
});

test('S4-4b: verifyMaterial i workflowet spærrer Authorization: Bearer og NAVN=værdi uden citationstegn', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s4b-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const cases = [`fetch(u, { headers: { Authorization: 'Bearer ${jwt}' } })`, 'MIN_API_KEY=Zx9Qm3Tp7Vb2Nk5Ld8Hs1Jf4Gc6Rw0Ya', 'TOKEN=abc123xyz'];
  let n = 0;
  for (const text of cases) {
    const workspace = path.join(root, 'w' + n), runner = path.join(root, 'r' + n++);
    await fs.mkdir(path.join(workspace, 'public'), { recursive: true }); await fs.mkdir(runner);
    await fs.writeFile(path.join(workspace, 'public/index.html'), `<script>${text}</script>`);
    const env = { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runner, GITHUB_SHA: sha, REVIEWED_SHA: sha, REVIEWED_HASH: 'b'.repeat(64), AURA_DIRECTORY: 'public' };
    await assert.rejects(verifyMaterial(env), /hemmelighed/, text);
  }
});

test('S4-4b: verifyMaterial lader harmløs kode passere hemmelighedskontrollen', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s4b-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40), workspace = path.join(root, 'w'), runner = path.join(root, 'r');
  await fs.mkdir(path.join(workspace, 'public'), { recursive: true }); await fs.mkdir(runner);
  await fs.writeFile(path.join(workspace, 'public/index.html'), '<script>const token = await hentToken(); const apiKey = process.env.KEY; // bearer authentication</script>');
  const env = { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runner, GITHUB_SHA: sha, REVIEWED_SHA: sha, REVIEWED_HASH: 'b'.repeat(64), AURA_DIRECTORY: 'public' };
  await assert.rejects(verifyMaterial(env), /ikke den gennemgåede/, 'når kun fingeraftrykket er forkert, er hemmelighedskontrollen passeret');
});
