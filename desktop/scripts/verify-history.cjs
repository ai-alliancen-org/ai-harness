// Visuel historik i Electron: versioner med navn og før/efter-billeder under Ændringer › Versioner, omdøbning uden
// at ændre Git, Fortryd opgaven, der bevarer brugerens senere rettelser, konflikter, som brugeren afgør, Gå tilbage
// hertil, der først gemmer ugemte ændringer, og Fortryd uden Git. Den rigtige OpenCode-motor bruges med en kontrolleret
// modelserver og nye projekter i en midlertidig mappe; Git-versionerne oprettes kun dér, aldrig i dette repository.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-historik-')));
  const documents = path.join(root, 'Dokumenter'); await fs.mkdir(documents);
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const git = (cwd, ...args) => execFileSync(realGit, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  const page1 = ['<!doctype html>', '<html lang="da"><head><meta charset="utf-8"><title>Lokaler</title><style>body{font:18px system-ui;margin:32px}</style></head><body>', '<h1>Mødelokaler</h1>', '<p>Tre lokaler.</p>', '<ul>', '<li>Lille sal</li>', '<li>Stor sal</li>', '</ul>', '<footer>Kontakt: kommunen</footer>', '</body></html>', ''].join('\n');
  let target = null;
  const steps = {
    BYG: () => ({ file: 'public/index.html', content: page1 }),
    TILFØJ: async () => ({ file: 'public/index.html', content: (await fs.readFile(path.join(target, 'public/index.html'), 'utf8')).replace('<li>Stor sal</li>\n', '<li>Stor sal</li>\n<li>Mellem sal</li>\n') }),
    ÆNDR: async () => ({ file: 'public/index.html', content: (await fs.readFile(path.join(target, 'public/index.html'), 'utf8')).replace('<p>Tre lokaler.</p>', '<p>Fire lokaler.</p>') })
  };
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'historik-model', name: 'Kontrolleret model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const text = m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lastUser = body.messages.findLastIndex(m => m.role === 'user'), last = lastUser >= 0 ? text(body.messages[lastUser]) : '';
    const tools = body.messages.slice(lastUser).filter(m => m.role === 'tool').length;
    const key = Object.keys(steps).find(word => last.includes(word));
    let step = { text: 'Det er gjort.' };
    if (!body.tools?.length) step = { text: 'Titel' };
    else if (key && tools === 0) { const write = await steps[key](); step = { tool: 'write', args: { filePath: path.join(target, write.file), content: write.content } }; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } } : {}) }) + '\n\n');
    if (step.tool) send({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${requests.length}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
    else send({ role: 'assistant', content: step.text });
    send({}, step.tool ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const checks = []; const passed = text => { checks.push(text); console.log('✓ ' + text); };
  const errors = []; let app, page;
  const capture = async name => { const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64')); };
  const file = () => fs.readFile(path.join(target, 'public/index.html'), 'utf8');
  const send = async text => {
    await page.fill('#prompt', text); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await Promise.race([helpers.awaitApproval(page).then(() => helpers.approve(page, 'Tillad for denne opgave')), page.waitForFunction(() => document.querySelector('#stop').hidden && !document.querySelector('#run-review').hidden, null, { timeout: 90000 })]);
    await page.waitForFunction(() => document.querySelector('#stop').hidden && !document.querySelector('#run-review').hidden, null, { timeout: 90000 });
  };
  const versions = async () => { await helpers.menuClick(page, '#git-button'); await page.locator('#git-summary').filter({ hasNotText: 'Henter' }).waitFor(); };
  const rows = () => page.locator('#git-history .version-row');
  const confirmRestore = async () => { await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled); await page.click('#restore-confirm'); await page.waitForSelector('#restore-dialog:not([open])', { state: 'attached' }); };
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.isolateDocuments(app, documents); await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    await page.fill('#purpose', 'En side med mødelokaler.'); await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
    target = path.join(documents, 'Aura', (await fs.readdir(path.join(documents, 'Aura')))[0]);
    await helpers.addConnection(page, { name: 'Kontrolleret', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');

    // 1. Første AI-opgave: versionen får et navn ud fra beskeden og et billede af forhåndsvisningen bagefter.
    await send('BYG en side med mødelokaler. Den skal være enkel.');
    assert.match(git(target, 'log', '-1', '--format=%s'), /^AI-opgave: BYG en side med mødelokaler/);
    await versions();
    assert.equal(await page.locator('.work-tab[aria-selected="true"]').getAttribute('data-tab'), 'changes');
    assert.equal(await page.locator('#changes-view-versions').getAttribute('aria-pressed'), 'true');
    await page.locator('#git-history .version-row img[src^="data:image/jpeg"]').first().waitFor({ timeout: 30000 });
    assert.equal(await rows().first().locator('strong').textContent(), 'BYG en side med mødelokaler');
    assert.match(await rows().first().locator('.hint').textContent(), /^AI-opgave · i dag \d{2}\.\d{2} · nuværende$/);
    assert.equal(await rows().count(), 2);
    passed('Versionen efter en AI-opgave hedder det, brugeren bad om, har type og tid og et billede af forhåndsvisningen');

    // 2. Én version: billedet efter, filerne med linje-diff og omdøbning uden at ændre Git.
    await rows().first().click();
    await page.locator('#version-title').filter({ hasText: 'BYG en side med mødelokaler' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'version-title');
    assert.equal(await page.locator('#version-compare figure:visible').count(), 1, 'kun et billede efter; før første version fandtes ingen side');
    assert.match(await page.locator('#version-images').textContent(), /Der er intet billede fra før/);
    await page.locator('#changes-files .file-row').filter({ hasText: 'public/index.html' }).waitFor();
    assert.equal(await page.locator('#changes-files .by-tag').first().textContent(), 'AI’en');
    await page.locator('#changes-diff-lines').filter({ hasText: 'Mødelokaler' }).waitFor();
    assert.equal(await page.locator('#version-restore').isVisible(), false, 'den nuværende version kan ikke gås tilbage til');
    assert.equal(await page.locator('#version-revert').isVisible(), true);
    await page.click('#version-rename'); await page.fill('#version-name', 'Første side med lokaler'); await page.click('#version-rename-form button[type=submit]');
    await page.locator('#version-title').filter({ hasText: 'Første side med lokaler' }).waitFor();
    assert.match(await page.locator('#version-meta').textContent(), /oprindeligt »AI-opgave: BYG en side/);
    assert.match(git(target, 'log', '-1', '--format=%s'), /^AI-opgave: BYG/, 'Git-beskeden er uændret');
    await page.click('#version-back'); await rows().first().locator('strong').filter({ hasText: 'Første side med lokaler' }).waitFor();
    await capture('versioner.png');
    passed('En version viser billede, filer og linjer; omdøbning gemmes i Aura, mens Git-historikken er uændret');

    // 3. Anden opgave med billede før og efter af samme side og størrelse.
    await page.click('#tab-preview');
    await send('TILFØJ en mellemstor sal.');
    await versions();
    await page.locator('#git-history .version-row').first().locator('strong').filter({ hasText: 'TILFØJ en mellemstor sal' }).waitFor();
    await page.locator('#git-history .version-row').first().locator('img[src^="data:image/jpeg"]').waitFor({ timeout: 30000 });
    await rows().first().click(); await page.locator('#version-title').filter({ hasText: 'TILFØJ' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#version-compare figure:not([hidden]) img[src^="data:image/jpeg"]').length === 2, null, { timeout: 30000 });
    const sizes = await page.locator('#version-compare img').evaluateAll(imgs => imgs.map(img => [img.naturalWidth, img.naturalHeight]));
    assert.deepEqual(sizes[0], sizes[1], 'før og efter har samme størrelse');
    assert.match(await page.locator('#version-images').textContent(), /^Billeder af forsiden ved \d+ × \d+\./);
    await capture('version-foer-efter.png');
    // Samme billeder står ved opgaven under Denne samtale.
    await page.click('#changes-view-session'); await page.locator('#changes-heading').filter({ hasText: 'ændret under opgaven' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#changes-overview .compare figure:not([hidden]) img[src^="data:image/jpeg"]').length === 2, null, { timeout: 30000 });
    passed('En opgave får billeder før og efter af samme side i samme størrelse, både i versionen og under Denne samtale');

    // 4. Fortryd opgaven bevarer brugerens senere rettelse i samme fil og gemmer den først som en version.
    await page.click('#tab-preview');
    await fs.writeFile(path.join(target, 'public/index.html'), (await file()).replace('Kontakt: kommunen', 'Kontakt: borgerservice'));
    await (await helpers.resultOption(page, 'Fortryd opgaven')).click();
    await page.waitForSelector('#restore-dialog[open]'); await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled);
    assert.equal(await page.locator('#restore-title').textContent(), 'Fortryd opgaven');
    assert.match(await page.locator('#restore-summary').textContent(), /Dine senere rettelser i 1 fil bevares/);
    assert.match(await page.locator('#restore-outcomes').innerText(), /public\/index\.html · Sættes tilbage; dine senere rettelser bevares/);
    assert.match(await page.locator('#restore-unsaved').textContent(), /gemmes først som versionen »Dine ændringer før fortrydelsen«/);
    assert.equal(await page.locator('#restore-compare figure:visible').count(), 2, 'billede nu og fra før opgaven');
    assert.equal(await page.locator('#restore-target-label').textContent(), 'Før opgaven');
    await page.click('#restore-dialog > details > summary');
    assert.match(await page.locator('#restore-data').innerText(), /Samtalen og briefen bevares/);
    assert.match(await page.locator('#restore-data').innerText(), /Resultatet gemmes som en ny version/);
    await capture('fortryd-gennemgang.png');
    await confirmRestore();
    let now = await file();
    assert.ok(now.includes('Kontakt: borgerservice') && !now.includes('Mellem sal'), 'opgavens ændring er væk, og brugerens rettelse er bevaret');
    const log = git(target, 'log', '-4', '--format=%s').split('\n');
    assert.match(log[0], /^Fortrudt: TILFØJ/); assert.equal(log[1], 'Dine ændringer før fortrydelsen'); assert.match(log[2], /^AI-opgave: TILFØJ/);
    assert.equal(git(target, 'status', '--porcelain'), '', 'alt er gemt');
    passed('Fortryd opgaven fjerner kun opgavens ændring, bevarer brugerens senere rettelse og gemmer den først som en version');

    // 5. Konflikt: brugeren og opgaven har rettet samme linje. Brugeren vælger; som standard beholdes brugerens linjer.
    await send('ÆNDR antallet af lokaler.');
    await fs.writeFile(path.join(target, 'public/index.html'), (await file()).replace('<p>Fire lokaler.</p>', '<p>Fire store lokaler.</p>'));
    await (await helpers.resultOption(page, 'Fortryd opgaven')).click();
    await page.waitForSelector('#restore-dialog[open]'); await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled);
    assert.equal(await page.locator('#restore-conflicts').isVisible(), true);
    assert.equal(await page.locator('input[name="restore-choice"][value="ours"]').isChecked(), true);
    await page.click('#restore-conflicts summary');
    const lines = await page.locator('#restore-conflict-lines').innerText();
    assert.match(lines, /Fire store lokaler/); assert.match(lines, /Tre lokaler/);
    await capture('konflikt.png');
    await page.check('input[name="restore-choice"][value="theirs"]');
    await confirmRestore();
    now = await file();
    assert.ok(now.includes('<p>Tre lokaler.</p>') && now.includes('Kontakt: borgerservice'), 'linjen fra før, og den tidligere rettelse er bevaret');
    passed('Ved en konflikt viser Aura begge linjer, anbefaler dine og bruger det, brugeren vælger');

    // 6. Gå tilbage hertil gemmer først en ugemt ændring og bringer så en ældre version tilbage som en ny version.
    await fs.writeFile(path.join(target, 'public/index.html'), now.replace('<h1>Mødelokaler</h1>', '<h1>Lokaler til leje</h1>'));
    await versions();
    await rows().filter({ hasText: 'Første side med lokaler' }).click();
    await page.locator('#version-title').filter({ hasText: 'Første side med lokaler' }).waitFor();
    assert.equal(await page.locator('#version-restore').isVisible(), true);
    await page.click('#version-restore');
    await page.waitForSelector('#restore-dialog[open]'); await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled);
    assert.match(await page.locator('#restore-unsaved').textContent(), /»Dine ændringer før gendannelsen«/);
    assert.equal(await page.locator('#restore-target-label').textContent(), 'Versionen');
    await confirmRestore();
    assert.equal(await file(), page1);
    const after = git(target, 'log', '-2', '--format=%s').split('\n');
    assert.equal(after[0], 'Gendannet til: Første side med lokaler'); assert.equal(after[1], 'Dine ændringer før gendannelsen');
    assert.match(git(target, 'show', 'HEAD~1:public/index.html'), /Lokaler til leje/, 'den ugemte ændring kan hentes igen');
    passed('Gå tilbage hertil gemmer først den ugemte ændring som en version og bringer den ældre version tilbage som en ny version');

    // 7. Billederne ligger i appens data, ikke i projektet, og billedvinduets session gemmer intet på disken.
    const projectImages = execFileSync('/usr/bin/find', [target, '-name', '*.jpg', '-not', '-path', '*/.git/*'], { encoding: 'utf8' }).trim();
    assert.equal(projectImages, '');
    const index = execFileSync('/usr/bin/find', [path.join(root, 'appdata'), '-name', 'images.json'], { encoding: 'utf8' }).trim().split('\n')[0];
    const stored = JSON.parse(await fs.readFile(index, 'utf8'));
    assert.ok(stored.images.length >= 4 && stored.images.every(entry => /^[0-9a-f-]{36}$/.test(entry.id) && entry.view.width > 0));
    assert.equal(await app.evaluate(({ session }) => session.fromPartition('aura-billeder').isPersistent()), false);
    // Billedvinduet lukkes igen; kun appens eget vindue er tilbage.
    for (let i = 0; i < 40 && await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) > 1; i++) await page.waitForTimeout(250);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    passed('Billederne gemmes i appens data, ikke i projektet; billedvinduet bruger en session uden lagring og lukkes igen');

    // 8. 980 × 720, større tekst og tastatur i Versioner.
    await versions();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720)); await page.waitForTimeout(500);
    for (const zoom of [1, 1.5]) {
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(zoom), zoom); await page.waitForTimeout(500);
      const layout = await page.evaluate(() => { const panel = document.querySelector('#panel-changes').getBoundingClientRect(), row = document.querySelector('#git-history .version-row').getBoundingClientRect(), bar = document.querySelector('#changes-view-versions').getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth, row: row.right <= panel.right + 1 && row.left >= panel.left - 1, bar: bar.right <= panel.right + 1 }; });
      assert.deepEqual(layout, { overflow: false, row: true, bar: true }, `layout ved ${zoom}`);
      await capture(`980x720-${zoom * 100}.png`);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(1));
    await rows().first().focus(); await page.keyboard.press('Enter');
    await page.locator('#version-title').filter({ hasText: 'Tilbage til »Første side med lokaler«' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'version-title');
    await page.click('#version-back'); assert.equal(await page.evaluate(() => document.activeElement.id), 'versions-heading');
    await page.click('#changes-view-session'); await page.locator('#changes-source').waitFor();
    assert.equal(await page.locator('#versions-view').isVisible(), false);
    passed('Versioner ved 980 × 720 og 150 % tekst uden vandret rulning; tastaturet åbner en version og fører fokus tilbage');

    // 9. Fortryd uden Git: en mappe uden versioner bruger Auras øjebliksbillede og bevarer brugerens rettelse.
    const plain = path.join(root, 'Uden Git'); await fs.mkdir(path.join(plain, 'public'), { recursive: true });
    await fs.writeFile(path.join(plain, 'public/index.html'), page1);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, plain);
    await page.click('#open'); await page.waitForFunction(folder => document.querySelector('#project-path').textContent === folder, plain);
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');
    target = plain;
    await send('TILFØJ en mellemstor sal.');
    await fs.writeFile(path.join(plain, 'public/index.html'), (await file()).replace('Kontakt: kommunen', 'Kontakt: borgerservice'));
    await (await helpers.resultOption(page, 'Fortryd opgaven')).click();
    await page.waitForSelector('#restore-dialog[open]'); await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled);
    assert.match(await page.locator('#restore-outcomes').innerText(), /dine senere rettelser bevares/);
    await page.click('#restore-dialog > details > summary');
    assert.match(await page.locator('#restore-data').innerText(), /Projektet har ikke versioner/);
    await confirmRestore();
    now = await file();
    assert.ok(now.includes('Kontakt: borgerservice') && !now.includes('Mellem sal'));
    await versions(); await page.locator('#restore-undo').waitFor();
    await page.click('#restore-undo'); await confirmRestore();
    assert.ok((await file()).includes('Mellem sal'), 'Fortryd sidste gendannelse bringer opgavens ændring tilbage');
    passed('Uden Git fortrydes en opgave fra Auras øjebliksbillede med brugerens rettelse bevaret, og selve fortrydelsen kan fortrydes');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: checks.length }, null, 2));
  } catch (error) {
    console.error(error);
    try { await page?.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }); console.error('Skærmbillede:', path.join(root, 'fejl.png')); console.error(await page?.locator('#message').textContent({ timeout: 1000 })); } catch {}
    process.exitCode = 1;
  } finally { await app?.close(); server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
