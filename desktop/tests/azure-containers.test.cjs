const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AzureContainerDeployment, containerConfiguration, validateContainerArtifact } = require('../core/azure-containers.cjs');
const { AzureSetup, containerApps } = require('../core/azure-setup.cjs');
const { Deployments, configuration } = require('../core/deployments.cjs');
const { DeploymentSetup } = require('../core/deployment-setup.cjs');
const view = require('../ui/share-view.js');
// Brug den faktiske IPC-fejlhåndtering, så genopretningsforslaget også skal overleve main-processens grænse.
function reviewIPC(action) {
  const vm = require('node:vm'), source = require('node:fs').readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const handler = source.slice(source.indexOf('function handle(channel, action) {'), source.indexOf("handle('updates:state'"));
  const frame = { url: 'harness://app/index.html' }, webContents = { mainFrame: frame };
  let invoke;
  const scope = { window: { webContents }, uiURL: frame.url, updating: false, action, recordFailure() {}, requests: { run: (_context, fn) => fn() },
    registry: { selected: { chat: { id: 'samtale' } } }, ipcMain: { handle: (_name, fn) => { invoke = fn; } } };
  vm.runInNewContext(handler + "\nhandle('deployment:review', action);", scope);
  return input => invoke({ sender: webContents, senderFrame: frame }, input);
}
const sub = '11111111-1111-4111-8111-111111111111';
const config = containerConfiguration({ provider: 'azure-containers', mode: 'container', subscription: sub, group: 'demo', project: 'demo-app' });
const id = `/subscriptions/${sub}/resourceGroups/demo/providers/Microsoft.App/containerApps/demo-app`;
const registry = { id: `/subscriptions/${sub}/resourceGroups/registry/providers/Microsoft.ContainerRegistry/registries/demoregistry`, loginServer: 'demoregistry.azurecr.io' };
const digest = 'sha256:' + 'd'.repeat(64);
const artifact = { head: 'a'.repeat(40), hash: 'b'.repeat(64), bytes: 100, files: [{ file: 'Dockerfile', data: Buffer.from('FROM node:24-alpine\nCOPY public /app\n') }, { file: 'public/index.html', data: Buffer.from('<h1>Demo</h1>') }] };
const app = () => ({ id, name: 'demo-app', location: 'swedencentral', identity: { type: 'SystemAssigned', principalId: 'identity-id' }, properties: {
  configuration: { activeRevisionsMode: 'Single', ingress: { external: true, fqdn: 'demo-app.example.swedencentral.azurecontainerapps.io', targetPort: 8080, transport: 'auto' }, registries: [{ server: registry.loginServer, identity: 'system' }], secrets: [{ name: 'runtime-secret' }] },
  template: { containers: [{ name: 'demo', image: 'demoregistry.azurecr.io/old:v1', env: [{ name: 'CONFIG', value: 'private-runtime-value' }, { name: 'API_KEY', secretRef: 'runtime-secret' }] }], scale: { minReplicas: 0, maxReplicas: 1 } }
} });
function fixture() {
  const current = app(), calls = []; let temporary;
  const provider = new AzureContainerDeployment(async (_exe, args, options) => {
    calls.push({ args, options });
    if (args[0] === 'containerapp' && args[1] === 'show') return JSON.stringify(current);
    if (args[0] === 'acr' && args[1] === 'show') return JSON.stringify(registry);
    if (args[0] === 'acr' && args[1] === 'build') { temporary = options.cwd; assert.equal(await fs.readFile(path.join(temporary, 'public/index.html'), 'utf8'), '<h1>Demo</h1>'); return JSON.stringify({ runId: 'abc123', status: 'Succeeded' }); }
    if (args[0] === 'acr' && args[1] === 'repository') return JSON.stringify({ digest });
    if (args[0] === 'containerapp' && args[1] === 'update') return '{}';
    throw Error('Unexpected command: ' + args.slice(0, 3).join(' '));
  });
  return { provider, current, calls, temporary: () => temporary };
}

test('container configuration is separate, strips credentials, and rejects unsafe paths and identifiers', () => {
  assert.equal(configuration(config).mode, 'container');
  assert.deepEqual(configuration({ ...config, token: 'private', registryPassword: 'private' }), config);
  for (const patch of [{ subscription: '--debug' }, { group: 'bad/group' }, { project: '--debug' }, { directory: '../keys' }, { dockerfile: '../Dockerfile' }, { dockerfile: '--file' }, { mode: 'static' }]) assert.throws(() => configuration({ ...config, ...patch }));
  validateContainerArtifact(config, artifact);
  assert.throws(() => validateContainerArtifact(config, { files: artifact.files.slice(1) }), /mangler Dockerfile/);
  assert.throws(() => validateContainerArtifact(config, { files: [{ file: 'Dockerfile', data: Buffer.from('not a build file') }] }), /FROM/);
});

