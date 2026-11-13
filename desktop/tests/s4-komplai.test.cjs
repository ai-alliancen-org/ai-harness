// Spor S4: fund 15 (adressekontrol og «Uploadet, adressen er ikke kontrolleret endnu»), 16 (afvisninger fra komplai)
// og 20 (Fjern forbindelse / Log ud, når komplai afviser adgangen).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { KomplaiDeployment } = require('../core/komplai-publish.cjs');
const { Deployments } = require('../core/deployments.cjs');
const { Store } = require('../core/store.cjs');
const { disconnectPublishing, disconnect, publishingState } = require('../core/komplai.cjs');
const view = require('../ui/share-view.js');

const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('k:' + Buffer.from(value).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(2), 'base64').toString() };
const grant = 'komp_publish_grant_' + 'a'.repeat(64);
const appId = '11111111-2222-4333-8444-555555555555';
async function connectedStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s4-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, safe);
  await store.update(state => { state.hosting = { komplai: { secret: store.encrypt(grant), grantId: 'g', organisationId: 'o', organisationName: 'Gentofte Kommune', address: 'komplai.run', expiresAt: new Date(Date.now() + 86400000).toISOString() } }; });
  return store;
}
const html = Buffer.from('<h1>Budget</h1>');
const files = [{ file: 'index.html', data: html }];

test('S4-15: adressen kontrolleres, selv om hubben ikke melder slugs', async t => {
  const store = await connectedStore(t), calls = [];
  const provider = new KomplaiDeployment(store, { fetcher: async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', ''); calls.push(`${options.method || 'GET'} ${route}`);
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', apps: [] });
    if (route.startsWith('/api/publish/native/address')) return Response.json({ available: false, reason: 'slug_taken' });
    throw Error('Uventet ' + route);
  } });
  await assert.rejects(provider.inspect({ provider: 'komplai', name: 'Budget', slug: 'taget', visibility: 'private' }), /allerede i brug/);
});

test('S4-15: deploy tjekker adressen igen lige før upload og afviser slug, når hubben ikke melder slugs', async t => {
  const store = await connectedStore(t), calls = [];
  const provider = new KomplaiDeployment(store, { fetcher: async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', ''); calls.push(`${options.method || 'GET'} ${route}`);
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', apps: [] });
    if (route.startsWith('/api/publish/native/address')) return Response.json({ available: true });
    if (route === '/api/publish/native/apps') return Response.json({ id: appId });
    throw Error('Uventet ' + route);
  } });
  await assert.rejects(provider.deploy({ name: 'Budget', slug: 'budget', visibility: 'private' }, { files }, { id: null }), e => /Adressen kan ikke bruges/.test(e.message) && e.notUploaded === true);
  assert.ok(!calls.some(c => c.startsWith('POST')), 'der må ikke oprettes en app: ' + calls.join(', '));
});

test('S4-15: deploy afviser en adresse, der er blevet optaget siden gennemgangen', async t => {
  const store = await connectedStore(t), calls = [];
  const provider = new KomplaiDeployment(store, { fetcher: async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', ''); calls.push(`${options.method || 'GET'} ${route}`);
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', slugs: true, apps: [] });
    if (route.startsWith('/api/publish/native/address')) return Response.json({ available: false, reason: 'slug_taken' });
    throw Error('Uventet ' + route);
  } });
  await assert.rejects(provider.deploy({ name: 'Budget', slug: 'budget', visibility: 'private' }, { files }, { id: null }), /allerede i brug/);
  assert.ok(!calls.some(c => c.startsWith('POST')));
});

// Et lager og en Deployments med en komplai-udbyder, hvis hub styres af testen.
async function setup(t, hub) {
  const store = await connectedStore(t);
  const app = { id: appId, name: 'Budget', slug: 'budget', url: 'https://budget.komplai.run', visibility: 'private', activeRelease: null, releases: [] };
  let sites = 0, upload = () => { app.activeRelease = 'release-1'; return Response.json(app); };
  const fetcher = async (url, options) => {
    const route = url.replace('https://hub.komplai.dk', '');
    if (route === '/api/publish/native') return Response.json({ address: 'komplai.run', slugs: true, apps: [app] });
    if (route === `/api/publish/${appId}/releases`) return upload();
    throw Error('Uventet ' + route);
  };
  const provider = new KomplaiDeployment(store, { fetcher });
  const artifact = { head: 'a'.repeat(40), hash: 'fingeraftryk', bytes: html.length, files: [{ file: 'index.html', data: html, sha256: 'x' }] };
  const deployments = new Deployments(store, { artifact: async () => artifact, providers: { komplai: provider }, fetcher: async () => { sites++; return new Response(html); } });
  return { store, deployments, app, sites: () => sites, setUpload: fn => { upload = fn; } };
}
const input = { provider: 'komplai', appId, visibility: 'private' };

