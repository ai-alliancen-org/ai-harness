// Udgiv → PKCE → IPC → gennemgang → rigtig adapter → lokal HTTP → Run-arkivlæser.
// Ingen eksterne kald, nøglering, modelkald eller Git-skrivninger.
// ZIP-materialet kopieres fra et eksisterende commit. Artifact-grænsen er injiceret,
// fordi prøven ikke opretter commits; Git-udtrækket afprøves særskilt.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { run } = require('../core/git.cjs');
const helpers = require('./ui-test-helpers.cjs');
const digest = data => createHash('sha256').update(data).digest('hex');

(async () => {
  const repo = path.resolve(__dirname, '../..');
  const publisher = process.env.AURA_KOMPLAI_PUBLISHER_ROOT || path.resolve(repo, '../komplai.dk');
  const { unpack } = await import(pathToFileURL(path.join(publisher, 'services/publisher/archive.mjs')).href);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-komplai-udgivelse-')));
  const project = path.join(root, 'projekt'), appdata = path.join(root, 'appdata');
  const head = (await run(repo, ['rev-parse', 'HEAD'])).toString().trim();
  const [name, at] = (await run(repo, ['log', '-1', '--format=%s%x00%cI', head])).toString().trim().split('\0');
  const sourceFiles = ['index.html', 'styles.css', 'app.js', 'catalog.json', 'images/aura-icon.png'];
  const originalFiles = new Map();
  for (const file of sourceFiles) {
    const data = await run(repo, ['show', `${head}:site/dist/${file}`]); originalFiles.set(file, data);
    await fs.mkdir(path.dirname(path.join(project, 'public', file)), { recursive: true });
    await fs.writeFile(path.join(project, 'public', file), data);
  }
  await fs.writeFile(path.join(project, 'fixture-version.json'), JSON.stringify({ head, version: { name, at }, source: 'site/dist i eksisterende commit' }));
  const grant = 'komp_publish_grant_' + 'a'.repeat(64);
  const existingId = '11111111-2222-4333-8444-555555555555';
  const creations = [], changes = [];
  const apps = new Map([[existingId, { id: existingId, name: 'Eksisterende prøve', slug: 'eksisterende-proeve', visibility: 'private', activeRelease: 'tidligere-version', releases: [{ id: 'tidligere-version' }] }]]);
  const live = new Map([[existingId, new Map([['index.html', Buffer.from('<h1>Tidligere privat version</h1>')]])]]);
  const calls = [], uploads = [], screens = [], serverErrors = [];
  let outcome = 'ok', connected = false, failOverview = false, exposePrivate = false, app;
  const metadata = item => ({ ...item, url: `https://${item.slug}.komplai.run` });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1'), method = request.method;
      const chunks = []; for await (const part of request) chunks.push(part); const body = Buffer.concat(chunks);
      calls.push({ route: url.pathname + url.search, method });
      const send = (value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
      if (url.pathname === '/auth/oauth/v2/token') return send({ access_token: 'syntetisk-login', token_type: 'Bearer' });
      if (url.pathname === '/api/v1/aura/config') return send({ issuer: 'https://auth.komplai.dk', clientId: 'syntetisk-klient', scopes: ['openid'], authorizationEndpoint: 'https://auth.komplai.dk/oauth/v2/authorize', tokenEndpoint: 'https://auth.komplai.dk/oauth/v2/token' });
      if (url.pathname === '/api/v1/aura/organisations') {
        assert.equal(url.search, '?include=publishing');
        return send({ organisations: ['a', 'b'].map(id => ({ id: 'org-' + id, name: 'Prøveorganisation ' + id.toUpperCase(), coding: null, publishing: { address: 'komplai.run', tier: 'shared_free' } })) });
      }
      if (url.pathname === '/api/v1/aura/publishing/connect') {
        assert.deepEqual(JSON.parse(body), { organisationId: 'org-b', acceptPublishing: true }); connected = true;
        return send({ id: 'syntetisk-grant', secret: grant, address: 'komplai.run', expiresAt: '2099-01-01T00:00:00Z' });
      }
      if (url.pathname === '/api/v1/aura/publishing/session') { assert.equal(method, 'DELETE'); connected = false; return send({ revoked: true }); }
      if (url.pathname.startsWith('/site/')) {
        assert.equal(request.headers.authorization, undefined, 'Adgangskontrollen må ikke sende udgivelsesnøglen.');
        const [, , slug, ...parts] = url.pathname.split('/'), target = [...apps.values()].find(a => a.slug === slug);
        if (!target) return send({ error: 'not_found' }, 404);
        if (target.visibility === 'private' && !exposePrivate) return send({ error: 'login_required' }, 401);
        const file = parts.join('/') || 'index.html', data = live.get(target.id)?.get(file);
        if (!data) return send({ error: 'not_found' }, 404);
        response.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'image/png' }); return response.end(data);
      }
      assert(connected, 'Hub-kald kræver den valgte organisation.');
      assert.equal(request.headers.authorization, 'Bearer ' + grant); assert.equal(request.headers.origin, undefined);
      if (url.pathname === '/hub/api/publish/native') return failOverview ? send({ error: 'unavailable' }, 503) : send({ address: 'komplai.run', slugs: true, apps: [...apps.values()].map(metadata) });
      if (url.pathname === '/hub/api/publish/native/address') return send({ available: ![...apps.values()].some(a => a.slug === url.searchParams.get('slug')), reason: null });
      if (url.pathname === '/hub/api/publish/native/apps') {
        assert.equal(method, 'POST'); const input = JSON.parse(body), id = randomUUID();
        // Som Hub: en ny app er altid for organisationen; offentlig er et særskilt, bekræftet trin.
        if (input.visibility === 'public') return send({ error: 'public_on_create' }, 403);
        creations.push(input);
        const item = { id, name: input.name, slug: input.slug || 'tilfaeldig-proeve', visibility: input.visibility, activeRelease: null, releases: [] }; apps.set(id, item); return send(metadata(item));
      }
      const change = url.pathname.match(/^\/hub\/api\/publish\/native\/apps\/([^/]+)$/);
      if (change) {
        // Aura gør kun en ny app offentlig før dens første version, med appens navn som bekræftelse.
        const item = apps.get(change[1]), input = JSON.parse(body);
        if (method !== 'PATCH' || !item || item.activeRelease || item.releases.length) throw Error('Aura må ikke ændre en eksisterende apps adgang under upload.');
        assert.deepEqual(Object.keys(input).sort(), ['confirmPublic', 'visibility']);
        if (input.visibility !== 'public' || input.confirmPublic !== item.name) return send({ error: 'public_confirmation' }, 403);
        changes.push({ id: item.id, ...input }); item.visibility = 'public'; return send(metadata(item));
      }
      const upload = url.pathname.match(/^\/hub\/api\/publish\/([^/]+)\/releases$/);
      if (upload) {
        assert.equal(method, 'POST'); const item = apps.get(upload[1]); assert(item);
        const type = request.headers['content-type'], files = unpack(body, type === 'text/html' ? 'html' : type === 'application/zip' ? 'zip' : 'forkert');
        uploads.push({ appId: item.id, type, files, visibility: item.visibility, outcome });
        await fs.writeFile(path.join(root, `upload-${uploads.length}.${type === 'text/html' ? 'html' : 'zip'}`), body);
        if (outcome === 'afvist') return send({ error: 'storage_limit' }, 507);
        item.activeRelease = randomUUID(); item.releases.push({ id: item.activeRelease }); live.set(item.id, files);
        if (outcome === 'ukendt') return response.destroy();
        if (outcome === 'efterkontrol') failOverview = true;
        return send(metadata(item));
      }
      throw Error('Uventet kald: ' + method + ' ' + url.pathname);
    } catch (error) { serverErrors.push(error.message); response.writeHead(500); response.end('Syntetisk serverfejl'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + appdata], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    await app.evaluate(({ safeStorage, shell, dialog, session }, { base, project, modulePath }) => {
      const nativeFetch = globalThis.fetch;
      globalThis.fixtureExternal = [];
      // Kun destinationsadressen udskiftes. Rigtige bodies, headere og fejl går gennem HTTP.
      globalThis.fetch = (value, options) => {
        const url = new URL(String(value));
        if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return nativeFetch(value, options);
        const prefix = { 'https://auth.komplai.dk': '/auth', 'https://api.komplai.dk': '/api', 'https://hub.komplai.dk': '/hub' }[url.origin];
        if (prefix) return nativeFetch(base + prefix + url.pathname + url.search, options);
        if (url.hostname.endsWith('.komplai.run')) return nativeFetch(base + '/site/' + url.hostname.split('.')[0] + url.pathname, options);
        throw Error('Ekstern forbindelse er blokeret i prøven.');
      };
      // Electron-rendereren må heller ikke sende projektets eksterne kald ud.
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url); callback({ cancel: ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname) });
      });
      shell.openExternal = async value => {
        const url = new URL(value);
        if (url.origin !== 'https://auth.komplai.dk') { globalThis.fixtureExternal.push(value); return; }
        if (url.searchParams.get('code_challenge_method') !== 'S256') throw Error('PKCE mangler.');
        const callback = new URL(url.searchParams.get('redirect_uri')); callback.searchParams.set('state', url.searchParams.get('state')); callback.searchParams.set('code', 'syntetisk-kode');
        if (!(await nativeFetch(callback)).ok) throw Error('Callback afvist.');
      };
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = value => Buffer.from('prøve:' + Buffer.from(value).toString('base64'));
      safeStorage.decryptString = value => Buffer.from(value.toString().slice(6), 'base64').toString();
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      const require = process.getBuiltinModule('module').createRequire(modulePath), { Deployments } = require(modulePath);
      const read = require('node:fs/promises'), paths = require('node:path'), { createHash } = require('node:crypto');
      const hash = value => createHash('sha256').update(value).digest('hex');
      const original = Deployments.prototype.review;
      Deployments.prototype.review = async function(root, input) {
        this.artifact = async (selected, directory) => {
          if (selected !== project || directory !== 'public') throw Error('Prøven må kun læse sit isolerede projekt.');
          const version = JSON.parse(await read.readFile(paths.join(project, 'fixture-version.json'))), files = [];
          const walk = async (folder, prefix = '') => {
            for (const entry of await read.readdir(folder, { withFileTypes: true })) {
              const file = prefix + entry.name;
              if (entry.isDirectory()) await walk(paths.join(folder, entry.name), file + '/');
              else { const data = await read.readFile(paths.join(folder, entry.name)); files.push({ file, source: 'public/' + file, data, sha256: hash(data) }); }
            }
          };
          await walk(paths.join(project, directory)); files.sort((a, b) => a.file.localeCompare(b.file, 'en'));
          return { root: project, directory, ...version, files, bytes: files.reduce((sum, file) => sum + file.data.length, 0), hash: hash(JSON.stringify(files.map(f => [f.file, f.sha256]))) };
        };
        return original.call(this, root, input);
      };
    }, { base, project, modulePath: path.join(__dirname, '../core/deployments.cjs') });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' }); await helpers.skipIntroduction(page); await helpers.enableSharing(page);
    await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    // Alle seks udbydere står på samme skærm (DESIGN.md:171), så komplai Run vælges direkte.
    const selectProvider = async id => { await page.click(`[data-provider="${id}"]`); await idle(); };
    const state = async () => (await page.evaluate(() => window.harness.deploymentState())).value;
    const capture = async name => {
      // Lad det synlige trin og compositorens næste billede følge DOM-opdateringen.
      await page.mouse.move(0, 0);
      const expectedHeading = await page.locator('#deployment-heading').textContent();
      await page.waitForFunction(heading => { const dialog = document.querySelector('#deployment-dialog'); return dialog.open && document.getElementById(dialog.getAttribute('aria-labelledby')).textContent === heading && !dialog.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'); }, expectedHeading);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await page.locator('#deployment-review').isVisible()) assert.equal(await page.locator('#deployment-send').evaluate(button => { const box = button.getBoundingClientRect(), dialog = button.closest('dialog').getBoundingClientRect(); return box.top >= dialog.top && box.bottom <= dialog.bottom; }), true, 'Udgiv er synlig uden at rulle gennem hele gennemgangen.');
      if (await page.locator('#deployment-review').isVisible()) assert.equal(await page.locator('#deployment-feedback').evaluate(message => { const text = message.getBoundingClientRect(), actions = document.querySelector('#deployment-review-footer .dialog-actions').getBoundingClientRect(), bounds = message.closest('dialog').getBoundingClientRect(); return text.top >= bounds.top && text.bottom <= actions.top && text.bottom <= bounds.bottom; }), true, 'Statuslinjen er synlig og dækkes ikke af handlingsrækken.');
      if (await page.locator('#deployment-result').isVisible() && !await page.locator('#deployment-receipt-details').evaluate(el => el.open)) assert.equal(await page.locator('#deployment-main-actions .primary').evaluate(button => { const box = button.getBoundingClientRect(), dialog = button.closest('dialog').getBoundingClientRect(); return box.top >= dialog.top && box.bottom <= dialog.bottom; }), true, 'Kvitteringens hovedhandling er synlig.');
      const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).webContents.capturePage()).toPNG().toString('base64'));
      await fs.writeFile(path.join(root, name + '.png'), Buffer.from(image, 'base64'));
      const providers = await page.locator('[data-deploy-step="providers"]').isVisible();
      if (providers) { const visible = await page.locator('[data-deploy-step="providers"] [data-provider]:visible').evaluateAll(items => items.map(item => item.dataset.provider)); assert.deepEqual(visible, ['azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']); assert.equal(await page.locator('#deployment-more-providers').count(), 0); }
      screens.push(await page.locator('#deployment-dialog').evaluate((dialog, { name, providers }) => ({ name, providers, result: !document.querySelector('#deployment-result').hidden, app: !dialog.querySelector('[data-deploy-step="app"]').hidden, appAccount: dialog.querySelector('#deploy-komplai-account')?.checkVisibility() === true, details: [...dialog.querySelectorAll('#deployment-receipt-details[open], #deployment-technical[open]')].some(el => el.checkVisibility()), heading: document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, words: dialog.innerText.trim().split(/\s+/).length, choices: [...dialog.querySelectorAll('button,select,input[type=checkbox],input[type=radio],summary')].filter(el => el.checkVisibility()).length, fields: [...dialog.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden])')].filter(el => el.checkVisibility()).length, overflow: dialog.scrollWidth > dialog.clientWidth + 1 }), { name, providers }));
    };
    const reveal = async selector => { if (!await page.locator(selector).isVisible()) await page.locator('#deployment-receipt-details > summary').click(); };
    const check = async () => { await reveal('#deployment-check'); await page.click('#deployment-check'); await idle(); };
    const review = async () => { await page.click('#deployment-next'); await idle(); if (await page.locator('#deployment-review').isHidden()) throw Error(await page.locator('#deployment-feedback').textContent()); };
    const send = async () => { await page.click('#deployment-send'); await idle(); return (await state()).last; };
    const next = async id => { await reveal('#deployment-new'); await page.click('#deployment-new'); await idle(); if (id) { await page.click('#deployment-back'); await page.click('#deploy-komplai-choose'); await page.selectOption('#deploy-komplai-app', id); } assert.equal(await page.locator('[name="komplai-visibility"]:checked').count(), 0); };
    await page.click('#deploy-button'); await idle(); await capture('destination');
    assert.equal(await page.locator('#deployment-dialog [data-provider]:visible').count(), 0);
    assert.equal(await page.inputValue('#deploy-provider'), '');
    assert.doesNotMatch(await page.locator('[data-deploy-step="destination"]').innerText(), /komplai|Vercel|Azure/i);
    await page.click('#deployment-other'); await capture('udbydere');
    assert.deepEqual(await page.locator('[data-deploy-step="providers"] [data-provider]').evaluateAll(items => items.map(item => item.dataset.provider)), ['azure', 'cloudflare', 'github-pages', 'komplai', 'promte', 'vercel']);
    assert.equal(calls.length, 0, 'Der må ikke ske netkald, før brugeren vælger en udbyder.');
    await selectProvider('komplai'); await idle(); await capture('login');
    assert.equal(await page.isVisible('#deployment-next'), false);
    const login = async () => { await page.click('#komplai-publish-login'); await page.waitForSelector('[data-deploy-step="organisation"]:not([hidden])'); await page.selectOption('#komplai-publish-org', 'org-b'); };
    await page.click('#komplai-publish-login'); await page.waitForSelector('[data-deploy-step="organisation"]:not([hidden])'); await capture('organisation'); await page.selectOption('#komplai-publish-org', 'org-b'); await capture('forbind-organisation'); await page.click('#deployment-back'); assert.equal(await page.inputValue('#komplai-publish-org'), 'org-b'); await capture('organisation-tilbage'); await page.selectOption('#komplai-publish-org', ''); assert.equal(await page.isVisible('#deployment-next'), false); await page.selectOption('#komplai-publish-org', 'org-b'); await page.click('#deployment-back'); await page.click('#deployment-next'); assert.equal(await page.locator('#komplai-publish-ai-row').count(), 0);
    // Luk under login må hverken gemme adgang eller genåbne dialogen fra et sent callback.
    await page.keyboard.press('Escape'); assert.equal(connected, false); assert.equal(uploads.length, 0); assert.equal(await page.evaluate(() => document.activeElement.id), 'deploy-button');
    await page.click('#deploy-button'); await idle(); await page.click('#deployment-other'); await selectProvider('komplai'); await idle(); await login(); failOverview = true; await page.click('#komplai-publish-confirm'); await idle();
    assert.equal(connected, true); assert.equal(await page.isVisible('#komplai-publish-login'), true);
    await page.click('#deployment-back'); assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvor vil du udgive?');
    failOverview = false; await selectProvider('komplai'); await idle();
    assert.equal(calls.filter(call => call.route === '/api/v1/aura/publishing/connect').length, 1, 'Fejlet oversigt kræver ikke et nyt grant.');
    assert.match(await page.locator('#komplai-publish-org-name').innerText(), /Prøveorganisation B/); await capture('appvalg');
    assert.equal(await page.isVisible('#deploy-komplai-account'), true, 'Konto og adgang kan nås fra appvalget');
    await page.click('#deploy-komplai-account'); await idle(); assert.equal(await page.locator('#deployment-heading').textContent(), 'Konto og adgang');
    assert.doesNotMatch(await page.locator('#deployment-account-access').textContent(), /Forbundet/, 'kontotrinnet siger kun det, Aura ved'); await capture('konto-fra-appvalg');
    await page.click('#deployment-back'); assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvilken app vil du udgive til?'); await page.click('#deployment-back'); assert.equal(await page.locator('#deployment-heading').textContent(), 'Hvor vil du udgive?'); await selectProvider('komplai'); await idle(); assert.equal(await page.isVisible('#deploy-komplai-create'), true);
    assert.equal((await page.evaluate(() => window.harness.connectionState())).value.connections.length, 0);
    assert.equal(await page.locator('[name="komplai-visibility"]:checked').count(), 0);
    await page.click('#deploy-komplai-create'); await page.fill('#deploy-komplai-name', 'Ny prøveapp'); await capture('ny-app');
    await page.click('#deploy-komplai-edit-address'); await capture('adresse'); await page.click('#deployment-next'); assert.equal(await page.inputValue('#deploy-komplai-name'), 'Ny prøveapp');
    await page.click('#deployment-next'); await capture('adgang'); assert.equal(await page.locator('[name="komplai-visibility"]:checked').count(), 0);
    await page.check('[name="komplai-visibility"][value="private"]'); await page.click('#deployment-back'); await capture('adgang-tilbage'); await page.locator('[name="komplai-visibility"][value="private"]').click(); await capture('filer'); await review(); assert.match(await page.locator('#deployment-review').textContent(), /Prøveorganisation B.*Kun organisationen.*Medlemmer logger ind/);
    assert.equal(await page.isEnabled('#deployment-send'), true); assert.equal(uploads.length, 0); assert.equal(await page.evaluate(() => document.activeElement.id), 'deployment-heading'); await capture('gennemgang');
    await page.click('#deployment-edit'); await idle(); assert.equal(uploads.length, 0); await review();
    // Rigtige filændringer efter gennemgang udløser den faktiske hash-vagt før HTTP.
    await fs.appendFile(path.join(project, 'public/index.html'), '\n<!-- ændret efter gennemgang -->');
    await send(); assert.equal(uploads.length, 0); assert.match(await page.locator('#deployment-feedback').textContent(), /Version eller destination har ændret/);
    await fs.writeFile(path.join(project, 'public/index.html'), originalFiles.get('index.html'));
    await review(); let receipt = await send(); const createdId = receipt.appId;
    assert.equal(receipt.state, 'READY'); assert.equal(uploads[0].type, 'application/zip'); assert.equal(uploads[0].visibility, 'private');
    for (const [file, data] of originalFiles) assert.deepEqual(uploads[0].files.get(file), data);
    assert.equal(uploads[0].files.size, originalFiles.size); assert.equal(receipt.head, head);
    // Brugerens valg 5. november: komplai-adressen kontrolleres kun ved tryk på Kontrollér, så kortet siger «Uploadet» indtil da.
    assert.equal(await page.locator('#deployment-result-app-name').textContent(), 'Ny prøveapp'); assert.equal(await page.locator('#deployment-state').textContent(), 'Uploadet, adressen er ikke kontrolleret endnu'); assert.equal(await page.locator('#deployment-verification h4').textContent(), 'Startside ikke kontrolleret'); await capture('upload-modtaget');
    // Kvitteringen viser højst to hovedknapper og Se detaljer; Konto og adgang og Udgiv et andet sted ligger under Se detaljer (AGENTS.md).
    for (const id of ['#deployment-komplai-account', '#deployment-another']) assert.equal(await page.locator(id).isVisible(), false, id + ' står ikke i første lag');
    await page.locator('#deployment-receipt-details > summary').click();
    for (const id of ['#deployment-komplai-account', '#deployment-another']) assert.equal(await page.locator(id).isVisible(), true, id + ' står under Se detaljer');
    await page.locator('#deployment-receipt-details > summary').click();
    await check(); receipt = (await state()).last;
    assert.equal(receipt.checks.site.http, 401); assert.match(receipt.verification, /kræver login med komplai/); assert.equal(await page.locator('#deployment-state').textContent(), 'Udgivet'); assert.equal(await page.locator('#deployment-result-access').textContent(), 'Kun organisationen'); assert.equal(await page.locator('#deployment-verification').isVisible(), false); await capture('privat-resultat');
    await page.locator('#deployment-receipt-details > summary').click(); await capture('privat-detaljer'); await page.locator('#deployment-receipt-details > summary').click();
    // Faktisk anonymt filmatch må modsige et privat flag i metadata.
    exposePrivate = true; await check(); assert.equal((await state()).last.checks.content.status, 'matched');
    assert.equal(await page.locator('#deployment-result-access').textContent(), 'Startsiden er åben'); assert.equal(await page.locator('#deployment-access').getAttribute('data-tone'), 'warning'); assert.equal(await page.locator('#deployment-verification').getAttribute('data-tone'), 'warning'); await capture('privat-men-aaben');
    exposePrivate = false; await check();
    // Hub kan ændre delingen siden uploaden. Kvitteringen skal vise frisk adgang.
    apps.get(createdId).visibility = 'public'; await check();
    assert.match(await page.locator('#deployment-checks').textContent(), /Alle med linket.*afviger fra dit valg/);
    assert.doesNotMatch(await page.locator('#deployment-checks').textContent(), /Kræver login/); await capture('adgang-aendret-i-hub');
    apps.get(createdId).visibility = 'private';
    // Den eksisterende apps deling ændres eksplicit i Hub, ikke af uploaden.
    await next(existingId); await page.click('#deployment-back'); assert.equal(await page.inputValue('#deploy-komplai-app'), existingId); await capture('eksisterende-app-tilbage'); await page.fill('#deploy-komplai-search', 'findes-ikke'); assert.equal(await page.isVisible('#deployment-next'), false); await page.fill('#deploy-komplai-search', 'Eksisterende prøve'); await page.selectOption('#deploy-komplai-app', existingId); assert.equal(await page.isVisible('#deploy-komplai-visibility'), false);
    await page.click('#deployment-file-options'); await capture('ret'); await page.click('#deployment-change-destination'); await capture('ret-destination'); await page.locator('#deployment-account-options > summary').click(); await page.click('#deployment-account'); await capture('konto'); await page.click('#deploy-komplai-access'); await idle(); assert.match((await app.evaluate(() => globalThis.fixtureExternal)).at(-1), new RegExp(existingId)); for (let back = 0; back < 3; back++) await page.click('#deployment-back');
    apps.get(existingId).visibility = 'public'; await review(); assert.match(await page.locator('#deployment-summary').textContent(), /Alle med linket/);
    // Ændret adgang efter brugerens gennemgang skal stoppe før upload.
    apps.get(existingId).visibility = 'private'; const beforeStale = uploads.length; await send();
    assert.equal(uploads.length, beforeStale); assert.match(await page.locator('#deployment-feedback').textContent(), /adgang er ændret/);
    // Den gamle kvittering kan stadig læses; næste gennemgang bruger de nye valg.
    if (await page.isVisible('#deployment-result')) await next(existingId);
    apps.get(existingId).visibility = 'public'; await review(); await send();
    assert.equal(uploads[1].appId, existingId); assert.equal(uploads[1].visibility, 'public'); assert.equal(apps.size, 2);
    await check(); receipt = (await state()).last;
    assert.equal(receipt.checks.content.status, 'matched'); assert.equal(apps.get(existingId).visibility, 'public'); assert.equal(await page.locator('#deployment-verification h4').textContent(), 'Startsiden matcher den gemte fil'); await capture('offentligt-resultat'); apps.get(existingId).name = 'Omdøbt prøve';
    // Den faktiske modtagne ZIP åbnes i en browser, inklusive CSS, JS og katalog.
    const sitePagePromise = app.context().waitForEvent('page');
    await app.evaluate(({ BrowserWindow }, url) => { const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } }); w.loadURL(url); }, base + '/site/eksisterende-proeve/');
    const site = await sitePagePromise; await site.waitForSelector('#tool-picker label.tool');
    assert.match(await site.locator('h1').innerText(), /kodeagent/);
    const firstTool = await site.locator('#pack-title').innerText(); await site.locator('#tool-picker label.tool:visible').nth(1).click();
    assert.notEqual(await site.locator('#pack-title').innerText(), firstTool); assert((await site.locator('#file-content').innerText()).length > 100);
    await site.screenshot({ path: path.join(root, 'modtaget-webside.png') }); await site.close();
    // En ny offentlig app kræver fortsat et eksplicit valg; ingen adgang er forvalgt.
    await next(); assert.equal(await page.inputValue('#deploy-komplai-app'), existingId, 'Seneste app bevares, selv om den er omdøbt siden søgningen.'); await page.click('#deployment-file-options'); await page.click('#deployment-change-destination'); await page.click('#deployment-change-app'); await idle(); await capture('skift-app'); assert.equal(calls.filter(call => call.route === '/api/v1/aura/publishing/connect').length, 1); await page.click('#deploy-komplai-create'); assert.equal(await page.locator('[name="komplai-visibility"]:checked').count(), 0);
    await page.fill('#deploy-komplai-name', 'Offentlig prøve'); await page.click('#deploy-komplai-edit-address'); await page.fill('#deploy-komplai-slug', 'offentlig-proeve'); await page.click('#deployment-next'); await page.click('#deployment-next');
    await page.check('[name="komplai-visibility"][value="public"]'); await page.waitForSelector('[data-deploy-step="confirmPublic"]:not([hidden])'); assert.equal(await page.textContent('#deployment-heading'), 'Skal appen være offentlig?'); await capture('bekraeft-offentlig');
    await page.fill('#deploy-komplai-confirm', 'offentlig prøve'); await page.click('#deployment-next'); assert.equal(await page.locator('[data-deploy-step="confirmPublic"]').isVisible(), true, 'Et forkert navn bekræfter ikke den offentlige app.');
    await page.fill('#deploy-komplai-confirm', 'Offentlig prøve'); await page.click('#deployment-next'); await review(); await send(); assert.equal(apps.size, 3); assert.equal(uploads.at(-1).visibility, 'public');
    assert.deepEqual(creations.at(-1), { name: 'Offentlig prøve', visibility: 'private', slug: 'offentlig-proeve' });
    assert.deepEqual(changes.at(-1), { id: uploads.at(-1).appId, visibility: 'public', confirmPublic: 'Offentlig prøve' });
    // Afvist upload bevarer den tidligere version og dens adgang. komplai sagde nej, så intet er uploadet: den tidligere
    // kvittering bevares (fund 16), og testeren bliver på filtrinnet med komplais egen tekst og kan prøve igen derfra.
    await next(createdId); await review();
    const kept = (await state()).last, previous = apps.get(createdId).activeRelease; outcome = 'afvist'; await send();
    assert.equal(apps.get(createdId).activeRelease, previous); assert.equal(apps.get(createdId).visibility, 'private');
    assert.deepEqual((await state()).last, kept); assert.match(await page.locator('#deployment-feedback').textContent(), /plads til apps er brugt/);
    assert.equal(await page.locator('[data-deploy-step="files"]').isVisible(), true); assert.equal(await page.isVisible('#deployment-result'), false); await capture('afvist-upload');
    await page.keyboard.press('Escape'); await page.click('#deploy-button'); await idle(); assert.equal(await page.isVisible('#deployment-result'), true);
    // En enkelt selvstændig HTML-fil prøver den anden wire-formatgren. Dette er syntetisk materiale.
    await fs.rm(path.join(project, 'public'), { recursive: true }); await fs.mkdir(path.join(project, 'public'));
    const html = Buffer.from('<!doctype html><html lang="da"><meta charset="utf-8"><title>Isoleret HTML-prøve</title><h1>En lille blomst</h1><p>Kun syntetisk testmateriale.</p></html>');
    await fs.writeFile(path.join(project, 'public/index.html'), html);
    await fs.writeFile(path.join(project, 'fixture-version.json'), JSON.stringify({ head: 'syntetisk-html', version: { name: 'Syntetisk HTML-prøve', at }, source: 'Syntetisk enkeltfil; ingen Git-version' }));
    // Et bekræftet release-ID skal overleve en efterfølgende fejl i Hub-oversigten.
    outcome = 'efterkontrol'; await next(createdId); await review(); receipt = await send();
    assert.equal(receipt.state, 'UPLOADED'); assert.equal(receipt.id, apps.get(createdId).activeRelease); assert.equal(await page.locator('#deployment-check').evaluate(el => !el.hidden), true);
    await capture('bekraeftet-upload-statusfejl'); const beforeRecovery = uploads.length;
    failOverview = false; await check(); assert.equal((await state()).last.state, 'READY'); assert.equal(uploads.length, beforeRecovery);
    assert.equal(uploads.at(-1).type, 'text/html'); assert.deepEqual(uploads.at(-1).files.get('index.html'), html);
    // Serveren aktiverer versionen, men forbindelsen forsvinder før svaret. Ingen gentagelse.
    outcome = 'ukendt'; await next(createdId); await review();
    const before = uploads.length; await send(); receipt = (await state()).last;
    assert.equal(receipt.state, 'UNKNOWN'); assert.equal(receipt.id, null); assert.equal(uploads.length, before + 1); assert.equal(apps.get(createdId).visibility, 'private');
    assert.equal(await page.locator('#deployment-check').evaluate(el => el.hidden), true); assert.equal(await page.isVisible('#deployment-portal'), true); await capture('ukendt-upload');
    await page.click('#deployment-portal'); await idle(); assert.match((await app.evaluate(() => globalThis.fixtureExternal)).at(-1), /hub\.komplai\.dk\/publish/);
    await page.click('[data-close="deployment-dialog"]'); await page.click('#deploy-button'); await idle();
    assert.equal(uploads.length, before + 1); assert.equal((await state()).last.state, 'UNKNOWN');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')); w.setSize(980, 720); w.webContents.setZoomFactor(1.5); });
    await page.locator('#deployment-heading').scrollIntoViewIfNeeded(); await capture('ukendt-upload-980-150'); await page.locator('#deployment-receipt-details > summary').click(); await page.locator('#deployment-receipt').scrollIntoViewIfNeeded(); await capture('ukendt-upload-detaljer-980-150'); await page.locator('#deployment-receipt-details > summary').click();
    await next(); assert.equal(await page.inputValue('#deploy-komplai-app'), createdId); assert.equal(uploads.length, before + 1);
    await capture('eksisterende-app-980-150'); await page.click('#deployment-back'); await capture('appvalg-980-150'); await page.locator('#deploy-komplai-create').focus(); await page.keyboard.press('Enter'); await capture('ny-app-980-150'); await page.click('#deployment-next'); await capture('adgang-980-150'); await page.locator('[name=\"komplai-visibility\"][value=\"private\"]').focus(); await page.keyboard.press('Space'); assert.equal(await page.locator('#deployment-heading').evaluate(el => el.matches(':focus-visible') && getComputedStyle(el, '::before').width === '3px'), true, 'Tastaturfokus på overskriften markeres diskret.'); await capture('filer-980-150'); await review(); await capture('gennemgang-980-150'); await page.locator('#deployment-technical > summary').click(); await page.locator('#deployment-details').scrollIntoViewIfNeeded(); await capture('gennemgang-detaljer-980-150'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'deploy-button');
    assert.equal(JSON.stringify(await state()).includes(grant), false); assert.doesNotMatch(await fs.readFile(path.join(appdata, 'harness/settings.json'), 'utf8'), /komp_publish_grant_|syntetisk-login/);
    // Forløbets trin og kvitteringen har højst fire synlige kontroller med Tilbage og Luk; kvitteringen viser højst to hovedknapper og
    // Se detaljer (AGENTS.md). Udbydertrinnet viser seks udbydere samt Tilbage og Luk (DESIGN.md:171). Appvalget har to hovedvalg og
    // linket Konto og adgang (N:D2-3) ud over Tilbage og Luk; det er den eneste undtagelse og tælles kun, når linket står der.
    assert.deepEqual(errors, []); assert.deepEqual(serverErrors, []); assert(screens.every(screen => !screen.overflow)); assert(screens.every(screen => screen.details || (screen.providers ? screen.choices === 8 : screen.app ? screen.choices <= 4 + Number(screen.appAccount) : screen.choices <= 4)), 'For mange synlige kontroller: ' + JSON.stringify(screens));
    assert.equal(calls.some(call => /chat\/completions|\/aura\/connect$|\/models/.test(call.route)), false);
    // Den eneste ændring af adgang er den bekræftede offentliggørelse af den nye app før dens første version.
    assert.equal(changes.length, 1); assert.equal(calls.filter(call => call.method === 'PATCH').length, changes.length);
    await fs.writeFile(path.join(root, 'kvittering.json'), JSON.stringify(receipt, null, 2));
    await fs.writeFile(path.join(root, 'skaermmaaling.json'), JSON.stringify(screens, null, 2));
    console.log(JSON.stringify({ status: 'bestået', root, sourceCommit: head, uploads: uploads.map(({ files, ...upload }) => ({ ...upload, files: [...files.keys()] })), screens, limitations: ['lokal syntetisk OAuth/Hub, ingen reel udgivelse', 'nøglering simuleret', 'artifact-provider injiceret; Git-udtræk afprøves særskilt', 'enkelt-HTML har syntetisk versionsmetadata', 'ingen Windows-prøve'] }));
  } catch (error) {
    if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {});
    console.error('Prøvemappe:', root); throw error;
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
