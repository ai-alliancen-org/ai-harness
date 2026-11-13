// R#16: «Tillad denne adresse» skal virke med det samme, også mens projektets egen server kører (Vite, Astro eller egne tjenester),
// og samtykket skal gælde alle projektets arbejdsmapper. Prøverne kører main.cjs' egen tekst for rum, server og kanalen
// preview:allow mod den rigtige DevServer med en rigtig Node-tjeneste, den rigtige sessionspolitik og et rigtigt lager på disken.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { desktopRequire, tempDir, previewMain } = require('./c1-main-kilde.cjs');
const { serverUI } = require('./c1-dom.cjs');
const { Store } = desktopRequire('./core/store.cjs');
const { DESIGN_PREVIEW_NETWORK } = desktopRequire('./core/project-runtime.cjs');

const IMAGE = 'https://images.unsplash.com/photo-1.jpg', IMAGE_ORIGIN = 'https://images.unsplash.com';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await wait(50); } return false; }
function fakeSession() {
  const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(listener) { ses.before = listener; }, onHeadersReceived(listener) { ses.headers = listener; } } };
  ses.cancelled = details => new Promise(resolve => ses.before(details, answer => resolve(answer.cancel === true)));
  ses.csp = details => new Promise(resolve => ses.headers({ ...details, responseHeaders: { 'Content-Type': ['text/html'] } }, answer => resolve(String(answer.responseHeaders['Content-Security-Policy'] || ''))));
  return ses;
}
const serverSource = `require('node:http').createServer((q, s) => { s.setHeader('Content-Type', 'text/html'); s.end('<img src="${IMAGE}">'); }).listen(Number(process.env.PORT), process.env.HOST);`;

test('Tillad denne adresse virker straks, mens projektets server kører, uden at serveren genstartes', async t => {
  const dir = await tempDir(t, 'aura-c1-tillad-');
  const root = path.join(dir, 'projekt');
  await fs.mkdir(root); await fs.writeFile(path.join(root, 'server.cjs'), serverSource);
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  // Som et nyt beta 3-projekt: designets korte netliste uden eksterne billeder, her med en egen lokal tjeneste.
  await store.saveProject(root, { runtime: { services: [{ id: 'web', label: 'Webside', command: ['node', 'server.cjs'] }], network: DESIGN_PREVIEW_NETWORK } });
  const main = previewMain({ root, store });
  await main.selectSpace(root, main.owner);
  const ctx = main.spaces.get(root);
  t.after(() => ctx.devServer.stop());
  await ctx.devServer.execute((await ctx.devServer.prepare('start')).token);
  assert.ok(await until(() => ['running', 'error'].includes(ctx.devServer.state)), 'serveren blev ikke klar');
  assert.equal(ctx.devServer.state, 'running', ctx.devServer.output + ctx.devServer.message);
  const page = ctx.externalPreview, origin = new URL(page).origin;

  const ses = fakeSession();
  main.previewSession.installSession(ses, { contexts: () => main.spaces.values(), onDiagnostic: main.previewDiagnostic });
  const image = { url: IMAGE, resourceType: 'image', initiatorOrigin: origin, frame: { url: page }, referrer: page };
  const reload = { url: page, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: { url: page, parent: { url: 'harness://app/index.html' } } };
  assert.equal(await ses.cancelled(image), true, 'billedet er blokeret før samtykket');
  assert.ok(ctx.blocked?.has(`images:${IMAGE_ORIGIN}`), 'blokeringen er set af hovedprocessen');

  const settings = await main.handlers['preview:allow']({ kind: 'images', origin: IMAGE_ORIGIN });
  assert.deepEqual(settings.runtime.network.images, [IMAGE_ORIGIN]);
  assert.equal(ctx.devServer.state, 'running', 'serveren kører stadig; den genstartes ikke');
  // Genindlæsningen efter klikket: siden får den nye indholdspolitik, og billedet hentes.
  assert.match(await ses.csp(reload), /img-src [^;]*https:\/\/images\.unsplash\.com/, 'indholdspolitikken for den kørende server har adressen');
  assert.equal(await ses.cancelled(image), false, 'billedet er tilladt, mens serveren kører');
  assert.deepEqual((await store.project(root)).runtime.network.images, [IMAGE_ORIGIN]);
  // Opstarten er den gennemgåede: tjenesterne er de samme som før.
  assert.deepEqual(ctx.devServer.snapshot().runtimeConfig.services.map(service => service.id), ['web']);
});

test('samtykket gælder alle projektets arbejdsmapper, også en arbejdskopi, der allerede er åben', async t => {
  const dir = await tempDir(t, 'aura-c1-kopi-');
  const root = path.join(dir, 'projekt'), copy = path.join(dir, 'kopi');
  for (const folder of [root, copy]) { await fs.mkdir(path.join(folder, 'public'), { recursive: true }); await fs.writeFile(path.join(folder, 'public/index.html'), `<img src="${IMAGE}">`); }
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  await store.saveProject(root, { runtime: { network: DESIGN_PREVIEW_NETWORK } });
  const main = previewMain({ root, store, openProject: async () => ({ staticPreview: true }) });
  await main.selectSpace(root, main.owner); await main.selectSpace(copy, main.owner);
  const ctx = main.spaces.get(root), kopi = main.spaces.get(copy);
  ctx.blocked = new Map([[`images:${IMAGE_ORIGIN}`, { kind: 'images', origin: IMAGE_ORIGIN }]]);
  await main.handlers['preview:allow']({ kind: 'images', origin: IMAGE_ORIGIN });
  assert.deepEqual(kopi.runtimeConfig.network.images, [IMAGE_ORIGIN], 'kopien har samme netliste som projektet');
  assert.deepEqual(main.previewSession.contextPolicy(kopi).network.images, [IMAGE_ORIGIN], 'kopiens forhåndsvisning bruger den med det samme');
});

test('brugerfladen genindlæser forhåndsvisningen efter Tillad og siger det, i stedet for at love noget ved næste start', async () => {
  const network = { scripts: [], styles: [], images: [IMAGE_ORIGIN], connect: [] };
  const view = serverUI({ answers: { previewAllow: () => ({ runtime: { network } }), previewRuntime: () => null } });
  view.ui.update({ root: '/projekt', workspaceRoot: '/projekt', state: 'running', url: view.current.previewURL, project: { kind: 'services', supported: true, installed: true, label: 'Webside', diagnostics: [] } });
  view.emit({ type: 'preview.diagnostic', root: '/projekt', workspaceRoot: '/projekt', diagnostic: { kind: 'images', origin: IMAGE_ORIGIN, message: 'Et billede blev blokeret.', repair: 'Brug lokale filer.' } });
  const allow = view.find('Tillad denne adresse');
  assert.ok(allow, 'samtykkekortet vises');
  view.$('#preview').src = 'http://127.0.0.1:5173/en-anden-side';
  await allow.click();
  const asked = view.calls.find(call => call.method === 'previewAllow').value;
  assert.equal(asked.kind, 'images'); assert.equal(asked.origin, IMAGE_ORIGIN);
  assert.equal(view.$('#preview').src, view.current.previewURL, 'rammen genindlæses med det samme');
  assert.match(view.messages.at(-1).text, /tilladt, og forhåndsvisningen er genindlæst/);
  assert.doesNotMatch(view.messages.at(-1).text, /næste gang/);
});