// Ændret 5. november 2026 efter brugerens valg: adressen kontrolleres kun, når brugeren trykker Kontrollér (se k2-ingen-auto-kontrol).
test('S4-15: efter udgivelsen køres ingen adressekontrol, og kortet siger «ikke kontrolleret»', async t => {
  const s = await setup(t), root = '/projekt';
  const receipt = await s.deployments.deploy(root, (await s.deployments.review(root, input)).token);
  assert.equal(s.sites(), 0, 'adressen hentes ikke uden et tryk');
  assert.equal(receipt.id, 'release-1');
  assert.equal(view.receiptSummary(receipt).publication.title, 'Uploadet, adressen er ikke kontrolleret endnu');
});

test('S4-15: et tryk på Kontrollér med en adresse, der ikke svarer, gemmer «unreachable» og kortet siger stadig «ikke kontrolleret»', async t => {
  const s = await setup(t), root = '/projekt';
  const receipt = await s.deployments.deploy(root, (await s.deployments.review(root, input)).token);
  s.deployments.fetcher = async () => { throw Error('ingen forbindelse'); };
  const checked = await s.deployments.check(root);
  assert.equal(receipt.id, 'release-1');
  assert.equal(checked.checks.site.status, 'unreachable');
  const bare = { ...receipt, checks: null, checkedAt: undefined, state: 'READY' };
  assert.equal(view.receiptSummary(bare).publication.title, 'Uploadet, adressen er ikke kontrolleret endnu');
});

test('S4-15: skærmen siger «Uploadet, adressen er ikke kontrolleret endnu», indtil adressen har svaret', () => {
  const base = { state: 'READY', id: 'r1', config: { provider: 'komplai', visibility: 'public' }, target: { name: 'Budget' }, version: { name: 'v', at: '2026-10-07T09:00:00Z' } };
  assert.equal(view.receiptSummary(base).publication.title, 'Uploadet, adressen er ikke kontrolleret endnu');
  assert.equal(view.addressUnchecked(base), true);
  const checked = site => ({ ...base, checks: { provider: { status: 'checked', visibility: 'public' }, site, content: { status: 'skipped' } } });
  assert.equal(view.receiptSummary(checked({ status: 'answered', http: 200 })).publication.title, 'Udgivet');
  assert.equal(view.receiptSummary(checked({ status: 'unreachable' })).publication.title, 'Appen er ikke klar endnu');
  assert.equal(view.receiptSummary(checked({ status: 'skipped' })).publication.title, 'Uploadet, adressen er ikke kontrolleret endnu');
  assert.equal(view.addressUnchecked({ ...base, config: { provider: 'vercel' } }), false, 'kun komplai');
});

test('S4-16: alle kendte endelige afvisninger er notUploaded med fejlens egen tekst', async t => {
  const store = await connectedStore(t);
  for (const code of ['storage_limit', 'slug_taken', 'upload_limit', 'invalid_manifest', 'forbidden', 'unauthorised', 'busy', 'not_found', 'invalid_archive', 'missing_index']) {
    const provider = new KomplaiDeployment(store, { fetcher: async () => Response.json({ error: code }, { status: 400 }) });
    await assert.rejects(provider.upload(appId, html, 'text/html'), e => e.notUploaded === true && e.message.length > 20 && e.code === code, code);
    await assert.rejects(provider.call('/api/publish/native'), e => e.notUploaded === true && e.code === code, 'call ' + code);
  }
  // Uafklaret er ikke afvist: der kan allerede være uploadet.
  const uncertain = new KomplaiDeployment(store, { fetcher: async () => Response.json({ error: 'publication_uncertain' }, { status: 502 }) });
  await assert.rejects(uncertain.upload(appId, html, 'text/html'), e => e.notUploaded !== true);
  const offline = new KomplaiDeployment(store, { fetcher: async () => { throw Error('offline'); } });
  await assert.rejects(offline.upload(appId, html, 'text/html'), e => e.notUploaded !== true);
});