test('the short Container Apps request receives preparation instructions even before publishing is enabled', () => {
  const { composeAppContext } = require('../core/chat-session.cjs');
  const system = (text, mode = 'free', planText = '') => composeAppContext({ prepared: { mode, messageText: text, disclosure: { projectDesign: '' }, context: { rules: 'regler', features: { deling: false }, skills: [], projectInstructions: null, integrations: [] } }, project: { name: 'Demo', purpose: 'Demo', links: [] }, plan: { id: 'plan', text: planText, source: 'ai', context: '' }, planConversation: [], surface: 'desktop' }).system;
  for (const mode of ['free', 'plan']) {
    const context = system('Gør projektet klar til Azure Container Apps', mode);
    assert.match(context, /KLARGØRING TIL AZURE CONTAINER APPS/);
    assert.match(context, /server\.cjs.*Node 24 Alpine.*uden ekstra npm-afhængigheder/s);
    assert.match(context, /Udgivelse er slået fra/);
  }
  assert.match(system('Byg planen', 'build', 'Gør klar til Azure Container Apps'), /KLARGØRING TIL AZURE CONTAINER APPS/);
  assert.doesNotMatch(system('Ret overskriften'), /KLARGØRING TIL AZURE CONTAINER APPS/);
});

test('Container Apps setup requires Azure tools but never SWA, and listing strips private configuration', async () => {
  const calls = [], setup = new AzureSetup(async (exe, args) => {
    calls.push({ exe, args });
    if (args[0] === 'version') return '{}';
    if (args[0] === 'containerapp' && args[1] === '--help') return 'help';
    if (args[0] === 'account') return JSON.stringify([{ id: sub, name: 'Demo', state: 'Enabled' }]);
    return JSON.stringify([app()]);
  }, { containers: true });
  assert.deepEqual((await setup.state()).tools, { azureCli: true, containerAppsCli: true });
  assert.equal((await setup.state()).status, 'ready');
  assert.equal((await setup.apps(sub))[0].name, 'demo-app');
  assert.equal(calls.some(c => c.exe === 'swa' || c.args.includes('create') || c.args.includes('update')), false);
  const values = containerApps([app(), app(), { ...app(), id: id.replace(sub, '22222222-2222-4222-8222-222222222222') }], sub);
  assert.equal(values.length, 1);
  assert.doesNotMatch(JSON.stringify(values), /private|secret|identity|CONFIG/);
  const invalid = app(); invalid.properties.configuration.ingress.fqdn += '.evil.invalid';
  assert.deepEqual(containerApps([invalid], sub), []);
});

test('inspection verifies existing single-container destination and returns no runtime values', async () => {
  const f = fixture(), target = await f.provider.inspect(config);
  assert.equal(target.registry.server, registry.loginServer);
  assert.deepEqual(target.environmentKeys, ['API_KEY', 'CONFIG']);
  assert.doesNotMatch(JSON.stringify(target), /private-runtime-value|runtime-secret|old:v1/);
  assert.match(target.access, /aktive version/);
  assert.equal(f.calls.every(c => ['show'].includes(c.args[1])), true);
});

test('inspection refuses mismatched accounts, password registries, internal ingress and ambiguous revisions', async () => {
  for (const mutate of [
    a => { a.id = id.replace(sub, '22222222-2222-4222-8222-222222222222'); },
    a => { a.properties.configuration.activeRevisionsMode = 'Multiple'; },
    a => { a.properties.template.containers.push({ name: 'sidecar' }); },
    a => { a.properties.configuration.ingress.external = false; },
    a => { a.properties.configuration.ingress.fqdn = 'trusted.azurecontainerapps.io.evil.invalid'; },
    a => { a.properties.configuration.registries[0].passwordSecretRef = 'secret'; },
    a => { a.properties.configuration.registries[0].identity = '/foreign/identity'; }
  ]) { const f = fixture(); mutate(f.current); await assert.rejects(f.provider.inspect(config)); assert.equal(f.calls.some(c => c.args.includes('update')), false); }
});

