// K3, fejl efter rammebindingen (beta 3): forhåndsvisningens ramme er bundet til sit arbejdsområde, men arbejdsområdet har ingen
// adresse, fordi projektets server er stoppet, er ved at starte eller har fejlet. Navigerer rammen så, fx ved ↻, kontrollen efter en
// opgave eller sidens egen genindlæsning, må hovedprocessen ikke kaste inde i webRequest. Electron skal altid have sit svar, ellers
// hænger navigationen, og hovedprocessen får en ufanget fejl. Anmodningen afvises uden den vildledende forklaring om et andet websted,
// og når serveren kører igen, viser rammen siden igen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { desktopRequire, tempDir, previewMain } = require('./c1-main-kilde.cjs');
const { installSession, staticPreview, allowedForContext } = desktopRequire('./core/preview-session.cjs');
const { Store } = desktopRequire('./core/store.cjs');

const app = 'harness://app/index.html';
// Svaret, som Electron får. Kaster lytteren, eller kalder den aldrig callback, står det i svaret i stedet.
function answer(listener, details) {
  let value = 'intet svar: callback blev ikke kaldt';
  try { listener(details, result => { value = result; }); } catch (error) { return `kaster «${error.message}»`; }
  return value;
}
function session(contexts, onDiagnostic) {
  const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(listener) { ses.before = listener; }, onHeadersReceived(listener) { ses.headers = listener; } } };
  const diagnosed = [];
  installSession(ses, { contexts: () => contexts, onDiagnostic: onDiagnostic || ((ctx, value) => diagnosed.push({ root: ctx.root, ...value })) });
  return { diagnosed, before: details => answer(ses.before, details), headers: details => answer(ses.headers, { ...details, responseHeaders: { 'Content-Type': ['text/html'] } }) };
}
// Rammen, som Electron giver i webRequest: dens URL er det forrige dokument, forælderen er appen, og id'et er browserens.
const frame = (frameTreeNodeId, url = 'about:blank') => ({ frameTreeNodeId, url, parent: { url: app } });
const fromApp = (url, f) => ({ url, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: f });

test('en bundet ramme, hvis server er stoppet, afvises uden at kaste og uden en forklaring om et andet websted', () => {
  const page = 'http://127.0.0.1:41001/';
  const a = { key: 'projekt-a', root: '/a', externalPreview: page };
  const s = session([a]);
  assert.deepEqual(s.before(fromApp(page, frame(7))), { cancel: false }, 'appen viser A, og rammen bindes');
  // Serveren stoppes, starter igen eller fejler: main.cjs sætter externalPreview = null (makeServer, emit).
  a.externalPreview = null;
  const shown = frame(7, page);
  assert.deepEqual(s.before(fromApp(page, shown)), { cancel: true }, '↻ eller kontrollen efter en opgave');
  assert.deepEqual(s.before({ url: page, resourceType: 'subFrame', initiatorOrigin: 'http://127.0.0.1:41001', frame: shown }), { cancel: true }, 'siden genindlæser sig selv, fx Vites klient');
  assert.deepEqual(s.headers({ url: page, resourceType: 'subFrame', frame: shown }), { cancel: true }, 'et svar, der når frem, efter at serveren er stoppet, vises ikke uden Auras indholdspolitik');
  assert.deepEqual(s.diagnosed, [], 'ingen forklaring om, at forhåndsvisningen kun viser projektets egen side');
  // Politikken svarer selv nej for et arbejdsområde uden adresse; den kaster ikke (også uden for webRequest-lytterne).
  assert.equal(allowedForContext(a, fromApp(page, shown)), false);
  // Serveren kører igen: rammen er stadig bundet til A og viser siden.
  a.externalPreview = page;
  assert.deepEqual(s.before(fromApp(page, shown)), { cancel: false });
  assert.match(String(s.headers({ url: page, resourceType: 'subFrame', frame: shown }).responseHeaders?.['Content-Security-Policy']), /frame-src 'none'/);
});

test('en bundet statisk forhåndsvisning, som ikke længere har sin adresse, afvises uden at kaste', () => {
  const a = { key: 'projekt-a', root: '/a' }; a.preview = staticPreview(a);
  const url = a.preview.url;
  const s = session([a]);
  assert.deepEqual(s.before(fromApp(url, frame(8))), { cancel: false });
  // preview:revision fjerner den statiske side, når projektet bliver et Vite-projekt, eller serveren tager over.
  a.preview = null;
  assert.deepEqual(s.before(fromApp(url, frame(8, url))), { cancel: true });
  assert.deepEqual(s.headers({ url, resourceType: 'subFrame', frame: frame(8, url) }), { cancel: true });
  assert.deepEqual(s.diagnosed, []);
});

test('en fejl i forhåndsvisningens politik kaster aldrig ud af webRequest; anmodningen afvises', () => {
  const page = 'http://127.0.0.1:41002/';
  const broken = { key: 'projekt-a', root: '/a', externalPreview: page, devServer: { snapshot() { throw Error('serverens tilstand kan ikke læses'); } } };
  const s = session([broken]);
  assert.deepEqual(s.before(fromApp(page, frame(9))), { cancel: true });
  assert.deepEqual(s.before({ url: page + 'app.js', resourceType: 'script', initiatorOrigin: 'http://127.0.0.1:41002', frame: frame(9, page) }), { cancel: true });
  assert.deepEqual(s.headers({ url: page, resourceType: 'subFrame', frame: frame(9, page) }), { cancel: true });
});

test('hele kæden i hovedprocessen: rammen bindes, serveren stoppes, ↻ afvises uden fejl, og efter ny start vises siden', async t => {
  const dir = await tempDir(t, 'aura-c1-stop-');
  const root = path.join(dir, 'projekt');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'server.cjs'), "require('node:http').createServer((q, s) => s.end('<h1>hej</h1>')).listen(Number(process.env.PORT), process.env.HOST);");
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  await store.saveProject(root, { runtime: { services: [{ id: 'web', label: 'Webside', command: ['node', 'server.cjs'] }] } });
  const main = previewMain({ root, store });
  await main.selectSpace(root, main.owner);
  const ctx = main.spaces.get(root);
  t.after(() => ctx.devServer.stop());
  const start = async () => {
    await ctx.devServer.execute((await ctx.devServer.prepare('start')).token);
    for (let i = 0; i < 400 && !['running', 'error'].includes(ctx.devServer.state); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(ctx.devServer.state, 'running', ctx.devServer.output + ctx.devServer.message);
    return ctx.externalPreview;
  };
  const page = await start();
  const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(listener) { ses.before = listener; }, onHeadersReceived(listener) { ses.headers = listener; } } };
  main.previewSession.installSession(ses, { contexts: () => main.spaces.values(), onDiagnostic: main.previewDiagnostic });
  assert.deepEqual(answer(ses.before, fromApp(page, frame(5))), { cancel: false }, 'appen viser siden, og rammen bindes');
  await ctx.devServer.stop();
  assert.equal(ctx.externalPreview, null, 'main.cjs har fjernet adressen');
  assert.deepEqual(answer(ses.before, fromApp(page, frame(5, page))), { cancel: true }, '↻ efter Stop');
  assert.equal(main.events.filter(event => event.type === 'preview.diagnostic').length, 0, 'ingen forklaring om et andet websted');
  const again = await start();
  assert.deepEqual(answer(ses.before, fromApp(again, frame(5, page))), { cancel: false }, 'efter ny start viser rammen siden igen');
});
