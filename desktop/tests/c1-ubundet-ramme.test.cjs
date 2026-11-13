// Fund N:B2-3 (beta 3), sikkerhedsnettet: hovedprocessen tilskriver en fejlet indlæsning til rammens arbejdsmappe ud fra bindingen
// (tests/c1-ramme-tilskrivning.test.cjs). Er rammen ikke bundet, fx fordi Electron ikke gav rammens id ved første navigation, tilskrives
// hændelsen den arbejdsmappe, hvis egen adresse rammen ikke kunne vise. En skjult arbejdsmappes side markeres så ikke i den viste med
// «Andre websteder åbnes ikke her». Kun en adresse, ingen arbejdsmappe har, meldes som før for den viste.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { desktopRequire, cut, load } = require('./c1-main-kilde.cjs');
const previewSession = desktopRequire('./core/preview-session.cjs');

const uiURL = 'harness://app/index.html';
function setup() {
  const owner = { project: { root: '/projekt' } };
  const a = { root: '/projekt', owner, key: 'projekt-a' }; a.preview = previewSession.staticPreview(a);
  const b = { root: '/kopi', owner, key: 'kopi-b' }; b.preview = previewSession.staticPreview(b);
  const spaces = new Map([[a.root, a], [b.root, b]]), events = [], handlers = {}, frames = [];
  const deps = {
    window: { webContents: { on: (name, handler) => { handlers[name] = handler; }, mainFrame: { frames } } },
    webFrameMain: { fromId: (_processId, routingId) => frames.find(f => f.frameTreeNodeId === routingId) || null },
    previewSession, spaces, spaceFor: (value = b.root) => spaces.get(value), sendEvent: event => events.push(event), uiURL,
    previewLog: { documents: [], errors: [] }, previewOrigin: () => b.preview.url, remember: (list, entry) => list.push(entry), require: desktopRequire,
    // Ingen ramme er bundet: appens session kender dem ikke.
    appPreview: { contextForFrame: () => undefined }
  };
  load([cut('function previewDiagnostic(ctx, diagnostic) {', 'function configurePreviewSession('), cut("window.webContents.on('did-fail-load'", '// ⌘K')], deps);
  return { a, b, events, frames, fail: (code, url, routingId) => handlers['did-fail-load']({}, code, '', url, false, 1, routingId) };
}

test('en ubundet ramme, der ikke kunne vise en skjult arbejdsmappes side, meldes for den arbejdsmappe', () => {
  const h = setup();
  h.frames.push({ frameTreeNodeId: 21, url: 'aura-preview://projekt-a/side.html', parent: { url: uiURL } });
  h.fail(-6, 'aura-preview://projekt-a/side.html', 21);
  assert.deepEqual(h.events, [{ type: 'preview.failed', url: 'aura-preview://projekt-a/side.html', code: -6, root: '/projekt', workspaceRoot: '/projekt' }]);
});

test('modværn: en adresse, ingen arbejdsmappe har, meldes som før uden arbejdsmappe, og et link giver ingen forklaring herfra', () => {
  const h = setup();
  h.frames.push({ frameTreeNodeId: 22, url: 'https://www.borger.dk/', parent: { url: uiURL } });
  h.fail(-30, 'https://www.borger.dk/', 22);
  assert.deepEqual(h.events, [{ type: 'preview.failed', url: 'https://www.borger.dk/', code: -30 }]);
});
