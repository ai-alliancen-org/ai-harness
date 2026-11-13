// Spor P (beta 3): en binær fil eller en fil i et ældre tekstformat (ikke UTF-8), som en opgave ændrede, står under Ændringer
// uden linje-diff (tests/p-aendringer-tekstformat.test.cjs). Brugerfladen skal sige hvorfor, og at Fortryd lader filen være, og
// gennemgangen før «Fortryd opgaven» skal nævne filen, så brugeren ikke tror, at hele opgaven er sat tilbage.
// Kører de ordrette ui/workspace.js og ui/history.js i små DOM-attrapper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeElement, elements, desktop } = require('./c1-dom.cjs');

const row = { file: 'public/index.html', change: 'ændret', added: 0, removed: 0, by: 'ai', binary: true, opaque: true, secret: false };
function workspace() {
  const dom = elements();
  const task = { id: 'opgave-1', kind: 'ai', label: 'Konvertér siden', status: 'idle', startedAt: 1, files: [row], totals: { files: 1, added: 0, removed: 0, ai: 1, mixed: 0, others: 0, user: 0 }, skipped: 1 };
  const answers = { changesOverview: { running: false, tasks: [task], session: null }, changesFile: { ...row, hunks: [] } };
  const context = vm.createContext({
    $: dom.$, node: dom.node, option: (value, text) => Object.assign(new FakeElement('option', text), { value }), console,
    action: fn => fn(), call: async method => answers[method] ?? null, message: () => {}, current: { root: '/projekt', workspaceRoot: '/projekt' }, running: false,
    updateWorkMode: () => {}, viewFor: () => ({ id: 'samtale' }), elapsedText: () => '', versionTime: () => '', shortLabel: text => text,
    requestAnimationFrame: callback => callback(), setInterval: () => 0, clearInterval: () => {}, CSS: { escape: value => value }, NodeFilter: {},
    localStorage: { getItem: () => null, setItem: () => {} }, ResizeObserver: class { observe() {} disconnect() {} },
    document: { body: new FakeElement('body'), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createTextNode: text => text },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), harness: { onEvent() {} } }
  });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/workspace.js'), 'utf8'), context, { filename: 'ui/workspace.js' });
  return { ...dom, workspace: context.window.workspace };
}

test('Ændringer forklarer, hvorfor filen ikke har linje-diff, og at Fortryd lader den være', async () => {
  const ui = workspace();
  await ui.workspace.showChange('opgave-1', 'public/index.html');
  const note = ui.$('#changes-diff-note').textContent;
  assert.match(note, /ældre tekstformat \(ikke UTF-8\)/);
  assert.match(note, /Fortryd sætter den ikke tilbage/);
  assert.doesNotMatch(note, /Filen er binær, så den har ingen linje-diff/, 'ikke den gamle tekst om billeder og skrifter');
  assert.match(ui.$('#changes-skipped').textContent, /ældre tekstformat/, 'den samlede note om udeladte filer nævner også formatet');
});

// ui/history.js: gennemgangen før «Fortryd opgaven», som tests/fortryd-kvittering.test.cjs kører den.
class Element {
  constructor(tag = 'div', text = '', className = '') { this.tagName = tag; this.value = ''; this.children = []; this.listeners = {}; this.className = className || ''; this.hidden = false; this.text = text || ''; this.dataset = {}; this.attributes = {}; this.classList = { add: name => { this.className += ' ' + name; }, contains: name => this.className.split(' ').includes(name), toggle() {} }; }
  get textContent() { return this.text + this.children.map(item => typeof item === 'string' ? item : item.textContent).join(''); }
  set textContent(value) { this.text = value; this.replaceChildren(); }
  get parentElement() { return this.parentNode; }
  get lastChild() { return this.children.at(-1); }
  append(...items) { for (const item of items) { if (typeof item !== 'string') item.parentNode = this; this.children.push(item); } }
  replaceChildren(...items) { for (const item of this.children) if (typeof item !== 'string') item.parentNode = null; this.children = []; this.append(...items); }
  before(item) { if (this.parentNode) { item.parentNode = this.parentNode; this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, item); } }
  querySelectorAll(selector) { return this.children.filter(item => typeof item !== 'string').flatMap(item => [...(item.tagName === selector ? [item] : []), ...item.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  scrollIntoView() {}
}
function history(kept) {
  const elements = new Map(), dialog = new Element('dialog'); elements.set('#restore-dialog', dialog);
  const $ = selector => { if (!elements.has(selector)) { const item = new Element(); elements.set(selector, item); if (selector.startsWith('#restore-')) dialog.append(item); } return elements.get(selector); };
  const inputs = new Map();
  const document = { querySelector(selector) { if (!inputs.has(selector)) { const input = new Element('input'); input.value = 'ours'; const parent = new Element('label'); parent.append(input, new Element('span')); inputs.set(selector, input); } return inputs.get(selector); }, createTextNode: text => text };
  const view = { id: 'chat', root: '/projekt', review: new Element('section'), log: new Element(), lastSentText: 'Konvertér siden', followChat: false, historyPending: [] };
  const call = async method => method === 'restoreReview' ? { token: 'token', kind: 'task', files: [{ file: 'public/om.html', action: 'Ændres', before: 'efter', after: 'før' }], ...(kept ? { kept } : {}) } : null;
  const context = { $, document, node: (tag, text, classes) => new Element(tag, text, classes), view, current: { root: '/projekt' }, projectLoading: false, call, selectedOwner: () => ({ root: '/projekt', chat: 'chat' }), action: fn => fn(), versionTime: () => '', shortLabel: value => value, featureOn: () => true, info: () => new Element(), requestAnimationFrame: fn => fn(), message: () => {}, displayProject: async () => {}, showChat: async () => {}, refreshRecent: async () => {} };
  context.viewFor = () => view;
  context.window = { harness: { onEvent() {} }, workspace: { showChange: async () => {}, show() {} }, previewServer: { refresh() {} }, previewViewSize: () => null };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/history.js'), 'utf8'), context);
  return { context, $ };
}

test('gennemgangen før Fortryd opgaven nævner filen, der ikke sættes tilbage', async () => {
  const env = history(['public/index.html']);
  await env.context.window.reviewRestoration({ task: 'opgave-1' }, { taskUndo: true, taskID: 'opgave-1', title: 'Fortryd opgaven' });
  const summary = env.$('#restore-summary').textContent;
  assert.match(summary, /^1 fil sættes tilbage\./);
  assert.match(summary, /public\/index\.html sættes ikke tilbage, fordi filen er binær eller gemt i et ældre tekstformat \(ikke UTF-8\)\. Brug Versioner/);
  const uden = history(null);
  await uden.context.window.reviewRestoration({ task: 'opgave-1' }, { taskUndo: true, taskID: 'opgave-1', title: 'Fortryd opgaven' });
  assert.doesNotMatch(uden.$('#restore-summary').textContent, /sættes ikke tilbage/, 'modværn: uden sådan en fil står der intet');
});
