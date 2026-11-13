// Kortgrænsen i Electron (årsag 13 og trin 13 i beslutningerne for beta 2). Del 1: et byggeforløb på 26 værktøjskald i et NYT projekt med
// standarderne (ikke manuelle godkendelser) må højst give fem godkendelseskort i den rigtige app. Del 2 (kortsamlingen, brugerens beslutning
// 10. november 2026, som afløser «højst fem kort pr. opgave»): det samme forløb i et projekt UDEN automatik. Efter fem kort spørger Aura én gang,
// om resten af opgaven må fortsætte i projektmappen; prøven svarer ja. Derefter kommer ingen kort for filændringer og søgning i projektet, mens
// kommandoer uden sandkasse og en læsning af en fil uden for projektet stadig giver et kort hver.
// Den rigtige OpenCode-motor bruges med en kontrolleret lokal modelserver (ingen nøgler, ingen netværkskald) og nye projekter i en midlertidig
// mappe; dette repository røres ikke. Et kort tælles, når #approvals viser et .approval, som brugeren skal svare på; kald, der afgøres uden kort,
// ses ikke. Samme forløb som tests/card-limit.test.cjs og tests/kortsamling.test.cjs, men gennem hele appen.
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
const SAMLING = 'Må resten af opgaven fortsætte i projektmappen?';

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kort-')));
  const documents = path.join(root, 'Dokumenter'); await fs.mkdir(documents);
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  // Del 2 læser til sidst en fil uden for projektet. Den skal stadig give et kort efter et ja til resten af opgaven.
  const outside = path.join(root, 'ekstern'), outsideFile = path.join(outside, 'noter.txt');
  await fs.mkdir(outside); await fs.writeFile(outsideFile, 'Noter uden for projektet.\n');
  let project = null, modelCalls = 0, ekstraTrin = [];
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
    else { modelCalls++; const alle = [...trin(), ...ekstraTrin]; step = tools.length < alle.length ? alle[tools.length] : { text: 'Siden er bygget.' }; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } } : {}) }) + '\n\n');
    if (step.tool) send({ role: 'assistant', tool_calls: [{ index: 0, id: `kald-${modelCalls}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
    else send({ role: 'assistant', content: step.text });
    send({}, step.tool ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const errors = [], seen = new Set(); let app, page;
  // Svar på hvert kort, til forløbet er færdigt, og tæl dem: «Ja, resten af opgaven» på kortet om resten af opgaven, ellers «Tillad én gang».
  async function besvar() {
    const kort = [], deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (await page.evaluate(() => document.querySelector('#stop').hidden)) break;
      const aktuelt = page.locator('#approvals .approval').first();
      if (await aktuelt.count()) {
        const id = await aktuelt.getAttribute('data-id');
        if (seen.has(id)) { await page.waitForTimeout(100); continue; }
        seen.add(id);
        const beskrivelse = await aktuelt.evaluate(el => ({ art: el.querySelector('.approval-kind')?.textContent || '', titel: el.querySelector('.approval-title')?.textContent || '', maal: el.querySelector('.approval-facts dd, code.action-target')?.textContent || '', samling: el.dataset.collect === 'true' }));
        kort.push(beskrivelse);
        await aktuelt.getByRole('button', { name: beskrivelse.samling ? 'Ja, resten af opgaven' : 'Tillad én gang', exact: true }).click();
        await page.waitForFunction(id => ![...document.querySelectorAll('#approvals .approval')].some(el => el.dataset.id === id), id, { timeout: 30000 });
      } else await page.waitForTimeout(100);
    }
    assert.equal(await page.evaluate(() => document.querySelector('#stop').hidden), true, 'forløbet blev ikke færdigt inden tiden');
    return kort;
  }
  // Et nyt projekt med AI-forbindelse, model og arbejdsmåden Arbejd direkte. Første gang oprettes forbindelsen.
  async function nytProjekt(formaal, eksisterende = []) {
    await helpers.toOnboarding(page);
    await page.fill('#purpose', formaal); await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
    const mappe = (await fs.readdir(path.join(documents, 'Aura'))).find(navn => !eksisterende.includes(navn));
    return path.join(documents, 'Aura', mappe);
  }
  async function send(tekst, connection) {
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection); await page.locator('#model-shortlist button').first().click();
    await helpers.selectMode(page, 'free');
    await page.fill('#prompt', tekst); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden || /Fejl/.test(document.querySelector('#run-status').textContent));
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
  }
  async function filerneErSkrevet() {
    // Kortene kan være nul, fordi et nyt projekt godkender filændringer, søgning og kommandoer automatisk. Så skal forløbet stadig have
    // gjort sit arbejde, ellers er tællingen tom: filændringerne står på disken.
    const index = await fs.readFile(path.join(project, 'public/index.html'), 'utf8');
    assert.match(index, /Find et mødelokale/); assert.match(index, /Fire lokaler\./);
    assert.match(await fs.readFile(path.join(project, 'src/app.js'), 'utf8'), /lokaler = 4/);
    assert.match(await fs.readFile(path.join(project, 'public/styles.css'), 'utf8'), /font-family: serif/);
    await fs.access(path.join(project, 'public/om.html'));
  }
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.isolateDocuments(app, documents); await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    // Del 1. Bevidst IKKE helpers.manualApprovals: prøven gælder de standarder, et nyt projekt får.
    project = await nytProjekt('En side med mødelokaler.');
    // trin() bygger stierne i projektet, så antallet kan først kontrolleres her (før stod kontrollen før try og fejlede altid).
    assert.equal(trin().length, ANTAL_TRIN);
    await helpers.addConnection(page, { name: 'Kontrolleret', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0].id;
    await send('Byg siden med mødelokaler', connection);
    const kort = await besvar();
    assert.ok(modelCalls > ANTAL_TRIN, `modellen blev kun kaldt ${modelCalls} gange; forløbet på ${ANTAL_TRIN} trin blev ikke gennemført`);
    await filerneErSkrevet();
    console.log(`${kort.length} kort på ${ANTAL_TRIN} trin:`); for (const k of kort) console.log(`  ${k.art} | ${k.titel} | ${k.maal.slice(0, 80)}`);
    assert.ok(kort.length <= MAX_KORT, `${kort.length} godkendelseskort på ${ANTAL_TRIN} trin; grænsen er ${MAX_KORT}`);
    assert.equal(kort.some(k => k.samling), false, 'et nyt projekt med standarderne når ikke spørgsmålet om resten af opgaven');
    console.log(`✓ Højst ${MAX_KORT} kort på et byggeforløb med ${ANTAL_TRIN} trin i et nyt projekt (${kort.length} set)`);

    // Del 2. Kortsamlingen i et projekt uden automatik (som et åbnet eller ældre projekt): samme forløb og til sidst en fil uden for projektet.
    const foerste = path.basename(project);
    project = await nytProjekt('Endnu en side med mødelokaler.', [foerste]);
    await helpers.manualApprovals(page);
    ekstraTrin = [{ tool: 'read', args: { filePath: outsideFile } }];
    const kaldFoer = modelCalls;
    await send('Byg siden med mødelokaler uden automatik', connection);
    const samlet = await besvar();
    assert.ok(modelCalls - kaldFoer > ANTAL_TRIN + 1, `modellen blev kun kaldt ${modelCalls - kaldFoer} gange i del 2`);
    await filerneErSkrevet();
    console.log(`${samlet.length} kort på ${ANTAL_TRIN + 1} trin uden automatik:`); for (const k of samlet) console.log(`  ${k.samling ? '[samling] ' : ''}${k.art} | ${k.titel} | ${k.maal.slice(0, 80)}`);
    const spoergsmaal = samlet.findIndex(k => k.samling);
    assert.equal(spoergsmaal, MAX_KORT, 'spørgsmålet om resten af opgaven er det sjette kort');
    assert.equal(samlet[spoergsmaal].titel, SAMLING);
    assert.equal(samlet.filter(k => k.samling).length, 1, 'Aura spørger én gang i opgaven');
    assert.ok(samlet.slice(0, MAX_KORT).every(k => !k.samling), 'de første fem kort er almindelige kort');
    const efter = samlet.slice(spoergsmaal + 1);
    assert.equal(efter.some(k => /Filændring|Søgning i filer/.test(k.art)), false, `efter ja kommer ingen kort for filændringer eller søgning i projektet: ${efter.map(k => k.art).join(', ')}`);
    const ude = efter.filter(k => /Adgang uden for projektet/.test(k.art));
    assert.equal(ude.length, 1, 'filen uden for projektet giver stadig et kort efter ja');
    assert.equal(ude[0].titel, 'Må AI’en se en mappe uden for projektet?');
    assert.equal(efter.filter(k => /Kommando/.test(k.art)).length, 5, 'kommandoerne kører uden sandkasse og spørger stadig hver gang');
    assert.equal(samlet.length, MAX_KORT + 1 + 5 + 1, 'fem kort, spørgsmålet, fem kommandoer og mappen udenfor');
    assert.deepEqual(errors, []);
    console.log(`✓ Uden automatik: fem kort, så ét spørgsmål om resten af opgaven; efter ja kun kommandoer uden sandkasse og filen uden for projektet (${samlet.length} kort)`);
  } finally {
    await app?.close().catch(() => {}); server.close(); await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
