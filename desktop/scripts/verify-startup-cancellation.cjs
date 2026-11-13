// Rigtig Electron og motorstart med en kontrolleret lokal model; ingen konto, modelbetaling eller ændring af egne projekter.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-startup-cancel-')));
  const project = path.join(root, 'Opstart');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><title>Opstart</title><h1>Start efter Stop</h1>');
  const requests = [], errors = [], checks = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const text = JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content || '');
    if (body.tools?.length && !text.includes('resume-after-startup-stop')) { res.writeHead(500); return res.end('En stoppet besked nåede modelserveren.'); }
    const chunk = { id: 'startup-svar', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: body.tools?.length ? 'Start efter Stop virkede.' : 'Titel' }, finish_reason: null }] };
    res.setHeader('content-type', 'text/event-stream'); res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } }) + '\n\n'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app, page;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page); page.setDefaultTimeout(30000);
    await helpers.openExistingProject(app, page, project);
    const connection = await helpers.addConnection(page, { name: 'Kontrolleret opstartsmodel', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection.id); await page.locator('#model-shortlist button').first().click();
    await helpers.closeTaskOptions(page);
    const call = async (method, input) => {
      const result = await page.evaluate(({ method, input }) => window.harness[method](input), { method, input });
      assert.equal(result.ok, true, result.error); return result.value;
    };
    let useInitialChat = true;
    const newChat = async () => {
      // Projektet starter allerede i en tom samtale. Aura genbruger den ved +, så dens id ændres ikke endnu.
      if (useInitialChat) { useInitialChat = false; return; }
      const id = await page.locator('#project-list .chat-row[aria-current="true"]').getAttribute('data-chat');
      await page.click('#project-list .project-entry.is-current .project-add');
      await page.waitForFunction(id => document.querySelector('#project-list .chat-row[aria-current="true"]')?.dataset.chat !== id && !document.querySelector('#send').disabled && document.querySelector('#prompt').value === '', id);
    };
    checks.push = function (...items) { for (const item of items) console.log('Bestået: ' + item); return Array.prototype.push.apply(this, items); };
    await require('./startup-cancellation-checks.cjs')({ app, page, project, root, requests, newChat, call, checks });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks, requests: requests.length }, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {});
    await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(requests));
    console.error('Testmateriale: ' + root); throw error;
  } finally {
    await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
