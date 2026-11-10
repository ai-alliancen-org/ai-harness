// Q:C2-5 del b: efter «Fortryd opgaven» erstattes resultatkortet af kvitteringen «… Gennemse forhåndsvisningen …». Den
// havde ingen knap, og «Afprøv resultatet» forsvandt med det gamle kort, så brugeren selv skulle finde forhåndsvisningen.
// Nu har kvitteringen knappen «Gennemse forhåndsvisningen», som gør det samme som «Afprøv resultatet».
// Prøven kører den ordrette ui/history.js og udsnittet af ui/app.js i en lille DOM, som tests/result-dialog.test.cjs gør.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  close() { this.open = false; for (const fn of this.listeners.close || []) fn(); }
  focus() { this.focused = true; }
  scrollIntoView() {}
}
function environment({ previewURL = 'aura-preview://projekt/' } = {}) {
  const elements = new Map(), dialog = new Element('dialog'); elements.set('#restore-dialog', dialog);
  const $ = selector => { if (!elements.has(selector)) { const item = new Element(); elements.set(selector, item); if (selector.startsWith('#restore-')) dialog.append(item); } return elements.get(selector); };
  const inputs = new Map();
  const document = { querySelector(selector) { if (!inputs.has(selector)) { const input = new Element('input'); input.value = 'ours'; const parent = new Element('label'); parent.append(input, new Element('span')); inputs.set(selector, input); } return inputs.get(selector); }, createTextNode: text => text };
  const view = { id: 'chat', root: '/projekt', review: new Element('section'), log: new Element(), lastSentText: 'Byg siden', followChat: false, historyPending: [] };
  const shown = [];
  const call = async method => method === 'restoreReview' ? { token: 'token', kind: 'task', files: [{ file: 'public/index.html', action: 'Ændres', before: 'efter', after: 'før' }] } : { restored: { files: 1 }, saved: false };
  const context = { $, document, node: (tag, text, classes) => new Element(tag, text, classes), view, current: { root: '/projekt', previewURL }, projectLoading: false, call, selectedOwner: () => ({ root: '/projekt', chat: 'chat' }), action: fn => fn(), versionTime: () => '', shortLabel: value => value, featureOn: () => true, info: () => new Element(), requestAnimationFrame: fn => fn(), message: () => {}, displayProject: async () => {}, showChat: async () => {}, refreshRecent: async () => {} };
  context.viewFor = () => view;
  context.window = { harness: { onEvent() {} }, workspace: { showChange: async () => {}, show: (name, options) => shown.push([name, options]) }, previewServer: { refresh() { shown.push(['refresh']); } }, previewViewSize: () => null, ApprovalView: require('../ui/approval-view.js') };
  vm.createContext(context);
  const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('function updatePlanOffer('), app.indexOf('let localDiscoveryGeneration')), context);
  // Kontrollen af forhåndsvisningen efter opgaven hører ikke til denne prøve.
  context.checkPreview = () => {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui/history.js'), 'utf8'), context);
  return { context, $, view, dialog, shown };
}
const render = env => env.context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/index.html'] }, env.view);
async function undo(env) {
  render(env);
  await env.context.window.reviewRestoration({ task: 'opgave' }, { taskUndo: true, taskID: 'opgave', title: 'Fortryd opgaven' });
  await env.$('#restore-confirm').onclick();
}
const buttons = view => view.review.querySelectorAll('button').map(button => button.textContent);
// Kaldene sker inde i prøvens DOM; de sammenlignes som almindelige data.
const plain = value => JSON.parse(JSON.stringify(value));

test('kvitteringen efter Fortryd opgaven har knappen til forhåndsvisningen', async () => {
  const env = environment();
  render(env);
  assert.ok(buttons(env.view).includes('Afprøv resultatet'), 'forudsætning: resultatkortet havde Afprøv resultatet');
  await undo(env);
  assert.match(env.view.review.textContent, /^Opgaven er fortrudt/);
  assert.match(env.view.review.textContent, /Gennemse forhåndsvisningen/);
  assert.deepEqual(buttons(env.view), ['Gennemse forhåndsvisningen'], 'kvitteringen har én knap, og den gør det, teksten beder om');
  env.view.review.querySelector('button').onclick();
  assert.deepEqual(plain(env.shown), [['preview', { focus: true }]], 'forhåndsvisningen vises');
});

test('uden forhåndsvisning åbner knappen valget af forhåndsvisning, som Afprøv resultatet gør', async () => {
  const env = environment({ previewURL: '' });
  await undo(env);
  env.view.review.querySelector('button').onclick();
  assert.equal(env.$('#preview-dialog').open, true);
  assert.deepEqual(plain(env.shown.map(([name]) => name)), ['preview', 'refresh']);
});

test('har brugeren skiftet samtale, gør knappen ingenting i den nye', async () => {
  const env = environment();
  await undo(env);
  env.context.view = { id: 'anden', review: new Element('section') };
  env.view.review.querySelector('button').onclick();
  assert.deepEqual(plain(env.shown), []);
});

// Skeptikerens fund: kvitteringen efter indfletning af en kopi beder om «Prøv resultatet i forhåndsvisningen.», men havde ingen
// knap til det. Samme hul, som Q:C2-5 (b) lukkede for Fortryd og gendannelse.
async function merge(env) {
  env.context.call = async method => method === 'chatMergeReview'
    ? { token: 'token', kind: 'merge', files: [{ file: 'public/index.html', action: 'Ændres', before: 'før', after: 'efter' }] }
    : { restored: { files: 1, id: 'gendannelse-1' }, saved: false, task: 'opgave' };
  await env.context.window.reviewRestoration({ merge: true, chat: 'chat' }, { title: 'Flet kopien ind', confirm: 'Flet ind' });
  await env.$('#restore-confirm').onclick();
}
test('kvitteringen efter indfletning har knappen til forhåndsvisningen først', async () => {
  const env = environment();
  await merge(env);
  assert.match(env.view.review.textContent, /^Kopiens ændringer er flettet ind/);
  assert.match(env.view.review.textContent, /Prøv resultatet i forhåndsvisningen/);
  assert.deepEqual(buttons(env.view), ['Afprøv resultatet', 'Se ændringerne', 'Fortryd indfletningen']);
  const preview = env.view.review.querySelectorAll('button')[0];
  assert.ok(preview.classList.contains('primary'), 'knappen er hovedvalget');
  preview.onclick();
  assert.deepEqual(plain(env.shown), [['preview', { focus: true }]], 'forhåndsvisningen vises');
});
test('efter indfletning i en anden samtale gør knappen ingenting', async () => {
  const env = environment();
  await merge(env);
  env.context.view = { id: 'anden', review: new Element('section') };
  env.view.review.querySelectorAll('button')[0].onclick();
  assert.deepEqual(plain(env.shown), []);
});
