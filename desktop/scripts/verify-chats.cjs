const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const helpers = require('./ui-test-helpers.cjs');

// Rigtig Electron og OpenCode med en kontrolleret lokal model: flere samtaler i samme projekt, skift mellem dem,
// mens en arbejder, godkendelse i baggrunden, omdøb og slet, genstart med fortsat AI-session, flytning af en ældre
// samtale, kommandopaletten og eksempler på idéer.
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-samtaler-')));
  const project = path.join(root, 'Foreningens side'), older = path.join(root, 'Ældre projekt');
  await fs.mkdir(path.join(project, 'public'), { recursive: true }); await fs.mkdir(older);
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><title>Forening</title><h1>Foreningens side</h1>');
  // Et ældre projekt med én samtale i projektfilen og en arkiveret samtale, som før samtalerne fik egne filer.
  const workspaces = path.join(root, 'appdata', 'harness', 'workspaces'), key = crypto.createHash('sha256').update(older).digest('hex');
  await fs.mkdir(path.join(workspaces, `${key}-archives`), { recursive: true });
  const old = (text, at, extra = {}) => ({ version: 1, draft: '', mode: 'plan', messages: [{ id: `u-${at}`, role: 'user', text }, { id: `a-${at}`, role: 'assistant', text: 'Et gammelt svar.' }], plan: null, planConversation: [], status: 'idle', updatedAt: at, ...extra });
  await fs.writeFile(path.join(workspaces, `${key}-archives`, '2026-09-01.json'), JSON.stringify(old('Arkiveret idé om en kalender', '2026-09-01T10:00:00.000Z')));
  await fs.writeFile(path.join(workspaces, `${key}.json`), JSON.stringify(old('Den gamle samtale om nyhedsbrevet', '2026-09-02T10:00:00.000Z', { draft: 'Gammel kladde' })));

  // Den kontrollerede model. Den sidste brugerbesked afgør svaret; titelkald uden værktøjer får en kort tekst.
  const requests = []; let releaseB = null;
  const lastUser = body => { const user = [...body.messages].reverse().find(m => m.role === 'user'); return JSON.stringify(user?.content || ''); };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const text = lastUser(body), tools = Boolean(body.tools?.length), afterTool = body.messages.at(-1)?.role === 'tool';
    const reply = (delta, finish = 'stop') => {
      const chunk = { id: 'svar', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: ' + JSON.stringify(chunk) + '\n\n');
      res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n');
      res.end('data: [DONE]\n\n');
    };
    if (!tools) return reply({ content: 'Titel' });
    if (text.includes('opgave-a') && !afterTool) return reply({ tool_calls: [{ index: 0, id: 'skriv_a', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(project, 'public/index.html'), content: '<!doctype html><title>Forening</title><h1>Velkommen til foreningen</h1>' }) } }] }, 'tool_calls');
    if (text.includes('opgave-a')) return reply({ content: 'Forsiden er klar. Prøv overskriften.' });
    if (text.includes('opgave-b')) { await new Promise(resolve => { releaseB = resolve; }); return reply({ content: 'Forslag: En kontaktside med formular. Prøv formularen på mobil.' }); }
    if (text.includes('fortsæt-a')) return reply({ content: 'Knappen er tilføjet til samme samtale.' });
    return reply({ content: 'Forslag: En enkel side. Prøv den i forhåndsvisningen.' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app, page;
  async function launch() {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); await helpers.skipIntroduction(page);
  }
  const appWindow = fn => app.evaluate(({ BrowserWindow }, source) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); return new Function('win', `return (${source})(win)`)(win); }, fn.toString());
  async function open(folder) {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.click('#open'); await page.locator('#project-name').filter({ hasText: path.basename(folder) }).waitFor();
  }
  const row = title => page.locator('#project-list .chat-row').filter({ hasText: title });
  const more = title => page.locator('#project-list .chat-list > li').filter({ has: page.locator('.chat-row', { hasText: title }) }).locator('.chat-more');
  const openTitle = () => page.locator('#project-list .chat-row[aria-current="true"] .chat-title').textContent();
  async function draft(text) { await page.fill('#prompt', text); await page.locator('#draft-status').filter({ hasText: 'Kladde gemt' }).waitFor(); }
  // Afsendelse: første gang vises Før du sender; derefter er vilkårene accepteret for projektet.
  async function send() {
    await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden, null, { timeout: 30000 });
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.locator('#stop:not([hidden])').waitFor();
  }
  async function palette(query) {
    await page.keyboard.press('Meta+K'); await page.locator('#palette[open]').waitFor();
    if (query !== undefined) await page.fill('#palette-input', query);
    return page.locator('#palette-list .palette-item');
  }
  const checks = [];
  try {
    await launch();
    // Eksempler på idéer: ét link under idéfeltet, tre faste valg, og kun når feltet er tomt.
    await helpers.toOnboarding(page);
    await page.locator('#idea-examples-toggle').waitFor();
    assert.equal(await page.isVisible('#idea-examples'), false);
    await page.click('#idea-examples-toggle');
    assert.equal(await page.locator('#idea-examples .idea-example').count(), 3);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('idea-example')), true, 'fokus flytter til første eksempel');
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'eksempler.png') });
    await page.locator('#idea-examples .idea-example').nth(1).click();
    assert.match(await page.inputValue('#purpose'), /^En tjekliste til nye kolleger/); assert.equal(await page.inputValue('#name'), 'Tjekliste til nye kolleger');
    assert.equal(await page.isVisible('#idea-examples-row'), false, 'eksemplerne skjules, når idéfeltet har tekst');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'purpose');
    await page.fill('#purpose', ''); await page.locator('#idea-examples-toggle').waitFor();
    checks.push('eksempler på idéer udfylder idé og navn og skjules, når feltet har tekst');

    // Paletten respekterer valgte funktioner: Udgiv er ikke slået til, så den kan ikke findes.
    let options = await palette('udgiv');
    assert.equal(await options.count(), 0); await page.locator('#palette-empty:not([hidden])').waitFor();
    await page.keyboard.press('Escape'); await page.locator('#palette:not([open])').waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'purpose', 'fokus vender tilbage efter Escape');
    checks.push('paletten viser ikke handlinger fra funktioner, der er slået fra, og giver fokus tilbage');

    // Samtale A arbejder og venter på en godkendelse, mens samtale B åbnes og skrives i.
    await open(project);
    const connection = await helpers.addConnection(page, { name: 'Kontrolleret lokal forbindelse', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection.id); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');
    await draft('Byg en forside med en stor overskrift. opgave-a'); await send();
    await helpers.awaitApproval(page, { timeout: 60000 });
    const titleA = 'Byg en forside med en stor overskrift';
    await row(titleA).waitFor(); assert.equal(await openTitle(), titleA);
    await page.click('#project-list .project-entry.is-current .project-add');
    await page.waitForFunction(() => document.querySelector('#messages').textContent === '' && document.querySelector('#prompt').value === '');
    await row(titleA).locator('.chat-meta.is-waiting').filter({ hasText: 'venter på dig' }).waitFor();
    assert.equal(await page.isVisible('#approvals button'), false, 'godkendelsen hører til samtale A');
    assert.equal(await page.isVisible('#composer-wait'), false);
    assert.equal(await page.isDisabled('#send'), false);
    await draft('Planlæg en kontaktside. opgave-b');
    await row('Planlæg en kontaktside').waitFor();
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), '<!doctype html><title>Forening</title><h1>Foreningens side</h1>', 'intet er skrevet uden godkendelse');
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'to-samtaler.png') });
    checks.push('ny samtale, mens en anden venter på godkendelse; status i sidepanelet; en ny opgave kan sendes i sin egen kopi');

    // Paletten finder samtale A og skifter til den. Godkendelsen står der stadig.
    options = await palette('forside');
    assert.equal(await options.first().locator('.palette-label').textContent(), titleA);
    assert.equal(await options.first().locator('.palette-meta').textContent(), 'venter på dig');
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'palet.png') });
    await page.keyboard.press('Enter');
    await page.waitForFunction(title => document.querySelector('#project-list .chat-row[aria-current="true"]')?.textContent.includes(title), titleA);
    await helpers.approve(page, 'Tillad én gang');
    await page.locator('#messages').filter({ hasText: 'Forsiden er klar' }).waitFor({ timeout: 60000 });
    await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 });
    assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Velkommen til foreningen/);
    checks.push('paletten skifter til samtalen med søgning og Enter; godkendelse i den rigtige samtale');

    // Samtale B arbejder, mens A er åben. Nyt projekt og Åbn projekt kan bruges imens; B får "nyt resultat", når den er færdig.
    await row('Planlæg en kontaktside').click();
    await page.waitForFunction(() => document.querySelector('#prompt').value === 'Planlæg en kontaktside. opgave-b');
    assert.equal(await page.isDisabled('#send'), false);
    await send();
    // En ny OpenCode-motor starter for B; det kan tage lidt tid på en travl maskine.
    for (let i = 0; i < 600 && !releaseB; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(releaseB, 'B sendte sin opgave til modellen');
    await row(titleA).click();
    await page.locator('#messages').filter({ hasText: 'Forsiden er klar' }).waitFor();
    await row('Planlæg en kontaktside').locator('.chat-meta.is-running').filter({ hasText: 'arbejder' }).waitFor();
    assert.equal(await page.locator('#messages').textContent().then(text => text.includes('Kontaktside')), false, 'B’s svar vises ikke i A');
    // Siden 0.6.0-beta.1 (5ffe905) kan et andet projekt åbnes, mens en samtale arbejder; se README og DESIGN.md. Den gamle vagt
    // her kunne ikke slå til, fordi prøven først åbner et andet projekt længere nede.
    assert.equal(await page.locator('#open').isEnabled(), true, 'Åbn projekt kan bruges, mens en samtale arbejder');
    assert.equal(await page.locator('#new').isEnabled(), true, 'Nyt projekt kan bruges, mens en samtale arbejder');
    releaseB();
    await row('Planlæg en kontaktside').locator('.chat-meta.is-unread').filter({ hasText: 'nyt resultat' }).waitFor({ timeout: 60000 });
    await row('Planlæg en kontaktside').click();
    await page.locator('#messages').filter({ hasText: 'En kontaktside med formular' }).waitFor();
    assert.equal(await row('Planlæg en kontaktside').locator('.chat-meta.is-unread').count(), 0, 'markeringen forsvinder, når samtalen åbnes');
    checks.push('en samtale arbejder i baggrunden med egen status og eget svar; Nyt projekt og Åbn projekt kan bruges imens; nyt resultat markeres');

    // Paletten: piletaster og Enter udfører appens egen handling og flytter fokus til fanen.
    options = await palette('ændring');
    assert.equal(await options.first().locator('.palette-label').textContent(), 'Vis ændringerne');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#tab-changes').getAttribute('aria-selected') === 'true' && document.activeElement.id === 'tab-changes');
    options = await palette('');
    const before = await page.getAttribute('#palette-input', 'aria-activedescendant');
    await page.keyboard.press('ArrowDown'); assert.notEqual(await page.getAttribute('#palette-input', 'aria-activedescendant'), before);
    await page.keyboard.press('ArrowUp'); assert.equal(await page.getAttribute('#palette-input', 'aria-activedescendant'), before);
    await page.keyboard.press('Meta+K'); await page.locator('#palette:not([open])').waitFor({ state: 'attached' });
    await page.click('#tab-preview');
    // Genvejen virker også, når fokus står i forhåndsvisningen.
    const frame = page.frameLocator('#preview');
    await frame.locator('h1').filter({ hasText: 'Velkommen til foreningen' }).waitFor({ timeout: 30000 });
    // Tastetrykket sendes gennem browserens egen tastaturvej, som et rigtigt tryk, til forhåndsvisningen med fokus.
    await frame.locator('h1').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preview');
    await appWindow(win => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['meta'] }); });
    await page.locator('#palette[open]').waitFor();
    await page.keyboard.press('Escape');
    checks.push('paletten med piletaster, Enter og ⌘K som lukker; virker med fokus i forhåndsvisningen');

    // Omdøb og slet fra samtalens menu.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await app.evaluate(({ shell }) => { globalThis.trashed = []; shell.trashItem = async file => { globalThis.trashed.push(file); }; });
    await row(titleA).hover(); await more(titleA).click();
    await page.click('#chat-rename'); await page.fill('#project-list .chat-rename input', 'Forsiden'); await page.keyboard.press('Enter');
    await row('Forsiden').waitFor();
    await row('Planlæg en kontaktside').hover(); await more('Planlæg en kontaktside').click();
    await page.click('#chat-delete');
    await page.waitForFunction(() => ![...document.querySelectorAll('#project-list .chat-title')].some(el => el.textContent.includes('kontaktside')));
    const trashed = await app.evaluate(() => globalThis.trashed);
    assert.equal(trashed.length, 1); assert.match(trashed[0], /-chats[\\/][0-9a-f-]{36}\.json$/);
    await fs.rm(trashed[0]);
    assert.equal(await openTitle(), 'Forsiden', 'den nyeste tilbageværende samtale åbnes');
    checks.push('omdøb og slet fra samtalens menu; slettet samtale flyttes til papirkurven');

    // Genstart: projektet og samtalen åbnes igen, navnet holder, og samtalen fortsætter sin AI-session.
    await app.close(); app = null; await launch();
    await page.locator('#project-name').filter({ hasText: path.basename(project) }).waitFor();
    await row('Forsiden').waitFor(); assert.equal(await openTitle(), 'Forsiden');
    assert.match(await page.locator('#messages').textContent(), /Forsiden er klar/);
    await draft('Tilføj en knap til tilmelding. fortsæt-a'); await send();
    await page.locator('#messages').filter({ hasText: 'Knappen er tilføjet' }).waitFor({ timeout: 60000 });
    const resumed = requests.filter(body => body.tools?.length && lastUser(body).includes('fortsæt-a'));
    assert.ok(resumed.length, 'beskeden nåede modellen');
    assert.ok(JSON.stringify(resumed[0].messages).includes('opgave-a'), 'modellen fik samtalens tidligere beskeder fra den fortsatte session');
    await page.click('#tab-activity'); await page.locator('#activity-list').filter({ hasText: 'AI-sessionen fortsætter' }).waitFor();
    checks.push('genstart åbner samme samtale; AI-sessionen fortsætter med tidligere beskeder hos modellen');

    // Et ældre projekt flyttes til samtaler: den gamle samtale og den arkiverede står i sidepanelet.
    await open(older);
    await row('Den gamle samtale om nyhedsbrevet').waitFor(); await row('Arkiveret idé om en kalender').waitFor();
    assert.equal(await page.inputValue('#prompt'), 'Gammel kladde');
    assert.deepEqual((await fs.readdir(path.join(workspaces, `${key}-archives`))), ['2026-09-01.json'], 'arkivet bevares');
    await row('Arkiveret idé om en kalender').click();
    await page.locator('#messages').filter({ hasText: 'Arkiveret idé om en kalender' }).waitFor();
    // Tilbage til det første projekt fra sidepanelet.
    await page.locator('#project-list .project-name').filter({ hasText: path.basename(project) }).click();
    await page.locator('#project-name').filter({ hasText: path.basename(project) }).waitFor();
    await page.frameLocator('#preview').locator('h1').filter({ hasText: 'Velkommen til foreningen' }).waitFor({ timeout: 30000 });
    checks.push('ældre samtale og arkiv flyttes til samtaler; arkivet bevares; projektskift fra sidepanelet');

    // Lille vindue, zoom og reduceret bevægelse.
    await appWindow(win => win.setSize(980, 720));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'lille-vindue.png') });
    await palette(''); await page.screenshot({ animations: 'disabled', path: path.join(root, 'palet-lille.png') });
    const box = await page.locator('#palette').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 980, 'paletten er inden for vinduet');
    await page.keyboard.press('Escape');
    await appWindow(win => win.webContents.setZoomFactor(1.5));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'ingen vandret rulning ved 150 % zoom');
    // Playwrights skærmbillede følger ikke Electrons zoom; billedet tages derfor direkte fra vinduet.
    await fs.writeFile(path.join(root, 'zoom.png'), Buffer.from(await appWindow(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'));
    await appWindow(win => win.webContents.setZoomFactor(1));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => { const dot = document.createElement('span'); dot.className = 'chat-status is-running'; document.body.append(dot); const value = getComputedStyle(dot).animationName; dot.remove(); return value; }), 'none');
    checks.push('980 × 720, 150 % zoom og reduceret bevægelse');

    console.log(JSON.stringify({ status: 'bestået', root, checks }, null, 1));
  } catch (error) { if (page) { await page.screenshot({ animations: 'disabled', path: path.join(root, 'fejl.png'), timeout: 3000 }).catch(() => {}); console.error('Testmateriale: ' + root); } throw error; }
  finally { releaseB?.(); await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
