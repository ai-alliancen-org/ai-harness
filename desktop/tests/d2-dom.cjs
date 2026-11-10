// Spor D2, runde 2: Udgivs dialog bygget af den rigtige markup i ui/index.html, med den rigtige ui/deployment.js og
// ui/share-view.js i en vm. Prøverne kan derfor tælle de synlige valg på samme måde som Electron-prøverne
// (verify-deployment.cjs og verify-komplai-publish.cjs): knapper, rullemenuer, afkrydsningsfelter, radioknapper og summary,
// der hverken er skjult eller ligger i en lukket <details> ud over dens egen summary. click() klikker kun på det, en tester
// kan se og bruge. Kernen er den rigtige (Store, Deployments, KomplaiDeployment og komplai.cjs); kun komplais hub og login
// er falske. Kun de DOM-dele, deployment.js bruger, er med. Filen er ikke selv en prøve.
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const desktop = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(desktop, 'ui/index.html'), 'utf8');
const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class Text { constructor(data) { this.nodeType = 3; this.data = data; this.parent = null; } get textContent() { return this.data; } }

class Element {
  constructor(doc, tag) {
    this.doc = doc; this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null;
    this.attributes = {}; this.dataset = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.open = false; this.checked = false;
    this.defaultChecked = false; this.defaultSelected = false; this.scrollTop = 0; this._value = null; this.selectedIndex = -1; this._id = '';
    const classes = this._classes = new Set();
    this.classList = { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c), toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; } };
  }
  get id() { return this._id; }
  set id(value) { this._id = String(value || ''); if (this._id) this.doc.ids.set(this._id, this); }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes.clear(); for (const c of String(value).split(/\s+/).filter(Boolean)) this._classes.add(c); }
  get type() { return this.attributes.type ?? (this.tagName === 'BUTTON' ? 'submit' : this.tagName === 'INPUT' ? 'text' : ''); }
  set type(value) { this.attributes.type = String(value); }
  get name() { return this.attributes.name ?? ''; }
  get value() {
    if (this.tagName === 'SELECT') return this.options[this.selectedIndex]?.value ?? '';
    if (this.tagName === 'OPTION') return this._value ?? this.attributes.value ?? this.textContent;
    return this._value ?? this.attributes.value ?? '';
  }
  set value(value) {
    if (this.tagName === 'SELECT') { this.selectedIndex = this.options.findIndex(option => option.value === String(value)); return; }
    this._value = String(value);
  }
  get options() { return this.tagName === 'SELECT' ? this.children.filter(child => child.tagName === 'OPTION') : undefined; }
  get selectedOptions() { const option = this.options?.[this.selectedIndex]; return option ? [option] : []; }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); if (value !== null && value !== undefined && String(value) !== '') this.append(new Text(String(value))); }
  get parentElement() { return this.parent; }
  adopt(node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; }
  append(...nodes) { for (const item of nodes) { const node = typeof item === 'string' ? new Text(item) : item; this.adopt(node); this.children.push(node); } if (this.tagName === 'SELECT' && this.selectedIndex < 0 && this.options.length) this.selectedIndex = 0; }
  prepend(...nodes) { const list = nodes.map(item => typeof item === 'string' ? new Text(item) : item); for (const node of list) this.adopt(node); this.children.unshift(...list); }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; if (this.tagName === 'SELECT') this.selectedIndex = -1; this.append(...nodes); }
  add(option, before) { if (before === 0) { this.prepend(option); if (this.selectedIndex >= 0) this.selectedIndex++; } else this.append(option); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
  getAttribute(name) {
    if (name === 'id') return this._id || null;
    if (name === 'class') return this.className || null;
    if (name === 'hidden') return this.hidden ? '' : null;
    if (name.startsWith('data-')) { const value = this.dataset[camel(name.slice(5))]; return value === undefined ? null : String(value); }
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }
  setAttribute(name, value) {
    if (name === 'id') this.id = value; else if (name === 'class') this.className = value; else if (name === 'hidden') this.hidden = true;
    else if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value); else this.attributes[name] = String(value);
  }
  removeAttribute(name) { if (name === 'hidden') this.hidden = false; else if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))]; else delete this.attributes[name]; }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, once: options?.once === true }); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(entry => entry.fn !== fn); }
  // En hændelse bobler op gennem forfædrene, som i browseren.
  dispatch(type) {
    const event = { type, target: this, preventDefault() {} };
    for (let node = this; node; node = node.parent) {
      if (node === this) node['on' + type]?.(event);
      for (const entry of [...(node.listeners[type] || [])]) { if (entry.once) node.removeEventListener(type, entry.fn); entry.fn(event); }
    }
  }
  // form.reset(): felterne får værdierne fra markuppen igen.
  reset() {
    walk(this, el => {
      if (['INPUT', 'TEXTAREA'].includes(el.tagName)) { el._value = null; el.checked = el.defaultChecked; }
      if (el.tagName === 'SELECT') el.selectedIndex = el.options.length ? Math.max(0, el.options.findIndex(option => option.defaultSelected)) : -1;
    });
  }
  focus() { this.doc.activeElement = this; }
  reportValidity() { return true; }
  setCustomValidity() {}
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatch('close'); }
  set innerHTML(text) { this.replaceChildren(); this.doc.parseInto(text, this); }
  matches(selector) { return parse(selector).some(chain => matchChain(this, chain)); }
  querySelectorAll(selector) { const chains = parse(selector), found = []; walk(this, el => { if (chains.some(chain => matchChain(el, chain))) found.push(el); }); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parent) if (node.matches(selector)) return node; return null; }
}
function walk(root, visit) { for (const child of root.children) if (child.nodeType === 1) { visit(child); walk(child, visit); } }

