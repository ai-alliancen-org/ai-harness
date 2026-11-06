// Fund 21: nøglevinduet må ikke lukkes, mens en gemning er i gang, og ender det alligevel, får hovedvinduet kvitteringen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { KeyWindow, PAGE } = require('../core/key-window.cjs');

function harness() {
  const handlers = new Map(), windows = [];
  class Win {
    constructor() { this.events = new Map(); this.destroyed = false; this.webContents = { mainFrame: { url: PAGE }, on: (e, fn) => { this.events.set('wc:' + e, fn); }, setWindowOpenHandler() {} }; windows.push(this); }
    on(e, fn) { this.events.set(e, fn); return this; }
    once(e, fn) { this.events.set(e, fn); return this; }
    isDestroyed() { return this.destroyed; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.events.get('closed')?.(); }
    removeMenu() {} setContentProtection() {} show() {} loadURL() { return Promise.resolve(); }
  }
  const session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} }, protocol: { handle() {} } };
  const electron = { session: { fromPartition: () => session }, ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, BrowserWindow: Win };
  const keyWindow = new KeyWindow({ electron, uiDir: path.join(__dirname, '..', 'ui'), preload: '/p.cjs', parent: () => ({ isDestroyed: () => false }), background: () => '#fff', title: 't', openAccount() {} });
  const win = () => windows.at(-1);
  const page = () => ({ sender: win().webContents, senderFrame: win().webContents.mainFrame });
  return { keyWindow, win, call: (c, v) => handlers.get(c)(page(), v) };
}
function slow() {
  let release; const gate = new Promise(r => { release = r; });
  return { release, purpose: { kind: 'openai', context: { heading: 'x' }, async submit() { await gate; return { receipt: { id: 'forbindelse-1', state: 'ny' } }; } } };
}

test('S4-21: vinduet kan ikke lukkes, mens en gemning er i gang', async () => {
  const h = harness(), s = slow();
  const done = h.keyWindow.open(s.purpose);
  const submitting = h.call('key-window:submit', 'nøgle');
  let prevented = false;
  h.win().events.get('close')?.({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'luk skal standses under gemning');
  await h.call('key-window:cancel');
  assert.equal(h.win().destroyed, false, 'Annullér må ikke lukke vinduet under gemning');
  s.release();
  assert.deepEqual(await submitting, { done: true });
  assert.deepEqual(await done, { id: 'forbindelse-1', state: 'ny' });
});

test('S4-21: lukkes vinduet alligevel under gemning, får hovedvinduet kvitteringen i stedet for null', async () => {
  const h = harness(), s = slow();
  const done = h.keyWindow.open(s.purpose);
  const submitting = h.call('key-window:submit', 'nøgle');
  h.win().events.get('wc:render-process-gone')();
  s.release(); await submitting;
  assert.deepEqual(await done, { id: 'forbindelse-1', state: 'ny' });
});

test('S4-21: uden gemning i gang annullerer og lukker Annullér som før', async () => {
  const h = harness();
  const done = h.keyWindow.open({ kind: 'openai', context: { heading: 'x' }, async submit() { return {}; } });
  await h.call('key-window:cancel');
  assert.equal(await done, null);
  assert.equal(h.win().destroyed, true);
});
