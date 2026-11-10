// Spor D2: den rigtige ui/deployment-setup.js i en lille DOM. Topknappen skal sige det samme som kvitteringens kort
// (fund R#30), og beskeden fra «Gør klar til Promte» skal være sand, når brugerens egen kladde bevares (T:verify-promte-ready).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const view = require('../ui/share-view.js');

const source = fs.readFileSync(path.join(__dirname, '../ui/deployment-setup.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../ui/styles.css'), 'utf8');

function element() {
  const el = { children: [], dataset: {}, listeners: {}, hidden: false, disabled: false, open: false, textContent: '', value: '', title: '', attributes: {},
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); }, add(item) { this.children.push(item); },
    setAttribute(key, value) { this.attributes[key] = value; }, focus() {}, reportValidity() { return true; },
    addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, once: options?.once === true }); },
    close() { this.open = false; for (const entry of [...(this.listeners.close || [])]) { if (entry.once) this.listeners.close = this.listeners.close.filter(other => other !== entry); entry.fn(); } },
    get lastChild() { return this.children.at(-1) || element(); }, get selectedOptions() { return []; } };
  return el;
}

function mount({ last = null, draft = null } = {}) {
  const elements = new Map(), listeners = {};
  const document = { hidden: false, querySelector: selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); }, createElement: () => element() };
  const $ = selector => document.querySelector(selector);
  $('#deployment-dialog').open = true; $('#workspace').hidden = false; $('#deployment-form [data-deploy-step="tracking"]').hidden = true;
  // Skrivefeltet som i en samtale, der ikke arbejder: Stop er skjult (index.html), og feltet er tomt.
  $('#stop').hidden = true;
  const owner = { root: '/projekt', chat: 'samtale' };
  const window = { ShareView: view, sharingOn: () => true, addEventListener: (name, fn) => { listeners[name] = fn; }, refreshFeatures: async () => {}, draftMessage: (...args) => { window.drafts.push(args); return draft; }, drafts: [] };
  const context = vm.createContext({ window, document, selectedOwner: () => owner, MutationObserver: class { observe() {} }, setInterval: () => 0, clearTimeout: () => {}, setTimeout: () => 0, Option: function Option(text, value) { return { textContent: text, value }; }, URL, console });
  vm.runInContext(source, context, { filename: 'ui/deployment-setup.js' });
  const calls = [];
  const api = async (method, input) => { calls.push([method, input]); if (method === 'deploymentTracking') return { root: owner.root, automatic: false, last, observed: false }; return {}; };
  const noop = () => {};
  const ui = window.DeploymentSetupUI.mount({ api, go: noop, back: noop, busy: fn => fn(), rows: noop, heading: noop, invalidate: noop, chooseProvider: noop, prepareReview: noop, input: () => ({}), receipt: noop, openDialog: noop });
  return { $, ui, listeners, window, calls };
}

async function header(last) {
  const m = mount({ last });
  m.listeners['aura:project']({ detail: { root: '/projekt' } });
  await m.ui.refresh();
  const button = m.$('#deployment-status');
  return { text: button.textContent, state: button.dataset.state, hidden: button.hidden };
}

// Farven kommer fra styles.css: kun disse tilstande står grønt eller som advarsel.
const rule = token => (styles.match(new RegExp(`([^}]*)\\{[^}]*color: var\\(--${token}\\)`, 'g')) || []).join(' ');
const green = state => new RegExp(`#deployment-status\\[data-state="${state}"\\]`).test(rule('success-ink'));
const warning = state => new RegExp(`#deployment-status\\[data-state="${state}"\\]`).test(rule('warning-ink'));

const komplai = (checks, extra = {}) => ({ id: 'release-1', state: 'READY', url: 'https://budget.komplai.run', config: { provider: 'komplai', visibility: 'public' }, target: { name: 'Budget' }, checks, ...extra });
const checked = site => ({ at: '2026-11-09T10:00:00Z', provider: { status: 'checked', visibility: 'public' }, site, content: { status: 'skipped' } });