// En lille vælgermotor: tag, #id, .klasse, [attr], [attr="v"], :checked og :not(...), med efterkommer- og barnekombinator.
function parse(selector) {
  return splitTop(selector, ',').map(group => {
    const chain = []; let combinator = ' ', current = '', depth = 0, quote = '';
    const flush = () => { if (current) { chain.push({ compound: compound(current), combinator }); current = ''; combinator = ' '; } };
    for (const ch of group.trim()) {
      if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
      if (ch === '[' || ch === '(') depth++;
      if (ch === ']' || ch === ')') depth--;
      if (depth === 0 && ch === '>') { flush(); combinator = '>'; continue; }
      if (depth === 0 && /\s/.test(ch)) { if (current) { chain.push({ compound: compound(current), combinator }); current = ''; combinator = ' '; } continue; }
      current += ch;
    }
    flush();
    return chain;
  });
}
function splitTop(text, separator) {
  const parts = []; let depth = 0, quote = '', current = '';
  for (const ch of text) {
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (depth === 0 && ch === separator) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current); return parts.filter(part => part.trim());
}
function compound(text) {
  const tests = []; let rest = text;
  const tag = /^([a-zA-Z][\w-]*|\*)/.exec(rest);
  if (tag) { const name = tag[1].toUpperCase(); if (name !== '*') tests.push(el => el.tagName === name); rest = rest.slice(tag[0].length); }
  while (rest) {
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) { const id = m[1]; tests.push(el => el.id === id); }
    else if ((m = /^\.([\w-]+)/.exec(rest))) { const c = m[1]; tests.push(el => el.classList.contains(c)); }
    else if ((m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(rest))) { const [, name, a, b, c] = m, value = a ?? b ?? c; tests.push(el => value === undefined ? el.getAttribute(name) !== null : el.getAttribute(name) === value); }
    else if ((m = /^:checked/.exec(rest))) tests.push(el => el.checked === true);
    else if ((m = /^:not\(([^()]*)\)/.exec(rest))) { const inner = compound(m[1]); tests.push(el => !inner(el)); }
    else throw Error('Vælgeren kendes ikke af d2-dom: ' + text);
    rest = rest.slice(m[0].length);
  }
  return el => tests.every(t => t(el));
}
function matchChain(el, chain, index = chain.length - 1) {
  if (!chain[index].compound(el)) return false;
  if (index === 0) return true;
  if (chain[index].combinator === '>') return Boolean(el.parent?.nodeType === 1 && el.parent.tagName !== '#ROOT' && matchChain(el.parent, chain, index - 1));
  for (let node = el.parent; node && node.tagName !== '#ROOT'; node = node.parent) if (matchChain(node, chain, index - 1)) return true;
  return false;
}

