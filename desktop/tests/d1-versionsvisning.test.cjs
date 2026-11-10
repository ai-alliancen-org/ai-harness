// Versionsvisningen under Ændringer › Versioner følger projektet efter «Fortryd opgaven», en gendannelse og en ny
// automatisk version, og Gem version nævner de filer, der ikke blev gemt, også når intet blev gemt (R#6, R#26 og den
// skjulte fejl i test-conversation-progress og test-recovery). Kører den faktiske ui/history.js i en lille DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div', text = '', className = '') { this.tagName = tag; this.value = ''; this.children = []; this.listeners = {}; this.className = className || ''; this.hidden = false; this.text = text || ''; this.dataset = {}; this.attributes = {}; this.classList = { add: name => { this.className += ' ' + name; }, remove: name => { this.className = this.className.split(' ').filter(n => n !== name).join(' '); }, contains: name => this.className.split(' ').includes(name), toggle: (name, on) => { this.className = this.className.split(' ').filter(n => n !== name).concat(on ? [name] : []).join(' '); } }; }
  get textContent() { return this.text + this.children.map(item => typeof item === 'string' ? item : item.textContent).join(''); }
  set textContent(value) { this.text = value; this.replaceChildren(); }
  get parentElement() { return this.parentNode; }
  get lastChild() { return this.children.at(-1); }
  append(...items) { for (const item of items) { if (typeof item !== 'string') item.parentNode = this; this.children.push(item); } }
  replaceChildren(...items) { for (const item of this.children) if (typeof item !== 'string') item.parentNode = null; this.children = []; this.append(...items); }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null; } }
  before(item) { if (this.parentNode) { item.parentNode = this.parentNode; this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, item); } }
  querySelectorAll(selector) { return this.children.filter(item => typeof item !== 'string').flatMap(item => [...(selector.startsWith('.') ? item.className.split(' ').includes(selector.slice(1)) : item.tagName === selector) ? [item] : [], ...item.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  showModal() { this.open = true; }
  close() { this.open = false; for (const fn of this.listeners.close || []) fn(); }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

const historySource = fs.readFileSync(path.join(__dirname, '../ui/history.js'), 'utf8');
const first = { commit: 'c1', name: 'Projektet blev oprettet', kindLabel: 'Start', at: 1, message: 'Projekt oprettet' };
// Projektets tilstand, som hovedprocessen svarer. «Fortryd opgaven» sætter filen tilbage og gemmer med automatiske versioner.
function environment({ changes = 0, auto = false, history = [first], save = null, review = { token: 'gennemgang', files: [] } } = {}) {
  const state = { changes, auto, history: [...history], save };
  const elements = new Map(), dialog = new Element('dialog'); elements.set('#restore-dialog', dialog);
  const $ = selector => {
    if (!elements.has(selector)) { const item = new Element(); elements.set(selector, item); if (selector.startsWith('#restore-')) dialog.append(item); }
    return elements.get(selector);
  };
  const inputs = new Map();
  const document = { querySelector(selector) { if (!inputs.has(selector)) { const input = new Element('input'); input.value = 'ours'; const parent = new Element('label'); parent.append(input, new Element('span')); inputs.set(selector, input); } return inputs.get(selector); }, querySelectorAll: () => [], createTextNode: text => text };
  const view = { id: 'chat', root: '/projekt', review: new Element('section'), log: new Element(), lastSentText: 'Byg første udkast', followChat: false };
  const call = async (method, input) => {
    if (method === 'gitStatus') return { initialized: true, history: state.history, changes: state.changes, busy: false, block: '', autoCheckpoint: state.auto, identity: { name: 'Prøve', email: 'proeve@example.invalid' }, branch: 'main', restoration: null };
    if (method === 'historyVersion') { const item = state.history.find(entry => entry.commit === input) || first; return { ...item, files: [], images: null, parent: item.commit === 'c1' ? null : 'c1' }; }
    if (method === 'restoreReview') return { token: 'token', kind: 'task', git: true, files: [{ file: 'public/index.html', action: 'Ændres', before: '<h1>Ny</h1>', after: '<h1>Før</h1>' }] };
    if (method === 'restoreVersion') {
      state.changes = 0;
      if (state.auto) state.history.unshift({ commit: 'c2', name: 'Fortrudt »Byg første udkast«', kindLabel: 'Fortrudt', at: 2, message: 'Fortrudt: Byg første udkast' });
      return { restored: { files: 1 }, error: null, saved: state.auto ? { head: 'c2' } : null, savedFirst: null, project: null, state: { chat: 'chat' } };
    }
    if (method === 'gitSave') return state.save;
    if (method === 'gitReview') return review;
    if (method === 'historyImage') return null;
    throw Error('Uventet kald: ' + method);
  };
  const context = { $, document, node: (tag, text, classes) => new Element(tag, text, classes), view, current: { root: '/projekt' }, projectLoading: false, call, selectedOwner: () => ({ root: '/projekt', chat: 'chat' }), action: fn => fn(), versionTime: () => '', shortLabel: value => value, featureOn: () => true, info: () => new Element(), requestAnimationFrame: fn => fn(), message: () => {}, displayProject: async () => {}, showChat: async () => {}, refreshRecent: async () => {}, setTimeout, clearTimeout };
  context.viewFor = () => view;
  // workspace.js: en åben version skjuler listen (#versions-view) og viser detaljen (#version-detail).
  context.window = { harness: { onEvent() {} }, workspace: { showChange: async () => {}, show() {}, showVersions() { $('#versions-view').hidden = false; $('#version-detail').hidden = true; }, showVersion() { $('#versions-view').hidden = true; $('#version-detail').hidden = false; } }, previewViewSize: () => null };
  $('#versions-view').hidden = true; $('#version-detail').hidden = true;
  vm.createContext(context); vm.runInContext(historySource, context);
  return { context, $, state, view };
}
async function undoTask({ context, $ }) {
  await context.window.reviewRestoration({ task: 'opgave' }, { title: 'Fortryd opgaven', confirm: 'Fortryd opgaven', label: 'Fortrudt: Byg første udkast', taskUndo: true, taskID: 'opgave' });
  await $('#restore-confirm').onclick();
}

test('en åben version opdateres efter Fortryd opgaven, så Gå tilbage hertil ikke står på den nuværende version', async () => {
  const env = environment({ changes: 1 });
  env.context.window.workspace.showVersions(); await env.context.window.versions.load();
  await env.context.window.versions.open('c1');
  assert.equal(env.$('#version-restore').hidden, false, 'før fortrydelsen er der en ugemt ændring at gå tilbage fra');
  await undoTask(env);
  assert.match(env.view.review.textContent, /Opgaven er fortrudt/);
  assert.equal(env.$('#version-restore').hidden, true, 'versionen svarer nu til filerne');
});

test('listen over versioner opdateres efter en gendannelse, også uden nye billeder', async () => {
  const env = environment({ changes: 1, auto: true });
  env.context.window.workspace.showVersions(); await env.context.window.versions.load();
  assert.equal(env.$('#git-history').children.length, 1);
  await undoTask(env);
  assert.equal(env.$('#git-history').children.length, 2, 'den nye version står i listen');
  assert.match(env.$('#git-history').children[0].textContent, /Fortrudt/);
});

test('en åben version følger en ny automatisk version', async () => {
  const env = environment();
  env.context.window.workspace.showVersions(); await env.context.window.versions.load();
  await env.context.window.versions.open('c1');
  assert.equal(env.$('#version-restore').hidden, true, 'den nyeste version uden ændringer');
  env.state.history.unshift({ commit: 'c2', name: 'AI-opgave', kindLabel: 'AI-opgave', at: 2, message: 'AI-opgave: Byg' });
  await env.context.window.versions.refreshStatus();
  assert.equal(env.$('#version-restore').hidden, false, 'versionen er ikke længere den nyeste');
});

test('Gem version nævner de filer, der ikke blev gemt, også når intet blev gemt', async () => {
  const env = environment({ changes: 1, save: { saved: 0, kept: ['public/style.css'] } });
  env.context.window.workspace.showVersions(); await env.context.window.versions.load();
  env.$('#git-quick').onsubmit({ preventDefault() {} });
  // Formularen venter ikke selv på gemningen; vent, til svaret står der.
  for (let i = 0; i < 50 && !env.$('#git-feedback').textContent; i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(env.$('#git-feedback').textContent, /public\/style\.css/);
  assert.doesNotMatch(env.$('#git-feedback').textContent, /ingen ændringer at gemme/);
});

// Q:D1-4: en fil, hvis gemte version kan rumme en hemmelighed, kan gemmes. Under Avanceret vises kun den nye tekst og grunden til, at
// teksten fra før ikke vises; aldrig «(ny fil)», som om filen var ny.
test('Gem version under Avanceret viser grunden, når teksten fra før ikke vises, og filen kan vælges', async () => {
  const hidden = 'Teksten fra før vises ikke, fordi den gemte version kan indeholde en nøgle eller adgangskode. Den nye version er kontrolleret og kan gemmes.';
  const env = environment({ changes: 2, review: { token: 'gennemgang', files: [
    { file: 'public/app.js', status: ' M', text: 'const token = process.env.TOKEN;', before: null, beforeHidden: hidden },
    { file: 'public/index.html', status: ' M', text: '<h1>Ny</h1>', before: '<h1>Gammel</h1>' }
  ] } });
  env.$('#git-advanced').open = true;
  env.context.window.workspace.showVersions(); await env.context.window.versions.load();
  const [app, index] = env.$('#git-files').children;
  assert.match(app.textContent, /Teksten fra før vises ikke, fordi den gemte version kan indeholde en nøgle eller adgangskode/);
  assert.match(app.textContent, /process\.env\.TOKEN/);
  assert.doesNotMatch(app.textContent, /Før|\(ny fil\)/);
  assert.equal(app.querySelector('input').disabled, false, 'filen kan vælges');
  // En almindelig fil viser stadig før og efter.
  assert.match(index.textContent, /Før[\s\S]*Gammel[\s\S]*Efter[\s\S]*Ny/);
});
