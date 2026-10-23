// Samme syntetiske projekt og modelkatalog i original og porteret Electron-renderer.
// Ingen rigtig AI, konto, nøgle, modelkontakt eller Git-skrivning bruges.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const output = path.resolve(process.env.AURA_BRAND_OUTPUT || path.join(os.tmpdir(), 'aura-provider-branding-output'));
const after = path.resolve(__dirname, '..');
const baseline = process.env.AURA_BRAND_BASELINE && path.resolve(process.env.AURA_BRAND_BASELINE, 'desktop');
if (!baseline) throw Error('Angiv AURA_BRAND_BASELINE med en separat, urørt original-checkout.');
const checks = [], images = [], profiles = [];
async function sourceIdentity(desktop) {
  const hashes = {};
  for (const file of ['main.cjs', 'ui/app.js', 'ui/index.html', 'ui/styles.css']) hashes[file] = digest(await fs.readFile(path.join(desktop, file)));
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktop, encoding: 'utf8' }).trim(), hashes };
}
const check = text => { checks.push(text); console.log('Bestået: ' + text); };

async function probe(version, desktop) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-provider-branding-')));
  profiles.push(root);
  const project = path.join(root, 'Designproeve');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><title>Designprøve</title><h1>Min lokale opgaveoversigt</h1>');
  let app;
  const errors = [], outgoing = [];
  const changed = version === 'after';
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [desktop, '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ app, session }) => {
      globalThis.brandProbeNetwork = [];
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const external = /^https?:/.test(details.url);
        if (external) globalThis.brandProbeNetwork.push(details.resourceType);
        callback({ cancel: external });
      });
    });
    await helpers.forbidGitWrites(app); await helpers.skipIntroduction(page);
    await helpers.openExistingProject(app, page, project);
    const resize = async (width, height) => {
      await app.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('harness://'));
        window.setMinimumSize(600, 500); window.setContentSize(size.width, size.height);
      }, { width, height });
      await page.waitForFunction(width => innerWidth === width, width);
    };
    await resize(1280, 900); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      appendMessage('Lav en lokal oversigt over mine opgaver.', 'user');
      appendMessage('Vi kan bygge en enkel oversigt. Planer og ændringer gennemgås fortsat, før noget udføres.', 'assistant');
      document.querySelector('#project-intro').hidden = true; document.querySelector('#start-idea').hidden = true;
    });
    const fixture = kind => page.evaluate(kind => {
      // Kun modelkatalogets visningsdata erstattes. Ingen forbindelse gemmes eller afprøves.
      const catalog = kind === 'mistral'
        ? [{ id: 'mistral-medium-latest', name: 'Mistral Medium' }, { id: 'mistral-large-latest', name: 'Mistral Large' }]
        : kind === 'openrouter'
          ? [{ id: 'anthropic/claude-prøve', name: 'Claude prøve' }, { id: 'mistralai/mistral-prøve', name: 'Mistral prøve' }, { id: 'qwen/qwen-prøve', name: 'Qwen prøve' }]
          : [{ id: 'model-prøve', name: 'Min egen model' }];
      state.connections = [{ id: 'visningsprøve', kind, name: kind === 'openrouter' ? 'Min OpenRouter' : kind === 'mistral' ? 'Min Mistral' : 'Min egen server' }];
      state.definitions[kind] = { provider: kind === 'openrouter' ? 'OpenRouter' : kind === 'mistral' ? 'Mistral' : 'Egen server' };
      document.querySelector('#connection-select').replaceChildren(new Option(state.connections[0].name, 'visningsprøve'));
      modelCatalog = catalog.map(model => ({ ...model, capabilities: { tools: true } }));
      document.querySelector('#model-select').replaceChildren(...modelCatalog.map(model => new Option(model.name, model.id)));
      document.querySelector('#model-select').value = modelCatalog[0].id;
      document.querySelector('#route-row').hidden = kind !== 'openrouter';
      document.querySelector('#route-select').replaceChildren(new Option('Valgt rute · syntetisk', 'valgt-prøverute'));
      document.querySelector('#model-evidence').textContent = '';
      view.running = false; renderShortlist(); updateModelSummary();
      return { model: document.querySelector('#model-select').value, connection: document.querySelector('#connection-select').value, route: document.querySelector('#route-select').value };
    }, kind);
    const snap = async (name, selector) => {
      await page.waitForFunction(() => [...document.querySelectorAll('img.provider-brand-icon')].every(image => image.complete && image.naturalWidth > 0));
      const box = await page.locator(selector).boundingBox(); assert.ok(box);
      // Faste, ens beskæringer i hvert par: medtag samme område omkring den ændrede kontrol.
      const clip = selector === '#task-dialog'
        ? await page.evaluate(() => ({ x: (innerWidth - 600) / 2, y: (innerHeight - 780) / 2, width: 600, height: 780 }))
        : { x: box.x, y: box.y + box.height - 180, width: box.width, height: 180 };
      const file = `${version}-${name}.png`, buffer = await page.screenshot({ path: path.join(output, file), clip });
      images.push({ file, version, scenario: name, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), cssWidth: clip.width, cssHeight: clip.height, clip, bytes: buffer.length, sha256: digest(buffer), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), source: 'Faktisk Electron-renderer med syntetisk modelkatalog; ingen AI-kørsel.' });
    };
    const assertChip = async (text, asset) => {
      assert.equal(await page.textContent('#model-chip'), text);
      assert.equal(await page.locator('#model-chip img').count(), changed && asset ? 1 : 0);
      if (changed && asset) assert.equal(await page.locator('#model-chip img').getAttribute('src'), asset);
    };
    await fixture('mistral');
    await assertChip('Mistral Medium · Mistral · standardindsats', 'provider-mistral.svg');
    await snap('composer-mistral', '#chat-form');
    await page.locator('#model-chip').focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('#task-dialog[open]');
    assert.equal(await page.locator('#model-shortlist .model-choice').count(), 2);
    assert.equal(await page.locator('#model-shortlist .model-choice img').count(), changed ? 2 : 0);
    await snap('model-dialog', '#task-dialog');
    await page.locator('#model-shortlist .model-choice').nth(1).click();
    await page.waitForSelector('#task-dialog:not([open])', { state: 'attached' });
    await assertChip('Mistral Large · Mistral · standardindsats', 'provider-mistral.svg');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt');
    check(`${version}: tastatur åbner samme modeldialog, og almindeligt modelklik vælger Large og returnerer til skrivefeltet.`);

    const selected = await fixture('openrouter');
    await assertChip('Claude prøve · OpenRouter', 'provider-anthropic.svg');
    assert.equal(await page.textContent('#connection-status'), 'Min OpenRouter · anthropic/claude-prøve');
    await snap('composer-openrouter', '#chat-form');
    await page.click('#model-chip');
    assert.equal(await page.locator('#route-row').isVisible(), true);
    assert.equal(await page.inputValue('#route-select'), selected.route);
    assert.equal(await page.inputValue('#connection-select'), selected.connection);
    if (changed) {
      const sources = await page.locator('#model-shortlist .model-choice img').evaluateAll(images => images.map(image => image.getAttribute('src')));
      assert.deepEqual(sources, ['provider-anthropic.svg', 'provider-mistral.svg', 'provider-openrouter.svg']);
    }
    await snap('openrouter-dialog', '#task-dialog');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#task-dialog').evaluate(dialog => dialog.open), false);
    check(`${version}: OpenRouter beholder forbindelsen, den konkrete rute og model-id; Escape lukker den oprindelige dialog.`);

    await fixture('ukendt-provider');
    await assertChip('Min egen model · Egen server', null);
    check(`${version}: ukendt udbyder beholder en læsbar tekst uden gættet logo eller ekstern billedadresse.`);
    await fixture('mistral');
    if (changed) {
      await page.evaluate(() => {
        view.running = true; view.activeModelSummary = 'Mistral Medium · Mistral · standardindsats';
        view.activeModelBrand = { kind: 'mistral', modelID: 'mistral-medium-latest' };
        document.querySelector('#model-select').value = 'mistral-large-latest'; updateModelSummary();
      });
      await assertChip('Mistral Medium · Mistral · standardindsats', 'provider-mistral.svg');
      check('after: igangværende models navn og mærke beholdes ved et valg til næste opgave.');
      await fixture('mistral');
      await page.evaluate(() => {
        document.querySelector('#model-select').selectedOptions[0].textContent = '<img src=x onerror=alert(1)>';
        updateModelSummary();
      });
      assert.equal(await page.locator('#model-chip img').count(), 1);
      assert.ok((await page.textContent('#model-chip')).includes('<img src=x onerror=alert(1)>'));
      await fixture('mistral');
      check('after: et katalog med HTML-lignende modelnavn forbliver tekst, uden ekstra DOM eller eksternt billede.');
    }
    await resize(720, 800);
    const bounds = await page.locator('#chat-form').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 721);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 721);
    await snap('narrow-720', '#chat-form');
    check(`${version}: 720 px og reduceret bevægelse bevarer synligt skrivefelt og modelnavn uden vandret sidescroll.`);
    if (changed) {
      await page.emulateMedia({ forcedColors: 'active' });
      assert.equal(await page.textContent('#model-chip'), 'Mistral Medium · Mistral · standardindsats');
      await page.locator('#model-chip').focus();
      assert.notEqual(await page.locator('#model-chip').evaluate(button => getComputedStyle(button).outlineStyle), 'none');
      check('after: systemets kontrastfarver bevarer tekst og synligt tastaturfokus; logo er fortsat kun dekoration.');
    }
    await helpers.assertNoGitWrites(app); assert.deepEqual(errors, []);
    outgoing.push(...await app.evaluate(() => globalThis.brandProbeNetwork));
    assert.equal(outgoing.length, 0, 'Ingen HTTP/S-kald må forsøges efter profilens start.');
    check(`${version}: ingen rendererfejl, eksterne netværksforsøg eller Git-skrivninger under prøven.`);
    return { electron: await app.evaluate(() => process.versions.electron), errors, networkRequests: outgoing.length };
  } finally { await app?.close(); }
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const originalSource = await sourceIdentity(baseline);
  const beforeResult = await probe('before', baseline);
  const afterResult = await probe('after', after);
  const sourceHashes = {};
  for (const file of ['main.cjs', 'ui/app.js', 'ui/index.html', 'ui/styles.css', 'ui/provider-brand.js']) sourceHashes[file] = digest(await fs.readFile(path.join(after, file)));
  await fs.writeFile(path.join(output, 'provider-branding-report.json'), JSON.stringify({ kind: 'Electron med kontrolleret modelkatalog; ingen rigtig AI eller konto', platform: process.platform, originalSource, beforeResult, afterResult, checks, images, sourceHashes, limits: ['Windows er ikke afprøvet.', 'Ingen rigtig modelsession, kontoadgang eller datamodtagelse er afprøvet.', 'Skærmlæser er ikke afprøvet; dekorative alt/aria-egenskaber og tastatur er kontrolleret.'] }, null, 2) + '\n');
  // De to profiler er oprettet af denne prøve og indeholder kun de ovenstående syntetiske data.
  // Slet dem først efter alle appprocesser er lukket. Bevismaterialet gemmes i outputmappen.
  for (const profile of profiles) await fs.rm(profile, { recursive: true });
  console.log(JSON.stringify({ ok: true, checks: checks.length, images: images.length, output, syntheticProfilesRemoved: profiles.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
