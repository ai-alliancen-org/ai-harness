// Faktiske før-/efterbilleder af samme rendererforløb. Modelkatalog og IPC-hændelser
// er syntetiske; prøven kontakter ingen model og bruger ingen konto eller nøgle.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ContextUsage } = require('../core/context-usage.cjs');
const helpers = require('./ui-test-helpers.cjs');
const desktop = path.resolve(__dirname, '..');
if (!process.env.AURA_CONTEXT_BASELINE) throw Error('Angiv AURA_CONTEXT_BASELINE med en separat, uændret original-checkout.');
const baseline = path.resolve(process.env.AURA_CONTEXT_BASELINE, 'desktop');
const output = path.resolve(process.env.AURA_CONTEXT_OUTPUT || path.join(os.tmpdir(), 'aura-context-usage-results'));
const checks = [], images = [], profiles = [];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['main.cjs', 'core/chat-session.cjs', 'ui/app.js', 'ui/index.html', 'ui/styles.css'];
const totals = { input: 310000, output: 12000, reasoning: 0, cacheRead: 100000, cacheWrite: 0, calls: 12, cost: .2, unpriced: 0 };
const binding = { connectionID: 'lokal-proeve', modelID: 'model-a', routeID: 'rute-a', engineID: 'opencode@1.18.33', sessionID: 'syntetisk-session', model: { limits: { context: 128000 } } };
const check = title => { checks.push(title); console.log('Bestået: ' + title); };
async function sourceIdentity(root) {
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sha256: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, digest(await fs.readFile(path.join(root, file)))]))) };
}
async function probe(version, root) {
  const profile = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-context-display-')));
  profiles.push(profile);
  const project = path.join(profile, 'Designproeve');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><title>Designprøve</title><h1>Min opgaveoversigt</h1>');
  let app;
  const errors = [], changed = version === 'after';
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root, '--user-data-dir=' + path.join(profile, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ session }) => {
      globalThis.contextNetwork = [];
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const external = /^https?:/.test(details.url); if (external) globalThis.contextNetwork.push(details.resourceType);
        callback({ cancel: external });
      });
    });
    await helpers.forbidGitWrites(app); await helpers.skipIntroduction(page); await helpers.openExistingProject(app, page, project);
    const resize = async (width, height) => {
      await app.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('harness://'));
        window.setMinimumSize(600, 500); window.setContentSize(size.width, size.height);
      }, { width, height });
      await page.waitForFunction(width => innerWidth === width, width);
    };
    await resize(1280, 900); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      state.connections = [{ id: 'lokal-proeve', kind: 'openrouter', name: 'Syntetisk forbindelse' }];
      document.querySelector('#connection-select').replaceChildren(new Option('Syntetisk forbindelse', 'lokal-proeve'));
      modelCatalog = [{ id: 'model-a', name: 'Model A', limits: { context: 128000 } }, { id: 'model-b', name: 'Model B', limits: { context: 64000 } }];
      document.querySelector('#model-select').replaceChildren(...modelCatalog.map(model => new Option(model.name, model.id)));
      document.querySelector('#route-row').hidden = false;
      document.querySelector('#route-select').replaceChildren(new Option('Rute A', 'rute-a'), new Option('Rute B', 'rute-b'));
      appendMessage('Byg en lokal oversigt over mine opgaver.', 'user');
      appendMessage('Vi kan bygge en enkel oversigt. Plan og værktøjer godkendes fortsat særskilt.', 'assistant');
      document.querySelector('#project-intro').hidden = true; document.querySelector('#start-idea').hidden = true;
      updateModelSummary();
    });
    const owner = await page.evaluate(() => selectedOwner());
    const emit = async contextUsage => {
      await app.evaluate(({ BrowserWindow }, { owner, usage, contextUsage }) => {
        BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('harness://')).webContents.send('harness:event', { type: 'usage', usage, contextUsage, ...owner });
      }, { owner, usage: totals, contextUsage });
      await page.waitForFunction(() => document.querySelector('#usage-status').textContent.includes('410.000'));
    };
    const screenshot = async name => {
      const chat = await page.locator('.chat').boundingBox();
      const clip = { x: chat.x, y: chat.y + chat.height - 300, width: chat.width, height: 300 };
      const file = `${version}-${name}.png`, bytes = await page.screenshot({ path: path.join(output, file), clip });
      images.push({ file, scenario: name, version, clip, bytes: bytes.length, sha256: digest(bytes), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) });
    };
    const context = new ContextUsage({ now: () => 123 }); context.bind(binding);
    const measured = context.observe({ type: 'step-finish', tokens: { input: 44000, output: 9000, cache: { read: 10000, write: 0 } } });
    await emit(measured);
    const usageText = await page.textContent('#usage-status');
    assert.match(usageText, /410.000 tokens ind.*12.000 ud.*0,20 USD/);
    if (changed) {
      await page.waitForFunction(() => document.querySelector('#context-label').textContent.includes('54.000'));
      assert.equal(await page.textContent('#context-label'), 'Kontekst · 54.000 / 128.000 · 42,2 %');
      assert.equal(await page.locator('#context-meter').isVisible(), true);
      assert.equal(await page.locator('#context-meter').getAttribute('aria-valuetext'), 'Kontekst · 54.000 / 128.000 · 42,2 %');
    } else assert.equal(await page.locator('#context-status').count(), 0);
    await screenshot('measured'); check(`${version}: samme samlede forbrug; kun efter viser sidste målte kontekst separat.`);

    context.observe({ type: 'step-finish', tokens: { input: 44 } });
    await emit(context.snapshot());
    if (changed) { await page.waitForFunction(() => document.querySelector('#context-label').textContent.startsWith('Kontekst ukendt')); assert.equal(await page.locator('#context-meter').isVisible(), false); }
    await screenshot('unknown-input'); check(`${version}: manglende cachetal giver ingen opdigtet procent eller nulmåling.`);
    await emit(measured);
    await page.evaluate(() => { document.querySelector('#route-select').value = 'rute-b'; document.querySelector('#route-select').dispatchEvent(new Event('change')); });
    if (changed) assert.match(await page.textContent('#context-label'), /^Kontekst ukendt/);
    await page.evaluate(() => { document.querySelector('#model-select').value = 'model-b'; updateModelSummary(); });
    if (changed) assert.equal(await page.textContent('#context-label'), 'Kontekst ukendt · vindue 64.000');
    check(`${version}: valg af anden rute eller model genbruger ikke kontekstmålingen.`);

    await page.evaluate(() => {
      document.querySelector('#model-select').value = 'model-a'; document.querySelector('#route-select').value = 'rute-a';
      view.runContextSelection = { connectionID: 'lokal-proeve', modelID: 'model-a', routeID: 'rute-a' };
      setRunning(true, 'Arbejder');
      document.querySelector('#model-select').value = 'model-b'; updateModelSummary();
    });
    if (changed) assert.match(await page.textContent('#context-label'), /54.000 \/ 128.000/);
    await page.evaluate(() => setRunning(false, 'Færdig'));
    if (changed) assert.equal(await page.textContent('#context-label'), 'Kontekst ukendt · vindue 64.000');
    check(`${version}: næste modelvalg overtager ikke målingen for den igangværende opgave.`);

    await page.evaluate(() => { document.querySelector('#model-select').value = 'model-a'; document.querySelector('#route-select').value = 'rute-a'; updateModelSummary(); });
    await emit(measured);
    const hiddenOwner = { ...owner, chat: 'baggrundsproeve' };
    await app.evaluate(({ BrowserWindow }, { owner, usage }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('harness://')).webContents.send('harness:event', { type: 'usage', ...owner, usage }), { owner: hiddenOwner, usage: { ...totals, input: 999999 } });
    assert.equal(await page.textContent('#usage-status'), usageText);
    if (changed) assert.match(await page.textContent('#context-label'), /54.000 \/ 128.000/);
    check(`${version}: baggrundssamtalens hændelser ændrer ikke det åbne skrivefelts forbrug eller kontekst.`);
    await resize(720, 800);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (changed) {
      const box = await page.locator('#context-status').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 721 && box.y + box.height <= 801);
    }
    await screenshot('narrow-720'); check(`${version}: 720 px uden vandret sidescroll eller afskåret kontekstlinje.`);
    await helpers.assertNoGitWrites(app); assert.deepEqual(errors, []);
    const network = await app.evaluate(() => globalThis.contextNetwork); assert.deepEqual(network, []);
    check(`${version}: ingen rendererfejl, HTTP/S-forsøg eller Git-skrivninger.`);
    return { version, source: await sourceIdentity(root), rendererErrors: errors, networkAttempts: network.length };
  } finally { await app?.close(); }
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  assert.equal(execFileSync('git', ['diff', '--name-only'], { cwd: baseline, encoding: 'utf8' }), '', 'Originalens før-kilde skal være uændret.');
  const before = await probe('before', baseline), after = await probe('after', desktop);
  const report = { kind: 'Faktisk Electron-renderer og betjening med kontrollerede IPC-hændelser og syntetisk katalog; ingen AI-inferens.', checks, images, before, after,
    scriptSha256: digest(await fs.readFile(__filename)), platform: process.platform, profiles,
    limits: ['Ingen rigtig AI-model eller udbyderlogin.', 'Ingen Windows-, Linux- eller VoiceOver-prøve.', 'Dataforløbet fra faktiske ChatSession-trin afprøves separat i Node-regressionstests.'] };
  await fs.writeFile(path.join(output, 'native-context-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, checks: checks.length, screenshots: images.length, output }));
})().catch(error => { console.error(error); process.exitCode = 1; });
