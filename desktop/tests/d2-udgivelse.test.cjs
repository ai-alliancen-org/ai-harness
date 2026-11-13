// Spor D2, udgivelse og deling: kernen og kortet bag fund R#27, R#28, R#29, R#33 og K1 i gennemgangen af beta 3.
// Prøverne bruger de rigtige Store, Deployments, KomplaiDeployment, komplai.cjs og share-view.js. Kun hubben er falsk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { Deployments } = require('../core/deployments.cjs');
const { KomplaiDeployment } = require('../core/komplai-publish.cjs');
const { KomplaiLogin, organisation, publishingState, disconnectPublishing } = require('../core/komplai.cjs');
const { Store } = require('../core/store.cjs');
const view = require('../ui/share-view.js');

const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('k:' + Buffer.from(value).toString('base64')), decryptString: buffer => { const text = buffer.toString(); if (!text.startsWith('k:')) throw Error('fremmed nøgle'); return Buffer.from(text.slice(2), 'base64').toString(); } };
const grant = n => 'komp_publish_grant_' + String(n).repeat(64);
const html = Buffer.from('<h1>Budget</h1>');
const sha = createHash('sha256').update(html).digest('hex');
const artifact = { head: 'a'.repeat(40), hash: 'fingeraftryk', bytes: html.length, files: [{ file: 'index.html', data: html, sha256: sha }] };
const appA = '11111111-2222-4333-8444-555555555555';

async function store(t, expiresAt = new Date(Date.now() + 86400000).toISOString()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-d2-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const s = new Store(directory, safe);
  await s.update(state => { state.hosting = { komplai: { secret: s.encrypt(grant(1)), grantId: 'g', organisationId: 'o', organisationName: 'Testkommune', address: 'komplai.run', expiresAt } }; });
  return s;
}

// En falsk hub med rigtige ruter: oversigt, adressekontrol, oprettelse, adgangsskift og upload.
function hub(apps) {
  const log = []; let upload = null, overview = null;
  const present = a => ({ id: a.id, name: a.name, slug: a.slug, url: `https://${a.slug}.komplai.run`, visibility: a.visibility, activeRelease: a.activeRelease, releases: a.releases || [] });
  const fetcher = async (url, options = {}) => {
    const u = new URL(url), route = u.pathname, method = options.method || 'GET'; log.push(`${method} ${route}`);
    if (route === '/api/publish/native') return overview ? overview() : Response.json({ address: 'komplai.run', slugs: true, apps: apps.map(present) });
    if (route === '/api/publish/native/address') return Response.json({ available: !apps.some(a => a.slug === u.searchParams.get('slug') && a.id !== u.searchParams.get('appId')), reason: 'slug_taken' });
    if (route === '/api/publish/native/apps' && method === 'POST') { const body = JSON.parse(options.body), app = { id: crypto.randomUUID(), name: body.name, slug: body.slug || 'tilfaeldig', visibility: 'private', activeRelease: null }; apps.push(app); return Response.json(present(app)); }
    const patch = route.match(/^\/api\/publish\/native\/apps\/([0-9a-f-]{36})$/);
    if (patch && method === 'PATCH') { const app = apps.find(a => a.id === patch[1]); app.visibility = JSON.parse(options.body).visibility; return Response.json(present(app)); }
    const release = route.match(/^\/api\/publish\/([0-9a-f-]{36})\/releases$/);
    if (release) {
      const app = apps.find(a => a.id === release[1]);
      if (upload) return upload(app);
      app.activeRelease = 'release-' + crypto.randomUUID().slice(0, 6); return Response.json(present(app));
    }
    throw Error('Uventet ' + method + ' ' + route);
  };
  return { fetcher, log, setUpload: fn => { upload = fn; }, setOverview: fn => { overview = fn; } };
}

function komplaiSetup(s, apps) {
  const h = hub(apps), provider = new KomplaiDeployment(s, { fetcher: h.fetcher });
  const deployments = new Deployments(s, { artifact: async () => artifact, providers: { komplai: provider }, fetcher: async () => new Response(html) });
  return { h, provider, deployments };
}

// Vercel med et injiceret lager og en injiceret udbyder, som i tests/deployments.test.cjs.
function vercel() {
  const state = {}, s = { project: async () => state, saveProject: async (root, patch) => Object.assign(state, patch) };
  const provider = { inspect: async () => ({ id: 'prj', name: 'Test', portal: 'https://vercel.com/test/test' }), deploy: async () => ({ id: 'dpl_1', state: 'QUEUED', url: 'https://test.vercel.app' }), status: async () => ({ state: 'READY', url: 'https://test.vercel.app' }) };
  return { state, provider, deployments: new Deployments(s, { artifact: async () => artifact, providers: { vercel: provider }, fetcher: async () => new Response(html) }) };
}
const vercelInput = { provider: 'vercel', mode: 'static', directory: 'public', scope: 'team', project: 'test' };