test('build uses only the reviewed artifact and updates only the pinned image and revision', async () => {
  const f = fixture(), target = await f.provider.inspect(config); let pending;
  const stages = [];
  const receipt = await f.provider.deploy(config, artifact, target, { onProgress: stage => {
    stages.push(stage);
    assert.equal(f.calls.some(c => c.args[1] === (stage === 'build' ? 'build' : 'update')), false, 'progress arrives before the long Azure call');
  }, onUploaded: async value => { pending = value; assert.equal(f.calls.some(c => c.args[1] === 'update'), false); } });
  assert.deepEqual(stages, ['build', 'activate']);
  assert.match(receipt.id, /^aura[a-f0-9]{16}$/);
  assert.equal(receipt.image, `demoregistry.azurecr.io/aura/demo-app@${digest}`);
  assert.equal(pending.state, 'SUBMITTING');
  const buildArgs = f.calls.find(c => c.args[1] === 'build').args;
  assert.equal(buildArgs[buildArgs.indexOf('--image') + 1], `aura/demo-app:${artifact.head.slice(0, 12)}-${artifact.hash.slice(0, 12)}-${receipt.id}`);
  const update = f.calls.find(c => c.args[1] === 'update').args;
  assert.equal(update[update.indexOf('--image') + 1], receipt.image);
  assert.equal(update[update.indexOf('--container-name') + 1], 'demo');
  for (const flag of ['--set-env-vars', '--ingress', '--min-replicas', '--user-assigned', 'create', 'secrets']) assert.equal(update.includes(flag), false);
  await assert.rejects(fs.stat(f.temporary()), { code: 'ENOENT' });
});

test('a destination change during a slow build stops the update and preserves the active app', async () => {
  const f = fixture(), target = await f.provider.inspect(config), original = f.provider.run;
  f.provider.run = async (...args) => { const result = await original(...args); if (args[1][1] === 'build') f.current.properties.template.scale.maxReplicas = 2; return result; };
  await assert.rejects(f.provider.deploy(config, artifact, target), e => e.notUploaded === true);
  assert.equal(f.calls.some(c => c.args[1] === 'update'), false);
  await assert.rejects(fs.stat(f.temporary()), { code: 'ENOENT' });
});

test('the ACR build context preserves executable scripts from the saved version', { skip: process.platform === 'win32' }, async () => {
  const f = fixture(), target = await f.provider.inspect(config), original = f.provider.run;
  const files = [...artifact.files, { file: 'start.sh', mode: '100755', data: Buffer.from('#!/bin/sh\nexec node server.cjs\n') }];
  f.provider.run = async (...args) => {
    if (args[1][1] === 'build') assert.equal((await fs.stat(path.join(args[2].cwd, 'start.sh'))).mode & 0o777, 0o755);
    return original(...args);
  };
  await f.provider.deploy(config, { ...artifact, files }, target);
});

test('a failed or unknown build never attempts a container update', async () => {
  const f = fixture(), target = await f.provider.inspect(config), original = f.provider.run;
  f.provider.run = async (...args) => args[1][1] === 'build' ? Promise.reject(Error('private-provider-error')) : original(...args);
  await assert.rejects(f.provider.deploy(config, artifact, target), e => e.notUploaded === true && !e.message.includes('private'));
  assert.equal(f.calls.some(c => c.args[1] === 'update'), false);
});

test('status matches the exact active revision, digest and Azure hostname, including scale-to-zero apps', async () => {
  const current = app(), revisionName = 'demo-app--aura' + '1'.repeat(16), image = `demoregistry.azurecr.io/aura/demo-app@${digest}`;
  current.properties.latestRevisionName = current.properties.latestReadyRevisionName = revisionName;
  const revision = { id: `${id}/revisions/${revisionName}`, name: revisionName, properties: { active: true, healthState: 'Healthy', provisioningState: 'Provisioned', runningState: 'Stopped', template: { containers: [{ image }] } } };
  const provider = new AzureContainerDeployment(async (_exe, args) => JSON.stringify(args[1] === 'revision' ? revision : current));
  const receipt = { id: 'aura' + '1'.repeat(16), image, target: { id, host: current.properties.configuration.ingress.fqdn } };
  assert.equal((await provider.status(config, receipt)).state, 'READY');
  current.properties.latestRevisionName = 'a-newer-revision'; assert.equal((await provider.status(config, receipt)).state, 'REPLACED');
  current.properties.latestRevisionName = revisionName; revision.properties.healthState = 'Unhealthy'; assert.equal((await provider.status(config, receipt)).state, 'ERROR');
  revision.properties.healthState = 'Healthy'; revision.properties.template.containers[0].image = 'foreign/image'; await assert.rejects(provider.status(config, receipt), /matcher/);
});

