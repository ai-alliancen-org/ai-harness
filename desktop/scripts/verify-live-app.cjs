// Rigtig model gennem Aura: idé → plan → bygning → funktion → rettelse → fortrydelse.
// Nøglen indtastes direkte i isoleret Aura. Kun opdigtede data; modelkald kan koste penge.
// --controlled afprøver prøven med rigtig OpenCode og en lokal, kontrolleret model.
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright');
const helpers = require('./ui-test-helpers.cjs');
const { capture } = require('../core/changes.cjs');
const desktop = path.join(__dirname, '..');
const controlled = process.argv.includes('--controlled');
const failureControl = process.argv.includes('--controlled-failure');
if (failureControl && !controlled) throw Error('--controlled-failure kræver --controlled.');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const provider = process.env.HARNESS_LIVE_PROVIDER || 'mistral';
if (!['anthropic', 'mistral', 'corti', 'alexandra'].includes(provider)) throw Error('HARNESS_LIVE_PROVIDER skal være anthropic, mistral, corti eller alexandra.');
const wanted = controlled ? 'test-model' : args[1] || (provider === 'corti' ? 'corti-s1' : provider === 'alexandra' ? 'glm-5.3-flash' : '');
const idea = 'Lav en dansk oversigt over tre fiktive mødelokaler: Birk med 4 pladser, Bøg med 8 og Ask med 12. Overskriften skal være Mødelokaler. Et talfelt med den synlige etiket Antal deltagere skal straks filtrere listen, så kun lokaler med mindst det antal pladser vises. Ved 99 deltagere skal ingen lokaler vises, og beskeden Ingen lokaler passer. skal stå på siden. Brug kun public/index.html og eventuelt CSS/JavaScript i public. Ingen pakker, server, installation, netopslag eller shellkommandoer. Planlæg først.';
const correction = 'Ret kun overskriften Mødelokaler til Find dit mødelokale. Bevar filtrering, lokaler og alt andet. Brug edit eller write; ingen kommandoer eller netopslag.';
let out, stage = 'opsætning', project, app, page, server;
const log = [], checks = [], approvals = [], reviews = [], errors = [], usage = {};
const note = text => { const line = `[${new Date().toISOString()}] ${text}`; log.push(line); console.log(line); };
const digest = text => createHash('sha256').update(text).digest('hex');
const snapshot = async () => {
  const data = await capture(project);
  assert.equal(data.skipped, 0, 'Ingen filer må være udeladt fra bytekontrollen.');
  return [...data.files].sort(([a], [b]) => a.localeCompare(b));
};
const hashes = files => files.map(([file, text]) => ({ file, sha256: digest(text) }));
let imageCount = 0;
async function shot(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(out, `${++imageCount}-${name}.png`), Buffer.from(png, 'base64'));
}
async function check(title, action) { await action(); checks.push(title); note(`Bestået: ${title}`); }
function controlledHTML(heading) {
  return `<!doctype html><html lang="da"><meta charset="utf-8"><title>Mødelokaler</title><h1>${heading}</h1><label for="n">Antal deltagere</label><input id="n" type="number" min="1" value="1"><ul><li data-cap="4">Birk</li><li data-cap="8">Bøg</li><li data-cap="12">Ask</li></ul><p id="none" hidden>Ingen lokaler passer.</p><script>n.oninput=()=>{for(const li of document.querySelectorAll('li'))li.hidden=+li.dataset.cap<+n.value;document.getElementById('none').hidden=[...document.querySelectorAll('li')].some(li=>!li.hidden)};n.oninput()</script></html>`;
}
async function startControlledServer() {
  const written = new Set();
  server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: wanted, name: 'Kontrolleret testmodel' }] })); }
    if (failureControl) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Bevidst afvist modeladgang', type: 'authentication_error' } })); }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    const tool = ['bygning', 'rettelse'].includes(stage) && !written.has(stage) ? {
      id: `write_${stage}`, type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(project, 'public/index.html'), content: controlledHTML(stage === 'rettelse' ? 'Find dit mødelokale' : 'Mødelokaler') }) }
    } : null;
    if (tool) written.add(stage);
    const chunk = { id: 'controlled', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, ...tool }] } : { role: 'assistant', content: stage === 'plan' ? 'Plan: Byg de tre mødelokaler i public/index.html med dansk talfilter. Prøv 5, 9 og 99 deltagere. Ingen installation.' : 'Ændringen er skrevet. Prøv filtreringen.' }, finish_reason: null }] };
    res.setHeader('content-type', 'text/event-stream');
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}
async function answerApprovals() {
  for (const box of await page.locator('#approvals .approval').all()) {
    if (await box.locator('.question-title').count()) {
      approvals.push({ stage, kind: 'spørgsmål', answer: 'den afgrænsede prøve' });
      await box.locator('textarea').fill('Følg den konkrete idé: lokal HTML/CSS/JavaScript, de tre fiktive lokaler og filteret. Ingen installation eller deling.');
      await box.getByRole('button', { name: 'Svar', exact: true }).click(); continue;
    }
    const once = box.getByRole('button', { name: 'Tillad én gang', exact: true });
    const target = await box.locator('.action-target').textContent().catch(() => '');
    // UI tilbyder Tillad én gang alene for projektinterne rettelser; begræns også til public/.
    const allowed = await once.count() && /^public\/[a-zA-Z0-9_./-]+\.(html|css|js)$/.test(target) && !target.split('/').includes('..');
    approvals.push({ stage, target, allowed: Boolean(allowed) });
    await shot(`${stage}-godkendelse`);
    if (allowed) await once.click();
    else {
      await box.getByRole('button', { name: 'Afvis med en besked', exact: true }).click();
      await box.locator('textarea').fill('Prøven tillader kun HTML/CSS/JavaScript i public/. Brug read, edit eller write der. Ingen shell, netopslag eller adgang uden for projektet.');
      await box.getByRole('button', { name: 'Afvis og send beskeden', exact: true }).click();
    }
  }
}
async function runUntilDone(label, startAction) {
  stage = label;
  const deadline = Date.now() + 12 * 60000, count = reviews.length;
  await startAction();
  await page.waitForFunction(() => !document.querySelector('#stop').hidden || document.querySelector('#data-dialog').open, null, { timeout: 60000 });
  if (await page.locator('#data-dialog').evaluate(el => el.open)) { await shot(`${label}-foer-du-sender`); await page.click('#accept-send'); }
  while (Date.now() < deadline) {
    await answerApprovals();
    if (reviews.length > count && await page.locator('#stop').isHidden()) break;
    await page.waitForTimeout(500);
  }
  if (reviews.length === count || !await page.locator('#stop').isHidden()) {
    await page.click('#stop').catch(() => {}); throw Error(`${label}: ingen afsluttet opgave inden prøvens grænse.`);
  }
  const result = reviews.at(-1);
  assert.equal(result.status, 'idle', `${label}: opgaven skal afslutte uden fejl eller Stop (${result.failure?.kind || result.status}).`);
  // Et værktøj, prøven selv afviste med sin policy-besked, er ikke en fejl: modellen skal kunne komme videre efter afvisningen.
  assert(!result.tools.some(tool => tool.status === 'error' && !tool.error.includes('Prøven tillader kun')), `${label}: et værktøj fejlede.`);
  if (label !== 'plan') assert(result.files.length, `${label}: ingen faktisk filændring.`);
  note(`${label}: ${result.status}, ${result.files.length} ændrede filer`);
}
async function tryFilter(heading) {
  const frame = page.frameLocator('#preview');
  await frame.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 30000 });
  const number = frame.getByRole('spinbutton', { name: 'Antal deltagere', exact: true });
  for (const [n, expected] of [[1, ['Birk', 'Bøg', 'Ask']], [5, ['Bøg', 'Ask']], [9, ['Ask']], [99, []]]) {
    await number.fill(String(n));
    await page.waitForTimeout(150);
    const actual = [];
    for (const room of ['Birk', 'Bøg', 'Ask']) if (await frame.getByText(room, { exact: true }).isVisible()) actual.push(room);
    assert.deepEqual(actual, expected, `Filteret ved ${n} deltagere`);
    if (n === 99) assert(await frame.getByText('Ingen lokaler passer.', { exact: true }).isVisible());
  }
  await number.fill('1');
}
async function main() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-rigtig-model-')));
  out = args[0] ? path.resolve(args[0]) : path.join(root, 'resultat');
  // En resultatmappe må ikke erstatte evidens fra en tidligere kørsel.
  await fs.mkdir(out, { recursive: false });
  const documents = path.join(root, 'Dokumenter'), appdata = path.join(root, 'appdata');
  const bundle = process.env.HARNESS_TEST_PACKAGE && path.resolve(process.env.HARNESS_TEST_PACKAGE);
  const executablePath = bundle ? (bundle.endsWith('.app') ? path.join(bundle, 'Contents/MacOS', path.basename(bundle, '.app')) : bundle) : require('electron');
  const platformPath = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin:/usr/sbin:/sbin';
  const report = { status: 'ikke gennemført', provider: controlled ? 'lokal kontrolleret model' : provider, model: wanted, realModel: !controlled, packaged: Boolean(bundle), bundle, root, checks, approvals, reviews, errors };
  note(`Resultater: ${out}`);
  try {
    if (controlled) await startControlledServer();
    app = await electron.launch({ executablePath, args: [...(bundle ? [] : [desktop]), '--user-data-dir=' + appdata], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ...(bundle ? { PATH: platformPath, HARNESS_OPENCODE_PATH: '' } : {}) } });
    await helpers.isolateDocuments(app, documents);
    page = await app.firstWindow(); page.setDefaultTimeout(30000);
    // Fejl fra AI'ens egne projektfiler i forhåndsvisningen (http://127.0.0.1:port) er prøvens emne,
    // ikke appfejl. De fanges i stedet af funktionstjekket på siden. Appens egne fejl (harness://) tæller med.
    page.on('pageerror', e => { if (!/\/\/127\.0\.0\.1:\d+\//.test(String(e.stack || ''))) errors.push(e.message); });
    await page.waitForFunction(() => !document.querySelector('#welcome-build').disabled);
    await page.exposeFunction('liveDemoEvent', event => {
      if (event.type === 'run.review') reviews.push(event);
      const info = event.properties?.info;
      if (event.type === 'message.updated' && info?.role === 'assistant' && info.tokens) usage[info.id] = info.tokens;
    });
    await page.evaluate(() => window.harness.onEvent(event => window.liveDemoEvent(event)));
    if (controlled) {
      await helpers.skipIntroduction(page);
      await helpers.addConnection(page, { name: 'Kontrolleret lokal prøve', baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'syntetisk-noegle', app });
    } else {
      await page.click('#path-app'); await page.click('#welcome-build'); await page.click('#setup-add-provider');
      await helpers.chooseProviderCard(page, provider); await page.locator('.key-guide > summary').click();
      await page.click('#enter-key');
      // Intet skærmbillede eller DOM-udtræk af vinduet, mens nøglen tastes. Nøglen skrives kun i nøglevinduet.
      note(`KLAR TIL NØGLE: Indtast ${provider}-nøglen i nøglevinduet, der er åbnet, og klik Kontrollér og gem. Ingen nøgle i chat eller terminal.`);
      await page.waitForFunction(() => !document.querySelector('#setup-continue').hidden && !document.querySelector('#setup-continue').disabled, null, { timeout: 30 * 60000, polling: 1000 });
      await page.click('#setup-continue'); await page.click('#features-all');
    }
    await page.waitForSelector('#create-form'); await page.fill('#purpose', idea); await page.click('#create');
    await page.waitForSelector('#workspace:not([hidden])', { timeout: 60000 });
    const folders = await fs.readdir(path.join(documents, 'Aura')); assert.equal(folders.length, 1);
    project = path.join(documents, 'Aura', folders[0]); report.project = project;
    if (wanted && await page.inputValue('#model-select') !== wanted) {
      await helpers.taskOptions(page); await page.locator('#model-catalog').evaluate(el => el.open = true);
      await page.waitForFunction(id => [...document.querySelector('#model-select').options].some(option => option.value === id), wanted);
      await page.selectOption('#model-select', wanted); await page.click('#model-done');
    }
    await page.waitForFunction(() => document.querySelector('#model-select').value);
    report.model = await page.inputValue('#model-select'); if (wanted) assert.equal(report.model, wanted);
    note(`Model: ${report.model}`);
    // Standardtilstanden er Samtale; prøvens planforløb kræver Planlæg.
    await helpers.selectMode(page, 'plan');
    await runUntilDone('plan', () => page.click('#send'));
    await check('Plan uden filændring', async () => { assert.equal(reviews.at(-1).files.length, 0); assert(await page.isVisible('#plan-card')); });
    await fs.writeFile(path.join(out, 'plan.txt'), await page.locator('#plan-text').textContent()); await shot('plan');
    await runUntilDone('bygning', () => page.click('#build-plan'));
    await check('Bygget preview filtrerer 1, 5, 9 og 99 deltagere', () => tryFilter('Mødelokaler'));
    const before = await snapshot(); report.before = hashes(before); await shot('bygget');
    await page.selectOption('#viewport-preset', 'phone'); await tryFilter('Mødelokaler'); await shot('mobil'); await page.selectOption('#viewport-preset', 'fluid');
    await page.fill('#prompt', correction); await runUntilDone('rettelse', () => page.click('#send'));
    await check('AI-rettelsen ændrer overskrift og bevarer funktionen', () => tryFilter('Find dit mødelokale'));
    const changed = await snapshot(); assert.notDeepEqual(changed, before); report.changed = hashes(changed); await shot('rettet');
    await (await helpers.resultOption(page, 'Fortryd opgaven')).click();
    await page.waitForSelector('#restore-dialog[open]'); await page.waitForFunction(() => !document.querySelector('#restore-confirm').disabled);
    await shot('gennemgaa-fortrydelse'); await page.click('#restore-confirm'); await page.waitForSelector('#restore-dialog', { state: 'hidden' });
    await check('Fortryd genskaber byteidentiske projektfiler', async () => assert.deepEqual(await snapshot(), before));
    await check('Preview virker igen efter fortrydelse', () => tryFilter('Mødelokaler')); await shot('fortrudt');
    assert.deepEqual(errors, []); assert(Object.keys(usage).length, 'Motoren rapporterer faktisk tokenforbrug.');
    report.status = 'bestået';
  } catch (error) {
    report.status = 'fejl'; report.stage = stage; report.error = error.message.split('\n')[0];
    if (controlled) note(error.stack || error.message);
    // Kun projekt/samtale efter opsætning; optag aldrig nøglefeltet ved opsætningsfejl.
    if (project) { await shot('fejl').catch(() => {}); await fs.writeFile(path.join(out, 'samtale.txt'), await page.locator('#messages').innerText().catch(() => '')); }
    throw error;
  } finally {
    if (project && report.status === 'bestået') await fs.writeFile(path.join(out, 'samtale.txt'), await page.locator('#messages').innerText());
    await app?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fs.rm(appdata, { recursive: true, force: true });
    await fs.writeFile(path.join(out, 'forbrug.json'), JSON.stringify(Object.values(usage), null, 2));
    await fs.writeFile(path.join(out, 'rapport.json'), JSON.stringify(report, null, 2));
    note('Prøvens isolerede appdata med den krypterede nøgle er slettet. Brugerens appdata og nøglering er uændret.');
    await fs.writeFile(path.join(out, 'log.txt'), log.join('\n'));
  }
  console.log(JSON.stringify({ status: report.status, realModel: report.realModel, packaged: report.packaged, out, checks }));
}
main().catch(error => { note(`STOP: ${error.message.split('\n')[0]}`); process.exitCode = 1; });