test('R#28: en uvis upload oven på en live udgivelse giver «Upload ikke bekræftet», aldrig et grønt «Udgivet» for den gamle version', async () => {
  const f = vercel(), root = '/projekt';
  await f.deployments.deploy(root, (await f.deployments.review(root, vercelInput)).token);
  const live = await f.deployments.check(root);
  assert.equal(live.state, 'READY'); assert.equal(view.receiptSummary(live).verification.tone, 'positive');
  f.provider.deploy = async () => { throw Error('Syntetisk uploadfejl'); };
  await assert.rejects(f.deployments.deploy(root, (await f.deployments.review(root, vercelInput)).token), /ikke bekræftet/);
  const now = f.state.deploymentLast;
  assert.equal(now.state, 'UNKNOWN', 'den gamle kvittering må ikke stå som den aktuelle');
  assert.equal(now.id, null);
  const summary = view.receiptSummary(now);
  assert.equal(summary.publication.title, 'Upload ikke bekræftet'); assert.equal(summary.publication.tone, 'warning');
  assert.notEqual(summary.verification.tone, 'positive');
  assert.deepEqual(view.mainActions(now), ['portal'], 'udbyderens oversigt er vejen videre, og intet gentages af sig selv');
});

test('R#28: komplai aktiverer den nye version, men forbindelsen forsvinder før svaret: kortet viser ikke den gamle version som udgivet', async t => {
  const s = await store(t), apps = [{ id: appA, name: 'Budget', slug: 'budget', visibility: 'public', activeRelease: null }], { h, deployments } = komplaiSetup(s, apps), root = '/projekt';
  const input = { provider: 'komplai', appId: appA, visibility: 'public' };
  await deployments.deploy(root, (await deployments.review(root, input)).token);
  const live = await deployments.check(root);
  assert.equal(live.state, 'READY'); assert.equal(view.receiptSummary(live).publication.title, 'Udgivet');
  h.setUpload(app => { app.activeRelease = 'release-2'; throw Error('forbindelsen forsvandt'); });
  await assert.rejects(deployments.deploy(root, (await deployments.review(root, input)).token), /ikke bekræftet/);
  const now = (await s.project(root)).deploymentLast;
  assert.equal(now.state, 'UNKNOWN'); assert.equal(now.id, null);
  assert.equal(now.config.appId, appA, 'næste version går stadig til samme app');
  assert.notEqual(view.receiptSummary(now).publication.title, 'Udgivet');
  assert.doesNotMatch(JSON.stringify(now), /står uændret/, 'kvitteringen påstår ikke, at den tidligere udgivelse står uændret');
});

test('R#27: komplai opretter en ny app og afviser uploaden: den tidligere kvittering bevares, appen huskes, og beskeden siger, at næste forsøg bruger den', async t => {
  const s = await store(t), apps = [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: null }], { h, deployments } = komplaiSetup(s, apps), root = '/projekt';
  await deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', appId: appA, visibility: 'private' })).token);
  const previous = (await s.project(root)).deploymentLast;
  h.setUpload(() => Response.json({ error: 'busy' }, { status: 503 }));
  const review = await deployments.review(root, { provider: 'komplai', name: 'Ny app', slug: 'ny-app', visibility: 'private' });
  await assert.rejects(deployments.deploy(root, review.token), error => /travlt/.test(error.message) && /oprettet hos komplai/.test(error.message) && /samme app/.test(error.message), 'beskeden siger, at appen findes og bruges ved næste forsøg');
  const created = apps.find(a => a.name === 'Ny app');
  assert.ok(created, 'komplai oprettede appen');
  const project = await s.project(root);
  assert.deepEqual(project.deploymentLast, previous, 'kvitteringen for den live app bevares');
  assert.equal(project.deploymentConfig.appId, created.id, 'den nye app er gemt som destination');
  // Næste forsøg til den samme app opretter ingen ny app og giver ikke «Adressen er allerede i brug».
  h.setUpload(null);
  const receipt = await deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', appId: created.id, visibility: 'private' })).token);
  assert.equal(receipt.appId, created.id); assert.equal(apps.length, 2);
  assert.equal(h.log.filter(line => line === 'POST /api/publish/native/apps').length, 1);
});

