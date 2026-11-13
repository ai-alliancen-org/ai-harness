// Rigtig Aura og OpenCode med lokal, kontrolleret modelstrøm. Demoens filer og konti røres ikke.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');
const { GitVersions } = require('../core/git.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-conversation-progress-')));
  const project = path.join(root, 'Blomst'), target = path.join(project, 'public/index.html');
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, '<h1>Før blomsten</h1>');
  await new GitVersions().startProject(project);
  const errors = [], requests = [], replies = [], gates = {};
  let app;
  const wait = name => new Promise(resolve => { gates[name] = resolve; });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'test-model', name: 'Testmodel' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const reply = replies.shift(); if (!reply) { res.writeHead(500); return res.end('Uventet modelkald'); }
    res.setHeader('content-type', 'text/event-stream');
    const send = delta => res.write('data: ' + JSON.stringify({ id: 'prøve-' + requests.length, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    const end = reason => { res.write('data: ' + JSON.stringify({ id: 'prøve-' + requests.length, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: reason }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n'); res.end('data: [DONE]\n\n'); };
    try {
      send({ role: 'assistant' });
      if (reply === 'build') {
        send({ reasoning_content: 'Interne noter, som ikke skal vises. '.repeat(30) }); await wait('reasoning');
        send({ tool_calls: [{ index: 0, id: 'write-flower', type: 'function', function: { name: 'write', arguments: '{"filePath":' + JSON.stringify(target) + ',"content":"<h1>En blomst 🌸</h1>\\n<p>Et levende udkast</p>\\n' } }] });
        await wait('draft'); send({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }); end('tool_calls');
      } else {
        if (reply === 'final') { await wait('written'); send({ content: 'Blomsten er skrevet. Prøv den i forhåndsvisningen.' }); }
        else send({ content: reply });
        end('stop');
      }
    } catch { if (!res.destroyed) res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const bundle = process.env.HARNESS_TEST_PACKAGE ? path.resolve(process.env.HARNESS_TEST_PACKAGE) : null;
    const executablePath = bundle ? (bundle.endsWith('.app') ? path.join(bundle, 'Contents/MacOS', path.basename(bundle, '.app')) : bundle) : require('electron');
    app = await electron.launch({ executablePath, args: [...(bundle ? [] : [path.join(__dirname, '..')]), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const testedApp = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }));
    await app.evaluate(() => { const original = global.fetch; global.fetch = (url, options) => { if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(String(url))) throw Error('Prøven bruger kun lokal netadgang.'); return original(url, options); }; });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await helpers.skipIntroduction(page);
    await helpers.addConnection(page, { name: 'Lokal testmodel', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#model-select').options.length === 2);
    await helpers.taskOptions(page); await page.locator('#model-shortlist button').first().click();
    assert.equal(await page.inputValue('#work-mode'), 'chat');
    assert.match(await page.getAttribute('#prompt', 'placeholder'), /Stil et spørgsmål/);
    async function send(text, reply, complete = true) {
      replies.push(reply); await page.fill('#prompt', text); await page.click('#send');
      await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
      if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
      if (complete) await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 60000 });
    }
    // Det konkrete svar fra brugerens skærmbillede må ikke blive et byggekort.
    await helpers.selectMode(page, 'plan');
    await send("no i just wanted a quick response, you aren't supposed to build anything :)", 'Forstået! Da planen allerede er lagt frem og godkendt, er der ikke mere at afklare. Sig til, når du vil have mig til at bygge blomsten. 🌸');
    assert.equal(await page.isVisible('#plan-card'), false);
    assert.equal(await fs.readFile(target, 'utf8'), '<h1>Før blomsten</h1>');
    await page.click('#project-list .project-entry.is-current .project-add'); await page.waitForFunction(() => document.querySelector('#work-mode').value === 'chat' && !document.querySelector('#messages').textContent.trim()); assert.equal(await page.inputValue('#work-mode'), 'chat');
    await send('Kunne vi lave en blomst?', 'Det kan vi. Skal vi lave en plan?\n<!-- aura:offer-plan -->');
    await page.locator('#plan-offer:not([hidden])').waitFor();
    assert.equal(await page.isVisible('#plan-card'), false); assert.ok(!(await page.textContent('#messages')).includes('aura:'));
    assert.equal(await page.locator('#plan-offer button:visible').count(), 2);
    await page.screenshot({ path: path.join(root, 'planforslag.png'), animations: 'disabled' });
    await page.click('#dismiss-plan-offer'); assert.equal(await page.isVisible('#plan-offer'), false);
    await send('Bare snak videre.', 'Skal vi planlægge?\n<!-- aura:offer-plan -->'); assert.equal(await page.isVisible('#plan-offer'), false);
    assert.match(JSON.stringify(requests.at(-1)), /har afvist planforslag/);
    await page.click('#project-list .project-entry.is-current .project-add'); await page.waitForFunction(() => document.querySelector('#work-mode').value === 'chat' && !document.querySelector('#messages').textContent.trim());
    await send('Jeg har en idé til en blomst.', 'Vil du lave en plan?\n<!-- aura:offer-plan -->');
    await page.click('#accept-plan-offer'); assert.equal(await page.inputValue('#work-mode'), 'plan');
    const plan = '## Det bygger vi\nEn blomst.\n## Sådan skal det se ud\nLyserøde blade.\n## Teknik og data\nHTML og CSS.\n## Det skal du prøve\nSe blomsten springe ud.';
    await send(await page.inputValue('#prompt'), plan);
    await page.locator('#plan-card:not([hidden])').waitFor();
    await page.screenshot({ path: path.join(root, 'planvalg.png'), animations: 'disabled' });
    await page.click('#version-status'); await page.locator('#git-history .version-row').first().click();
    await page.locator('#version-detail:not([hidden])').waitFor();
    assert.equal(await page.isEnabled('#version-rename'), true);
    replies.push('build', 'final'); await page.click('#build-plan');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
    await page.locator('#agent-activity-text').filter({ hasText: 'forbereder næste skridt' }).waitFor();
    assert.match(await page.getAttribute('#prompt', 'placeholder'), /bygge eller ændre/);
    await page.waitForFunction(() => document.querySelector('#version-rename').disabled);
    assert.ok(!(await page.textContent('#messages')).includes('Interne noter'));
    assert.ok(!(await page.textContent('#agent-progress')).includes('tegn modtaget'));
    gates.reasoning(); await page.locator('#agent-activity-text').filter({ hasText: 'Modtager kode' }).waitFor();
    await page.click('#agent-follow'); await page.locator('.live-draft pre').filter({ hasText: 'En blomst' }).waitFor();
    assert.equal(await fs.readFile(target, 'utf8'), '<h1>Før blomsten</h1>');
    assert.match(await page.textContent('.live-draft'), /ikke gemt/);
    await page.screenshot({ path: path.join(root, 'kode-undervejs.png'), animations: 'disabled' });
    gates.draft(); await helpers.approve(page, 'Tillad for denne opgave');
    // Kvitteringen i samtalen tæller handlingerne og siger, hvilket omfang der blev givet.
    await page.locator('#messages .answer-record').filter({ hasText: 'godkendt for denne opgave' }).waitFor({ timeout: 30000 });
    await page.click('#tab-code'); await page.locator('#code-files .change-tag').first().waitFor();
    assert.match(await fs.readFile(target, 'utf8'), /En blomst/);
    await page.locator('#version-status').filter({ hasText: '1 ugemt ændring' }).waitFor();
    await page.click('#tab-changes'); await page.click('#changes-view-session'); await page.locator('#changes-overview:not([hidden])').waitFor();
    assert.match(await page.textContent('#changes-source'), /I gang/);
    await page.click('#changes-view-versions'); await page.locator('#git-history .version-row').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('#git-summary').textContent.includes('Henter'));
    assert.ok(!(await page.textContent('#git-summary')).includes('Henter'));
    assert.equal(await page.isEnabled('#git-save-all'), false);
    await page.locator('#git-history .version-row').first().click(); await page.locator('#version-detail:not([hidden])').waitFor(); assert.equal(await page.isEnabled('#version-restore'), false);
    assert.equal(await page.isEnabled('#version-rename'), false);
    await page.screenshot({ path: path.join(root, 'versioner-under-arbejde.png'), animations: 'disabled' });
    gates.written(); await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('#version-rename').disabled);
    const undo = await helpers.resultOption(page, 'Fortryd opgaven'); assert.match(await undo.getAttribute('class'), /text-button/);
    await undo.click(); await page.locator('#restore-dialog[open]').waitFor();
    await page.locator('#restore-outcomes').filter({ hasText: 'index.html' }).waitFor();
    await page.click('#restore-confirm'); await page.locator('#run-review').filter({ hasText: 'Opgaven er fortrudt' }).waitFor();
    assert.equal(await fs.readFile(target, 'utf8'), '<h1>Før blomsten</h1>');
    // Den åbne version under Ændringer › Versioner følger fortrydelsen: den svarer nu til filerne, så Gå tilbage hertil vises ikke.
    await page.waitForFunction(() => document.querySelector('#version-restore').hidden, null, { timeout: 10000 });
    // Fortryd skifter ikke fane (kun brugeren skifter fane). Brugeren står i Ændringer og vælger selv Forhåndsvisning.
    await page.click('#tab-preview');
    await page.frameLocator('#preview').locator('h1').filter({ hasText: 'Før blomsten' }).waitFor();
    await page.screenshot({ path: path.join(root, 'fortryd-kvittering.png'), animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720));
    await page.waitForFunction(() => innerWidth === 980);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(root, 'lille-vindue.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, package: bundle, app: testedApp, requests: requests.length, checks: ['Samtale som standard', 'demoens afvisning uden byggekort', 'frivilligt planvalg', 'afvisning huskes', 'konkret plan før bygning', 'ræsonnement skjules', 'kode før filskrivning', 'live filliste og diff', 'versioner under arbejde', 'fortryd med gennemgang og kvittering', '980 × 720'] }));
  } catch (error) { if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {}); console.error('Evidens:', root, errors); throw error; }
  finally { Object.values(gates).forEach(resolve => resolve()); await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
