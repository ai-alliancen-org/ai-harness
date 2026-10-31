// Afklaring og plan i Electron: AI'ens spørgsmål ét ad gangen med klikbare svar, projektbriefen, en forståelig plan,
// der kan rettes af brugeren og af AI'en, og genåbning efter bygning, Stop og genstart. Den rigtige OpenCode-motor
// bruges med en kontrolleret lokal modelserver og et nyt projekt i en midlertidig mappe. Projektet får Git fra start,
// så appen gemmer versioner dér; dette repository røres ikke.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');

const plan = version => [
  'Jeg har læst briefen og dine svar.', '',
  '## Det bygger vi', version === 1 ? 'En side med tre fiktive mødelokaler og et felt til antal deltagere.' : `Version ${version}: en side med tre fiktive mødelokaler, et filter og en kalender.`, '',
  '## Sådan skal det se ud', 'Rolige kort med lokalets navn og antal pladser.', '',
  '## Teknik og data', 'HTML, CSS og JavaScript med lokale eksempeldata. Ingen backend.', '',
  '## Det skal du prøve', '- Skriv 8 i feltet, og se, at kun de store lokaler vises.', '- Prøv siden på mobilbredde.'
].join('\n');
const questions = [
  { question: 'Hvem skal kunne bruge siden?', header: 'Brugere', options: [{ label: 'Kun personalet', description: 'Med login fra arbejdspladsen' }, { label: 'Alle borgere (anbefalet)', description: 'Uden login, kun offentlige oplysninger' }] },
  { question: 'Hvad skal med i første version?', header: 'Første version', multiple: true, options: [{ label: 'Liste over lokaler', description: 'Navn, plads og udstyr' }, { label: 'Filter efter antal', description: 'Vis kun lokaler med plads nok' }, { label: 'Kalender', description: 'Ledige tider' }] },
  { question: 'Hvor skal oplysningerne om lokalerne ligge?', header: 'Data', options: [{ label: 'I siden', description: 'Faste eksempeldata' }, { label: 'I et regneark', description: 'Kræver en integration' }] }
];

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-plan-')));
  const documents = path.join(root, 'Dokumenter'); await fs.mkdir(documents);
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const requests = []; let project = null, mode = 'normal';
  // Modelserveren: første planlægning og "SPØRG IGEN" stiller spørgsmål med question-værktøjet; efter svaret kommer planen.
  // "Ret forslaget" giver en ny plan, "STOP" svarer aldrig færdigt, og bygning skriver siden.
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'plan-model', name: 'Kontrolleret planmodel' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const text = m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lastUser = body.messages.findLastIndex(m => m.role === 'user'), last = lastUser >= 0 ? text(body.messages[lastUser]) : '';
    const toolsSince = body.messages.slice(lastUser).filter(m => m.role === 'tool').length;
    const system = JSON.stringify(body.messages.filter(m => m.role === 'system'));
    const planning = system.includes('PLANLÆGNING:'), building = system.includes('Byg efter denne plan');
    let step;
    if (!body.tools?.length) step = { text: 'Titel' };
    else if (last.includes('STOP')) step = { hold: true };
    else if (planning && last.includes('opdateret plan')) step = { text: plan(4) };
    else if (planning && toolsSince === 0 && (last.includes('mødelokaler') || last.includes('SPØRG IGEN'))) step = { tool: 'question', args: { questions: last.includes('SPØRG IGEN') ? [questions[2]] : questions } };
    else if (planning && last.includes('SPØRG IGEN')) step = { text: plan(3) };
    else if (planning && last.includes('Ret forslaget')) step = { text: plan(2) };
    else if (planning) step = { text: plan(1) };
    else if (building && toolsSince === 0) step = { tool: 'write', args: { filePath: path.join(project, 'public/index.html'), content: '<!doctype html><html lang="da"><meta charset="utf-8"><h1>Find et mødelokale</h1></html>' } };
    else step = { text: 'Siden er bygget. Prøv filteret.' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'plan', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } } : {}) }) + '\n\n');
    if (step.hold) { send({ role: 'assistant', content: 'Jeg går i gang med en ny plan …' }); return; }
    if (step.tool) send({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${requests.length}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
    else send({ role: 'assistant', content: step.text });
    send({}, step.tool ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const checks = []; const passed = text => { checks.push(text); console.log('✓ ' + text); };
  let app, page;
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.isolateDocuments(app, documents);
    await helpers.skipIntroduction(page);
  };
  const errors = [];
  const selected = () => page.locator('.work-tab[aria-selected="true"]').getAttribute('data-tab');
  const sendPrompt = async () => {
    await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
  };
  try {
    await launch();
    // Projektet oprettes med en idé og to ønsker. Ønskerne kommer i briefen, ikke i beskeden.
    await helpers.toOnboarding(page);
    await page.fill('#purpose', 'Jeg vil lave en oversigt over tre fiktive mødelokaler.');
    await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
    project = path.join(documents, 'Aura', (await fs.readdir(path.join(documents, 'Aura')))[0]);
    await page.fill('#prompt', '');
    await page.locator('#idea-options').evaluate(el => { el.open = true; });
    await page.selectOption('#idea-platform', { label: 'Browser' }); await page.selectOption('#idea-data', { label: 'Kun data på den enkelte enhed' });
    await page.click('#start-idea');
    assert.equal(await page.inputValue('#prompt'), 'Jeg vil lave en oversigt over tre fiktive mødelokaler.');
    await page.locator('#message').filter({ hasText: 'Dine ønsker står i projektbriefen under Plan.' }).waitFor();
    await page.click('#tab-plan');
    assert.deepEqual(await page.locator('#brief-list dt .brief-label').allTextContents(), ['Idé', 'Platform', 'Data']);
    assert.deepEqual(await page.locator('#brief-list .brief-source').allTextContents(), ['Din idé', 'Dit ønske', 'Dit ønske']);
    assert.match(await page.locator('#plan-empty').textContent(), /Ingen plan endnu/);
    await page.click('#tab-preview');
    passed('Idéen og ønskerne står i projektbriefen under Plan; beskeden indeholder kun idéen');

    await helpers.addConnection(page, { name: 'Kontrolleret plan', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    // Et nyt projekt starter i Byg; se DESIGN.md. Idéens ene spørgsmål vælger Planlæg, og intet skifter af sig selv.
    assert.equal(await page.inputValue('#work-mode'), 'free');
    await helpers.closeTaskOptions(page);
    assert.equal(await page.locator('#idea-approach p').first().textContent(), 'Skal vi planlægge din idé først?');
    assert.deepEqual(await page.locator('#idea-approach button').allTextContents(), ['Planlæg først (anbefalet)', 'Byg med det samme']);
    await page.screenshot({ path: path.join(root, 'idevalg.png'), animations: 'disabled' });
    await page.click('#plan-idea-first');
    assert.equal(await page.isVisible('#idea-approach'), false);
    assert.equal(await page.inputValue('#work-mode'), 'plan');
    passed('Idéen får ét spørgsmål med to valg, og Planlæg først sætter arbejdsmåden');

    // Første besked: Før du sender viser briefen under alle oplysninger.
    await page.click('#send'); await page.waitForSelector('#data-dialog[open]');
    assert.match(await page.locator('#data-lead').textContent(), /projektbriefen/);
    await page.click('#data-dialog details > summary');
    assert.match(await page.locator('#data-details').innerText(), /Projektbrief, der sendes[\s\S]*Platform: Browser/);
    await page.click('#accept-send');
    await page.focus('#prompt');
    const card = page.locator('#approvals .question-card');
    await card.waitFor({ timeout: 90000 });
    const firstAsk = requests.find(body => body.tools?.length && JSON.stringify(body.messages).includes('mødelokaler'));
    assert.ok(firstAsk.tools.some(tool => tool.function?.name === 'question'), 'modellen får tilbudt question-værktøjet');
    assert.match(JSON.stringify(firstAsk.messages), /PROJEKTBRIEF[^"]*\\n- Idé: Jeg vil lave en oversigt over tre fiktive mødelokaler\.\\n- Platform: Browser\\n- Data: Kun data på den enkelte enhed/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt', 'spørgsmålet tager ikke fokus fra skrivefeltet');
    passed('Modellen får spørgeværktøjet og briefen; spørgsmålet vises uden at tage fokus');

    // Spørgsmål ét ad gangen: AI'ens anbefaling står først og er markeret; flere svar; tilbage; eget svar.
    assert.equal(await card.locator('.question-step').textContent(), 'Spørgsmål 1 af 3 · Brugere');
    assert.deepEqual(await card.locator('.answer-choice strong').allTextContents(), ['Alle borgere', 'Kun personalet']);
    assert.equal(await card.locator('.answer-choice').first().locator('.recommended').textContent(), 'AI’en anbefaler');
    assert.equal(await card.locator('.answer-choice').count(), 2);
    await page.screenshot({ path: path.join(root, 'spoergsmaal.png'), animations: 'disabled' });
    await card.locator('.answer-choice').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await card.locator('.question-step').textContent(), 'Spørgsmål 2 af 3 · Første version');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('question-title')), true);
    assert.equal(await card.locator('.primary').textContent(), 'Vælg mindst ét svar'); assert.equal(await card.locator('.primary').isDisabled(), true);
    await card.locator('.answer-choice', { hasText: 'Liste over lokaler' }).click(); await card.locator('.answer-choice', { hasText: 'Filter efter antal' }).click();
    assert.equal(await card.locator('.answer-choice[aria-pressed="true"]').count(), 2);
    await card.locator('.primary', { hasText: 'Fortsæt med 2 svar' }).click();
    assert.equal(await card.locator('.question-step').textContent(), 'Spørgsmål 3 af 3 · Data');
    await card.locator('.question-links button', { hasText: 'Tilbage' }).click();
    assert.equal(await card.locator('.answer-choice[aria-pressed="true"]').count(), 2, 'tilbage bevarer de valgte svar');
    await card.locator('.primary').click();
    assert.equal(await card.locator('textarea').isVisible(), true, 'eget svar er synligt uden ekstra klik');
    await card.locator('textarea').fill('I kommunens bookingsystem senere');
    await card.locator('button[type="submit"]').click();
    await card.waitFor({ state: 'detached' });
    assert.match(await page.locator('#messages .answer-record').last().textContent(), /Du svarede: Brugere: Alle borgere · Første version: Liste over lokaler, Filter efter antal · Data: I kommunens bookingsystem senere/);
    passed('Spørgsmålene vises ét ad gangen med klikbare svar, flere valg, Tilbage og eget svar; tastaturet virker');

    // Planen: chatkortet har et kort resumé, og fanen Plan får et mærke uden at skifte.
    await page.locator('#plan-card').waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('#build-plan').disabled);
    const answered = requests.find(body => body.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('Alle borgere')));
    assert.ok(answered, 'svarene når modellen gennem værktøjet');
    assert.match(JSON.stringify(answered.messages.filter(m => m.role === 'tool')), /Liste over lokaler/);
    assert.equal(await selected(), 'preview');
    assert.equal(await page.isVisible('#plan-badge'), true);
    assert.equal(await page.locator('#plan-summary').textContent(), 'En side med tre fiktive mødelokaler og et felt til antal deltagere.');
    await page.click('#plan-open'); assert.equal(await selected(), 'plan'); assert.equal(await page.isVisible('#plan-badge'), false);
    assert.deepEqual(await page.locator('#brief-list .brief-label').allTextContents(), ['Idé', 'Platform', 'Data', 'Brugere', 'Første version']);
    assert.equal(await page.locator('#brief-list dd .brief-value').nth(2).textContent(), 'I kommunens bookingsystem senere', 'eget svar erstatter dataønsket med samme overskrift');
    assert.equal(await page.locator('#brief-list dd .brief-value').nth(3).textContent(), 'Alle borgere', 'AI’ens markering af en anbefaling kommer ikke med i briefen');
    assert.deepEqual(await page.locator('#plan-text .plan-part > h3, #plan-text .plan-part > summary').allTextContents(), ['Det bygger vi', 'Sådan skal det se ud', 'Teknik og data', 'Det skal du prøve']);
    assert.equal(await page.locator('#plan-text details.plan-teknik').evaluate(el => el.open), false, 'teknik og data er foldet sammen');
    assert.equal(await page.locator('#plan-text .plan-proev li').count(), 2);
    assert.match(await page.locator('#plan-meta').textContent(), /^Fra AI’en i dag/);
    assert.equal(await page.locator('#plan-status').textContent(), 'Planen er klar til at blive bygget');
    await page.screenshot({ path: path.join(root, 'plan.png'), animations: 'disabled' });
    passed('Planen står under Plan i fire afsnit med teknik foldet sammen; briefen har svarene; AI’en skiftede ikke fane');

    // Brugeren retter briefen og planen selv. Den rettede plan og briefen bruges ved bygning.
    await page.locator('#brief-list dd').nth(2).locator('button').click();
    await page.fill('#brief-value', 'I siden som faste eksempeldata'); await page.click('#brief-form button[type="submit"]');
    await page.locator('#brief-feedback').filter({ hasText: 'Briefen er gemt' }).waitFor();
    assert.equal(await page.locator('#brief-list .brief-source').nth(2).textContent(), 'Rettet af dig');
    await page.locator('#plan-notice').filter({ hasText: 'Briefen er ændret, efter planen blev lavet' }).waitFor();
    await page.click('#plan-edit');
    const editor = page.locator('#plan-edit-text');
    await editor.fill((await editor.inputValue()).replace('Rolige kort', 'Rolige kort i kommunens farver'));
    await page.click('#plan-editor button[type="submit"]');
    await page.locator('#plan-meta').filter({ hasText: 'Rettet af dig i dag' }).waitFor();
    assert.equal(await page.isVisible('#plan-restore'), true);
    assert.match(await page.locator('#plan-text').innerText(), /kommunens farver/);
    passed('Brugeren retter en linje i briefen og selve planen; planen siger, at briefen er ændret bagefter');

    await page.click('#plan-build');
    await helpers.approve(page, 'Tillad for denne opgave');
    await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 90000 });
    const build = requests.find(body => JSON.stringify(body.messages).includes('Byg efter denne plan'));
    assert.match(JSON.stringify(build.messages), /som brugeren har valgt og selv rettet/);
    assert.match(JSON.stringify(build.messages), /kommunens farver/);
    assert.match(JSON.stringify(build.messages), /- Data: I siden som faste eksempeldata/);
    assert.equal(await selected(), 'plan');
    await page.locator('#plan-status').filter({ hasText: 'Planen er bygget' }).waitFor();
    assert.equal(await page.locator('#plan-build').textContent(), 'Byg igen efter planen');
    passed('Bygning bruger den rettede plan og den rettede brief; planen kan genåbnes som bygget');

    // AI'en retter planen: den gamle plan står som seneste plan, mens AI'en arbejder; den nye er AI'ens version.
    await page.click('#plan-revise');
    assert.equal(await page.inputValue('#prompt'), 'Ret forslaget: ');
    await page.fill('#prompt', 'Ret forslaget: Tilføj en kalender.'); await sendPrompt();
    await page.locator('#plan-card').waitFor({ state: 'visible', timeout: 90000 }); await page.waitForFunction(() => !document.querySelector('#build-plan').disabled);
    assert.match(await page.locator('#plan-text').innerText(), /Version 2/);
    assert.equal(await page.isVisible('#plan-restore'), false); assert.match(await page.locator('#plan-meta').textContent(), /^Fra AI’en/);
    passed('Bed AI’en rette giver en ny plan fra AI’en under Plan');

    // Stop under en ny planlægning: den seneste plan kan læses, men ikke bygges, og kan bruges til en ny plan.
    await page.fill('#prompt', 'STOP og lav en ny plan'); await sendPrompt();
    await page.locator('#messages .assistant').filter({ hasText: 'Jeg går i gang med en ny plan' }).waitFor({ timeout: 90000 });
    await page.locator('#plan-notice').filter({ hasText: 'AI’en arbejder på en ny plan' }).waitFor();
    await page.click('#stop'); await page.locator('#run-status').filter({ hasText: 'Stoppet' }).waitFor({ timeout: 30000 });
    await page.locator('#plan-notice').filter({ hasText: 'Den seneste plan kan ikke bygges, fordi du bad om en ny plan. Bed AI’en om en ny plan ud fra den.' }).waitFor();
    assert.equal(await page.isVisible('#plan-actions'), false); assert.equal(await page.isVisible('#plan-replan'), true);
    assert.match(await page.locator('#plan-text').innerText(), /Version 2/);
    await page.fill('#prompt', ''); await page.click('#plan-replan');
    assert.match(await page.inputValue('#prompt'), /^Lav en opdateret plan ud fra denne tidligere plan:\n\nJeg har læst briefen/);
    await sendPrompt(); await page.locator('#plan-actions').waitFor({ state: 'visible', timeout: 90000 });
    assert.match(await page.locator('#plan-text').innerText(), /Version 4/);
    passed('Efter Stop kan den seneste plan læses, men ikke bygges, og den bliver udgangspunkt for en ny plan');

    // Spring over: AI'en får besked og bruger sine egne antagelser.
    await page.fill('#prompt', 'SPØRG IGEN om data'); await sendPrompt();
    await card.waitFor({ timeout: 90000 });
    assert.equal(await card.locator('.question-step').textContent(), 'Spørgsmål til dig · Data');
    await card.locator('.question-links button', { hasText: 'Spring over' }).click();
    await page.locator('#messages .answer-record').filter({ hasText: 'Du sprang AI’ens spørgsmål over. AI’en vælger selv.' }).waitFor();
    await page.locator('#plan-actions').waitFor({ state: 'visible', timeout: 90000 }); assert.match(await page.locator('#plan-text').innerText(), /Version 3/);
    const skipped = requests.find(body => body.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('Brugeren springer over')));
    assert.ok(skipped, 'modellen får at vide, at den selv skal vælge');
    passed('Spring over lader AI’en vælge selv, og opgaven fortsætter til en plan');

    // Genstart: brief og plan genåbnes under Plan.
    await app.close(); await launch();
    await page.waitForSelector('#workspace:not([hidden])', { timeout: 30000 });
    assert.equal(await selected(), 'preview');
    await page.click('#tab-plan');
    assert.match(await page.locator('#plan-text').innerText(), /Version 3/);
    assert.equal(await page.locator('#brief-list dd .brief-value').nth(2).textContent(), 'I siden som faste eksempeldata');
    assert.equal(await page.isVisible('#plan-actions'), true);
    passed('Brief og plan genåbnes under Plan efter en genstart');

    // 980 × 720: fem faner på én linje, og spørgsmålskortet kan læses.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720)); await page.waitForTimeout(600);
    const tabs = await page.evaluate(() => ({ rows: new Set([...document.querySelectorAll('.work-tab:not([hidden])')].map(el => Math.round(el.getBoundingClientRect().top))).size, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(tabs.overflow, false); assert.equal(tabs.rows, 1, 'fem faner står på én linje ved 980 × 720');
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(root, 'plan-980.png'), Buffer.from(png, 'base64'));
    passed('Ved 980 × 720 står de fem faner på én linje uden vandret rulning');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: checks.length }, null, 2));
  } catch (error) {
    console.error(error);
    try { await page?.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }); console.error('Skærmbillede:', path.join(root, 'fejl.png')); } catch {}
    process.exitCode = 1;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})();
