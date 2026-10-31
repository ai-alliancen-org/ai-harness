// Rigtig Electron og OpenCode mod en lokal strøm med bevidst forsinkelse. Ingen betalte modelkald.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-chat-feedback-')));
  const project = path.join(root, 'Projekt med mellemrum'); await fs.mkdir(project);
  const requests = [], errors = []; let release, finish, app;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'test-model', name: 'Testmodel' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    await new Promise(resolve => { release = resolve; });
    if (res.destroyed) return;
    res.setHeader('content-type', 'text/event-stream');
    const send = (delta, done = false) => res.write('data: ' + JSON.stringify({ id: 'feedback', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: done ? 'stop' : null }], ...(done ? { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } } : {}) }) + '\n\n');
    send({ role: 'assistant', content: 'Farver: #abc, #aabbcc, #abcd og #aabbccdd. Ugyldig: #12345. HTML forbliver tekst: <img src=x onerror="alert(1)">.\n\n' });
    // En lang, faktisk strøm giver tid til at prøve manuel rulning, mens teksten vokser.
    for (let i = 0; i < 100 && !res.destroyed; i++) {
      send({ content: `Afsnit ${i + 1}: Her kommer en ny del af svaret fra den lokale testserver.\n\n` });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => { finish = resolve; });
    if (!res.destroyed) { send({}, true); res.end('data: [DONE]\n\n'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    await app.evaluate(() => {
      const fetch = global.fetch;
      global.fetch = (url, options) => { if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(String(url))) throw Error('Kun lokal netadgang i prøven.'); return fetch(url, options); };
    });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page);
    await helpers.addConnection(page, { name: 'Min lokale model', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    // Læsning af en utilgængelig mappe afvises før første besked og uden automatisk skrivning.
    await fs.chmod(project, 0o000);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.locator('#message.error').filter({ hasText: /adgang/ }).waitFor();
    await fs.chmod(project, 0o700); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    assert.deepEqual(await fs.readdir(project), [], 'åbning af mappe må ikke oprette projektfiler');
    await page.waitForFunction(() => document.querySelector('#model-select').options.length === 2);
    await helpers.taskOptions(page); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');
    await page.fill('#prompt', 'Forklar et forslag til en Python-backend og hvordan vi kan udgive den.');
    await page.click('#send'); await page.waitForSelector('#data-dialog[open]'); await page.click('#accept-send');
    await page.waitForSelector('#agent-activity:not([hidden])', { timeout: 3000 }); assert.equal(await page.isVisible('#stop'), true);
    await page.waitForFunction(() => /Starter|Arbejder/.test(document.querySelector('#run-status').textContent));
    while (!release) await new Promise(resolve => setTimeout(resolve, 100));
    await page.locator('#agent-progress').filter({ hasText: 'Ingen nye signaler' }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.activity-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.screenshot({ path: path.join(root, 'venter.png') }); release();
    await page.locator('#messages .color-swatch').first().waitFor();
    assert.equal(await page.locator('#messages .color-swatch').count(), 4);
    assert.equal(await page.locator('#messages img').count(), 0);
    await page.screenshot({ path: path.join(root, 'farveproever.png') });
    await page.locator('#agent-progress').filter({ hasText: 'tegn modtaget' }).waitFor();
    await page.locator('#messages').filter({ hasText: 'Afsnit 25:' }).waitFor();
    assert.equal(await page.locator('#chat-content').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50), true, 'nye svar følges, når man står nederst');
    await page.locator('#chat-content').hover(); await page.mouse.wheel(0, -600);
    await page.waitForFunction(() => !document.querySelector('#chat-latest').hidden);
    const scroll = await page.locator('#chat-content').evaluate(el => el.scrollTop);
    await page.locator('#messages').filter({ hasText: 'Afsnit 55:' }).waitFor();
    assert.ok(Math.abs(await page.locator('#chat-content').evaluate(el => el.scrollTop) - scroll) < 5, 'rulning bevares under nye svar');
    await page.screenshot({ path: path.join(root, 'farver-og-rulning.png') });
    await page.click('#chat-latest');
    await page.locator('#messages').filter({ hasText: 'Afsnit 90:' }).waitFor();
    assert.equal(await page.locator('#chat-content').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 50), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.activity-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 100)); finish();
    await page.locator('#run-status').filter({ hasText: 'Klar' }).waitFor({ timeout: 30000 });
    assert.equal(await page.isVisible('#agent-activity'), false);
    assert.match(await page.locator('#usage-status').textContent(), /20.*10/);
    // Kontekstmålingen står i statuslinjens detaljer med det faktisk målte kald, aldrig samtalens samlede forbrug.
    const kontekst = await page.locator('#usage-status').getAttribute('title');
    // Prøvens model oplyser ikke sit kontekstvindue, så der vises ingen procent af Auras reservetal.
    assert.match(kontekst, /Seneste modelkald brugte 20 tokens kontekst/);
    assert.match(kontekst, /Grænsen er ikke oplyst for denne model/);
    assert.match(kontekst, /ikke samtalens samlede forbrug/);
    assert.equal(await page.isVisible('#context-warning'), false, 'langt fra grænsen står der ingen advarsel i første lag');
    // Advarslen nær grænsen vises i den rigtige brugerflade med syntetiske tal; prøven kan ikke nå 200.000 tokens.
    await page.evaluate(() => { window.maaltKontekst = view.contextUsage; view.contextUsage = { ...view.contextUsage, known: true, inputTokens: 170000, limitTokens: 200000, percentage: 85, reason: null }; renderContextUsage(); });
    assert.match(await page.locator('#context-warning').textContent(), /85 % af grænsen på 200\.000 tokens/);
    assert.match(await page.locator('#usage-status').getAttribute('title'), /170\.000 af 200\.000 tokens/);
    await page.evaluate(() => { view.contextUsage = window.maaltKontekst; delete window.maaltKontekst; renderContextUsage(); });
    assert.equal(await page.isVisible('#context-warning'), false, 'advarslen forsvinder igen med den rigtige måling');
    const instructions = JSON.stringify(requests[0].messages);
    assert.match(instructions, /Python med FastAPI/); assert.match(instructions, /Node.js med TypeScript/);
    // Udgivelsesvejledningen fra core/hosting-guidance.cjs når modellen uændret. Udgivelse er ikke slået til i prøven.
    assert.ok(instructions.includes(JSON.stringify(require('../core/hosting-guidance.cjs').guidance(false)).slice(1, -1)), 'hostingvejledningen står i modelkaldet');
    assert.match(instructions, /Azure Static Web Apps, Cloudflare Pages, GitHub Pages, komplai Run, Promte Apps og Vercel/); assert.match(instructions, /Netlify Drop har vejledning, men ingen uploadintegration/);
    assert.match(instructions, /pladsholder, ikke et vedtaget design/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, requests: requests.length, checks: ['mappeadgang', 'synlig opstart', 'lang tavshed', 'rigtig streaming', 'fire farveformater', 'HTML som tekst', 'manuel rulning', 'seneste svar', 'reduceret bevægelse', 'faktiske tokens', 'kontekstmåling i detaljerne og advarsel nær grænsen', 'Python/Node/hosting i modelkald'] }));
  } catch (error) { if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {}); console.error('Evidens:', root, errors); throw error; }
  finally { release?.(); finish?.(); await fs.chmod(project, 0o700); await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
