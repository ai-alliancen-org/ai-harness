// Det faktiske udgivelsesforløb med lokale adaptere og filer fra et eksisterende commit.
// Standardprøven opretter ingen Git-versioner og foretager ingen udgivelse på nettet.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../core/git.cjs');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const live = process.argv.includes('--live-vercel');
  const repo = path.resolve(__dirname, '../..'), root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-del-cloud-'))), project = path.join(root, 'projekt'); let app;
  let head = (await run(repo, ['rev-parse', 'HEAD'])).toString().trim();
  let [name, at] = (await run(repo, ['log', '-1', '--format=%s%x00%cI'])).toString().trim().split('\0');
  let content = await run(repo, ['show', `${head}:site/dist/index.html`]);
  if (live) content = Buffer.from('<!doctype html><html lang="da"><meta charset="utf-8"><title>Aura · testudgivelse</title><h1>Aura testudgivelse</h1><p>Kun syntetisk testmateriale. Version ' + path.basename(root) + '</p></html>');
  await fs.mkdir(path.join(project, 'public'), { recursive: true }); await fs.writeFile(path.join(project, 'public/index.html'), content);
  // Den tidligere livegren bevares. Den opretter et isoleret testcommit og må kun køres med særskilt tilladelse.
  if (live) { await run(project, ['init']); await run(project, ['add', '.']); await run(project, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Testbruger', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Gem isoleret udgivelsestest']); head = (await run(project, ['rev-parse', 'HEAD'])).toString().trim(); [name, at] = (await run(project, ['log', '-1', '--format=%s%x00%cI'])).toString().trim().split('\0'); }
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(), errors = [], screens = [];
    await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog, shell, session }, { project, modulePath, head, name, at, live }) => {
      const require = process.getBuiltinModule('module').createRequire(modulePath), { Deployments } = require(modulePath), { VercelDeployment, AzureDeployment } = require('./deployment-providers.cjs');
      const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto'), hash = value => createHash('sha256').update(value).digest('hex');
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); if (live) return; globalThis.hostingLinks = []; shell.openExternal = async url => { globalThis.hostingLinks.push(url); };
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      globalThis.deploymentUploads = 0; globalThis.deploymentInspections = 0; globalThis.deploymentFetches = []; globalThis.deploymentFailure = false; globalThis.statusFailure = false; globalThis.inspectionFailure = false;
      VercelDeployment.prototype.inspect = async () => { globalThis.deploymentInspections++; if (globalThis.inspectionPause) await globalThis.inspectionPause; if (globalThis.inspectionFailure) throw Error('Vercel CLI er ikke installeret.'); return { id: 'prj_test', name: 'test', access: 'Syntetisk adgangskontrol', region: 'Ukendt', environmentKeys: [], portal: 'https://vercel.com/test/test' }; };
      VercelDeployment.prototype.deploy = async () => { globalThis.deploymentUploads++; if (globalThis.uploadPause) await globalThis.uploadPause; if (globalThis.deploymentFailure) throw Error('Syntetisk uploadfejl'); return { id: 'dpl_test', state: 'QUEUED', url: 'https://test.vercel.app' }; };
      VercelDeployment.prototype.status = async () => { if (globalThis.statusFailure) throw Error('Syntetisk statusfejl'); return { state: 'READY', url: 'https://test.vercel.app' }; };
      const { AzureSetup } = require('./azure-setup.cjs');
      const subscription = '11111111-2222-4333-8444-555555555555';
      AzureSetup.prototype.state = async () => { if (globalThis.setupPause) await globalThis.setupPause; return { status: 'ready', tools: { azureCli: true, swaCli: true }, subscriptions: [{ id: subscription, name: 'test-abonnement' }] }; };
      AzureSetup.prototype.apps = async id => { if (id !== subscription) throw Error('Forkert prøveabonnement.'); return [{ id: `/subscriptions/${subscription}/resourceGroups/test-gruppe/providers/Microsoft.Web/staticSites/Azure-test`, name: 'Azure-test', group: 'test-gruppe', subscription, location: 'westeurope', host: 'test.azurestaticapps.net' }]; };
      AzureDeployment.prototype.inspect = async () => ({ id: '/subscriptions/test/resourceGroups/test/providers/Microsoft.Web/staticSites/test', name: 'Azure-test', access: 'Testmiljø er ikke adgangsbeskyttelse', environmentKeys: [], portal: 'https://portal.azure.com/' });
      AzureDeployment.prototype.deploy = async () => { globalThis.deploymentUploads++; return { id: 'harness-test', state: 'UPLOADED', url: null }; };
      AzureDeployment.prototype.status = async () => ({ state: 'READY', url: 'https://test.azurestaticapps.net' });
      globalThis.fetch = async url => { globalThis.deploymentFetches.push(String(url)); if (String(url) === 'https://test.vercel.app') return new Response('Login', { status: 401 }); if (String(url) === 'https://test.azurestaticapps.net') return new Response(await fs.readFile(path.join(project, 'public/index.html'))); throw Error('Ekstern forbindelse er blokeret i prøven.'); };
      const original = Deployments.prototype.review;
      Deployments.prototype.review = async function(root, input) {
        this.artifact = async (selected, directory) => { if (selected !== project || directory !== 'public') throw Error('Prøven må kun læse sit isolerede projekt.'); const data = await fs.readFile(path.join(project, 'public/index.html')); return { root, directory, head, version: { name, at }, files: [{ file: 'index.html', source: 'public/index.html', data, sha256: hash(data) }], bytes: data.length, hash: hash(data) }; };
        return original.call(this, root, input);
      };
    }, { project, modulePath: path.resolve(__dirname, '../core/deployments.cjs'), head, name, at, live });
    await helpers.skipIntroduction(page); await helpers.enableSharing(page); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    const selectProvider = async id => { await page.click(`[data-provider="${id}"]`); await idle(); };
    const state = async () => (await page.evaluate(() => window.harness.deploymentState())).value;
    const reveal = async selector => { if (!await page.locator(selector).isVisible()) await page.locator('#deployment-receipt-details > summary').click(); };
    const check = async () => { await reveal('#deployment-check'); await page.click('#deployment-check'); await idle(); };
    const next = async () => { await page.click('#deployment-next'); await idle(); };
    const review = async () => { await next(); await page.waitForSelector('#deployment-review:not([hidden])'); };
    const send = async () => { await page.click('#deployment-send'); await idle(); };
    const newVersion = async () => { await reveal('#deployment-new'); await page.click('#deployment-new'); await idle(); };
    const capture = async name => {
      // Lad det synlige trin og compositorens næste billede følge DOM-opdateringen.
      await page.mouse.move(0, 0);
      const expectedHeading = await page.locator('#deployment-heading').textContent();
      await page.waitForFunction(heading => { const dialog = document.querySelector('#deployment-dialog'); return dialog.open && document.getElementById(dialog.getAttribute('aria-labelledby')).textContent === heading && !dialog.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'); }, expectedHeading);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await page.locator('#deployment-review').isVisible()) assert.equal(await page.locator('#deployment-send').evaluate(button => { const box = button.getBoundingClientRect(), dialog = button.closest('dialog').getBoundingClientRect(); return box.top >= dialog.top && box.bottom <= dialog.bottom; }), true, 'Udgiv er synlig uden at rulle gennem hele gennemgangen.');
      if (await page.locator('#deployment-review').isVisible()) assert.equal(await page.locator('#deployment-feedback').evaluate(message => { const text = message.getBoundingClientRect(), actions = document.querySelector('#deployment-review-footer .dialog-actions').getBoundingClientRect(), bounds = message.closest('dialog').getBoundingClientRect(); return text.top >= bounds.top && text.bottom <= actions.top && text.bottom <= bounds.bottom; }), true, 'Statuslinjen er synlig og dækkes ikke af handlingsrækken.');
      if (await page.locator('#deployment-result').isVisible() && !await page.locator('#deployment-receipt-details').evaluate(el => el.open)) assert.equal(await page.locator('#deployment-main-actions .primary').evaluate(button => { const box = button.getBoundingClientRect(), dialog = button.closest('dialog').getBoundingClientRect(); return box.top >= dialog.top && box.bottom <= dialog.bottom; }), true, 'Kvitteringens hovedhandling er synlig.');
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64'));
      await fs.writeFile(path.join(root, name + '.png'), Buffer.from(png, 'base64'));
      const providers = await page.locator('[data-deploy-step="providers"]').isVisible();
      if (await page.locator('[data-deploy-step="setupChoice"]').isVisible()) assert.ok(await page.locator('#deployment-dialog').evaluate(dialog => [...dialog.querySelectorAll('button,select,input[type=checkbox],input[type=radio],summary')].filter(el => el.checkVisibility() && !el.matches('[data-close],#deployment-back')).length <= 4), 'Det guidede valg har højst fire beslutningskontroller ud over Tilbage og Luk.');
      if (providers) { const visible = await page.locator('[data-deploy-step="providers"] [data-provider]:visible').evaluateAll(items => items.map(item => item.dataset.provider)); assert.deepEqual(visible, ['azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']); assert.equal(await page.locator('#deployment-more-providers').count(), 0); }
      screens.push(await page.locator('#deployment-dialog').evaluate((dialog, { name, providers }) => ({ name, providers, result: !document.querySelector('#deployment-result').hidden, setupChoice: !!dialog.querySelector('[data-deploy-step="setupChoice"]:not([hidden])'), details: [...dialog.querySelectorAll('#deployment-receipt-details[open], #deployment-technical[open]')].some(el => el.checkVisibility()), heading: document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, words: dialog.innerText.trim().split(/\s+/).length, choices: [...dialog.querySelectorAll('button,select,input[type=checkbox],input[type=radio],summary')].filter(el => el.checkVisibility()).length, fields: [...dialog.querySelectorAll('input:not([type=hidden])')].filter(el => el.checkVisibility()).length, overflow: dialog.scrollWidth > dialog.clientWidth + 1 }), { name, providers }));
    };
    if (live) {
      await page.click('#deploy-button'); await idle(); await page.click('#deployment-other'); await selectProvider('vercel'); await page.click('#deployment-vercel-once'); await idle();
      await page.fill('#deploy-scope', 'progressify'); await next(); await page.fill('#deploy-project', 'ai-harness-test'); await next(); await review(); await capture('gennemgang');
      await send(); await check(); const receipt = (await state()).last; assert.ok(receipt.id); assert.equal((await run(project, ['status', '--porcelain'])).length, 0); assert.deepEqual(errors, []); await capture('resultat');
      await fs.writeFile(path.join(root, 'kvittering.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify({ status: 'bestået', live, root, id: receipt.id, url: receipt.url, state: receipt.state, verification: receipt.verification })); return;
    }
    await page.click('#deploy-button'); await idle(); await capture('destination');
    assert.equal(await page.locator('#deployment-dialog [data-provider]:visible').count(), 0);
    assert.equal(await page.inputValue('#deploy-provider'), '');
    assert.doesNotMatch(await page.locator('[data-deploy-step="destination"]').innerText(), /komplai|Vercel|Azure/i);
    assert.deepEqual(await app.evaluate(() => ({ calls: globalThis.deploymentFetches, inspections: globalThis.deploymentInspections, uploads: globalThis.deploymentUploads })), { calls: [], inspections: 0, uploads: 0 });
    await page.click('#deployment-guides'); await capture('vejledning');
    assert.deepEqual(await page.locator('#hosting-guide-choice option').evaluateAll(items => items.map(item => item.value)), ['', 'netlify']);
    assert.equal(await page.inputValue('#hosting-guide-choice'), '', 'Vejledninger må heller ikke vælge en udbyder for brugeren.');
    for (const provider of ['netlify']) { await page.selectOption('#hosting-guide-choice', provider); assert.match(await page.locator('#hosting-guide-other').innerText(), /Aura uploader ikke herfra/); await page.click('#hosting-guide-other details > summary'); assert.match(await page.locator('#hosting-guide-other').innerText(), /Kilder gennemgået/); await page.locator('#hosting-guide-other button').first().click(); }
    assert.equal((await app.evaluate(() => globalThis.hostingLinks)).length, 1); assert.equal(await app.evaluate(() => globalThis.deploymentUploads), 0);
    assert.equal((await page.evaluate(() => window.harness.deploymentGuideOpen({ id: 'https://example.invalid', kind: 'guide' }))).ok, false);
    await page.click('#deployment-back'); await page.click('#deployment-other'); await capture('udbyder');
    assert.deepEqual(await page.locator('[data-deploy-step="providers"] [data-provider]').evaluateAll(items => items.map(item => item.dataset.provider)), ['azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']);
    assert.equal(await page.locator('[data-deploy-step="providers"] .primary').count(), 0);
    assert.deepEqual(await app.evaluate(() => ({ calls: globalThis.deploymentFetches, inspections: globalThis.deploymentInspections, uploads: globalThis.deploymentUploads })), { calls: [], inspections: 0, uploads: 0 });
    await selectProvider('vercel'); await page.click('#deployment-vercel-once'); await idle(); await capture('vercel-team'); await page.click('#deployment-provider-help'); await capture('vercel-opsaetning'); assert.match(await page.locator('#hosting-guide-setup').textContent(), /Vercel/); await page.click('#deployment-back');
    await page.locator('#deployment-form').evaluate(form => form.addEventListener('invalid', event => { window.invalidDeploymentField = event.target.id; }, true));
    await next(); assert.equal(await page.evaluate(() => window.invalidDeploymentField), 'deploy-scope'); assert.equal(await app.evaluate(() => globalThis.deploymentInspections), 0);
    await page.fill('#deploy-scope', 'test'); await next(); await capture('vercel-projekt'); await page.fill('#deploy-project', 'test'); await next(); await capture('vercel-filer'); await app.evaluate(() => { globalThis.inspectionFailure = true; }); await next(); assert.match(await page.locator('#deployment-feedback').textContent(), /CLI er ikke installeret/); await capture('mangler-cli'); await page.click('#deployment-file-options'); await page.click('#deployment-change-destination'); await page.click('#deployment-provider-settings'); await capture('opsaetning-efter-fejl'); assert.match(await page.locator('#hosting-guide-setup').textContent(), /Vercel/); for (let back = 0; back < 3; back++) await page.click('#deployment-back'); await app.evaluate(() => { globalThis.inspectionFailure = false; });
    await page.click('#deployment-file-options'); await page.click('#deployment-change-files'); await capture('projekttype'); await page.selectOption('#deploy-mode', 'source'); await next(); await capture('filmappe'); await page.click('#deployment-back'); await page.selectOption('#deploy-mode', 'static'); await next(); await next();
    await app.evaluate(() => { globalThis.inspectionPause = new Promise(resolve => { globalThis.resumeInspection = resolve; }); });
    const reviewing = review(); await page.waitForSelector('#deployment-progress:not([hidden])');
    assert.equal(await page.getAttribute('#deployment-progress', 'role'), 'status'); assert.equal(await page.getAttribute('#deployment-progress', 'aria-live'), 'polite');
    assert.equal(await page.getAttribute('#deployment-dialog', 'aria-busy'), 'true'); assert.equal(await page.isVisible('#deployment-progress .operation-spinner'), true);
    assert.equal(await page.textContent('#deployment-feedback'), '', 'Gennemgangen gentager ikke arbejdsstatus under spinneren.');
    await page.screenshot({ path: path.join(root, 'gennemgang-arbejder.png') });
    await app.evaluate(() => { globalThis.resumeInspection(); globalThis.inspectionPause = null; }); await reviewing;
    assert.equal(await page.getAttribute('#deployment-dialog', 'aria-busy'), 'false'); assert.equal(await page.isVisible('#deployment-progress'), false);
    assert.equal(await page.isVisible('#deployment-form'), false); assert.equal(await page.isVisible('#deployment-details'), false); assert.ok((await page.locator('#deployment-summary').textContent()).includes(name.slice(0, 32)), 'Gennemgangen viser versionens genkendelige navn.'); assert.match(await page.locator('#deployment-files').textContent(), /index.html/); assert.equal(await app.evaluate(() => globalThis.deploymentUploads), 0);
    await capture('gennemgang'); assert.equal(await page.evaluate(() => document.activeElement.id), 'deployment-heading');
    await fs.writeFile(path.join(project, 'public/index.html'), 'Ændret efter gennemgangen'); await send(); assert.match(await page.locator('#deployment-feedback').textContent(), /Version eller destination har ændret/); assert.equal(await app.evaluate(() => globalThis.deploymentUploads), 0); await fs.writeFile(path.join(project, 'public/index.html'), content); await review();
    await page.click('#deployment-edit'); assert.equal(await page.inputValue('#deploy-project'), 'test'); await review();
    await app.evaluate(() => { globalThis.uploadPause = new Promise(resolve => { globalThis.resumeUpload = resolve; }); });
    const sending = send(); await page.waitForSelector('#deployment-progress:not([hidden])');
    assert.equal(await page.textContent('#deployment-progress-label'), 'Udgiver …'); assert.equal(await page.locator('#deployment-send').isDisabled(), true);
    assert.equal(await page.textContent('#deployment-feedback'), 'Lukning af vinduet annullerer ikke udgivelsen.', 'Kun den særskilte oplysning om lukning står ved upload, uden endnu en arbejdsstatus.');
    await page.screenshot({ path: path.join(root, 'udgivelse-arbejder.png') });
    await app.evaluate(() => { globalThis.resumeUpload(); globalThis.uploadPause = null; }); await sending; assert.equal(await page.isVisible('#deployment-progress'), false); await check(); let receipt = (await state()).last;
    assert.match(receipt.verification, /kræver adgang/); assert.equal(await app.evaluate(() => globalThis.deploymentUploads), 1); await capture('resultat');
    // Udgiv et andet sted ligger under Se detaljer, så kvitteringen har højst to hovedknapper og Se detaljer i første lag.
    assert.equal(await page.locator('#deployment-another').isVisible(), false, 'Udgiv et andet sted står ikke i kvitteringens første lag.');
    const savedDestination = (await state()).config; await reveal('#deployment-another'); await page.click('#deployment-another');
    assert.deepEqual(await page.locator('[data-deploy-step="providers"] [data-provider]:visible').evaluateAll(items => items.map(item => item.dataset.provider)), ['azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']);
    assert.deepEqual((await state()).config, savedDestination, 'Et andet sted ændrer først den gemte destination ved en ny gennemgang.');
    await app.evaluate(() => { globalThis.setupPause = new Promise(resolve => { globalThis.resumeSetup = resolve; }); });
    const choosing = selectProvider('azure'); await page.waitForSelector('#deployment-progress:not([hidden])');
    assert.equal(await page.textContent('#deployment-progress-label'), 'Arbejder …');
    await app.evaluate(() => { globalThis.resumeSetup(); globalThis.setupPause = null; }); await choosing;
    assert.deepEqual((await state()).config, savedDestination, 'Udbyderens konto kan ses uden at overskrive gemt udgivelse.');
    await page.keyboard.press('Escape'); await page.click('#deploy-button'); await idle(); assert.equal(await page.isVisible('#deployment-result'), true);
    await app.evaluate(() => { globalThis.statusFailure = true; }); await check(); assert.match(await page.locator('#deployment-checks').textContent(), /Seneste statuskontrol mislykkedes/); assert.doesNotMatch(await page.locator('#deployment-checks').textContent(), /Udgivet ifølge/); assert.equal(await page.isVisible('#deployment-portal'), true); await capture('statusfejl');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'deploy-button'); await page.click('#deploy-button'); await idle(); assert.match(await page.locator('#deployment-checks').textContent(), /mislykkedes/);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); w.setSize(980, 720); w.webContents.setZoomFactor(1.5); }); await capture('resultat-980-150');
    await newVersion(); await review(); await capture('gennemgang-980-150'); await page.click('#deployment-edit'); await review(); await app.evaluate(() => { globalThis.deploymentFailure = true; }); await send(); receipt = (await state()).last;
    // Et uvist udfald oven på en live udgivelse står som «Upload ikke bekræftet», også i topknappen, aldrig som grønt «Udgivet» (fund R#28).
    assert.equal(receipt.state, 'UNKNOWN'); assert.equal(await page.locator('#deployment-check').evaluate(el => el.hidden), true); assert.equal(await page.isVisible('#deployment-portal'), true); assert.equal(await app.evaluate(() => globalThis.deploymentUploads), 2); await capture('ukendt-upload');
    assert.equal(await page.locator('#deployment-state').textContent(), 'Upload ikke bekræftet'); assert.equal(await page.locator('#deployment-status').getAttribute('data-state'), 'UNKNOWN');
    await page.keyboard.press('Escape'); await page.click('#deploy-button'); await idle(); assert.equal(await app.evaluate(() => globalThis.deploymentUploads), 2); assert.match(await page.locator('#deployment-state-note').textContent(), /oversigt, før du prøver en ny upload/);
    await newVersion(); await page.click('#deployment-file-options'); await page.click('#deployment-change-destination'); await page.click('#deployment-select-destination'); await page.click('#deployment-other'); await selectProvider('azure'); await idle(); await capture('azure-abonnement-980-150');
    await page.selectOption('#deployment-choice', { label: 'test-abonnement' }); await page.click('#deployment-choice-continue'); await idle(); await capture('azure-egen-app-980-150'); await page.selectOption('#deployment-choice', { label: 'Azure-test' }); await page.click('#deployment-choice-continue'); await idle(); assert.equal(await page.inputValue('#deploy-group'), 'test-gruppe');
    assert.equal(await page.locator('#deploy-mode option[value=source]').isDisabled(), true); await review(); assert.match(await page.locator('#deployment-summary').textContent(), /11111111-2222-4333-8444-555555555555.*test-gruppe.*harness-test.*erstatter/); assert.equal(await page.locator('#deployment-review-app-address').textContent(), 'Testadresse afventer udgivelse'); await capture('azure-gennemgang'); await send(); assert.equal(await page.locator('#deployment-open').evaluate(el => el.hidden), true); await check(); receipt = (await state()).last;
    assert.equal(receipt.checks.content.status, 'matched'); assert.match(await page.locator('#deployment-checks').textContent(), /HTTP 200 uden login.*matcher.*Testerens adgang.*Ikke afprøvet/); await capture('azure-resultat');
    // Guidet valg har højst fire kontroller plus navigationens Tilbage og Luk. Kvitteringen har højst fire synlige kontroller med Luk:
    // højst to hovedknapper og Se detaljer (AGENTS.md); Udgiv et andet sted ligger under Se detaljer.
    assert.ok(screens.every(screen => !screen.overflow)); assert.ok(screens.every(screen => screen.details || (screen.providers ? screen.choices === 8 : screen.setupChoice ? screen.choices <= 6 : screen.choices <= 4)), JSON.stringify(screens)); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(root, 'skaermmaaling.json'), JSON.stringify(screens, null, 2)); await fs.writeFile(path.join(root, 'kvittering.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ status: 'bestået', root, screens, sourceCommit: head, limitations: ['lokale adaptere og injiceret artifact-grænse', 'ingen rigtig Vercel- eller Azure-udgivelse', 'ingen Git-skrivninger'] }));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
