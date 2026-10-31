// Afprøver de faktiske UI-funktioner med en lille DOM, uden Electron, modelkald
// eller appdata. Filgendannelse er en kontrolleret IPC-grænse i disse prøver.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div', text = '', className = '') { this.tagName = tag; this.value = ''; this.children = []; this.listeners = {}; this.className = className; this.hidden = false; this.text = text || ''; this.dataset = {}; this.attributes = {}; this.classList = { add: name => { this.className += ' ' + name; }, contains: name => this.className.split(' ').includes(name), toggle: (name, on) => { this.className = this.className.split(' ').filter(n => n !== name).concat(on ? [name] : []).join(' '); } }; }
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
function environment(call) {
  const elements = new Map(), dialog = new Element('dialog'); elements.set('#restore-dialog', dialog);
  const $ = selector => {
    if (!elements.has(selector)) { const item = new Element(); elements.set(selector, item); if (selector.startsWith('#restore-')) dialog.append(item); }
    return elements.get(selector);
  };
  const inputs = new Map();
  const document = { querySelector(selector) { if (!inputs.has(selector)) { const input = new Element('input'); input.value = 'ours'; const parent = new Element('label'); parent.append(input, new Element('span')); inputs.set(selector, input); } return inputs.get(selector); }, createTextNode: text => text };
  const view = { id: 'chat', root: '/projekt', review: new Element('section'), log: new Element(), lastSentText: 'Byg siden', followChat: false };
  const context = { $, document, node: (tag, text, classes) => new Element(tag, text, classes), view, current: { root: '/projekt' }, projectLoading: false, call, selectedOwner: () => ({ root: '/projekt', chat: 'chat' }), action: fn => fn(), versionTime: () => '', shortLabel: value => value, featureOn: () => true, info: () => new Element(), requestAnimationFrame: fn => fn(), message: () => {}, displayProject: async () => {}, showChat: async () => {}, refreshRecent: async () => {} };
  context.viewFor = () => view;
  context.window = { harness: { onEvent() {} }, workspace: { showChange: async () => {}, show() {} }, previewViewSize: () => null, ApprovalView: require('../ui/approval-view.js') };
  vm.createContext(context); return { context, $, view, dialog };
}
const historySource = fs.readFileSync(path.join(__dirname, '../ui/history.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
function resultUI(context) {
  vm.runInContext(appSource.slice(appSource.indexOf('function updatePlanOffer('), appSource.indexOf('let localDiscoveryGeneration')), context);
}

test('afvist gennemgang afslutter Henter, bevarer Annuller og kan forsøges igen', async () => {
  let calls = 0;
  const { context, $, dialog } = environment(async () => { calls++; throw Error('Vent på opgaven i projektet.'); });
  vm.runInContext(historySource, context);
  await context.window.reviewRestoration({ task: 'opgave' }, { title: 'Fortryd opgaven' });
  assert.equal(dialog.open, true); assert.equal(dialog.getAttribute('aria-busy'), 'false');
  assert.equal($('#restore-confirm').disabled, true);
  assert.equal($('#restore-summary').textContent, 'Gennemgangen kunne ikke hentes. Ingen filer er ændret.');
  assert.equal($('#restore-feedback').textContent, 'Vent på opgaven i projektet.');
  await dialog.querySelector('.restore-retry').onclick(); assert.equal(calls, 2);
  dialog.close(); assert.equal(dialog.open, false);
});

test('et sent svar efter Annuller åbner ikke dialogen eller aktiverer gendannelse', async () => {
  let resolve;
  const { context, $, dialog } = environment(() => new Promise(done => { resolve = done; }));
  vm.runInContext(historySource, context);
  const request = context.window.reviewRestoration({ task: 'opgave' });
  dialog.close(); resolve({ files: [{ file: 'a.txt' }] }); await request;
  assert.equal(dialog.open, false); assert.equal($('#restore-confirm').disabled, true);
  assert.equal(dialog.getAttribute('aria-busy'), 'false');
});

test('resultatet kvitterer uden teknisk output; kun særskilt klik markerer gennemgået', async () => {
  const { context, view } = environment(); resultUI(context);
  view.lastCheckpoint = { status: 'saved', head: 'version' };
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['a', 'b'], tools: [{ tool: 'bash', title: 'node logic-test.js', output: 'TEKNISK OUTPUT', status: 'completed' }] }, view);
  assert.match(view.review.textContent, /2 filer ændret · Gemt/);
  assert.doesNotMatch(view.review.textContent, /Kontroller|logic-test|TEKNISK OUTPUT/);
  const options = view.review.querySelector('details'); assert.equal(options.open, undefined);
  assert.equal(options.querySelector('button').textContent, 'Fortryd opgaven');
  const changes = view.review.querySelectorAll('button').find(button => button.textContent === 'Se ændringer');
  await changes.onclick(); assert.equal(changes.textContent, 'Se ændringer'); assert.equal(view.reviewedTask, undefined);
  const reviewed = view.review.querySelectorAll('button').find(button => button.textContent === 'Markér som gennemgået');
  reviewed.onclick(); assert.equal(view.reviewedTask, 'opgave'); assert.equal(reviewed.disabled, true); assert.equal(view.review.classList.contains('is-reviewed'), true);
});

