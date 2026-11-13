// Rettelser i forhåndsvisningen i Electron: Ret i siden med statisk HTML, React med Vite og Astro. Prøven bruger den
// rigtige OpenCode-motor med en kontrolleret lokal modelserver og rigtige projektfiler i en ny midlertidig mappe uden
// Git, så den opretter ingen versioner. Den gennemgår, at sidens klik er blokeret, mens man vælger, at isolationen er
// den samme, tekstrettelse og Fortryd byte for byte, begrundelser, når Aura ikke retter selv, en mulig nøgle i siden,
// tastatur, genindlæsning, målrettet AI-ændring gennem Før du sender med Fortryd uden version, 980 × 720, større tekst
// og reduceret bevægelse. Frameworkdelen installerer rigtige npm-pakker og kan springes over med AURA_SKIP_FRAMEWORKS=1.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-ret-i-siden-')));
  const project = path.join(root, 'Lokaler');
  // Den mulige nøgle sættes sammen i siden, så filen selv ikke ligner en nøglefil.
  const page0 = ['<!doctype html>', '<html lang="da"><head><meta charset="utf-8"><title>Lokaler</title>', '<style>body{font:16px system-ui;margin:32px}button{padding:10px 18px}</style></head><body><main>', '<h1>', '  Find et lokale', '</h1>', '<p id="intro">Tre lokaler &amp; et køkken.</p>',
    '<section id="liste"><h2>Sale</h2><ul><li>Lille sal</li><li>Lille sal</li></ul></section>', '<button onclick="document.body.dataset.klik = \'ja\'">Book</button>', '<a href="https://example.com/">Læs mere</a>', '<p id="hemmelig"></p>', '</main>',
    '<script>document.getElementById("hemmelig").textContent = "Nøgle: " + ["sk", "ant", "abcdefghijklmnopqrstuvwxyz123456"].join("-");', 'document.querySelector("h2").textContent = "Sale";</script>', '</body></html>', ''].join('\n');
  await fs.mkdir(path.join(project, 'public'), { recursive: true }); await fs.writeFile(path.join(project, 'public/index.html'), page0);
  const lineOf = text => page0.split('\n').findIndex(line => line.includes(text)) + 1;

  // Modelserveren: RET AFSNIT skriver afsnittet om og svarer derefter. Alle anmodninger gemmes.
  const requests = [];
  const changed = page0.replace('Tre lokaler &amp; et køkken.', 'Tre lyse lokaler, et køkken og en terrasse.');
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'ret-model', name: 'Kontrolleret model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const text = m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lastUser = body.messages.findLastIndex(m => m.role === 'user'), last = lastUser >= 0 ? text(body.messages[lastUser]) : '';
    const tools = body.messages.slice(lastUser).filter(m => m.role === 'tool').length;
    const step = !body.tools?.length ? { text: 'Titel' } : last.includes('RET AFSNIT') && tools === 0 ? { tool: 'write', args: { filePath: path.join(project, 'public/index.html'), content: changed } } : { text: 'Jeg skrev afsnittet om i public/index.html.' };
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
  const frame = () => page.frameLocator('#preview');
  // Forhåndsvisningen serveres gennem appens eget aura-preview-skema; ældre bygninger brugte en localhost-adresse.
  const previewFrame = () => page.frames().find(f => f !== page.mainFrame() && /^(aura-preview:|http:\/\/127\.0\.0\.1)/.test(f.url()));
  const pressed = () => page.locator('#preview-pick').getAttribute('aria-pressed');
  const card = () => page.locator('#pick-card');
  const pick = async (locator, title) => { await locator.click(); await page.locator('#pick-title').filter({ hasText: title }).waitFor(); return card().innerText(); };
  const file = () => fs.readFile(path.join(project, 'public/index.html'), 'utf8');
  async function open(folder) {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.click('#open'); await page.waitForFunction(folder => document.querySelector('#project-path').textContent === folder, folder);
  }
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page);
    await open(project);
    await frame().locator('h1').filter({ hasText: 'Find et lokale' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#preview-pick').hidden && !document.querySelector('#preview-pick').disabled);
    assert.equal(await pressed(), 'false'); assert.equal(await page.locator('#pick-hint').isVisible(), false);
    assert.equal(await previewFrame().evaluate(() => document.querySelectorAll('[data-aura-markering]').length), 0, 'intet valgscript, før brugeren slår det til');
    passed('Ret i siden er slået fra, indtil brugeren vælger det, og der indsættes intet i siden før');

    // Slå til: knappen er trykket ned, hjælpen vises, og forhåndsvisningen har fokus til tastaturet.
    const sandboxBefore = await page.locator('#preview').getAttribute('sandbox');
    await page.click('#preview-pick');
    await page.waitForFunction(() => document.querySelector('#preview-pick').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#pick-hint').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preview');
    assert.equal(await page.locator('#preview').getAttribute('sandbox'), sandboxBefore, 'sandboxen er uændret, når Ret i siden slås til');
    assert.equal(await previewFrame().evaluate(() => document.querySelectorAll('[data-aura-markering]').length), 1);
    assert.equal(await previewFrame().evaluate(() => Object.keys(window).some(key => key.startsWith('__aura_'))), false, 'valgscriptets nøgle kan ikke tælles op');
    assert.equal(await previewFrame().evaluate(() => typeof window.harness), 'undefined', 'siden får ingen adgang til Aura');
    // Indholdspolitikken sættes af forhåndsvisningens egen session, som afviser kald udefra; den er enhedstestet i
    // tests/preview.test.cjs og tests/project-runtime.test.cjs. Her måles, at tilstanden ikke ændrer sandboxen.
    passed('Ændringstilstanden ændrer ikke sandbox eller Auras adgang; valgscriptet ligger kun i siden, mens den er slået til');

    // Sidens egne klik og links reagerer ikke, mens man vælger. Valget viser et forståeligt navn og kilden.
    const urlBefore = previewFrame().url();
    let text = await pick(frame().locator('button'), 'Knap');
    assert.equal(await previewFrame().evaluate(() => document.body.dataset.klik || ''), '', 'knappens onclick kørte ikke');
    assert.match(text, /»Book«/); assert.match(text, new RegExp(`public/index\\.html, linje ${lineOf('>Book<')}`));
    text = await pick(frame().locator('a'), 'Link');
    assert.equal(previewFrame().url(), urlBefore, 'linket blev ikke fulgt');
    text = await pick(frame().locator('h1'), 'Overskrift');
    assert.match(text, /»Find et lokale«/); assert.match(text, new RegExp(`I koden: public/index\\.html, linje ${lineOf('Find et lokale')}\\.`));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pick-title');
    assert.equal(await page.locator('#pick-edit').isVisible(), true); assert.equal(await page.locator('#pick-ai').isVisible(), true);
    assert.equal(await card().locator('button:visible:not(.file-ref)').count(), 3, 'luk, Ret teksten og Bed AI’en ændre det; filnavnet er et link');
    await capture('valgt.png');
    passed('Sidens knapper og links reagerer ikke, mens man vælger; kortet viser navn, tekst og linjen i koden med to veje videre');

    // Tekstrettelse: kun teksten ændres i filen, forhåndsvisningen viser den, og Fortryd giver filen byte for byte tilbage.
    await page.click('#pick-edit');
    assert.equal(await page.locator('#pick-value').inputValue(), 'Find et lokale');
    await page.fill('#pick-value', 'Book et mødelokale'); const saved = Date.now(); await page.press('#pick-value', 'Enter');
    await page.locator('#pick-result-text').filter({ hasText: `Rettet i public/index.html, linje ${lineOf('Find et lokale')}.` }).waitFor();
    await page.locator('#pick-check.check-ok').filter({ hasText: 'Forhåndsvisningen viser den nye tekst.' }).waitFor({ timeout: 30000 });
    console.log(`  Forhåndsvisningen viste rettelsen efter ${Date.now() - saved} ms`);
    assert.equal(await file(), page0.replace('  Find et lokale', '  Book et mødelokale'));
    await frame().locator('h1').filter({ hasText: 'Book et mødelokale' }).waitFor();
    await capture('rettet.png');
    await page.click('#pick-diff');
    assert.equal(await page.locator('.work-tab[aria-selected="true"]').getAttribute('data-tab'), 'changes');
    await page.locator('#changes-heading').filter({ hasText: '1 fil ændret af dig' }).waitFor();
    assert.equal(await page.locator('#changes-files .by-tag').first().textContent(), 'Dig');
    assert.match(await page.locator('#changes-diff-lines').innerText(), /Book et mødelokale/);
    await page.click('#tab-activity'); await page.locator('#activity-list').filter({ hasText: 'Du rettede en tekst i forhåndsvisningen' }).waitFor();
    await page.click('#tab-preview');
    assert.equal(await card().isVisible(), true, 'kortet med Fortryd står der stadig');
    await page.click('#pick-undo');
    await page.locator('#pick-result-text').filter({ hasText: 'Fortrudt. Teksten i public/index.html er sat tilbage.' }).waitFor();
    await page.locator('#pick-check.check-ok').filter({ hasText: 'oprindelige tekst' }).waitFor({ timeout: 30000 });
    assert.equal(await file(), page0, 'filen er byte for byte som før');
    passed('Tekstrettelsen ændrer kun teksten i filen, ses i forhåndsvisningen, står under Ændringer og Aktivitet som din, og Fortryd giver filen byte for byte tilbage');

    // Kontrollen kan slå fejl: sidens eget script skriver overskriften tilbage, så rettelsen står i filen, men ikke i siden.
    await pick(frame().locator('h2'), 'Overskrift');
    await page.click('#pick-edit'); await page.fill('#pick-value', 'Haller'); await page.press('#pick-value', 'Enter');
    await page.locator('#pick-check.check-unknown').filter({ hasText: 'Filen er gemt, men forhåndsvisningen viser det ikke endnu.' }).waitFor({ timeout: 20000 });
    assert.match(await file(), /<h2>Haller<\/h2>/);
    await page.click('#pick-undo'); await page.locator('#pick-check.check-ok').filter({ hasText: 'oprindelige tekst' }).waitFor({ timeout: 30000 });
    assert.equal(await file(), page0);
    passed('Kontrollen siger det, når forhåndsvisningen ikke viser rettelsen, her fordi sidens eget script skriver teksten tilbage');

    // Når Aura ikke kan rette selv, står begrundelsen, og AI'en er den anbefalede vej.
    text = await pick(frame().locator('li').first(), 'Punkt på en liste');
    assert.match(text, /Teksten står flere steder i koden/); assert.equal(await page.locator('#pick-edit').isVisible(), false);
    assert.match(await page.locator('#pick-ai').getAttribute('class'), /primary/);
    text = await pick(frame().locator('section'), 'Sektion');
    assert.match(text, /Elementet indeholder andre elementer/);
    text = await pick(frame().locator('#hemmelig'), 'Afsnit');
    assert.match(text, /Indholdet vises ikke, fordi det kan indeholde en nøgle eller adgangskode/); assert.doesNotMatch(text, /sk-ant/);
    passed('Flere forekomster, et element med andre elementer og en mulig nøgle rettes ikke direkte; kortet siger hvorfor, og nøglen vises ikke');

    // Tastatur: Escape i siden afslutter og fjerner valgscriptet. Enter slår til igen, pil ned og Enter vælger.
    await page.locator('#preview').focus(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#preview-pick').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preview-pick');
    assert.equal(await card().isVisible(), false);
    assert.equal(await previewFrame().evaluate(() => document.querySelectorAll('[data-aura-markering]').length), 0, 'valgscriptet er fjernet igen');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#preview-pick').getAttribute('aria-pressed') === 'true');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.locator('#pick-title').filter({ hasText: 'Overskrift' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pick-title');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'pick-close');
    passed('Tastatur: Escape afslutter og fjerner scriptet, Enter slår til, pil ned og Enter vælger, og fokus flytter til kortet');

    // Genindlæsning i ændringstilstand: valgscriptet indsættes igen i den nye side.
    await page.click('#refresh');
    await frame().locator('h1').waitFor(); await frame().locator('[data-aura-markering]').waitFor({ state: 'attached' });
    await assert.doesNotReject(pick(frame().locator('#intro'), 'Afsnit'));
    assert.equal(await previewFrame().evaluate(() => document.body.dataset.klik || ''), '');
    passed('Efter en genindlæsning kan man stadig vælge, og siden reagerer stadig ikke på klik');

    // Målrettet AI-ændring: målet står over skrivefeltet, i Før du sender og i beskeden til AI'en.
    await helpers.addConnection(page, { name: 'Kontrolleret', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');
    if (await pressed() !== 'true') await page.click('#preview-pick');
    await pick(frame().locator('#hemmelig'), 'Afsnit');
    await page.click('#pick-ai');
    const secretData = (await page.evaluate(async () => window.harness.prepare(selection()))).value;
    assert.doesNotMatch(JSON.stringify(secretData), /sk-ant/); assert.match(secretData.previewReferenceText, /udeladt, fordi det kan indeholde en nøgle/);
    await page.click('#composer-refs .target-chip button');
    await page.click('#preview-pick'); await pick(frame().locator('#intro'), 'Afsnit');
    await page.click('#pick-ai');
    assert.equal(await pressed(), 'false'); assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt');
    const target = `Afsnit »Tre lokaler & et køkken.«`;
    assert.equal(await page.locator('#composer-refs .target-chip span').textContent(), `Mål: ${target}`);
    assert.match(await page.locator('#prompt').getAttribute('placeholder'), /Hvad skal AI’en ændre her/);
    await page.fill('#prompt', 'RET AFSNIT, så det nævner terrassen'); await page.click('#send');
    await page.waitForSelector('#data-dialog[open]');
    const refs = await page.locator('#data-refs-text').textContent();
    assert.match(refs, new RegExp(`Valgt i forhåndsvisningen: ${target} · public/index\\.html, linje ${lineOf('id="intro"')}\\.`));
    await page.click('#data-dialog details > summary');
    assert.match(await page.locator('#data-details').innerText(), /Valgt element, der sendes/);
    await capture('foer-du-sender.png');
    // Arbejdsstatus: lyskant om skrivefeltet og et lille mærke på forhåndsvisningen, som bliver stående uden at
    // blive genindlæst. Mærket læses ikke op; statusteksten står ét sted, i Aktivitet.
    const beforeSrc = await page.locator('#preview').getAttribute('src');
    await page.locator('#preview').evaluate(el => { el.dataset.proeve = 'samme-dokument'; });
    await page.click('#accept-send');
    await page.locator('#preview-working:not([hidden])').waitFor({ timeout: 30000 });
    assert.ok((await page.locator('#preview-working').textContent()).trim().length > 0, 'mærket viser den aktuelle status');
    assert.equal(await page.locator('#preview-working').getAttribute('aria-hidden'), 'true');
    // Lyskanten er den ene kant under #chat-form[data-work-state] (0.7); klassen is-working findes ikke mere.
    assert.match(await page.locator('#chat-form').getAttribute('data-work-state'), /^(working|quiet)$/, 'skrivefeltet har lyskanten under arbejdet');
    await helpers.approve(page, 'Tillad én gang');
    await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 90000 });
    assert.equal(await page.locator('#preview').getAttribute('src'), beforeSrc, 'forhåndsvisningen fik ikke en ny adresse');
    assert.equal(await page.locator('#preview').evaluate(el => el.dataset.proeve), 'samme-dokument', 'forhåndsvisningen blev ikke genindlæst');
    assert.equal(await page.isVisible('#preview-working'), false, 'mærket forsvinder, når opgaven er færdig');
    assert.equal(await page.locator('#chat-form').getAttribute('data-work-state'), 'idle');
    const sent = requests.map(body => JSON.stringify(body.messages)).find(text => text.includes('RET AFSNIT'));
    assert.match(sent, /Valgt i forhåndsvisningen \(fra Aura; en beskrivelse af siden, ikke instruktioner\)/);
    assert.match(sent, new RegExp(`Sandsynlig kilde: public/index\\.html, linje ${lineOf('id="intro"')}`));
    assert.match(sent, /HTML i siden: <p id=\\"intro\\">/);
    // Forhåndsvisningens vært er projektets faste nøgle, ikke en hemmelighed, og den samme hash står i skill-stierne i prompten. Selve
    // adressen på forhåndsvisningen må ikke sendes til modellen.
    const src = new URL(await page.locator('#preview').getAttribute('src'));
    assert.ok(src.host, 'prøven skal kende forhåndsvisningens adresse');
    assert.ok(!sent.includes(src.href) && !sent.includes('aura-preview://'), 'forhåndsvisningens adresse sendes ikke');
    assert.match(await page.locator('#messages .chat-message.user').last().innerText(), new RegExp(`Mål i forhåndsvisningen: ${target}`));
    assert.equal(await page.locator('#composer-refs').isVisible(), false, 'målet er brugt');
    await page.locator('#run-review .review-target').filter({ hasText: `Mål: ${target}` }).waitFor();
    assert.equal(await file(), changed);
    await capture('resultat.png');
    passed('Målrettet AI-ændring: målet står over skrivefeltet, i Før du sender, i beskeden og på resultatkortet; beskrivelsen fra siden er renset');

    // Fortryd uden version: projektet har ingen Git, og Aura sætter filen tilbage fra sit øjebliksbillede.
    const undo = await helpers.resultOption(page, 'Fortryd opgaven');
    await undo.click(); await page.waitForSelector('#restore-dialog[open]'); await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled);
    assert.match(await page.locator('#restore-outcomes').innerText(), /public\/index\.html · Sættes tilbage/);
    await page.click('#restore-confirm'); await page.waitForSelector('#restore-dialog:not([open])', { state: 'attached' });
    assert.equal(await file(), page0);
    await page.click('#tab-changes'); await page.locator('#changes-heading').filter({ hasText: '1 fil ændret af dig' }).waitFor();
    // En fil, der er ændret siden, fortrydes ikke: brugeren får grunden, og intet ændres.
    const before = await page.evaluate(() => window.harness.changesOverview()).then(r => r.value.tasks.find(task => task.kind === 'ai'));
    const refused = await page.evaluate(id => window.harness.changesUndo({ task: id }), before.id);
    assert.match(refused.error, /allerede fortrudt/);
    passed('Fortryd uden version sætter filen tilbage fra Auras øjebliksbillede, står som din og kan ikke gentages');

    // 980 × 720, større tekst og reduceret bevægelse.
    await page.click('#tab-preview');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720)); await page.waitForTimeout(500);
    await page.click('#preview-pick'); await pick(frame().locator('h1'), 'Overskrift');
    const layout = async () => page.evaluate(() => {
      const panel = document.querySelector('#panel-preview').getBoundingClientRect(), box = document.querySelector('#pick-card').getBoundingClientRect(), toggle = document.querySelector('#preview-pick').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, cardInside: box.left >= panel.left - 1 && box.right <= panel.right + 1 && box.bottom <= panel.bottom + 1 && box.top >= panel.top, toggleInside: toggle.right <= panel.right && toggle.width > 0 };
    });
    let measured = await layout();
    assert.deepEqual(measured, { overflow: false, cardInside: true, toggleInside: true });
    await capture('980x720.png');
    for (const zoom of [1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(zoom), zoom); await page.waitForTimeout(600);
      measured = await layout();
      assert.equal(measured.overflow, false, `vandret rulning ved ${zoom}`); assert.ok(measured.cardInside, `kortet uden for panelet ved ${zoom}`); assert.ok(measured.toggleInside, `knappen uden for ved ${zoom}`);
      await capture(`980x720-zoom-${zoom * 100}.png`);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(1));
    // Mobilvisningen skaleres ned i panelet; et klik rammer stadig det element, man ser.
    await page.selectOption('#viewport-preset', 'phone');
    // Rammen kører i sin egen proces, så siden indeni får den nye bredde lidt efter rammen (se verify-desktop.cjs).
    await previewFrame().evaluate(() => new Promise(resolve => { const done = () => innerWidth === 390 ? resolve() : requestAnimationFrame(done); done(); setTimeout(resolve, 10000); }));
    assert.ok(await page.locator('#preview').evaluate(el => /scale\(0\./.test(el.style.transform)), 'visningen er skaleret');
    // Museklikket sendes til vinduet på det sted, knappen ses, så prøven bruger browserens egen omregning af skaleringen.
    const box = await page.locator('#preview').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, scale: r.width / el.offsetWidth }; });
    const inner = await previewFrame().evaluate(() => { const r = document.querySelector('button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(box.x + inner.x * box.scale, box.y + inner.y * box.scale);
    await page.locator('#pick-title').filter({ hasText: 'Knap' }).waitFor();
    assert.match(await card().innerText(), /»Book«/);
    await page.selectOption('#viewport-preset', 'fluid');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#pick-close'); await pick(frame().locator('#intro'), 'Afsnit');
    assert.equal(await card().evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.click('#preview-pick'); assert.equal(await pressed(), 'false');
    passed('980 × 720 uden vandret rulning; kortet og knappen står i panelet ved 125 % og 150 % tekst; valg virker i den skalerede mobilvisning; reduceret bevægelse slår kortets animation fra');

    if (process.env.AURA_SKIP_FRAMEWORKS === '1') console.log('– React og Astro sprunget over (AURA_SKIP_FRAMEWORKS=1)');
    else await frameworks();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: checks.length }, null, 2));
  } catch (error) {
    console.error(error);
    try { await page?.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }); console.error('Skærmbillede:', path.join(root, 'fejl.png')); console.error(JSON.stringify(await page?.evaluate(async () => ({ polling, revision, next: (await window.harness.revision()).value, src: document.querySelector('#preview').src })))); console.error(await page?.locator('#message').textContent({ timeout: 1000 })); console.error('Serverens log:', await page?.locator('#server-log').textContent({ timeout: 1000 })); } catch {}
    process.exitCode = 1;
  } finally { await app?.close(); server.closeAllConnections(); server.close(); }

  // React med Vite og Astro: rigtige pakker, rigtig udviklingsserver og opdatering uden genindlæsning (HMR).
  async function frameworks() {
    const react = path.join(root, 'React med mellemrum'), astro = path.join(root, 'Astro med mellemrum');
    const appSource = `import React from 'react';\nexport default function App(){const [n,setN]=React.useState(0);return <main><h1>Bibliotekets aktiviteter</h1><p>Et konkret React-projekt</p><button onClick={()=>setN(n+1)}>Tilmeld {n}</button></main>}\n`;
    await fs.mkdir(path.join(react, 'src'), { recursive: true }); await fs.mkdir(path.join(astro, 'src/pages'), { recursive: true });
    await fs.writeFile(path.join(react, 'package.json'), JSON.stringify({ name: 'aura-ret-react', private: true, type: 'module', scripts: { dev: 'vite' }, dependencies: { react: '19.3.0', 'react-dom': '19.3.0' }, devDependencies: { vite: '8.3.1', typescript: '5.9.3' } }));
    await fs.writeFile(path.join(react, 'index.html'), '<!doctype html><html lang="da"><meta charset="utf-8"><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>');
    await fs.writeFile(path.join(react, 'src/main.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import App from './App';createRoot(document.getElementById('root')!).render(<App/>);`);
    await fs.writeFile(path.join(react, 'src/App.tsx'), appSource);
    await fs.writeFile(path.join(astro, 'package.json'), JSON.stringify({ name: 'aura-ret-astro', private: true, type: 'module', scripts: { dev: 'astro dev' }, dependencies: { astro: '7.3.5' } }));
    const astroPage = '---\nconst sted = "Rådhuset";\n---\n<!doctype html><html lang="da"><meta charset="utf-8"><body>\n<h1>Kommunens kalender</h1>\n<p>Møder i {sted}</p>\n</body></html>\n';
    await fs.writeFile(path.join(astro, 'src/pages/index.astro'), astroPage);
    async function startServer(folder) {
      await open(folder); await page.waitForSelector('#server-open:not([hidden])');
      assert.equal(await page.locator('#preview-pick').isVisible(), false, 'Ret i siden er skjult uden en side');
      await page.click('#server-open');
      await page.click('#server-primary'); await page.click('#server-confirm');
      await page.waitForFunction(() => document.querySelector('#server-primary').textContent === 'Gennemgå opstart' && !document.querySelector('#server-primary').hidden, null, { timeout: 240000 });
      await page.click('#server-primary'); await page.click('#server-confirm');
      await page.locator('#server-status').filter({ hasText: 'Forhåndsvisningen kører' }).waitFor({ timeout: 90000 });
      await page.click('[data-close="preview-dialog"]');
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(1440, 940));
    await page.emulateMedia({ reducedMotion: null });
    await startServer(react);
    await frame().locator('h1').filter({ hasText: 'Bibliotekets aktiviteter' }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#preview').getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-forms', 'udviklingsserverens sandbox er uændret');
    await page.waitForFunction(() => !document.querySelector('#preview-pick').hidden);
    await page.click('#preview-pick');
    let text = await pick(frame().locator('button'), 'Knap');
    assert.match(text, /»Tilmeld 0«/); assert.match(text, /fandt ikke teksten/, 'teksten sættes sammen i koden');
    assert.equal(await frame().locator('button').textContent(), 'Tilmeld 0', 'Reacts klik kørte ikke');
    text = await pick(frame().locator('p'), 'Afsnit');
    assert.match(text, /I koden: src\/App\.tsx, linje 2\./);
    await page.click('#pick-edit'); await page.fill('#pick-value', 'Et rettet React-projekt'); await page.click('#pick-form button[type=submit]');
    await page.locator('#pick-check.check-ok').waitFor({ timeout: 30000 });
    assert.equal(await fs.readFile(path.join(react, 'src/App.tsx'), 'utf8'), appSource.replace('Et konkret React-projekt', 'Et rettet React-projekt'));
    await frame().locator('p').filter({ hasText: 'Et rettet React-projekt' }).waitFor();
    await page.click('#pick-undo'); await page.locator('#pick-check.check-ok').filter({ hasText: 'oprindelige tekst' }).waitFor({ timeout: 30000 });
    assert.equal(await fs.readFile(path.join(react, 'src/App.tsx'), 'utf8'), appSource);
    await capture('react.png');
    passed('React med Vite: valg i den rigtige udviklingsserver, JSX-tekst rettet i src/App.tsx og vist med HMR, Fortryd byte for byte; sammensat tekst rettes ikke direkte');
    await page.click('#preview-pick');
    await startServer(astro);
    await frame().locator('h1').filter({ hasText: 'Kommunens kalender' }).waitFor({ timeout: 30000 });
    await page.click('#preview-pick');
    // Astros udviklerværktøj lægger sine egne overskrifter i siden; testen vælger sidens egen.
    text = await pick(frame().locator('body > h1'), 'Overskrift');
    assert.match(text, /I koden: src\/pages\/index\.astro, linje 5\./);
    await page.click('#pick-edit'); await page.fill('#pick-value', 'Kalender & møder'); await page.click('#pick-form button[type=submit]');
    await page.locator('#pick-check.check-ok').waitFor({ timeout: 30000 });
    assert.equal(await fs.readFile(path.join(astro, 'src/pages/index.astro'), 'utf8'), astroPage.replace('Kommunens kalender', 'Kalender &amp; møder'));
    text = await pick(frame().locator('body > p'), 'Afsnit');
    assert.match(text, /fandt ikke teksten/, '»Møder i Rådhuset« sættes sammen af tekst og en variabel');
    await capture('astro.png');
    await page.click('#preview-pick');
    passed('Astro: overskriften rettes i src/pages/index.astro med & skrevet som HTML-tegnkode og vises i forhåndsvisningen');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
