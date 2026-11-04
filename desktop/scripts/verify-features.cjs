// Funktioner: hele forløbet i Electron med rigtig OpenCode, Git og projektfiler. Modellen er en kontrolleret server.
// Første start med Vælg selv, en funktion der bygger på en anden, undtagelser pr. projekt, skills i motoren,
// et projekt uden versioner og genstart. Global Git-opsætning er slået fra, så appens anonyme identitet bruges.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { run } = require('../core/git.cjs');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-funktioner-')));
  const documents = path.join(root, 'Dokumenter');
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  let project = '', writes = 0;
  const prompts = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'test-model', name: 'Kontrolleret testmodel' }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const main = body.tools?.some(tool => tool.function?.name === 'write');
    if (main && !body.messages.some(m => m.role === 'tool')) {
      const system = JSON.stringify(body.messages.filter(m => m.role === 'system'));
      prompts.push({ system, skills: [...system.matchAll(/<name>([a-z0-9-]+)<\/name>/g)].map(found => found[1]).sort() });
    }
    const tool = main && !body.messages.some(m => m.role === 'tool') ? { id: 'skriv', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(project, 'public/index.html'), content: `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Lokaler</title></head><body><h1>Udkast ${++writes}</h1></body></html>` }) } } : null;
    res.setHeader('content-type', 'text/event-stream');
    const chunk = { id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, ...tool }] } : { role: 'assistant', content: main ? 'Siden er bygget.' : 'Titel' }, finish_reason: null }] };
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app, page;
  const errors = [];
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ELECTRON_RUN_AS_NODE: undefined } });
    await helpers.isolateDocuments(app, documents);
    page = await app.firstWindow(); page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !document.querySelector('#create').disabled && !document.querySelector('#new').disabled);
  };
  const shot = name => page.screenshot({ path: path.join(root, `${name}.png`), animations: 'disabled' });
  const toggle = (list, id) => page.locator(`${list} input[data-feature="${id}"]`);
  const features = async () => (await page.evaluate(() => window.harness.featuresGet())).value;
  const log = async () => (await run(project, ['log', '--format=%s'])).toString().trim().split('\n');
  const heading = text => page.frameLocator('#preview').locator('h1').filter({ hasText: text }).waitFor({ timeout: 90000 });
  async function chooseModel() {
    const connection = (await page.evaluate(() => window.harness.connectionState())).value.connections[0];
    await helpers.taskOptions(page); await page.selectOption('#connection-select', connection.id);
    await page.waitForFunction(() => document.querySelector('#model-select').options.length === 2); await page.locator('#model-shortlist button').first().click();
  }
  async function sendTask(text, expectVersion) {
    if (text) await page.fill('#prompt', text);
    const before = prompts.length;
    await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(el => el.open)) await page.click('#accept-send');
    await helpers.approve(page, 'Tillad for denne opgave');
    await heading(`Udkast ${writes}`);
    await helpers.resultOption(page, expectVersion ? 'Fortryd opgaven' : 'Se ændringer');
    await page.waitForFunction(() => document.querySelector('#run-status').textContent === 'Klar');
    assert.equal(prompts.length, before + 1, 'én ny opgave nåede modellen');
    return prompts.at(-1);
  }
  try {
    await launch();
    // 1. Første start: AI vælges senere, derefter ét spørgsmål om funktioner.
    await page.click('#path-app'); await page.click('#welcome-build'); await page.waitForSelector('#setup:not([hidden])');
    await page.click('#setup-local');
    await page.locator('#setup-title').filter({ hasText: 'Hvad skal Aura hjælpe med?' }).waitFor();
    assert.equal((await features()).chosen, '');
    await page.click('#features-pick');
    await page.locator('#setup-title').filter({ hasText: 'Hvad vil du slå til?' }).waitFor();
    assert.equal(await page.locator('#setup-features-list input[data-feature]').count(), 6);
    assert.equal(await page.locator('#setup-features-list input[data-feature]:checked').count(), 0, 'Vælg selv starter uden funktioner');
    assert.equal(await page.textContent('#features-continue'), 'Fortsæt uden funktioner');
    // Deling bygger på versionerne: den ene slår den anden til, og et fravalg af versioner slår deling fra.
    await toggle('#setup-features-list', 'deling').check();
    assert.equal(await toggle('#setup-features-list', 'versioner').isChecked(), true);
    assert.equal(await page.textContent('#features-continue'), 'Fortsæt med 2 funktioner');
    await toggle('#setup-features-list', 'versioner').uncheck();
    assert.equal(await toggle('#setup-features-list', 'deling').isChecked(), false);
    await toggle('#setup-features-list', 'versioner').check();
    assert.equal(await page.textContent('#features-continue'), 'Fortsæt med 1 funktion');
    await shot('vaelg-selv');
    await page.click('#features-continue'); await page.waitForSelector('#create-form');
    const chosen = await features();
    assert.equal(chosen.chosen, 'valgt');
    assert.deepEqual(chosen.defaults, { versioner: true, planlaegning: false, design: false, sikkerhed: false, kvalitet: false, deling: false, 'integration-adresser': false, 'integration-cvr': false, 'integration-promte': false, 'integration-komplai-run': false });
    assert.equal(await page.locator('#setup-features-list .feature-row').count(), 6, 'integrationer vælges ikke ved første start');
    // 2. Startsiden viser ikke design og hostingønske, når funktionerne er slået fra.
    await helpers.projectOptions(page);
    assert.equal(await page.isVisible('#design-options'), false); assert.equal(await page.isVisible('#startup-hosting-row'), false);
    // ⓘ uden for en dialog: et klik åbner forklaringen, Escape lukker den, og fokus vender tilbage til knappen.
    await page.click('#onboarding .intro .info');
    await page.locator('#info-pop').filter({ hasText: 'foreslår teknologi ud fra din idé' }).waitFor();
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#info-pop').matches(':popover-open'));
    assert.equal(await page.evaluate(() => document.activeElement.matches('#onboarding .intro .info')), true);
    // Flere valg viser kun AI og tests; udgivelse og design hører til funktioner, der er slået fra.
    assert.equal(await page.isVisible('#design-row'), false);
    assert.deepEqual(await page.locator('#project-options .setting-row:visible label').allTextContents(), ['AI', 'Tests']);
    await shot('startside-uden-design');
    await page.fill('#purpose', 'Jeg vil lave en oversigt over tre fiktive mødelokaler.'); await page.click('#create');
    await page.waitForSelector('#workspace:not([hidden])');
    project = path.join(documents, 'Aura', (await fs.readdir(path.join(documents, 'Aura')))[0]);
    assert.deepEqual(await log(), ['Projekt oprettet'], 'Versioner og fortryd giver Git fra start');
    // Udgiv er altid synlig; uden Udgivelse viser Udgiv det næste trin.
    assert.equal(await page.isVisible('#deploy-button'), true); assert.equal(await page.evaluate(() => window.sharingOn()), false, 'deling er slået fra');
    await page.click('#project-menu-toggle');
    assert.equal(await page.isVisible('#git-button'), true); assert.equal(await page.isVisible('#publish-button'), false);
    await page.keyboard.press('Escape');
    // Et nyt projekt starter i Byg; se DESIGN.md. Prøven arbejder direkte, som uden planlægning.
    assert.equal(await page.inputValue('#work-mode'), 'free');
    await helpers.selectMode(page, 'free');
    assert.match(await page.inputValue('#prompt'), /tre fiktive mødelokaler/);
    // 3. Første opgave: kun Git-skillen kan hentes, og appens regler følger funktionerne.
    await helpers.addConnection(page, { name: 'Kontrolleret model', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    await chooseModel();
    await page.click('#send'); await page.waitForSelector('#data-dialog[open]');
    assert.match(await page.textContent('#data-details'), /Skills, AI’en kan hente\s*Git og samarbejde/);
    await page.click('#accept-send');
    await helpers.approve(page, 'Tillad for denne opgave');
    await heading('Udkast 1'); await helpers.resultOption(page, 'Fortryd opgaven');
    await page.waitForFunction(() => document.querySelector('#run-status').textContent === 'Klar');
    assert.deepEqual(prompts[0].skills, ['harness-git-og-samarbejde']);
    for (const text of ['APPENS REGLER', 'FÆLLES-GRUNDLAG-02', 'slået planlægning før bygning fra', 'Udgivelse er slået fra', 'gemmer selv en version efter hver AI-opgave']) assert.ok(prompts[0].system.includes(text), text);
    assert.match((await log())[0], /^AI-opgave: /);
    // 4. Indstillinger › Funktioner: en undtagelse for projektet og en ændring for alle projekter.
    await helpers.menuClick(page, '#features-button'); await page.waitForSelector('#features-dialog[open]');
    assert.equal(await page.isVisible('#features-scope'), true); assert.equal(await page.locator('#features-list .feature-row').count(), 10);
    assert.equal(await page.textContent('#features-list .features-group'), 'Integrationer');
    // Projektvalgets skjulte radioknapper fik før den generelle input-bredde og gav dialogen en vandret rullebjælke.
    assert.deepEqual(await page.locator('#features-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'dialogen har ingen vandret rullebjælke');
    // ⓘ i en dialog: forklaringen ligger i dialogen, viser funktionens skills og lukker igen ved et klik på samme ⓘ.
    const skillsInfo = page.locator('#features-list .feature-row[data-feature="planlaegning"] .info');
    await skillsInfo.click(); await page.locator('#features-dialog #info-pop').filter({ hasText: 'Idé og afgrænsning' }).waitFor();
    assert.equal(await skillsInfo.getAttribute('aria-expanded'), 'true');
    await skillsInfo.click(); await page.waitForFunction(() => !document.querySelector('#info-pop').matches(':popover-open'));
    assert.equal(await skillsInfo.getAttribute('aria-expanded'), 'false');
    await page.locator('#features-scope label').filter({ hasText: 'Kun' }).click();
    // Planlægning slået til rører ikke den valgte arbejdsmåde.
    await toggle('#features-list', 'planlaegning').check();
    assert.equal(await page.inputValue('#work-mode'), 'free', 'et tilvalg ændrer ikke arbejdsmåden');
    // Men slås Planlægning fra, mens man står i Planlæg, falder arbejdsmåden tilbage til standarden, Samtale.
    await page.click('[data-close="features-dialog"]');
    await helpers.selectMode(page, 'plan');
    await helpers.menuClick(page, '#features-button'); await page.waitForSelector('#features-dialog[open]');
    await page.locator('#features-scope label').filter({ hasText: 'Kun' }).click();
    await page.locator('#features-list .feature-row[data-feature="planlaegning"] button').filter({ hasText: 'Brug standarden' }).click();
    await page.waitForFunction(() => document.querySelector('#work-mode').value === 'chat');
    assert.deepEqual((await features()).exceptions, {});
    await toggle('#features-list', 'deling').check();
    await page.locator('#features-list .feature-note').filter({ hasText: 'Kun i dette projekt: slået til.' }).waitFor();
    assert.deepEqual((await features()).exceptions, { deling: true });
    assert.equal(await page.evaluate(() => window.sharingOn()), true, 'deling er slået til i projektet med undtagelsen');
    // En integration slås til for projektet. Dens ⓘ viser ejer, adgang og dataflow.
    await toggle('#features-list', 'integration-adresser').check();
    await page.locator('#features-list .feature-row[data-feature="integration-adresser"] .feature-note').filter({ hasText: 'Kun i dette projekt: slået til.' }).waitFor();
    const integrationInfo = page.locator('#features-list .feature-row[data-feature="integration-adresser"] .info');
    await integrationInfo.click(); await page.locator('#features-dialog #info-pop').filter({ hasText: 'Ejer: Klimadatastyrelsen' }).waitFor(); await integrationInfo.click();
    assert.deepEqual((await features()).exceptions, { deling: true, 'integration-adresser': true });
    await page.locator('#features-scope label').filter({ hasText: 'Alle projekter' }).click();
    assert.equal(await toggle('#features-list', 'deling').isChecked(), false, 'standarden for alle projekter er uændret');
    await toggle('#features-list', 'kvalitet').check();
    await page.locator('#features-feedback').filter({ hasText: 'Gemt for alle projekter' }).waitFor();
    await page.locator('#features-always > summary, .features-always > summary').first().click();
    await shot('funktioner-panel');
    await page.click('[data-close="features-dialog"]');
    await helpers.selectMode(page, 'free');
    // 5. Næste opgave starter en ny modelsession med de nye skills og regler.
    const second = await sendTask('Gør overskriften tydeligere.', true);
    assert.deepEqual(second.skills, ['harness-afproevning-og-fejlretning', 'harness-git-og-samarbejde', 'harness-integration-adresser', 'harness-kodestil', 'harness-overdragelse-og-drift', 'harness-udgivelse-og-gendannelse']);
    assert.ok(second.system.includes('Udgiv-knap'));
    assert.ok(second.system.includes('slået disse integrationer til: Adresser'));
    // 6. Uden Versioner og fortryd får et nyt projekt ingen Git, og resultatkortet tilbyder ikke versioner.
    await helpers.menuClick(page, '#features-button'); await page.locator('#features-scope label').filter({ hasText: 'Alle projekter' }).click();
    await toggle('#features-list', 'versioner').uncheck();
    await page.locator('#features-list .feature-note').filter({ hasText: 'slået til, men kræver Versioner og fortryd' }).waitFor();
    assert.equal(await page.evaluate(() => window.sharingOn()), false, 'deling kræver versionerne, også som undtagelse');
    await page.click('[data-close="features-dialog"]');
    await page.click('#new'); await page.waitForSelector('#onboarding:not([hidden])');
    await page.fill('#purpose', 'Jeg vil lave en liste over fiktive cykelruter.'); await page.fill('#name', 'Cykelruter'); await page.click('#create');
    await page.locator('#project-name').filter({ hasText: 'Cykelruter' }).waitFor();
    project = path.join(documents, 'Aura', 'projekt-cykelruter');
    await assert.rejects(fs.access(path.join(project, '.git')), 'intet Git-repository uden versioner');
    await page.click('#project-menu-toggle'); assert.equal(await page.isVisible('#git-button'), false); await page.keyboard.press('Escape');
    await chooseModel();
    await helpers.selectMode(page, 'free');
    const third = await sendTask('', false);
    assert.equal(await page.locator('#run-review button').filter({ hasText: 'Gem version' }).count(), 0);
    assert.ok(third.system.includes('slået versioner fra')); assert.ok(!third.skills.includes('harness-git-og-samarbejde'));
    await assert.rejects(fs.access(path.join(project, '.git')), 'opgaven opretter heller ikke Git');
    await shot('uden-versioner');
    // 7. Efter genstart er valget husket, og spørgsmålet stilles ikke igen.
    await app.close(); app = null; await launch();
    await page.locator('#project-name').filter({ hasText: 'Cykelruter' }).waitFor();
    assert.equal(await page.locator('#welcome-dialog').evaluate(el => el.open), false);
    assert.equal(await page.isVisible('#setup'), false);
    const after = await features();
    assert.equal(after.chosen, 'valgt'); assert.equal(after.defaults.versioner, false); assert.equal(after.defaults.kvalitet, true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: ['første start med Vælg selv', 'deling og versioner følges ad', 'startsiden uden design og hosting', 'ⓘ åbner og lukker i og uden for en dialog', 'Git fra start med versioner', 'Del og sikkerhedskopi skjult uden deling', 'direkte arbejde uden planlægning', 'kun aktive skills i motoren', 'appens regler følger funktionerne', 'undtagelse for ét projekt', 'ingen vandret rullebjælke i dialogen', 'integration slået til for ét projekt', 'arbejdsmåden følger planlægning med det samme', 'ændring for alle projekter', 'ny modelsession med nye skills', 'projekt uden Git og uden versionsknapper', 'valget husket efter genstart'] }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }).catch(() => {});
    console.error(JSON.stringify({ root, errors }));
    throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
