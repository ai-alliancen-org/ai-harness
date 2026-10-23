// F20 gennem den rigtige Electron-brugerflade. Kun syntetiske filer og et lokalt modelkatalog;
// ingen inferens, adgangsnøgler, publicering eller ændringer i brugerens profil.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const output = process.env.AURA_F20_OUTPUT ? path.resolve(process.env.AURA_F20_OUTPUT) : await fs.mkdtemp(path.join(os.tmpdir(), 'aura-f20-native-'));
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, 'profile-'));
  const userdata = path.join(root, 'appdata'), project = path.join(root, 'projekt');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  const original = '<!doctype html><html lang="da"><head><title>F20-prøve</title></head><body><h1>Bevar denne fil</h1></body></html>';
  await fs.writeFile(path.join(project, 'public', 'index.html'), original);
  const requests = [], errors = [], checks = [], screenshots = [], measurements = [], assets = [];
  const models = [{ id: 'f20-compact', name: 'F20 lille' }, { id: 'f20-balanced', name: 'F20 mellem' }, { id: 'f20-large', name: 'F20 stor' }];
  let available = true, hold = false, app, page;
  const pending = new Set();
  const catalog = res => {
    res.setHeader('content-type', 'application/json');
    if (!available) { res.writeHead(503); res.end(JSON.stringify({ error: 'Syntetisk katalogfejl' })); }
    else res.end(JSON.stringify({ data: models }));
  };
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.method !== 'GET' || req.url !== '/v1/models') { res.writeHead(405); res.end(); return; }
    if (hold) { pending.add(res); res.on('close', () => pending.delete(res)); } else catalog(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const passed = name => checks.push(name);
  const checked = () => page.locator('#setup-visual[data-verified="true"], #setup-visual [data-verified="true"]');
  async function shot(name) {
    const file = path.join(output, `${name}.png`);
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('harness://'));
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    });
    await fs.writeFile(file, Buffer.from(png, 'base64')); screenshots.push({ name, file });
  }
  async function launch() {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + userdata], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    await helpers.isolateDocuments(app, path.join(root, 'Dokumenter'));
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    assert.equal(await page.evaluate(() => typeof window.OnboardingB?.render), 'function', 'præsentationsmodulet skal serveres gennem appens eksisterende assetgrænse');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('link[href="onboarding-b.css"]')?.sheet)), true, 'F20-stilarket skal være indlæst gennem appens assetgrænse');
    const result = await page.evaluate(async () => Promise.all(['onboarding-b.js', 'onboarding-b.css', 'onboarding-aura-mark.svg', 'onboarding-provider-claude.svg', 'onboarding-provider-mistral.svg', 'f20-unknown.svg'].map(async name => { const response = await fetch(`harness://app/${name}`); return { name, status: response.status, mime: response.headers.get('content-type') }; })));
    for (const item of result) {
      if (item.name === 'f20-unknown.svg') assert.equal(item.status, 404, 'ukendte assets skal fortsat afvises');
      else { assert.equal(item.status, 200, item.name); assert.match(item.mime, item.name.endsWith('.svg') ? /^image\/svg\+xml/ : item.name.endsWith('.js') ? /^text\/javascript/ : /^text\/css/); }
    }
    assets.push(...result);
  }
  async function closeReturnedConnections() {
    if (await page.locator('#connections-dialog').evaluate(element => element.open)) await page.click('[data-close="connections-dialog"]');
  }
  async function providerPreview(kind, method) {
    const card = page.locator(`#provider-cards [data-kind="${kind}"]`);
    await card[method]();
    await page.waitForFunction(value => document.querySelector('#setup-visual').dataset.kind === value, kind);
    assert.equal(requests.length, 0, 'visuelt valg må ikke hente katalog eller sende en opgave');
    assert.equal(await page.isVisible('#api-key'), false, 'hover/fokus må ikke åbne formularen');
    const expected = await page.evaluate(value => window.OnboardingB.provider(value).accent, kind);
    const accent = await page.locator('#setup-visual').evaluate(element => getComputedStyle(element).getPropertyValue('--ob-brand').trim());
    assert.equal(accent.toLowerCase(), expected.toLowerCase());
    await shot(`udbyder-${kind}-${method}`);
  }
  async function assertModelMarks() {
    const marks = await page.locator('#model-shortlist .model-choice').evaluateAll(cards => cards.map(card => {
      const mark = card.querySelector('.onboarding-b-choice-mark svg'), style = mark && getComputedStyle(mark);
      return { selected: card.getAttribute('aria-pressed') === 'true', shown: Boolean(style && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0) };
    }));
    assert.ok(marks.length > 0); for (const mark of marks) assert.equal(mark.shown, mark.selected, 'fluebenet skal følge det faktisk valgte modelkort');
  }
  try {
    await launch();
    await page.fill('#purpose', 'En lokal, syntetisk aktivitetsoversigt.'); await page.fill('#name', 'Bevar min F20-kladde');
    await helpers.openSetup(page); await page.click('#setup-add-provider');
    assert.equal(await page.locator('#provider-cards [data-kind]').count(), 10);
    assert.equal(await page.locator('#provider-cards [data-kind="alexandra"]').count(), 1);
    assert.equal(await page.locator('#provider-cards [data-kind="komplai"]').count(), 0);
    await page.waitForFunction(() => [...document.querySelectorAll('#provider-cards img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await checked().count(), 0);
    await shot('udbydere');
    await providerPreview('mistral', 'hover'); await providerPreview('anthropic', 'focus');
    passed('Ti oprindelige udbydere og brandfarver ved hover/fokus uden netværkskald');

    await page.click('#provider-cards [data-kind="mistral"]');
    assert.equal(await page.inputValue('#provider-kind'), 'mistral');
    assert.equal(await page.inputValue('#base-url'), 'https://api.mistral.ai/v1');
    assert.equal(await page.locator('#base-url').evaluate(element => element.readOnly), true);
    assert.equal(await page.isVisible('#api-key'), true); assert.equal(requests.length, 0);
    await shot('forbindelse-mistral');
    await page.fill('#api-key', 'syntetisk-ikke-gemt'); await page.click('#setup-back');
    assert.equal(await page.inputValue('#api-key'), '');
    passed('Oprindelig udbyderformular og endpoint bevares; Tilbage rydder kun den ikke-gemte nøgle');

    for (const [width, height, zoom] of [[1440, 940, 1], [980, 720, 1], [980, 720, 1.5], [750, 850, 1], [390, 844, 1]]) {
      await app.evaluate(({ BrowserWindow }, value) => {
        const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('harness://'));
        // 750/390 er isolerede CSS-stressprøver. Produktets minimumsstørrelse ændres ikke.
        window.setMinimumSize(320, 480); window.setSize(value.width, value.height); window.webContents.setZoomFactor(value.zoom);
      }, { width, height, zoom });
      await page.waitForTimeout(250);
      const measurement = await page.locator('#setup').evaluate(element => ({ width: innerWidth, height: innerHeight, scroll: element.scrollWidth, client: element.clientWidth, body: document.scrollingElement.scrollWidth, visual: element.querySelector('.onboarding-b-visual').getBoundingClientRect().width }));
      measurements.push({ requestedWidth: width, requestedHeight: height, zoom, stressOnly: width < 980, ...measurement });
      assert.ok(measurement.scroll <= measurement.client + 1, 'opsætningen må ikke klippe vandret');
      assert.ok(measurement.body <= measurement.width + 1, 'ingen vandret siderulning');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(`udbydere-${width}-${zoom}-top`);
      await page.locator('#setup-local').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#setup-local').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight + 1; }), 'Vælg senere kan nås');
      await shot(`udbydere-${width}-${zoom}`);
    }
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('harness://')); window.setMinimumSize(980, 720); window.setSize(1440, 940); window.webContents.setZoomFactor(1); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await page.locator('#setup-visual').evaluate(element => [...element.querySelectorAll('*')].map(item => ({ duration: getComputedStyle(item).animationDuration, iteration: getComputedStyle(item).animationIterationCount })).filter(item => item.duration.split(',').some(value => parseFloat(value) > 0)));
    assert.equal(motion.length, 0, 'visualiseringen står stille ved reduceret bevægelse');
    passed('Responsivt layout ved 1440/980, zoom 150 %, smalle CSS-stressprøver og reduceret bevægelse');

    await page.click('#setup-local'); await page.waitForSelector('#setup', { state: 'hidden' }); await closeReturnedConnections();
    assert.equal(await page.inputValue('#name'), 'Bevar min F20-kladde');
    assert.equal(await page.inputValue('#purpose'), 'En lokal, syntetisk aktivitetsoversigt.');
    await shot('projektide');
    passed('Vælg senere og gentagen opsætning bevarer idékladden');

    await helpers.openSetup(page); await page.click('#setup-add-provider'); await page.click('#provider-cards [data-kind="compatible"]');
    if (!await page.locator('#connection-advanced').evaluate(element => element.open)) await page.click('#connection-advanced > summary');
    await page.fill('#connection-name', 'Lokal F20-prøve'); await page.fill('#base-url', endpoint);
    hold = true; await page.click('#save-connection');
    await page.waitForFunction(() => document.querySelector('#setup').dataset.step === 'saved');
    const deadline = Date.now() + 20000;
    while (!pending.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(pending.size > 0, 'Gem skal starte den oprindelige, eksplicitte katalogkontrol');
    assert.equal(await checked().count(), 0, 'gemt eller igangværende er ikke det samme som kontrolleret');
    await shot('katalog-afventer'); hold = false; for (const response of [...pending]) catalog(response);
    await page.waitForFunction(() => !document.querySelector('#setup-continue').disabled);
    assert.ok(await checked().count() > 0, 'grønt mærke kræver det faktiske katalogsvar');
    await shot('katalog-kontrolleret');
    const connectionID = await page.inputValue('#setup-connection');
    await page.selectOption('#setup-connection', ''); await page.selectOption('#setup-connection', connectionID);
    assert.equal(await checked().count(), 0, 'et nyt forbindelsesvalg kræver sin egen kontrol');
    available = false; await page.click('#setup-test'); await page.locator('#setup-ai').filter({ hasText: 'mislykkedes' }).waitFor();
    assert.equal(await checked().count(), 0, 'en nyere fejl fjerner den tidligere grønne status');
    assert.equal(await page.isDisabled('#setup-continue'), true); await shot('katalog-fejl');
    available = true; await page.click('#setup-test'); await page.waitForFunction(() => !document.querySelector('#setup-continue').disabled);
    await page.click('#setup-continue'); await page.waitForSelector('#setup', { state: 'hidden' });
    await closeReturnedConnections();
    const saved = JSON.parse(await fs.readFile(path.join(userdata, 'harness', 'settings.json'), 'utf8'));
    assert.equal(saved.connections.length, 1); assert.equal(saved.connections[0].kind, 'compatible'); assert.equal(saved.connections[0].baseURL, endpoint); assert.equal(saved.connections[0].secret, undefined);
    passed('Gem og katalogkontrol gennem brugerfladen; afventende og fejlet kontrol giver aldrig falsk grøn');

    await helpers.openExistingProject(app, page, project);
    await page.waitForFunction(() => [...document.querySelector('#model-select').options].some(option => option.value === 'f20-large'));
    await helpers.taskOptions(page);
    await page.locator('#model-shortlist .model-choice').first().waitFor(); await assertModelMarks(); await shot('modelvalg');
    const model = await page.locator('#model-shortlist .model-choice').first().getAttribute('data-model');
    await page.locator('#model-shortlist .model-choice').first().click();
    await page.waitForFunction(() => !document.querySelector('#task-dialog').open);
    assert.equal(await page.inputValue('#model-select'), model);
    await helpers.taskOptions(page); assert.equal(await page.locator(`#model-shortlist [data-model="${model}"]`).getAttribute('aria-pressed'), 'true'); await assertModelMarks();
    await shot('model-valgt'); await helpers.closeTaskOptions(page);
    assert.equal(await fs.readFile(path.join(project, 'public', 'index.html'), 'utf8'), original);
    assert.equal(await page.locator('#data-dialog').evaluate(element => element.open), false);
    assert.ok(requests.every(request => request.method === 'GET' && request.url === '/v1/models'), 'opsætning og modelvalg sender ingen inferens');
    passed('Faktisk modelvalg i den eksisterende Din AI-dialog uden inferens eller projektændringer');

    await app.close(); app = null; await launch(); await helpers.openSetup(page); await page.click('#setup-use-saved');
    assert.equal(await checked().count(), 0); assert.equal(await page.isDisabled('#setup-continue'), true);
    await shot('gemt-ikke-kontrolleret-efter-genstart');
    assert.deepEqual(errors, []); passed('Genstart bevarer forbindelsen men genbruger ikke en gammel grøn katalogkontrol');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'bestået', root, checks, screenshots, measurements, assets, requests, errors, inference: 'Ikke udført; alle observerede katalogkald var GET /v1/models.', remaining: ['Modelsamtykke, planer og værktøjsgodkendelser prøves særskilt med verify-planning.cjs og verify-approvals.cjs.'] }, null, 2));
    console.log(JSON.stringify({ status: 'bestået', output, checks: checks.length, screenshots: screenshots.length, catalogRequests: requests.length }));
  } catch (error) {
    if (app) await shot('fejl').catch(() => {});
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'fejlet', root, error: error.message, checks, screenshots, measurements, assets, requests, errors }, null, 2));
    throw error;
  } finally {
    hold = false; for (const response of [...pending]) catalog(response);
    await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
