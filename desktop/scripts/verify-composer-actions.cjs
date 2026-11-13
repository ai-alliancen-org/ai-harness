// Den rigtige Electron-brugerflade med kontrolleret IPC og projektfiler fra repositoryet.
// Ingen modelkald, Git-skrivninger, udbyderlogin eller eksterne forbindelser.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-skrivefelt-')));
  const project = path.join(root, 'projekt'); await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.copyFile(path.resolve(__dirname, '../../site/dist/index.html'), path.join(project, 'public/index.html'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(({ dialog, ipcMain, session }, project) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      globalThis.composerProbe = { prepared: [], sent: [], accepted: true, hold: null, release: null, promteCompatible: false, loginReject: null, cancelled: [] };
      const probe = globalThis.composerProbe;
      ipcMain.removeHandler('agent:prepare');
      ipcMain.handle('agent:prepare', async (_event, selection, owner) => {
        probe.prepared.push({ selection, owner }); if (probe.hold) await probe.hold;
        return { ok: true, value: { accepted: probe.accepted, fingerprint: 'prøve-' + probe.prepared.length, consentKey: 'prøve', model: 'Kontrolleret model', connection: 'Lokal prøve', region: 'På computeren', training: 'Ingen modelkontakt', price: 'Intet modelkald', mode: selection.mode } };
      });
      ipcMain.removeHandler('agent:send');
      ipcMain.handle('agent:send', (event, input, owner) => {
        probe.sent.push({ input, owner });
        event.sender.send('harness:event', { type: 'run.status', status: 'idle', root: owner.root, chat: owner.chat });
        return { ok: true, value: {} };
      });
      ipcMain.removeHandler('deployment:setup');
      ipcMain.handle('deployment:setup', async (_event, input) => {
        if (input.action === 'promte-login') return new Promise((_resolve, reject) => { probe.loginReject = reject; });
        return { ok: true, value: input.action === 'promte-check' ? { problem: probe.promteCompatible ? null : { summary: 'Appen har et andet format.', detail: 'Materialet er en HTML-side.' } } : input.action === 'promte-state' ? { connected: false, installed: true } : {} };
      });
      ipcMain.removeHandler('deployment:setup-cancel');
      ipcMain.handle('deployment:setup-cancel', (_event, input, owner) => { probe.cancelled.push({ input, owner }); probe.loginReject?.(Error('Login blev afbrudt.')); return { ok: true, value: true }; });
    }, project);
    await helpers.skipIntroduction(page); await helpers.enableSharing(page); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    await helpers.menuClick(page, '#features-button');
    const feature = page.locator('#features-list .feature-row[data-feature="integration-komplai-run"]');
    const toggle = feature.locator('input[role="switch"]');
    assert.equal(await toggle.isChecked(), false);
    await feature.locator('label').click({ position: { x: 12, y: 12 } });
    await page.waitForFunction(() => document.querySelector('#features-list input[data-feature="integration-komplai-run"]').checked && document.querySelector('#features-feedback').textContent.startsWith('Gemt'));
    assert.equal(await page.evaluate(() => document.querySelector('#info-pop')?.matches(':popover-open') || false), false, 'Klik på rækken viser ingen infoboble.');
    assert.equal((await page.evaluate(() => window.harness.featuresGet())).value.effective['integration-komplai-run'], true);
    await toggle.focus(); await toggle.press('Space');
    await page.waitForFunction(() => !document.querySelector('#features-list input[data-feature="integration-komplai-run"]').checked);
    await feature.locator('button.info').click();
    assert.equal(await page.locator('#info-pop').evaluate(el => el.matches(':popover-open')), true);
    assert.equal(await toggle.isChecked(), false, 'Info-knappen ændrer ikke kontakten.');
    await page.keyboard.press('Escape'); await page.locator('#features-dialog [data-close]').click();
    await page.evaluate(() => {
      state.connections = [{ id: 'prøve', kind: 'compatible', name: 'Kontrolleret model' }];
      document.querySelector('#connection-select').replaceChildren(new Option('Kontrolleret model', 'prøve'));
      document.querySelector('#model-select').replaceChildren(new Option('Lokal model', 'model'));
      document.querySelector('#route-row').hidden = true;
      document.querySelector('#model-chip').textContent = 'Kontrolleret model';
    });
    const idle = () => page.waitForFunction(() => !view.running && !view.submitting);
    const count = () => app.evaluate(() => ({ prepared: globalThis.composerProbe.prepared.length, sent: globalThis.composerProbe.sent.length }));
    const gate = () => app.evaluate(() => { globalThis.composerProbe.hold = new Promise(resolve => { globalThis.composerProbe.release = resolve; }); });
    const release = () => app.evaluate(() => { globalThis.composerProbe.release(); globalThis.composerProbe.hold = null; });
    const waitPrepare = length => app.evaluate(async (_electron, length) => { for (let n = 0; n < 100 && globalThis.composerProbe.prepared.length < length; n++) await new Promise(resolve => setTimeout(resolve, 10)); if (globalThis.composerProbe.prepared.length !== length) throw Error('Forkert antal forberedelser'); }, length);
    await page.fill('#prompt', ''); await page.locator('#prompt').press('Enter'); assert.deepEqual(await count(), { prepared: 0, sent: 0 });
    await page.fill('#prompt', 'Første linje'); await page.locator('#prompt').press('Shift+Enter'); await page.keyboard.type('Anden linje');
    assert.equal(await page.inputValue('#prompt'), 'Første linje\nAnden linje'); assert.deepEqual(await count(), { prepared: 0, sent: 0 });
    await page.fill('#prompt', 'Forklar appens forside');
    await page.locator('#prompt').dispatchEvent('keydown', { key: 'Enter', metaKey: true, isComposing: true });
    await page.locator('#prompt').dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, repeat: true });
    await page.locator('#prompt').dispatchEvent('keydown', { key: 'Enter', metaKey: true, keyCode: 229 });
    assert.deepEqual(await count(), { prepared: 0, sent: 0 }, 'IME og gentaget tastetryk sender intet.');
    await gate(); await page.locator('#prompt').press('Enter'); await waitPrepare(1);
    await page.evaluate(() => { document.querySelector('#chat-form').requestSubmit(); document.querySelector('#chat-form').requestSubmit(); });
    assert.deepEqual(await count(), { prepared: 1, sent: 0 }, 'Dobbelt-submit blokeres før det asynkrone svar.');
    await release(); await idle(); assert.deepEqual(await count(), { prepared: 1, sent: 1 });
    await page.fill('#prompt', 'Forklar mere'); await page.locator('#prompt').press('Control+Enter'); await waitPrepare(2); await idle(); assert.deepEqual(await count(), { prepared: 2, sent: 2 });
    await app.evaluate(() => { globalThis.composerProbe.accepted = false; });
    await page.fill('#prompt', 'En besked med samtykke'); await page.locator('#prompt').press('Meta+Enter'); await page.waitForSelector('#data-dialog[open]');
    assert.equal((await count()).sent, 2, 'Genvejen omgår ikke Før du sender.');
    await page.locator('#data-dialog [data-close]').first().click();
    await page.locator('#prompt').press('Control+Enter'); await page.waitForSelector('#data-dialog[open]'); await page.click('#accept-send'); await idle();
    assert.equal((await count()).sent, 3, 'Annuller efterlader ikke afsendelsen låst.');
    await app.evaluate(() => { globalThis.composerProbe.accepted = true; });
    await page.evaluate(() => { document.querySelector('#work-mode').value = 'plan'; updateWorkMode(); });
    await page.fill('#prompt', 'byg'); await page.locator('#prompt').press('Meta+Enter'); await idle();
    assert.equal(await page.textContent('#composer-mode'), 'Byg');
    assert.equal(await app.evaluate(() => globalThis.composerProbe.prepared.at(-1).selection.mode), 'free');
    // Der er intet tilvalg om en ekstra kopi; kernen sender selv de seneste beskeder, når en ny AI-session starter (Q:B1-2).
    assert.equal(await app.evaluate(() => Object.hasOwn(globalThis.composerProbe.prepared.at(-1).selection, 'includeHistory')), false);
    await page.evaluate(() => { view.plan = null; activePlan = null; renderRunReview({ mode: 'plan', status: 'idle', answered: true, buildOffer: true }, view); });
    await page.getByRole('button', { name: 'Byg videre', exact: true }).click(); await idle();
    assert.equal(await app.evaluate(() => globalThis.composerProbe.prepared.at(-1).selection.mode), 'free');
    assert.match(await app.evaluate(() => globalThis.composerProbe.sent.at(-1).input.text), /aftalt i samtalen/);
    // Et konkret forslag fra Samtale og allerede besvarede spørgsmål må ikke starte endnu en planrunde.
    const concrete = '# Plan: Din daglige huskeliste med konfetti\n\n## Det bygger vi\nEn daglig huskeliste, hvor du tilføjer og afslutter opgaver.\n\n## Sådan skal det se ud\nStore tydelige felter og konfetti, når en opgave er klaret.\n\n## Teknik og data\nOpgaverne gemmes i browseren på din computer.\n\n## Det skal du prøve (i forhåndsvisningen)\nTilføj en opgave, markér den færdig, og genindlæs siden.\n\n<!-- aura:offer-plan -->';
    const proposal = { id: 'huskeliste-forslag', text: concrete, at: Date.now() };
    const beforeProposal = await count();
    const proposalOwner = await page.evaluate(({ concrete }) => {
      view.plan = null; activePlan = null; view.planOffer = true; view.draft = null;
      localStorage.removeItem(`harness.chatDraft.${current.root}.${view.id}`);
      document.querySelector('#work-mode').value = 'chat'; updateWorkMode();
      appendMessage('En daglig huskeliste med konfetti, der husker mine opgaver.', 'user');
      appendMessage(concrete, 'assistant');
      appendMessage('Du svarede: Gem opgaverne på min computer · Konfetti ved afslutning', 'system');
      return selectedOwner();
    }, { concrete, proposal });
    await app.evaluate(({ BrowserWindow }, { owner, proposal }) => {
      const target = BrowserWindow.getAllWindows()[0].webContents;
      for (const event of [{ type: 'plan.offer', offered: true }, { type: 'plan.ready', plan: proposal }, { type: 'plan.offer', offered: true }, { type: 'run.review', mode: 'chat', status: 'idle', answered: true, buildOffer: false }]) target.send('harness:event', { ...event, ...owner });
    }, { owner: proposalOwner, proposal });
    await page.waitForSelector('#plan-card:not([hidden])');
    assert.equal(await page.evaluate(text => window.ConversationMode.concretePlan(text), concrete), true);
    assert.equal(await page.isVisible('#plan-offer'), false); assert.equal(await page.isVisible('#run-review'), false);
    assert.deepEqual(await count(), beforeProposal, 'Genkendelse og Byg-kort sender ingen ny planbesked.');
    // Også ved genåbning prioriteres planen foran en tidligere gemt plananbefaling.
    await page.evaluate(({ proposal, concrete }) => {
      fillChat({ ...state, plan: proposal, workspace: { messages: [{ role: 'assistant', text: concrete }, { role: 'system', text: 'Du svarede: Gem opgaverne på min computer · Konfetti ved afslutning' }], mode: 'chat', planOffer: true, status: 'idle' } }, true);
    }, { proposal, concrete });
    assert.equal(await page.isVisible('#plan-card'), true); assert.equal(await page.isVisible('#plan-offer'), false);
    assert.equal(await page.textContent('#composer-mode'), 'Samtale', 'Et forslag giver kun en knap; Byg vælges først ved brugerens klik.');
    await page.screenshot({ path: path.join(root, 'samtaleforslag-klar-til-byg.png') });
    await page.click('#build-plan'); await idle();
    const buildProposal = await app.evaluate(() => ({ prepared: globalThis.composerProbe.prepared.at(-1), sent: globalThis.composerProbe.sent.at(-1) }));
    assert.equal(buildProposal.prepared.selection.mode, 'build'); assert.equal(buildProposal.prepared.selection.planID, proposal.id); assert.equal(Object.hasOwn(buildProposal.prepared.selection, 'includeHistory'), false, 'der er intet tilvalg af en ekstra kopi; kernen sender selv de seneste beskeder, når en ny AI-session starter (Q:A-7)');
    assert.equal(buildProposal.prepared.owner.chat, proposalOwner.chat); assert.doesNotMatch(buildProposal.sent.input.text, /Lad os lave en plan/);
    assert.equal((await count()).sent, beforeProposal.sent + 1);
    await page.evaluate(() => {
      view.plan = null; activePlan = null; view.planCard = false; document.querySelector('#plan-card').hidden = true;
      renderRunReview({ mode: 'chat', status: 'idle', answered: true, buildOffer: false }, view);
    });
    assert.equal(await page.isVisible('#run-review'), false, 'Et almindeligt samtalesvar giver intet Byg-kort.');
    await page.evaluate(() => { view.waitingFor = [{ id: 'ubesvaret-spoergsmaal' }]; renderRunReview({ mode: 'chat', status: 'idle', answered: true, buildOffer: true }, view); });
    assert.equal(await page.isVisible('#run-review'), false, 'Et ubesvaret spørgsmål giver intet Byg-kort.');
    await page.evaluate(() => { view.waitingFor = []; });
    await page.click('#deploy-button'); await page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    await page.click('#deployment-other'); await page.locator('[data-provider="promte"]').click();
    await page.waitForSelector('[data-deploy-step="promteNotReady"]:not([hidden])');
    assert.equal(await page.textContent('#deployment-heading'), 'Appen er ikke klar til Promte endnu.');
    await page.screenshot({ path: path.join(root, 'promte-klar-til-byg.png') });
    await page.click('#deployment-promte-prepare'); await page.waitForFunction(() => !document.querySelector('#deployment-dialog').open); await idle();
    const final = await app.evaluate(() => globalThis.composerProbe);
    assert.equal(final.prepared.at(-1).selection.mode, 'free'); assert.match(final.sent.at(-1).input.text, /Promte-skill/);
    assert.equal(await page.textContent('#composer-mode'), 'Byg');
    assert.equal((await page.evaluate(() => window.harness.featuresGet())).value.effective['integration-promte'], true);
    assert.equal(await page.locator('#task-dialog .workflow').innerText().then(text => text.includes('avanceret')), false);
    await app.evaluate(() => { globalThis.composerProbe.promteCompatible = true; });
    await page.click('#deploy-button'); await page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    await page.click('#deployment-other'); await page.locator('[data-provider="promte"]').click(); await page.waitForSelector('[data-deploy-step="promteHost"]:not([hidden])');
    await page.fill('#deploy-promte-host', 'https://kodning.promte.dk'); await page.click('#deployment-promte-host-next'); await page.waitForSelector('[data-deploy-step="setupConnection"]:not([hidden])');
    await page.click('#deployment-connect'); await page.waitForSelector('#deployment-cancel-login:not([hidden])');
    assert.equal(await page.locator('#deployment-cancel-login').isEnabled(), true, 'Login kan afbrydes, mens formularen er låst.');
    assert.equal(await page.textContent('#deployment-progress-label'), 'Venter på login …');
    assert.equal(await page.textContent('#deployment-connection-note'), 'Godkend Aura i browseren.');
    assert.equal(await page.textContent('#deployment-feedback'), '');
    await page.screenshot({ path: path.join(root, 'promte-login-afbryd.png') });
    await page.click('#deployment-cancel-login'); await page.waitForSelector('[data-deploy-step="promteHost"]:not([hidden])'); await page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    assert.equal(await page.isVisible('#deployment-progress'), false); assert.equal(await page.inputValue('#deploy-promte-host'), 'https://kodning.promte.dk');
    assert.match(await page.textContent('#deployment-feedback'), /Login blev afbrudt/);
    assert.equal(await app.evaluate(() => globalThis.composerProbe.cancelled.length), 1);
    assert.equal(await app.evaluate(() => globalThis.composerProbe.cancelled[0].input.host), 'https://kodning.promte.dk');
    await page.click('#deployment-back'); await page.waitForSelector('[data-deploy-step="providers"]:not([hidden])');
    assert.equal(await page.locator('[data-provider="komplai"]').isEnabled(), true);
    // Den særskilte Byg og gennemgå-vej beholder spinneren under hele build/review-svaret.
    await app.evaluate(({ ipcMain }) => {
      const respond = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, fn); };
      const overview = { organisationName: 'Prøveorganisation', address: 'app.example.test', apps: [{ id: 'app', name: 'Prøveapp', url: 'https://app.example.test', visibility: 'private' }] };
      respond('komplai:publish-state', () => ({ ok: true, value: { connected: true } }));
      respond('komplai:publish-overview', () => ({ ok: true, value: overview }));
      respond('deployment:source', () => ({ ok: true, value: { build: true, directory: '.', script: 'build', output: 'dist' } }));
      respond('deployment:review', async (_event, config) => {
        globalThis.composerProbe.buildConfig = config;
        await new Promise(resolve => { globalThis.composerProbe.releaseBuild = resolve; });
        return { ok: true, value: { token: 'build-review', config, target: { name: 'Prøveapp', owner: 'Prøveorganisation', url: 'https://app.example.test', region: 'Prøve' }, built: { script: 'build', output: 'dist' }, files: ['index.html'], bytes: 10, hash: 'prøve', head: 'prøve', cost: 'Ingen udbyder kontaktet', version: { name: 'Prøveversion', at: '2026-10-23T12:00:00Z' } } };
      });
    });
    await page.locator('[data-provider="komplai"]').click(); await page.waitForSelector('[data-deploy-step="app"]:not([hidden])');
    await page.click('#deploy-komplai-choose'); await page.selectOption('#deploy-komplai-app', 'app');
    await page.waitForFunction(() => document.querySelector('#deployment-next').textContent === 'Byg og gennemgå');
    await page.click('#deployment-next'); await page.waitForSelector('#deployment-progress:not([hidden])');
    assert.equal(await page.textContent('#deployment-progress-label'), 'Bygger den gemte version …');
    assert.equal(await page.textContent('#deployment-feedback'), '', 'Spinneren er den eneste status for den igangværende bygning.');
    assert.equal(await page.locator('#deployment-next').isDisabled(), true);
    await page.screenshot({ path: path.join(root, 'byg-og-gennemgaa-arbejder.png') });
    await app.evaluate(async () => { for (let n = 0; n < 100 && !globalThis.composerProbe.releaseBuild; n++) await new Promise(resolve => setTimeout(resolve, 10)); if (!globalThis.composerProbe.releaseBuild) throw Error('Buildgrænsen blev ikke kaldt.'); globalThis.composerProbe.releaseBuild(); });
    await page.waitForSelector('#deployment-review:not([hidden])'); await page.waitForFunction(() => document.querySelector('#deployment-progress').hidden);
    assert.equal(await app.evaluate(() => globalThis.composerProbe.buildConfig.build), true);
    assert.match(await page.textContent('#deployment-summary'), /Bygget/);

    // En gemt udgivelse til konto A bevares under Log ud og login med konto B.
    await page.locator('#deployment-dialog [data-close]').click();
    await app.evaluate(({ ipcMain }) => {
      const probe = globalThis.composerProbe;
      probe.account = 'A'; probe.disconnects = 0; probe.loginCancels = 0; probe.loginCalls = 0;
      probe.savedDeployment = { config: { provider: 'komplai', appId: 'app-A', visibility: 'private', directory: 'public' }, last: { id: 'udgivelse-A', appId: 'app-A', config: { provider: 'komplai', appId: 'app-A', visibility: 'private', directory: 'public' }, target: { name: 'App A', owner: 'Organisation A', url: 'https://a.example.test', portal: 'https://portal.example.test/a' }, state: 'READY', url: 'https://a.example.test', head: 'version-A', hash: 'indhold-A' }, context: { projectName: 'Prøveprojekt', copyCount: 0 } };
      const respond = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, fn); };
      respond('deployment:state', () => ({ ok: true, value: probe.savedDeployment }));
      respond('komplai:publish-state', () => ({ ok: true, value: { connected: Boolean(probe.account), organisationName: 'Organisation ' + probe.account } }));
      respond('komplai:publish-overview', () => ({ ok: true, value: { organisationName: 'Organisation ' + probe.account, address: probe.account.toLowerCase() + '.example.test', apps: [{ id: 'app-' + probe.account, name: 'App ' + probe.account, url: 'https://' + probe.account.toLowerCase() + '.example.test', visibility: 'private' }] } }));
      respond('komplai:cancel', () => { probe.loginCancels++; return { ok: true, value: true }; });
      respond('komplai:publish-disconnect', () => { probe.disconnects++; probe.account = null; return { ok: true, value: { connected: false } }; });
      respond('komplai:login', () => { probe.loginCalls++; return { ok: true, value: { organisations: [{ id: 'org-B', name: 'Organisation B', publishing: { address: 'b.example.test' } }] } }; });
      respond('komplai:connect', (_event, value) => { if (value.organisationId !== 'org-B' || value.publishing !== true) throw Error('Den nye konto blev ikke valgt.'); probe.account = 'B'; return { ok: true, value: {} }; });
      globalThis.fetch = async () => { throw Error('Eksterne forbindelser er blokeret i prøven.'); };
    });
    const savedDeployment = await app.evaluate(() => JSON.stringify(globalThis.composerProbe.savedDeployment));
    await page.click('#deploy-button'); await page.waitForSelector('#deployment-result:not([hidden])'); await page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    // Kvitteringen har højst fire synlige kontroller med Luk: højst to hovedknapper og Se detaljer (AGENTS.md). Konto og adgang står
    // under Se detaljer efter en tidligere udgivelse.
    const receiptChoices = await page.locator('#deployment-dialog').evaluate(dialog => [...dialog.querySelectorAll('button,select,input[type=checkbox],input[type=radio],summary')].filter(el => el.checkVisibility()).length);
    assert.ok(receiptChoices <= 4, `Kvitteringen har ${receiptChoices} synlige kontroller.`);
    assert.equal(await page.locator('#deployment-komplai-account').isVisible(), false, 'Konto og adgang står ikke i kvitteringens første lag.');
    await page.locator('#deployment-receipt-details > summary').click();
    assert.equal(await page.locator('#deployment-komplai-account').isVisible(), true, 'Konto og adgang står under Se detaljer efter en tidligere udgivelse.');
    await page.click('#deployment-komplai-account'); await page.waitForSelector('[data-deploy-step="account"]:not([hidden])');
    assert.equal(await page.textContent('#deployment-account-name'), 'Organisation A');
    await page.screenshot({ path: path.join(root, 'komplai-konto-og-log-ud.png') });
    await page.click('#komplai-publish-logout'); await page.waitForSelector('[data-deploy-step="login"]:not([hidden])'); await page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    assert.match(await page.textContent('#komplai-publish-feedback'), /Du er logget ud/);
    assert.equal(await page.locator('#deploy-komplai-app option').count(), 0);
    assert.equal(await app.evaluate(() => globalThis.composerProbe.disconnects), 1);
    assert.equal(await app.evaluate(() => globalThis.composerProbe.loginCancels), 1);
    await page.click('#komplai-publish-login'); await page.waitForSelector('[data-deploy-step="connect"]:not([hidden])');
    assert.match(await page.textContent('#komplai-publish-tile'), /Organisation B/);
    await page.click('#komplai-publish-confirm'); await page.waitForSelector('[data-deploy-step="app"]:not([hidden])'); await page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    assert.equal(await page.textContent('#komplai-publish-org-name'), 'Organisation B');
    await page.click('#deploy-komplai-choose');
    assert.deepEqual(await page.locator('#deploy-komplai-app option').evaluateAll(options => options.map(option => option.value)), ['', 'app-B']);
    assert.equal(await app.evaluate(() => JSON.stringify(globalThis.composerProbe.savedDeployment)), savedDeployment, 'Log ud ændrer hverken projektets destination eller seneste udgivelse.');
    await page.screenshot({ path: path.join(root, 'komplai-ny-konto.png') });
    // Offentlig adgang bekræftes med det synlige, præcise navn, også ved HTML-tegn.
    await page.click('#deployment-back'); await page.click('#deploy-komplai-create');
    const publicName = 'Huskeliste <b> & "Konfetti" 🌼';
    await page.fill('#deploy-komplai-name', '  ' + publicName + '  '); await page.click('#deployment-next');
    await page.locator('[name="komplai-visibility"][value="public"]').check();
    await page.waitForSelector('[data-deploy-step="confirmPublic"]:not([hidden])');
    assert.equal(await page.textContent('#deploy-komplai-confirm-label'), `Skriv »${publicName}« for at bekræfte`);
    assert.equal(await page.locator('#deploy-komplai-confirm-label b').count(), 0, 'Navnet vises som tekst, aldrig som HTML.');
    await page.fill('#deploy-komplai-confirm', 'Et andet navn'); await page.click('#deployment-next');
    assert.equal(await page.isVisible('[data-deploy-step="confirmPublic"]'), true);
    assert.equal(await page.locator('#deploy-komplai-confirm').evaluate(field => field.validity.customError), true);
    await page.fill('#deploy-komplai-confirm', publicName);
    assert.equal(await page.locator('#deploy-komplai-confirm').evaluate(field => field.checkValidity()), true);
    await page.screenshot({ path: path.join(root, 'komplai-bekraeft-navn.png') });
    await page.click('#deployment-next'); await page.waitForSelector('[data-deploy-step="files"]:not([hidden])');
    assert.equal(await app.evaluate(() => JSON.stringify(globalThis.composerProbe.savedDeployment)), savedDeployment, 'Navnebekræftelsen uploader intet og ændrer ikke sidste udgivelse.');
    await page.locator('#deployment-dialog [data-close]').click();

    // Første projektidé går fra Opret til Byg, gennem den normale datagennemgang.
    // Projektoprettelsen er ægte; Versioner er slået fra, og Git-vagten bevises.
    await helpers.forbidGitWrites(app); await helpers.isolateDocuments(app, root);
    const featureResult = await page.evaluate(() => window.harness.featuresSave({ scope: 'alle', values: { versioner: false } })); assert.equal(featureResult.ok, true);
    await page.click('#new'); await page.waitForSelector('#onboarding:not([hidden])');
    const idea = 'Byg en simpel lille hjemmeside med en blomst, som snurrer rundt';
    await page.fill('#purpose', idea); await page.fill('#name', 'Blomsterprøve'); await page.click('#create');
    await page.waitForSelector('#workspace:not([hidden])'); await page.waitForFunction(idea => document.querySelector('#prompt').value === idea, idea);
    assert.equal(await page.textContent('#composer-mode'), 'Byg');
    const createdProject = await page.textContent('#project-path');
    assert.ok(createdProject.startsWith(root + path.sep)); assert.match(await fs.readFile(path.join(createdProject, 'harness.json'), 'utf8'), /Blomsterprøve/);
    await page.evaluate(() => {
      state.connections = [{ id: 'prøve', kind: 'compatible', name: 'Kontrolleret model' }];
      document.querySelector('#connection-select').replaceChildren(new Option('Kontrolleret model', 'prøve'));
      document.querySelector('#model-select').replaceChildren(new Option('Lokal model', 'model'));
      document.querySelector('#route-row').hidden = true;
    });
    await app.evaluate(({ ipcMain, app }) => {
      globalThis.composerProbe.accepted = false;
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const path = process.getBuiltinModule('path');
      const history = new (require('./core/workspace-history.cjs').WorkspaceHistory)(new (require('./core/store.cjs').Store)(path.join(app.getPath('userData'), 'harness'), {}));
      ipcMain.removeHandler('agent:send');
      ipcMain.handle('agent:send', async (event, input, owner) => {
        const probe = globalThis.composerProbe, prepared = probe.prepared.at(-1); if (prepared.selection.mode !== 'free') throw Error('Første idé skulle være Byg.');
        probe.sent.push({ input, owner });
        const fs = process.getBuiltinModule('fs/promises'), path = process.getBuiltinModule('path');
        await fs.writeFile(path.join(owner.root, 'public/index.html'), '<!doctype html><html lang="da"><title>Blomsterprøve</title><h1>En blomst</h1><p>🌼</p></html>');
        await history.saveRun(owner.root, owner.chat, { messages: [{ id: 'første-ide', role: 'user', text: input.text }], mode: 'free', status: 'idle', plan: null, planConversation: [], clearDraft: true });
        event.sender.send('harness:event', { type: 'files.written', root: owner.root, chat: owner.chat, files: ['public/index.html'] });
        event.sender.send('harness:event', { type: 'run.status', status: 'idle', root: owner.root, chat: owner.chat });
        event.sender.send('harness:event', { type: 'run.review', status: 'idle', mode: 'free', task: 'første-byg', root: owner.root, chat: owner.chat, files: ['public/index.html'], tools: [] });
        return { ok: true, value: {} };
      });
    });
    const beforeFirst = (await count()).sent;
    await page.click('#send'); await page.waitForSelector('#data-dialog[open]'); assert.equal((await count()).sent, beforeFirst);
    await page.click('#accept-send'); await idle(); await page.waitForSelector('#run-review:not([hidden])');
    assert.equal((await count()).sent, beforeFirst + 1); assert.equal(await app.evaluate(() => globalThis.composerProbe.prepared.at(-1).selection.mode), 'free');
    assert.match(await fs.readFile(path.join(createdProject, 'public/index.html'), 'utf8'), /En blomst/);
    assert.match(await page.textContent('#run-review'), /1 fil ændret/); assert.equal(await page.isVisible('#plan-card'), false);
    await page.screenshot({ path: path.join(root, 'foerste-projektide-byg.png') });
    await page.evaluate(() => newChat()); assert.equal(await page.textContent('#composer-mode'), 'Samtale', 'En ny, selvstændig samtale bevarer sit udgangspunkt.');
    // En indstilling fra en anden computer kan slås fra, selv om isolation ikke understøttes her.
    await app.evaluate(({ ipcMain }) => {
      const settings = { runtime: { mode: 'auto' }, approvals: { autoProjectFiles: false, autoCommands: true, rules: [] }, commandSandbox: { available: false, platform: 'win32', reason: 'Automatisk bygning er ikke tilgængelig på denne computer.', warnings: [] } };
      ipcMain.removeHandler('project:settings'); ipcMain.handle('project:settings', () => ({ ok: true, value: settings }));
      ipcMain.removeHandler('project:settings-save'); ipcMain.handle('project:settings-save', (_event, input) => { if (input.autoCommands !== false) throw Error('Kun fravalg må gemmes i denne prøve.'); settings.approvals.autoCommands = false; return { ok: true, value: settings }; });
    });
    await page.click('#project-menu-toggle'); await page.click('#project-settings-button'); await page.waitForFunction(() => document.querySelector('#project-auto-commands').checked && !document.querySelector('#project-auto-commands').disabled);
    await page.locator('#project-auto-commands').uncheck();
    await page.waitForFunction(() => !document.querySelector('#project-auto-commands').checked && document.querySelector('#project-auto-commands').disabled && document.querySelector('#project-settings-feedback').textContent.startsWith('Projektets valg er gemt'));
    await page.locator('#project-settings-dialog [data-close]').click();
    await helpers.assertNoGitWrites(app);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, ...await count(), limitations: ['Kontrolleret IPC ved model- og udbydergrænser', 'Ingen model eller udbyder kontaktet', 'Ingen Git-skrivninger'] }));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