test('the shared review token protects containers and failed updates retain a checkable receipt', async () => {
  const f = fixture(), data = {}; const store = { project: async () => data, saveProject: async (_root, patch) => Object.assign(data, patch) };
  const deployments = new Deployments(store, { providers: { 'azure-containers': f.provider }, artifact: async () => artifact });
  const review = await deployments.review('/demo', config);
  assert.match(review.environment, /aktiv containerapp/); assert.match(view.destination(review), /erstatter den aktive/);
  const original = f.provider.run;
  f.provider.run = async (...args) => args[1][1] === 'update' ? Promise.reject(Error('unknown update outcome')) : original(...args);
  const receipt = await deployments.deploy('/demo', review.token);
  assert.ok(receipt.id); assert.equal(data.deploymentLast.state, 'SUBMITTING');
  assert.equal(data.deploymentLast.indexHash, null);
  await assert.rejects(deployments.deploy('/demo', review.token), /igen/);
});

test('Container Apps setup actions and links are routed independently from Static Web Apps', async () => {
  const calls = [], setup = new DeploymentSetup({}, {}, {}, { azureContainers: { state: async () => 'state', login: async () => 'login', apps: async s => { calls.push(s); return []; } } });
  assert.equal(await setup.act('/demo', { action: 'azure-containers-state' }), 'state');
  assert.equal(await setup.act('/demo', { action: 'azure-containers-login' }), 'login');
  await setup.act('/demo', { action: 'azure-containers-apps', config: { subscription: sub } }); assert.deepEqual(calls, [sub]);
  assert.match(await setup.open('/demo', { provider: 'azure-containers', kind: 'portal' }), /Microsoft.App/);
});

async function publishingUI(files = artifact) {
  const f = fixture(), data = {};
  const store = { project: async () => data, saveProject: async (_root, patch) => Object.assign(data, patch) };
  f.provider.status = async () => ({ state: 'READY', url: 'https://' + f.current.properties.configuration.ingress.fqdn });
  const deployments = new Deployments(store, { providers: { 'azure-containers': f.provider }, artifact: async () => files, fetcher: async () => new Response('<h1>Demo</h1>') });
  const setup = new DeploymentSetup(store, {}, deployments, { azureContainers: {
    state: async () => ({ status: 'ready', tools: { azureCli: true, containerAppsCli: true }, subscriptions: [{ id: sub, name: 'Demo subscription' }] }),
    apps: async () => containerApps([app()], sub)
  } });
  const context = { projectName: 'Container demo' }, handlers = {
    deploymentState: async () => ({ ...await deployments.state('/demo'), context }),
    deploymentGuides: async () => require('../core/hosting-guidance.cjs').catalog(),
    deploymentSetup: input => setup.act('/demo', input),
    deploymentTracking: async () => ({ root: '/demo', last: data.deploymentLast || null, automatic: false }),
    deploymentReview: async input => ({ ...await deployments.review('/demo', input), context }),
    deploymentSend: token => deployments.deploy('/demo', token),
    deploymentCheck: () => deployments.check('/demo')
  };
  const review = reviewIPC(handlers.deploymentReview);
  const harness = new Proxy({}, { get: (_, method) => method === 'deploymentReview' ? review : async value => { try { return { ok: true, value: await handlers[method](value) }; } catch (e) { return { ok: false, error: e.message }; } } });
  const ui = require('./d2-dom.cjs').mount(harness, { realSetup: true });
  return { ...f, ui, data };
}

