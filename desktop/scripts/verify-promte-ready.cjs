// Udgiv til Promte med et projekt, der ikke er en Promte-app: Udgiv siger det før login (DESIGN.md:179) og tilbyder
// «Gør klar til Promte» eller «Vælg en anden udbyder»; årsagen ligger bag Se detaljer. «Gør klar til Promte» slår
// Promte-integrationen til for projektet, lukker dialogen og starter ombygningsbeskeden i Byg gennem den normale
// afsendelse. Prøvens appdata har ingen AI-forbindelse, så afsendelsen beder om en AI og bevarer beskeden. En egen
// kladde overskrives ikke. Et projekt, der er en Promte-app, går direkte til login. Rigtig Electron med isolerede
// appdata; Promtes netværk er blokeret, og intet sendes til en model.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../core/git.cjs');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-promte-klar-'))), project = path.join(root, 'Mødelokaler'); let app;
  // Som Auras startprojekt: en almindelig hjemmeside i public/ uden package.json, gemt som en version.
  for (const [file, data] of Object.entries({ 'public/index.html': '<!doctype html><title>Mødelokaler</title><h1>Mødelokaler</h1>', 'public/styles.css': 'body{margin:0}', 'README.md': '# Mødelokaler\n' })) {
    await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true }); await fs.writeFile(path.join(project, file), data);
  }
  await run(project, ['init']); await run(project, ['add', '.']);
  await run(project, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Testbruger', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Første version']);
  const errors = [];
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog, session }, { project, modulePath }) => {
      const require = process.getBuiltinModule('module').createRequire(modulePath), { PromteSetup } = require(modulePath);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      // Login og apps hos Promte må ikke røres, før projektet er en Promte-app.
      const calls = globalThis.promteCalls = [];
      for (const method of ['state', 'login', 'workspaces', 'createWorkspace']) PromteSetup.prototype[method] = async ({ host } = {}) => { calls.push([method, host]); return { host, installed: true, connected: false, email: '', loginSource: null, accountRequired: 'Kræver konto og betalt aftale' }; };
    }, { project, modulePath: path.resolve(__dirname, '../core/provider-promte.cjs') });
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    const notReady = page.locator('[data-deploy-step="promteNotReady"]');
    // Alle seks udbydere står på samme skærm (DESIGN.md:171).
    async function choosePromte() {
      await page.click('#deploy-button'); await idle(); await page.click('#deployment-other');
      await page.click('[data-provider="promte"]'); await idle();
    }
    await helpers.skipIntroduction(page); await helpers.enableSharing(page); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');

    // 1. Før login: overskrift og to valg. Forklaringen og de tekniske detaljer ligger bag "Se detaljer".
    await choosePromte();
    await notReady.waitFor();
    assert.equal(await page.textContent('#deployment-heading'), 'Appen er ikke klar til Promte endnu.');
    assert.equal(await page.locator('#deploy-promte-problem').isVisible(), false, 'forklaringen ligger bag Se detaljer');
    assert.match(await page.textContent('#deploy-promte-problem'), /^Promte udgiver kun apps, der er bygget til Promte\. Projektet er en almindelig hjemmeside/);
    assert.deepEqual(await notReady.locator('button:visible').allTextContents(), ['Gør klar til Promte', 'Vælg en anden udbyder']);
    assert.equal(await notReady.locator('details').evaluate(el => el.open), false);
    assert.equal(await page.textContent('#deploy-promte-problem-detail'), 'Promte-kildekoden mangler en gyldig package.json.');
    assert.equal(await page.locator('#deployment-next').isHidden(), true);
    assert.deepEqual(await app.evaluate(() => globalThis.promteCalls), [], 'intet login før projektet er en Promte-app');
    await page.screenshot({ path: path.join(root, 'ikke-promte-app.png'), animations: 'disabled' });

    // 2. Vælg en anden udbyder: tilbage til listen over udbydere.
    await page.click('#deployment-promte-other'); await idle();
    await page.locator('[data-deploy-step="providers"]').waitFor();
    assert.equal(await page.textContent('#deployment-heading'), 'Hvor vil du udgive?');
    await page.click('[data-deploy-step="providers"] [data-provider="promte"]');
    await idle(); await notReady.waitFor();

    // 3. Gør klar til Promte: integrationen slås til for projektet, og ombygningsbeskeden sendes i Byg gennem den normale
    // afsendelse. Uden AI-forbindelse beder afsendelsen om en AI og bevarer beskeden, så intet er sendt til en model.
    await page.click('#deployment-promte-prepare');
    await page.waitForFunction(() => !document.querySelector('#deployment-dialog').open);
    await page.waitForSelector('#setup:not([hidden])');
    assert.equal(await page.textContent('#setup-reason'), 'Tilslut en AI for at sende beskeden. Din kladde er bevaret.');
    const features = await page.evaluate(() => window.harness.featuresGet());
    assert.equal(features.value.exceptions['integration-promte'], true, 'kun for dette projekt');
    assert.equal(features.value.defaults['integration-promte'], false, 'standarden for andre projekter er uændret');
    assert.equal(await page.isVisible('#stop'), false, 'intet er sendt');
    await page.screenshot({ path: path.join(root, 'klar-besked.png'), animations: 'disabled' });
    await page.click('#setup-local'); await page.waitForSelector('#workspace:not([hidden])');
    assert.match(await page.inputValue('#prompt'), /^Brug projektets Promte-skill/);
    assert.equal(await page.inputValue('#work-mode'), 'free');
    assert.equal(await page.textContent('#composer-mode'), 'Byg');

    // 4. En kladde, brugeren selv har skrevet, bevares: Udgiv siger hvorfor, slår intet til og lukker ikke (Q:B2-3). Intet sættes
    // ind, og intet sendes.
    await page.fill('#prompt', 'Min egen kladde');
    const before = (await page.evaluate(() => window.harness.featuresGet())).value.exceptions;
    await choosePromte(); await notReady.waitFor(); await page.click('#deployment-promte-prepare'); await idle();
    assert.equal(await page.evaluate(() => document.querySelector('#deployment-dialog').open), true, 'dialogen bliver stående');
    assert.match(await page.textContent('#deployment-feedback'), /Din kladde står i skrivefeltet\..*Intet er ændret endnu\./);
    assert.deepEqual((await page.evaluate(() => window.harness.featuresGet())).value.exceptions, before, 'intet er slået til eller fra');
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('#prompt'), 'Min egen kladde');
    assert.equal(await page.isVisible('#stop'), false, 'intet er sendt');

    // 5. Når projektet er en Promte-app, går Udgiv direkte til Promte-adressen og login.
    await page.fill('#prompt', '');
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ private: true, scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { '@promte/app-library': '^0.1.6', react: '19.2.8', 'react-dom': '19.2.8', vite: '^5.4.10' } }));
    await fs.writeFile(path.join(project, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.jsx"></script>');
    await fs.mkdir(path.join(project, 'src')); await fs.writeFile(path.join(project, 'src/main.jsx'), 'document.getElementById("root").textContent = "Mødelokaler";');
    await choosePromte();
    await page.locator('[data-deploy-step="promteHost"]').waitFor();
    assert.equal(await notReady.isHidden(), true);
    assert.equal(await page.textContent('#deployment-heading'), 'Hvor logger du ind med Promte?');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: ['almindelig hjemmeside fanges før login', 'overskrift og to valg på dansk', 'forklaring og tekniske detaljer bag Se detaljer', 'intet Promte-login før projektet er klar', 'Vælg en anden udbyder fører til udbyderlisten', 'Gør klar til Promte slår integrationen til for projektet', 'ombygningsbeskeden går i Byg gennem den normale afsendelse og bevares uden AI', 'egen kladde bevares: Udgiv siger hvorfor og slår intet til', 'en Promte-app går direkte til login'] }, null, 2));
  } catch (error) {
    if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {});
    console.error('Prøvens filer:', root, 'Sidefejl:', errors); console.error(error); process.exitCode = 1;
  } finally { await app?.close(); }
})();
