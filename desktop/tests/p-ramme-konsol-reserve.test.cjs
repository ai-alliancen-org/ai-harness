// Spor P (beta 3): efter blot ét projektskift har flere arbejdsmapper en bundet ramme i appen (previewFrames i ui/app.js lever videre
// pr. rod). Så siger appens frame-src-besked i konsollen ikke, hvilken ramme der blev stoppet, og forklaringen afhang alene af, at
// Electron melder did-fail-load med -30 for rammen. Det er ikke observeret i Electron. Nu forklares blokeringen kort efter i den
// viste arbejdsmappe, hvis ingen -30 for samme adresse er kommet: de skjulte rammer er inert, så et klik på et link kan kun ske i den
// viste. Kommer -30, afgør den det som før (K3), og der kommer ingen ekstra forklaring.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { desktopRequire, cut, load } = require('./c1-main-kilde.cjs');
const previewSession = desktopRequire('./core/preview-session.cjs');

const uiURL = 'harness://app/index.html';
const FRAME_SRC = "Framing 'https://www.borger.dk/' violates the following Content Security Policy directive: \"frame-src aura-preview: http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*\". The request has been blocked.";
const frame = (frameTreeNodeId, url = 'about:blank') => ({ frameTreeNodeId, url, parent: { url: uiURL } });

// Tre arbejdsmapper i samme projekt: A vises; B og C er skjulte. Rammerne i `frames` er bundet ved appens første navigation.
function setup(t, { frames = ['a', 'b'], shown = 'a' } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const owner = { project: { root: '/projekt' } };
  const a = { root: '/projekt', owner, key: 'projekt-a', externalPreview: 'http://127.0.0.1:47001/' };
  const b = { root: '/kopi', owner, key: 'kopi-b', externalPreview: 'http://127.0.0.1:47002/' };
  const c = { root: '/kopi-2', owner, key: 'kopi-c', externalPreview: 'http://127.0.0.1:47003/' };
  const all = { a, b, c }, spaces = new Map([[a.root, a], [b.root, b], [c.root, c]]), events = [], handlers = {};
  const ses = { protocol: { handle() {} }, webRequest: { onBeforeRequest(listener) { ses.before = listener; }, onHeadersReceived() {} } };
  const deps = {
    window: { webContents: { on: (name, handler) => { handlers[name] = handler; }, mainFrame: { frames: [] } } },
    webFrameMain: { fromId: (processId, routingId) => deps.window.webContents.mainFrame.frames.find(f => f.frameTreeNodeId === routingId) || null },
    previewSession, spaces, spaceFor: (value = all[shown].root) => spaces.get(value), sendEvent: event => events.push(event), uiURL,
    previewLog: { documents: [], errors: [] }, previewOrigin: () => all[shown].externalPreview, remember: (list, entry) => list.push(entry), require: desktopRequire,
    appPreview: null
  };
  deps.appPreview = previewSession.installSession(ses, { contexts: () => spaces.values(), onDiagnostic: () => {} });
  const ids = { a: 11, b: 12, c: 13 };
  for (const name of frames) {
    const ctx = all[name], f = frame(ids[name]);
    ses.before({ url: ctx.externalPreview, resourceType: 'subFrame', initiatorOrigin: 'harness://app', frame: f }, () => {});
    deps.window.webContents.mainFrame.frames.push(frame(ids[name], ctx.externalPreview));
  }
  load([
    cut('function previewAllowed(url)', 'function previewDiagnostic('),
    cut('function previewDiagnostic(ctx, diagnostic) {', 'function configurePreviewSession('),
    cut("window.webContents.on('console-message'", '// Genindlæses forhåndsvisningen i ændringstilstand'),
    cut("window.webContents.on('did-fail-load'", '// ⌘K')
  ], deps);
  const forklaringer = () => events.filter(event => event.type === 'preview.diagnostic').map(event => event.workspaceRoot);
  return {
    events, forklaringer, tick: ms => t.mock.timers.tick(ms),
    fail: (code, url, routingId) => handlers['did-fail-load']({}, code, '', url, false, 1, routingId),
    console: message => handlers['console-message']({ level: 'error', message, frame: { url: uiURL }, sourceId: '', lineNumber: 0 })
  };
}

test('med flere bundne rammer forklares et stoppet link i den viste arbejdsmappe, når Electron ikke melder -30', t => {
  const h = setup(t);
  h.console(FRAME_SRC);
  assert.deepEqual(h.forklaringer(), [], 'ikke straks: en -30 fra rammen selv kan stadig komme');
  h.tick(2000);
  assert.deepEqual(h.forklaringer(), ['/projekt'], 'rammen står ikke tom uden forklaring');
  const forklaring = h.events.find(event => event.type === 'preview.diagnostic');
  assert.equal(forklaring.diagnostic.kind, 'navigation');
  assert.equal(forklaring.diagnostic.origin, 'https://www.borger.dk');
});

test('modværn: melder Electron -30 for en skjult arbejdsmappes ramme, forklares det kun dér (K3)', t => {
  const h = setup(t);
  h.console(FRAME_SRC);
  h.tick(100);
  h.fail(-30, 'https://www.borger.dk/', 12);
  h.tick(5000);
  assert.deepEqual(h.forklaringer(), ['/kopi']);
});

test('modværn: kom -30 før konsolbeskeden, forklares blokeringen kun én gang', t => {
  const h = setup(t);
  h.fail(-30, 'https://www.borger.dk/', 11);
  h.tick(10);
  h.console(FRAME_SRC);
  h.tick(5000);
  assert.deepEqual(h.forklaringer(), ['/projekt']);
});

test('modværn: har den viste arbejdsmappe ingen bundet ramme, forklares en skjult rammes blokering ikke i den viste', t => {
  const h = setup(t, { frames: ['b', 'c'], shown: 'a' });
  h.console(FRAME_SRC);
  h.tick(5000);
  assert.deepEqual(h.forklaringer(), []);
});