// En lille HTML-læser til dialogernes markup: tags, attributter, tekst og kommentarer. Tomme elementer (input, img og lignende) og
// «/>» lukker sig selv. Markuppen i index.html lukker selv sine elementer, så HTML's regler for underforståede lukninger er ikke med.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTRIBUTE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => name[0] === '#' ? String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : ENTITIES[name.toLowerCase()] ?? whole);
class Document {
  // deployment: false giver et tomt dokument, fx til dialogen Auras netværkskald, som selv sætter sin markup med innerHTML.
  constructor({ deployment = true } = {}) {
    this.ids = new Map(); this.activeElement = null; this.root = new Element(this, '#root');
    if (deployment) {
      this.parseInto(dialogMarkup(), this.root);
      // Udgiv-knappen står i arbejdsområdets værktøjslinje uden for dialogen; den åbner dialogen og får fokus, når den lukker.
      const opener = this.createElement('button'); opener.id = 'deploy-button'; opener.textContent = 'Udgiv'; this.root.append(opener);
    }
    this.body = this.root;
  }
  parseInto(html, target) {
    const stack = [target];
    for (const m of html.matchAll(TOKEN)) {
      const top = stack.at(-1);
      if (m[0].startsWith('<!--')) continue;
      if (m[1]) { const name = m[1].toUpperCase(); for (let k = stack.length - 1; k > 0; k--) if (stack[k].tagName === name) { stack.length = k; break; } continue; }
      if (!m[2]) { top.append(new Text(decode(m[0]))); continue; }
      const el = new Element(this, m[2]);
      for (const [, name, a, b, c] of m[3].matchAll(ATTRIBUTE)) {
        const key = name.toLowerCase(), value = decode(a ?? b ?? c ?? '');
        if (key === 'checked') el.checked = el.defaultChecked = true; else if (key === 'selected') el.defaultSelected = true; else if (['hidden', 'disabled', 'open'].includes(key)) el[key] = true; else el.setAttribute(name, value);
      }
      top.append(el);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
    }
    walk(target, el => { if (el.tagName === 'SELECT') el.selectedIndex = el.options.length ? Math.max(0, el.options.findIndex(option => option.defaultSelected)) : -1; });
  }
  createElement(tag) { return new Element(this, tag); }
  option(text, value) { const option = new Element(this, 'option'); option.textContent = text; if (value !== undefined) option.value = value; return option; }
  // Kun elementer, der hænger i dialogen, findes, som i browseren.
  connected(el) { for (let node = el; node; node = node.parent) if (node === this.root) return true; return false; }
  querySelector(selector) {
    const simple = /^#([\w-]+)$/.exec(selector);
    if (simple) { const el = this.ids.get(simple[1]); return el && this.connected(el) ? el : null; }
    return this.root.querySelector(selector);
  }
  querySelectorAll(selector) { return this.root.querySelectorAll(selector); }
  getElementById(id) { return this.querySelector('#' + id); }
}
function dialogMarkup() {
  const start = markup.indexOf('<dialog id="deployment-dialog"'), end = markup.indexOf('</dialog>', start) + '</dialog>'.length;
  assert.ok(start >= 0 && end > start, 'index.html har Udgivs dialog');
  return markup.slice(start, end);
}

// Synlig betyder: hverken elementet eller en forfader er skjult, dialogen er åben, og en lukket <details> skjuler alt
// undtagen sin egen summary.
function visible(el) {
  let previous = null;
  for (let node = el; node; previous = node, node = node.parent) {
    if (node.nodeType !== 1) continue;
    if (node.hidden) return false;
    if (node.tagName === 'INPUT' && node.type === 'hidden') return false;
    if (node.tagName === 'DETAILS' && !node.open && !(previous && previous.tagName === 'SUMMARY' && node.children.find(child => child.tagName === 'SUMMARY') === previous)) return false;
    if (node.tagName === 'DIALOG') return node.open;
  }
  return false;
}
const disabled = el => { for (let node = el; node; node = node.parent) if (node.disabled === true && (node === el || node.tagName === 'FIELDSET')) return true; return false; };
const CONTROLS = 'button, select, input[type=checkbox], input[type=radio], summary';
const label = el => el.id || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) || el.tagName.toLowerCase();

// --- Den rigtige kerne med en falsk hub og et falsk login. Organisationerne har hver deres udgivelsesadgang. ---
const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('k:' + Buffer.from(value).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(2), 'base64').toString() };
const html = Buffer.from('<h1>Budget</h1>');
const artifact = { head: 'a'.repeat(40), hash: 'fingeraftryk', bytes: html.length, files: [{ file: 'index.html', data: html, sha256: createHash('sha256').update(html).digest('hex') }] };
const root = '/projekt';
const ORGANISATIONS = [{ id: 'org-1', name: 'Testkommune', letter: 'a' }, { id: 'org-2', name: 'Nabokommune', letter: 'b' }];

