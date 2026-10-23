// Rigtig Electron-renderer med syntetiske projektfiler og kontrollerede IPC-hændelser.
// Dette er en UI-/tilstandsprøve, ikke et bevis på en rigtig AI-kørsel. Ingen udbyder,
// konto, nøgle, modelserver eller Git-skrivning bruges. Kun prøvens nye profil ændres.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-composer-glow-')));
  const output = path.resolve(process.env.AURA_GLOW_OUTPUT || root);
  const project = path.join(root, 'Designproeve');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><meta charset="utf-8"><title>Designprøve</title><h1>Min lokale app</h1><p>Et syntetisk projekt til prøven af skrivefeltets arbejdskant.</p>');
  const checks = [], screenshots = [], states = [], errors = [];
  let app, page;
  const check = title => { checks.push(title); console.log('Bestået: ' + title); };
  const emit = async (owner, event) => app.evaluate(({ BrowserWindow }, { owner, event }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('harness://')).webContents.send('harness:event', { ...event, ...owner });
  }, { owner, event });
  const inspect = () => page.evaluate(() => {
    const form = document.querySelector('#chat-form'), style = getComputedStyle(form);
    const before = getComputedStyle(form, '::before'), after = getComputedStyle(form, '::after');
    const box = form.getBoundingClientRect(), prompt = document.querySelector('#prompt').getBoundingClientRect();
    return {
      state: form.dataset.metalState, busy: form.getAttribute('aria-busy'),
      before: { opacity: before.opacity, animation: before.animationName, duration: before.animationDuration, pointerEvents: before.pointerEvents, display: before.display, angle: before.getPropertyValue('--aura-metal-angle').trim() },
      after: { opacity: after.opacity, animation: after.animationName, pointerEvents: after.pointerEvents, display: after.display },
      form: { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom, border: style.borderColor, outline: style.outlineStyle, outlineWidth: style.outlineWidth },
      prompt: { x: prompt.x, y: prompt.y, width: prompt.width, height: prompt.height },
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      stop: !document.querySelector('#stop').hidden, sendDisabled: document.querySelector('#send').disabled,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, forced: matchMedia('(forced-colors: active)').matches,
      focus: document.activeElement.id
    };
  });
  const expectState = async expected => {
    await page.waitForFunction(expected => document.querySelector('#chat-form').dataset.metalState === expected, expected);
    const state = await inspect(); states.push(state); return state;
  };
  const screenshot = async name => {
    // Beskær til samtalen: ingen projektsti, profilnavn, skrivebord eller kontooplysning.
    const box = await page.locator('.chat').boundingBox();
    const full = path.join(output, name + '.png');
    await page.screenshot({ path: full, clip: box });
    screenshots.push({ name, file: path.basename(full), width: box.width, height: box.height });
  };
  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('harness://'));
      window.setMinimumSize(600, 500); window.setContentSize(size.width, size.height);
    }, { width, height });
    await page.waitForFunction(width => innerWidth === width, width);
  };
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ app, dialog, ipcMain, session }, { root, project }) => {
      app.setPath('documents', root);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      globalThis.glowProbe = { stops: [], replies: [] };
      ipcMain.removeHandler('agent:stop');
      ipcMain.handle('agent:stop', (event, _input, owner) => {
        globalThis.glowProbe.stops.push(owner);
        event.sender.send('harness:event', { type: 'run.status', status: 'stopped', ...owner });
        return { ok: true, value: true };
      });
      ipcMain.removeHandler('agent:reply');
      ipcMain.handle('agent:reply', (event, input, owner) => {
        globalThis.glowProbe.replies.push({ input, owner });
        event.sender.send('harness:event', { type: 'permission.replied', properties: { requestID: input.id }, ...owner });
        return { ok: true, value: true };
      });
    }, { root, project });
    await helpers.forbidGitWrites(app);
    await helpers.skipIntroduction(page);
    await helpers.openExistingProject(app, page, project);
    await resize(1280, 900);
    await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    const ownerA = await page.evaluate(() => selectedOwner());
    await page.evaluate(() => {
      // Kun en visningsfixture, så AI-knappen åbner dens normale dialog uden et login.
      state.connections = [{ id: 'lokal-proeve', kind: 'compatible', name: 'Lokal prøveforbindelse' }];
      document.querySelector('#connection-select').replaceChildren(new Option('Lokal prøveforbindelse', 'lokal-proeve'));
      document.querySelector('#model-select').replaceChildren(new Option('Kontrolleret model', 'proevemodel'));
      document.querySelector('#route-row').hidden = true;
      appendMessage('Lav en lille lokal app med en oversigt over mine opgaver.', 'user');
      appendMessage('Jeg gør projektet klar. Du kan følge arbejdet her, og alle godkendelser vises fortsat i samtalen.', 'assistant');
      document.querySelector('#project-intro').hidden = true;
      document.querySelector('#start-idea').hidden = true;
    });
    const idle = await expectState('idle');
    assert.equal(idle.busy, 'false'); assert.equal(idle.before.opacity, '0'); assert.equal(idle.after.opacity, '0');
    assert.equal(idle.before.animation, 'none'); assert.equal(idle.stop, false);
    await screenshot('idle'); check('Inaktiv samtale har ingen synlig eller animeret arbejdskant.');

    await emit(ownerA, { type: 'run.status', status: 'starting' });
    const starting = await expectState('working');
    assert.equal(starting.busy, 'true'); assert.equal(starting.stop, true); assert.equal(starting.sendDisabled, true);
    await emit(ownerA, { type: 'run.status', status: 'working' });
    const working = await expectState('working');
    assert.equal(working.before.animation, 'aura-metal-flow'); assert.equal(working.before.duration, '5s');
    assert.equal(working.before.opacity, '1'); assert.equal(working.after.opacity, '0.3');
    // Stop-knappen er normalt skjult i idle og må ændre toolbarens højde. Sammenlign
    // derfor samme working-visning med og uden pseudoelementer, ikke to forskellige UI-tilstande.
    const noDecoration = await page.evaluate(() => { const sheet = document.styleSheets[0]; return sheet.insertRule('#chat-form::before, #chat-form::after { display: none !important; }', sheet.cssRules.length); });
    assert.deepEqual((await inspect()).form, working.form, 'Den dekorative kant ændrer ikke skrivefeltets placering eller størrelse.');
    await page.evaluate(index => document.styleSheets[0].deleteRule(index), noDecoration);
    await page.waitForTimeout(120);
    assert.notEqual((await inspect()).before.angle, working.before.angle, 'Det registrerede CSS-vinkelparameter bevæger sig faktisk.');
    await screenshot('working'); check('Starting og working bruger den aktive samtales kant; 5-sekunders animationen bevæger sig uden layoutændring.');

    assert.equal(working.before.pointerEvents, 'none'); assert.equal(working.after.pointerEvents, 'none');
    await page.locator('#prompt').click(); await page.keyboard.type('Denne kladde bevares.');
    assert.equal(await page.inputValue('#prompt'), 'Denne kladde bevares.');
    assert.equal((await inspect()).focus, 'prompt');
    await page.locator('#model-chip').click(); await page.waitForSelector('#task-dialog[open]');
    await page.locator('[data-close="task-dialog"]').click();
    await page.locator('#prompt').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'model-chip');
    check('Begge dekorationslag er klikgennemtrængelige; skrivning, AI-knap og tastaturnavigation virker.');

    const permission = { id: 'syntetisk-filgodkendelse', permission: 'edit', patterns: ['public/index.html'], metadata: { filepath: path.join(project, 'public/index.html') }, policy: { projectFile: true, persistable: false } };
    await emit(ownerA, { type: 'permission.asked', properties: permission });
    const waiting = await expectState('waiting');
    assert.equal(waiting.busy, 'true'); assert.equal(waiting.before.animation, 'none'); assert.equal(waiting.after.animation, 'none');
    assert.equal(waiting.after.opacity, '0');
    assert.match(await page.textContent('#agent-activity-text'), /Venter på dig/);
    await page.locator('#approvals .approval').waitFor();
    await screenshot('waiting-approval'); check('En reel godkendelsesvisning fra IPC skifter til en statisk ventekant med den eksisterende statustekst.');
    await page.locator('#approvals button').filter({ hasText: 'Tillad én gang' }).click();
    await expectState('working');
    const replies = await app.evaluate(() => globalThis.glowProbe.replies);
    assert.equal(replies.length, 1); assert.equal(replies[0].input.allow, true); assert.deepEqual(replies[0].owner, ownerA);
    check('Kun et eksplicit klik godkender handlingen; korrekt samtale og id bevares, hvorefter arbejdskanten fortsætter.');

    await page.click('#project-list .project-entry.is-current .project-add');
    await page.waitForFunction(chat => view.id && view.id !== chat, ownerA.chat);
    const ownerB = await page.evaluate(() => selectedOwner());
    const inactiveB = await expectState('idle');
    assert.equal(inactiveB.before.opacity, '0'); assert.equal(inactiveB.busy, 'false');
    assert.equal(await page.evaluate(chat => views.get(chat).running, ownerA.chat), true);
    await emit(ownerA, { type: 'run.status', status: 'working' }); await expectState('idle');
    check('Arbejde i baggrundssamtale A tænder ikke kanten i den ledige, aktive samtale B.');
    // Helt tomme, inaktive samtaler udelades normalt fra sidepanelet. Gem en ægte
    // kladde i B, så begge rækker kan vælges ad brugerens almindelige vej.
    await page.fill('#prompt', 'Kladde i den anden samtale.');
    await page.evaluate(() => saveChatDraft(true));
    await page.locator(`#project-list .chat-row[data-chat="${ownerA.chat}"]`).click();
    await page.waitForFunction(chat => view.id === chat, ownerA.chat); await expectState('working');
    await page.locator(`#project-list .chat-row[data-chat="${ownerB.chat}"]`).click();
    await page.waitForFunction(chat => view.id === chat, ownerB.chat); await expectState('idle');
    await page.locator(`#project-list .chat-row[data-chat="${ownerA.chat}"]`).click();
    await page.waitForFunction(chat => view.id === chat, ownerA.chat); await expectState('working');
    assert.equal(await page.inputValue('#prompt'), 'Denne kladde bevares.');
    check('Rigtige samtaleskift A/B genskaber kant og kladde for den valgte samtale.');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await inspect();
    assert.equal(reduced.state, 'working'); assert.equal(reduced.reduced, true);
    assert.equal(reduced.before.animation, 'none'); assert.equal(reduced.after.animation, 'none');
    assert.equal(reduced.before.opacity, '1'); assert.equal(reduced.after.display, 'none');
    await screenshot('reduced-motion'); check('Reduceret bevægelse fjerner rotation og slør; den statiske arbejdskant og eksisterende status bevares.');

    await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
    await page.locator('#prompt').focus(); await page.keyboard.press('ArrowLeft');
    const forced = await inspect();
    assert.equal(forced.forced, true); assert.equal(forced.before.display, 'none'); assert.equal(forced.after.display, 'none');
    const highlight = await page.evaluate(() => { const sample = document.createElement('i'); sample.style.color = 'Highlight'; document.body.append(sample); const color = getComputedStyle(sample).color; sample.remove(); return color; });
    assert.equal(forced.form.border, highlight); assert.equal(forced.form.outline, 'solid'); assert.ok(parseFloat(forced.form.outlineWidth) > 0);
    await screenshot('forced-colors'); check('Tvungne systemfarver skjuler dekorationen, bruger systemets Highlight og bevarer tastaturfokus.');
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });

    await resize(720, 800);
    const narrow = await inspect();
    assert.equal(narrow.viewport.width, 720);
    assert.ok(narrow.viewport.scrollWidth <= narrow.viewport.width + 1, 'Der opstår ingen vandret sidescroll ved 720 px.');
    assert.ok(narrow.form.x >= 0 && narrow.form.right <= narrow.viewport.width + 1);
    assert.ok(narrow.form.y >= 0 && narrow.form.bottom <= narrow.viewport.height + 1);
    for (const selector of ['#prompt', '#model-chip', '#stop', '#send']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 721 && box.y + box.height <= 801, selector + ' er synlig uden afskæring.');
    }
    await screenshot('narrow-720'); check('Ved 720 px forbliver skrivefelt og knapper synlige uden vandret sidescroll.');
    await resize(1280, 900);

    await page.click('#stop');
    const stopped = await expectState('idle');
    assert.equal(stopped.before.opacity, '0'); assert.equal(stopped.before.animation, 'none'); assert.equal(stopped.stop, false);
    assert.equal(await page.textContent('#run-status'), 'Stoppet');
    assert.deepEqual(await app.evaluate(() => globalThis.glowProbe.stops), [ownerA]);
    check('Stop-knappen bruger eksisterende IPC med aktiv ejer og slukker kanten ved stopped-hændelsen.');
    await emit(ownerA, { type: 'run.status', status: 'working' }); await expectState('working');
    await emit(ownerA, { type: 'engine.error', message: 'Syntetisk prøvefejl' });
    assert.equal((await inspect()).state, 'working', 'En fejlmeddelelse alene må ikke skjule, at motoren endnu ikke har afsluttet kørslen.');
    await emit(ownerA, { type: 'run.status', status: 'error' });
    const failed = await expectState('idle'); assert.equal(failed.before.opacity, '0'); assert.equal(failed.busy, 'false');
    check('Fejlens afsluttende status slukker kanten; en fejltekst alene foregiver ingen afsluttet kørsel.');
    await emit(ownerA, { type: 'run.status', status: 'working' }); await expectState('working');
    await emit(ownerA, { type: 'run.status', status: 'idle' });
    const finished = await expectState('idle'); assert.equal(finished.before.animation, 'none'); assert.equal(finished.busy, 'false');
    check('Normal afslutning slukker animation og aria-busy uden en efterfølgende timer.');
    await helpers.assertNoGitWrites(app);
    assert.deepEqual(errors, []);
    check('Ingen rendererfejl eller Git-skrivninger under forløbet.');
    const report = {
      kind: 'Electron-renderer med kontrollerede IPC-hændelser; ingen rigtig AI-motor eller modelkontakt',
      platform: process.platform, electron: await app.evaluate(() => process.versions.electron),
      source: Object.fromEntries(await Promise.all(['ui/app.js', 'ui/styles.css', 'scripts/verify-composer-glow.cjs'].map(async file => [file, crypto.createHash('sha256').update(await fs.readFile(path.join(__dirname, '..', file))).digest('hex')]))),
      checks, screenshots, states, errors, profile: root,
      limits: ['Ingen påstand om modelkvalitet, modelnetværk eller live AI-kørsel.', 'Tilstande kommer fra kontrollerede IPC-hændelser; selve Electron-rendereren, samtaleskift og betjening er virkelige.', '720 px er den afprøvede smalle vinduesbredde; øvrige responsive grænser er ikke udvidet.']
    };
    await fs.writeFile(path.join(output, 'composer-glow-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, checks: checks.length, output, profile: root, screenshots: screenshots.map(item => item.file) }));
  } finally {
    await app?.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
