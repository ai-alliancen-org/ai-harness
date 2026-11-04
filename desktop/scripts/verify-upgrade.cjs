const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const oldBundle = path.resolve(process.argv[2] || ''), newBundle = path.resolve(process.argv[3] || '');
  const nativeZIP = process.argv[4] ? path.resolve(process.argv[4]) : null;
  const installationOnly = process.argv[5] === '--installation-only';
  if (process.argv[5] && !installationOnly || process.argv.length > 6) throw new Error('Ukendt testvalg. Brug eventuelt --installation-only efter ZIP-stien.');
  if (process.platform !== 'darwin' || !oldBundle.endsWith('.app') || !newBundle.endsWith('.app') || oldBundle === newBundle) throw new Error('Angiv to forskellige Mac-apps: tidligere version og ny version. Tilføj den nye ZIP for en native opdateringsprøve.');
  await fs.access(oldBundle); await fs.access(newBundle);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-upgrade-'))), programs = path.join(root, 'Programmer'), data = path.join(root, 'appdata');
  console.log('Testmateriale: ' + root);
  let installed = path.join(programs, path.basename(oldBundle));
  await fs.mkdir(programs);
  let app, page, requests = 0, requestsBeforeUpdate = 0, downloadCount = 0, updateInfo, usesBundledController = false;
  const key = 'SYNTHETISK_TESTNOEGLE_KUN_LOKALT';
  const server = http.createServer((req, res) => {
    if (nativeZIP && req.url === '/feed') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(updateInfo)); }
    if (nativeZIP && req.url === '/update.zip') { downloadCount++; res.setHeader('content-length', updateInfo.files[0].size); return createReadStream(nativeZIP).pipe(res); }
    requests++; assert.equal(req.headers.authorization, 'Bearer ' + key);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'opdateringsproeve' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverURL = `http://127.0.0.1:${server.address().port}`;
  const bundleVersion = bundle => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  async function launch() {
    app = await electron.launch({ executablePath: path.join(installed, 'Contents/MacOS', path.basename(installed, '.app')), args: ['--user-data-dir=' + data], env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ELECTRON_RUN_AS_NODE: undefined } });
    await helpers.forbidGitWrites(app);
    await helpers.isolateDocuments(app, path.join(root, 'Dokumenter'));
    page = await app.firstWindow(); await helpers.skipIntroduction(page);
    // Prøven må kun kontakte sin egen server, heller ikke ved den nye versions automatiske kontrol.
    await app.evaluate(({ session }) => session.fromPartition('electron-updater').webRequest.onBeforeRequest((_request, callback) => callback({ cancel: true })));
  }
  try {
    // APFS-kloning skal lykkes udtrykkeligt; en skjult fuld kopi kan opbruge testmaskinens disk.
    execFileSync('/bin/cp', ['-cR', oldBundle, installed]); await launch();
    const oldVersion = await app.evaluate(({ app }) => app.getVersion()), targetVersion = bundleVersion(newBundle);
    console.log('Tidligere version startet: ' + oldVersion);
    const project = path.join(root, 'Bevaret projekt');
    await fs.mkdir(path.join(project, 'public'), { recursive: true });
    const original = '<!doctype html><html lang="da"><meta charset="utf-8"><title>Opgraderingsprøve</title><h1>Bevaret indhold</h1></html>';
    await fs.writeFile(path.join(project, 'public/index.html'), original);
    await helpers.openExistingProject(app, page, project);
    await assert.rejects(fs.access(path.join(project, '.git')), { code: 'ENOENT' });
    await page.frameLocator('#preview').getByRole('heading', { name: 'Bevaret indhold' }).waitFor();
    let id;
    if (!installationOnly) {
      // Siden 0.7 kan en nøgle kun indtastes i det isolerede nøglevindue, så forbindelsen gemmes den vej (og kun den vej).
      const connection = await helpers.addConnection(page, { name: 'Bevaret forbindelse', baseURL: serverURL + '/v1', apiKey: key, app });
      assert.equal(JSON.stringify(connection).includes(key), false); id = connection.id;
      const before = requests; requestsBeforeUpdate = null;
      assert.equal((await page.evaluate(id => window.harness.models(id), id)).ok, true); assert.ok(requests > before, 'modellisten hentes med den gemte nøgle'); requestsBeforeUpdate = requests;
    }
    assert.equal((await page.evaluate(() => window.harness.saveDesign({ name: 'Bevaret design', color: '#0052cc', links: ['https://design.gentofte.dk/'] }))).ok, true);
    await page.fill('#prompt', 'Bevar kladden gennem opdatering');
    await page.evaluate(async () => { await saveChatDraft(true); });
    console.log(installationOnly ? 'Projekt, kladde og design er gemt. Særskilt installationsprøve uden nøglelagring.' : 'Projekt, forbindelse, kladde og design er gemt. Udskifter testappen.');
    await helpers.assertNoGitWrites(app);
    if (nativeZIP) {
      const nativeController = await app.evaluate(({ app }) => {
        const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
        const modulePath = app.getAppPath() + '/core/updates.cjs';
        if (!require('node:fs').existsSync(modulePath)) return false;
        const { Updates } = require(modulePath), original = Updates.prototype.snapshot;
        Updates.prototype.snapshot = function () { global.nativeTest = this; Updates.prototype.snapshot = original; return original.call(this); };
        return true;
      });
      usesBundledController = nativeController;
      if (nativeController) {
        assert.equal((await page.evaluate(() => window.harness.updatesState())).ok, true);
        assert.equal(await app.evaluate(() => global.nativeTest?.version), oldVersion, 'Prøven bruger den tidligere pakkes egen opdateringscontroller.');
      }
      const hash = createHash('sha512'); for await (const chunk of createReadStream(nativeZIP)) hash.update(chunk);
      updateInfo = { version: targetVersion, files: [{ url: `https://github.com/ai-alliancen-org/ai-harness/releases/download/v${targetVersion}/Aura-${targetVersion}-mac-${process.arch}.zip`, sha512: hash.digest('base64'), size: (await fs.stat(nativeZIP)).size }] };
      // Brug den gamle apps egen klient. Kun apps fra før updateren blev indført
      // får den nye klient indlæst i testprocessen. Bundterne ændres aldrig.
      await app.evaluate(async ({ app, session }, { fallbackSource, root, serverURL, nativeController }) => {
        const source = nativeController ? app.getAppPath() : fallbackSource;
        const require = process.getBuiltinModule('module').createRequire(source + '/package.json');
        const { MacUpdater } = require(source + '/node_modules/electron-updater');
        const { DownloadedUpdateHelper } = require(source + '/node_modules/electron-updater/out/DownloadedUpdateHelper');
        const { Updates } = require(source + '/core/updates.cjs');
        const fs = require('node:fs/promises'), updater = new MacUpdater();
        updater.updateConfigPath = root + '/app-update.yml';
        await fs.writeFile(root + '/app-update.yml', JSON.stringify({ provider: 'generic', url: serverURL, updaterCacheDirName: 'aura-native-test' }));
        updater.downloadedUpdateHelper = new DownloadedUpdateHelper(root + '/download-cache');
        session.fromPartition('electron-updater').webRequest.onBeforeRequest((request, callback) => {
          if (request.url.startsWith('https://ai-alliancen-org.github.io/ai-harness/updates/')) return callback({ redirectURL: serverURL + '/feed' });
          if (request.url.startsWith('https://github.com/ai-alliancen-org/ai-harness/releases/download/')) return callback({ redirectURL: serverURL + '/update.zip' });
          callback({ cancel: !request.url.startsWith(serverURL + '/') });
        });
        if (nativeController) {
          global.nativeTest.close();
          global.nativeTest.connect(updater);
          global.nativeTest.set({ phase: 'idle', error: '' });
          global.nativeTest.install = () => updater.quitAndInstall(false, false);
        } else global.nativeTest = new Updates({ updater, store: { read: async () => ({}), update: async () => {} }, version: app.getVersion() });
        const record = (event, detail = '') => require('node:fs').appendFileSync(root + '/native-events.jsonl', JSON.stringify({ at: new Date().toISOString(), event, detail }) + '\n');
        global.recordNativeEvent = record;
        for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'update-downloaded']) updater.nativeUpdater.on(event, () => record(event));
        updater.nativeUpdater.on('error', error => record('native-error', error.message));
        app.on('before-quit', () => record('before-quit'));
        app.on('will-quit', () => record('will-quit'));
        // Squirrel genstarter uden --user-data-dir. Prøven åbner derfor selv appen igen med isolerede data.
        updater.autoRunAppAfterInstall = false;
        updater.on('error', error => { global.nativeFailure = error.message; });
        const state = await global.nativeTest.check(); if (state.phase !== 'available') throw new Error(JSON.stringify(state));
        const ready = await global.nativeTest.download(); if (ready.phase !== 'ready') throw new Error(JSON.stringify(ready));
        record('download-ready');
      }, { fallbackSource: path.resolve(__dirname, '..'), root, serverURL, nativeController });
      assert.equal(downloadCount, 1);
      console.log('Den signerede ZIP er hentet. Starter native installation.');
      // Squirrel henter hele arkivet gennem sin lokale proxy og kontrollerer signaturen, før appen lukkes.
      // Store arkiver på en travl maskine kan overskride standardgrænsen; hæv den med HARNESS_INSTALL_TIMEOUT.
      const installTimeout = Number(process.env.HARNESS_INSTALL_TIMEOUT || 180000);
      const closed = app.waitForEvent('close', { timeout: installTimeout });
      const installStarted = Date.now();
      await app.evaluate(() => { void global.nativeTest.restart().then(state => global.recordNativeEvent('restart-result', state)).catch(error => { global.nativeFailure = error.message; global.recordNativeEvent('restart-error', error.message); }); });
      await closed; app = null;
      console.log(`Appen lukkede efter ${Math.round((Date.now() - installStarted) / 1000)} sekunder; Squirrel installerer.`);
      const deadline = Date.now() + 120000;
      while (true) {
        let version; try { version = bundleVersion(installed); } catch {}
        if (version === targetVersion) break;
        if (Date.now() > deadline) throw new Error('Den native installation nåede ikke målversionen. Testmateriale: ' + root);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      execFileSync('codesign', ['--verify', '--deep', '--strict', installed]);
    } else {
      await app.close(); app = null;
      await fs.rm(installed, { recursive: true }); installed = path.join(programs, path.basename(newBundle));
      execFileSync('/bin/cp', ['-cR', newBundle, installed]);
    }
    await launch();
    const newVersion = await app.evaluate(({ app }) => app.getVersion()); assert.equal(newVersion, targetVersion); assert.notEqual(newVersion, oldVersion);
    await helpers.assertNoGitWrites(app);
    assert.equal(requests, installationOnly ? 0 : requestsBeforeUpdate, 'Opdatering må ikke selv sende til en forbindelse');
    if (!installationOnly) {
      const state = await page.evaluate(() => window.harness.connectionState()); assert.ok(state.value.connections.some(c => c.id === id)); assert.equal(JSON.stringify(state).includes(key), false);
      assert.equal((await page.evaluate(id => window.harness.models(id), id)).ok, true, 'Den gemte krypterede nøgle kan stadig bruges'); assert.equal(requests, requestsBeforeUpdate + 1);
    }
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), original);
    await page.waitForSelector('#workspace:not([hidden])');
    await page.frameLocator('#preview').getByRole('heading', { name: 'Bevaret indhold' }).waitFor();
    assert.equal(await page.inputValue('#prompt'), 'Bevar kladden gennem opdatering');
    assert.ok((await page.evaluate(() => window.harness.listDesigns())).value.some(d => d.name === 'Bevaret design'));
    await page.screenshot({ path: path.join(root, 'opdateret.png'), animations: 'disabled' });
    await helpers.assertNoGitWrites(app);
    await assert.rejects(fs.access(path.join(project, '.git')), { code: 'ENOENT' });
    const result = { status: 'bestået', root, oldVersion, newVersion, native: Boolean(nativeZIP), usesBundledController, installationOnly, checks: [nativeZIP ? 'Squirrel.Mac installerede signeret ZIP' : 'manuel udskiftning af app samme sted', ...(usesBundledController ? ['den tidligere pakkes egen opdateringscontroller'] : []), 'uændrede projektfiler', ...(!installationOnly ? ['forbindelse og krypteret testnøgle bevaret'] : []), 'ingen automatisk modelsendelse', 'designpakke og kladde bevaret', 'ingen Git-skrivninger'], limitation: 'Mac med isolerede brugerdata og kontrolleret manuel genåbning; automatisk genstart er ikke afprøvet. Windows kræver egen prøve.' + (nativeZIP && !usesBundledController ? ' Den gamle app har ingen updater; klienten indlæses kun i testprocessen. Almindelige brugere af den version skal opgradere manuelt.' : '') + (installationOnly ? ' Denne særskilte prøve dækker ikke nøglelagring eller bevarelse af forbindelse.' : '') };
    await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) {
    await page?.screenshot({ path: path.join(root, 'fejl.png'), timeout: 3000 }).catch(() => {});
    console.error('Testmateriale: ' + root); console.error(await app?.evaluate(() => ({ failure: global.nativeFailure, state: global.nativeTest?.snapshot() })).catch(() => null)); throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
