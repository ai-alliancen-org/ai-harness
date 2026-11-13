// K3 del b (beta 3): når forhåndsvisningens ramme ikke kan indlæse en side (Electrons did-fail-load), sender hovedprocessen
// hændelsen preview.failed til brugerfladen, så statuslinjen siger det i stedet for at påstå, at siden vises. ui/app.js' side
// prøves i tests/forhaandsvisning-status.test.cjs. Denne prøve kører main.cjs' egen lytter med en falsk webFrameMain.
// Det er ikke målt i Electron, om en navigation, som appens frame-src stopper, også giver did-fail-load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const uiURL = 'harness://app/index.html';

function lytter() {
  const start = source.indexOf("window.webContents.on('did-fail-load'");
  assert.ok(start >= 0, 'main.cjs lytter efter did-fail-load');
  const end = source.indexOf('\n    });', start);
  const handlers = {}, events = [];
  const frames = new Map([['1:2', { url: 'aura-preview://projekt-a/', parent: { url: uiURL } }], ['1:3', { url: 'https://reklame.example/', parent: { url: 'aura-preview://projekt-a/' } }]]);
  const window = { webContents: { on(name, fn) { handlers[name] = fn; } } };
  const webFrameMain = { fromId(processId, routingId) { if (processId === 9) throw new Error('rammen er væk'); return frames.get(`${processId}:${routingId}`) || null; } };
  // Uden appens session er ingen ramme bundet; hændelsen gælder som før den viste forhåndsvisning. Rammer, der er bundet til en
  // arbejdsmappe, prøves i tests/c1-ramme-tilskrivning.test.cjs.
  // Uden arbejdsmapper findes ingen adresse at tilskrive hændelsen ud fra (previewSession.contextForURL giver null).
  const previewSession = require('../core/preview-session.cjs'), spaces = new Map();
  new Function('window', 'webFrameMain', 'uiURL', 'sendEvent', 'appPreview', 'previewSession', 'spaces', source.slice(start, end + '\n    });'.length))(window, webFrameMain, uiURL, event => events.push(event), null, previewSession, spaces);
  return { fail: (...args) => handlers['did-fail-load']({}, ...args), events };
}

test('en side, forhåndsvisningens ramme ikke kunne indlæse, meldes til brugerfladen som preview.failed', () => {
  const { fail, events } = lytter();
  fail(-102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:5173/', false, 1, 2);
  assert.deepEqual(events, [{ type: 'preview.failed', url: 'http://127.0.0.1:5173/', code: -102 }]);
});

test('appens egen side, en afløst indlæsning, en ramme inde i siden og en forsvundet ramme meldes ikke', () => {
  const { fail, events } = lytter();
  fail(-102, 'ERR_CONNECTION_REFUSED', uiURL, true, 1, 1);
  fail(-3, 'ERR_ABORTED', 'http://127.0.0.1:5173/', false, 1, 2);
  fail(-102, 'ERR_CONNECTION_REFUSED', 'https://reklame.example/', false, 1, 3);
  fail(-102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:5173/', false, 9, 9);
  fail(-102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:5173/', false, 4, 4);
  assert.deepEqual(events, []);
});

test('adressen i hændelsen er kortet af', () => {
  const { fail, events } = lytter();
  fail(-6, 'ERR_FILE_NOT_FOUND', 'aura-preview://projekt-a/' + 'a'.repeat(400), false, 1, 2);
  assert.equal(events[0].url.length, 300);
});
