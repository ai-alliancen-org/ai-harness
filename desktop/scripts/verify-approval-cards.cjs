// Kortgrænsen i Electron (årsag 13): et byggeforløb på 26 værktøjskald i et NYT projekt med standarderne (ikke manuelle godkendelser) må højst
// give fem godkendelseskort i den rigtige app. Den rigtige OpenCode-motor bruges med en kontrolleret lokal modelserver (ingen nøgler, ingen
// netværkskald) og et nyt projekt i en midlertidig mappe; dette repository røres ikke. Et kort tælles, når #approvals viser et .approval, som
// brugeren skal svare på; kald, der afgøres uden kort, ses ikke. Samme grænse og samme slags forløb som tests/card-limit.test.cjs, men gennem hele appen.
// KØRES KUN MANUELT: npm run test:approval-cards. Den er ikke hægtet på nogen automatisk kørsel eller nogen anden prøve.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const helpers = require('./ui-test-helpers.cjs');

const MAX_KORT = 5;
const ANTAL_TRIN = 26;

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kort-')));
  const documents = path.join(root, 'Dokumenter'); await fs.mkdir(documents);
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  let project = null, modelCalls = 0;
  const side = '<!doctype html><html lang="da"><meta charset="utf-8"><title>Lokaler</title><h1>Find et lokale</h1><p>Tre lokaler.</p></html>\n';
  // Trin for trin: læsning, glob og grep i projektet, filændringer og korte kommandoer i projektet. Intet går uden for projektmappen.
  const trin = () => [
    { tool: 'glob', args: { pattern: '**/*' } },
    { tool: 'glob', args: { pattern: 'public/**' } },
    { tool: 'write', args: { filePath: path.join(project, 'public/index.html'), content: side } },
    { tool: 'read', args: { filePath: path.join(project, 'public/index.html') } },
    { tool: 'read', args: { filePath: path.join(project, 'public/index.html') } },
    { tool: 'grep', args: { pattern: 'lokale' } },
    { tool: 'write', args: { filePath: path.join(project, 'public/styles.css'), content: 'body { font-family: sans-serif; }\n' } },
    { tool: 'write', args: { filePath: path.join(project, 'src/app.js'), content: 'export const lokaler = 3;\n' } },
    { tool: 'edit', args: { filePath: path.join(project, 'public/index.html'), oldString: '<h1>Find et lokale</h1>', newString: '<h1>Find et mødelokale</h1>' } },
    { tool: 'read', args: { filePath: path.join(project, 'src/app.js') } },
    { tool: 'grep', args: { pattern: 'lokaler', path: 'src' } },
    { tool: 'bash', args: { command: 'ls -la', description: 'Viser filerne' } },
    { tool: 'bash', args: { command: 'echo bygger', description: 'Bygger siden' } },
    { tool: 'edit', args: { filePath: path.join(project, 'src/app.js'), oldString: 'lokaler = 3', newString: 'lokaler = 4' } },
    { tool: 'read', args: { filePath: path.join(project, 'src/app.js') } },
    { tool: 'glob', args: { pattern: 'src/*.js' } },
    { tool: 'bash', args: { command: 'cat public/index.html | head -5', description: 'Viser toppen af siden' } },
    { tool: 'write', args: { filePath: path.join(project, 'public/om.html'), content: '<h1>Om</h1>\n' } },
    { tool: 'edit', args: { filePath: path.join(project, 'public/styles.css'), oldString: 'sans-serif', newString: 'serif' } },
    { tool: 'grep', args: { pattern: 'serif', include: '*.css' } },
    { tool: 'read', args: { filePath: path.join(project, 'public/styles.css') } },
    { tool: 'bash', args: { command: 'echo test && exit 0', description: 'Kører testen' } },
    { tool: 'read', args: { filePath: path.join(project, 'public/om.html') } },
    { tool: 'edit', args: { filePath: path.join(project, 'public/index.html'), oldString: 'Tre lokaler.', newString: 'Fire lokaler.' } },
    { tool: 'glob', args: { pattern: '**/*.html' } },
    { tool: 'bash', args: { command: 'echo færdig', description: 'Melder færdig' } }
  ];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'kort-model', name: 'Kontrolleret model' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const lastUser = body.messages.findLastIndex(m => m.role === 'user');
    const tools = body.messages.slice(lastUser).filter(m => m.role === 'tool');
    let step;
    if (!body.tools?.length) step = { text: 'Titel' };
    else { modelCalls++; const alle = trin(); step = tools.length < alle.length ? alle[tools.length] : { text: 'Siden er bygget.' }; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } } : {}) }) + '\n\n');
    if (step.tool) send({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${modelCalls}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
    else send({ role: 'assistant', content: step.text });
    send({}, step.tool ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.equal(trin().length, ANTAL_TRIN);
  const errors = []; const kort = []; let app, page;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.isolateDocuments(app, documents); await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    await page.fill('#purpose', 'En side med mødelokaler.'); await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
    // Bevidst IKKE helpers.manualApprovals: prøven gælder de standarder, et nyt projekt får.
    project = path.join(documents, 'Aura', (await fs.readdir(path.join(documents, 'Aura')))[0]);
    await helpers.addConnection(page, { name: 'Kontrolleret', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');
    await page.fill('#prompt', 'Byg siden med mødelokaler'); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden || /Fejl/.test(document.querySelector('#run-status').textContent));
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    // Svar på hvert kort med "Tillad én gang", så forløbet kan nå til ende, og tæl dem.
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (await page.evaluate(() => document.querySelector('#stop').hidden)) break;
      const aktuelt = page.locator('#approvals .approval').first();
      if (await aktuelt.count()) {
        const beskrivelse = await aktuelt.evaluate(el => ({ art: el.querySelector('.approval-kind')?.textContent || '', titel: el.querySelector('.approval-title')?.textContent || '', maal: el.querySelector('.approval-facts dd, code.action-target')?.textContent || '' }));
        kort.push(beskrivelse);
        await aktuelt.getByRole('button', { name: 'Tillad én gang', exact: true }).click();
        await page.waitForTimeout(150);
      } else await page.waitForTimeout(100);
    }
    assert.equal(await page.evaluate(() => document.querySelector('#stop').hidden), true, 'forløbet blev ikke færdigt inden tiden');
    assert.ok(modelCalls > ANTAL_TRIN, `modellen blev kun kaldt ${modelCalls} gange; forløbet på ${ANTAL_TRIN} trin blev ikke gennemført`);
    console.log(`${kort.length} kort på ${ANTAL_TRIN} trin:`); for (const k of kort) console.log(`  ${k.art} | ${k.titel} | ${k.maal.slice(0, 80)}`);
    assert.ok(kort.length <= MAX_KORT, `${kort.length} godkendelseskort på ${ANTAL_TRIN} trin; grænsen er ${MAX_KORT}`);
    assert.deepEqual(errors, []);
    console.log(`✓ Højst ${MAX_KORT} kort på et byggeforløb med ${ANTAL_TRIN} trin i et nyt projekt (${kort.length} set)`);
  } finally {
    await app?.close().catch(() => {}); server.close(); await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
