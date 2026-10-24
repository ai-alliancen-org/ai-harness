// Rigtig Electron og OpenCode med lokale svar i OpenAI Responses-format. Ingen eksterne kald eller rigtige nøgler.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-openai-azure-')));
  const project = path.join(root, 'Min app'), file = path.join(project, 'public/index.html'), userdata = path.join(root, 'appdata');
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '<h1>Før ændringen</h1>');
  const requests = [], errors = []; let app, phase = 'build', active = 'openai', calls = 0;
  const keys = { openai: 'syntetisk-openai-noegle', azure: 'syntetisk-azure-noegle' };
  const server = http.createServer(async (req, res) => {
    try {
      const kind = req.url.startsWith('/azure/') ? 'azure' : 'openai';
      assert.equal(req.headers[kind === 'azure' ? 'api-key' : 'authorization'], kind === 'azure' ? keys.azure : `Bearer ${keys.openai}`);
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'gpt-4.1' }, { id: 'text-embedding-3-small' }] }));
      assert(req.url.endsWith('/responses')); assert.equal(kind, active);
      let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw); requests.push({ kind, phase, body });
      assert.equal(body.model, kind === 'azure' ? 'kommunens-kodemodel' : 'gpt-4.1'); assert.equal(body.store, false); assert(!body.input.some(i => i.type === 'item_reference'), 'historik må ikke afhænge af serverlagrede svar'); assert(body.include?.includes('reasoning.encrypted_content'));
      if (phase === 'stop') return;
      if (phase === 'error') { res.writeHead(401); return res.end(JSON.stringify({ error: { message: keys[kind] } })); }
      const tool = body.tools?.some(t => t.name === 'write') && calls++ === 0;
      const content = `<h1>Bygget via ${kind}</h1>`;
      const answer = 'Ændringen er behandlet. Se overskriften i forhåndsvisningen.';
      const item = tool ? { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'write', arguments: JSON.stringify({ filePath: file, content }), status: 'completed' } : { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] };
      const reasoning = { type: 'reasoning', id: `rs_${requests.length}`, summary: [{ type: 'summary_text', text: 'Jeg gennemgår ændringen.' }], encrypted_content: 'syntetisk-krypteret-tilstand' };
      const output = tool ? [item, reasoning] : [item];
      const response = { id: 'resp_test', object: 'response', created_at: 1, model: body.model, status: 'completed', output, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      if (!body.stream) return res.end(JSON.stringify(response));
      res.writeHead(200, { 'content-type': 'text/event-stream' }); let seq = 0;
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
      send('response.created', { response: { ...response, status: 'in_progress', output: [] } });
      send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', ...(tool ? { arguments: '' } : { content: [] }) } });
      if (tool) {
        send('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
        send('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
      } else {
        send('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: answer });
        send('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: answer });
        send('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
      }
      send('response.output_item.done', { output_index: 0, item });
      if (tool) {
        send('response.output_item.added', { output_index: 1, item: { ...reasoning, summary: [] } });
        send('response.reasoning_summary_part.added', { item_id: reasoning.id, output_index: 1, summary_index: 0, part: { type: 'summary_text', text: '' } });
        send('response.reasoning_summary_text.delta', { item_id: reasoning.id, output_index: 1, summary_index: 0, delta: reasoning.summary[0].text });
        send('response.reasoning_summary_text.done', { item_id: reasoning.id, output_index: 1, summary_index: 0, text: reasoning.summary[0].text });
        send('response.output_item.done', { output_index: 1, item: reasoning });
      }
      send('response.completed', { response }); res.end();
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + userdata], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    await app.evaluate(({ safeStorage }, origin) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = value => Buffer.from('test:' + Buffer.from(value).toString('base64'));
      safeStorage.decryptString = value => Buffer.from(value.toString().slice(5), 'base64').toString();
      const actual = globalThis.fetch;
      globalThis.fetch = (input, options) => {
        const url = String(input);
        if (url.startsWith('https://api.openai.com/v1/')) return actual(url.replace('https://api.openai.com', origin + '/openai'), options);
        if (url.startsWith('https://aura-demo.openai.azure.com/openai/v1/')) return actual(url.replace('https://aura-demo.openai.azure.com/openai', origin + '/azure'), options);
        if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error('Prøven tillader kun lokale kald.');
        return actual(input, options);
      };
    }, `http://127.0.0.1:${server.address().port}`);
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.emulateMedia({ reducedMotion: 'reduce' }); await helpers.skipIntroduction(page);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    for (const kind of ['openai', 'azure']) {
      active = kind; calls = 0; phase = 'build';
      await helpers.openSetup(page); await page.click('#setup-add-provider'); await page.click(`#provider-cards [data-kind="${kind}"]`);
      if (kind === 'azure') {
        await page.fill('#azure-endpoint', 'https://aura-demo.openai.azure.com'); await page.fill('#azure-deployment', 'kommunens-kodemodel');
        await page.screenshot({ path: path.join(root, 'azure-opsatning.png') });
      }
      await require('./ui-test-helpers.cjs').enterCredential(page, keys[kind]); await page.click('#save-connection');
      await page.waitForFunction(() => document.querySelector('#setup').dataset.step === 'saved' && !document.querySelector('#setup-continue').disabled);
      await page.click('#setup-continue'); await page.waitForSelector('#workspace:not([hidden])');
      await helpers.taskOptions(page);
      if (!await page.locator('#model-catalog').evaluate(el => el.open)) await page.click('#model-catalog > summary');
      await page.selectOption('#model-select', kind === 'azure' ? 'kommunens-kodemodel' : 'gpt-4.1'); await helpers.closeTaskOptions(page);
      await helpers.selectMode(page, 'free');
      async function send() {
        await page.fill('#prompt', 'Ret overskriften på min startside.'); await page.click('#send');
        await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
        if (await page.locator('#data-dialog').evaluate(el => el.open)) {
          assert.match(await page.locator('#data-details').textContent(), kind === 'azure' ? /deployment/ : /globale API/);
          await page.click('#accept-send');
        }
      }
      await send();
      await page.waitForSelector('#approvals .approval', { timeout: 60000 });
      await page.locator('#approvals button').filter({ hasText: 'Tillad for denne opgave' }).click();
      await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 60000 });
      assert.match(await fs.readFile(file, 'utf8'), new RegExp(`Bygget via ${kind}`));
      await page.frameLocator('#preview').locator('h1').filter({ hasText: `Bygget via ${kind}` }).waitFor();
      assert(requests.some(r => r.kind === kind && r.body.input.some(i => i.type === 'function_call_output')), 'værktøjssvaret bevares i historikken');
      assert(requests.some(r => r.kind === kind && r.body.input.some(i => i.type === 'reasoning' && i.encrypted_content === 'syntetisk-krypteret-tilstand')), 'krypteret tænketilstand følger med uden serverlagring');
      await page.screenshot({ path: path.join(root, `${kind}-preview.png`) });
      phase = 'reject'; calls = 0; await send();
      await page.waitForSelector('#approvals .approval', { timeout: 60000 }); await page.locator('#approvals button').filter({ hasText: /^Afvis$/ }).click();
      await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 60000 });
      phase = 'stop'; await send();
      for (let n = 0; !requests.some(r => r.kind === kind && r.phase === 'stop') && n < 600; n++) await new Promise(r => setTimeout(r, 100));
      assert(requests.some(r => r.kind === kind && r.phase === 'stop'));
      await page.waitForFunction(() => !document.querySelector('#stop').disabled); await page.click('#stop'); await page.waitForFunction(() => document.querySelector('#stop').hidden);
      phase = 'error'; await send(); await page.waitForFunction(() => document.querySelector('#stop').hidden, null, { timeout: 60000 });
      assert.match(await page.locator('#messages').textContent(), /afvist/); assert.equal(requests.filter(r => r.kind === kind && r.phase === 'error').length, 1);
      assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(keys[kind]));
      await helpers.menuClick(page, '#connections-button');
      const row = page.locator('#saved-connections .saved-connection').filter({ hasText: kind === 'azure' ? 'Azure' : 'OpenAI' });
      assert.match(await row.innerText(), /Ikke forbundet/, 'afvist nøgle skal fjerne den tidligere grønne status');
      await page.click('[data-close="connections-dialog"]');
    }
    const saved = JSON.parse(await fs.readFile(path.join(userdata, 'harness/settings.json')));
    assert.equal(saved.connections.length, 2);
    for (const key of Object.values(keys)) assert(!JSON.stringify(saved).includes(key));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, requests: requests.length, checks: ['opsætning gennem formularen', 'separate nøgler', 'Responses-streaming', 'OpenCode-filændring og preview', 'værktøjshistorik', 'afvisning', 'Stop', 'afvist nøgle uden læk eller automatisk gentagelse'], liveModel: false }));
  } catch (error) {
    console.error('Prøvens filer:', root, 'HTTP-fejl:', errors);
    if (app) { const page = await app.firstWindow(); await page.screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {}); console.error((await page.locator('#messages').innerText().catch(() => '')).slice(-2000)); }
    throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
