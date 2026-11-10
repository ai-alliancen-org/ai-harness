// Rigtig Electron, PKCE-callback, IPC og nøglelager med syntetiske konti og serversvar.
// Ingen ekstern forbindelse, modelkald, udgivelse eller Git-skrivninger. Nøgleringen simuleres.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const helpers = require('./ui-test-helpers.cjs');

async function installFixture(app, mode, project) {
  await app.evaluate(({ safeStorage, shell, dialog, session }, { mode, project }) => {
    const original = globalThis.fetch;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const address = new URL(details.url); callback({ cancel: ['http:', 'https:'].includes(address.protocol) && !['127.0.0.1', 'localhost'].includes(address.hostname) }); });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    globalThis.komplaiFixtureCalls = [];
    const coding = { contract: 'må-ikke-vises', balance: { limitMicros: 10000000 }, data: { recipients: 'Må ikke vises som AI-vilkår' } };
    const organisation = { id: 'syntetisk-org', name: 'Prøveorganisation', coding: mode === 'publish' ? null : coding, publishing: mode === 'ai' ? null : { address: 'komplai.run', tier: 'shared_free' } };
    globalThis.fetch = async (url, options = {}) => {
      const address = new URL(String(url));
      if (address.protocol === 'http:' && address.hostname === '127.0.0.1') return original(url, options);
      const route = address.pathname + address.search, method = options.method || 'GET';
      globalThis.komplaiFixtureCalls.push({ route, method });
      if (address.origin === 'https://auth.komplai.dk' && route === '/oauth/v2/token') return Response.json({ access_token: 'syntetisk-login', token_type: 'Bearer' });
      if (address.origin === 'https://syntetisk.invalid' && route === '/v1/models') return Response.json({ data: [{ id: 'anden-model', name: 'Anden model' }] });
      if (address.origin === 'https://hub.komplai.dk' && route === '/api/publish/native' && method === 'GET') {
        if (new Headers(options.headers).get('authorization') !== 'Bearer komp_publish_grant_' + 'a'.repeat(64)) throw Error('Den gemte Run-adgang blev ikke dekrypteret korrekt.');
        return Response.json({ address: 'komplai.run', slugs: true, apps: [] });
      }
      if (address.origin !== 'https://api.komplai.dk') throw Error('Prøven må ikke kontakte eksterne tjenester.');
      if (route === '/v1/aura/config') return Response.json({ issuer: 'https://auth.komplai.dk', clientId: 'syntetisk-klient', scopes: ['openid'], authorizationEndpoint: 'https://auth.komplai.dk/oauth/v2/authorize', tokenEndpoint: 'https://auth.komplai.dk/oauth/v2/token' });
      if (route === '/v1/aura/organisations?include=publishing') return Response.json({ organisations: [organisation, { id: 'gammel-ai', name: 'Ældre AI-organisation', contract: '1' }] });
      if (route === '/v1/aura/publishing/connect') {
        const input = JSON.parse(options.body);
        if (!organisation.publishing || input.organisationId !== organisation.id || input.acceptPublishing !== true || Object.keys(input).length !== 2) throw Error('Uventet udgivelsesadgang.');
        return Response.json({ id: 'syntetisk-grant', secret: 'komp_publish_grant_' + 'a'.repeat(64), address: 'komplai.run', expiresAt: '2099-01-01T00:00:00Z' });
      }
      // komplaiLogoutOffline: komplai kan ikke nås, når testeren logger ud (fund K1).
      if (method === 'DELETE' && ['/v1/aura/session', '/v1/aura/publishing/session'].includes(route)) { if (globalThis.komplaiLogoutOffline) throw Error('Ingen forbindelse i prøven.'); return Response.json({ revoked: true }); }
      throw Error('Uventet testkald: ' + method + ' ' + route);
    };
    shell.openExternal = async value => {
      const auth = new URL(value);
      if (auth.origin !== 'https://auth.komplai.dk' || auth.searchParams.get('code_challenge_method') !== 'S256') throw Error('Uventet loginadresse.');
      const callback = new URL(auth.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'syntetisk-kode');
      if (!(await original(callback)).ok) throw Error('Den lokale callback blev afvist.');
    };
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = value => Buffer.from('prøve:' + Buffer.from(value).toString('base64'));
    safeStorage.decryptString = value => Buffer.from(value.toString().slice(6), 'base64').toString();
  }, { mode, project });
}

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-komplai-forbindelser-')));
  const project = path.join(root, 'projekt'), screens = [];
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  const material = '<!doctype html><html lang="da"><title>Lokal forbindelsesprøve</title><h1>Kun syntetisk prøvemateriale</h1></html>';
  await fs.writeFile(path.join(project, 'public/index.html'), material);
  const capture = async (page, mode) => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await page.locator('#deployment-dialog').evaluate(el => el.open)) {
      const choices = await page.locator('#deployment-dialog :is(button,select,summary,input[type=checkbox],input[type=radio]):visible').count();
      const providers = await page.locator('[data-deploy-step="providers"]').isVisible();
      // Alle seks udbydere står på samme skærm med Tilbage og Luk (DESIGN.md:171, udtrykkelig undtagelse fra fire valg).
      if (providers) assert.deepEqual(await page.locator('#deployment-dialog button:visible').evaluateAll(items => items.map(item => item.dataset.provider || item.id || 'luk').sort()), ['azure', 'cloudflare', 'deployment-back', 'github-pages', 'komplai', 'luk', 'promte', 'vercel']);
      assert(providers ? choices === 8 : choices <= 4, `${mode}: ${choices} synlige kontroller`); screens.push({ mode, choices, providers });
    } else screens.push({ mode });
    await page.screenshot({ path: path.join(root, mode + '.png') });
  };
  const noInference = calls => assert.equal(calls.some(c => /\/aura\/(?:connect|account|v1\/models)$|chat\/completions|\/releases/.test(c.route)), false, 'Ingen tidligere AI-kald, modelkald eller udgivelse er tilladt.');
  const chooseRun = async (page, app, captureName) => {
    const calls = await app.evaluate(() => globalThis.komplaiFixtureCalls.length);
    await page.click('#deploy-button');
    await page.waitForSelector('[data-deploy-step="destination"]:not([hidden])');
    assert.equal(await page.locator('#deployment-dialog [data-provider]:visible').count(), 0);
    assert.equal(await page.inputValue('#deploy-provider'), '', 'En ny udgivelse må ikke have en forudvalgt udbyder.');
    assert.equal(await page.locator('#deployment-other strong').textContent(), 'Udgiv fra Aura');
    assert.equal(await page.locator('#deployment-guides strong').textContent(), 'Se udgivelsesvejledning');
    if (captureName) await capture(page, captureName + '-del');
    await page.click('#deployment-other');
    const cards = page.locator('[data-deploy-step="providers"] [data-provider]:visible');
    // Seks ligestillede udbydere i alfabetisk rækkefølge på én skærm; ingen er fremhævet.
    assert.deepEqual(await cards.evaluateAll(items => items.map(item => item.dataset.provider)), ['azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']);
    assert.equal(await cards.evaluateAll(items => items.some(item => item.matches('.primary, [aria-pressed="true"]') || /anbefalet/i.test(item.innerText))), false);
    assert.equal(await page.locator('#deployment-more-providers').count(), 0);
    assert.equal(await app.evaluate(() => globalThis.komplaiFixtureCalls.length), calls, 'Indgangen og udbydervalget må ikke kontakte en tjeneste.');
    if (captureName) await capture(page, captureName + '-udbydere');
    await page.click('[data-provider="komplai"]');
  };
  for (const mode of ['publish', 'begge', 'ai']) {
    const appdata = path.join(root, mode), errors = []; let app;
    const launch = async () => {
      app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + appdata], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
      await installFixture(app, mode, project);
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' }); await helpers.skipIntroduction(page);
      return page;
    };
    try {
      let page = await launch(); await helpers.enableSharing(page);
      if (mode === 'begge') {
        await app.evaluate(async ({ app, safeStorage }, { modulePath, project }) => {
          const require = process.getBuiltinModule('module').createRequire(modulePath), { Store } = require(modulePath);
          const store = new Store(require('node:path').join(app.getPath('userData'), 'harness'), safeStorage);
          await store.update(state => { state.connections = [
            { id: 'tidligere-ai', name: 'Tidligere komplai', kind: 'komplai', baseURL: 'https://api.komplai.dk/v1/aura/v1', secret: store.encrypt('kp_live_' + 'b'.repeat(43)), account: { authMethod: 'token', organisationName: 'Prøveorganisation' } },
            { id: 'anden-ai', name: 'Anden forbindelse', kind: 'compatible', baseURL: 'https://syntetisk.invalid/v1' }
          ]; });
          await store.saveProject(project, { selection: { connectionID: 'tidligere-ai', modelID: 'tidligere-model', routeID: '' } });
        }, { modulePath: path.join(__dirname, '../core/store.cjs'), project });
        await page.reload(); await helpers.skipIntroduction(page);
      }
      await helpers.openSetup(page); await page.click('#setup-add-provider');
      assert.equal(await page.locator('#provider-cards [data-kind="komplai"], #provider-kind option[value="komplai"]').count(), 0);
      assert.equal(await page.locator('#komplai-connect, #komplai-token').count(), 0);
      assert.equal(await page.evaluate(() => ['komplaiAccount', 'komplaiTokenCheck', 'komplaiTokenConnect', 'komplaiTokenCancel'].some(name => typeof window.harness[name] === 'function')), false);
      await capture(page, mode + '-ai-udbydere');
      await page.click('#setup-back');
      if (mode === 'begge') {
        await page.click('#setup-use-saved'); await page.selectOption('#setup-connection', 'anden-ai'); await page.click('#setup-test');
        await page.locator('#setup-ai').filter({ hasText: 'Forbindelsen svarer.' }).waitFor();
        await page.click('#setup-continue');
      } else await page.click('#setup-local');
      const beforeOpenCalls = await app.evaluate(() => globalThis.komplaiFixtureCalls.length);
      await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
      if (mode === 'begge') {
        await page.waitForSelector('#connection-warning:not([hidden])');
        assert.match(await page.locator('#connection-warning-text').innerText(), /kun til udgivelse/);
        assert.equal(await page.inputValue('#connection-select'), '', 'En gammel komplai-selection må ikke falde tilbage til en anden udbyder.');
        assert.equal(await app.evaluate(() => globalThis.komplaiFixtureCalls.length), beforeOpenCalls);
        await page.fill('#prompt', 'Bevar denne kladde ved skift fra den tidligere AI.');
        await page.click('#new'); await page.waitForSelector('#onboarding:not([hidden])'); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
        assert.equal(await page.inputValue('#prompt'), 'Bevar denne kladde ved skift fra den tidligere AI.');
        assert.equal(await page.inputValue('#connection-select'), '');
        assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), material);
        await capture(page, 'tidligere-ai-valg-og-kladde');
      }
      await chooseRun(page, app, mode === 'publish' ? 'neutralt' : '');
      await page.click('#komplai-publish-login');
      if (mode === 'ai') {
        await page.locator('#komplai-publish-feedback').filter({ hasText: 'Ingen af dine organisationer har komplai Run' }).waitFor();
        await capture(page, 'ingen-run-adgang');
        assert.equal((await page.evaluate(() => window.harness.komplaiPublishState())).value.connected, false);
        noInference(await app.evaluate(() => globalThis.komplaiFixtureCalls));
        assert.deepEqual(errors, []); continue;
      }
      await page.waitForSelector('[data-deploy-step="connect"]:not([hidden])');
      if (mode === 'publish') {
        // Tilbage fra forbindelsen til login viser «Log ind med komplai» igen og ikke kun Afbryd.
        await page.click('#deployment-back'); await page.waitForSelector('[data-deploy-step="login"]:not([hidden])');
        assert.equal(await page.locator('#komplai-publish-login').isVisible(), true); assert.equal(await page.locator('#komplai-publish-cancel').isVisible(), false);
        await capture(page, 'login-efter-tilbage');
        await page.click('#komplai-publish-login'); await page.waitForSelector('[data-deploy-step="connect"]:not([hidden])');
      }
      assert.equal(await page.locator('#komplai-publish-org').isVisible(), false);
      assert.match(await page.locator('#komplai-publish-tile').innerText(), /Prøveorganisation/);
      assert.equal(await page.locator('#komplai-publish-ai-row').count(), 0);
      assert.doesNotMatch(await page.locator('#deployment-dialog').innerText(), /må-ikke-vises|Må ikke vises som AI-vilkår/);
      await capture(page, mode + '-run-organisation');
      const invalid = await page.evaluate(() => window.harness.komplaiConnect({ organisationId: 'syntetisk-org', coding: true, publishing: true }));
      assert.equal(invalid.ok, false); assert.match(invalid.error, /Run/);
      assert.equal((await app.evaluate(() => globalThis.komplaiFixtureCalls)).some(c => c.route.endsWith('/connect')), false);
      // Afbryd uden at udstede adgang, og log ind igen fra Udgiv.
      await page.keyboard.press('Escape');
      assert.equal((await page.evaluate(() => window.harness.komplaiPublishState())).value.connected, false);
      await chooseRun(page, app); await page.click('#komplai-publish-login');
      await page.waitForSelector('[data-deploy-step="connect"]:not([hidden])'); await page.click('#komplai-publish-confirm');
      await page.waitForSelector('[data-deploy-step="app"]:not([hidden])');
      // Konto og adgang kan nås fra appvalget, så en tester i den forkerte organisation kan logge ud derfra (N:D2-3).
      assert.equal(await page.isVisible('#deploy-komplai-account'), true, 'Konto og adgang står ved appvalget');
      const before = (await page.evaluate(() => window.harness.komplaiPublishState())).value;
      assert.equal(before.connected, true); assert.equal(before.organisationId, 'syntetisk-org');
      assert.equal((await app.evaluate(() => globalThis.komplaiFixtureCalls)).filter(c => c.route === '/v1/aura/publishing/connect').length, 1);
      await capture(page, mode + '-run-forbundet');
      if (mode === 'begge') {
        await page.keyboard.press('Escape'); await helpers.menuClick(page, '#connections-button');
        await page.waitForSelector('#retired-connections-notice:not([hidden])');
        const retired = page.locator('#saved-connections .saved-connection').filter({ hasText: 'Tidligere komplai' });
        assert.equal(await retired.locator('button').count(), 1); assert.match(await retired.innerText(), /Fjern fra Aura/);
        await capture(page, 'tidligere-ai-oprydning');
        const callCount = await app.evaluate(() => globalThis.komplaiFixtureCalls.length);
        await retired.getByRole('button', { name: 'Fjern fra Aura: Tidligere komplai', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#retired-connections-notice').hidden);
        assert.equal(await app.evaluate(() => globalThis.komplaiFixtureCalls.length), callCount, 'Indsat token fjernes kun lokalt.');
        assert.deepEqual((await page.evaluate(() => window.harness.komplaiPublishState())).value, before);
        await page.click('[data-close="connections-dialog"]');
        await page.click('#new'); await page.waitForSelector('#onboarding:not([hidden])'); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
        await page.waitForSelector('#connection-warning:not([hidden])');
        assert.match(await page.locator('#connection-warning-text').innerText(), /gemte AI-forbindelse er ikke tilgængelig/);
        assert.equal(await page.inputValue('#connection-select'), '', 'En fjernet tidligere forbindelse må heller ikke udløse automatisk udbyderskift.');
        assert.equal(await page.inputValue('#prompt'), 'Bevar denne kladde ved skift fra den tidligere AI.');
        assert.equal(await app.evaluate(() => globalThis.komplaiFixtureCalls.length), callCount);
        await capture(page, 'fjernet-ai-valg-og-kladde');
      }
      const settings = await fs.readFile(path.join(appdata, 'harness/settings.json'), 'utf8');
      assert.doesNotMatch(settings, /komp_publish_grant_|kp_live_|syntetisk-login/);
      noInference(await app.evaluate(() => globalThis.komplaiFixtureCalls));
      await app.close(); app = null;
      page = await launch(); await page.waitForSelector('#workspace:not([hidden])');
      assert.deepEqual((await page.evaluate(() => window.harness.komplaiPublishState())).value, before);
      await chooseRun(page, app); await page.waitForSelector('[data-deploy-step="app"]:not([hidden])');
      await capture(page, mode + '-run-genstart');
      await page.click('#deploy-komplai-create'); await page.fill('#deploy-komplai-name', 'Ny app efter genstart'); await page.click('#deployment-next');
      assert.equal(await page.locator('[name="komplai-visibility"]:checked').count(), 0);
      await page.check('[name="komplai-visibility"][value="private"]');
      await page.click('#deployment-file-options'); await page.click('#deployment-change-destination');
      await page.locator('#deployment-account-options > summary').click(); await page.click('#deployment-account');
      if (mode === 'publish') {
        // K1: uden net kan Log ud ikke tilbagekalde adgangen. Den bevares, og trinnet tilbyder at fjerne den fra denne computer
        // alene. Kræver kanalen komplai:publish-forget i main.cjs og preload.cjs.
        await app.evaluate(() => { globalThis.komplaiLogoutOffline = true; });
        await page.click('#komplai-publish-logout');
        await page.locator('#deployment-feedback').filter({ hasText: 'kunne ikke kontaktes' }).waitFor();
        assert.equal((await page.evaluate(() => window.harness.komplaiPublishState())).value.connected, true, 'adgangen bevares, til testeren vælger');
        assert.equal(await page.locator('#komplai-publish-forget').isVisible(), true);
        await capture(page, 'run-log-ud-uden-net');
        await page.click('#komplai-publish-forget');
        await page.locator('#komplai-publish-feedback').filter({ hasText: 'fjernet fra denne computer' }).waitFor();
        await capture(page, 'run-fjernet-lokalt');
      } else {
        await page.click('#komplai-publish-logout');
        await page.locator('#komplai-publish-feedback').filter({ hasText: 'Du er logget ud' }).waitFor();
        await capture(page, mode + '-run-logget-ud');
      }
      assert.equal((await page.evaluate(() => window.harness.komplaiPublishState())).value.connected, false);
      const restartedCalls = await app.evaluate(() => globalThis.komplaiFixtureCalls);
      assert.equal(restartedCalls.filter(c => c.route === '/api/publish/native').length, 1);
      // Ved «Fjern kun fra denne computer» prøver Aura at tilbagekalde én gang til, før adgangen fjernes lokalt.
      assert.equal(restartedCalls.filter(c => c.route === '/v1/aura/publishing/session' && c.method === 'DELETE').length, mode === 'publish' ? 2 : 1);
      assert.equal(restartedCalls.some(c => /oauth|\/connect$|\/models|\/releases/.test(c.route)), false);
      const state = (await page.evaluate(() => window.harness.connectionState())).value;
      assert.equal(state.connections.some(c => c.kind === 'komplai'), false);
      assert.equal(state.retiredConnections.length, 0);
      assert.deepEqual(errors, []);
    } catch (error) {
      if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, mode + '-fejl.png') }).catch(() => {});
      console.error('Prøvemappe:', root); throw error;
    } finally { await app?.close(); }
  }
  console.log(JSON.stringify({ status: 'bestået', root, screens, checks: ['AI-udbydere og IPC uden komplai-inferens', 'seks udbydere på én skærm', 'Run via PKCE og IPC, også når organisationen tilbyder AI', 'Tilbage til login viser Log ind med komplai igen', 'AI-only organisation giver ingen Run-adgang', 'ingen AI-vilkår eller samtidig AI-tilslutning', 'tidligere modelvalg skifter ikke automatisk udbyder', 'projekt og kladde bevares', 'oprydning af tidligere AI-token bevarer Run', 'Run bevares efter rigtig Electron-genstart', 'logout tilbagekalder Run-adgang', 'uden net kan adgangen fjernes fra denne computer alene', 'ingen modelkald eller udgivelse'], limitations: ['syntetisk identitetsudsteder og API', 'nøglering simuleret', 'ingen Windows-prøve'] }));
})().catch(error => { console.error(error); process.exitCode = 1; });
