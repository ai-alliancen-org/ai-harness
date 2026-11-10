// Rigtig Electron og OpenCode med tre syntetiske projekter og kontrollerede lokale modelsvar.
// Ingen Git-skrivninger, eksterne modelkald eller udgivelser. Prøvens filer bliver i en ny midlertidig mappe.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-flere-projekter-')));
  const bundle = process.env.HARNESS_TEST_PACKAGE && path.resolve(process.env.HARNESS_TEST_PACKAGE);
  const executablePath = bundle ? (bundle.endsWith('.app') ? path.join(bundle, 'Contents/MacOS', path.basename(bundle, '.app')) : bundle) : require('electron');
  const platformPath = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin:/usr/sbin:/sbin';
  const projects = await Promise.all(['Alfa', 'Beta', 'Gamma'].map(async (name, index) => {
    const folder = path.join(root, name), file = path.join(folder, 'public', 'index.html');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `<h1>${name} før</h1>`);
    return { name, root: folder, file, model: `test-${index}` };
  }));
  const requests = [], held = new Map(), errors = [], checks = [];
  // Nøglerne indtastes i nøglevinduet, som kun tager imod synlig ASCII (derfor ingen æ, ø eller å). Forventningerne bruger de
  // samme konstanter, så den indtastede nøgle og den forventede ikke kan glide fra hinanden igen.
  const KEY_BEFORE = 'syntetisk-noegle-foer-opgaven', KEY_AFTER = 'syntetisk-noegle-efter-opgaven';
  // Kommandoen, AI'en kører uden sandkasse efter én godkendelse. Den skriver, om den har arvet motorens hemmeligheder i sit miljø (RN:B1-2):
  // OPENCODE_CONFIG_CONTENT (gatewayens midlertidige adgangskode og adresse) og OPENCODE_SERVER_PASSWORD. Motoren tømmer dem i shell.env.
  const HUSKET_KOMMANDO = "node -e \"require('node:fs').writeFileSync('husket-resultat.json',JSON.stringify({nøgle:Boolean(process.env.OPENCODE_CONFIG_CONTENT),adgangskode:Boolean(process.env.OPENCODE_SERVER_PASSWORD)}))\"";
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: projects.map(item => ({ id: item.model, name: item.name })) }));
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end(); }
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw), project = projects.find(item => item.model === body.model);
      requests.push({ body, authorization: req.headers.authorization });
      if (!project) { res.writeHead(400); return res.end('Ukendt syntetisk model'); }
      const reply = (delta, finish = 'stop') => {
        if (res.destroyed) return;
        res.setHeader('content-type', 'text/event-stream');
        const frame = { id: 'test-' + requests.length, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
        res.write('data: ' + JSON.stringify(frame) + '\n\n');
        res.write('data: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 10 } }) + '\n\n'); res.end('data: [DONE]\n\n');
      };
      if (!body.tools?.length) return reply({ content: project.name });
      const lastUser = [...body.messages].reverse().find(message => message.role === 'user');
      if (JSON.stringify(lastUser?.content).includes('konkret cykelforslag')) return reply({ content: '## Det bygger vi\nEn cykeloversigt.\n## Sådan skal det se ud\nBlå kort.\n## Teknik og data\nLokale prøveværdier.\n## Det skal du prøve (i forhåndsvisningen)\nTilføj en cykel.\n<!-- aura:offer-plan -->' });
      if (JSON.stringify(lastUser?.content).includes('Byg første udkast efter den plan')) return reply({ content: 'Cykelforslaget er taget med direkte til bygning.' });
      if (JSON.stringify(lastUser?.content).includes('17 blå cykler')) return reply({ content: 'Vi bygger en oversigt med antal og farve for cyklerne.' });
      if (JSON.stringify(lastUser?.content).includes('Sæt i gang!') || JSON.stringify(lastUser?.content).includes('Fortsæt med cyklerne')) return reply({ content: 'Jeg fortsætter med den aftalte cykeloversigt.' });
      if (JSON.stringify(lastUser?.content).includes('automatisk projektfil')) {
        if (body.messages.at(-1)?.role === 'tool') return reply({ content: 'Projektfilen er skrevet med den valgte tilladelse.' });
        return reply({ tool_calls: [{ index: 0, id: 'autofil', type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(project.root, 'automatisk.txt'), content: 'Tilladt projektfil' }) } }] }, 'tool_calls');
      }
      if (JSON.stringify(lastUser?.content).includes('husket kommando')) {
        if (body.messages.at(-1)?.role === 'tool') return reply({ content: 'Den præcise huskede kommando er udført.' });
        return reply({ tool_calls: [{ index: 0, id: 'husket', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: HUSKET_KOMMANDO, workdir: project.root, description: 'Prøver en præcis husket kommando' }) } }] }, 'tool_calls');
      }
      if (JSON.stringify(lastUser?.content).includes('isoleret kommando')) {
        if (body.messages.at(-1)?.role === 'tool') return reply({ content: 'Den isolerede kommando er udført.' });
        return reply({ tool_calls: [{ index: 0, id: 'isoleret', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: "node -e \"const fs=require('node:fs');fs.writeFileSync('isolationsresultat.json',JSON.stringify({nøgle:Boolean(process.env.OPENCODE_CONFIG_CONTENT),ok:true}))\"", workdir: project.root, description: 'Prøver isoleret projektarbejde' }) } }] }, 'tool_calls');
      }
      if (JSON.stringify(lastUser?.content).includes('Svar igen med ny nøgle')) { held.set('compact', () => reply({ content: project.name + ' efter sammenfatning.' })); res.on('close', () => held.delete('compact')); return; }
      if (JSON.stringify(lastUser?.content).includes('ny nøgle')) return reply({ content: project.name + ' bruger den nye nøgle.' });
      if (body.messages.at(-1)?.role === 'tool') {
        held.set(project.model, () => reply({ content: project.name + ' er færdig. Prøv forhåndsvisningen.' }));
        res.on('close', () => held.delete(project.model)); return;
      }
      reply({ tool_calls: [{ index: 0, id: 'skriv-' + project.model, type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: project.file, content: `<h1>${project.name} efter</h1>` }) } }] }, 'tool_calls');
    } catch (error) { errors.push(error.message); if (!res.destroyed) { res.writeHead(500); res.end('Syntetisk serverfejl'); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // Gamle kommandoregler, som beta 2 og beta 3 gemte dem, og en gemt hjemmeside, lagt i appens lager før start (brugerens beslutning
  // 10. november 2026, «Fjern funktionen»): kommandoreglerne bevares, men bruges aldrig og står under Projektets tilladelser som «Ikke i brug».
  // Beta 2's regel for HUSKET_KOMMANDO har AI'ens input i nøglen, beta 3's har kommando og mappe; de står som én række. Den indpakkede form er
  // sandkassens indpakning af npm test, som beta 2 kunne gemme. Hjemmesiden står som før.
  const { createHash } = require('node:crypto'), seed = new (require('../core/store.cjs').Store)(path.join(root, 'appdata', 'harness'), {});
  const seededRule = (kind, match, label) => ({ id: createHash('sha256').update(JSON.stringify(match)).digest('hex'), kind, label, target: label.replace(/^[^:]+: /, ''), match });
  const wrapped = `exec /usr/bin/env -i PATH='/usr/bin:/bin' '/app/node' '/app/core/command-sandbox-runner.mjs' '/appdata/policy.json' '${Buffer.from(JSON.stringify({ command: 'npm test', cwd: projects[0].root })).toString('base64url')}'`;
  await seed.update(state => { state.projects[seed.projectKey(projects[0].root)] = { approvals: { version: 1, autoProjectFiles: false, autoCommands: false, rules: [
    seededRule('bash', { kind: 'bash', command: HUSKET_KOMMANDO, cwd: projects[0].root, input: { command: HUSKET_KOMMANDO, description: 'Prøver en præcis husket kommando', workdir: projects[0].root } }, `Kommando: ${HUSKET_KOMMANDO}`),
    seededRule('bash', { kind: 'bash', command: HUSKET_KOMMANDO, cwd: projects[0].root }, `Kommando: ${HUSKET_KOMMANDO}`),
    seededRule('bash', { kind: 'bash', command: wrapped, cwd: projects[0].root, input: {} }, `Kommando: ${wrapped}`),
    seededRule('webfetch', { kind: 'webfetch', origin: 'https://example.test' }, 'Hjemmeside: https://example.test')
  ] } }; });
  let app, page;
  const check = text => { checks.push(text); console.log('Bestået: ' + text); };
  const waitHeld = async model => { for (let n = 0; n < 600 && !held.has(model); n++) await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(held.has(model), 'modellen afventer kontrolleret svar'); };
  const call = async (method, input) => { const result = await page.evaluate(({ method, input }) => window.harness[method](input), { method, input }); assert.equal(result.ok, true, result.error); return result.value; };
  const idle = async () => { for (let n = 0; n < 600; n++) { if (!(await call('connectionState')).running) return; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail('opgaven afslutter ikke'); };
  const active = project => page.waitForFunction(folder => document.querySelector('#project-path').textContent === folder, project.root);
  const switchTo = async project => { await page.locator('#project-list .project-name').filter({ hasText: project.name }).click(); await active(project); };
  const send = async text => {
    await page.fill('#prompt', text); await page.click('#send');
    await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(element => element.open)) await page.click('#accept-send');
  };
  const allow = async () => {
    const once = page.locator('#approvals button').filter({ hasText: /^Tillad én gang$/ });
    await once.first().waitFor(); await once.first().click();
  };
  try {
    if (bundle) {
      const resources = bundle.endsWith('.app') ? path.join(bundle, 'Contents', 'Resources') : path.join(path.dirname(bundle), 'resources');
      const modules = path.join(resources, 'app.asar.unpacked', 'node_modules');
      const bundledRequire = createRequire(path.join(modules, '@opencode-ai', 'plugin', 'package.json'));
      assert.equal(typeof bundledRequire('cross-spawn'), 'function', 'den eksterne runtime indlæser hele cross-spawn-kæden uden Electron/asar');
      const dependencyRequire = createRequire(bundledRequire.resolve('cross-spawn'));
      assert.ok(dependencyRequire.resolve('which').startsWith(modules + path.sep));
      check('pakkens eksterne runtime kan indlæse SDK-afhængigheder efter electron-builders flytning af moduler');
    }
    app = await electron.launch({ executablePath, args: [...(bundle ? [] : [path.join(__dirname, '..')]), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ...(bundle ? { PATH: platformPath, HARNESS_OPENCODE_PATH: '' } : {}) } });
    await helpers.forbidGitWrites(app);
    await app.evaluate(({ app }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { OpenCodeEngine } = require('./core/engine.cjs'), handle = OpenCodeEngine.prototype.handleEvent;
      globalThis.multiProjectEngineEvents = []; globalThis.multiProjectEngines = [];
      // Hver motor, der startes, så prøven kan se, om en kommando kørte med eller uden sandkasse (RN:B1-2).
      const start = OpenCodeEngine.prototype.start; OpenCodeEngine.prototype.start = function(...args) { globalThis.multiProjectEngines.push(this); return start.apply(this, args); };
      OpenCodeEngine.prototype.handleEvent = function(event) { globalThis.multiProjectEngineEvents.push({ at: Date.now(), type: event.type, recovered: event.recovered === true, compacting: Boolean(this.compaction), root: this.root }); if (globalThis.dropProjectIdle === this.root && !event.recovered && (event.type === 'session.idle' || event.type === 'session.status' && event.properties?.status?.type === 'idle')) return; return handle.call(this, event); };
    });
    await app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = (url, options) => { if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(String(url))) throw Error('Prøven tillader kun lokal netadgang.'); return original(url, options); };
    });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page); page.setDefaultTimeout(90000); await helpers.enableSharing(page);
    const connection = await helpers.addConnection(page, { name: 'Tre kontrollerede modeller', baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: KEY_BEFORE, app });
    await page.evaluate(() => { window.multiProjectEvents = []; window.harness.onEvent(event => window.multiProjectEvents.push(event)); });
    for (const project of projects) {
      await helpers.openExistingProject(app, page, project.root); await helpers.taskOptions(page);
      await page.selectOption('#connection-select', connection.id);
      await page.waitForFunction(model => [...document.querySelector('#model-select').options].some(option => option.value === model), project.model);
      if (!await page.locator('#model-catalog').evaluate(element => element.open)) await page.click('#model-catalog > summary');
      await page.selectOption('#model-select', project.model); await helpers.selectMode(page, 'free');
      await send('Byg siden for ' + project.name);
      await page.locator('#approvals .approval').first().waitFor();
      assert.equal(await page.locator('#open').isEnabled(), true); assert.equal(await page.locator('#new').isEnabled(), true);
      project.chat = (await call('connectionState')).chat;
    }
    const list = await call('recentProjects');
    for (const project of projects) assert.equal(list.find(item => item.root === project.root).chats.find(item => item.id === project.chat).running, true);
    assert.deepEqual(new Set(requests.filter(item => item.body.tools?.length).map(item => item.body.model)), new Set(projects.map(item => item.model)));
    check('tre projekter med hver sin model arbejder samtidigt og venter på hver sin godkendelse');
    await helpers.menuClick(page, '#features-button'); assert.equal(await page.locator('#features-dialog').evaluate(element => element.open), true);
    await call('featuresSave', { scope: 'projekt', values: { design: false } });
    await page.click('[data-close="features-dialog"]');
    await page.click('#deploy-button'); await page.locator('#deployment-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#deployment-fields').isDisabled(), false);
    await page.screenshot({ path: path.join(root, 'udgiv-under-arbejde.png'), animations: 'disabled' });
    await page.click('[data-close="deployment-dialog"]');
    await helpers.previewOptions(page); assert.equal(await page.locator('#attach-preview').isEnabled(), true); await page.keyboard.press('Escape');
    await call('saveConnection', { id: connection.id, kind: 'compatible', name: 'Nyt navn til næste opgave', baseURL: connection.baseURL });
    // Hovedvinduet kan ikke sende en nøgle, heller ikke under arbejdet. Den indtastes i nøglevinduet.
    const withKey = await page.evaluate(value => window.harness.saveConnection(value), { id: connection.id, kind: 'compatible', name: 'Nyt navn til næste opgave', baseURL: connection.baseURL, apiKey: KEY_AFTER });
    assert.equal(withKey.ok, false); assert.match(withKey.error, /nøglevinduet/);
    const removed = await page.evaluate(id => window.harness.removeConnection(id), connection.id); assert.equal(removed.ok, false); assert.match(removed.error, /bruges af en opgave/);
    // Nøglen skiftes under arbejdet ad brugerens vej: Indstillinger › AI-forbindelser › Åbn › Indtast ny nøgle › nøglevinduet.
    await helpers.menuClick(page, '#connections-button');
    await page.waitForFunction(() => { const dialog = document.querySelector('#connections-dialog'); return dialog.open && !dialog.getAnimations().some(animation => animation.playState === 'running'); });
    await page.click('#saved-connections button[aria-label="Åbn Nyt navn til næste opgave"]');
    await page.waitForSelector('#connection-edit:not([hidden])');
    await page.click('#enter-key'); await helpers.enterCredential(app, KEY_AFTER);
    // Efter en gemt nøgle viser dialogen listen igen med kvitteringen i #connections-feedback.
    await page.locator('#connections-feedback').filter({ hasText: 'Nøglen er kontrolleret og gemt krypteret.' }).waitFor();
    await page.click('[data-close="connections-dialog"]');
    check('Indstillinger, Udgiv og preview kan åbnes under arbejdet; forbindelse og nøgle kan ændres, men forbindelsen ikke fjernes i brug');
    for (const project of projects) {
      await switchTo(project);
      assert.match(await page.locator('#approvals').textContent(), /index\.html/);
      await allow(); await waitHeld(project.model);
      assert.match(await fs.readFile(project.file, 'utf8'), new RegExp(project.name + ' efter'));
    }
    assert.equal(requests.filter(item => item.body.tools?.length).every(item => item.authorization === 'Bearer ' + KEY_BEFORE), true, 'alle aktive gatewaykald bruger den oprindelige nøgle, også efter nøgleskiftet');
    // Alfa afslutter i baggrunden, mens Gamma stadig arbejder og vises.
    held.get(projects[0].model)();
    await page.waitForFunction(chat => window.multiProjectEvents.some(event => event.type === 'run.status' && event.chat === chat && event.status === 'idle'), projects[0].chat);
    assert.equal(await page.locator('#project-path').textContent(), projects[2].root);
    assert.doesNotMatch(await page.locator('#messages').textContent(), /Alfa er færdig/);
    const background = await page.evaluate(chat => window.multiProjectEvents.filter(event => event.chat === chat), projects[0].chat);
    assert.equal(background.every(event => event.root === projects[0].root), true);
    await page.screenshot({ path: path.join(root, 'tre-projekter.png'), animations: 'disabled' });
    await switchTo(projects[0]); await page.locator('#messages').filter({ hasText: 'Alfa er færdig' }).waitFor();
    assert.equal(await page.inputValue('#model-select'), projects[0].model);
    check('baggrundssvar og filændringer bliver i deres projekt; projektskift bevarer modelvalg og motorer');
    await app.evaluate(({ app }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { Workbench } = require('./core/workbench.cjs'), state = Workbench.prototype.state;
      globalThis.holdNextOwnerState = true;
      Workbench.prototype.state = async function(...args) { if (globalThis.holdNextOwnerState) { globalThis.holdNextOwnerState = false; globalThis.ownerStateEntered = true; await new Promise(resolve => { globalThis.releaseOwnerState = resolve; }); } return state.apply(this, args); };
    });
    const delayedState = call('connectionState');
    for (let n = 0; n < 100 && !await app.evaluate(() => globalThis.ownerStateEntered); n++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await app.evaluate(() => globalThis.ownerStateEntered), true);
    await switchTo(projects[1]); await app.evaluate(() => globalThis.releaseOwnerState());
    assert.equal((await delayedState).chat, projects[0].chat); assert.equal(await page.locator('#project-path').textContent(), projects[1].root);
    await switchTo(projects[0]);
    check('et forsinket IPC-svar beholder sin oprindelige samtale, mens et andet projekt åbnes');
    await send('Svar med ny nøgle'); await page.locator('#messages').filter({ hasText: 'Alfa bruger den nye nøgle' }).waitFor(); await page.locator('#stop').waitFor({ state: 'hidden' });
    assert.equal(requests.filter(item => item.body.tools?.length).at(-1).authorization, 'Bearer ' + KEY_AFTER);
    // Siden 94bcbe1 gennemgås beskeden sammen med konteksten: prepare får teksten, og send får contextBinding.
    const compact = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', text: 'Svar igen med ny nøgle' });
    const beforeCompact = requests.length;
    await call('send', { chat: projects[0].chat, fingerprint: compact.fingerprint, contextBinding: compact.contextBinding, text: 'Svar igen med ny nøgle', compact: true });
    await waitHeld('compact');
    assert.equal((await call('connectionState')).running, true, 'ny opgave er stadig aktiv efter sammenfatningens idle');
    held.get('compact')();
    await idle();
    assert.equal((await call('activityList', { chat: projects[0].chat })).some(entry => entry.title === 'Samtalen er gjort kortere'), true);
    assert.ok(requests.slice(beforeCompact).some(item => !item.body.tools?.length), 'den rigtige motor gennemfører sammenfatningskaldet');
    assert.ok(requests.slice(beforeCompact).some(item => item.body.tools?.length), 'motoren sender brugerens nye besked bagefter');
    check('den rigtige motor sammenfatter samtalen og sender derefter den nye opgave uden at genbruge sammenfatningens idle');
    for (const project of projects.slice(1)) held.get(project.model)();
    await page.waitForFunction(chats => chats.every(chat => window.multiProjectEvents.some(event => event.type === 'run.status' && event.chat === chat && event.status === 'idle')), projects.map(item => item.chat));
    check('næste opgave bruger den ændrede nøgle, mens de øvrige projekter afslutter deres oprindelige kald');
    await app.evaluate((_electron, root) => { globalThis.dropProjectIdle = root; }, projects[0].root);
    const recovery = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', text: 'Afslut med ny nøgle og tabt idle' });
    await call('send', { chat: projects[0].chat, fingerprint: recovery.fingerprint, contextBinding: recovery.contextBinding, text: 'Afslut med ny nøgle og tabt idle' });
    for (let n = 0; n < 100 && !await app.evaluate(() => globalThis.multiProjectEngineEvents.some(event => event.recovered)); n++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await app.evaluate(() => globalThis.multiProjectEngineEvents.some(event => event.recovered)), true);
    await idle();
    await app.evaluate(() => { globalThis.dropProjectIdle = null; });
    check('afsluttet modelsvar frigiver opgaven gennem serverstatus, selv når begge idle-events mangler');
    const idea = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'chat', text: 'Jeg vil have en app til 17 blå cykler.' });
    await call('send', { chat: projects[0].chat, fingerprint: idea.fingerprint, contextBinding: idea.contextBinding, text: 'Jeg vil have en app til 17 blå cykler.' });
    await idle();
    for (const text of ['Sæt i gang!', 'Fortsæt med cyklerne']) {
      const build = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', includeHistory: false, text });
      await call('send', { chat: projects[0].chat, fingerprint: build.fingerprint, contextBinding: build.contextBinding, text });
      await idle();
      const sent = requests.filter(item => item.body.tools?.length).at(-1).body.messages;
      assert.equal(JSON.stringify(sent).match(/17 blå cykler/g)?.length, 1, 'idéen følger med én gang i den faktiske modelrequest');
      assert.doesNotMatch(JSON.stringify(sent), /Aktuel arbejdsmåde: Samtale/);
    }
    check('Samtale til Byg med Sæt i gang bevarer den tidligere idé i modelrequest og næste besked');
    const beforePlan = requests.length, proposal = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'chat', text: 'Giv et konkret cykelforslag' });
    await call('send', { chat: projects[0].chat, fingerprint: proposal.fingerprint, contextBinding: proposal.contextBinding, text: 'Giv et konkret cykelforslag' }); await idle();
    assert.ok((await call('connectionState')).plan); assert.equal(await page.locator('#plan-offer').isVisible(), false);
    await page.click('#build-plan'); await page.waitForFunction(() => document.querySelector('#data-dialog').open || !document.querySelector('#stop').hidden);
    if (await page.locator('#data-dialog').evaluate(element => element.open)) await page.click('#accept-send');
    await page.locator('#messages').filter({ hasText: 'Cykelforslaget er taget med direkte til bygning.' }).waitFor(); await idle();
    assert.equal(requests.slice(beforePlan).filter(item => item.body.tools?.length).length, 2);
    check('et konkret forslag i Samtale får direkte Byg-knap uden endnu en planrunde');
    await call('saveProjectSettings', { autoProjectFiles: true });
    const fileStart = await page.evaluate(() => window.multiProjectEvents.length), filePermission = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', text: 'Skriv en automatisk projektfil' });
    await call('send', { chat: projects[0].chat, fingerprint: filePermission.fingerprint, contextBinding: filePermission.contextBinding, text: 'Skriv en automatisk projektfil' });
    await page.waitForFunction(start => window.multiProjectEvents.slice(start).some(event => event.type === 'permission.auto' && event.policy?.projectFile), fileStart, { timeout: 10000 }); await idle();
    assert.equal(await fs.readFile(path.join(projects[0].root, 'automatisk.txt'), 'utf8'), 'Tilladt projektfil');
    check('automatisk projektfiladgang virker gennem den rigtige motors tilladelsesforespørgsel');
    await call('saveProjectSettings', { autoCommands: true });
    const isolated = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', text: 'Kør isoleret kommando' });
    await call('send', { chat: projects[0].chat, fingerprint: isolated.fingerprint, contextBinding: isolated.contextBinding, text: 'Kør isoleret kommando' });
    await page.waitForFunction(() => window.multiProjectEvents.some(event => event.type === 'permission.auto' && event.policy?.kind === 'bash'));
    await idle();
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(projects[0].root, 'isolationsresultat.json'), 'utf8')), { nøgle: false, ok: true });
    check('rigtig OpenCode-plugin kører automatisk bash med OS-isolation og uden modelcredentials');
    await call('saveProjectSettings', { autoCommands: false });
    // Huskede kommandoer er fjernet (brugerens beslutning 10. november 2026): uden automatisk kørsel spørges der om en kommando hver gang.
    // Kortet tilbyder aldrig «Tillad altid i projektet», et svar med 'project' afvises, og de gamle regler i lageret bruges ikke, heller ikke
    // dem for præcis denne kommando i denne mappe.
    const bashAsked = start => page.waitForFunction(start => window.multiProjectEvents.slice(start).some(event => event.type === 'permission.asked' && event.properties?.policy?.kind === 'bash'), start, { timeout: 15000 });
    const lastBash = () => page.evaluate(() => window.multiProjectEvents.filter(event => event.type === 'permission.asked' && event.properties?.policy?.kind === 'bash').at(-1).properties);
    // RN:B1-2: motoren fra «Kør isoleret kommando» kører med sandkassen, og saveProjectSettings genstarter den ikke (engineRestartNeeded).
    // I den motor ville env -i tømme miljøet i forvejen, så påstanden nedenfor ikke kunne fyre. Motoren lukkes derfor, som ved en genstart
    // af appen; næste opgave starter en ny motor uden sandkasse og fortsætter samme AI-session.
    await app.evaluate(async (_electron, root) => { for (const engine of globalThis.multiProjectEngines) if (engine.root === root && engine.active) await engine.close(); }, projects[0].root);
    const commandStart = await page.evaluate(() => window.multiProjectEvents.length), remember = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', text: 'Prøv en husket kommando' });
    await call('send', { chat: projects[0].chat, fingerprint: remember.fingerprint, contextBinding: remember.contextBinding, text: 'Prøv en husket kommando' });
    await bashAsked(commandStart);
    const permission = await lastBash();
    assert.equal(permission.policy.persistable, false, 'en kommando tilbydes ikke «Tillad altid i projektet»');
    const commandCard = page.locator(`#approvals .approval[data-id="${permission.id}"]`); await commandCard.waitFor();
    assert.equal(await commandCard.getByRole('button', { name: 'Tillad altid i projektet', exact: true }).count(), 0, 'knappen står ikke på kommandokortet');
    const refused = await page.evaluate(input => window.harness.reply(input), { chat: projects[0].chat, id: permission.id, allow: true, scope: 'project' });
    assert.equal(refused.ok, false); assert.match(refused.error, /kun godkendes én gang/);
    await call('reply', { chat: projects[0].chat, id: permission.id, allow: true, scope: 'once' }); await idle();
    // RN:B1-2: en kommando, der godkendes én gang uden sandkasse, arver hverken gatewayens adgang eller motorens adgangskode. Den kører
    // dog med brugerens rettigheder og kan stadig læse dem i motorens proces (fx med ps); det forhindrer kun sandkassen.
    // Forudsætningen: kommandoen kørte i en motor uden sandkasse. Ellers beviser påstanden intet.
    assert.equal(await app.evaluate((_electron, root) => { const engine = globalThis.multiProjectEngines.filter(item => item.root === root).at(-1); return Boolean(engine?.active && !engine.sandbox); }, projects[0].root), true, 'kommandoen kørte i en ny motor uden sandkasse');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(projects[0].root, 'husket-resultat.json'), 'utf8')), { nøgle: false, adgangskode: false }, 'kommandoen arver hverken OPENCODE_CONFIG_CONTENT eller OPENCODE_SERVER_PASSWORD');
    const rememberedStart = await page.evaluate(() => window.multiProjectEvents.length), remembered = await call('prepare', { chat: projects[0].chat, connectionID: connection.id, modelID: projects[0].model, mode: 'free', text: 'Prøv igen en husket kommando' });
    await call('send', { chat: projects[0].chat, fingerprint: remembered.fingerprint, contextBinding: remembered.contextBinding, text: 'Prøv igen en husket kommando' });
    await bashAsked(rememberedStart);
    assert.equal(await page.evaluate(start => window.multiProjectEvents.slice(start).some(event => event.type === 'permission.auto' && event.policy?.kind === 'bash'), rememberedStart), false, 'ingen gammel regel kører kommandoen automatisk');
    await call('reply', { chat: projects[0].chat, id: (await lastBash()).id, allow: true, scope: 'once' }); await idle();
    check('uden automatisk kørsel spørges der om en kommando hver gang; den kan ikke huskes, gamle kommandoregler bruges ikke, og kommandoen ser ikke motorens hemmeligheder');
    // Projektets tilladelser: de gamle kommandoregler står som «Ikke i brug» med en knap, der sletter dem. Hjemmesiden står som før med Fjern.
    await page.click('#project-menu-toggle'); await page.click('#project-settings-button');
    await page.waitForFunction(() => document.querySelector('#project-settings-dialog').open && document.querySelectorAll('#project-permission-rules li button').length > 0);
    const savedRules = page.locator('#project-approval-settings details').filter({ has: page.locator('#project-permission-rules') });
    if (!await savedRules.evaluate(element => element.open)) await savedRules.locator('summary').click();
    const ruleRows = () => page.locator('#project-permission-rules li').evaluateAll(items => items.map(item => ({ text: item.textContent, button: item.querySelector('button.text-button')?.textContent || '' })));
    const before = await ruleRows();
    assert.deepEqual(before.map(row => row.button), ['Slet', 'Slet', 'Fjern'], 'beta 2 og beta 3 for samme kommando er én række');
    assert.ok(before[0].text.startsWith('Kommando: node -e') && before[0].text.includes('· i projektmappen') && before[0].text.includes('Ikke i brug'), before[0].text);
    assert.ok(before[1].text.startsWith('Kommando: npm test · i projektmappen') && before[1].text.includes('Ikke i brug'), 'den indpakkede form vises som den kommando, den pakker ind');
    assert.ok(before[2].text.startsWith('Hjemmeside: https://example.test'));
    for (let n = 2; n > 0; n--) {
      await page.locator('#project-permission-rules li').filter({ hasText: 'Ikke i brug' }).first().getByRole('button', { name: /^Slet den gamle kommandoregel/ }).click();
      await page.waitForFunction(count => document.querySelectorAll('#project-permission-rules li').length === count, n);
      assert.equal(await page.locator('#project-settings-feedback').textContent(), 'Den gamle kommandoregel er slettet.');
    }
    assert.deepEqual((await ruleRows()).map(row => row.button), ['Fjern']);
    const stored = JSON.parse(await fs.readFile(path.join(root, 'appdata', 'harness', 'settings.json'), 'utf8')).projects[seed.projectKey(projects[0].root)].approvals.rules;
    assert.deepEqual(stored.map(rule => rule.kind), ['webfetch'], 'alle gamle kommandoregler er slettet fra lageret; hjemmesiden er bevaret');
    await page.click('[data-close="project-settings-dialog"]');
    check('gamle kommandoregler står som «Ikke i brug» under Projektets tilladelser og kan slettes; en gemt hjemmeside står som før');
    const archived = await call('chatArchive', { id: projects[0].chat, archived: true }); assert.notEqual(archived.chat, projects[0].chat);
    assert.equal((await call('recentProjects')).find(item => item.root === projects[0].root).chats.find(item => item.id === projects[0].chat).archived, true);
    await call('chatArchive', { id: projects[0].chat, archived: false });
    check('arkivering og gendannelse bevarer den afsluttede samtale');
    await helpers.assertNoGitWrites(app); assert.deepEqual(errors, []);
    const report = { status: 'bestået', root, packaged: Boolean(bundle), bundle: bundle || null, checks, models: projects.map(item => item.model), requests: requests.length, errors, limits: 'Kontrollerede lokale modeller og syntetiske projekter; ingen ekstern AI, cloududgivelse eller Git-skrivning.' };
    await fs.writeFile(path.join(root, 'rapport.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(root, 'fejl.png'), animations: 'disabled' }).catch(() => {});
    await fs.writeFile(path.join(root, 'diagnose.json'), JSON.stringify({ requests: requests.map(({ body }) => ({ model: body.model, tools: body.tools?.length || 0, messages: body.messages })), events: app ? await app.evaluate(() => globalThis.multiProjectEngineEvents).catch(() => []) : [], permissions: page ? await page.evaluate(() => window.multiProjectEvents?.filter(event => event.type.startsWith('permission.'))).catch(() => []) : [] }, null, 2));
    console.error(JSON.stringify({ status: 'fejl', root, checks, errors, error: error.message }, null, 2)); throw error;
  } finally { await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
