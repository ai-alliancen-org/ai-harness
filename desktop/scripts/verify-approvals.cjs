// Godkendelser og fejl i Electron: konkrete godkendelseskort med diff og kommando, afvis med besked, der lader AI'en
// fortsætte, afvis, der stopper, Stop med fortrydelse, fejltyper fra modelserveren og kontroller med faktiske resultater,
// herunder Auras egen kontrol af forhåndsvisningen. Den rigtige OpenCode-motor bruges med en kontrolleret lokal
// modelserver og et nyt projekt med Git i en midlertidig mappe; dette repository røres ikke.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-godkend-')));
  const documents = path.join(root, 'Dokumenter'); await fs.mkdir(documents);
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const requests = []; let project = null, mode = 'ok';
  const page1 = '<!doctype html><html lang="da"><meta charset="utf-8"><title>Lokaler</title><h1>Find et lokale</h1><p>Tre lokaler.</p><script>console.error("Kunne ikke hente lokalerne")</script></html>\n';
  // Modelserveren: hver besked styrer et forløb af værktøjskald. Tekst fra værktøjsresultater bruges til at fortsætte.
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'godkend-model', name: 'Kontrolleret model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    if (body.tools?.length && ['key', 'quota'].includes(mode)) { res.writeHead(mode === 'key' ? 401 : 402, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'PRIVAT_LEVERANDØRSVAR' } })); }
    const text = m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const lastUser = body.messages.findLastIndex(m => m.role === 'user'), last = lastUser >= 0 ? text(body.messages[lastUser]) : '';
    const tools = body.messages.slice(lastUser).filter(m => m.role === 'tool');
    let step;
    if (!body.tools?.length) step = { text: 'Titel' };
    else if (mode === 'stream') step = { broken: true };
    else if (last.includes('RET FIL') && tools.length === 0) step = { tool: 'write', args: { filePath: path.join(project, 'public/index.html'), content: page1 } };
    else if (last.includes('RET FIL') && tools.length === 1) step = { tool: 'bash', args: { command: 'echo "1 test fejlede" && exit 1', description: 'Kører testene' } };
    else if (last.includes('RET FIL')) step = { text: 'Jeg rettede siden. Testen fejlede, se resultatet.' };
    else if (last.includes('INSTALLER') && tools.length === 0) step = { tool: 'bash', args: { command: 'npm install leftpad-ukendt', description: 'Installerer en hjælpepakke' } };
    else if (last.includes('INSTALLER')) step = { text: JSON.stringify(tools).includes('following feedback') ? 'Forstået. Jeg skriver funktionen selv uden en pakke.' : 'Uventet.' };
    else if (last.includes('SLET') && tools.length === 0) step = { tool: 'bash', args: { command: 'rm -rf public', description: 'Rydder op' } };
    else if (last.includes('STOP') && tools.length === 0) step = { tool: 'write', args: { filePath: path.join(project, 'public/stop.html'), content: '<h1>Delvis</h1>\n' } };
    else if (last.includes('STOP')) step = { hold: true };
    else step = { text: 'Det er gjort.' };
    if (step.broken) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Halvt' }, finish_reason: null }] }) + '\n\n'); setTimeout(() => res.destroy(), 50); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } } : {}) }) + '\n\n');
    if (step.hold) { send({ role: 'assistant', content: 'Jeg arbejder videre …' }); return; }
    if (step.tool) send({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${requests.length}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
    else send({ role: 'assistant', content: step.text });
    send({}, step.tool ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const checks = []; const passed = text => { checks.push(text); console.log('✓ ' + text); };
  const errors = []; let app, page;
  const capture = async name => { const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(root, name), Buffer.from(png, 'base64')); };
  const send = async text => {
    await page.fill('#prompt', text); await page.click('#send');
    // "Klar" står der allerede, før der sendes, så den må ikke tælle med: ellers blev dialogen set, før den åbnede.
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden || /Fejl/.test(document.querySelector('#run-status').textContent));
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
  };
  const idle = () => page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 90000 });
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.isolateDocuments(app, documents); await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    await page.fill('#purpose', 'En side med mødelokaler.'); await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
    project = path.join(documents, 'Aura', (await fs.readdir(path.join(documents, 'Aura')))[0]);
    await helpers.addConnection(page, { name: 'Kontrolleret', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');

    // Filændring: kortet siger hvad og hvor meget, viser ændringen, og statuslinjen siger, at AI'en venter.
    await send('RET FIL og kør testene');
    const card = page.locator('#approvals .approval').first(); await card.waitFor({ timeout: 90000 });
    assert.equal(await card.locator('.approval-kind').textContent(), 'Godkendelse · Filændring');
    assert.equal(await card.locator('.approval-title').textContent(), 'Må AI’en ændre filer i projektet?');
    const what = await card.locator('.approval-facts dd').first().innerText();
    assert.match(what, /^public\/index\.html · \d+ linjer? tilføjet, \d+ fjernet$/);
    assert.equal(await card.locator('details').first().evaluate(el => el.open), false);
    await card.locator('summary', { hasText: 'Se ændringen' }).click();
    assert.match(await card.locator('.approval-diff').innerText(), /Tilføjet:\s*<!doctype html>[^\n]*<h1>Find et lokale<\/h1>/);
    assert.match(await card.locator('.approval-scope').textContent(), /En gemt tilladelse gælder projektets filer/);
    assert.equal(await page.locator('#run-status').textContent(), 'Venter på dig');
    assert.equal(await page.locator('#agent-activity-text').textContent(), 'Venter på dig: Må AI’en ændre filer i projektet?');
    assert.equal(await page.isVisible('#connection-warning'), false);
    await page.locator('#messages').evaluate(el => { el.closest('.chat-content').scrollTop = 0; });
    await page.click('#agent-activity-jump');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.approval') !== null), true, 'Vis flytter fokus til kortet');
    await capture('godkendelse-fil.png');
    passed('Filgodkendelsen viser filen, antal linjer, ændringen og omfanget; statuslinjen siger, at AI’en venter, og Vis fører til kortet');

    await card.getByRole('button', { name: 'Tillad én gang', exact: true }).click();
    const command = page.locator('#approvals .approval').first(); await command.locator('.approval-kind', { hasText: 'Kommando' }).waitFor({ timeout: 90000 });
    assert.equal(await command.locator('code.action-target').textContent(), 'echo "1 test fejlede" && exit 1');
    assert.match(await command.locator('.approval-facts').innerText(), /Hvorfor\s+AI’ens begrundelse: Kører testene/);
    assert.match(await command.locator('.approval-hints').innerText(), /Ser ud til kun at læse eller vise noget/);
    assert.match(await command.locator('.approval-facts').innerText(), /Et gæt ud fra kommandoens tekst, ikke en kontrol/);
    assert.equal(await command.locator('.approval-actions button.primary').count(), 0, 'en kommando har ingen fremhævet Tillad-knap');
    assert.match(await page.locator('#messages .answer-record').last().textContent(), /1 handling godkendt/);
    await command.locator('button', { hasText: 'Tillad én gang' }).click();
    await idle();
    passed('Kommandokortet viser kommandoen, AI’ens begrundelse og et gæt i almindeligt dansk uden en fremhævet Tillad');

    // Resultatkortet kvitterer kun for ændringerne; de faktiske kontroller står i Aktivitet (5ffe905).
    const review = page.locator('#run-review');
    assert.match(await review.locator('.result-receipt').textContent(), /fil ændret|filer ændret/);
    await page.click('#tab-activity');
    // Forhåndsvisningen: Aura genindlæser siden efter opgaven og siger, hvad den svarede. docs/decisions.md.
    await page.locator('.activity-entry.kind-check', { hasText: 'Siden blev vist · 1 fejl i siden: Kunne ikke hente lokalerne' }).waitFor({ timeout: 30000 });
    // Kommandoen: afslutningskoden og de sidste linjer af output.
    const kommando = page.locator('.activity-entry.kind-tool').filter({ hasText: 'echo "1 test fejlede" && exit 1' }).first();
    await kommando.waitFor({ timeout: 30000 });
    assert.match(await kommando.locator('.activity-state').innerText(), /afslutningskode 1/);
    await kommando.locator('summary', { hasText: 'Vis output' }).click();
    assert.match(await kommando.locator('pre').first().textContent(), /1 test fejlede/);
    await page.click('#tab-preview');
    await capture('resultat-kontroller.png');
    passed('Kontrollerne viser faktiske resultater: sidens konsolfejl fra forhåndsvisningen og kommandoens afslutningskode og output');

    // Afvis med en besked: AI'en fortsætter med beskeden som rettelse.
    await send('INSTALLER en pakke');
    const install = page.locator('#approvals .approval').first(); await install.waitFor({ timeout: 90000 });
    assert.match(await install.locator('.approval-hints').innerText(), /Installerer pakker fra internettet/);
    // Afvis med en besked ligger bag Flere valg (ui/approvals.js:143-176). Hjælperen folder ud, hvis knappen er skjult.
    await helpers.approve(page, 'Afvis med en besked', { scope: install });
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
    await install.locator('textarea').fill('Brug ikke en pakke. Skriv funktionen selv.');
    await install.locator('button', { hasText: 'Afvis og send beskeden' }).click();
    await page.locator('#messages .assistant', { hasText: 'Forstået. Jeg skriver funktionen selv uden en pakke.' }).waitFor({ timeout: 90000 });
    await idle();
    assert.ok(requests.some(body => JSON.stringify(body.messages).includes('with the following feedback: Brug ikke en pakke. Skriv funktionen selv.')));
    // Kvitteringen i samtalen er kort. Hvilken handling der blev afvist, og hvad brugeren skrev, står i Aktivitet (5ffe905).
    assert.match(await page.locator('#messages .answer-record').last().textContent(), /Du afviste 1 handling og skrev: Brug ikke en pakke/);
    await page.click('#tab-activity');
    const afvist = page.locator('.activity-entry.kind-approval').filter({ hasText: 'npm install leftpad-ukendt' }).last();
    await afvist.waitFor({ timeout: 30000 });
    assert.match(await afvist.locator('.activity-state').innerText(), /Du afviste den med en besked/);
    assert.match(await afvist.locator('.activity-detail').innerText(), /Din besked: Brug ikke en pakke/);
    await page.click('#tab-preview');
    // Opgaven fortsatte, så kortet er kvitteringen uden overskrift, ikke afvisningskortet. textContent læser
    // også et skjult kort, så påstanden ikke afhænger af, om kortet er fremme.
    assert.doesNotMatch(await review.textContent(), /Du afviste en handling/);
    passed('Afvis med en besked giver AI’en beskeden som rettelse, og opgaven fortsætter');

    // Afvis uden besked: opgaven stopper, og kortet siger, hvad der blev afvist, med en vej videre.
    await send('SLET den gamle mappe');
    const remove = page.locator('#approvals .approval').first(); await remove.waitFor({ timeout: 90000 });
    assert.match(await remove.locator('.approval-hints').innerText(), /Kan slette eller overskrive filer/);
    await remove.locator('.approval-actions button', { hasText: 'Afvis' }).click();
    await idle();
    await review.locator('h3', { hasText: 'Du afviste en handling, så AI’en stoppede' }).waitFor();
    assert.match(await review.innerText(), /Afvist: køre en kommando · rm -rf public\./);
    await review.locator('button', { hasText: 'Skriv, hvad AI’en skal gøre i stedet' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt'); assert.equal(await page.inputValue('#prompt'), 'Gør det på en anden måde: ');
    assert.ok(await fs.stat(path.join(project, 'public')));
    passed('Afvis stopper opgaven; kortet siger, hvad der blev afvist, og tilbyder at skrive, hvad AI’en skal gøre i stedet');

    // Stop efter en filændring: kortet viser det, AI'en nåede, og kan fortryde det.
    await page.fill('#prompt', '');
    await send('STOP undervejs');
    await require('./ui-test-helpers.cjs').approve(page, 'Tillad for denne opgave');
    await page.locator('#messages .assistant', { hasText: 'Jeg arbejder videre' }).waitFor({ timeout: 90000 });
    await page.click('#stop'); await page.locator('#run-status').filter({ hasText: 'Stoppet' }).waitFor({ timeout: 30000 });
    await review.locator('h3', { hasText: 'Du stoppede opgaven' }).waitFor();
    assert.match(await review.innerText(), /AI’en nåede at ændre 1 fil:\s*public\/stop\.html/);
    assert.equal(await page.inputValue('#prompt'), 'STOP undervejs');
    // Fortryd hedder nu Fortryd opgaven og ligger bag Flere valg på resultatkortet (5ffe905).
    await (await helpers.resultOption(page, 'Fortryd opgaven')).click();
    await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled); await page.click('#restore-confirm');
    await page.waitForSelector('#restore-dialog:not([open])', { state: 'attached' });
    await assert.rejects(fs.stat(path.join(project, 'public/stop.html')), 'filen fra den stoppede opgave er fortrudt');
    passed('Efter Stop viser kortet, hvad AI’en nåede, beskeden står klar, og Fortryd det, den nåede, sætter filen tilbage');

    // Fejl: én besked på resultatkortet med en vej videre efter typen. Ingen rød linje og ingen advarselsboks ved siden af.
    for (const [failure, title, actionText] of [['key', 'AI’en afviste din nøgle', 'Gennemgå AI-forbindelse'], ['quota', 'Kontoen hos udbyderen er brugt op', 'Gennemgå AI-forbindelse'], ['stream', 'Forbindelsen til AI’en blev afbrudt', 'Prøv igen']]) {
      mode = failure; await send(`Prøve med ${failure}`); await idle();
      await review.locator('h3', { hasText: title }).waitFor({ timeout: 60000 });
      assert.equal(await review.locator('.review-actions button.primary').textContent(), actionText);
      assert.equal(await page.locator('#messages .chat-message.error').count(), 0); assert.equal(await page.isVisible('#connection-warning'), false);
      assert.equal(await page.inputValue('#prompt'), `Prøve med ${failure}`);
      assert.doesNotMatch(await page.locator('#messages').innerText(), /PRIVAT_LEVERANDØRSVAR/);
      if (failure !== 'stream') { await review.locator('summary', { hasText: 'Se detaljer' }).click(); assert.match(await review.locator('.review-details pre').textContent(), new RegExp(`HTTP ${failure === 'key' ? 401 : 402}`)); }
      if (failure === 'key') await capture('fejl-noegle.png');
    }
    mode = 'ok'; await review.locator('button', { hasText: 'Prøv igen' }).click(); await idle();
    await page.locator('#messages .assistant', { hasText: 'Det er gjort.' }).last().waitFor();
    passed('Nøgle, kvote og afbrudt forbindelse får hver sin forklaring og handling på ét kort; Prøv igen sender beskeden igen');

    // 980 × 720: godkendelseskortet kan læses, og knapperne er synlige.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980, 720)); await page.waitForTimeout(400);
    await send('RET FIL igen'); const small = page.locator('#approvals .approval').first(); await small.waitFor({ timeout: 90000 });
    const fits = await small.evaluate(el => { const box = el.getBoundingClientRect(), chat = el.closest('.chat').getBoundingClientRect(); return box.left >= chat.left && box.right <= chat.right + 1 && document.documentElement.scrollWidth <= innerWidth; });
    assert.ok(fits); await small.locator('.approval-actions').scrollIntoViewIfNeeded(); await capture('godkendelse-980.png');
    await page.click('#stop'); await page.locator('#run-status').filter({ hasText: 'Stoppet' }).waitFor({ timeout: 30000 });
    passed('Ved 980 × 720 holder godkendelseskortet sig inden for samtalen uden vandret rulning');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: checks.length }, null, 2));
  } catch (error) {
    console.error(error);
    try { await page?.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }); console.error('Skærmbillede:', path.join(root, 'fejl.png')); } catch {}
    process.exitCode = 1;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})();
