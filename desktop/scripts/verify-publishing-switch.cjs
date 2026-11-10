// Præcis brugerrejse: tidligere komplai-udgivelse → Log ud → Tilbage → Azure.
// Rigtig Electron-brugerflade, isolerede testdata og kontrolleret udbydergrænse.
// Ingen konto, fjernapp, model eller Git-historik ændres.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-udbyderskift-')));
  const project = path.join(root, 'projekt'); await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.copyFile(path.resolve(__dirname, '../../site/dist/index.html'), path.join(project, 'public/index.html'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' }); await helpers.forbidGitWrites(app);
    await app.evaluate(({ dialog, ipcMain, session }, project) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      const config = { provider: 'komplai', appId: 'konto-a-app', visibility: 'private', directory: 'public' };
      const saved = { config, last: { id: 'tidligere-udgivelse', appId: config.appId, config, target: { name: 'Huskeliste hos komplai', owner: 'Organisation A', url: 'https://huskeliste.example.test', portal: 'https://portal.example.test/huskeliste', access: 'Organisationens medlemmer' }, state: 'READY', url: 'https://huskeliste.example.test', head: 'gemt-version', hash: 'udgivet-indhold' }, context: { projectName: 'Huskeliste', copyCount: 0 } };
      const probe = globalThis.providerSwitchProbe = { saved, before: JSON.stringify(saved), connected: true, cancelled: 0, disconnected: 0, calls: [], forbidden: [], network: [] };
      const respond = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, input, owner) => { probe.calls.push({ channel, input, owner }); return { ok: true, value: fn(input, owner) }; }); };
      respond('deployment:state', () => saved);
      respond('deployment:tracking', () => ({ root: project, last: saved.last }));
      respond('komplai:publish-state', () => ({ connected: probe.connected, organisationName: 'Organisation A' }));
      respond('komplai:cancel', () => { probe.cancelled++; return true; });
      respond('komplai:publish-disconnect', () => { probe.disconnected++; probe.connected = false; return { connected: false }; });
      respond('deployment:setup', input => {
        if (input.action !== 'azure-state' || input.config.provider !== 'azure') { probe.forbidden.push(input); throw Error('Kun læsning af Azure-loginstatus er tilladt i denne prøve.'); }
        return { connected: false, status: 'login-required', tools: { azureCli: true, swaCli: true } };
      });
      for (const channel of ['deployment:review', 'deployment:send', 'deployment:open', 'deployment:setup-open', 'komplai:login', 'komplai:connect']) respond(channel, input => { probe.forbidden.push({ channel, input }); throw Error('Denne prøve må kun skifte udbyder i brugerfladen.'); });
      globalThis.fetch = async (...args) => { probe.network.push(String(args[0])); throw Error('Ingen ekstern konto eller udbyder må kontaktes i denne prøve.'); };
    }, project);
    await helpers.skipIntroduction(page); await helpers.enableSharing(page); await helpers.openExistingProject(app, page, project);
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled && document.querySelector('#deployment-progress').hidden);
    const assertReceiptPreserved = async () => {
      const probe = await app.evaluate(() => globalThis.providerSwitchProbe);
      assert.equal(JSON.stringify(probe.saved), probe.before, 'Valg af Azure ændrer hverken gemt destination, appadresse eller seneste udgivelse.');
      assert.deepEqual(probe.forbidden, []); assert.deepEqual(probe.network, []);
      assert.equal(await page.textContent('#project-path'), project);
    };
    const openReceipt = async () => {
      await page.click('#deploy-button'); await page.waitForSelector('#deployment-result:not([hidden])'); await idle();
      assert.equal(await page.textContent('#deployment-result-app-name'), 'Huskeliste hos komplai');
      assert.equal(await page.inputValue('#deploy-provider'), 'komplai');
      // Kvitteringen har højst fire synlige kontroller med Luk: højst to hovedknapper og Se detaljer (AGENTS.md). Konto og adgang og
      // Udgiv et andet sted ligger under Se detaljer.
      const choices = await page.locator('#deployment-dialog').evaluate(dialog => [...dialog.querySelectorAll('button,select,input[type=checkbox],input[type=radio],summary')].filter(el => el.checkVisibility()).length);
      assert.ok(choices <= 4, `Kvitteringen har ${choices} synlige kontroller.`);
      assert.equal(await page.locator('#deployment-komplai-account').isVisible(), false); assert.equal(await page.locator('#deployment-another').isVisible(), false);
      await assertReceiptPreserved();
    };
    const details = () => page.locator('#deployment-receipt-details > summary').click();
    const chooseAzure = async screenshot => {
      await page.waitForSelector('[data-deploy-step="providers"]:not([hidden])');
      assert.equal(await page.locator('[data-provider="azure"]').isEnabled(), true);
      await page.locator('[data-provider="azure"]').click();
      await page.waitForSelector('[data-deploy-step="setupConnection"]:not([hidden])'); await idle();
      assert.equal(await page.inputValue('#deploy-provider'), 'azure');
      assert.equal(await page.textContent('#deployment-service-name'), 'Azure Static Web Apps');
      assert.equal(await page.isVisible('[data-deploy-step="login"]'), false, 'komplai-login står ikke i vejen for Azure.');
      assert.equal(await page.locator('#deployment-connect').isEnabled(), true);
      await assertReceiptPreserved(); await page.screenshot({ path: path.join(root, screenshot) });
    };

    await openReceipt(); await details(); await page.click('#deployment-komplai-account');
    await page.waitForSelector('[data-deploy-step="account"]:not([hidden])'); await idle();
    await page.click('#komplai-publish-logout');
    await page.waitForSelector('[data-deploy-step="login"]:not([hidden])'); await idle();
    assert.match(await page.textContent('#komplai-publish-feedback'), /Du er logget ud/);
    assert.equal(await page.locator('#deployment-back').isVisible(), true); assert.equal(await page.locator('#deployment-back').isEnabled(), true);
    await page.screenshot({ path: path.join(root, 'logget-ud-med-tilbage.png') });
    await page.click('#deployment-back'); await chooseAzure('azure-efter-log-ud.png');

    // Lukning/genåbning viser stadig kvitteringen for den eksisterende app.
    await page.locator('#deployment-dialog [data-close]').click(); await openReceipt();
    await page.screenshot({ path: path.join(root, 'komplai-kvittering-bevaret.png') });
    // Den direkte udbydervej virker også, efter at komplai-adgangen er fjernet.
    await details(); await page.click('#deployment-another'); await chooseAzure('azure-via-andet-sted.png');
    const probe = await app.evaluate(() => globalThis.providerSwitchProbe);
    assert.equal(probe.connected, false); assert.equal(probe.cancelled, 1); assert.equal(probe.disconnected, 1);
    assert.equal(probe.calls.filter(call => call.channel === 'deployment:setup').length, 2);
    for (const call of probe.calls) if (call.owner?.root) assert.equal(call.owner.root, project);
    await helpers.assertNoGitWrites(app); assert.deepEqual(errors, []);
    const report = { status: 'bestået', root, routes: ['Komplai-kvittering → Se detaljer → Konto og adgang → Log ud → Tilbage → Azure', 'Bevaret Komplai-kvittering → Se detaljer → Udgiv et andet sted → Azure'], disconnected: probe.disconnected, savedReceiptUnchanged: true, limitations: ['Kontrolleret konto- og udbydergrænse', 'Ingen rigtig konto, fjernapp eller udgivelse ændret', 'Ingen modelkald eller Git-skrivninger'] };
    await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
