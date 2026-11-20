// Appforløb med materiale fra repositoryets eksisterende HEAD og lokale udbydersvar.
// Ingen Git-skrivninger, CLI-login, workflows eller eksterne uploads.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { run } = require('../core/git.cjs');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const repo = path.resolve(__dirname, '../..');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-udgivelsesvalg-')));
  const project = path.join(root, 'projekt');
  const otherProject = path.join(root, 'andet-projekt');
  await fs.mkdir(otherProject);
  const head = (await run(repo, ['rev-parse', 'HEAD'])).toString().trim();
  const [versionName, versionAt] = (await run(repo, ['log', '-1', '--format=%s%x00%cI', head])).toString().trim().split('\0');
  const site = await run(repo, ['show', `${head}:site/dist/index.html`]);
  const reference = (await run(repo, ['show', `${head}:profiles/skills/harness-integration-promte/references/promte.md`])).toString();
  const manifest = /```json\n([\s\S]*?)\n```/.exec(reference)?.[1];
  const main = /```jsx\n([\s\S]*?)\n```/.exec(reference)?.[1];
  assert.ok(manifest && main, 'Promte-materialet læses fra den faktisk gemte skillreference.');
  const files = {
    'public/index.html': site,
    'promte/package.json': Buffer.from(manifest + '\n'),
    'promte/src/main.jsx': Buffer.from(main + '\n'),
    'promte/src/App.jsx': Buffer.from('export default function App() { return <h1>Isoleret Promte-prøve</h1>; }\n'),
    'promte/vite.config.js': Buffer.from('export default {};\n'),
    'promte/package-lock.json': Buffer.from('{"lockfileVersion":3}\n')
  };
  for (const [relative, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(project, relative)), { recursive: true });
    await fs.writeFile(path.join(project, relative), data);
  }
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(), errors = [], screens = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(({ dialog, shell, session }, input) => {
      const require = process.getBuiltinModule('module').createRequire(input.modulePath);
      const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
      const { Deployments } = require(input.modulePath);
      const { PromteSetup, PromteDeployment } = require('./provider-promte.cjs');
      const { AzureSetup } = require('./azure-setup.cjs');
      const { VercelSetup } = require('./vercel-setup.cjs');
      const { AzureDeployment } = require('./deployment-providers.cjs');
      const { GitHub } = require('./github.cjs');
      const { GitHubPagesDeployment, pagesWorkflow } = require('./pages-publishing.cjs');
      const PagesDeployment = Object.getPrototypeOf(GitHubPagesDeployment.prototype).constructor;
      const { DeploymentSetup } = require('./deployment-setup.cjs');
      const hash = value => createHash('sha256').update(value).digest('hex');
      globalThis.publishingProbe = { links: [], actions: [], calls: [], uploads: [], promteLogin: false, azureLogin: false, vercelLogin: false, githubLogin: true, githubFailure: 0, githubTokenUpdates: 0, githubDisconnects: 0, pagesReady: false, promteStatus: 'reviewing', pagesStatus: 'QUEUED', vercelStatus: 'BUILDING', failStatus: false, changedMaterial: false };
      const probe = globalThis.publishingProbe;
      const subscription = '11111111-2222-4333-8444-555555555555';
      const azureApp = { id: `/subscriptions/${subscription}/resourceGroups/Organisationens-gruppe/providers/Microsoft.Web/staticSites/intern-side`, name: 'intern-side', group: 'Organisationens-gruppe', subscription, location: 'westeurope', host: 'test.azurestaticapps.net' };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.project] });
      shell.openExternal = async url => { probe.links.push(url); };
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      globalThis.fetch = async url => {
        probe.calls.push({ route: String(url), site: true });
        if (String(url) === 'https://test.azurestaticapps.net' || String(url).startsWith('https://organisation.github.io/') || String(url) === 'https://test.pages.dev') return new Response(await fs.readFile(path.join(input.project, 'public/index.html')));
        throw Error('Eksternt netværk er blokeret i prøven.');
      };
      const originalReview = Deployments.prototype.review;
      const originalState = Deployments.prototype.state;
      Deployments.prototype.state = async function(selected) {
        globalThis.resetPublishingProbeProject = () => this.store.saveProject(selected, { deploymentConfig: null, deploymentLast: null, vercelGit: null, deploymentTrackingSource: null });
        return originalState.call(this, selected);
      };
      Deployments.prototype.review = async function(selected, config) {
        this.fetcher = globalThis.fetch; this.pagesFetcher = globalThis.fetch;
        this.artifact = async (selectedRoot, directory) => {
          if (selectedRoot !== input.project || !['public', 'promte', '.'].includes(directory)) throw Error('Prøven må kun læse sit isolerede materiale.');
          const sourceDirectory = directory === '.' ? 'promte' : directory;
          const relatives = input.files.filter(file => file.startsWith(sourceDirectory + '/'));
          const artifactFiles = [];
          for (const source of relatives) {
            let data = await fs.readFile(path.join(input.project, source));
            if (probe.changedMaterial && source.endsWith('index.html')) data = Buffer.from('Ændret efter gennemgang');
            artifactFiles.push({ source, file: source.slice(sourceDirectory.length + 1), data, sha256: hash(data) });
          }
          artifactFiles.sort((a, b) => a.file.localeCompare(b.file));
          return { root: selectedRoot, directory, head: input.head, version: { name: input.versionName, at: input.versionAt }, files: artifactFiles, bytes: artifactFiles.reduce((sum, file) => sum + file.data.length, 0), hash: hash(JSON.stringify(artifactFiles.map(file => [file.file, file.sha256]))) };
        };
        return originalReview.call(this, selected, config);
      };
      const originalAct = DeploymentSetup.prototype.act;
      DeploymentSetup.prototype.act = async function(selected, value) {
        probe.actions.push(value.action);
        if (value.action === 'github-state') return { connected: probe.githubLogin, expired: false, localLogin: false, account: { login: 'prøvebruger' } };
        // Promte-appen ligger i prøvens promte/, som udgivelsens rodmappe peger på ovenfor. Den rigtige kontrol læser den.
        if (value.action === 'promte-check') return originalAct.call(this, path.join(selected, 'promte'), value);
        return originalAct.call(this, selected, value);
      };
      PromteSetup.prototype.state = async ({ host } = {}) => ({ host: host || 'https://app.promte.dk', installed: true, connected: probe.promteLogin, accountRequired: 'Kræver konto og betalt aftale', loginURL: host, signupURL: 'https://promte.com/kontakt' });
      PromteSetup.prototype.login = async function(input) { probe.promteLogin = true; return this.state(input); };
      PromteDeployment.prototype.call = async function(host, route, options = {}) {
        probe.calls.push({ provider: 'promte', host, route, upload: options.upload === true });
        if (route.startsWith('/api/app-upload/capabilities?')) return { available: true, uploadMode: 'source' };
        if (route === '/api/app-upload/prepare') return { version: 7, uploadToken: 'isolated-test-token', uploadHost: 'same-server' };
        if (route.startsWith('/api/upload-app?')) { probe.uploads.push('promte'); assertArchive(options.body); return { status: 'reviewing' }; }
        if (route === '/api/app-upload/finalize') return { releaseId: 'release-7', status: probe.promteStatus };
        if (route.startsWith('/api/app-upload/releases/')) {
          if (probe.failStatus) throw Error('Isoleret statusfejl');
          return { release: { id: 'release-7', version: 7, workspaceId: 'workspace-123', status: probe.promteStatus } };
        }
        throw Error('Udokumenteret Promte-rute i prøven.');
      };
      function assertArchive(body) {
        if (!Buffer.isBuffer(body) || !body.includes(Buffer.from('PK'))) throw Error('Promte fik ikke en kildepakke.');
        // ZIP-filnavnene er ukomprimerede. Forberedelsen skal matche gennemgangens liste.
        if (body.includes(Buffer.from('vite.config.js')) || body.includes(Buffer.from('package-lock.json'))) throw Error('Promtes udeladelsesregler blev ikke anvendt før upload.');
      }
      AzureSetup.prototype.state = async () => ({ status: probe.azureLogin ? 'ready' : 'login-required', tools: { azureCli: true, swaCli: true }, subscriptions: probe.azureLogin ? [{ id: subscription, name: 'Organisationens abonnement' }] : [] });
      AzureSetup.prototype.login = async function() { probe.azureLogin = true; return this.state(); };
      AzureSetup.prototype.apps = async value => { if (value !== subscription) throw Error('Forkert abonnement'); return [azureApp]; };
      AzureDeployment.prototype.inspect = async () => ({ ...azureApp, access: 'Kontrollér organisationens adgangsregler.', region: 'westeurope', settings: {}, environmentKeys: [], portal: 'https://portal.azure.com/#resource' + azureApp.id });
      AzureDeployment.prototype.deploy = async () => { probe.uploads.push('azure'); return { id: 'harness-test', state: 'UPLOADED', url: null }; };
      AzureDeployment.prototype.status = async () => ({ state: 'READY', url: 'https://test.azurestaticapps.net' });
      VercelSetup.prototype.state = async () => ({ status: probe.vercelLogin ? 'ready' : 'login-required', teams: probe.vercelLogin ? [{ id: 'team_isoleret', slug: 'organisation', name: 'Organisationens Vercel' }] : [] });
      VercelSetup.prototype.login = async function() { probe.vercelLogin = true; return this.state(); };
      VercelSetup.prototype.api = async (route, scope) => {
        probe.calls.push({ provider: 'vercel', route, scope });
        if (scope !== 'organisation') throw Error('Forkert Vercel-team.');
        const project = { id: 'prj_isoleret', name: 'intern-side', link: { type: 'github', org: 'organisation', repo: 'side', productionBranch: 'main' }, rootDirectory: 'public' };
        if (route.startsWith('/v10/projects?')) return { projects: [project] };
        if (route === '/v9/projects/prj_isoleret') return project;
        if (route.startsWith('/v7/deployments?')) {
          if (probe.failStatus) throw Error('Isoleret statusfejl fra Vercel.');
          return { deployments: [{
            uid: 'dpl_isoleret', projectId: project.id, source: 'git', readyState: probe.vercelStatus,
            meta: { githubOrg: 'organisation', githubRepo: 'side', githubCommitSha: input.head, githubCommitRef: 'main' },
            target: 'production', url: 'test.vercel.app', createdAt: 1792500000000
          }] };
        }
        throw Error('Ukendt Vercel-rute i prøven.');
      };
      GitHub.prototype.state = async () => ({ connected: true, expired: false, account: { login: 'prøvebruger' } });
      GitHub.prototype.repositories = async () => {
        if (probe.githubFailure) throw Error('GitHub svarede HTTP ' + probe.githubFailure + '.');
        return [{ id: 123, fullName: 'organisation/side', private: true, writable: true, archived: false }];
      };
      GitHub.prototype.connectToken = async function(value) {
        if (value !== 'syntetisk-adgangsnoegle') throw Error('Kun prøvens syntetiske nøgle må bruges.');
        probe.githubTokenUpdates++; probe.githubFailure = 0; return this.state();
      };
      GitHub.prototype.disconnect = async () => { probe.githubDisconnects++; throw Error('Prøven må ikke slette en forbindelse automatisk.'); };
      PagesDeployment.prototype.setup = async function(config) {
        return { ready: probe.pagesReady, connection: { connected: true }, links: { settings: 'https://github.com/organisation/side/settings/pages', workflow: 'https://github.com/organisation/side/actions', repository: 'https://github.com/organisation/side', provider: config.provider === 'cloudflare' ? 'https://dash.cloudflare.com/' : 'https://github.com/organisation/side/settings/pages' }, message: probe.pagesReady ? 'Opsætningen er klar.' : 'Gem opsætningen og push den gennemgåede version med dit Git-værktøj.', repository: { id: 123, fullName: 'organisation/side', private: true }, head: input.head, workflow: { path: pagesWorkflow(config).path, matches: probe.pagesReady, active: probe.pagesReady, id: 456 }, pages: { url: 'https://organisation.github.io/side/', public: true, buildType: 'workflow' }, secretPresent: probe.pagesReady };
      };
      PagesDeployment.prototype.deploy = async function(config, artifact, target, { onUploaded }) {
        if (target.head !== artifact.head) throw Error('GitHub-versionen matcher ikke.');
        probe.uploads.push(config.provider);
        const receipt = { id: '11111111-2222-4333-8444-555555555555', state: 'QUEUED', runId: 987, url: null, workflowURL: 'https://github.com/organisation/side/actions/runs/987' };
        await onUploaded(receipt); return receipt;
      };
      PagesDeployment.prototype.status = async function(config) {
        if (probe.failStatus) throw Error('Isoleret statusfejl');
        return { state: probe.pagesStatus, runId: 987, url: probe.pagesStatus === 'READY' ? config.provider === 'github-pages' ? 'https://organisation.github.io/side/' : 'https://test.pages.dev' : null, workflowURL: 'https://github.com/organisation/side/actions/runs/987' };
      };
    }, { project, head, versionName, versionAt, files: Object.keys(files), modulePath: path.resolve(__dirname, '../core/deployments.cjs') });
    await helpers.skipIntroduction(page); await helpers.enableSharing(page);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    const capture = async name => {
      await page.mouse.move(0, 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await page.locator('#deployment-review').isVisible()) {
        assert.equal(await page.locator('#deployment-send').evaluate(button => {
          const box = button.getBoundingClientRect(), bounds = button.closest('dialog').getBoundingClientRect();
          return box.top >= bounds.top && box.bottom <= bounds.bottom;
        }), true, 'Udgivelsesknappen er synlig i gennemgangen.');
      }
      const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64'));
      await fs.writeFile(path.join(root, name + '.png'), Buffer.from(screenshot, 'base64'));
      screens.push(await page.locator('#deployment-dialog').evaluate((dialog, name) => ({
        name, heading: document.getElementById(dialog.getAttribute('aria-labelledby')).textContent,
        step: [...dialog.querySelectorAll('[data-deploy-step]')].find(element => element.checkVisibility())?.dataset.deployStep,
        providers: [...dialog.querySelectorAll('[data-provider]')].filter(element => element.checkVisibility()).map(element => element.dataset.provider),
        overflow: dialog.scrollWidth > dialog.clientWidth + 1,
        visibleFields: [...dialog.querySelectorAll('input:not([type=hidden]), select')].filter(element => element.checkVisibility()).map(element => element.id)
      }), name));
    };
    const step = name => page.waitForSelector(`[data-deploy-step="${name}"]:not([hidden])`);
    const click = async selector => { await page.click(selector); await idle(); };
    const state = async () => (await page.evaluate(() => window.harness.deploymentState())).value;
    const header = async (provider, value) => {
      await page.waitForFunction(({ provider, value }) => {
        const button = document.querySelector('#deployment-status');
        return !button.hidden && button.textContent.includes(provider) && button.dataset.state === value;
      }, { provider, value });
    };
    const mutate = async value => app.evaluate((_electron, value) => Object.assign(globalThis.publishingProbe, value), value);
    const reveal = async selector => { if (!await page.locator(selector).isVisible()) await page.locator('#deployment-receipt-details > summary').click(); };
    const check = async () => { await reveal('#deployment-check'); await click('#deployment-check'); };
    const pickProvider = async provider => {
      assert.ok(await page.locator(`[data-provider="${provider}"]`).isVisible(), provider + ' findes i udbyderlisten.');
      await click(`[data-provider="${provider}"]`);
    };
    const restart = async provider => {
      await page.keyboard.press('Escape');
      await app.evaluate(async () => globalThis.resetPublishingProbeProject());
      await click('#deploy-button'); await click('#deployment-other');
      await pickProvider(provider);
    };
    const review = async () => { await click('#deployment-next'); await page.waitForSelector('#deployment-review:not([hidden])'); };
    await page.click('#deploy-button'); await idle(); await capture('start');
    assert.equal(await page.locator('#deployment-dialog [data-provider]:visible').count(), 0);
    await page.click('#deployment-other'); await capture('alle-udbydere');
    assert.equal(await page.locator('#deployment-provider-list .primary').count(), 0);
    assert.equal(await page.locator('#deployment-provider-list [data-provider]').count(), 7);
    assert.deepEqual(await page.locator('#deployment-provider-list [data-provider]').evaluateAll(elements => elements.map(element => element.dataset.provider)), ['azure-containers', 'azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']);
    assert.match(await page.locator('[data-provider="promte"]').innerText(), /konto.*betalt aftale/i);
    assert.match(await page.locator('[data-provider="komplai"]').innerText(), /Kræver komplai-konto/);
    assert.doesNotMatch(await page.locator('[data-provider="komplai"]').innerText(), /betalt|aftale/i);
    assert.equal(await page.locator('#deployment-provider-list .primary').count(), 0);
    assert.deepEqual(await app.evaluate(() => globalThis.publishingProbe.uploads), []);

    await pickProvider('promte'); await step('promteHost'); await capture('promte-adresse');
    await page.fill('#deploy-promte-host', 'https://organisation.promte.dk');
    await click('#deployment-promte-host-next'); await step('setupConnection'); await capture('promte-login');
    assert.match(await page.locator('#deployment-service-requirement').innerText(), /konto.*betalt aftale/i);
    await click('#deployment-connect'); await step('promteWorkspace'); await capture('promte-arbejdsomraade');
    // Prøvens Promte har ingen appliste, så ID'et indtastes.
    await page.selectOption('#deploy-promte-workspace', '__id__'); await page.fill('#deploy-promte-workspace-id', 'workspace-123'); await click('#deployment-promte-workspace-next');
    await step('files'); assert.equal(await page.inputValue('#deploy-mode'), 'source');
    await review(); await capture('promte-gennemgang');
    assert.match(await page.locator('#deployment-files').textContent(), /package.json/);
    assert.deepEqual(await app.evaluate(() => globalThis.publishingProbe.uploads), []);
    await click('#deployment-send'); assert.equal((await state()).last.state, 'REVIEWING'); await header('Promte', 'REVIEWING'); await capture('promte-afventer-gennemgang');
    await mutate({ promteStatus: 'blocked' }); await check(); assert.equal((await state()).last.state, 'BLOCKED'); await capture('promte-blokeret');
    await mutate({ promteStatus: 'published' }); await check(); assert.equal((await state()).last.state, 'READY');
    assert.equal((await state()).last.url, null); assert.equal(await page.locator('#deployment-open').isVisible(), false);
    assert.equal(await page.locator('#deployment-main-actions .primary').getAttribute('id'), 'deployment-portal');
    assert.equal(await page.locator('#deployment-portal').textContent(), 'Åbn appen i Promte');
    assert.equal(await page.locator('#deployment-check').textContent(), 'Kontrollér status');
    await click('#deployment-portal');
    assert.equal((await app.evaluate(() => globalThis.publishingProbe.links)).at(-1), 'https://organisation.promte.dk/workspaces/workspace-123');
    assert.equal((await state()).last.checks.site.status, 'skipped'); await capture('promte-udgivet-uden-gaettet-adresse');
    await mutate({ failStatus: true }); await check(); assert.equal((await state()).last.checks.provider.status, 'unknown');
    await header('Promte', 'UNKNOWN');
    await mutate({ failStatus: false });

    await restart('azure'); await step('setupConnection'); await capture('azure-login');
    await click('#deployment-connect'); await step('setupChoice'); await capture('azure-abonnement');
    await page.selectOption('#deployment-choice', { label: 'Organisationens abonnement' }); await click('#deployment-choice-continue');
    await step('setupChoice'); await capture('azure-egen-app');
    const azureOptions = await page.locator('#deployment-choice option').evaluateAll(elements => elements.map(e => ({ value: e.value, label: e.textContent })).filter(e => e.value));
    assert.equal(azureOptions.length, 1); assert.match(azureOptions[0].label, /intern-side/);
    await page.selectOption('#deployment-choice', azureOptions[0].value);
    await click('#deployment-back'); await step('setupChoice');
    assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvilket Azure-abonnement vil du bruge?');
    assert.equal(await page.inputValue('#deployment-choice'), '11111111-2222-4333-8444-555555555555');
    assert.deepEqual(await page.locator('#deployment-choice option').allTextContents(), ['Vælg …', 'Organisationens abonnement']);
    await capture('azure-tilbage-til-abonnement');
    await click('#deployment-choice-continue'); await step('setupChoice');
    assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvilken Azure-app vil du bruge?');
    assert.equal(await page.inputValue('#deployment-choice'), azureOptions[0].value);
    await click('#deployment-choice-continue');
    await step('files'); await review(); await capture('azure-gennemgang');
    assert.match(await page.locator('#deployment-summary').textContent(), /Organisationens-gruppe/);
    assert.match(await page.locator('#deployment-summary').textContent(), /harness-test/);
    await click('#deployment-send'); await check(); assert.equal((await state()).last.checks.content.status, 'matched'); await header('Azure', 'READY'); await capture('azure-resultat');
    assert.ok((await app.evaluate(() => globalThis.publishingProbe.actions)).every(action => !/create|provision/.test(action)));

    for (const code of [401, 403]) {
      await mutate({ githubFailure: code });
      await restart('github-pages'); await step('setupConnection'); await capture('github-adgangsfejl-' + code);
      assert.match(await page.locator('#deployment-connection-note').textContent(), new RegExp('HTTP ' + code + '.*Log ind igen'));
      assert.equal(await app.evaluate(() => globalThis.publishingProbe.githubLogin), true);
      assert.equal(await app.evaluate(() => globalThis.publishingProbe.githubDisconnects), 0);
      await page.locator('#deployment-connection-help > summary').click();
      // Nøglevinduet er modalt, så Udgiv-dialogen er optaget, indtil nøglen er indtastet. Derfor ikke click().
      await page.click('#deployment-token-save');
      await require('./ui-test-helpers.cjs').enterCredential(app, 'syntetisk-adgangsnoegle');
      await idle();
      await step('pagesRepository');
      await require('./ui-test-helpers.cjs').assertNoKeyFields(page);
      assert.equal(await app.evaluate(() => globalThis.publishingProbe.githubTokenUpdates), code === 401 ? 1 : 2);
    }

    for (const provider of ['github-pages', 'cloudflare']) {
      await mutate({ pagesReady: false, pagesStatus: 'QUEUED' });
      await restart(provider); await step('pagesRepository'); await capture(provider + '-repository');
      await page.fill('#deploy-repository', 'organisation/side'); await click('#deployment-repository-next');
      await step('pagesBranch'); await page.fill('#deploy-branch', 'main'); await click('#deployment-branch-next');
      if (provider === 'cloudflare') {
        await step('cloudflareAccount'); await capture('cloudflare-konto');
        await page.fill('#deploy-cloudflare-account', 'a'.repeat(32)); await click('#deployment-cloudflare-account-next');
        await step('cloudflareProject'); await page.fill('#deploy-cloudflare-project', 'test-side'); await click('#deployment-cloudflare-project-next');
      }
      await step('directory'); await page.fill('#deploy-directory', 'public'); await click('#deployment-next');
      await step('setupConfiguration'); await capture(provider + '-opsaetning-mangler');
      assert.equal(await page.locator('#deployment-review').isVisible(), false);
      await click('#deployment-config-review'); await step('setupConfigReview'); await capture(provider + '-opsaetningsfiler');
      assert.match(await page.locator('#deployment-config-files').textContent(), /\.github\/workflows/);
      await click('#deployment-config-save'); await capture(provider + '-opsaetning-skrevet');
      const configPath = path.join(project, '.aura/publishing', provider + '.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      assert.equal(config.provider, provider); assert.equal(config.repository, 'organisation/side');
      assert.equal(Object.keys(config).some(key => /token|secret|key/i.test(key)), false);
      const workflows = await fs.readdir(path.join(project, '.github/workflows'));
      const workflow = await fs.readFile(path.join(project, '.github/workflows', workflows.find(name => name.includes(provider))), 'utf8');
      assert.match(workflow, /workflow_dispatch/); assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
      // GitHub-svaret skifter nu til den gennemgåede HEAD; der køres ingen push/commit.
      await mutate({ pagesReady: true }); await click('#deployment-config-check');
      await page.waitForSelector('#deployment-review:not([hidden])'); await capture(provider + '-gennemgang');
      await click('#deployment-send'); assert.equal((await state()).last.state, 'QUEUED'); await header(provider === 'cloudflare' ? 'Cloudflare' : 'GitHub', 'QUEUED'); await capture(provider + '-koe');
      await mutate({ pagesStatus: 'BUILDING' }); await check(); assert.equal((await state()).last.state, 'BUILDING');
      await mutate({ pagesStatus: 'READY' }); await check(); assert.equal((await state()).last.state, 'READY'); await header(provider === 'cloudflare' ? 'Cloudflare' : 'GitHub', 'READY'); await capture(provider + '-resultat');
    }
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); window.setSize(980, 720); window.webContents.setZoomFactor(1.5); });
    await capture('resultat-980-150');
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); window.setSize(1400, 1000); window.webContents.setZoomFactor(1); });
    await page.keyboard.press('Escape'); await page.click('#deployment-status'); await idle();
    assert.equal((await state()).last.config.provider, 'cloudflare');
    assert.equal(await page.locator('#deployment-result').isVisible(), true);
    await capture('cloudflare-status-fra-toplinjen');

    await restart('vercel'); await step('vercelMethod'); await capture('vercel-metode');
    await click('#deployment-vercel-git'); await step('setupConnection'); await capture('vercel-login');
    await click('#deployment-connect'); await step('setupChoice');
    await page.selectOption('#deployment-choice', 'team_isoleret'); await click('#deployment-choice-continue');
    await step('setupChoice'); await capture('vercel-projekt');
    await page.selectOption('#deployment-choice', 'prj_isoleret');
    await click('#deployment-back'); await step('setupChoice');
    assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvilket Vercel-team vil du bruge?');
    assert.equal(await page.inputValue('#deployment-choice'), 'team_isoleret');
    assert.deepEqual(await page.locator('#deployment-choice option').allTextContents(), ['Vælg …', 'Organisationens Vercel']);
    await capture('vercel-tilbage-til-team');
    await click('#deployment-choice-continue'); await step('setupChoice');
    assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvilket Vercel-projekt vil du bruge?');
    assert.equal(await page.inputValue('#deployment-choice'), 'prj_isoleret');
    await click('#deployment-choice-continue');
    await step('vercelGit'); await capture('vercel-git-forbindelse');
    assert.match(await page.locator('#deployment-vercel-details').textContent(), /organisation\/side/);
    await click('#deployment-vercel-import');
    assert.equal((await app.evaluate(() => globalThis.publishingProbe.links)).at(-1), 'https://vercel.com/organisation/intern-side/settings/git');
    await click('#deployment-vercel-track'); await step('setupConfigReview'); await capture('vercel-opsaetningsfil');
    assert.match(await page.locator('#deployment-config-files').textContent(), /\.aura\/publishing\/vercel.json/);
    assert.doesNotMatch(await page.locator('#deployment-config-files').textContent(), /\.github\/workflows/);
    await click('#deployment-config-save'); await step('tracking'); await header('Vercel', 'BUILDING'); await capture('vercel-bygger');
    const vercelConfig = JSON.parse(await fs.readFile(path.join(project, '.aura/publishing/vercel.json'), 'utf8'));
    assert.equal(vercelConfig.mode, 'git'); assert.equal(vercelConfig.project, 'prj_isoleret'); assert.equal(vercelConfig.repository, 'organisation/side');
    assert.equal(Object.keys(vercelConfig).some(key => /token|secret/i.test(key)), false);
    assert.equal(await page.locator('#deployment-tracking-open').isVisible(), false);
    await mutate({ vercelStatus: 'READY' }); await click('#deployment-tracking-refresh'); await header('Vercel', 'READY'); await capture('vercel-udgivet');
    assert.doesNotMatch(await page.locator('#deployment-feedback').textContent(), /Arbejder/);
    assert.match(await page.locator('#deployment-tracking-note').textContent(), /Udgivet.*Produktion/);
    assert.match(await page.locator('#deployment-tracking-details').textContent(), new RegExp(head.slice(0, 8)));
    await click('#deployment-tracking-open');
    assert.equal((await app.evaluate(() => globalThis.publishingProbe.links)).at(-1), 'https://test.vercel.app');
    assert.doesNotMatch(await page.locator('#deployment-feedback').textContent(), /Arbejder/);
    const checksBeforeReopen = await app.evaluate(() => globalThis.publishingProbe.calls.filter(call => call.provider === 'vercel' && call.route.startsWith('/v7/deployments?')).length);
    await page.keyboard.press('Escape'); await page.click('#deployment-status'); await idle(); await step('tracking'); await header('Vercel', 'READY');
    assert.equal(await page.locator('#deployment-tracking-open').isVisible(), true);
    assert.ok(await app.evaluate(() => globalThis.publishingProbe.calls.filter(call => call.provider === 'vercel' && call.route.startsWith('/v7/deployments?')).length) > checksBeforeReopen);
    await capture('vercel-genaabnet-status');
    await mutate({ failStatus: true }); await click('#deployment-tracking-refresh');
    await page.waitForFunction(() => document.querySelector('#deployment-status').dataset.state === 'UNKNOWN');
    assert.equal(await page.locator('#deployment-tracking-open').isVisible(), false);
    await capture('vercel-statusfejl');
    await mutate({ failStatus: false }); await click('#deployment-tracking-refresh'); await header('Vercel', 'READY');

    await page.keyboard.press('Escape');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, otherProject);
    await page.click('#open'); await page.waitForFunction(folder => document.querySelector('#project-path').textContent === folder, otherProject);
    await page.waitForFunction(() => document.querySelector('#deployment-status').hidden);
    await page.click('#deploy-button'); await idle(); await step('destination'); await capture('andet-projekt-uden-udgivelse');
    assert.equal((await state()).last, null);
    await page.keyboard.press('Escape');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForFunction(folder => document.querySelector('#project-path').textContent === folder, project);
    await header('Vercel', '');
    await page.click('#deployment-status'); await idle(); await step('tracking'); await header('Vercel', 'READY'); await capture('vercel-status-efter-projektskift');
    assert.deepEqual(await fs.readdir(otherProject), [], 'Udgivelsesopsætning må ikke flytte til et andet projekt.');
    assert.ok(screens.every(screen => !screen.overflow), JSON.stringify(screens));
    await fs.writeFile(path.join(root, 'skaermmaaling.json'), JSON.stringify(screens, null, 2));
    const probe = await app.evaluate(() => ({ uploads: globalThis.publishingProbe.uploads, actions: globalThis.publishingProbe.actions, links: globalThis.publishingProbe.links }));
    assert.deepEqual(probe.uploads, ['promte', 'azure', 'github-pages', 'cloudflare']);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, sourceCommit: head, screens, probe, limitations: ['isolerede udbydersvar og artifact-grænse', 'ingen eksterne login eller uploads', 'ingen Git-skrivninger'] }));
  } catch (error) {
    if (app) {
      const page = await app.firstWindow().catch(() => null);
      if (page) {
        await fs.writeFile(path.join(root, 'fejl.txt'), String(error.stack || error) + '\n\n' + await page.locator('body').innerText().catch(() => 'Skærmen kunne ikke læses.'));
        const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64')).catch(() => null);
        if (screenshot) await fs.writeFile(path.join(root, 'fejl.png'), Buffer.from(screenshot, 'base64'));
      }
    }
    console.error('Prøvemateriale: ' + root);
    throw error;
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
