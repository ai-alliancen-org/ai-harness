// Svarloft, indsats og komprimering gennem Aura, gatewayen og den fastlåste OpenCode med en lokal, Corti-lignende server.
// Modellen bruger første gang hele svaret på at tænke (finish_reason "length"). Fejlkortet skal tilbyde lav indsats, og en
// lang samtale skal kunne gøres kortere. Ingen eksterne modelkald: kun lokal HTTP, syntetisk nøgle og midlertidige filer.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

async function main() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-svarloft-')));
  const project = path.join(root, 'Mødelokaler');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Mødelokaler</h1>');
  const requests = [], errors = [];
  let phase = 'tænker for længe', app;
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'corti-s1', object: 'model', max_input_tokens: 1048576, capabilities: { reasoning: true, tool_call: true }, effort: { supported: true, levels: ['low', 'high', 'max'] }, cost: { input: 2, output: 8, cache_read: 0.2 } }] }));
      assert.equal(req.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      // OpenCodes sammenfatning sendes uden værktøjer; almindelige kald i Samtale og Byg har værktøjer med.
      const compaction = !body.tools?.length;
      requests.push({ phase, compaction, maxTokens: body.max_tokens, effort: body.reasoning_effort ?? null, tools: Boolean(body.tools?.length) });
      res.setHeader('content-type', 'text/event-stream');
      const send = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: finish === 'length' ? 128000 : 40, total_tokens: Math.ceil(raw.length / 4) + (finish === 'length' ? 128000 : 40) } } : {}) }) + '\n\n');
      send({ role: 'assistant' });
      // Første forsøg: kun tænkning, og svaret når loftet. Lav indsats eller en kortere samtale giver et rigtigt svar.
      if (phase === 'tænker for længe' && !compaction && body.reasoning_effort !== 'low') { send({ reasoning_content: 'Lang overvejelse …' }); send({}, 'length'); }
      else { send({ content: compaction ? 'Sammenfatning: brugeren vil have en side med mødelokaler.' : 'Her er svaret.' }); send({}, 'stop'); }
      res.end('data: [DONE]\n\n');
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    // Kun testprocessens HTTP-transport omdirigeres. Den rigtige Corti-forbindelse, gateway og OpenCode bruges uændret.
    await app.evaluate((_, origin) => {
      const actual = globalThis.fetch;
      globalThis.fetch = (input, options) => {
        const url = String(input);
        if (url.startsWith('https://ai.eu.corti.app/v1/')) return actual(url.replace('https://ai.eu.corti.app', origin), options);
        if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error('Prøven tillader kun lokale HTTP-kald.');
        return actual(input, options);
      };
    }, `http://127.0.0.1:${server.address().port}`);
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await helpers.skipIntroduction(page);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    await helpers.openSetup(page); await page.click('#setup-add-provider'); await helpers.chooseProviderCard(page, 'corti');
    await page.click('#enter-key'); await helpers.enterCredential(app, 'c3ludGV0aXNrLWNvcnRpLW5vZWdsZQ==');
    await page.waitForFunction(() => document.querySelector('#setup').dataset.step === 'saved' && !document.querySelector('#setup-continue').disabled);
    await page.click('#setup-continue'); await page.waitForSelector('#workspace:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#model-select').value === 'corti-s1');
    // En indsats, modellen ikke tager imod, afvises, før noget sendes.
    await assert.rejects(page.evaluate(async () => { const r = await window.harness.prepare({ mode: 'chat', effort: 'ekstrem', connectionID: document.querySelector('#connection-select').value, modelID: 'corti-s1', references: [], fileRefs: [] }); if (!r.ok) throw new Error(r.error); }), /tager ikke imod den valgte indsats/);
    async function send(text) {
      await page.fill('#prompt', text); await page.click('#send');
      await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
      if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
      await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 120000 });
    }
    // To beskeder, så samtalen er lang nok til, at den kan gøres kortere. Den første får et svar.
    phase = 'første svar'; await send('Hvad skal siden vise?');
    phase = 'tænker for længe'; await send('Byg hele siden med alle lokaler.');
    const card = page.locator('#run-review');
    await card.locator('h3', { hasText: 'AI’en stoppede uden et resultat' }).waitFor();
    assert.match(await card.innerText(), /brugte hele svaret på at tænke/);
    const buttons = await card.locator('button').allTextContents();
    assert.deepEqual(buttons, ['Prøv igen med lav indsats', 'Gør samtalen kortere og prøv igen', 'Prøv igen']);
    await page.screenshot({ path: path.join(root, 'fejlkort.png'), animations: 'disabled' });
    // Hvert kald fik OpenCodes hævede loft og modellens eget svarloft, ikke 32.000.
    assert.ok(requests.every(r => r.maxTokens === 128000), 'max_tokens: ' + JSON.stringify(requests.map(r => r.maxTokens)));
    assert.ok(requests.every(r => r.effort === null), 'ingen indsats uden brugerens valg');
    // Lav indsats: næste kald har reasoning_effort low, og indsatsen står under skrivefeltet.
    let before = requests.length;
    await card.locator('button', { hasText: 'Prøv igen med lav indsats' }).click();
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 120000 });
    assert.ok(requests.slice(before).length && requests.slice(before).every(r => r.effort === 'low'), JSON.stringify(requests.slice(before)));
    assert.match(await page.locator('#model-chip').textContent(), /lav indsats/);
    await page.locator('#messages').filter({ hasText: 'Her er svaret.' }).waitFor();
    // Tilbage til udbyderens standard: et nyt forsøg uden indsats tænker igen for længe, og samtalen gøres kortere.
    await helpers.taskOptions(page); await page.click('#model-effort-reset'); await helpers.closeTaskOptions(page);
    assert.doesNotMatch(await page.locator('#model-chip').textContent(), /lav indsats/);
    await send('Byg siden igen.');
    await card.locator('button', { hasText: 'Gør samtalen kortere og prøv igen' }).waitFor();
    before = requests.length;
    await card.locator('button', { hasText: 'Gør samtalen kortere og prøv igen' }).click();
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 120000 });
    const after = requests.slice(before);
    assert.equal(after[0]?.compaction, true, 'samtalen sammenfattes før beskeden: ' + JSON.stringify(after));
    await page.click('#tab-activity');
    await page.locator('#activity-scroll').filter({ hasText: 'Samtalen er gjort kortere' }).waitFor();
    await page.screenshot({ path: path.join(root, 'gjort-kortere.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, requests: requests.length, checks: ['OpenCode sender max_tokens 128.000', 'ingen indsats uden brugerens valg', 'ukendt indsats afvises', 'fejlkort med tre valg ved length', 'lav indsats sendes som reasoning_effort', 'indsats vises og nulstilles', 'samtalen sammenfattes før genforsøg'], model: 'Lokal Corti-lignende server; rigtig gateway og OpenCode' }, null, 2));
  } catch (error) {
    if (app) { const page = await app.firstWindow(); await page.screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {}); console.error((await page.locator('#messages').innerText().catch(() => '')).slice(-2000)); }
    console.error('Prøvens filer:', root, 'Kald:', JSON.stringify(requests), 'HTTP-fejl:', errors); throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
