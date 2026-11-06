// Spor K, valg 1 (5. november 2026): komplai-adressen kontrolleres kun, når brugeren trykker Kontrollér.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { KomplaiDeployment } = require('../core/komplai-publish.cjs');
const { Deployments } = require('../core/deployments.cjs');
const { Store } = require('../core/store.cjs');
const view = require('../ui/share-view.js');

const safe = { isEncryptionAvailable: () => true, encryptString: v => Buffer.from('k:' + Buffer.from(v).toString('base64')), decryptString: b => Buffer.from(b.toString().slice(2), 'base64').toString() };
const appId = '11111111-2222-4333-8444-555555555555';
const html = Buffer.from('<h1>Budget</h1>');
async function setup(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-k2-test-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, safe);
  await store.update(state => { state.hosting = { komplai: { secret: store.encrypt('komp_publish_grant_' + 'a'.repeat(64)), grantId: 'g', organisationId: 'o', organisationName: 'Gentofte Kommune', address: 'komplai.run', expiresAt: new Date(Date.now() + 86400000).toISOString() } }; });
  const app = { id: appId, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'private', activeRelease: null, releases: [] };
  const hub = [];
  const fetcher = async url => {
    const route = url.replace('https://hub.komplai.dk', ''); hub.push(route);
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', slugs: true, apps: [app] });
    if (route === `/api/publish/${appId}/releases`) { app.activeRelease = 'release-1'; return Response.json(app); }
    throw Error('Uventet ' + route);
  };
  let sites = 0;
  const artifact = { head: 'a'.repeat(40), hash: 'fingeraftryk', bytes: html.length, files: [{ file: 'index.html', data: html, sha256: 'x' }] };
  const deployments = new Deployments(store, { artifact: async () => artifact, providers: { komplai: new KomplaiDeployment(store, { fetcher }) }, fetcher: async () => { sites++; return new Response(html); } });
  return { store, deployments, sites: () => sites, hub };
}
const input = { provider: 'komplai', appId, visibility: 'private' };

test('K2: efter udgivelsen hentes adressen ikke, og kortet siger uploadet med Kontrollér som hovedknap', async t => {
  const s = await setup(t), root = '/projekt';
  const receipt = await s.deployments.deploy(root, (await s.deployments.review(root, input)).token);
  assert.equal(receipt.id, 'release-1'); assert.equal(receipt.state, 'READY');
  assert.equal(s.sites(), 0, 'ingen adressekontrol uden et tryk');
  assert.notEqual(receipt.checks?.site?.status, 'answered');
  assert.equal(view.addressUnchecked(receipt), true);
  assert.equal(view.receiptSummary(receipt).publication.title, 'Uploadet, adressen er ikke kontrolleret endnu');
  const actions = view.mainActions(receipt); assert.equal(actions[0], 'check'); assert.ok(actions.length <= 2 && !actions.includes('new'));
});

test('K2: kortet forbliver ukontrolleret, uanset hvor længe der går, og state() kontrollerer ikke', async t => {
  const s = await setup(t), root = '/projekt';
  await s.deployments.deploy(root, (await s.deployments.review(root, input)).token);
  const before = s.hub.length;
  await new Promise(r => setTimeout(r, 120));
  await s.deployments.state(root);
  assert.equal(s.sites(), 0); assert.equal(s.hub.length, before, 'ingen kald til komplai efter upload');
  assert.equal(view.addressUnchecked((await s.store.project(root)).deploymentLast), true);
});

test('K2: Kontrollér-trykket er den eneste vej til adressen', async t => {
  const s = await setup(t), root = '/projekt';
  await s.deployments.deploy(root, (await s.deployments.review(root, input)).token);
  s.deployments.providers.komplai.status = async () => ({ state: 'READY', url: 'https://budget.komplai.run', visibility: 'private' });
  const checked = await s.deployments.check(root);
  assert.equal(s.sites(), 1);
  assert.equal(checked.checks.site.status, 'answered');
});

test('K2: koden har ingen timer eller automatisk kald til check i komplai-sporet', () => {
  const dep = fs.readFileSync(path.join(__dirname, '../core/deployments.cjs'), 'utf8');
  const pub = fs.readFileSync(path.join(__dirname, '../core/komplai-publish.cjs'), 'utf8');
  assert.equal((dep.match(/this\.check\(/g) || []).length, 0, 'deploy må ikke kalde check');
  for (const [name, code] of [['deployments', dep], ['komplai-publish', pub]]) assert.ok(!/setInterval|setTimeout/.test(code), name + ' må ingen timer have');
});

function intervalCallback() {
  const code = fs.readFileSync(path.join(__dirname, '../ui/deployment-setup.js'), 'utf8');
  const found = [...code.matchAll(/setInterval\((.*?), 30000\)/g)];
  assert.equal(found.length, 1, 'præcis ét interval');
  return found[0][1];
}
function runInterval(last) {
  let refreshed = 0;
  const ctx = { trackingRoot: '/p', document: { hidden: false }, $: () => ({ hidden: false }), window: { sharingOn: () => true }, tracking: { automatic: false, last }, refresh: () => { refreshed++; return Promise.resolve(); } };
  vm.runInNewContext(`(${intervalCallback()})()`, ctx);
  return refreshed;
}
test('K2: intervallet henter aldrig status for en komplai-kvittering', () => {
  assert.equal(runInterval({ id: 'r1', config: { provider: 'komplai' } }), 0);
});
test('K2: intervallet rører ikke andre udbydere (uændret)', () => {
  assert.equal(runInterval({ id: 'r1', config: { provider: 'vercel' } }), 1);
});
test('K2: at åbne Udgiv fra statusknappen kontrollerer ikke komplai-adressen', () => {
  const code = fs.readFileSync(path.join(__dirname, '../ui/deployment.js'), 'utf8');
  assert.match(code, /setup\.refresh\(wantStatus && state\.last\?\.config\?\.provider !== 'komplai'\)/);
});
