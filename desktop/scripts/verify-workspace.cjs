// Arbejdsfladen i Electron: Forhåndsvisning, Ændringer, Kode og Aktivitet med den rigtige OpenCode-motor,
// en kontrolleret lokal modelserver og rigtige projektfiler i en ny midlertidig mappe. Prøven opretter ingen Git-versioner.
// Den gennemgår filbeskyttelse, linje-diff med brugerens samtidige rettelse, filhenvisninger begge veje, godkendelsens
// ventetid, Stop, fejl, faneskift med bevaret preview og kladde, tastatur, 980 × 720, større tekst og reduceret bevægelse.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-arbejdsflade-')));
  const project = path.join(root, 'Mødelokaler');
  const page0 = ['<!doctype html>', '<html lang="da"><head><meta charset="utf-8"><title>Lokaler</title></head><body>', '<h1>Mødelokaler</h1>', '<form><label>Navn <input id="navn"></label></form>', ...Array.from({ length: 120 }, (_, i) => `<p>Lokale ${i + 1} har plads.</p>`), '<script>document.body.dataset.koert = "ja"</script>', '</body></html>', ''].join('\n');
  const files = {
    'public/index.html': page0, 'src/app.js': 'export const lokaler = [\n  { navn: "Lille", plads: 4 },\n  { navn: "Stor", plads: 12 }\n];\n',
    'noter.txt': 'Mine egne noter\n', 'README.md': '# Mødelokaler\n', '.env': 'API_KEY=kun-lokal-proeve\n', 'references/privat.md': 'Privat reference\n'
  };
  for (const [file, text] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true }); await fs.writeFile(path.join(project, file), text); }
  await fs.writeFile(path.join(root, 'udenfor.txt'), 'Uden for projektet\n');
  await fs.symlink(path.join(root, 'udenfor.txt'), path.join(project, 'genvej.txt'));

  // Modelserveren svarer efter beskeden: BYG skriver siden og kører en kommando, STOP svarer aldrig færdigt,
  // FEJL afviser kaldet, og alt andet får et kort svar. Hver anmodning gemmes, så prøven kan se, hvad AI'en fik.
  const requests = []; let mode = 'normal';
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'arbejdsflade-model', name: 'Kontrolleret testmodel' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const users = body.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    const last = users.at(-1) || '', tools = body.messages.filter(m => m.role === 'tool').length;
    if (mode === 'fejl' && body.tools?.length) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Kontrolleret serverfejl' } })); }
    let step = !body.tools?.length ? { text: 'Titel' } : null;
    const toolsSince = body.messages.slice(body.messages.findLastIndex(m => m.role === 'user')).filter(m => m.role === 'tool').length;
    if (step) { /* Titel uden værktøjer. */ }
    else if (last.includes('BYG') && toolsSince === 0) step = { tool: 'write', args: { filePath: path.join(project, 'public/index.html'), content: page0.replace('<h1>Mødelokaler</h1>', '<h1>Find et lokale</h1>') } };
    else if (last.includes('BYG') && toolsSince === 1) step = { tool: 'bash', args: { command: 'echo færdig med lokalerne', description: 'Kontrollerer projektet' } };
    else if (last.includes('BYG')) step = { text: 'Jeg ændrede overskriften i `public/index.html`. Listen står i src/app.js:2, og README.md er uændret.' };
    else if (last.includes('STOP')) step = { hold: true };
    else step = { text: `Svar uden ændringer (${tools} værktøjer).` };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = delta => res.write('data: ' + JSON.stringify({ id: 'arbejdsflade', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    if (step.hold) { chunk({ role: 'assistant', content: 'Jeg går i gang …' }); return; }
    if (step.tool) chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${requests.length}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
    else chunk({ role: 'assistant', content: step.text });
    res.write('data: ' + JSON.stringify({ id: 'arbejdsflade', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: step.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const checks = [];
  const passed = text => { checks.push(text); console.log('✓ ' + text); };
  // Skærmbilleder tages med Electrons egen capturePage, så de også er rigtige, når teksten er gjort større.
  const capture = async name => { const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64')); };
  let app, page;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    const selected = () => page.locator('.work-tab[aria-selected="true"]').getAttribute('data-tab');
    assert.equal(await selected(), 'preview'); passed('Forhåndsvisning er udgangspunktet');

    // Kode: kun projektets egne filer, skrivebeskyttet og som tekst.
    await page.click('#tab-code');
    await page.locator('#code-files .code-file[data-path="src/app.js"]').waitFor();
    const listed = await page.locator('#code-files .code-file').evaluateAll(items => items.map(item => item.dataset.path));
    assert.deepEqual(listed.sort(), ['README.md', 'noter.txt', 'public/index.html', 'src/app.js']);
    await page.click('#code-files .code-file[data-path="public/index.html"]');
    await page.locator('#code-title').filter({ hasText: 'public/index.html' }).waitFor();
    assert.equal(await page.locator('#code-lines script').count(), 0);
    assert.match(await page.locator('#code-lines').textContent(), /<script>document\.body\.dataset\.koert = "ja"<\/script>/);
    assert.equal(await page.locator('#code-lines [contenteditable], #code-lines textarea, #code-lines input').count(), 0);
    passed('Kode viser projektets filer som skrivebeskyttet tekst og udelader .env, referencer og genveje');
    const refusals = {};
    for (const file of ['.env', 'references/privat.md', '../udenfor.txt', 'genvej.txt', '/etc/hosts', 'public/../.env']) refusals[file] = (await page.evaluate(file => window.harness.codeRead(file), file)).error;
    assert.match(refusals['.env'], /beskyttet/); assert.match(refusals['references/privat.md'], /beskyttet/); assert.match(refusals['../udenfor.txt'], /ligger ikke i projektet/);
    assert.match(refusals['genvej.txt'], /Symbolske links/); assert.match(refusals['/etc/hosts'], /ligger ikke i projektet/); assert.match(refusals['public/../.env'], /ligger ikke i projektet/);
    passed('Filbeskyttelsen afviser .env, private referencer, stier uden for projektet og symbolske links i hovedprocessen');

    // Forbindelse til den kontrollerede model og direkte arbejde, så opgaven skriver filer uden en plan først.
    await helpers.addConnection(page, { name: 'Kontrolleret arbejdsflade', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection);
    await page.locator('#model-shortlist button').first().click(); await helpers.selectMode(page, 'free');
    const protectedRef = await page.evaluate(id => window.harness.prepare({ mode: 'free', connectionID: id, modelID: 'arbejdsflade-model', routeID: '', references: [], fileRefs: [{ path: '.env' }] }), connection);
    assert.match(protectedRef.error, /\.env: Filen er beskyttet/);
    const outsideRef = await page.evaluate(id => window.harness.prepare({ mode: 'free', connectionID: id, modelID: 'arbejdsflade-model', routeID: '', references: [], fileRefs: [{ path: '../udenfor.txt' }] }), connection);
    assert.match(outsideRef.error, /ligger ikke i projektet/);
    passed('En filhenvisning til en beskyttet fil eller en fil uden for projektet afvises, før noget sendes');

    // Preview: indtastning og rulning bevares ved faneskift.
    await page.click('#tab-preview');
    const preview = page.frameLocator('#preview');
    await preview.locator('#navn').fill('Lokale 4');
    await page.frameLocator('#preview').locator('body').evaluate(() => window.scrollTo(0, 900));
    await page.fill('#prompt', 'BYG en side, hvor man finder et lokale');
    for (const name of ['changes', 'code', 'activity', 'preview']) await page.click(`#tab-${name}`);
    assert.equal(await preview.locator('#navn').inputValue(), 'Lokale 4');
    assert.equal(await preview.locator('body').evaluate(() => Math.round(window.scrollY)), 900);
    assert.equal(await page.inputValue('#prompt'), 'BYG en side, hvor man finder et lokale');
    // Tastatur: piletaster, Home og End flytter mellem fanerne, og fokus er synligt.
    await page.focus('#tab-preview'); await page.keyboard.press('ArrowRight');
    assert.equal(await selected(), 'plan'); assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-plan');
    assert.notEqual(await page.locator('#tab-plan').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('ArrowRight'); assert.equal(await selected(), 'changes');
    await page.keyboard.press('End'); assert.equal(await selected(), 'activity');
    await page.keyboard.press('ArrowRight'); assert.equal(await selected(), 'preview');
    await page.keyboard.press('ArrowLeft'); assert.equal(await selected(), 'activity');
    await page.keyboard.press('Home'); assert.equal(await selected(), 'preview');
    assert.equal(await preview.locator('#navn').inputValue(), 'Lokale 4');
    passed('Faneskift med mus og tastatur bevarer previewets formular, rulning og beskedkladden; fokus er synligt');

    // Opgave 1: AI'en skriver siden og kører en kommando. Brugeren undersøger Kode imens og retter sine egne noter.
    await page.click('#tab-code'); await page.click('#code-files .code-file[data-path="src/app.js"]');
    await page.click('#send'); await page.waitForSelector('#data-dialog[open]'); await page.click('#accept-send');
    await helpers.awaitApproval(page);
    assert.equal(await selected(), 'code');
    await page.focus('#prompt'); await page.keyboard.type('Næste idé');
    await page.locator('#activity-badge.waiting').waitFor();
    await fs.writeFile(path.join(project, 'noter.txt'), 'Mine egne noter, rettet mens AI’en arbejdede\n');
    await page.waitForTimeout(2200);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt', 'AI’ens hændelser tager ikke fokus fra skrivefeltet');
    await page.click('#tab-activity');
    const waiting = page.locator('.activity-entry.status-waiting .activity-state');
    await waiting.waitFor(); assert.match(await waiting.textContent(), /Venter på dig · i \d+ s/);
    assert.match(await page.locator('#activity-status').textContent(), /Venter på dig: ændre en fil/);
    await page.screenshot({ path: path.join(root, 'aktivitet-venter.png'), animations: 'disabled' });
    await page.click('#tab-code');
    await helpers.approve(page, 'Tillad for denne opgave');
    const allowOnce = page.locator('#approvals button').filter({ hasText: 'Tillad én gang' });
    await allowOnce.waitFor({ timeout: 90000 }); await allowOnce.click();
    await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 90000 });
    await page.locator('#run-review').waitFor();
    assert.equal(await selected(), 'code');
    assert.equal(await page.inputValue('#prompt'), 'Næste idé');
    assert.equal(await page.locator('#code-title').textContent(), 'src/app.js');
    await page.locator('#changes-badge:not([hidden])').waitFor();
    passed('AI’en skifter aldrig væk fra den fane, brugeren undersøger, og tager ikke fokus fra skrivefeltet; Ændringer får et mærke, og kladden er bevaret');

    // Aktivitet: faktiske værktøjer, godkendelser med ventetid, kommandoens output og resultatet.
    await page.click('#tab-activity');
    const activityText = await page.locator('#activity-list').innerText();
    assert.match(activityText, /Opgave: arbejd direkte/); assert.match(activityText, /Skriv fil\s+public\/index\.html/);
    assert.match(activityText, /Godkendelse: ændre en fil\s+public\/index\.html\s+Du tillod filændringer i projektet for resten af opgaven · efter \d+ s/);
    assert.match(activityText, /Godkendelse: køre en kommando\s+echo færdig med lokalerne\s+Du tillod den · efter/);
    assert.match(activityText, /Kør kommando\s+echo færdig med lokalerne\s+Afsluttet/);
    assert.match(activityText, /Opgaven er færdig/); assert.match(activityText, /2 filer ændret · 1 af dem ikke af AI'ens filværktøjer · 1 kommando kørt/);
    await page.locator('.activity-entry.kind-tool:has-text("Kør kommando") summary').click();
    assert.match(await page.locator('.activity-entry.kind-tool:has-text("Kør kommando") pre').textContent(), /færdig med lokalerne/);
    passed('Aktivitet viser de faktiske værktøjer, godkendelser med ventetid, kommandoens rigtige output og resultatet');

    // Ændringer: resumé først, derefter linje-diff. Brugerens samtidige rettelse tilskrives ikke AI'en.
    await page.click('#tab-changes');
    await page.locator('#changes-heading').filter({ hasText: '2 filer ændret under opgaven' }).waitFor();
    assert.match(await page.locator('#changes-basis').textContent(), /Sammenlignet med filerne i projektet, da opgaven »BYG en side, hvor man finder et lokale« startede i dag/);
    const rows = await page.locator('#changes-files .file-row').evaluateAll(items => items.map(item => [item.dataset.file, item.querySelector('.by-tag').textContent]));
    assert.deepEqual(rows, [['public/index.html', 'AI’en'], ['noter.txt', 'En kommando eller dig']]);
    assert.match(await page.locator('#changes-others').textContent(), /1 fil blev ændret under opgaven, men ikke af AI’ens filværktøjer/);
    assert.equal(await page.locator('#changes-diff-title').textContent(), 'public/index.html');
    const diff = await page.locator('#changes-diff-lines').innerText();
    assert.match(diff, /3\s+−\s+Fjernet:\s+<h1>Mødelokaler<\/h1>/); assert.match(diff, /3\s+\+\s+Tilføjet:\s+<h1>Find et lokale<\/h1>/);
    assert.match(diff, /⋯ 120 uændrede linjer/);
    assert.match(await page.locator('#changes-files .file-row[data-file="public/index.html"] .file-stats').innerText(), /\+1\s+−1/);
    await page.click('#changes-files .file-row[data-file="noter.txt"]');
    await page.locator('#changes-diff-note').filter({ hasText: 'Ikke ændret af AI’ens filværktøjer' }).or(page.locator('#changes-diff-note').filter({ hasText: 'kommando' })).first().waitFor();
    assert.match(await page.locator('#changes-diff-lines').innerText(), /Mine egne noter, rettet mens AI’en arbejdede/);
    await page.screenshot({ path: path.join(root, 'aendringer.png'), animations: 'disabled' });
    passed('Ændringer viser resumé, sammenligningsgrundlag og rigtig linje-diff; brugerens egen rettelse står ikke som AI’ens');

    // Filhenvisninger i samtalen åbner den rigtige fil og linje.
    const refs = page.locator('#messages .assistant .file-ref');
    await refs.first().waitFor();
    assert.deepEqual(await refs.evaluateAll(items => items.map(item => [item.dataset.path, item.dataset.line || ''])), [['public/index.html', ''], ['src/app.js', '2'], ['README.md', '']]);
    await page.locator('#messages .assistant .file-ref[data-line="2"]').click();
    assert.equal(await selected(), 'code'); await page.locator('#code-title').filter({ hasText: 'src/app.js' }).waitFor();
    assert.equal(await page.locator('#code-lines .code-line.is-marked').getAttribute('data-line'), '2');
    passed('Filhenvisninger i AI’ens svar åbner den rigtige fil og linje under Kode');

    // Henvisning til AI'en: synlig i skrivefeltet og i Før du sender, og den sendes som sti og linjer.
    await page.click('#code-reference');
    assert.match(await page.locator('#composer-refs').innerText(), /src\/app\.js · linje 2/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt');
    await page.fill('#prompt', 'Hvad gør linjen?');
    // En intern filhenvisning gentager ikke et allerede accepteret resumé; teksten står stadig under Se data.
    await page.click('#send');
    assert.equal(await page.locator('#data-dialog').evaluate(el => el.open), false, 'resuméet vises ikke igen for en intern filhenvisning');
    // "Klar" står der allerede, før der sendes, så prøven venter på selve modelkaldet.
    const awaitRequest = async match => {
      for (let round = 0; round < 180; round++) { if (requests.some(body => JSON.stringify(body.messages).includes(match))) return; await new Promise(resolve => setTimeout(resolve, 500)); }
      throw new Error(`Modelkaldet med "${match}" kom aldrig.`);
    };
    await awaitRequest('Hvad gør linjen?');
    await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 90000 });
    const asked = requests.filter(body => JSON.stringify(body.messages).includes('Hvad gør linjen?')).at(-1);
    assert.match(JSON.stringify(asked.messages), /Filhenvisninger fra Aura \(læs selv filerne i projektet\):\\n- src\/app\.js \(linje 2\)/);
    assert.equal(await page.isVisible('#composer-refs'), false);
    passed('En filhenvisning vises i skrivefeltet og i Før du sender og når modellen som sti og linje');

    // Stop: opgaven stoppes af brugeren og står som stoppet i Aktivitet.
    await page.fill('#prompt', 'STOP efter første svar'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.locator('#messages .assistant').filter({ hasText: 'Jeg går i gang' }).waitFor({ timeout: 90000 });
    await page.click('#stop'); await page.locator('#run-status').filter({ hasText: 'Stoppet' }).waitFor({ timeout: 30000 });
    await page.click('#tab-activity');
    await page.locator('.activity-entry.kind-stop').filter({ hasText: 'Du trykkede på Stop' }).waitFor();
    await page.locator('.activity-entry.kind-result').filter({ hasText: 'Opgaven blev stoppet' }).waitFor();
    passed('Stop står i Aktivitet som brugerens handling, og opgaven er markeret som stoppet');

    // Fejl fra modelserveren står i Aktivitet; kladden bevares som hidtil.
    mode = 'fejl'; await page.fill('#prompt', 'Denne opgave fejler'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden || document.querySelector('#run-status').textContent.includes('Fejl'));
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.locator('.activity-entry.kind-error').first().waitFor({ timeout: 90000 });
    await page.locator('#run-status').filter({ hasText: /Fejl|Klar/ }).waitFor({ timeout: 90000 });
    assert.equal(await page.inputValue('#prompt'), 'Denne opgave fejler');
    mode = 'normal';
    passed('En fejl fra modelserveren står i Aktivitet, og beskeden er bevaret');

    // Hele samtalen: brugerens rettelse efter opgaven gør AI'ens fil blandet.
    await fs.writeFile(path.join(project, 'public/index.html'), (await fs.readFile(path.join(project, 'public/index.html'), 'utf8')).replace('Find et lokale', 'Find et lokale nu'));
    await page.click('#tab-changes'); await page.selectOption('#changes-source', 'session'); await page.click('#changes-refresh');
    await page.locator('#changes-heading').filter({ hasText: 'ændret i denne samtale' }).waitFor();
    await page.waitForFunction(() => document.querySelector('#changes-files .file-row[data-file="public/index.html"] .by-tag')?.textContent === 'AI’en og andre');
    passed('Hele samtalen markerer en fil som AI’en og andre, når brugeren har rettet den bagefter');

    // 980 × 720, større tekst og reduceret bevægelse. I en smal arbejdsflade står de seks faner på én linje og ruller sidelæns
    // (beslutningen 3. november 2026). Den valgte fane skal altid stå helt synligt (DESIGN.md), og de andre skal kunne nås.
    const layout = async () => page.evaluate(() => {
      const strip = document.querySelector('.work-tabs'), box = strip.getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.work-tab:not([hidden])')].map(el => el.getBoundingClientRect());
      const chosen = document.querySelector('.work-tab[aria-selected="true"]').getBoundingClientRect();
      const surface = document.querySelector('#work-surface').getBoundingClientRect(), send = document.querySelector('#send').getBoundingClientRect(), prompt = document.querySelector('#prompt').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, overflowX: document.documentElement.scrollWidth > innerWidth || surface.right > innerWidth + 1 || surface.bottom > innerHeight + 1, rows: new Set(tabs.map(r => Math.round(r.top))).size, stripInside: box.left >= surface.left - 1 && box.right <= surface.right + 1 && box.bottom <= surface.bottom, selectedVisible: chosen.width > 0 && chosen.left >= box.left - 1 && chosen.right <= box.right + 1, scrollable: strip.scrollWidth > strip.clientWidth + 1, sendVisible: send.bottom <= innerHeight && send.right <= innerWidth && send.width > 0, promptHeight: Math.round(prompt.height), collapsed: document.body.classList.contains('sidebar-collapsed') };
    });
    // Som knappen Se Aktivitet og filhenvisningerne: fanen vælges uden at få fokus, så kun Auras egen kode kan rulle den frem.
    const choose = async name => { await page.evaluate(name => window.workspace.show(name), name); await page.waitForTimeout(100); return layout(); };
    // Musehjulet ruller striben sidelæns, også når en fane ikke har nogen synlig del at klikke på.
    const wheel = async () => {
      const box = await page.locator('.work-tabs').boundingBox(), before = await page.locator('.work-tabs').evaluate(el => el.scrollLeft);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(before > 0 ? -400 : 400, 0);
      await page.waitForFunction(before => Math.abs(document.querySelector('.work-tabs').scrollLeft - before) > 4, before, { timeout: 5000 });
    };
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720)); await page.waitForTimeout(600);
    await page.click('#tab-preview');
    let measured = await layout();
    assert.equal(measured.overflowX, false); assert.equal(measured.rows, 1); assert.ok(measured.stripInside); assert.ok(measured.selectedVisible); assert.ok(measured.sendVisible); assert.ok(measured.promptHeight >= 50);
    await capture('980x720.png');
    assert.ok((await choose('activity')).selectedVisible, 'Aktivitet står helt synligt, når den vælges uden fokus');
    assert.ok((await choose('preview')).selectedVisible, 'Forhåndsvisning står helt synligt igen');
    await page.focus('#tab-preview'); await page.keyboard.press('End'); assert.equal(await selected(), 'activity'); assert.ok((await layout()).selectedVisible, 'End viser Aktivitet');
    await page.keyboard.press('Home'); assert.equal(await selected(), 'preview'); assert.ok((await layout()).selectedVisible, 'Home viser Forhåndsvisning');
    // Et museklik på den synlige del af en delvist skjult fane vælger den og viser hele fanen. page.click ruller selv elementet frem
    // og beviser derfor intet; her klikkes på et punkt, der allerede kan ses.
    const partial = await page.evaluate(() => { const strip = document.querySelector('.work-tabs').getBoundingClientRect(); const tab = [...document.querySelectorAll('.work-tab:not([hidden])')].find(el => { const r = el.getBoundingClientRect(); return r.right > strip.right + 1 && r.left < strip.right - 8; }); if (!tab) return null; const r = tab.getBoundingClientRect(); return { name: tab.dataset.tab, x: Math.min(r.right, strip.right) - 4, y: r.top + r.height / 2 }; });
    if (partial) { await page.mouse.click(partial.x, partial.y); assert.equal(await selected(), partial.name); assert.ok((await layout()).selectedVisible, `${partial.name} står helt synligt efter klik`); await page.click('#tab-preview'); }
    if (measured.scrollable) await wheel();
    for (const name of ['changes', 'code', 'activity']) { await page.click(`#tab-${name}`); await capture(`980x720-${name}.png`); }
    await page.click('#tab-preview');
    const results = { '980': measured };
    for (const zoom of [1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(zoom), zoom); await page.waitForTimeout(600);
      measured = await layout(); results[zoom] = measured;
      assert.equal(measured.overflowX, false, `vandret rulning ved ${zoom}`); assert.ok(measured.stripInside, `fanestriben uden for ved ${zoom}`); assert.ok(measured.selectedVisible, `den valgte fane skjult ved ${zoom}`); assert.ok(measured.sendVisible, `Send skjult ved ${zoom}`);
      for (const name of ['code', 'activity', 'preview']) assert.ok((await choose(name)).selectedVisible, `${name} skjult, når den vælges ved ${zoom}`);
      if (measured.scrollable) await wheel();
      await capture(`980x720-zoom-${zoom * 100}.png`);
    }
    assert.equal(results[1.5].collapsed, true, 'sidepanelet er foldet sammen ved stor tekst');
    await page.click('#sidebar-toggle'); assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-overlay')), true);
    await capture('980x720-zoom-150-sidepanel.png');
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-overlay')), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebar-toggle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.setZoomFactor(1)); await page.waitForTimeout(400);
    passed('980 × 720 uden vandret rulning med fanerne på én linje; den valgte fane står altid helt synligt, også ved 125 % og 150 % tekst, og de andre kan nås med mus, musehjul og tastatur; Send er synlig, og sidepanelet foldes sammen');

    // Sidepanelet kan foldes sammen af brugeren og huskes.
    await page.click('#sidebar-toggle');
    assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')), true);
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
    // N:C1-4 og Q:C1-6: med sammenfoldet sidepanel er arbejdsfladen ca. 493 px ved 980 × 720, bredere end grænsen for den smalle
    // flade (430 px), men smallere end de seks faner. De står stadig på én linje, og kan striben rulles, viser en fadet kant det.
    await page.waitForTimeout(400);
    const folded = await layout();
    assert.equal(folded.rows, 1, `fanerne står på én linje med sammenfoldet sidepanel: ${JSON.stringify(folded)}`);
    assert.ok(folded.stripInside && folded.selectedVisible && !folded.overflowX, JSON.stringify(folded));
    const edge = await page.locator('.work-tabs').evaluate(el => { const style = getComputedStyle(el); return { attachments: style.backgroundAttachment, images: style.backgroundImage, wrap: style.flexWrap }; });
    assert.equal(edge.wrap, 'nowrap');
    if (folded.scrollable) assert.ok(/local.*local.*scroll.*scroll/.test(edge.attachments.replace(/\s/g, '')) && (edge.images.match(/linear-gradient/g) || []).length === 4, `den fadede kant viser flere faner: ${JSON.stringify(edge)}`);
    assert.ok((await choose('activity')).selectedVisible, 'Aktivitet står helt synligt med sammenfoldet sidepanel');
    await page.screenshot({ path: path.join(root, 'sidepanel-foldet-faner.png'), animations: 'disabled' });
    await page.click('#tab-preview');
    assert.equal(await page.getByRole('button', { name: 'Nyt projekt' }).isVisible(), true);
    await page.click('#settings-toggle'); await page.locator('#settings-menu').waitFor();
    const menu = await page.evaluate(() => { const m = document.querySelector('#settings-menu').getBoundingClientRect(), t = document.querySelector('#settings-toggle').getBoundingClientRect(); return { inside: m.left >= 0 && m.top >= 0 && m.bottom <= innerHeight, near: Math.abs(m.left - t.left) < 4 && m.bottom <= t.top + 1 }; });
    assert.ok(menu.inside && menu.near); await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(root, 'sidepanel-foldet.png'), animations: 'disabled' });
    await page.reload(); await page.waitForSelector('#workspace:not([hidden])', { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')), true);
    await page.click('#sidebar-toggle'); assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')), false);
    passed('Sidepanelet kan foldes sammen og ud, beholder tilgængelige navne, menuen står ved knappen, og valget huskes');

    // Aktiviteten overlever en genindlæsning af brugerfladen, så længe appen er åben.
    await page.click('#tab-activity'); assert.match(await page.locator('#activity-list').innerText(), /Skriv fil/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#activity-badge').evaluate(el => { el.hidden = false; el.classList.add('running'); const name = getComputedStyle(el).animationName; el.classList.remove('running'); return name; }), 'none');
    passed('Reduceret bevægelse slår markeringens animation fra; aktiviteten bevares ved genindlæsning');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: checks.length, layout: results }, null, 2));
  } catch (error) {
    console.error(error);
    try { await page?.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }); console.error('Skærmbillede:', path.join(root, 'fejl.png')); console.error(await page?.locator('#activity-list').innerText({ timeout: 2000 })); } catch {}
    process.exitCode = 1;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})();
