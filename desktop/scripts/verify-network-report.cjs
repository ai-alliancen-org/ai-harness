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
    assert.match(await page.textContent('#network-report-rows'), /Venter på svarheaders/);
    assert.match(await page.textContent('#network-report-rows'), /i gang/);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'report-waiting.png') });
    assert.ok(release); release();
    await app.evaluate(async () => { await global.networkFixtureResult; await global.networkFixture.close(); });
    await page.click('#network-report-refresh'); await page.locator('#network-report-rows').filter({ hasText: 'Gennemført' }).waitFor();
    await page.selectOption('#network-category', 'model'); assert.equal(await page.locator('#network-report-rows tr').count(), 1);
    for (const format of ['json', 'csv']) {
      const target = path.join(output, 'report.' + format);
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
      await page.click('#network-report-' + format); await page.locator('#network-report-feedback').filter({ hasText: 'gemt lokalt' }).waitFor();
      const saved = await fs.readFile(target, 'utf8'); assert.doesNotMatch(saved, /synthetic-private|test-model|chat\/completions/); assert.match(saved, /aura-only/);
      if (format === 'json') { const report = JSON.parse(saved); assert.equal(report.records.length, 1); assert.equal(report.records[0].status, 'completed'); assert.equal(report.coverage.find(row => row.category === 'integration').status, 'unknown'); }
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
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#network-report-open').evaluate(element => element === document.activeElement), true);
    assert.equal(calls, 2); assert.deepEqual(errors, []);
    await app.close(); app = null;
    const saved = JSON.parse(await fs.readFile(path.join(root, 'profile/harness/network-journal/requests.json'), 'utf8'));
    assert.equal(saved.records.length, 2); assert.ok(saved.records.every(row => row.status === 'completed'));
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, actualElectron: true, syntheticLoopbackProvider: true, actualRequests: calls, themeEvidence: 'Actual Electron rendering with appearanceSave and Playwright color-scheme media preference', checks: ['waiting phase', 'completed response', 'filters', 'JSON/CSV export', 'secret exclusion', 'coverage', 'Escape focus', 'shutdown persistence'], pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, actualRequests: calls, output }));
  } finally {
    if (app) await app.close().catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (output !== root) await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
