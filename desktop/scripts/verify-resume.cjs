const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

// Rigtig Electron, OpenCode og projektfiler. Modelsvarene er kontrollerede testdata.
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-resume-')));
  const project = path.join(root, 'Fælleshus med mellemrum');
  const other = path.join(root, 'Et andet projekt');
  await fs.mkdir(path.join(project, 'public'), { recursive: true }); await fs.mkdir(other);
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Før bygning</h1>');
  const requests = []; let catalogs = 0;
  // En plan tæller kun med alle fire afsnit; ellers bliver svaret i samtalen uden plan.
  const plan = '## Det bygger vi\nEn overskuelig side om fælleshuset.\n## Sådan skal det se ud\nEn tydelig overskrift og en tilmeldingsknap.\n## Teknik og data\nHTML i public/index.html.\n## Det skal du prøve\nPrøv overskriften og tilmelding på mobil.';
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { catalogs++; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    if (body.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('afbrudt-test'))) {
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: ' + JSON.stringify({id:'partial',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:'Delvist svar før lukning.'},finish_reason:null}]}) + '\n\n');
      return;
    }
    const planning = JSON.stringify(body.messages).includes('PLANLÆGNING:');
    const tool = !planning && body.tools?.length && !body.messages.some(m => m.role === 'tool') ? { id: 'resume_write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(project, 'public/index.html'), content: '<h1>Fælleshuset er klar</h1><button>Tilmeld</button>' }) } } : null;
    const chunk = { id: 'resume', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, ...tool }] } : { role: 'assistant', content: planning ? plan : 'Siden er ændret. Prøv tilmeldingsknappen.' }, finish_reason: null }] };
    res.setHeader('content-type', 'text/event-stream');
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app, page;
  async function launch() {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); await require('./ui-test-helpers.cjs').skipIntroduction(page);
  }
  async function open(folder) {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.click('#open'); await page.locator('#project-name').filter({ hasText: path.basename(folder) }).waitFor();
  }
  async function draft(text) {
    await page.fill('#prompt', text); await page.locator('#draft-status').filter({ hasText: 'Kladde gemt' }).waitFor();
  }
  try {
    await launch(); await require('./ui-test-helpers.cjs').enableSharing(page); await open(project);
    const connection = await require('./ui-test-helpers.cjs').addConnection(page, { name: 'Kontrolleret lokal forbindelse', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    await require('./ui-test-helpers.cjs').taskOptions(page); await page.selectOption('#connection-select', connection.id);
    await page.locator('#model-shortlist button').first().click(); await require('./ui-test-helpers.cjs').selectMode(page, 'plan');
    await draft('Lav en side til fælleshuset. Samtalemærke: violet-cykel.'); await page.click('#send');
    await page.waitForSelector('#data-dialog[open]');
    assert.match(await page.locator('#data-warning').textContent(), /ukendte|ukendt/i);
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'datagennemgang.png') }); await page.click('#accept-send');
    await page.waitForFunction(() => !document.querySelector('#plan-card').hidden && !document.querySelector('#build-plan').disabled, null, { timeout: 60000 });
    await draft('Husk plads til fem aktiviteter.'); const beforeRestart = requests.length, catalogsBefore = catalogs;
    // Projektet, der var åbent ved lukning, åbnes igen af sig selv med samtale og kladde.
    await app.close(); app = null; await launch();
    await page.locator('#project-name').filter({ hasText: path.basename(project) }).waitFor();
    await page.locator('#resume-notice:not([hidden])').waitFor();
    assert.equal(await page.inputValue('#prompt'), 'Husk plads til fem aktiviteter.');
    assert.match(await page.locator('#messages').textContent(), /violet-cykel/);
    // Under Tidligere samtale står intet tilvalg om en ekstra kopi; det ændrede intet efter Q:B1-2 (skeptikerens fund efter G1 og G2).
    assert.equal(await page.locator('#include-history').count(), 0);
    assert.equal(await page.isVisible('#plan-card'), true);
    assert.equal(await page.inputValue('#model-select'), 'test-model');
    assert.equal(requests.length, beforeRestart); assert.equal(catalogs, catalogsBefore);
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), '<h1>Før bygning</h1>');
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'genoptaget.png') });
    // Projektvalg må ikke overføre hverken kladde eller samtale.
    await open(other); assert.equal(await page.inputValue('#prompt'), ''); assert.equal(await page.locator('#messages').textContent(), '');
    await draft('Kladde til det andet projekt');
    await page.locator('#project-list .project-name').filter({ hasText: path.basename(project) }).click();
    await page.waitForFunction(() => document.querySelector('#prompt').value === 'Husk plads til fem aktiviteter.');
    // Vilkårene er accepteret for projektet før genstarten. Bygningen sender planen uden at vise resuméet igen.
    await page.fill('#prompt', ''); await page.click('#build-plan');
    await require('./ui-test-helpers.cjs').awaitApproval(page, { timeout: 60000 });
    assert.equal(await page.locator('#data-dialog').evaluate(el => el.open), false);
    assert.ok(requests.some(r => JSON.stringify(r.messages).includes('fælleshuset')));
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), '<h1>Før bygning</h1>');
    await require('./ui-test-helpers.cjs').approve(page, 'Tillad én gang');
    await page.frameLocator('#preview').locator('h1').filter({ hasText: 'Fælleshuset er klar' }).waitFor({ timeout: 30000 });
    await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 30000 });
    // Byg og Planlæg deler motor og AI-session (8f8eb49, docs/releases/0.7.0-beta.2.md). I en fortsat session har AI'en
    // allerede samtalen, så der sendes ingen ekstra kopi, og Før du sender må ikke sige andet (README: en
    // igangværende modelsession beholder sin egen kontekst). Gennemgangen læses i hovedprocessen, fordi vilkårene er husket.
    await app.evaluate(({ app }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { ChatSession } = require('./core/chat-session.cjs'), prepare = ChatSession.prototype.prepare;
      globalThis.resumeReviews = [];
      ChatSession.prototype.prepare = async function(...args) { const review = await prepare.apply(this, args); globalThis.resumeReviews.push({ historyRequested: review.historyRequested, historyIncluded: review.historyIncluded, historyText: review.historyText, conversation: review.conversation }); return review; };
    });
    await require('./ui-test-helpers.cjs').selectMode(page, 'plan'); await draft('Vurder næste skridt.');
    const sentBefore = requests.length;
    // Skift til Planlæg ændrer ikke modtager, model, vilkår eller pris, så resuméet gentages ikke; se DESIGN.md.
    await page.click('#send');
    assert.equal(await page.locator('#data-dialog').evaluate(el => el.open), false, 'skift af arbejdsmåde gentager ikke resuméet');
    const lastUser = r => JSON.stringify([...r.messages].reverse().find(m => m.role === 'user')?.content ?? '');
    const isNext = r => lastUser(r).includes('Vurder næste skridt');
    // "Klar" står der allerede, før der sendes, så prøven venter på selve modelkaldet.
    for (let round = 0; round < 180 && !requests.slice(sentBefore).some(isNext); round++) await new Promise(resolve => setTimeout(resolve, 500));
    await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 60000 });
    const next = requests.slice(sentBefore).find(isNext);
    assert.ok(next, 'beskeden nåede modellen');
    // Mærket står også i planafklaringen i systemteksten, så kun brugerbeskederne beviser sessionens historik.
    assert.ok(next.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('violet-cykel')), 'modellen har den første besked fra den fortsatte AI-session');
    assert.equal(JSON.stringify(next.messages).includes('Tidligere beskeder fra samme samtale'), false, 'ingen ekstra kopi i en fortsat session');
    const review = await app.evaluate(() => globalThis.resumeReviews.at(-1));
    assert.ok(review, 'gennemgangen blev læst');
    assert.equal(review.historyIncluded, false, 'Før du sender lover ingen ekstra kopi, der ikke sendes');
    assert.equal(review.conversation, '');
    // Linjen siger, hvad den fortsatte AI-session har, og intet om en kopi, der ikke sendes (N:B1-4, DESIGN.md:57).
    assert.equal(review.historyText, 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater.');
    // Ny samtale starter en tom samtale ved siden af den gamle, som bevares i sidepanelet; projektfilerne er uændrede.
    await page.click('#project-list .project-entry.is-current .project-add'); await page.waitForFunction(() => document.querySelector('#messages').textContent === '');
    assert.equal(await page.inputValue('#prompt'), ''); assert.equal(await page.isVisible('#plan-card'), false);
    const state = await page.evaluate(() => window.harness.connectionState()); assert.equal(state.value.workspace.messages.length, 0);
    const storage = path.join(root, 'appdata', 'harness', 'workspaces');
    const chatFolder = require('node:crypto').createHash('sha256').update(project).digest('hex') + '-chats';
    assert.equal((await fs.readdir(path.join(storage, chatFolder))).length, 2, 'den gamle samtale er bevaret som sin egen fil');
    await page.locator('#project-list .chat-row').filter({ hasText: 'Lav en side til fælleshuset' }).waitFor();
    assert.match(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), /Fælleshuset er klar/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720));
    await page.locator('#prompt').focus(); assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ animations: 'disabled', path: path.join(root, 'lille-vindue.png') });
    await require('./ui-test-helpers.cjs').menuClick(page, '#skills-button'); await page.screenshot({ animations: 'disabled', path: path.join(root, 'skills.png') }); await page.click('[data-close="skills-dialog"]'); await page.click('[data-close="features-dialog"]');
    await page.click('#deploy-button'); await page.screenshot({ animations: 'disabled', path: path.join(root, 'deling.png') });
    await page.click('[data-close="deployment-dialog"]');
    // Uden tidligere samtale er det de samme vilkår, som allerede er accepteret i projektet.
    await draft('afbrudt-test: bevar denne besked ved lukning'); await page.click('#send');
    await page.locator('#stop:not([hidden])').waitFor(); assert.equal(await page.locator('#data-dialog').evaluate(el => el.open), false);
    await page.locator('#messages .assistant').filter({hasText:'Delvist svar før lukning.'}).waitFor({timeout:60000});
    await app.close(); app = null; await launch();
    const requestCount = requests.length;
    await page.locator('#project-name').filter({hasText:path.basename(project)}).waitFor();
    await page.locator('#resume-notice summary').filter({hasText:'afbrudt'}).waitFor();
    assert.match(await page.inputValue('#prompt'), /bevar denne besked/);
    assert.match(await page.locator('#messages').textContent(), /Delvist svar før lukning/);
    assert.equal(await page.isVisible('#plan-card'), false); assert.equal(requests.length,requestCount);
    assert.equal(await page.isVisible('#stop'), false);

    console.log(JSON.stringify({ status: 'bestået', root, checks: ['rigtig genstart med plan, kladde og samtale', 'genåbning uden netværkskald', 'kladders adskillelse mellem projekter', 'accepterede vilkår huskes efter genstart; filgodkendelse efter genstart', 'tilvalg af tidligere samtale gentager ikke resuméet', 'rigtig filændring og preview', 'samme AI-session fortsætter med tidligere beskeder efter genstart og på tværs af Byg og Planlæg; Før du sender lover ingen ekstra kopi, der ikke sendes','ny samtale ved siden af den gamle med bevarede filer', '980 × 720, tastaturfokus og dialoger', 'lukning under streaming bevarer delvist svar uden genstart'] }));
  } catch (error) { if (page) { await page.screenshot({ animations: 'disabled', path: path.join(root, 'fejl.png'), timeout: 3000 }).catch(() => {}); console.error('Testmateriale: ' + root); } throw error; }
  finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