test('real publishing markup and both UI modules carry Container Apps from selection through review and receipt', async () => {
  const f = await publishingUI(), d = f.ui;
  await d.open(); await d.click('deployment-other');
  assert.match(d.$('deployment-provider-list').textContent, /Azure Container Apps/);
  await d.choose('azure-containers'); assert.match(d.heading(), /Azure-abonnement/);
  d.$('deployment-choice').value = sub; await d.click('deployment-choice-continue');
  assert.match(d.heading(), /Container App/);
  d.$('deployment-choice').value = id; await d.click('deployment-choice-continue');
  assert.equal(d.$('deploy-mode').value, 'container'); assert.equal(d.$('deploy-directory').value, '.');
  assert.match(d.$('deployment-intro').textContent, /aktive version/);
  await d.click('deployment-file-options'); await d.click('deployment-change-files');
  assert.equal(d.$('deploy-mode').options.filter(o => !o.disabled).length, 1);
  await d.submit(); assert.equal(d.$('deployment-container-files').hidden, false);
  assert.equal(d.$('deploy-dockerfile').value, 'Dockerfile');
  await d.submit(); await d.submit(); assert.equal(d.heading(), 'Gennemgå udgivelsen');
  assert.equal(d.$('deployment-send').textContent, 'Byg og udgiv container');
  assert.match(d.$('deployment-summary').textContent, /erstatter den aktive version/);
  assert.match(d.$('deployment-summary').textContent, /Container Registry bygger Dockerfile/);
  assert.equal(f.calls.some(c => c.args[1] === 'build'), false, 'review never builds or deploys');
  await d.click('deployment-send'); assert.equal(d.heading(), 'Seneste udgivelse');
  await d.click('deployment-receipt-details').catch(() => {});
  await d.click('deployment-check');
  assert.equal(f.data.deploymentLast.checks.site.http, 200);
  assert.match(d.$('deployment-result-app-account').textContent, /Azure Container Apps/);
});

test('publishing a project without its saved Dockerfile explains the missing setup before any build', async () => {
  const f = await publishingUI({ ...artifact, files: artifact.files.slice(1) }), d = f.ui;
  await d.open(); await d.choose('azure-containers');
  d.$('deployment-choice').value = sub; await d.click('deployment-choice-continue');
  d.$('deployment-choice').value = id; await d.click('deployment-choice-continue');
  await d.submit(); assert.match(d.$('deployment-feedback').textContent, /mangler Dockerfile/);
  assert.equal(f.calls.some(c => c.args[1] === 'build' || c.args[1] === 'update'), false);
  assert.equal(d.$('deployment-prepare-container').hidden, false);
  const drafts = [];
  d.window.draftMessage = (...args) => { drafts.push(args); return true; };
  await d.click('deployment-prepare-container');
  assert.equal(d.dialog.open, false);
  assert.equal(drafts.length, 1);
  assert.match(drafts[0][0], /^Gør projektet klar til Azure Container Apps/);
  assert.match(drafts[0][0], /målport er 8080/);
  assert.match(drafts[0][0], /Dockerfile/);
  assert.match(drafts[0][1], /tryk Send/);
  assert.equal(drafts[0][2].mode, 'free');
  assert.equal(drafts[0][2].owner.chat, 'samtale');
  assert.equal(drafts[0][2].submit, undefined, 'the user must send the draft');
  assert.equal(f.calls.some(c => c.args[1] === 'build' || c.args[1] === 'update'), false);
});

test('the missing-Dockerfile helper disappears when publishing settings change', async () => {
  const f = await publishingUI({ ...artifact, files: artifact.files.slice(1) }), d = f.ui;
  await d.open(); await d.choose('azure-containers');
  d.$('deployment-choice').value = sub; await d.click('deployment-choice-continue');
  d.$('deployment-choice').value = id; await d.click('deployment-choice-continue');
  await d.submit(); assert.equal(d.$('deployment-prepare-container').hidden, false);
  await d.click('deployment-file-options');
  assert.equal(d.$('deployment-prepare-container').hidden, true);
});

test('preparation keeps the chosen build directory, Dockerfile and verified existing port without Azure credentials', async () => {
  const f = fixture(), deployments = new Deployments({ project: async () => ({}), saveProject: async () => {} }, { providers: { 'azure-containers': f.provider }, artifact: async () => ({ ...artifact, files: artifact.files.slice(1) }) });
  const input = { ...config, directory: 'app', dockerfile: 'docker/Dockerfile' };
  f.current.properties.configuration.ingress.targetPort = 3000;
  await assert.rejects(deployments.review('/demo', input), e => {
    assert.equal(e.code, 'MISSING_CONTAINER_DOCKERFILE');
    assert.match(e.recovery.draft, /byggemappen "app"/);
    assert.match(e.recovery.draft, /"app\/docker\/Dockerfile"/);
    assert.match(e.recovery.draft, /målport er 3000/);
    assert.doesNotMatch(e.recovery.draft, /private-runtime-value|identity-id|runtime-secret/);
    return true;
  });
  f.provider.preparationPort = async () => { throw Error('no Azure access'); };
  await assert.rejects(deployments.review('/demo', input), e => e.recovery?.kind === 'azure-container-prepare' && !e.recovery.draft.includes('målport er'));
});