test('R#27: appen, komplai oprettede ved et afvist forsøg, huskes efter Luk, indtil testeren gennemgår en anden destination, eller appen får en version', async t => {
  const s = await store(t), apps = [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: null }], { h, deployments } = komplaiSetup(s, apps), root = '/projekt';
  const send = async input => deployments.deploy(root, (await deployments.review(root, input)).token);
  await send({ provider: 'komplai', appId: appA, visibility: 'private' });
  assert.ok(!(await deployments.state(root)).createdApp, 'ingen app venter efter en almindelig udgivelse');
  h.setUpload(() => Response.json({ error: 'busy' }, { status: 503 }));
  await assert.rejects(send({ provider: 'komplai', name: 'Ny app', slug: 'ny-app', visibility: 'private' }), /samme app/);
  const created = apps.find(a => a.name === 'Ny app');
  assert.equal((await deployments.state(root)).createdApp, created.id, 'Udgiv kan fortsætte til den samme app, også efter Luk');
  // Et nyt afvist forsøg til den samme app glemmer den ikke.
  await assert.rejects(send({ provider: 'komplai', appId: created.id, visibility: 'private' }), /travlt/);
  assert.equal((await deployments.state(root)).createdApp, created.id, 'et nyt afvist forsøg glemmer ikke appen');
  // Gennemgår testeren en anden destination, går testerens nyeste valg forud ...
  await deployments.review(root, { provider: 'komplai', appId: appA, visibility: 'private' });
  assert.equal((await deployments.state(root)).createdApp, null, 'testerens nyeste valg går forud');
  // ... og vælges appen igen, gælder den igen, til den har fået en version.
  await deployments.review(root, { provider: 'komplai', appId: created.id, visibility: 'private' });
  assert.equal((await deployments.state(root)).createdApp, created.id);
  h.setUpload(null);
  const receipt = await send({ provider: 'komplai', appId: created.id, visibility: 'private' });
  assert.equal(receipt.appId, created.id);
  const state = await deployments.state(root);
  assert.equal(state.createdApp, null, 'appen har fået en version'); assert.equal(state.last.appId, created.id);
  assert.equal(h.log.filter(line => line === 'POST /api/publish/native/apps').length, 1);
});

test('R#27: et uvist forsøg til den oprettede app erstatter markeringen med kortet «Upload ikke bekræftet», så Udgiv ikke springer forbi det', async t => {
  const s = await store(t), apps = [], { h, deployments } = komplaiSetup(s, apps), root = '/projekt';
  const send = async input => deployments.deploy(root, (await deployments.review(root, input)).token);
  h.setUpload(() => Response.json({ error: 'busy' }, { status: 503 }));
  await assert.rejects(send({ provider: 'komplai', name: 'Budget', slug: 'budget', visibility: 'private' }), /samme app/);
  const created = apps.find(a => a.name === 'Budget');
  assert.equal((await deployments.state(root)).createdApp, created.id);
  h.setUpload(() => { throw Error('forbindelsen forsvandt'); });
  await assert.rejects(send({ provider: 'komplai', appId: created.id, visibility: 'private' }), /ikke bekræftet/);
  const state = await deployments.state(root);
  assert.equal(state.last.state, 'UNKNOWN'); assert.equal(state.last.config.appId, created.id, 'næste version går stadig til appen');
  assert.equal(state.createdApp, null, 'udbyderens oversigt er vejen videre ved ukendt upload, ikke et nyt forsøg');
});

test('R#27: en offentlig ny app med komplai-funktioner afvises efter oprettelsen: beskeden peger på adgangen i komplai, ikke på «Vælg Organisationen»', async t => {
  const s = await store(t), apps = [], { h, deployments } = komplaiSetup(s, apps), root = '/projekt';
  h.setUpload(() => Response.json({ error: 'public_app_capabilities' }, { status: 403 }));
  const review = await deployments.review(root, { provider: 'komplai', name: 'Spørgeskema', slug: 'spoergeskema', visibility: 'public', confirmPublic: 'Spørgeskema' });
  let message = '';
  await assert.rejects(deployments.deploy(root, review.token), error => { message = error.message; return true; });
  const created = apps.find(a => a.name === 'Spørgeskema');
  assert.equal(created.visibility, 'public', 'komplai gjorde appen offentlig før uploaden');
  assert.equal((await s.project(root)).deploymentConfig.appId, created.id);
  // Næste forsøg går til den samme, nu offentlige app, og Aura ændrer aldrig en eksisterende apps adgang.
  assert.doesNotMatch(message, /Vælg Organisationen/, message);
  assert.match(message, /adgang til Organisationen i komplai/, message);
  assert.match(message, /komplai\.json/, message);
});

