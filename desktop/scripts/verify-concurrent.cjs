// Rigtig Electron, OpenCode og projektfiler. Modelserveren er kontrolleret; ingen konto eller modelbetaling.
// Git-versioner og en lokal prøveidentitet oprettes kun i det nye, midlertidige projekt, aldrig i repositoryet.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const framework = process.env.AURA_COPY_FRAMEWORK || 'vite';
  if (!['vite', 'astro'].includes(framework)) throw new Error('Vælg vite eller astro til kopiprøven.');
  const frameworkName = framework === 'astro' ? 'Astro' : 'Vite', frameworkFile = framework === 'astro' ? 'src/pages/index.astro' : 'index.html';
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-samtidige-'))), project = path.join(root, 'Foreningen');
  // Appen fjerner indkommende GIT_* før Git-kald. En lokal testwrapper isolerer derfor også global konfiguration.
  const bin = path.join(root, 'bin'), realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const document = (heading, footer) => `<!doctype html>\n<meta charset="utf-8">\n<title>Forening</title>\n<h1>${heading}</h1>\n<p>${footer}</p>\n<input aria-label="Navn">\n`;
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), document('Før', 'Kontakt'));
  await fs.writeFile(path.join(project, '.env'), 'HEMMELIG');
  const requests = [], held = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const last = [...body.messages].reverse().find(m => m.role === 'user'), text = JSON.stringify(last?.content || '');
    const all = body.messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    const copyRoot = all.match(/Arbejd kun i denne samtales kopi: (.*?)\. Projektets/), folder = copyRoot?.[1] || project;
    const reply = (delta, finish = 'stop') => {
      if (res.destroyed) return;
      const chunk = { id: 'svar', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
      res.setHeader('content-type', 'text/event-stream'); res.write('data: ' + JSON.stringify(chunk) + '\n\n');
      res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 10 } }) + '\n\n'); res.end('data: [DONE]\n\n');
    };
    if (!body.tools?.length) return reply({ content: 'Titel' });
    if (text.includes('hold-a')) { const release = () => reply({ content: 'Opgaven er afsluttet.' }); held.add(release); res.on('close', () => held.delete(release)); return; }
    if (body.messages.at(-1)?.role === 'tool') return reply({ content: 'Rettelsen er klar. Prøv siden.' });
    const code = text.includes('opgave-a') ? document('Projektets overskrift', 'Kontakt') : text.includes('opgave-c') ? document('Kopiens overskrift', 'Kontakt') : document('Før', 'Ny kontakt');
    const hasFramework = await fs.access(path.join(folder, 'package.json')).then(() => true, () => false);
    reply({ tool_calls: [{ index: 0, id: 'skriv', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(folder, hasFramework ? frameworkFile : 'public/index.html'), content: code }) } }] }, 'tool_calls');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app, page; const errors = [], checks = [], measurements = [];
  checks.push = function (...items) { for (const item of items) console.log('Bestået: ' + item); return Array.prototype.push.apply(this, items); };
  async function launch() {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PATH: bin + path.delimiter + process.env.PATH } });
    page = await app.firstWindow(); page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message)); await helpers.skipIntroduction(page); page.setDefaultTimeout(90000);
  }
  const switchChat = async (title, workspace) => { await row(title).click(); await page.waitForFunction(({ title, workspace }) => document.querySelector('#project-list .chat-row[aria-current="true"]')?.textContent.includes(title) && (!workspace || document.querySelector('#preview')?.dataset.root === workspace), { title, workspace }); };
  const newChat = async () => { const id = await page.locator('#project-list .chat-row[aria-current="true"]').getAttribute('data-chat'); await page.click('#project-list .project-entry.is-current .project-add'); await page.waitForFunction(id => document.querySelector('#project-list .chat-row[aria-current="true"]')?.dataset.chat !== id && !document.querySelector('#send').disabled && document.querySelector('#prompt').value === '', id); };
  const row = title => page.locator('#project-list .chat-row').filter({ hasText: title });
  const send = async text => {
    await helpers.selectMode(page, 'free'); await page.fill('#prompt', text); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
    await helpers.awaitApproval(page);
  };
  const allow = async () => { await helpers.approve(page, 'Tillad én gang'); await page.locator('#stop').waitFor({ state: 'hidden' }); };
  const call = async (method, input) => { const result = await page.evaluate(({ method, input }) => window.harness[method](input), { method, input }); assert.equal(result.ok, true, result.error); return result.value; };
  let singleImageChecks = 0;
  const merge = async () => {
    await page.locator('#merge-copy:not([disabled])').waitFor(); await page.focus('#merge-copy'); await page.waitForFunction(() => document.activeElement.id === 'merge-copy'); await page.keyboard.press('Enter'); await page.locator('#restore-confirm:not([disabled])').waitFor();
    assert.ok(await page.evaluate(() => Boolean(document.activeElement.closest('#restore-dialog'))), 'tastaturfokus er i indfletningsdialogen');
    assert.match(await page.locator('#restore-data').textContent(), /Kopiens forhåndsvisning afsluttes\. En kørende forhåndsvisning af projektet bevares\./, 'gennemgangen beskriver de servere, den faktisk påvirker');
    if (await page.locator('#restore-compare img:visible').count() === 1) { singleImageChecks++; assert.ok(await page.locator('#restore-images-note').isVisible(), 'ét billede uden modstykke forklares i gennemgangen'); }
  };
  const shot = async name => {
    const selector = name.endsWith('-version') ? '#version-detail' : name.endsWith('-status-zoom') ? '#message' : name === 'samtidige-godkendelser' ? '#approvals' : name.startsWith('fletning') || name.endsWith('-fletning') || name === 'konflikt' ? '#restore-dialog' : '#copy-notice';
    measurements.push(await page.evaluate(({ name, selector }) => {
      const el = document.querySelector(selector), shown = e => e.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }) && e.getBoundingClientRect().width > 0;
      const text = el?.innerText.trim() || '', controls = [...(el?.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary') || [])].filter(shown);
      return { name, selector, words: text.split(/\s+/).filter(Boolean).length, choices: controls.filter(e => !e.classList.contains('info') && !e.matches('textarea, input:not([type=checkbox]):not([type=radio])')).length, infos: controls.filter(e => e.classList.contains('info')).length, fields: controls.filter(e => e.matches('textarea, input:not([type=checkbox]):not([type=radio])')).length };
    }, { name, selector }));
    const buffer = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(root, name + '.png'), buffer);
  };
  try {
    await launch();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.locator('#project-name').filter({ hasText: 'Foreningen' }).waitFor();
    const connection = await helpers.addConnection(page, { name: 'Kontrolleret lokal forbindelse', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection.id); await page.locator('#model-shortlist button').first().click();
    await send('Ret overskriften. opgave-a'); await row('Ret overskriften').waitFor();
    await newChat();
    // Siden 0.6.0-beta.1 (5ffe905) kan Nyt projekt og Åbn projekt bruges, mens en anden samtale venter; se README og DESIGN.md.
    assert.equal(await page.locator('#new').isEnabled(), true, 'Nyt projekt kan bruges, mens en anden samtale venter');
    assert.equal(await page.locator('#open').isEnabled(), true, 'Åbn projekt kan bruges, mens en anden samtale venter');
    await send('Ret kontakten. opgave-b');
    await page.locator('#copy-notice:not([hidden])').waitFor();
    const copyRoot = await page.locator('#copy-path').textContent(), copyFile = path.join(copyRoot, 'public/index.html');
    assert.notEqual(copyRoot, project); await assert.rejects(fs.access(path.join(copyRoot, '.env')));
    assert.equal(await row('Ret overskriften').locator('.is-waiting').count(), 2); // prik og tekst
    assert.match(await page.locator('#approvals').textContent(), /samtalens kopi/);
    const approval = await page.evaluate(async () => window.harness.reply({ chat: 'ukendt', id: 'ukendt', allow: true })); assert.equal(approval.ok, false);
    for (const file of ['.env', '../udenfor.txt', '.git/config']) { const read = await page.evaluate(file => window.harness.codeRead(file), file); assert.equal(read.ok, false); }
    await shot('samtidige-godkendelser'); checks.push('to rigtige motorer venter samtidigt; godkendelsen gælder kopien, nøgler udelades, ukendt samtale afvises');
    await allow(); await row('Ret kontakten').locator('.chat-meta.is-merge').waitFor();
    assert.match(await fs.readFile(copyFile, 'utf8'), /Ny kontakt/); assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /<h1>Før<\/h1>/);
    const blocked = await page.evaluate(async () => window.harness.chatMergeReview({})); assert.equal(blocked.ok, false); assert.match(blocked.error, /Vent på opgaven/);
    await page.locator('#copy-wait:not([hidden])').waitFor();
    // Kontrollen efter opgaven genindlæser forhåndsvisningen én gang (checkPreview i ui/app.js). Vent på selve kontrollen i
    // Aktivitet, så udfyldningen nedenfor ikke nulstilles af genindlæsningen. Markøren .check-pending findes ikke længere.
    const checkedChat = await page.locator('#project-list .chat-row[aria-current="true"]').getAttribute('data-chat');
    const previewChecked = async () => (await call('activityList', { chat: checkedChat })).some(entry => entry.title === 'Kontrol af forhåndsvisningen');
    for (let n = 0; n < 300 && !await previewChecked(); n++) await wait(100);
    assert.ok(await previewChecked(), 'kontrollen af forhåndsvisningen er kørt efter opgaven i kopien');
    await page.frameLocator('#preview').locator('input').fill('Kopiens navn');
    await newChat(); await helpers.selectMode(page, 'free'); await page.fill('#prompt', 'Arbejd videre i en kopi. hold-a'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
    await page.locator('#copy-notice:not([hidden])').waitFor(); const thirdRoot = await page.locator('#copy-path').textContent();
    for (let n = 0; n < 600 && !held.size; n++) await wait(100); assert.ok(held.size);
    await switchChat('Ret overskriften', project); await page.frameLocator('#preview').locator('input').fill('Projektets navn'); await allow();
    await switchChat('Ret kontakten', copyRoot); assert.equal(await page.frameLocator('#preview').locator('input').inputValue(), 'Kopiens navn');
    await page.locator('#merge-copy:not([disabled])').waitFor(); assert.ok(held.size, 'en tredje samtale må arbejde i sin kopi under indfletningen');
    await page.click('#tab-code'); await page.locator('#code-files button[data-path="public/index.html"]').first().click();
    await page.waitForFunction(() => /Ny kontakt/.test(document.querySelector('#code-lines')?.textContent || ''), null, { timeout: 15000 }); assert.match(await page.locator('#code-lines').textContent(), /Ny kontakt/); assert.doesNotMatch(await page.locator('#code-lines').textContent(), /Projektets overskrift/);
    await page.click('#tab-preview'); checks.push('kode og preview følger kopien; formularer bevares ved samtaleskift; indfletning afvises mens projektet arbejder');
    const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(path.join(copyRoot, 'ikon.png'), icon);
    await merge(); await shot('fletning-uden-konflikt'); assert.equal(await page.isVisible('#restore-conflicts'), false);
    await page.click('#restore-confirm'); await page.locator('#restore-dialog').waitFor({ state: 'hidden' });
    assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Projektets overskrift/); assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Ny kontakt/); await assert.rejects(fs.access(copyRoot));
    assert.deepEqual(await fs.readFile(path.join(project, 'ikon.png')), icon);
    const mergedOverview = await page.evaluate(() => window.harness.changesOverview()); assert.equal(mergedOverview.value.tasks[0].changedSince, 0);
    await switchChat('Arbejd videre i en kopi', thirdRoot); assert.equal(await page.isVisible('#stop'), true); await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden' });
    await switchChat('Ret kontakten', project); checks.push('tre samtidige samtaler: indfletning venter kun på projekt og kildekopi og stopper ikke en anden kopis motor');
    await fs.appendFile(path.join(project, 'public/index.html'), '<p>Brugerens senere rettelse</p>\n');
    await page.locator('#run-review button').filter({ hasText: 'Fortryd indfletningen' }).click(); await page.locator('#restore-confirm:not([disabled])').waitFor(); assert.match(await page.locator('#restore-title').textContent(), /Fortryd indfletningen/); await page.keyboard.press('Escape');
    const journal = path.join(root, 'appdata/harness/restoration', require('node:crypto').createHash('sha256').update(project).digest('hex'), 'latest.json');
    const mergeID = JSON.parse(await fs.readFile(journal, 'utf8')).id;
    checks.push('indfletning uden konflikt bevarer projektets anden linje og rydder kopien');
    await helpers.menuClick(page, '#git-button'); await page.locator('#restore-undo:not([hidden])').waitFor(); await page.click('#restore-undo'); await page.locator('#restore-confirm:not([disabled])').waitFor(); await page.click('#restore-confirm'); await page.locator('#restore-dialog').waitFor({ state: 'hidden' });
    assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /<p>Kontakt<\/p>/); assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Brugerens senere rettelse/); checks.push('indfletningen kan fortrydes uden Git; en senere brugerrettelse bevares, og en binær fil fjernes korrekt');
    await assert.rejects(fs.access(path.join(project, 'ikon.png')));
    const reverted = await page.evaluate(() => window.harness.changesOverview());
    const revertedIcon = reverted.value.tasks[0].files.find(file => file.file === 'ikon.png');
    assert.equal(revertedIcon.binary, true); assert.equal(revertedIcon.change, 'slettet'); assert.equal(revertedIcon.by, 'dig');
    const oldUndo = await page.evaluate(expected => window.harness.restoreReview({ undo: true, expected }), mergeID); assert.equal(oldUndo.ok, false); assert.match(oldUndo.error, /afløst indfletningen/);
    // Hold den første samtale aktiv, så C får en ny kopi. Stop påvirker kun den valgte motor.
    await switchChat('Ret overskriften', project); await page.fill('#prompt', 'Vent på næste ønske. hold-a'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
    for (let n = 0; n < 600 && !held.size; n++) await wait(100); assert.ok(held.size);
    await newChat(); await send('Lav en anden overskrift. opgave-c'); const conflictRoot = await page.locator('#copy-path').textContent(); await allow();
    await fs.writeFile(path.join(project, 'public/index.html'), document('Brugerens overskrift', 'Kontakt'));
    await switchChat('Ret overskriften', project); await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden' });
    await switchChat('Lav en anden overskrift', conflictRoot); await merge(); await page.locator('#restore-conflicts:not([hidden])').waitFor();
    assert.equal(await page.locator('input[name="restore-choice"][value="ours"]').isChecked(), true); await shot('konflikt');
    await page.click('#restore-confirm'); await page.locator('#restore-dialog').waitFor({ state: 'hidden' });
    assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Brugerens overskrift/); await assert.rejects(fs.access(conflictRoot));
    checks.push('Stop rammer én samtale; konflikter viser projektets og kopiens linjer og anbefaler brugerens linjer');
    // Kopien og dens indfletningsmulighed bevares over en genstart.
    await page.fill('#prompt', 'Vent igen. hold-a'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
    await newChat(); await send('Ret kontakten igen. opgave-b'); const persisted = await page.locator('#copy-path').textContent(); await allow();
    await app.close();
    if (framework === 'astro') {
      // Kopifunktionen er fælles for frameworks. Prøv også manglende metadata i den rigtige app én gang.
      const manifest = path.join(path.dirname(persisted), 'copy.json'); await fs.rename(manifest, manifest + '.proeve');
      await launch(); await page.waitForFunction(() => document.querySelector('#resume-text').textContent.includes('Samtalekopien kan ikke læses'));
      await page.locator('#resume-notice summary').click(); await page.locator('#resume-text').filter({ hasText: 'Samtalekopien kan ikke læses' }).waitFor();
      assert.match(await fs.readFile(path.join(persisted, 'public/index.html'), 'utf8'), /Ny kontakt/);
      await assert.rejects(fs.access(path.join(path.dirname(persisted), 'creating.json')));
      await app.close(); await fs.rename(manifest + '.proeve', manifest);
    }
    await launch(); await page.locator('#copy-notice:not([hidden])').waitFor(); assert.equal(await page.locator('#copy-path').textContent(), persisted);
    await page.frameLocator('#preview').locator('h1').filter({ hasText: 'Før' }).waitFor();
    assert.match(await fs.readFile(path.join(persisted, 'public/index.html'), 'utf8'), /Ny kontakt/);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720); }); await shot('980');
    await merge(); await page.focus('#restore-confirm'); await shot('fletning-980');
    assert.ok(await page.locator('#restore-confirm').evaluate(el => { const box = el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }));
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#restore-dialog').evaluate(el => el.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'merge-copy');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(1.5); }); await page.emulateMedia({ reducedMotion: 'reduce' }); await shot('zoom');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); checks.push('uflettet kopi genåbnes efter genstart; 980 × 720, større tekst og reduceret bevægelse');
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); win.webContents.setZoomFactor(1); win.setSize(1440, 940); });
    await app.evaluate(({ dialog }) => { globalThis.copyDeletePrompts = []; dialog.showMessageBox = async (_window, options) => { globalThis.copyDeletePrompts.push(options.detail); return { response: 0 }; }; });
    const currentRow = page.locator('#project-list .chat-row[aria-current="true"]'); await currentRow.hover(); await currentRow.locator('..').locator('.chat-more').click(); await page.click('#chat-delete');
    await page.waitForFunction(() => !document.querySelector('#chat-menu').matches(':popover-open')); await wait(300);
    assert.ok(await fs.stat(persisted)); assert.match((await app.evaluate(() => globalThis.copyDeletePrompts))[0], /uflettede ændringer slettes/);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async (_window, options) => { globalThis.copyDeletePrompts.push(options.detail); return { response: 1 }; }; });
    await currentRow.hover(); await currentRow.locator('..').locator('.chat-more').click(); await page.click('#chat-delete');
    await page.waitForFunction(() => document.querySelector('#copy-notice').hidden); await assert.rejects(fs.access(persisted)); checks.push('sletning bekræfter tabet af kopiens ændringer og fjerner kopien');
    // To rigtige frameworkservere: kopiens server kan stoppes, mens projektets server fortsætter.
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'aura-kopi-proeve', private: true, type: 'module', scripts: { dev: framework === 'astro' ? 'astro dev' : 'vite' }, devDependencies: framework === 'astro' ? { astro: '7.3.5' } : { vite: '8.3.1' } }));
    await fs.mkdir(path.dirname(path.join(project, frameworkFile)), { recursive: true });
    await fs.writeFile(path.join(project, frameworkFile), document(`Projektets ${frameworkName}-side`, 'Kontakt'));
    await page.click('#tab-preview'); await page.locator('#server-open:not([hidden])').waitFor(); await page.click('#server-open');
    await page.click('#server-primary'); await page.click('#server-confirm');
    await page.locator('#server-primary').filter({ hasText: 'Gennemgå opstart' }).waitFor({ timeout: 180000 });
    await page.click('#server-primary'); await page.click('#server-confirm');
    await page.locator('#server-status').filter({ hasText: 'Forhåndsvisningen kører' }).waitFor(); await page.click('[data-close="preview-dialog"]');
    const originalURL = await page.locator('#preview').getAttribute('src'); const originalChat = await page.locator('#project-list .chat-row[aria-current="true"] .chat-title').textContent();
    await fs.writeFile(path.join(project, '.gitignore'), 'node_modules/\n.astro/\ndist/\n.env\n');
    await call('gitInit'); await call('gitIdentity', { name: 'Prøvebruger', email: 'proeve@example.invalid' });
    const firstVersion = await call('gitSave', { note: 'Projekt før samtidige opgaver' }); assert.ok(firstVersion.head);
    await call('gitAutomatic', true);
    await page.fill('#prompt', 'Hold projektet åbent. hold-a'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(e => e.open)) await page.click('#accept-send');
    for (let n = 0; n < 600 && !held.size; n++) await wait(100); assert.ok(held.size);
    await newChat(); await send(`Ret ${frameworkName}-siden i en kopi. opgave-b`); const frameworkRoot = await page.locator('#copy-path').textContent(); await allow();
    await page.click('#server-open');
    // På platforme uden filkloner installeres pakkerne i kopien gennem samme gennemgang.
    if (await page.locator('#server-primary').textContent() === 'Gennemgå installation') {
      await page.click('#server-primary'); await page.click('#server-confirm'); await page.locator('#server-primary').filter({ hasText: 'Gennemgå opstart' }).waitFor({ timeout: 180000 });
    }
    await page.click('#server-primary'); await page.click('#server-confirm'); await page.locator('#server-status').filter({ hasText: 'Forhåndsvisningen kører' }).waitFor(); await page.click('[data-close="preview-dialog"]');
    const copyURL = await page.locator('#preview').getAttribute('src'); assert.notEqual(new URL(copyURL).port, new URL(originalURL).port);
    await page.frameLocator('#preview').locator('h1').filter({ hasText: 'Før' }).waitFor(); assert.ok((await (await fetch(originalURL)).text()).includes(`Projektets ${frameworkName}-side`));
    const denied = await page.frameLocator('#preview').locator('body').evaluate((_el, other) => new Promise(resolve => {
      const target = other.replace(/^http/, 'ws'); let ws;
      const finish = value => { clearTimeout(timer); document.removeEventListener('securitypolicyviolation', violation); ws?.close(); resolve(value); };
      const violation = event => { if (event.blockedURI.startsWith(new URL(target).origin)) finish(event.effectiveDirective); };
      const timer = setTimeout(() => finish('ingen afvisning fra CSP'), 3000); document.addEventListener('securitypolicyviolation', violation);
      try { ws = new WebSocket(target); ws.onopen = () => finish('forbindelsen blev åbnet'); } catch (error) { if (error.name !== 'SecurityError') finish(error.name); }
    }), originalURL);
    assert.equal(denied, 'connect-src', 'kopiens CSP afviser WebSocket til projektets anden server');
    assert.match(await fs.readFile(path.join(frameworkRoot, frameworkFile), 'utf8'), /Ny kontakt/);
    await shot(framework + '-kopi');
    await page.locator('#project-list .chat-row[aria-current="true"]').hover(); await page.locator('#project-list .chat-row[aria-current="true"]').locator('..').locator('.chat-more').click(); await page.click('#chat-delete');
    await page.waitForFunction(root => document.querySelector('#preview')?.dataset.root === root, project); await assert.rejects(fs.access(frameworkRoot));
    for (let n = 0; n < 40; n++) { try { await fetch(copyURL, { signal: AbortSignal.timeout(300) }); await wait(100); } catch { break; } if (n === 39) throw new Error('Kopiens server svarer efter sletning.'); }
    assert.ok((await fetch(originalURL)).ok, 'projektets server fortsætter, når kopiens server stoppes');
    // Gennemgå også en indfletning, efter at frameworket faktisk har kørt i kopien.
    await newChat(); await send(`Flet ${frameworkName}-rettelsen ind. opgave-b`); const mergeRoot = await page.locator('#copy-path').textContent(); await allow();
    const mergeTitle = await page.locator('#project-list .chat-row[aria-current="true"] .chat-title').textContent();
    await page.click('#server-open');
    if (await page.locator('#server-primary').textContent() === 'Gennemgå installation') {
      await page.click('#server-primary'); await page.click('#server-confirm'); await page.locator('#server-primary').filter({ hasText: 'Gennemgå opstart' }).waitFor({ timeout: 180000 });
    }
    await page.click('#server-primary'); await page.click('#server-confirm');
    await page.locator('#server-status').filter({ hasText: 'Forhåndsvisningen kører' }).waitFor(); await page.click('[data-close="preview-dialog"]');
    const mergeURL = await page.locator('#preview').getAttribute('src'); await page.frameLocator('#preview').locator('h1').filter({ hasText: 'Før' }).waitFor();
    await switchChat(originalChat, project); await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden' });
    // Deling fra en rigtig uflettet kopi bruger altid projektets gemte version.
    await app.evaluate(async(_,modulePath)=>{const {VercelDeployment}=process.mainModule.require(modulePath);VercelDeployment.prototype.inspect=async()=>({id:'prj_copy_share',name:'Projektets test',access:'Ikke afprøvet',environmentKeys:[],portal:'https://vercel.com/test/copy'});VercelDeployment.prototype.deploy=async()=>{throw Error('Kopiprøven må aldrig uploade');};},path.resolve(__dirname,'../core/deployment-providers.cjs'));
    await switchChat(mergeTitle, mergeRoot);
    const shareState=await call('deploymentState');assert.equal(shareState.context.viewingCopy,true);assert.ok(shareState.context.copyCount>=1);
    const shareReview=await call('deploymentReview',{provider:'vercel',project:'copy-test',scope:'test',mode:'source',directory:'.'});
    const originalArtifact=await require('../core/deployment-artifact.cjs').deploymentArtifact(project,'.');
    assert.equal(shareReview.head,originalArtifact.head);assert.equal(shareReview.hash,originalArtifact.hash);assert.equal(shareReview.context.viewingCopy,true);
    assert.match(await fs.readFile(path.join(mergeRoot,frameworkFile),'utf8'),/Ny kontakt/);assert.ok(!(await fs.readFile(path.join(project,frameworkFile),'utf8')).includes('Ny kontakt'));
    await switchChat(originalChat, project);
    checks.push('deling gennem IPC fra en uflettet kopi viser kopiens afgrænsning og pakker alene projektets gemte Git-version; ingen upload');
    await fs.appendFile(path.join(project, frameworkFile), '<!-- Brugerens ugemte rettelse -->\n');
    // Forsink afslutningen af den rigtige filindlæsning, mens brugeren vælger indfletningen med tastaturet.
    // Hovedprocessen og materialet er uændrede; kun rendererens ventetid styres, så fokusræset kan gentages.
    await page.evaluate(() => {
      window.copyOriginalOnChat = window.workspace.onChat;
      window.workspace.onChat = async (...args) => { await window.copyOriginalOnChat(...args); await new Promise(resolve => { window.copyReleaseOnChat = resolve; }); };
    });
    await switchChat(mergeTitle, mergeRoot); await page.waitForFunction(() => typeof window.copyReleaseOnChat === 'function');
    await page.locator('#merge-copy:not([disabled])').waitFor(); await page.focus('#merge-copy');
    await page.evaluate(() => { window.workspace.onChat = window.copyOriginalOnChat; window.copyReleaseOnChat(); });
    await wait(100); assert.equal(await page.evaluate(() => document.activeElement.id), 'merge-copy', 'sen filindlæsning må ikke flytte brugerens fokus fra indfletningsknappen');
    await merge();
    await shot(framework + '-fletning'); await page.click('#restore-confirm'); await page.locator('#restore-dialog').waitFor({ state: 'hidden' });
    assert.match(await fs.readFile(path.join(project, frameworkFile), 'utf8'), /Ny kontakt/); await assert.rejects(fs.access(mergeRoot));
    assert.match(await fs.readFile(path.join(project, frameworkFile), 'utf8'), /Brugerens ugemte rettelse/);
    assert.ok((await fetch(originalURL)).ok, 'projektets server fortsætter efter indfletning');
    await assert.rejects(fetch(mergeURL, { signal: AbortSignal.timeout(300) }));
    await page.locator('#message:not([hidden])').waitFor();
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); win.setSize(980, 720); win.webContents.setZoomFactor(1.5); });
    await shot(framework + '-status-zoom');
    assert.equal(await page.locator('#send').evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.bottom <= innerHeight && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
    }), true, 'statusbeskeden hverken dækker Send eller skubber den uden for vinduet ved større tekst');
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); win.webContents.setZoomFactor(1); win.setSize(1440, 940); });
    checks.push(`${frameworkName}-rettelsen flettes fra en kørende kopi ind i projektet, og kun kopiens server stoppes`);
    // waitForFunction i den fastlåste Playwright behandler en Promise som sand og gentager ikke ved false.
    // Afvent derfor IPC-kaldet og kontrollér de faktiske billeder ved hvert forsøg.
    let versions;
    for (let n = 0; n < 180; n++) { versions = await call('gitStatus'); if (/^Flettet ind:/.test(versions.history[0]?.message || '') && versions.history[0].image && versions.history[1]?.image) break; await wait(250); }
    const mergedVersion = versions.history[0]; assert.ok(mergedVersion?.image && versions.history[1]?.image, 'begge gemte versioners billeder skal faktisk være klar');
    assert.equal(versions.history[1].message, 'Dine ændringer før indfletningen');
    const detail = await call('historyVersion', mergedVersion.commit), overview = await call('changesOverview');
    assert.ok(detail.images.before && detail.images.after); assert.deepEqual(detail.images.before.view, detail.images.after.view);
    assert.equal(overview.tasks[0].images.after.id, detail.images.after.id);
    const beforeImage = await call('historyImage', detail.images.before.id), afterImage = await call('historyImage', detail.images.after.id);
    assert.notEqual(beforeImage, afterImage, 'før-billedet viser det oprindelige projekt, efter-billedet det faktisk flettede projekt');
    await fs.writeFile(path.join(root, framework + '-version-foer.jpg'), Buffer.from(beforeImage.split(',')[1], 'base64'));
    await fs.writeFile(path.join(root, framework + '-version-efter.jpg'), Buffer.from(afterImage.split(',')[1], 'base64'));
    await helpers.menuClick(page, '#git-button');
    await page.locator('#git-history .version-row').first().locator('img[src^="data:image/jpeg"]').waitFor();
    await page.locator('#git-history .version-row').first().click();
    await page.locator('#version-detail img[src^="data:image/jpeg"]').first().waitFor(); await shot(framework + '-version');
    checks.push('indfletning gemmer brugerens ugemte rettelse først og en ny version bagefter; begge får billeder, og det faktiske før/efter-par vises i historikken og samtalen');
    if (await row(originalChat).count()) await switchChat(originalChat, project);
    if (await page.isVisible('#stop')) { await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden' }); }
    checks.push(`rigtige ${frameworkName}-servere for projekt og kopi bruger forskellige porte; kopi og server ryddes, mens projektets server fortsætter; WebSocket til den anden server afvises`);
    await newChat(); await helpers.selectMode(page, 'free'); await page.fill('#prompt', 'Stop under opstart. hold-a'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.click('#stop'); await page.locator('#stop').waitFor({ state: 'hidden' }); await wait(1000);
    assert.equal(await page.locator('#run-status').textContent(), 'Stoppet'); checks.push('Stop under opstart bliver ved med at være Stoppet og vises ikke som en fejl');
    assert.deepEqual(errors, []); assert.ok(singleImageChecks > 0, 'gennemgangen af ét billede uden modstykke skal faktisk være afprøvet'); await fs.writeFile(path.join(root, 'maalinger.json'), JSON.stringify(measurements, null, 2)); console.log(JSON.stringify({ status: 'bestået', root, checks, requests: requests.length, singleImageChecks, measurements }, null, 1));
  } catch (error) { await shot('fejl').catch(() => {}); console.error('Testmateriale: ' + root); console.error(error); console.error('Skærmstatus:', await page.evaluate(() => ({ focus: document.activeElement?.id, mergeDisabled: document.querySelector('#merge-copy')?.disabled, dialog: document.querySelector('#restore-dialog')?.open, message: document.querySelector('#message')?.textContent, status: document.querySelector('#run-status')?.textContent })).catch(() => null)); console.error('Serverens log:', await page.locator('#server-log').textContent().catch(() => 'ikke tilgængelig')); await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(requests)); throw error; }
  finally { for (const release of held) release(); await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
