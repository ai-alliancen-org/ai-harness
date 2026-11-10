// Beslutning (c), 10. november 2026: et nyt projekt uden sikkerhedsnet får filændringer uden kort og kommandoer i sandkassen,
// først når nettet er der. Hovedprocessen sender da approvals.defaults (main.cjs settleDefaults), og ui/history.js siger i
// almindeligt dansk, hvad Aura har slået til, og hvor det ændres. Ellers så brugeren det først i kvitteringen ved næste opgave
// (skeptikerens fund efter første runde). Kører den faktiske ui/history.js i en lille DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div', text = '') { this.tagName = tag; this.text = text || ''; this.children = []; this.hidden = false; this.dataset = {}; this.attributes = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  get textContent() { return this.text; }
  set textContent(value) { this.text = value; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() {}
}
function environment(root = '/projekt') {
  const elements = new Map(), listeners = [], messages = [];
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const context = { $, document: { querySelector: () => null, querySelectorAll: () => [] }, node: (tag, text) => new Element(tag, text), view: { id: 'chat', root }, current: { root }, call: async () => null, selectedOwner: () => ({ root, chat: 'chat' }), action: fn => fn(), versionTime: () => '', shortLabel: value => value, featureOn: () => true, info: () => new Element(), message: (text, error = false) => messages.push({ text, error }), setTimeout, clearTimeout };
  context.window = { harness: { onEvent: fn => listeners.push(fn) }, workspace: {} };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui/history.js'), 'utf8'), context);
  return { emit: event => { for (const fn of listeners) fn(event); }, messages, $ };
}

test('når sikkerhedsnettet giver standarderne, siger Aura, hvad der er slået til, og hvor det ændres', () => {
  const env = environment();
  env.emit({ type: 'approvals.defaults', root: '/projekt', files: true, commands: true });
  assert.deepEqual(env.messages, [{ text: 'Versionerne er klar, så Aura har slået «Filændringer i projektet» og «Byg og kontrollér automatisk» til. AI’en spørger ikke længere om dem. Du kan ændre det i Projektets indstillinger.', error: false }]);
  assert.ok(!env.messages[0].text.includes(String.fromCharCode(0x2014)), 'ingen tankestreg');
});

test('uden kommandosandkasse nævner beskeden kun filændringer, og et andet projekts besked vises ikke', () => {
  const env = environment();
  env.emit({ type: 'approvals.defaults', root: '/projekt', files: true, commands: false });
  assert.deepEqual(env.messages.map(item => item.text), ['Versionerne er klar, så Aura har slået «Filændringer i projektet» til. AI’en spørger ikke længere om dem. Du kan ændre det i Projektets indstillinger.']);
  env.emit({ type: 'approvals.defaults', root: '/et-andet-projekt', files: true, commands: true });
  assert.equal(env.messages.length, 1, 'beskeden hører til det åbne projekt');
});