test('R#29: udløbet eller tilbagekaldt komplai-adgang gemmes som «login» ved Kontrollér, og kortet beder om et nyt login', async t => {
  const s = await store(t), apps = [{ id: appA, name: 'Budget', slug: 'budget', visibility: 'private', activeRelease: null }], { h, deployments } = komplaiSetup(s, apps), root = '/projekt';
  await deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', appId: appA, visibility: 'private' })).token);
  const expire = at => s.update(state => { state.hosting.komplai.expiresAt = at; });
  await expire(new Date(Date.now() - 1000).toISOString());
  let checked = await deployments.check(root);
  assert.deepEqual(checked.checks.provider, { status: 'unknown', reason: 'login' }, 'udløbet adgang');
  assert.doesNotMatch(JSON.stringify(checked), /Log ind med komplai igen\./, 'fejlteksten gemmes ikke');
  const summary = view.receiptSummary(checked);
  assert.equal(summary.publication.title, 'Log ind med komplai igen'); assert.equal(summary.publication.tone, 'warning');
  assert.doesNotMatch(summary.publication.detail, /Prøv statuskontrollen igen/);
  assert.deepEqual(view.mainActions(checked), ['login']);
  assert.match(Object.fromEntries(view.checks(checked)).Udbyder, /udløbet eller tilbagekaldt/);
  await expire(new Date(Date.now() + 86400000).toISOString());
  for (const answer of [() => Response.json({ error: 'unauthorised' }, { status: 401 }), () => Response.json({ error: 'invalid_token' }, { status: 401 }), () => Response.json({}, { status: 401 })]) {
    h.setOverview(answer); checked = await deployments.check(root);
    assert.deepEqual(checked.checks.provider, { status: 'unknown', reason: 'login' }, 'tilbagekaldt adgang');
  }
  // En almindelig serverfejl er ikke et loginproblem: kortet beder stadig om en ny kontrol.
  h.setOverview(() => Response.json({}, { status: 500 })); checked = await deployments.check(root);
  assert.deepEqual(checked.checks.provider, { status: 'unknown' });
  assert.equal(view.receiptSummary(checked).publication.title, 'Status kunne ikke hentes');
  assert.deepEqual(view.mainActions(checked), ['portal', 'check']);
});

test('R#33: et nyt komplai-login, når den gamle adgang ikke kan læses, gemmer den nye adgang og tilbagekalder den ikke', async t => {
  const s = await store(t);
  // Den gamle adgang er krypteret med en nøgle, denne computer ikke har (fx slettet «Aura Safe Storage»).
  await s.update(state => { state.hosting.komplai.secret = Buffer.from('fremmed nøgle').toString('base64'); });
  const calls = [];
  const login = new KomplaiLogin({ fetcher: async (url, options) => {
    calls.push({ url, method: options.method, auth: options.headers?.Authorization });
    if (url.endsWith('/publishing/connect')) return Response.json({ id: 'grant-2', secret: grant(2), expiresAt: new Date(Date.now() + 86400000).toISOString(), address: 'komplai.run' });
    if (url.endsWith('/publishing/session')) return Response.json({ revoked: true });
    throw Error('Uventet ' + url);
  } });
  t.after(() => login.cancel());
  const org = { id: 'org-1', name: 'Testkommune', publishing: { address: 'komplai.run', tier: 'shared_free' } };
  login.pending = { token: 'login', controller: new AbortController(), organisations: [organisation(org)] };
  const state = await login.connectPublishing(org.id, s);
  assert.equal(state.connected, true);
  assert.equal(s.decrypt((await s.read()).hosting.komplai), grant(2), 'den nye adgang er gemt');
  assert.equal(calls.some(c => c.url.endsWith('/publishing/session') && c.auth === 'Bearer ' + grant(2)), false, 'den nye adgang må ikke tilbagekaldes');
});

test('K1: «Fjern kun fra denne computer» siger, om komplai også tilbagekaldte adgangen', async t => {
  const offline = await store(t);
  assert.deepEqual(await disconnectPublishing(offline, undefined, async () => { throw Error('offline'); }, { force: true }), { connected: false, revoked: false });
  assert.equal((await offline.read()).hosting?.komplai, undefined);
  const online = await store(t);
  assert.deepEqual(await disconnectPublishing(online, undefined, async () => Response.json({ revoked: true }), { force: true }), { connected: false, revoked: true });
  const unreadable = await store(t);
  await unreadable.update(state => { state.hosting.komplai.secret = Buffer.from('fremmed nøgle').toString('base64'); });
  assert.deepEqual(await disconnectPublishing(unreadable, undefined, async () => assert.fail('en ulæselig adgang sendes ikke'), { force: true }), { connected: false, revoked: false });
});

test('K1: Log ud med en adgang, der ikke kan læses, siger det i almindeligt dansk og bevarer adgangen, til brugeren vælger', async t => {
  const s = await store(t);
  await s.update(state => { state.hosting.komplai.secret = Buffer.from('fremmed nøgle').toString('base64'); });
  await assert.rejects(disconnectPublishing(s, undefined, async () => assert.fail('intet kald uden nøgle')), error => /denne computer/.test(error.message) && !/Indtast den igen/.test(error.message));
  assert.equal((await publishingState(s)).connected, true);
});
