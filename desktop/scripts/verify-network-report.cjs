// Native Aura with controlled loopback HTTP, not a real model/provider or user profile.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-network-report-'));
  const output = process.env.HARNESS_TEST_OUTPUT ? path.resolve(process.env.HARNESS_TEST_OUTPUT) : root;
  await fs.mkdir(output, { recursive: true });
  const project = path.join(root, 'Rapportprøve'); await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Isoleret rapportprøve</h1>');
  let calls = 0, release;
  const server = http.createServer(async (req, res) => {
    calls++; for await (const _ of req) {}
    if (req.url === '/models') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[{"id":"test-model"}]}');
    release = () => res.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: {"choices":[{"delta":{"content":"synthetic-private-answer"}}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app; const errors = [];
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'profile')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    await page.click('#tab-activity');
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'activity-entry.png') });
    await app.evaluate(async ({ app }, url) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/main.cjs');
      const { listModels } = require('./core/connections.cjs');
      const { startGateway } = require('./core/gateway.cjs');
      await listModels({ kind: 'compatible', baseURL: url }, 'synthetic-private-key');
      global.networkFixture = await startGateway({ kind: 'compatible', baseURL: url }, { id: 'test-model' }, 'synthetic-private-key', null);
      global.networkFixtureResult = fetch(global.networkFixture.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${global.networkFixture.token}` }, body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'synthetic-private-prompt' }] }) }).then(response => response.text());
    }, `http://127.0.0.1:${server.address().port}`);
    await page.click('#network-report-open'); await page.locator('#network-report-summary').filter({ hasText: '2 registrerede kald' }).waitFor();
    // R#38: første lag er én sætning, én linje om lagring, Gem rapport og Luk. Filtre, format og tabel er foldet sammen.
    assert.equal(await page.locator('#network-report-details').evaluate(element => element.open), false);
    assert.equal(await page.isVisible('#network-period'), false);
    const firstLayer = await page.locator('#network-report-dialog').evaluate(dialog => [...dialog.querySelectorAll('button, select, summary')].filter(element => element.checkVisibility()).map(element => element.textContent.trim()));
    assert.deepEqual(firstLayer, ['Luk', 'Se detaljer', 'Gem rapport']);
    assert.match(await page.textContent('#network-report-dialog'), /højst 30 dage/);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'report-first-layer.png') });
    await page.click('#network-report-details > summary');
    assert.match(await page.textContent('#network-report-rows'), /Venter på svar/);
    assert.match(await page.textContent('#network-report-rows'), /i gang/);
    assert.deepEqual(await page.locator('#network-category option').evaluateAll(options => options.map(option => option.value)), ['', 'model', 'catalog'], 'kun typer, Aura registrerer');
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'report-waiting.png') });
    assert.ok(release); release();
    await app.evaluate(async () => { await global.networkFixtureResult; await global.networkFixture.close(); });
    await page.click('#network-report-refresh'); await page.locator('#network-report-rows').filter({ hasText: 'Gennemført' }).waitFor();
    await page.selectOption('#network-category', 'model'); assert.equal(await page.locator('#network-report-rows tr').count(), 1);
    assert.match(await page.textContent('#network-report-summary'), /AI-model: 1 registreret kald/);
    for (const format of ['json', 'csv']) {
      const target = path.join(output, 'report.' + format);
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
      await page.selectOption('#network-format', format);
      await page.click('#network-report-save'); await page.locator('#network-report-feedback').filter({ hasText: 'gemt på denne computer' }).waitFor();
      const saved = await fs.readFile(target, 'utf8'); assert.doesNotMatch(saved, /synthetic-private|test-model|chat\/completions/); assert.match(saved, /aura-only/);
      if (format === 'json') { const report = JSON.parse(saved); assert.equal(report.records.length, 1); assert.equal(report.records[0].status, 'completed'); assert.equal(report.coverage.find(row => row.category === 'integration').status, 'unknown'); assert.equal(report.totalRecords, 2); }
      else {
        // R#36: semikolon til dansk Excel, og hver linje siger, hvilket udsnit filen dækker.
        const lines = saved.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
        assert.equal(lines.length, 2, 'overskrift og ét filtreret kald');
        assert.match(lines[0], /^"startedAt";"category";/);
        assert.match(lines[1], /"Periode: Denne appkørsel · Type: AI-model · Status: Alle statusser"/);
        assert.match(lines[1], /"1 af 2 registreringer"/);
      }
    }
    await page.selectOption('#network-category', '');
    for (const theme of ['light', 'dark']) {
      const changed = await page.evaluate(theme => window.harness.appearanceSave({ theme }, null), theme);
      assert.equal(changed.ok, true);
      // Playwright controls the browser context's media preference separately from nativeTheme.
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => matchMedia('(prefers-color-scheme: dark)').matches === (theme === 'dark'), theme);
      await page.screenshot({ animations: 'disabled', path: path.join(output, 'report-' + theme + '.png') });
    }
    await page.selectOption('#network-status', 'failed'); assert.equal(await page.isVisible('#network-report-empty'), true);
    await page.selectOption('#network-status', '');
    // Journalen er skrevet til disk med begge kald som gennemført, før den ryddes.
    const journalFile = path.join(root, 'profile/harness/network-journal/requests.json');
    let stored = { records: [] };
    for (let i = 0; i < 50 && !(stored.records.length === 2 && stored.records.every(row => row.status === 'completed')); i++) { await new Promise(resolve => setTimeout(resolve, 100)); stored = JSON.parse(await fs.readFile(journalFile, 'utf8').catch(() => '{"records":[]}')); }
    assert.equal(stored.records.length, 2); assert.ok(stored.records.every(row => row.status === 'completed'));
    // N:E-4: Ryd rapporten spørger først, ligesom Slet samtale. Fokus står på Annuller, og Annuller sletter intet.
    await page.click('#network-report-clear'); assert.equal(await page.isVisible('#network-report-clear-question'), true);
    assert.match(await page.textContent('#network-report-clear-question'), /alle projekter.*kan ikke fortrydes/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'network-report-clear-cancel');
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'report-clear-question.png') });
    await page.click('#network-report-clear-cancel'); assert.equal(await page.isVisible('#network-report-clear-question'), false);
    assert.match(await page.textContent('#network-report-summary'), /2 registrerede kald/, 'Annuller sletter intet');
    // R#39: først Ryd rapporten i spørgsmålet sletter registreringerne, også i filen.
    await page.click('#network-report-clear'); await page.click('#network-report-clear-confirm'); await page.locator('#network-report-feedback').filter({ hasText: 'ryddet' }).waitFor();
    assert.match(await page.textContent('#network-report-summary'), /ingen registrerede kald/);
    assert.equal(await page.locator('#network-report-rows tr').count(), 0);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#network-report-open').evaluate(element => element === document.activeElement), true);
    assert.equal(calls, 2); assert.deepEqual(errors, []);
    await app.close(); app = null;
    const saved = JSON.parse(await fs.readFile(journalFile, 'utf8'));
    assert.equal(saved.records.length, 0, 'den ryddede journal forbliver tom efter lukning');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, actualElectron: true, syntheticLoopbackProvider: true, actualRequests: calls, themeEvidence: 'Actual Electron rendering with appearanceSave and Playwright color-scheme media preference', checks: ['first layer', 'waiting phase', 'completed response', 'filters', 'covered types only', 'JSON/CSV export', 'Danish Excel CSV', 'secret exclusion', 'coverage', 'persistence', 'clear asks first', 'clear', 'Escape focus'], pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, actualRequests: calls, output }));
  } finally {
    if (app) await app.close().catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (output !== root) await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
