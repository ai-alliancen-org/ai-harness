// En lille DOM-attrap til prøverne af ui/server.js og ui/workspace.js. Skripterne køres uændrede i en vm-kontekst; kun browserens
// elementer, IPC-kaldet og appens globale hjælpere er erstattet. Filen er ikke selv en prøve.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const desktop = path.join(__dirname, '..');
class FakeElement {
  constructor(tag = 'div', text = '', className = '') {
    this.tagName = String(tag).toUpperCase(); this.textContent = text ?? ''; this.className = className || ''; this.id = ''; this.type = '';
    this.children = []; this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this.value = '';
    this.attributes = {}; this.listeners = {}; this.dataset = {}; this.style = {}; this.scrollLeft = 0; this.scrollTop = 0;
    const classes = new Set(String(className || '').split(/\s+/).filter(Boolean));
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle: (name, on = !classes.has(name)) => { if (on) classes.add(name); else classes.delete(name); return on; } };
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  after(...items) { this.following = items; }
  before(...items) { this.preceding = items; }
  remove() { this.removed = true; }
  closest() { return new FakeElement(); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener() {}
  dispatch(type) { for (const listener of this.listeners[type] || []) listener({ type, target: this, preventDefault() {} }); }
  click() { this.dispatch('click'); return this.onclick?.({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  toggleAttribute(name, on) { if (on) this.attributes[name] = ''; else delete this.attributes[name]; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  get isConnected() { return true; }
}
// Alle knapper og tekster, skriptet selv opretter, kan findes igen på deres tekst. Elementer, som skriptet selv opretter med et id,
// findes ikke, før det har gjort det (`dynamic`); alle andre står i index.html og findes altid.
function elements(dynamic = []) {
  const byId = new Map(), created = [], later = new Set(dynamic);
  const $ = selector => {
    const made = /^#[\w-]+$/.test(selector) && created.find(el => el.id === selector.slice(1));
    if (made) return made;
    if (later.has(selector)) return null;
    if (!byId.has(selector)) byId.set(selector, new FakeElement('div', '', ''));
    return byId.get(selector);
  };
  const node = (tag, text, className) => { const el = new FakeElement(tag, text, className); created.push(el); return el; };
  const find = text => created.filter(el => el.textContent === text).at(-1);
  return { $, node, find, created };
}

// ui/server.js: forhåndsvisningens dialog. `answers` er svarene på IPC-kaldene, fx { previewAllow: () => ({ runtime: … }) }.
function serverUI({ current = { root: '/projekt', workspaceRoot: '/projekt', previewURL: 'http://127.0.0.1:5173/' }, answers = {} } = {}) {
  const dom = elements(['#preview-problem', '#server-repair', '#server-diagnostics', '#server-consent', '#server-netlist', '#preview-dialog .dialog-notice']), calls = [], messages = [], listeners = [], preview = [];
  const context = vm.createContext({
    $: dom.$, node: dom.node, current, running: false, console,
    showPreview: () => {}, message: (text, error) => messages.push({ text, error: Boolean(error) }), action: async fn => fn(),
    call: async (method, value) => { calls.push({ method, value }); const answer = answers[method]; return typeof answer === 'function' ? answer(value) : answer ?? null; },
    // setPreviewStatus og loadPreview kommer fra ui/app.js, som indlæses før server.js (K3). Attrappen skriver det samme sted som app.js.
    window: { harness: { onEvent: listener => listeners.push(listener) }, draftMessage() {}, ApprovalView: { serverRepairDraft: () => '' },
      setPreviewStatus: (text, ahead = false) => { preview.push(['status', text, ahead]); dom.$('#preview-status').textContent = text; }, loadPreview: url => { preview.push(['load', url]); dom.$('#preview').src = url; } }
  });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/server.js'), 'utf8'), context, { filename: 'ui/server.js' });
  return { ...dom, calls, messages, preview, current, ui: context.window.previewServer, emit: event => listeners.forEach(listener => listener(event)) };
}

// ui/workspace.js: arbejdsfladens faner. Fanestriben lægges ud som i en smal arbejdsflade (styles.css: én linje, polstring 8 px,
// 2 px mellem fanerne), med fanebredderne målt ved 100 % i 980 × 720. scrollLeft opfører sig som i browseren og holdes inden for
// det, der kan rulles.
const TAB_WIDTHS = { preview: 112, plan: 39, changes: 73, overview: 62, code: 43, activity: 66 };
function workspaceUI({ stripWidth = 300, left = 500 } = {}) {
  const dom = elements(), observers = [], names = Object.keys(TAB_WIDTHS);
  const strip = dom.$('.work-tabs');
  let scroll = 0; strip.width = stripWidth;
  const contentWidth = () => 8 + names.filter(name => !dom.$(`#tab-${name}`).hidden).reduce((sum, name) => sum + TAB_WIDTHS[name] + 2, -2) + 8;
  Object.defineProperty(strip, 'scrollLeft', { get: () => scroll, set: value => { scroll = Math.max(0, Math.min(Number(value) || 0, contentWidth() - strip.width)); } });
  strip.getBoundingClientRect = () => ({ left, right: left + strip.width, top: 0, bottom: 46, width: strip.width, height: 46 });
  for (const name of names) {
    const tab = dom.$(`#tab-${name}`);
    tab.getBoundingClientRect = () => {
      if (tab.hidden) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
      let x = 8; for (const other of names) { if (other === name) break; if (!dom.$(`#tab-${other}`).hidden) x += TAB_WIDTHS[other] + 2; }
      const l = left + x - scroll; return { left: l, right: l + TAB_WIDTHS[name], top: 8, bottom: 38, width: TAB_WIDTHS[name], height: 30 };
    };
  }
  const body = new FakeElement('body');
  const context = vm.createContext({
    $: dom.$, node: dom.node, option: (value, text) => Object.assign(new FakeElement('option', text), { value }), console,
    action: () => undefined, call: async () => null, message: () => {}, current: { root: '/projekt', workspaceRoot: '/projekt' }, running: false,
    updateWorkMode: () => {}, viewFor: () => ({ id: 'samtale' }), elapsedText: () => '', versionTime: () => '', shortLabel: text => text,
    requestAnimationFrame: callback => callback(), setInterval: () => 0, clearInterval: () => {}, CSS: { escape: value => value }, NodeFilter: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(target) { this.target = target; } disconnect() {} },
    document: { body, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createTextNode: text => text },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), harness: { onEvent() {} } }
  });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/workspace.js'), 'utf8'), context, { filename: 'ui/workspace.js' });
  const visible = name => { const box = strip.getBoundingClientRect(), own = dom.$(`#tab-${name}`).getBoundingClientRect(); return own.width > 0 && own.left >= box.left && own.right <= box.right; };
  // Som browseren: fladen får en ny bredde, og alle, der holder øje med striben, får besked.
  const resize = width => { strip.width = width; strip.scrollLeft = scroll; for (const observer of observers) if (observer.target === strip) observer.callback([{ target: strip }]); };
  return { ...dom, strip, observers, visible, resize, workspace: context.window.workspace };
}

module.exports = { FakeElement, elements, serverUI, workspaceUI, desktop };