test('R#30: en kontrolleret komplai-adresse, der ikke svarer, giver «Appen er ikke klar endnu» som advarsel i topknappen, ikke grønt', async () => {
  assert.equal(green('READY'), true, 'styles.css farver READY grønt'); assert.equal(warning('UNKNOWN'), true, 'styles.css farver UNKNOWN som advarsel');
  for (const site of [{ status: 'unreachable' }, { status: 'answered', http: 404 }, { status: 'answered', http: 502 }, { status: 'answered', http: 503 }]) {
    const r = komplai(checked(site));
    assert.equal(view.receiptSummary(r).publication.title, 'Appen er ikke klar endnu', 'kortet');
    const h = await header(r);
    assert.equal(h.text, 'komplai Run · Appen er ikke klar endnu', JSON.stringify(site));
    assert.equal(green(h.state), false, 'ikke grøn: ' + JSON.stringify(site)); assert.equal(warning(h.state), true, 'advarsel: ' + JSON.stringify(site));
  }
});

test('R#30: en kvittering uden adressekontrol står neutralt, og en svarende adresse står som «Udgivet» i grønt', async () => {
  const unchecked = await header(komplai(null));
  assert.equal(unchecked.text, 'komplai Run · ' + view.UNCHECKED);
  assert.equal(green(unchecked.state), false, 'kortet er neutralt, så topknappen er ikke grøn');
  assert.equal(warning(unchecked.state), false);
  const ready = await header(komplai(checked({ status: 'answered', http: 200 })));
  assert.equal(ready.text, 'komplai Run · Udgivet'); assert.equal(green(ready.state), true);
});

test('R#30: samme regel for de andre udbydere: en adresse, der ikke svarer efter kontrol, er ikke grøn', async () => {
  const r = { id: 'dpl_1', state: 'READY', url: 'https://test.vercel.app', config: { provider: 'vercel' }, target: { name: 'Test' }, checks: { at: '2026-11-09T10:00:00Z', provider: { status: 'checked' }, site: { status: 'unreachable' }, content: { status: 'skipped' } } };
  const h = await header(r);
  assert.equal(h.text, 'Vercel · Appen er ikke klar endnu'); assert.equal(warning(h.state), true);
});

test('R#29: topknappen siger «Log ind igen», når komplai-adgangen er udløbet eller tilbagekaldt', async () => {
  const h = await header(komplai({ at: '2026-11-09T10:00:00Z', provider: { status: 'unknown', reason: 'login' }, site: { status: 'skipped' }, content: { status: 'skipped' } }));
  assert.equal(h.text, 'komplai Run · Log ind igen'); assert.equal(warning(h.state), true);
  const failed = await header(komplai({ at: '2026-11-09T10:00:00Z', provider: { status: 'unknown' }, site: { status: 'skipped' }, content: { status: 'skipped' } }));
  assert.equal(failed.text, 'komplai Run · Status kunne ikke hentes');
});

test('T:verify-promte-ready: «Gør klar til Promte» slår integrationen til og sætter beskeden i Byg; noten siger kun det, der er sket', async () => {
  const m = mount({ draft: true });
  await m.$('#deployment-promte-prepare').onclick();
  // Objekter fra vm-konteksten har deres egen prototype; JSON sammenligner indholdet.
  assert.deepEqual(JSON.parse(JSON.stringify(m.calls.find(([method]) => method === 'featuresSave')?.[1])), { scope: 'projekt', values: { 'integration-promte': true } });
  assert.equal(m.$('#deployment-dialog').open, false, 'dialogen lukker');
  const [text, note, options] = m.window.drafts.at(-1);
  assert.match(text, /^Brug projektets Promte-skill/); assert.deepEqual({ mode: options.mode, submit: options.submit }, { mode: 'free', submit: true });
  // Noten står i appen, når beskeden er sat ind, også hvis afsendelsen venter (fx på samtykke). Den må ikke sige, at AI’en
  // allerede arbejder, men skal sige, at Promte-integrationen nu er slået til for projektet (det, den gamle prøve :68 kontrollerede).
  assert.match(note, /Promte-integrationen er slået til for projektet/, note);
  assert.doesNotMatch(note, /AI’en gør appen klar/, note);
});