async function backend(t, { apps = [], connected = true, organisations = ORGANISATIONS.slice(0, 1) } = {}) {
  const { KomplaiDeployment } = require('../core/komplai-publish.cjs');
  const { Deployments } = require('../core/deployments.cjs');
  const { Store } = require('../core/store.cjs');
  const { publishingState, disconnectPublishing } = require('../core/komplai.cjs');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-d2-dom-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, safe);
  const grant = async (organisationId = 'org-1', expiresAt = new Date(Date.now() + 86400000).toISOString()) => {
    const org = ORGANISATIONS.find(item => item.id === organisationId);
    await store.update(state => { state.hosting = { ...state.hosting, komplai: { secret: store.encrypt('komp_publish_grant_' + org.letter.repeat(64)), grantId: 'g-' + org.id, organisationId: org.id, organisationName: org.name, address: 'komplai.run', expiresAt } }; });
  };
  if (connected) await grant();
  // Hver app hører til en organisation (org); komplai viser kun den organisations apps, adgangen gælder for.
  const hub = { apps: apps.map(app => ({ org: 'org-1', ...app })), upload: null, overview: null, logoutOffline: false, log: [] };
  const present = a => ({ id: a.id, name: a.name, slug: a.slug, url: `https://${a.slug}.komplai.run`, visibility: a.visibility, activeRelease: a.activeRelease, releases: a.activeRelease ? [{ id: a.activeRelease }] : [] });
  const orgOf = options => ORGANISATIONS.find(org => new Headers(options.headers).get('authorization') === 'Bearer komp_publish_grant_' + org.letter.repeat(64))?.id;
  const fetcher = async (url, options = {}) => {
    const u = new URL(url), route = u.pathname, method = options.method || 'GET', org = orgOf(options); hub.log.push(`${method} ${route}`);
    const mine = hub.apps.filter(a => a.org === org);
    if (route === '/api/publish/native') return hub.overview ? hub.overview() : Response.json({ address: 'komplai.run', slugs: true, apps: mine.map(present) });
    if (route === '/api/publish/native/address') return Response.json(hub.apps.some(a => a.slug === u.searchParams.get('slug') && a.id !== u.searchParams.get('appId')) ? { available: false, reason: 'slug_taken' } : { available: true, reason: null });
    if (route === '/api/publish/native/apps' && method === 'POST') { const body = JSON.parse(options.body), app = { id: crypto.randomUUID(), org, name: body.name, slug: body.slug || 'tilfaeldig', visibility: 'private', activeRelease: null }; hub.apps.push(app); return Response.json(present(app)); }
    const release = route.match(/^\/api\/publish\/([0-9a-f-]{36})\/releases$/);
    if (release) { const app = mine.find(a => a.id === release[1]); if (hub.upload) return hub.upload(app); app.activeRelease = 'release-' + crypto.randomUUID().slice(0, 6); return Response.json(present(app)); }
    throw Error('Uventet ' + method + ' ' + route);
  };
  const provider = new KomplaiDeployment(store, { fetcher });
  const deployments = new Deployments(store, { artifact: async () => artifact, providers: { komplai: provider }, fetcher: async () => new Response(html) });
  const logout = async () => { if (hub.logoutOffline) throw Error('offline'); return Response.json({ revoked: true }); };
  const context = { projectName: 'Budget' }, calls = [], opened = [];
  let chosenOrganisation = null;
  const handlers = {
    deploymentState: async () => ({ ...await deployments.state(root), context }),
    deploymentGuides: async () => [],
    deploymentReview: async input => ({ ...await deployments.review(root, input), context }),
    deploymentSend: async token => deployments.deploy(root, token),
    deploymentSource: async () => ({ directory: 'public', build: false }),
    deploymentCheck: async () => deployments.check(root),
    deploymentOpen: async value => { opened.push(value); return true; },
    komplaiPublishState: async () => publishingState(store),
    komplaiPublishOverview: async () => provider.overview(),
    komplaiPublishAddress: async value => provider.address(value?.slug, value?.appId),
    komplaiPublishDisconnect: async () => disconnectPublishing(store, undefined, logout),
    komplaiPublishForget: async () => disconnectPublishing(store, undefined, logout, { force: true }),
    komplaiCancel: async () => true,
    komplaiLogin: async () => ({ organisations: organisations.map(org => ({ id: org.id, name: org.name, publishing: { address: 'komplai.run', tier: 'shared_free' } })) }),
    komplaiConnect: async value => { chosenOrganisation = value.organisationId; await grant(value.organisationId); hub.overview = null; return {}; },
  };
  const harness = new Proxy({}, { get: (_, method) => typeof method === 'string' && handlers[method] ? async input => { calls.push(method); try { return { ok: true, value: await handlers[method](input) }; } catch (error) { return { ok: false, error: error.message }; } } : undefined });
  // En udgivelse, der allerede er gemt i projektet, som når testeren har udgivet før.
  const publish = async (appId, visibility) => deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', appId, visibility })).token);
  return { store, hub, deployments, provider, harness, handlers, calls, opened, grant, publish, chosen: () => chosenOrganisation };
}

