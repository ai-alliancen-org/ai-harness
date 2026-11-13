const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PromteDeployment, PromteSetup, promteConfiguration, preparePromteArtifact, validatePromteArtifact, promteSourceProblem, PROMTE_WEBSITE, PROMTE_SETUP, promteHost, publicAddress } = require('../core/provider-promte.cjs');
const HOST = 'https://organisation.promte.dk';
const config = { provider: 'promte', mode: 'source', host: HOST, workspaceId: 'workspace-123', directory: '.' };
const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
function artifact(entries = { 'package.json': '{"private":true,"scripts":{"build":"vite build"},"devDependencies":{"react":"19.2.8"}}', 'src/main.jsx': 'document.body.textContent = "Afprøvning i Promte";' }) {
  return { head: 'a'.repeat(40), files: Object.entries(entries).map(([file, data]) => ({ file, data: Buffer.from(data), sha256: createHash('sha256').update(data).digest('hex') })) };
}
function adapter(handler, extra = {}) {
  const calls = [], reads = [];
  const provider = new PromteDeployment({ lookup, readCredentials: async host => { reads.push(host); return { token: 'secret-for-selected-host' }; }, fetcher: async (url, options) => { calls.push({ url, options }); return handler(url, options); }, ...extra });
  return { provider, calls, reads };
}
test('Promte kræver gyldig HTTPS-installation og kildekode fra gennemgåede filer', () => {
  assert.equal(promteHost(HOST + '/'), HOST);
  for (const host of ['http://organisation.promte.dk', 'https://localhost', 'https://127.0.0.1', 'https://10.1.2.3', 'https://[::1]', 'https://secret@organisation.promte.dk', HOST + '/api', HOST + '?secret=x', 'https://organisation.local', HOST + ':8443']) assert.throws(() => promteHost(host));
  for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.31.0.1', '192.168.0.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('93.184.215.14'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  assert.throws(() => promteConfiguration({ ...config, workspaceId: '../workspace' }));
  assert.throws(() => promteConfiguration({ ...config, directory: '../source' }));
  assert.equal(promteConfiguration(config).mode, 'source');
  validatePromteArtifact(artifact());
  for (const file of ['.env', 'src/.env.local', '.git/config', 'dist/index.html', 'vite.config.js', 'postcss.config.cjs', 'node_modules/a.js', '../other', '/absolute', 'secrets.json']) assert.throws(() => validatePromteArtifact(artifact({ 'package.json': '{}', 'src/main.jsx': 'test', [file]: 'private' })), file);
  assert.throws(() => validatePromteArtifact(artifact({ 'package.json': '{"dependencies":{"react":"19.2.8"}}', 'src/main.jsx': 'test' })), /devDependencies/);
  assert.throws(() => validatePromteArtifact(artifact({ 'package.json': '{"dependencies":{"library":"1.0.0"}}', 'src/main.jsx': 'test' })), /package-lock/);
  assert.throws(() => validatePromteArtifact(artifact({ 'package.json': '{"scripts":{"postinstall":"run something"}}', 'src/main.jsx': 'test' })), /installationsscripts/);
});
test('Promte afviser private DNS-svar før login læses eller netværket kontaktes', async () => {
  const { provider, calls, reads } = adapter(() => { throw Error('Må ikke kaldes'); }, { lookup: async () => [{ address: '10.0.0.8', family: 4 }] });
  await assert.rejects(provider.inspect(config), /privat netværk/);
  assert.equal(calls.length, 0); assert.equal(reads.length, 0);
});
test('Promtes CLI-filregler anvendes før gennemgang med hash af de faktiske uploadfiler', () => {
  const original = artifact({ 'package.json': '{"devDependencies":{"react":"19.2.8"}}', 'src/main.jsx': 'test', 'vite.config.js': 'local config', 'package-lock.json': '{"lockfileVersion":3}', 'dist/index.html': 'local build' });
  const prepared = preparePromteArtifact(original);
  assert.deepEqual(prepared.files.map(f => f.file), ['package.json', 'src/main.jsx']);
  assert.deepEqual(prepared.excludedFiles, ['vite.config.js', 'package-lock.json', 'dist/index.html']);
  assert.equal(original.files.length, 5);
  validatePromteArtifact(prepared);
  const changedOnlyLocally = preparePromteArtifact(artifact({ ...Object.fromEntries(original.files.map(f => [f.file, f.data.toString()])), 'vite.config.js': 'different local config' }));
  assert.equal(prepared.hash, changedOnlyLocally.hash);
  assert.notEqual(prepared.hash, preparePromteArtifact(artifact({ 'package.json': '{}', 'src/main.jsx': 'changed source' })).hash);
  const runtime = preparePromteArtifact(artifact({ 'package.json': '{"optionalDependencies":{"example":"1.0.0"}}', 'src/main.jsx': 'test', 'package-lock.json': '{}' }));
  assert.ok(runtime.files.some(f => f.file === 'package-lock.json'));
  validatePromteArtifact(runtime);
});
// Et lille lager med samme kontrakt som Auras: krypteret hemmelighed, read og update.
function memoryStore() {
  const state = { hosting: {} };
  return { state, read: async () => structuredClone(state), update: async change => change(state), encrypt: value => 'enc:' + Buffer.from(value).toString('base64'), decrypt: saved => Buffer.from(saved.secret.slice(4), 'base64').toString('utf8') };
}
const jwt = claims => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
function promteSetup(handler, extra = {}) {
  const calls = [], opened = [], store = memoryStore();
  const setup = new PromteSetup(store, { lookup, readCredentials: async () => null, openBrowser: async url => { opened.push(url); }, sleep: async () => {}, fetcher: async (url, options) => { calls.push({ url, options }); return handler(url, options); }, ...extra });
  return { setup, calls, opened, store };
}
const token = jwt({ uid: 'user-1', exp: Math.floor(Date.now() / 1000) + 30 * 86400 });
test('Promte-login sker i Aura gennem browsergodkendelse og gemmes krypteret pr. vært', async () => {
  let polls = 0;
  const { setup, calls, opened, store } = promteSetup((url, options) => {
    if (url.endsWith('/api/extension-auth/start')) { assert.deepEqual(JSON.parse(options.body), { client: 'aura' }); assert.equal(options.headers.Authorization, undefined); return response({ flowId: 'flow-1', flowSecret: 'flow-secret', approveUrl: HOST + '/extension-connect?flowId=flow-1', expiresAt: Date.now() + 60000, pollIntervalMs: 10 }); }
    if (url.includes('/api/extension-auth/status')) return ++polls < 2 ? response({ state: 'pending' }) : response({ state: 'approved', token, email: 'dev@kommune.dk' });
    throw Error('Uventet kald ' + url);
  });
  assert.equal((await setup.state({ host: HOST })).connected, false);
  const state = await setup.login({ host: HOST });
  assert.deepEqual(opened, [HOST + '/extension-connect?flowId=flow-1']);
  assert.equal(state.connected, true); assert.equal(state.email, 'dev@kommune.dk'); assert.equal(state.loginSource, 'aura'); assert.equal(state.installed, true);
  assert.ok(!JSON.stringify(state).includes(token), 'tokenet når aldrig brugerfladen');
  assert.ok(!JSON.stringify(store.state).includes(token), 'tokenet gemmes kun krypteret');
  assert.ok(calls.find(c => c.url.includes('/status')).url.includes('flowSecret=flow-secret'));
  assert.equal((await setup.state({ host: 'https://anden.promte.dk' })).connected, false, 'login gælder kun den valgte vært');
  assert.equal((await setup.logout({ host: HOST })).connected, false);
});
test('Promte-login stopper med en forståelig besked ved afvisning og afviser fremmede godkendelsessider', async () => {
  const denied = promteSetup(url => url.endsWith('/start') ? response({ flowId: 'f', flowSecret: 's', approveUrl: HOST + '/extension-connect?flowId=f', pollIntervalMs: 10 }) : response({ state: 'denied' }));
  await assert.rejects(denied.setup.login({ host: HOST }), /afvist/);
  assert.deepEqual(denied.store.state.hosting, {});
  const expired = promteSetup(url => url.endsWith('/start') ? response({ flowId: 'f', flowSecret: 's', approveUrl: HOST + '/extension-connect?flowId=f', pollIntervalMs: 10 }) : response({ state: 'not_found' }, 404));
  await assert.rejects(expired.setup.login({ host: HOST }), /udløb/);
  for (const approveUrl of ['http://organisation.promte.dk/extension-connect', HOST + '/andet', 'https://127.0.0.1/extension-connect']) {
    const odd = promteSetup(() => response({ flowId: 'f', flowSecret: 's', approveUrl }));
    await assert.rejects(odd.setup.login({ host: HOST }), /login|offentlig/i, approveUrl);
    assert.deepEqual(odd.opened, [], 'en ukendt side åbnes aldrig i browseren');
  }
});
test('Promte-login kan afbrydes under et svar; en sen godkendelse gemmes ikke', async () => {
  let finishPoll, pollStarted;
  const started = new Promise(resolve => { pollStarted = resolve; });
  const { setup, store } = promteSetup(url => url.endsWith('/start')
    ? response({ flowId: 'f', flowSecret: 's', approveUrl: HOST + '/extension-connect?flowId=f' })
    : new Promise(resolve => { finishPoll = resolve; pollStarted(); }));
  const pending = setup.login({ host: HOST, owner: '/projekt-a' });
  const rejected = assert.rejects(pending, /afbrudt/);
  await started;
  setup.cancel({ host: HOST, owner: '/projekt-b' });
  assert.equal(setup.logins.size, 1, 'et andet projekt kan ikke afbryde login');
  setup.cancel({ host: HOST, owner: '/projekt-a' });
  await rejected;
  assert.equal(setup.logins.size, 0);
  finishPoll(response({ state: 'approved', token, email: 'dev@kommune.dk' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.state.hosting, {});
  setup.client.call = async (_host, route) => route.endsWith('/start') ? { flowId: 'new', flowSecret: 's', approveUrl: HOST + '/extension-connect' } : { state: 'approved', token };
  assert.equal((await setup.login({ host: HOST, owner: '/projekt-a' })).connected, true, 'brugeren kan prøve igen');
});
test('Promte-login stopper ved gentagne statusfejl og frigiver forsøget', async () => {
  let failures = 0;
  const { setup } = promteSetup(url => {
    if (url.endsWith('/start')) return response({ flowId: 'f', flowSecret: 's', approveUrl: HOST + '/extension-connect' });
    failures++; throw Error('Forbindelsen fejlede');
  });
  await assert.rejects(setup.login({ host: HOST }), /kunne ikke få svar på login/);
  assert.equal(failures, 3); assert.equal(setup.logins.size, 0);
});
test('sen Promte-godkendelse fra et andet projekt kan ikke erstatte det seneste login', async () => {
  let finishFirst, firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  let count = 0;
  const { setup, store } = promteSetup(url => {
    if (url.endsWith('/start')) return response({ flowId: String(++count), flowSecret: 's', approveUrl: HOST + '/extension-connect' });
    if (new URL(url).searchParams.get('flowId') === '1') return new Promise(resolve => { finishFirst = resolve; firstStarted(); });
    return response({ state: 'approved', token, email: 'ny@kommune.dk' });
  });
  const first = setup.login({ host: HOST, owner: '/projekt-a' });
  const rejected = assert.rejects(first, /afbrudt/);
  await started;
  assert.equal((await setup.login({ host: HOST, owner: '/projekt-b' })).email, 'ny@kommune.dk');
  await rejected;
  finishFirst(response({ state: 'approved', token: jwt({ uid: 'old-user' }), email: 'gammel@kommune.dk' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.state.hosting.promte[HOST].email, 'ny@kommune.dk');
  assert.equal(setup.logins.size, 0);
});
test('Promte-logud afbryder et ventende login uden at afbryde en anden vært', async () => {
  const pendingPolls = new Map();
  let pollsStarted;
  const started = new Promise(resolve => { pollsStarted = resolve; });
  const otherHost = 'https://anden.promte.dk';
  const { setup, store } = promteSetup(url => {
    const host = new URL(url).origin;
    if (url.endsWith('/start')) return response({ flowId: host, flowSecret: 's', approveUrl: host + '/extension-connect' });
    return new Promise(resolve => { pendingPolls.set(host, resolve); if (pendingPolls.size === 2) pollsStarted(); });
  });
  const first = setup.login({ host: HOST, owner: '/projekt-a' });
  const rejected = assert.rejects(first, /afbrudt/);
  const other = setup.login({ host: otherHost, owner: '/projekt-b' });
  await started;
  assert.equal((await setup.logout({ host: HOST })).connected, false);
  await rejected;
  pendingPolls.get(HOST)(response({ state: 'approved', token, email: 'gammel@kommune.dk' }));
  pendingPolls.get(otherHost)(response({ state: 'approved', token, email: 'anden@kommune.dk' }));
  assert.equal((await other).email, 'anden@kommune.dk');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.state.hosting.promte[HOST], undefined);
  assert.equal(store.state.hosting.promte[otherHost].email, 'anden@kommune.dk');
});
test('Promte viser brugerens apps og opretter en ny app med brugeren som ejer', async () => {
  const { setup, calls, store } = promteSetup((url, options) => {
    if (url.endsWith('/start')) return response({ flowId: 'f', flowSecret: 's', approveUrl: HOST + '/extension-connect?flowId=f', pollIntervalMs: 10 });
    if (url.includes('/status')) return response({ state: 'approved', token, email: 'dev@kommune.dk' });
    if (url.endsWith('/api/app-upload/workspaces')) { assert.equal(options.headers.Authorization, 'Bearer ' + token); return response({ workspaces: [{ id: 'ws-1', name: 'Budget', activeAppVersion: 2 }, { id: '../ugyldig', name: 'X' }, { id: 'ws-2', name: '' }] }); }
    if (url.endsWith('/api/addDoc')) return response({ id: 'ws-new', data: JSON.parse(options.body).data });
    throw Error('Uventet kald ' + url);
  });
  await setup.login({ host: HOST });
  assert.deepEqual(await setup.workspaces({ host: HOST }), [{ id: 'ws-1', name: 'Budget', activeAppVersion: 2 }, { id: 'ws-2', name: 'ws-2', activeAppVersion: null }]);
  await assert.rejects(setup.createWorkspace({ host: HOST, name: ' ' }), /navn/);
  assert.deepEqual(await setup.createWorkspace({ host: HOST, name: ' Mødebooking ' }), { id: 'ws-new', name: 'Mødebooking', activeAppVersion: null });
  const body = JSON.parse(calls.find(c => c.url.endsWith('/api/addDoc')).options.body);
  assert.deepEqual(body, { path: 'workspaces', data: { name: 'Mødebooking', users: { [Buffer.from('dev@kommune.dk').toString('base64')]: 'owner' }, owner: 'user-1', createdBy: 'dev@kommune.dk', type: 'app', deleted: false, published: false } });
  // Uploadkald bruger Auras gemte login frem for CLI'ens fil.
  const provider = new PromteDeployment({ store, lookup, readCredentials: async () => ({ token: 'cli-token' }), fetcher: async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer ' + token); return response({ uploadMode: 'source', available: true }); } });
  await provider.inspect(config);
});
test('en Promte uden appliste svarer med en side; Aura siger det og lader brugeren indtaste ID', async () => {
  const { setup } = promteSetup(url => {
    if (url.endsWith('/start')) return response({ flowId: 'f', flowSecret: 's', approveUrl: HOST + '/extension-connect?flowId=f', pollIntervalMs: 10 });
    if (url.includes('/status')) return response({ state: 'approved', token, email: 'dev@kommune.dk' });
    if (url.endsWith('/api/app-upload/workspaces')) return new Response('<!doctype html><title>Promte</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    throw Error('Uventet kald ' + url);
  });
  await setup.login({ host: HOST });
  await assert.rejects(setup.workspaces({ host: HOST }), /^Error: Denne Promte-installation viser ikke en liste over apps\.$/);
});
test('Promte bruger et eksisterende CLI-login, når Aura ikke selv er logget ind', async () => {
  const setup = new PromteSetup(memoryStore(), { lookup, readCredentials: async host => host === HOST ? { token: 'cli-token' } : null });
  const state = await setup.state({ host: HOST });
  assert.equal(state.connected, true); assert.equal(state.loginSource, 'cli'); assert.ok(!JSON.stringify(state).includes('cli-token'));
  await assert.rejects(setup.createWorkspace({ host: HOST, name: 'Ny' }), /Log ind med Promte i Aura/);
});
test('Promte kræver dokumenteret source-capability og adgang uden at udlevere token', async () => {
  const { provider, reads, calls } = adapter(() => response({ available: true, uploadMode: 'source' }));
  const target = await provider.inspect(config);
  assert.equal(target.id, config.workspaceId);
  assert.deepEqual(target.uploadDestinations, [HOST, 'https://app.promte.dk']);
  assert.equal(target.portal, HOST + '/workspaces/workspace-123', 'Åbn appen i Promte fører direkte til appen');
  // Kapabiliteter og appens navn hentes begge fra den valgte vært.
  assert.deepEqual(reads, [HOST, HOST]);
  assert.equal(target.name, config.workspaceId, 'uden appliste vises ID\'et');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-for-selected-host');
  assert.ok(!JSON.stringify(target).includes('secret-for-selected-host'));
  const named = adapter(url => url.includes('/app-upload/workspaces') ? response({ workspaces: [{ id: config.workspaceId, name: 'Budget' }] }) : response({ available: true, uploadMode: 'source' }));
  assert.equal((await named.provider.inspect(config)).name, 'Budget');
  // Installationer, der kun tager færdigbyggede apps (fx en kommunes egen Promte), får en klar besked i stedet for upload.
  await assert.rejects(adapter(() => response({ available: true, uploadMode: 'built' })).provider.inspect(config), /kun imod færdigbyggede apps.*kodning\.promte\.dk/);
  for (const value of [{ available: false, uploadMode: 'source' }, { available: true }]) await assert.rejects(adapter(() => response(value)).provider.inspect(config), /kildekodeupload/);
  await assert.rejects(adapter(() => response({ error: 'secret details' }, 403)).provider.inspect(config), /administrator/);
});
test('Promte sender præcis godkendt ZIP, isolerer uploadtoken og gemmer version før upload', async () => {
  const checkpoints = [], original = artifact();
  let uploaded;
  const { provider, calls, reads } = adapter((url, options) => {
    if (url.includes('/capabilities?')) return response({ available: true, uploadMode: 'source' });
    if (url.endsWith('/prepare')) return response({ version: 7, uploadToken: 'single-upload-token', uploadHost: 'https://app.promte.dk' });
    if (url.includes('/api/upload-app?')) {
      assert.deepEqual(checkpoints.map(r => r.state), ['PREPARED']);
      assert.equal(options.headers.Authorization, 'Bearer single-upload-token');
      uploaded = options.body;
      return response({ status: 'reviewing' });
    }
    if (url.endsWith('/finalize')) {
      assert.deepEqual(JSON.parse(options.body), { workspaceId: config.workspaceId, version: 7, zipName: 'source.zip', zipSize: require('../core/komplai-publish.cjs').zip(original.files).length });
      assert.equal(options.headers.Authorization, 'Bearer secret-for-selected-host');
      return response({ releaseId: 'release-7', status: 'reviewing' });
    }
    throw Error('Ukendt API-rute');
  });
  const target = await provider.inspect(config);
  const result = await provider.deploy(config, original, target, { onUploaded: async receipt => checkpoints.push(receipt) });
  assert.deepEqual(checkpoints.map(r => r.state), ['PREPARED', 'UPLOADED', 'REVIEWING']);
  assert.equal(checkpoints[0].id, 'version:7');
  assert.equal(result.id, 'release-7'); assert.equal(result.state, 'REVIEWING'); assert.equal(result.url, null);
  const approvedZip = require('../core/komplai-publish.cjs').zip(original.files);
  assert.ok(uploaded.includes(approvedZip)); assert.equal(uploaded.indexOf(approvedZip), uploaded.lastIndexOf(approvedZip));
  assert.ok(reads.every(host => host === HOST));
  assert.equal(calls.filter(c => new URL(c.url).origin === 'https://app.promte.dk').length, 1);
});
test('Promte blokerer udokumenteret uploadvært og efterlader en kontrollerbar version', async () => {
  const checkpoints = [];
  const { provider, calls } = adapter(url => url.includes('/capabilities?') ? response({ available: true, uploadMode: 'source' }) : response({ version: 9, uploadToken: 'upload-token', uploadHost: 'https://other-provider.example' }));
  const target = await provider.inspect(config);
  await assert.rejects(provider.deploy(config, artifact(), target, { onUploaded: async value => checkpoints.push(value) }), /ikke var med i gennemgangen/);
  assert.deepEqual(checkpoints, [{ id: 'version:9', promteVersion: 9, state: 'PREPARED', url: null }]);
  assert.equal(calls.length, 3, 'kapabiliteter, appens navn og prepare; ingen upload');
});
test('Promte bevarer bekræftet upload selv om finalize fejler', async () => {
  const checkpoints = [];
  const { provider } = adapter(url => {
    if (url.includes('/capabilities?')) return response({ available: true, uploadMode: 'source' });
    if (url.endsWith('/prepare')) return response({ version: 8, uploadToken: 'once', uploadHost: 'same-server' });
    if (url.includes('/api/upload-app?')) return response({ status: 'reviewing' });
    throw Error('Forbindelsen blev afbrudt');
  });
  await assert.rejects(provider.deploy(config, artifact(), await provider.inspect(config), { onUploaded: async value => checkpoints.push(value) }), /før et nyt forsøg/);
  assert.deepEqual(checkpoints.map(c => c.state), ['PREPARED', 'UPLOADED']);
});
test('Promte kontrollerer præcis release og forveksler ikke gennemgang med udgivelse', async () => {
  const receipt = { id: 'release-7', promteVersion: 7, target: { id: config.workspaceId, host: new URL(config.host).hostname } };
  for (const [status, expected] of [['reviewing', 'REVIEWING'], ['published', 'READY'], ['blocked', 'BLOCKED'], ['rejected', 'REJECTED'], ['building', 'BUILDING'], ['unexpected', 'UNKNOWN'], ['__proto__', 'UNKNOWN'], ['constructor', 'UNKNOWN']]) {
    const { provider, calls } = adapter(() => response({ release: { id: 'release-7', version: 7, status, workspaceId: config.workspaceId } }));
    const result = await provider.status(config, receipt);
    assert.equal(result.state, expected);
    assert.equal(result.url, null);
    assert.ok(calls[0].url.includes('/releases/release-7?'));
  }
  const recover = adapter(() => response({ releases: [{ id: 'newer', version: 8, status: 'published' }, { id: 'release-7', version: 7, status: 'reviewing' }] })).provider;
  const recovered = await recover.status(config, { ...receipt, id: 'version:7' });
  assert.equal(recovered.id, 'release-7'); assert.equal(recovered.state, 'REVIEWING');
  assert.equal((await adapter(() => response({ releases: [{ id: 'newer', version: 8, status: 'published' }] })).provider.status(config, { ...receipt, id: 'version:7' })).state, 'AWAITING_UPDATE');
  await assert.rejects(adapter(() => response({ release: { id: 'release-7', version: 8, status: 'published' } })).provider.status(config, receipt), /anden version/);
  const wrongHost = adapter(() => { throw Error('Må ikke kaldes'); });
  await assert.rejects(wrongHost.provider.status({ ...config, host: 'https://another.promte.dk' }, receipt), /matcher ikke destinationen/);
  assert.equal(wrongHost.calls.length, 0);
});

test('Promte-kontrollen før login skelner en almindelig hjemmeside fra et projekt, der ikke er sat op til Promte', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-promte-kontrol-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (dir, files) => { for (const [file, data] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await fs.writeFile(path.join(dir, file), data); } return dir; };
  // Auras startprojekt: hjemmesiden i public/ uden package.json. Det er testerens fejl fra 22. oktober.
  const site = await write(path.join(root, 'side'), { 'public/index.html': '<h1>Side</h1>', 'public/styles.css': 'body{}', 'README.md': '# Side', 'harness.json': '{}' });
  assert.deepEqual(await promteSourceProblem(site), { kind: 'website', detail: 'Promte-kildekoden mangler en gyldig package.json.' });
  // En Promte-app. Byggeoutput, pakker, lokal Vite-opsætning og .env udelades som i Promtes eget værktøj.
  const ready = await write(path.join(root, 'klar'), { 'package.json': JSON.stringify({ private: true, scripts: { build: 'vite build' }, devDependencies: { react: '19.2.8', '@promte/app-library': '^0.1.6' } }), 'index.html': '<div id="root"></div>', 'src/main.jsx': '', 'vite.config.js': 'export default {}', '.env': 'HEMMELIG=1', 'dist/tailwind.config.js': '', 'node_modules/react/package.json': '{}' });
  assert.equal(await promteSourceProblem(ready), null);
  // En React-app, der ikke er sat op til Promte, og en særskilt byggekonfiguration.
  const react = await write(path.join(root, 'react'), { 'package.json': JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { react: '19.2.8' } }), 'package-lock.json': '{}', 'src/main.jsx': '' });
  const problem = await promteSourceProblem(react);
  assert.equal(problem.kind, 'setup'); assert.match(problem.detail, /devDependencies/);
  await write(ready, { 'tailwind.config.js': 'export default {}' });
  assert.match((await promteSourceProblem(ready)).detail, /tailwind\.config\.js/);
  const broken = await write(path.join(root, 'ugyldig'), { 'package.json': '{ ikke json', 'index.html': '' });
  assert.equal((await promteSourceProblem(broken)).kind, 'setup', 'en ugyldig package.json er ikke en almindelig hjemmeside');
  // Gennemgangen af den gemte version siger det samme i almindeligt dansk, med den tekniske årsag til sidst.
  assert.throws(() => validatePromteArtifact(artifact({ 'public/index.html': '<h1>Side</h1>' })), error => error.message.startsWith(PROMTE_WEBSITE) && error.message.endsWith('mangler en gyldig package.json.'));
  assert.throws(() => validatePromteArtifact(artifact({ 'package.json': '{"dependencies":{"react":"19.2.8"}}', 'src/main.jsx': 'test' })), error => error.message.startsWith(PROMTE_SETUP));
});