test('fortrydelse kvitterer én gang og fjerner opgavens mulighed for at blive fortrudt igen', async () => {
  const { context, $, view, dialog } = environment(async method => method === 'restoreReview' ? { token: 'token', kind: 'task', files: [{ file: 'a', action: 'Ændres', before: 'efter', after: 'før' }] } : { restored: { files: 1 }, saved: true });
  vm.runInContext(historySource, context); resultUI(context);
  await context.window.reviewRestoration({ task: 'opgave' }, { taskUndo: true, taskID: 'opgave' });
  assert.equal($('#restore-confirm').disabled, false);
  await $('#restore-confirm').onclick();
  assert.equal(dialog.open, false); assert.match(view.review.textContent, /^Opgaven er fortrudt/); assert.equal(view.review.querySelectorAll('button').length, 0);
  assert.equal(view.undoneTasks.has('opgave'), true);
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['a'] }, view);
  assert.doesNotMatch(view.review.textContent, /Fortryd opgaven/);
});

test('kun et udtrykkeligt byggeforslag giver Byg videre; almindelig samtale og ventende spørgsmål gør ikke', () => {
  const { context, $, view } = environment(); resultUI(context);
  for (const mode of ['plan', 'chat']) {
    view.planOffer = true;
    context.renderRunReview({ mode, status: 'idle', answered: true, buildOffer: true }, view);
    assert.equal(view.review.hidden, false); assert.match(view.review.textContent, /Næste skridtByg videre/);
    assert.equal(view.plan, undefined); assert.equal($('#plan-offer').hidden, true);
  }
  for (const result of [{ mode: 'plan', status: 'idle', answered: true, buildOffer: false }, { mode: 'chat', status: 'idle', answered: true }, { mode: 'chat', status: 'idle', answered: true, buildOffer: false }]) {
    context.renderRunReview(result, view); assert.equal(view.review.hidden, true);
  }
  view.waitingFor = [{ id: 'spørgsmål' }];
  context.renderRunReview({ mode: 'plan', status: 'idle', answered: true, buildOffer: true }, view); assert.equal(view.review.hidden, true);
});

test('en konkret plan har forrang frem for en gammel eller sen plananbefaling', () => {
  const { context, $, view } = environment(); resultUI(context);
  view.plan = { id: 'konkret-plan' }; view.planOffer = true;
  context.updatePlanOffer();
  assert.equal(view.planOffer, false); assert.equal($('#plan-offer').hidden, true);
  context.renderRunReview({ mode: 'chat', status: 'idle', answered: true, buildOffer: true }, view);
  assert.equal(view.review.hidden, true); assert.equal(view.buildOffer, false);
  const background = { plan: { id: 'anden-plan' }, planOffer: true };
  view.plan = null; view.planOffer = true; context.updatePlanOffer();
  context.updatePlanOffer(background);
  assert.equal(background.planOffer, false); assert.equal($('#plan-offer').hidden, false, 'Baggrundsplanen ændrer ikke den åbne samtale.');
});

test('en sen fortrydelse kvitterer i sin egen samtale uden at overtage et andet projekt', async () => {
  let resolve, navigations = 0;
  const { context, $, view, dialog } = environment(async method => method === 'restoreReview' ? { token: 'token', kind: 'task', files: [{ file: 'a', action: 'Ændres' }] } : new Promise(done => { resolve = done; }));
  context.displayProject = async () => { navigations++; };
  vm.runInContext(historySource, context);
  await context.window.reviewRestoration({ task: 'opgave' }, { taskUndo: true, taskID: 'opgave' });
  const pending = $('#restore-confirm').onclick();
  dialog.close();
  const nextView = { id: 'anden', root: '/andet', review: new Element('section') };
  context.current = { root: '/andet' }; context.view = nextView;
  resolve({ project: { root: '/projekt' }, restored: { files: 1 }, saved: true }); await pending;
  assert.equal(navigations, 0); assert.equal(context.view, nextView);
  assert.match(view.review.textContent, /^Opgaven er fortrudt/); assert.equal(view.undoneTasks.has('opgave'), true);
  assert.equal(nextView.review.textContent, ''); assert.equal(view.review.focused, undefined);
});

test('Afprøv resultatet viser eksisterende preview eller opstarts-gennemgang uden at starte en server', () => {
  const { context, $, view } = environment(); resultUI(context);
  const shown = []; let refreshes = 0;
  context.window.workspace.show = name => shown.push(name); context.window.previewServer = { refresh() { refreshes++; } };
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['a'] }, view);
  const preview = view.review.querySelectorAll('button').find(button => button.textContent === 'Afprøv resultatet');
  context.current.previewURL = 'aura-preview://projekt/'; preview.onclick();
  assert.deepEqual(shown, ['preview']); assert.equal($('#preview-dialog').open, undefined); assert.equal(refreshes, 0);
  context.current.previewURL = null; preview.onclick();
  assert.equal($('#preview-dialog').open, true); assert.equal(refreshes, 1);
});

test('gamle resultatknapper kan ikke påvirke en ny opgave, samtale eller et andet projekt', async () => {
  const { context, view } = environment(); resultUI(context);
  let changes = 0; context.window.workspace.showChange = async () => changes++;
  context.renderRunReview({ task: 'gammel', mode: 'build', status: 'idle', files: ['a'] }, view);
  const buttons = view.review.querySelectorAll('button');
  const diff = buttons.find(button => button.textContent === 'Se ændringer'), reviewed = buttons.find(button => button.textContent === 'Markér som gennemgået');
  view.running = true; await diff.onclick(); reviewed.onclick();
  assert.equal(changes, 0); assert.equal(view.reviewedTask, undefined);
  view.running = false; context.renderRunReview({ task: 'ny', mode: 'build', status: 'idle', files: ['b'] }, view);
  await diff.onclick(); reviewed.onclick(); assert.equal(changes, 0); assert.equal(view.reviewedTask, undefined);
  context.current.root = '/andet'; await diff.onclick(); reviewed.onclick();
  assert.equal(changes, 0); assert.equal(view.reviewedTask, undefined);
});