// Den rigtige ui/deployment.js og ui/share-view.js mod markuppen. Opsætningen for de andre udbydere (deployment-setup.js)
// er en attrap, som i d2-udgiv-dialog.test.cjs.
function mount(harness) {
  const doc = new Document(); let setupArgs;
  const setup = { choose: async () => false, config: () => ({}), restore() {}, opened() {}, refresh: async () => {}, configurationStep() {}, pages: () => false, panel: step => step, render() {}, title: () => undefined, reset() {} };
  const context = { document: doc, CustomEvent: class { constructor(type) { this.type = type; } }, setTimeout, clearTimeout, URL, console };
  context.Option = function Option(text, value) { return doc.option(text, value); };
  context.window = context; context.harness = harness; context.sharingOn = () => true; context.dispatchEvent = () => {}; context.addEventListener = () => {};
  context.selectedOwner = () => ({ root, chat: 'samtale' });
  context.DeploymentSetupUI = { mount: args => { setupArgs = args; return setup; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/share-view.js'), 'utf8'), context, { filename: 'ui/share-view.js' });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/deployment.js'), 'utf8'), context, { filename: 'ui/deployment.js' });
  const $ = id => { const el = doc.querySelector('#' + id); assert.ok(el, `#${id} findes ikke i Udgiv`); return el; };
  const dialog = $('deployment-dialog');
  const idle = async () => { for (let i = 0; i < 2000; i++) { await new Promise(resolve => setTimeout(resolve, 1)); if (!$('deployment-fields').disabled) return; } throw Error('Udgiv blev ikke færdig'); };
  const heading = () => $('deployment-heading').textContent;
  // De synlige valg i dialogen, som Electron-prøverne tæller dem.
  const choices = () => dialog.querySelectorAll(CONTROLS).filter(visible).map(label);
  // Et klik som testerens: kun på et synligt og aktivt element.
  async function click(id) {
    const el = typeof id === 'string' ? $(id) : id;
    assert.ok(visible(el), `«${label(el)}» er ikke synlig. Synlige valg: ${choices().join(' | ')}`);
    assert.ok(!disabled(el), `«${label(el)}» kan ikke vælges lige nu`);
    if (el.tagName === 'SUMMARY') { el.parent.open = !el.parent.open; return; }
    if (el.tagName === 'INPUT' && el.type === 'radio') { for (const other of doc.querySelectorAll(`[name="${el.name}"]`)) other.checked = other === el; el.onclick?.({ target: el }); el.onchange?.({ target: el }); await idle(); return; }
    if (!el.onclick && el.type === 'submit' && el.closest('form')) { el.closest('form').onsubmit({ preventDefault() {} }); await idle(); return; }
    await el.onclick?.({ target: el, preventDefault() {} }); await idle();
  }
  const open = async () => { $('deploy-button').onclick(); await idle(); };
  const status = async () => { setupArgs.openDialog(true); await idle(); };
  const close = () => dialog.close();
  const choose = async provider => { await setupArgs.busy(() => setupArgs.chooseProvider(provider)); await idle(); };
  const submit = async () => { $('deployment-form').onsubmit({ preventDefault() {} }); await idle(); };
  const radio = async value => click(doc.querySelectorAll('[name="komplai-visibility"]').find(item => item.value === value));
  const mainActions = () => $('deployment-main-actions').children.map(button => button.id);
  const details = () => $('deployment-receipt-details');
  return { doc, $, dialog, idle, heading, choices, visible, click, open, status, close, choose, submit, radio, mainActions, details, setup: () => setupArgs };
}

module.exports = { Document, Element, parse, visible, CONTROLS, label, backend, mount, root, ORGANISATIONS, artifact };
