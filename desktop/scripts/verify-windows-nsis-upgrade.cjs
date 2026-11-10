// Kun på rigtig Windows i separat, tom testkonto eller Windows Sandbox.
// Fra desktop: node scripts/verify-windows-nsis-upgrade.cjs OLD.exe NEW.exe
// --isolated-windows-account --old-version=0.7.0-beta.2 --new-version=0.7.0-beta.3
// --old-sha256=GENNEMGAAET_HASH --new-sha256=GENNEMGAAET_HASH --method=installer
// Den tidligere version skal være 0.7.0-beta.1 eller nyere: nøglen indtastes i nøglevinduet, som verify-upgrade.cjs gør.
// Gentag fra en tom testkonto med --method=updater for den gamle apps native updater.
// Begge metoder bruger rigtig NSIS, men stille installation og kontrolleret genåbning.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const run = require('node:util').promisify(require('node:child_process').execFile);
const safety = require('./windows-upgrade-safety.cjs');
const helpers = require('./ui-test-helpers.cjs');
async function hashFile(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest(encoding);
}
function readPackageVersion(archive) {
  const asar = require('@electron/asar');
  // NSIS erstatter samme sti. ASAR-bibliotekets cache må ikke skjule den nye version.
  asar.uncache(archive);
  return JSON.parse(asar.extractFile(archive, 'package.json')).version;
}
async function inspectWindows() {
  const script = Buffer.from(safety.preflightScript(), 'utf16le').toString('base64');
  const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await run(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', script], { windowsHide: true, timeout: 30000 });
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
}
async function waitFor(check, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 300)); }
  throw Error('Prøven nåede ikke næste trin: ' + label);
}
async function verify(argv) {
  // Ingen mappe, installation eller appstart før platform, kontotype og checksums er godkendt.
  const input = safety.options(argv), before = await inspectWindows(); safety.freshAccount(before);
  const oldInstaller = await fs.realpath(input.oldInstaller), newInstaller = await fs.realpath(input.newInstaller);
  assert.equal(await hashFile(oldInstaller), input.oldHash, 'Den gamle installationsfil matcher ikke den gennemgåede hash.');
  assert.equal(await hashFile(newInstaller), input.newHash, 'Den nye installationsfil matcher ikke den gennemgåede hash.');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'Aura Windows upgrade ')));
  const installed = path.join(root, 'Programmer', 'Aura'), executablePath = path.join(installed, 'Aura.exe'), data = path.join(root, 'appdata');
  const project = path.join(root, 'Bevaret projekt'), original = '<!doctype html><html lang="da"><meta charset="utf-8"><title>Opgraderingsprøve</title><h1>Bevaret indhold</h1></html>';
  const report = { status: 'startet', root, method: input.method, oldVersion: input.oldVersion, newVersion: input.newVersion, installers: { old: { path: oldInstaller, sha256: input.oldHash }, candidate: { path: newInstaller, sha256: input.newHash } }, windows: before, steps: [] };
  const record = async name => { report.steps.push(name); await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2)); console.log(name); };
  await fs.writeFile(path.join(root, 'kun-syntetiske-testdata.json'), JSON.stringify({ purpose: 'Aura Windows-opgraderingsprøve', at: new Date().toISOString() }));
  console.log('Testmateriale: ' + root);
  const { _electron: electron } = require('playwright');
  let app, page, downloads = 0, modelRequests = 0, requestsBeforeUpdate = 0, unexpectedRequests = 0, info;
  const key = 'SYNTHETISK_TESTNOEGLE_KUN_LOKALT';
  const server = http.createServer((req, res) => {
    if (req.url === '/feed' && info) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(info)); }
    if (req.url === '/installer' && info) { downloads++; res.setHeader('content-length', info.files[0].size); return createReadStream(newInstaller).pipe(res); }
    if (req.method === 'GET' && req.url === '/v1/models' && req.headers.authorization === 'Bearer ' + key) { modelRequests++; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'opgraderingsproeve' }] })); }
    unexpectedRequests++; res.writeHead(400); res.end('Prøven tillader kun modelkataloget og den lokale opdateringsfil.');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverURL = `http://127.0.0.1:${server.address().port}`;
  const installedVersion = () => { try { return readPackageVersion(path.join(installed, 'resources/app.asar')); } catch { return null; } };
  async function launch() {
    app = await electron.launch({ executablePath, args: ['--user-data-dir=' + data], env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32'), ELECTRON_RUN_AS_NODE: undefined } });
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), data);
    await app.evaluate(({ session }) => session.fromPartition('electron-updater').webRequest.onBeforeRequest((_request, callback) => callback({ cancel: true })));
    await helpers.forbidGitWrites(app); await helpers.isolateDocuments(app, path.join(root, 'Dokumenter'));
    page = await app.firstWindow(); await helpers.skipIntroduction(page);
  }
  async function install(file, hash) {
    assert.equal(await hashFile(file), hash, 'Installationsfilen blev ændret under prøven.');
    const result = await run(file, safety.installerArgs(installed), { windowsVerbatimArguments: true, timeout: 300000 });
    assert.equal(result.stderr.trim(), ''); safety.ownedInstall(await inspectWindows(), installed);
  }
  try {
    safety.freshAccount(await inspectWindows());
    await install(oldInstaller, input.oldHash); assert.equal(installedVersion(), input.oldVersion);
    await launch(); assert.equal(await app.evaluate(({ app }) => app.getVersion()), input.oldVersion);
    const installedArch = await app.evaluate(() => process.arch); report.installedArch = installedArch;
    await record('Tidligere NSIS-version installeret og startet fra prøvens egen mappe');
    await fs.mkdir(path.join(project, 'public'), { recursive: true }); await fs.writeFile(path.join(project, 'public/index.html'), original);
    await helpers.openExistingProject(app, page, project);
    await page.frameLocator('#preview').getByRole('heading', { name: 'Bevaret indhold' }).waitFor();
    // Siden 0.7 kan en nøgle kun indtastes i det isolerede nøglevindue, så forbindelsen gemmes den vej (og kun den vej).
    // Nøglevinduet kontrollerer nøglen ved at hente kataloget, så kald tælles i forhold til tallet før opdateringen.
    const connection = await helpers.addConnection(page, { name: 'Bevaret forbindelse', baseURL: serverURL + '/v1', apiKey: key, app });
    assert.equal(JSON.stringify(connection).includes(key), false);
    const connectionId = connection.id, before = modelRequests;
    assert.equal((await page.evaluate(id => window.harness.models(id), connectionId)).ok, true); assert.ok(modelRequests > before, 'modellisten hentes med den gemte nøgle'); requestsBeforeUpdate = modelRequests;
    assert.equal((await page.evaluate(() => window.harness.saveDesign({ name: 'Bevaret design', color: '#0052cc', links: [] }))).ok, true);
    await page.fill('#prompt', 'Bevar kladden gennem Windows-opdateringen'); await page.evaluate(() => saveChatDraft(true));
    await helpers.assertNoGitWrites(app); await assert.rejects(fs.access(path.join(project, '.git')), { code: 'ENOENT' });
    await page.screenshot({ path: path.join(root, 'foer.png'), animations: 'disabled' });
    await record('Syntetisk projekt, krypteret testnøgle, design og kladde gemt uden Git-skrivninger');
    safety.ownedInstall(await inspectWindows(), installed);
    if (input.method === 'installer') {
      await app.close(); app = null; await install(newInstaller, input.newHash);
    } else {
      info = { version: input.newVersion, files: [{ url: `https://github.com/ai-alliancen-org/ai-harness/releases/download/v${input.newVersion}/Aura-${input.newVersion}-win-${installedArch}.exe`, sha512: await hashFile(newInstaller, 'sha512', 'base64'), size: (await fs.stat(newInstaller)).size }] };
      await app.evaluate(({ app }) => {
        const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
        const { Updates } = require('./core/updates.cjs'), original = Updates.prototype.snapshot;
        Updates.prototype.snapshot = function () { global.upgradeTest = this; Updates.prototype.snapshot = original; return original.call(this); };
      });
      assert.equal((await page.evaluate(() => window.harness.updatesState())).ok, true);
      await app.evaluate(async ({ app, session }, { root, serverURL }) => {
        const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
        const { NsisUpdater } = require('electron-updater'), { DownloadedUpdateHelper } = require('electron-updater/out/DownloadedUpdateHelper');
        const updater = new NsisUpdater();
        // Bevar pakkens signaturkrav. Kun transport og downloadcache flyttes til prøven.
        updater.updateConfigPath = process.resourcesPath + '/app-update.yml';
        updater.downloadedUpdateHelper = new DownloadedUpdateHelper(root + '/download-cache');
        session.fromPartition('electron-updater').webRequest.onBeforeRequest((request, callback) => {
          if (request.url.startsWith('https://ai-alliancen-org.github.io/ai-harness/updates/')) return callback({ redirectURL: serverURL + '/feed' });
          if (request.url.startsWith('https://github.com/ai-alliancen-org/ai-harness/releases/download/')) return callback({ redirectURL: serverURL + '/installer' });
          callback({ cancel: !request.url.startsWith(serverURL + '/') });
        });
        global.upgradeTest.close(); global.upgradeTest.connect(updater); global.upgradeTest.set({ phase: 'idle' });
        // Stille NSIS og ingen automatisk appstart: genåbning skal bevare --user-data-dir.
        global.upgradeTest.install = () => updater.quitAndInstall(true, false);
      }, { root, serverURL });
      await page.click('#settings-toggle'); await page.click('#updates-button'); await page.click('#updates-action');
      await page.locator('#updates-action').filter({ hasText: 'Hent opdatering' }).waitFor(); assert.equal(downloads, 0);
      await page.click('#updates-action'); await page.locator('#updates-action').filter({ hasText: 'Genstart og opdatér' }).waitFor({ timeout: 180000 });
      const downloaded = await app.evaluate(() => global.upgradeTest.updater.downloadedUpdateHelper.file);
      assert.equal(await hashFile(downloaded), input.newHash); assert.equal(downloads, 1);
      await app.evaluate(() => { global.originalBusy = global.upgradeTest.busy; global.upgradeTest.busy = () => true; });
      await page.click('#updates-action'); await page.locator('#updates-error').filter({ hasText: 'igangværende' }).waitFor();
      assert.equal(installedVersion(), input.oldVersion);
      await app.evaluate(() => { global.upgradeTest.busy = global.originalBusy; });
      await record('Den gamle apps opdateringsklient hentede rigtig NSIS-fil og ventede på igangværende arbejde');
      const closed = app.waitForEvent('close', { timeout: 180000 }); await page.click('#updates-action'); await closed; app = null;
      await waitFor(async () => installedVersion() === input.newVersion && (await inspectWindows()).registry.some(entry => entry.version === input.newVersion), 'NSIS-opdateringen skal installere og registrere den nye version');
      safety.ownedInstall(await inspectWindows(), installed);
    }
    assert.equal(installedVersion(), input.newVersion);
    await launch(); assert.equal(await app.evaluate(({ app }) => app.getVersion()), input.newVersion);
    assert.equal(modelRequests, requestsBeforeUpdate, 'Opgradering må ikke selv sende en modelanmodning.');
    const state = await page.evaluate(() => window.harness.connectionState());
    assert.equal(state.ok, true); assert.ok(state.value.connections.some(c => c.id === connectionId)); assert.equal(JSON.stringify(state).includes(key), false);
    assert.equal((await page.evaluate(id => window.harness.models(id), connectionId)).ok, true); assert.equal(modelRequests, requestsBeforeUpdate + 1);
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), original);
    await page.frameLocator('#preview').getByRole('heading', { name: 'Bevaret indhold' }).waitFor();
    assert.equal(await page.inputValue('#prompt'), 'Bevar kladden gennem Windows-opdateringen');
    assert.ok((await page.evaluate(() => window.harness.listDesigns())).value.some(d => d.name === 'Bevaret design'));
    await helpers.assertNoGitWrites(app); assert.equal(unexpectedRequests, 0); await assert.rejects(fs.access(path.join(project, '.git')), { code: 'ENOENT' });
    await page.screenshot({ path: path.join(root, 'efter.png'), animations: 'disabled' });
    await record('Ny installeret app bevarede projekt, fungerende krypteret nøgle, design og kladde');
    await app.close(); app = null; safety.ownedInstall(await inspectWindows(), installed);
    await run(path.join(installed, 'Uninstall Aura.exe'), ['/S', '/currentuser'], { timeout: 180000 });
    await waitFor(async () => !(await inspectWindows()).registry.length, 'prøvens egen installation skal afregistreres');
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), original); await fs.access(path.join(data, 'harness'));
    await record('Prøvens egen installation afinstalleret; syntetiske projektfiler og appdata bevaret');
    report.status = 'bestået'; report.downloads = downloads; report.modelRequests = modelRequests;
    report.limitation = 'Rigtig Windows og NSIS i tom testkonto, stille installation og kontrolleret genåbning med isolerede appdata. Interaktiv installationsguide, SmartScreen, fælles installation og automatisk genåbning er ikke dækket. Ingen rigtig model eller udgivelse.';
    await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); return report;
  } catch (error) {
    report.status = 'fejlet'; report.error = error.message; await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2));
    await page?.screenshot({ path: path.join(root, 'fejl.png'), timeout: 3000 }).catch(() => {});
    console.error('Prøven bevarer testkonto og materiale til fejlsøgning: ' + root); throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
if (require.main === module) verify(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify, hashFile, readPackageVersion };