test('S4-16: en afvisning overskriver ikke kvitteringen for en side, der er live', async t => {
  const s = await setup(t), root = '/projekt';
  await s.deployments.deploy(root, (await s.deployments.review(root, input)).token);
  const live = (await s.store.project(root)).deploymentLast;
  assert.equal(live.id, 'release-1');
  for (const failure of [() => Response.json({ error: 'storage_limit' }, { status: 507 }), () => Response.json({ error: 'upload_limit' }, { status: 413 })]) {
    s.setUpload(failure);
    await assert.rejects(s.deployments.deploy(root, (await s.deployments.review(root, input)).token));
    const now = (await s.store.project(root)).deploymentLast;
    assert.equal(now.id, 'release-1'); assert.equal(now.state, 'READY'); assert.notEqual(now.state, 'UNKNOWN');
  }
  // Ændret 9. november 2026 (fund R#28): en tabt forbindelse er ikke en afvisning. komplai kan have aktiveret den nye
  // version, så den gamle kvittering må ikke stå som udgivet. Kortet siger «Upload ikke bekræftet» (decisions.md, 7. oktober).
  s.setUpload(() => { throw Error('Forbindelsen brød sammen.'); });
  await assert.rejects(s.deployments.deploy(root, (await s.deployments.review(root, input)).token), /ikke bekræftet/);
  const uncertain = (await s.store.project(root)).deploymentLast;
  assert.equal(uncertain.state, 'UNKNOWN'); assert.equal(uncertain.id, null);
  assert.equal(view.receiptSummary(uncertain).publication.title, 'Upload ikke bekræftet');
});

test('S4-16: en afvisning viser komplais egen tekst', async t => {
  const s = await setup(t), root = '/projekt';
  s.setUpload(() => Response.json({ error: 'storage_limit' }, { status: 507 }));
  await assert.rejects(s.deployments.deploy(root, (await s.deployments.review(root, input)).token), /plads til apps er brugt/);
  assert.equal((await s.store.project(root)).deploymentLast?.state ?? null, null, 'uden tidligere kvittering står der ingen UNKNOWN');
});

test('S4-20: Log ud og Fjern forbindelse lykkes, når komplai afviser adgangen som ugyldig eller ukendt', async t => {
  for (const response of [() => Response.json({ error: 'invalid_token' }, { status: 401 }), () => Response.json({}, { status: 401 }), () => Response.json({ error: 'not_found' }, { status: 404 })]) {
    const store = await connectedStore(t);
    assert.deepEqual(await disconnectPublishing(store, undefined, async () => response()), { connected: false });
    assert.equal((await store.read()).hosting?.komplai, undefined, 'den lokale post er slettet');
  }
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'invalid_token' }, { status: 401 });
    await disconnect({ baseURL: 'https://api.komplai.dk/v1/aura/v1' }, 'nøgle');
    globalThis.fetch = async () => Response.json({ error: 'not_found' }, { status: 404 });
    await disconnect({ baseURL: 'https://api.komplai.dk/v1/aura/v1' }, 'nøgle');
  } finally { globalThis.fetch = original; }
});

test('S4-20: en netværksfejl bevarer adgangen, og andre serverfejl lykkes ikke', async t => {
  const store = await connectedStore(t);
  await assert.rejects(disconnectPublishing(store, undefined, async () => { throw Error('offline'); }), /kunne ikke kontaktes/);
  await assert.rejects(disconnectPublishing(store, undefined, async () => Response.json({}, { status: 500 })));
  assert.equal((await publishingState(store)).connected, true);
  const original = globalThis.fetch;
  try { globalThis.fetch = async () => { throw Error('offline'); }; await assert.rejects(disconnect({ baseURL: 'https://api.komplai.dk/v1/aura/v1' }, 'nøgle'), /kunne ikke kontaktes/); }
  finally { globalThis.fetch = original; }
});
