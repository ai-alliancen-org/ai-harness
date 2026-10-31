// Mistrals dokumenterede svarformat gennem Aura, gatewayen og den fastlåste OpenCode.
// Ingen eksterne modelkald: kun en lokal HTTP-server, syntetisk nøgle og midlertidige filer.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

async function main() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-mistral-')));
  const project = path.join(root, 'Mit prøveprojekt'), file = path.join(project, 'public/index.html');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '<h1>Før ændringen</h1>');
  const requests = [], errors = [], key = 'syntetisk-mistral-noegle';
  let phase = 'chat', calls = 0, app, offerMedium = true;
  const note = 'Syntetisk tænkeafsnit til formatkontrol.';
  const thinking = text => ({ type: 'thinking', thinking: [{ type: 'text', text }] });
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${key}`);
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [
        { id: 'mistral-medium-latest', name: 'Mistral Medium', capabilities: { completion_chat: true, function_calling: true } },
        { id: 'mistral-large-4', name: 'Mistral Large 4', max_context_length: 524288, capabilities: { completion_chat: true, function_calling: true } },
        { id: 'mistral-large-2512', name: 'Mistral Large 3', capabilities: { completion_chat: true, function_calling: true } }
      ].filter(model => offerMedium || model.id !== 'mistral-medium-latest') }));
      assert.equal(req.url, '/v1/chat/completions');
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push({ phase, body });
      assert.equal(body.model, 'mistral-large-4');
      assert.equal(body.reasoning_effort, undefined, 'Aura sender ikke en opdigtet standardindsats');
      if (phase === 'error') { res.writeHead(401); return res.end(JSON.stringify({ error: { message: key } })); }
      if (phase === 'stop') return;
      const tool = !['chat', 'plan'].includes(phase) && calls++ === 0 ? {
        index: 0, id: 'test12345', type: 'function',
        function: { name: 'write', arguments: JSON.stringify({ filePath: file, content: phase === 'reject' ? '<h1>Denne ændring skal afvises</h1>' : '<!doctype html><html lang="da"><title>Prøve</title><h1>En ny startside</h1></html>' }) }
      } : null;
      // En plan har de fire faste afsnit, som Planlæg kræver (conversation-mode.js).
      const answer = phase === 'chat' ? 'Jeg kan godt hjælpe med overskriften.' : phase === 'plan' ? '## Det bygger vi\nVi ændrer overskriften på startsiden.\n\n## Sådan skal det se ud\nOverskriften står øverst som før.\n\n## Teknik og data\nKun public/index.html ændres. Der er ingen data.\n\n## Det skal du prøve\nÅbn forhåndsvisningen, og kontrollér overskriften.' : 'Startsiden er ændret. Se den nye overskrift i forhåndsvisningen.';
      if (!body.stream) return res.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: [thinking(note), { type: 'text', text: answer }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
      res.setHeader('content-type', 'text/event-stream');
      const send = (delta, finish = null, usage) => res.write('data: ' + JSON.stringify({ id: `test-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) }) + '\n\n');
      // Dækker tænkeafsnit, blandede afsnit i samme hændelse, almindelig tekst og værktøjskald.
      send({ role: 'assistant', content: [thinking(note)] });
      if (tool) send({ tool_calls: [tool] });
      else { send({ content: [thinking(' Slut.'), { type: 'text', text: answer.slice(0, 10) }] }); send({ content: answer.slice(10) }); }
      send({}, tool ? 'tool_calls' : 'stop', { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
      res.end('data: [DONE]\n\n');
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    // Kun testprocessens HTTP-transport omdirigeres. Den rigtige Mistral-forbindelse og adapter bruges uændret.
    await app.evaluate((_, origin) => {
      const actual = globalThis.fetch;
      globalThis.fetch = (input, options) => {
        const url = String(input);
        if (url.startsWith('https://api.mistral.ai/v1/')) return actual(url.replace('https://api.mistral.ai', origin), options);
        if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error('Prøven tillader kun lokale HTTP-kald.');
        return actual(input, options);
      };
    }, `http://127.0.0.1:${server.address().port}`);
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await helpers.skipIntroduction(page);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    await helpers.openSetup(page); await page.click('#setup-add-provider'); await helpers.chooseProviderCard(page, 'mistral');
    await page.click('#enter-key'); await helpers.enterCredential(app, key);
    await page.waitForFunction(() => document.querySelector('#setup').dataset.step === 'saved' && !document.querySelector('#setup-continue').disabled);
    await page.click('#setup-continue'); await page.waitForSelector('#workspace:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#model-select').value === 'mistral-medium-latest');
    await helpers.taskOptions(page);
    assert.equal(await page.locator('#model-shortlist .model-choice').count(), 3);
    await page.screenshot({ path: path.join(root, 'modelvalg.png'), animations: 'disabled' });
    await page.locator('#model-shortlist [data-model="mistral-large-4"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#model-select'), 'mistral-large-4');
    assert.match(await page.locator('#model-chip').textContent(), /Mistral Large 4/);
    assert.match(await page.locator('#model-chip').textContent(), /standardindsats/);

    async function send(text) {
      await page.fill('#prompt', text); await page.click('#send');
      await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
      if (await page.locator('#data-dialog').evaluate(el => el.open)) {
        assert.match(await page.locator('#data-details').textContent(), /lanceringsrabat er ikke trukket fra/);
        await page.click('#accept-send');
      }
    }
    async function finished() {
      await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 60000 });
      assert.deepEqual(errors, []);
    }
    // Samtale er standard. Den første besked skal vise Før du sender og få svar; i 0.4 og 0.5.0-beta.1 fejlede den.
    assert.equal(await page.inputValue('#work-mode'), 'chat');
    await send('Hvad kan du hjælpe med?'); await finished();
    await page.locator('#messages').filter({ hasText: 'Jeg kan godt hjælpe med overskriften.' }).waitFor();
    // Prøvens planforløb kræver Planlæg.
    phase = 'plan'; calls = 0;
    await helpers.selectMode(page, 'plan');
    await send('Planlæg en ny overskrift på startsiden.'); await finished();
    await page.waitForSelector('#plan-card:not([hidden])');
    assert.equal(await fs.readFile(file, 'utf8'), '<h1>Før ændringen</h1>');
    assert.doesNotMatch(await page.locator('#messages').textContent(), /Syntetisk tænkeafsnit/);

    phase = 'build'; calls = 0;
    await page.click('#build-plan');
    await page.waitForSelector('#approvals .approval', { timeout: 60000 });
    await helpers.approve(page, 'Tillad for denne opgave');
    await finished();
    assert.match(await fs.readFile(file, 'utf8'), /En ny startside/);
    await page.frameLocator('#preview').locator('h1').filter({ hasText: 'En ny startside' }).waitFor();
    const build = requests.filter(request => request.phase === 'build' && request.body.tools?.length);
    assert.ok(build.length >= 2, 'motoren fortsætter efter værktøjssvaret');
    assert.ok(build.some(request => request.body.messages.some(message => message.role === 'assistant' && Array.isArray(message.content) && message.content.some(part => part.type === 'thinking'))), 'tænkeafsnittet følger med tilbage til Mistral efter værktøjskaldet');
    assert.doesNotMatch(await page.locator('#messages').textContent(), /Syntetisk tænkeafsnit/);
    const usage = (await page.evaluate(() => window.harness.connectionState())).value.usage;
    // Samtalens første besked, planen og to byggekald.
    assert.equal(usage.calls, 4); assert.equal(usage.input, 400); assert.equal(usage.output + usage.reasoning, 200); assert.ok(Math.abs(usage.cost - 0.00138) < 1e-10); assert.equal(usage.unpriced, 0);
    await page.screenshot({ path: path.join(root, 'kode-og-preview.png'), animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('harness://')).setSize(980, 720));
    await helpers.taskOptions(page); await page.screenshot({ path: path.join(root, 'modelvalg-lille.png'), animations: 'disabled' }); await helpers.closeTaskOptions(page);
    assert.equal(await page.locator('#send').evaluate(button => { const range = document.createRange(); range.selectNodeContents(button); return range.getClientRects().length; }), 1, 'Send og pilen bliver på én linje, også med en lang modelbetegnelse');

    phase = 'reject'; calls = 0;
    await send('Prøv endnu en ændring.');
    await page.waitForSelector('#approvals .approval', { timeout: 60000 });
    await page.locator('#approvals button').filter({ hasText: /^Afvis$/ }).click(); await finished();
    assert.match(await fs.readFile(file, 'utf8'), /En ny startside/);
    phase = 'stop'; await send('Vent på mit svar.');
    for (let attempt = 0; !requests.some(request => request.phase === 'stop') && attempt < 600; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(requests.filter(request => request.phase === 'stop').length, 1, 'Stop prøves først, når modelkaldet faktisk venter på svar');
    await page.waitForFunction(() => !document.querySelector('#stop').disabled); await page.click('#stop'); await finished();
    phase = 'error'; await send('Prøv forbindelsen igen.'); await finished();
    assert.doesNotMatch(await page.locator('body').textContent(), new RegExp(key));
    assert.match(await page.locator('#messages').textContent(), /API-nøglen|afvist|afviste/);
    assert.equal(requests.filter(request => request.phase === 'error').length, 1, 'ingen automatisk genafsendelse ved afvist nøgle');
    await page.click('#open'); await page.waitForFunction(() => !document.querySelector('#open').disabled && document.querySelector('#model-select').value === 'mistral-large-4');
    assert.match(await page.locator('#model-chip').textContent(), /Mistral Large 4/, 'genåbning bevarer brugerens modelvalg');
    // Samme konto, men et katalog uden Medium: et nyt projekt må ikke stiltiende vælge prøveversionen.
    offerMedium = false;
    const another = path.join(root, 'Uden standardmodel'); await fs.mkdir(another);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, another);
    await page.click('#open'); await page.waitForFunction(() => document.querySelector('#project-name').textContent === 'Uden standardmodel' && !document.querySelector('#open').disabled && document.querySelector('#model-select').options.length === 3);
    assert.equal(await page.inputValue('#model-select'), '');
    await helpers.taskOptions(page);
    assert.doesNotMatch(await page.locator('#model-shortlist').textContent(), /Den første er udbyderens eget/);
    assert.equal(await page.locator('#model-shortlist .model-choice').count(), 2);
    await page.screenshot({ path: path.join(root, 'uden-standardmodel.png'), animations: 'disabled' });
    console.log(JSON.stringify({ status: 'bestået', root, requests: requests.length, usage, checks: ['tre faktuelle modelvalg', 'intet automatisk skift til Large 4', 'pris og datagennemgang', 'struktureret streaming og bevaret historik', 'rigtig OpenCode og godkendt filændring', 'preview fra disk', 'afvisning og Stop', 'nøglefejl uden gentagne kald'], model: 'Kontrolleret lokal Mistral-server; ingen ekstern modelafprøvning' }));
  } catch (error) {
    if (app) { const page = await app.firstWindow(); await page.screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {}); console.error((await page.locator('#messages').innerText().catch(() => '')).slice(-3000)); }
    console.error('Prøvens filer:', root, 'HTTP-fejl:', errors); throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
