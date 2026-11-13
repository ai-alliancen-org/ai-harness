// K3 (beta 3): hver arbejdsmappe har sin egen ramme i appen. En skjult arbejdsmappes side kan stadig navigere, fx med en tidsstyret
// omdirigering til et andet websted. Hovedprocessen skal melde en fejlet indlæsning og en frame-src-blokering for den arbejdsmappe,
// rammen hører til, og ikke forklare den i den viste. Prøven kører main.cjs' egne lyttere (did-fail-load og console-message) og
// previewDiagnostic mod den rigtige installSession, hvor rammerne bindes, som når appen viser dem første gang.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { desktopRequire, cut, load } = require('./c1-main-kilde.cjs');
const previewSession = desktopRequire('./core/preview-session.cjs');

const uiURL = 'harness://app/index.html';
const FRAME_SRC = "Framing 'https://www.borger.dk/' violates the following Content Security Policy directive: \"frame-src aura-preview: http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*\". The request has been blocked.";
const frame = (frameTreeNodeId, url = 'about:blank') => ({ frameTreeNodeId, url, parent: { url: uiURL } });

// To arbejdsmapper i samme projekt: A vises, B (en arbejdskopi) er skjult. Hver ramme er bundet ved appens første navigation.
function setup({ frames = ['a', 'b'] } = {}) {
  const owner = { project: { root: '/projekt' } };
  const a = { root: '/projekt', owner, key: 'projekt-a', externalPreview: 'http://127.0.0.1:47001/' };
  const b = { root: '/kopi', owner, key: 'kopi-b', externalPreview: 'http://127.0.0.1:47002/' };
  const spaces = new Map([[a.root, a], [b.root, b]]), events = [], handlers = {};
  const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(listener) { ses.before = listener; }, onHeadersReceived() {} } };
  const deps = {
    window: { webContents: { on: (name, handler) => { handlers[name] = handler; }, mainFrame: { frames: [] } } },
    webFrameMain: { fromId: (processId, routingId) => deps.window.webContents.mainFrame.frames.find(f => f.frameTreeNodeId === routingId) || null },
    previewSession, spaces, spaceFor: (value = a.root) => spaces.get(value), sendEvent: event => events.push(event), uiURL,
    previewLog: { documents: [], errors: [] }, previewOrigin: () => a.externalPreview, remember: (list, entry) => list.push(entry), require: desktopRequire,
    appPreview: null
  };
  deps.appPreview = previewSession.installSession(ses, { contexts: () => spaces.values(), onDiagnostic: (ctx, value) => events.push({ type: 'preview.diagnostic', root: ctx.owner.project.root, workspaceRoot: ctx.root, diagnostic: value }) });
  const ids = { a: 11, b: 12 };
  for (const name of frames) {
    const ctx = { a, b }[name], f = frame(ids[name]);
    ses.before({ url: ctx.externalPreview, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: f }, () => {});
    deps.window.webContents.mainFrame.frames.push(frame(ids[name], ctx.externalPreview));
  }
  load([
    cut('function previewAllowed(url)', 'function previewDiagnostic('),
    cut('function previewDiagnostic(ctx, diagnostic) {', 'function configurePreviewSession('),
    cut("window.webContents.on('console-message'", '// Genindlæses forhåndsvisningen i ændringstilstand'),
    cut("window.webContents.on('did-fail-load'", '// ⌘K')
  ], deps);
  return {
    a, b, events, deps,
    fail: (code, url, routingId) => handlers['did-fail-load']({}, code, '', url, false, 1, routingId),
    console: message => handlers['console-message']({ level: 'error', message, frame: { url: uiURL }, sourceId: '', lineNumber: 0 })
  };
}

test('en side, en skjult arbejdsmappes ramme ikke kunne indlæse, meldes for den arbejdsmappe og ikke for den viste', () => {
  const h = setup();
  h.fail(-102, 'http://127.0.0.1:47002/', 12);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, 'preview.failed');
  assert.equal(h.events[0].workspaceRoot, '/kopi', 'brugerfladen viser den kun i arbejdskopiens forhåndsvisning');
  h.fail(-102, 'http://127.0.0.1:47001/', 11);
  assert.equal(h.events[1].workspaceRoot, '/projekt');
});

test('et link i en skjult arbejdsmappes side, som appens frame-src stopper, forklares ikke i den viste', () => {
  const h = setup();
  // Konsolbeskeden står i appens egen konsol og siger ikke, hvilken ramme der blev stoppet.
  h.console(FRAME_SRC);
  assert.deepEqual(h.events.filter(event => event.type === 'preview.diagnostic' && event.workspaceRoot === '/projekt'), [], 'den viste arbejdsmappe får ingen forklaring om et link, den ikke har fulgt');
  // Rammen selv fortæller det: Chromium melder ERR_BLOCKED_BY_CSP (-30) for den stoppede ramme.
  h.fail(-30, 'https://www.borger.dk/', 12);
  const forklaring = h.events.find(event => event.type === 'preview.diagnostic');
  assert.ok(forklaring, 'blokeringen forklares');
  assert.equal(forklaring.workspaceRoot, '/kopi');
  assert.equal(forklaring.diagnostic.kind, 'navigation');
  assert.equal(forklaring.diagnostic.origin, 'https://www.borger.dk');
  assert.equal(forklaring.diagnostic.repair, '', 'et link giver ingen rettelse til AI’en');
});

test('modværn: med kun én forhåndsvisning forklares frame-src-blokeringen stadig fra konsollen, og en ubundet ramme følger den viste', () => {
  const h = setup({ frames: ['a'] });
  h.console(FRAME_SRC);
  const forklaring = h.events.find(event => event.type === 'preview.diagnostic');
  assert.ok(forklaring, 'konsolbeskeden er nok, når der kun er én ramme');
  assert.equal(forklaring.workspaceRoot, '/projekt');
  // En ramme, der aldrig er bundet (ingen id fra Electron), og hvis adresse ingen arbejdsmappe har, meldes som før uden arbejdsmappe,
  // dvs. for den viste. En ubundet ramme, der ikke kunne vise en arbejdsmappes egen adresse, prøves i tests/c1-ubundet-ramme.test.cjs.
  const ubundet = setup({ frames: [] });
  ubundet.deps.window.webContents.mainFrame.frames.push({ url: 'https://www.borger.dk/', parent: { url: uiURL }, frameTreeNodeId: 99 });
  ubundet.fail(-102, 'https://www.borger.dk/', 99);
  assert.deepEqual(ubundet.events, [{ type: 'preview.failed', url: 'https://www.borger.dk/', code: -102 }]);
});

test('modværn: en ramme, hvis arbejdsmappe er lukket, meldes ikke', () => {
  const h = setup();
  h.deps.spaces.delete('/kopi');
  h.fail(-102, 'http://127.0.0.1:47002/', 12);
  h.fail(-30, 'https://www.borger.dk/', 12);
  assert.deepEqual(h.events, []);
});
