// Spor D2: den rigtige ui/deployment.js i en lille DOM, koblet til de rigtige Store, Deployments, KomplaiDeployment og
// komplai.cjs. Kun komplais hub og login er falske. Prøverne følger det, testeren klikker på, og fastholder fund R#27,
// R#29 og K1 samt sidefundene fra verify-komplai-connections (Konto og adgang på trinnene og login efter Tilbage).
// Attrappen opretter et element for enhver id, appen spørger efter. Elementer, appen selv opretter, findes derfor kun,
// når appen har oprettet dem; prøverne slår dem op med el(), som fejler, hvis elementet ikke findes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const { KomplaiDeployment } = require('../core/komplai-publish.cjs');
const { Deployments } = require('../core/deployments.cjs');
const { Store } = require('../core/store.cjs');
const { publishingState, disconnectPublishing } = require('../core/komplai.cjs');
const view = require('../ui/share-view.js');

const source = fs.readFileSync(path.join(__dirname, '../ui/deployment.js'), 'utf8');
const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('k:' + Buffer.from(value).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(2), 'base64').toString() };
const html = Buffer.from('<h1>Budget</h1>');
const artifact = { head: 'a'.repeat(40), hash: 'fingeraftryk', bytes: html.length, files: [{ file: 'index.html', data: html, sha256: createHash('sha256').update(html).digest('hex') }] };
const root = '/projekt';
const appA = '11111111-2222-4333-8444-555555555555';
const titles = { destination: 'Hvordan vil du udgive?', providers: 'Hvor vil du udgive?', app: 'Hvilken app vil du udgive til?', existing: 'Hvilken app vil du opdatere?', files: 'Klar til at udgive den gemte version?', review: 'Gennemgå udgivelsen', result: 'Seneste udgivelse', login: 'Log ind med komplai', connect: 'Forbind organisationen?', account: 'Konto og adgang', name: 'Hvad skal appen hedde?', access: 'Hvem kan åbne appen?', options: 'Hvad vil du rette?', destinationOptions: 'Hvad vil du rette ved destinationen?' };

// --- En lille DOM med de egenskaber, deployment.js bruger ---
class Element {
  constructor(doc, tag, id) {
    this.doc = doc; this.tagName = tag.toUpperCase(); this._id = ''; this.children = []; this.parent = null; this.listeners = {}; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this.type = ''; this.className = ''; this.title = ''; this.textContent = ''; this.scrollTop = 0; this._value = ''; this.selectedIndex = -1;
    const classes = new Set(); this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: c => (classes.has(c) ? classes.delete(c) : classes.add(c)) };
    if (id) this.id = id;
  }
  get id() { return this._id; }
  set id(value) { this._id = value; if (value) this.doc.ids.set(value, this); }
  get value() { return this.tagName === 'SELECT' ? this.children[this.selectedIndex]?.value ?? '' : this._value; }
  set value(value) { if (this.tagName === 'SELECT') this.selectedIndex = this.children.findIndex(option => option.value === String(value)); else this._value = String(value); }
  get options() { return this.children; }
  get selectedOptions() { return this.tagName === 'SELECT' && this.selectedIndex >= 0 ? [this.children[this.selectedIndex]] : []; }
  replaceChildren(...items) { for (const child of this.children) child.parent = null; this.children = []; this.append(...items); if (this.tagName === 'SELECT') this.selectedIndex = this.children.length ? 0 : -1; }
  append(...items) { for (const item of items) { if (item.parent) item.parent.children = item.parent.children.filter(child => child !== item); item.parent = this; this.children.push(item); } }
  prepend(...items) { for (const item of items.reverse()) { if (item.parent) item.parent.children = item.parent.children.filter(child => child !== item); item.parent = this; this.children.unshift(item); } }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, once: options?.once === true }); }
  dispatch(type) { for (const entry of [...(this.listeners[type] || [])]) { if (entry.once) this.listeners[type] = this.listeners[type].filter(other => other !== entry); entry.fn({ target: this }); } }
  focus() {} scrollIntoView() {} reportValidity() { return true; } setCustomValidity() {}
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatch('close'); }
  querySelectorAll(selector) { return this.doc.all(selector); }
  querySelector(selector) { return this.doc.query(selector); }
}
class Document {
  constructor() {
    this.ids = new Map(); this.sub = new Map();
    for (const id of ['deploy-komplai-app', 'komplai-publish-org', 'deploy-mode', 'hosting-guide-choice']) new Element(this, 'select', id);
    new Element(this, 'dialog', 'deployment-dialog'); new Element(this, 'form', 'deployment-form');
    this.get('deploy-mode').replaceChildren(...['static', 'source', 'functions'].map(value => this.option(value, value)));
    this.get('deploy-komplai-app').replaceChildren(this.option('Vælg en app', ''));
    this.get('deploy-directory').value = 'public';
    this.radios = ['private', 'public'].map(value => { const radio = new Element(this, 'input'); radio.type = 'radio'; radio.value = value; return radio; });
    const form = this.get('deployment-form');
    form.reset = () => {
      for (const id of ['deploy-komplai-name', 'deploy-komplai-slug', 'deploy-komplai-confirm', 'deploy-komplai-search', 'deploy-provider']) this.get(id).value = '';
      this.get('deploy-directory').value = 'public';
      for (const id of ['deploy-mode', 'deploy-komplai-app', 'komplai-publish-org', 'hosting-guide-choice']) { const select = this.get(id); select.selectedIndex = select.children.length ? 0 : -1; }
      for (const radio of this.radios) radio.checked = false;
    };
  }
  option(text, value) { const option = new Element(this, 'option'); option.textContent = text; option.value = value ?? text; return option; }
  get(id) { return this.ids.get(id) || new Element(this, 'div', id); }
  query(selector) {
    if (selector === '[name="komplai-visibility"]:checked') return this.radios.find(radio => radio.checked) || null;
    const simple = /^#([\w-]+)$/.exec(selector); if (simple) return this.get(simple[1]);
    if (!this.sub.has(selector)) this.sub.set(selector, new Element(this, 'div'));
    return this.sub.get(selector);
  }
  all(selector) { return selector.includes('komplai-visibility') ? this.radios : []; }
  querySelector(selector) { return this.query(selector); }
  querySelectorAll(selector) { return this.all(selector); }
  createElement(tag) { return new Element(this, tag); }
}

// --- Den rigtige kerne med en falsk hub og et falsk login ---
async function backend(t, { apps = [], connected = true } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-d2-dialog-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, safe);
  const grant = async (expiresAt = new Date(Date.now() + 86400000).toISOString()) => store.update(state => { state.hosting = { ...state.hosting, komplai: { secret: store.encrypt('komp_publish_grant_' + 'a'.repeat(64)), grantId: 'g', organisationId: 'org-1', organisationName: 'Testkommune', address: 'komplai.run', expiresAt } }; });
  if (connected) await grant();
  const hub = { apps, upload: null, overview: null, logoutOffline: false, log: [] };
  const present = a => ({ id: a.id, name: a.name, slug: a.slug, url: `https://${a.slug}.komplai.run`, visibility: a.visibility, activeRelease: a.activeRelease, releases: a.activeRelease ? [{ id: a.activeRelease }] : [] });
  const fetcher = async (url, options = {}) => {
    const u = new URL(url), route = u.pathname, method = options.method || 'GET'; hub.log.push(`${method} ${route}`);
    if (route === '/api/publish/native') return hub.overview ? hub.overview() : Response.json({ address: 'komplai.run', slugs: true, apps: hub.apps.map(present) });
    if (route === '/api/publish/native/address') return Response.json(hub.apps.some(a => a.slug === u.searchParams.get('slug') && a.id !== u.searchParams.get('appId')) ? { available: false, reason: 'slug_taken' } : { available: true, reason: null });
    if (route === '/api/publish/native/apps' && method === 'POST') { const body = JSON.parse(options.body), app = { id: crypto.randomUUID(), name: body.name, slug: body.slug || 'tilfaeldig', visibility: 'private', activeRelease: null }; hub.apps.push(app); return Response.json(present(app)); }
    const release = route.match(/^\/api\/publish\/([0-9a-f-]{36})\/releases$/);
    if (release) { const app = hub.apps.find(a => a.id === release[1]); if (hub.upload) return hub.upload(app); app.activeRelease = 'release-' + crypto.randomUUID().slice(0, 6); return Response.json(present(app)); }
    throw Error('Uventet ' + method + ' ' + route);
  };
  const provider = new KomplaiDeployment(store, { fetcher });
  const deployments = new Deployments(store, { artifact: async () => artifact, providers: { komplai: provider }, fetcher: async () => new Response(html) });
  const logout = async () => { if (hub.logoutOffline) throw Error('offline'); return Response.json({ revoked: true }); };
  const context = { projectName: 'Budget' }, calls = [];
  const handlers = {
    deploymentState: async () => ({ ...await deployments.state(root), context }),
    deploymentGuides: async () => [],
    deploymentReview: async input => ({ ...await deployments.review(root, input), context }),
    deploymentSend: async token => deployments.deploy(root, token),
    deploymentSource: async () => ({ directory: 'public', build: false }),
    deploymentCheck: async () => deployments.check(root),
    deploymentOpen: async () => true,
    komplaiPublishState: async () => publishingState(store),
    komplaiPublishOverview: async () => provider.overview(),
    komplaiPublishAddress: async value => provider.address(value?.slug, value?.appId),
    komplaiPublishDisconnect: async () => disconnectPublishing(store, undefined, logout),
    // Kanalen, main.cjs og preload.cjs skal have for «Fjern kun fra denne computer».
    komplaiPublishForget: async () => disconnectPublishing(store, undefined, logout, { force: true }),
    komplaiCancel: async () => true,
    komplaiLogin: async () => ({ organisations: [{ id: 'org-1', name: 'Testkommune', publishing: { address: 'komplai.run', tier: 'shared_free' } }] }),
    komplaiConnect: async () => { await grant(); hub.overview = null; return {}; },
  };
  const harness = new Proxy({}, { get: (_, method) => typeof method === 'string' && handlers[method] ? async input => { calls.push(method); try { return { ok: true, value: await handlers[method](input) }; } catch (error) { return { ok: false, error: error.message }; } } : undefined });
  // En udgivelse, der allerede er gemt i projektet, som når testeren har udgivet før.
  const publish = async (appId, visibility) => deployments.deploy(root, (await deployments.review(root, { provider: 'komplai', appId, visibility })).token);
  return { store, hub, deployments, harness, calls, grant, publish };
}

function mount(harness) {
  const doc = new Document(); let setupArgs;
  const setup = { choose: async () => false, config: () => ({}), restore() {}, opened() {}, refresh: async () => {}, configurationStep() {}, pages: () => false, panel: step => step, render() {}, title: () => undefined, reset() {} };
  const context = { document: doc, CustomEvent: class { constructor(type) { this.type = type; } }, setTimeout, clearTimeout, URL, console };
  context.Option = function Option(text, value) { return doc.option(text, value); };
  context.window = context; context.harness = harness; context.ShareView = view; context.sharingOn = () => true; context.dispatchEvent = () => {}; context.addEventListener = () => {};
  context.DeploymentSetupUI = { mount: args => { setupArgs = args; return setup; } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'ui/deployment.js' });
  const $ = id => doc.get(id);
  const el = id => { const found = doc.ids.get(id); assert.ok(found, `#${id} findes ikke i Udgiv`); return found; };
  const idle = async () => { for (let i = 0; i < 2000; i++) { await new Promise(resolve => setTimeout(resolve, 1)); if (!$('deployment-fields').disabled) return; } throw Error('Udgiv blev ikke færdig'); };
  const heading = () => $('deployment-heading').textContent;
  const open = async () => { $('deploy-button').onclick(); await idle(); };
  // Statusknappen øverst åbner Udgiv for at vise den seneste udgivelse (deployment-setup.js).
  const status = async () => { setupArgs.openDialog(true); await idle(); };
  const close = () => $('deployment-dialog').close();
  const choose = async provider => { await setupArgs.busy(() => setupArgs.chooseProvider(provider)); await idle(); };
  // Gennemgangens oversigt som { overskrift: tekst }.
  const summary = () => { const items = $('deployment-summary').children; return Object.fromEntries(items.flatMap((item, i) => i % 2 ? [] : [[item.textContent, items[i + 1].textContent]])); };
  const submit = async () => { $('deployment-form').onsubmit({ preventDefault() {} }); await idle(); };
  const click = async id => { await $(id).onclick(); await idle(); };
  const radio = async value => { const item = doc.radios.find(r => r.value === value); item.checked = true; item.onclick(); await idle(); };
  const mainActions = () => $('deployment-main-actions').children.map(button => button.id);
  return { doc, $, el, idle, heading, open, status, close, choose, submit, click, radio, mainActions, summary };
}

// Fra appvalget: testeren opretter en ny app, og komplai afviser uploaden, efter at appen er oprettet.
async function refusedNewApp(b, d, name = 'Budget') {
  assert.equal(d.heading(), titles.app);
  await d.click('deploy-komplai-create');
  if (d.$('deploy-komplai-name').value !== name) { d.$('deploy-komplai-name').value = name; d.$('deploy-komplai-name').oninput(); }
  await d.submit(); await d.radio('private'); await d.submit(); assert.equal(d.heading(), titles.review);
  b.hub.upload = () => Response.json({ error: 'busy' }, { status: 503 });
  await d.click('deployment-send');
  const created = b.hub.apps.find(app => app.name === name);
  assert.ok(created, 'komplai oprettede appen før afvisningen'); assert.match(d.$('deployment-feedback').textContent, /travlt/);
  return created;
}
// Fra en live app til appvalget: Udgiv en ny version › Ret filer og indstillinger › Destination og app › Skift app.
async function changeApp(d) {
  await d.open(); await d.click('deployment-new');
  await d.click('deployment-file-options'); await d.click('deployment-change-destination'); await d.click('deployment-change-app');
}

// Fra kvitteringen til Konto og adgang. Fra kortet er det én knap.
async function account(d) { await d.click('deployment-komplai-account'); assert.equal(d.heading(), titles.account); }

test('R#27: komplai opretter appen og afviser uploaden: næste «Gennemgå udgivelse» går til den samme app, og Tilbage fører til appvalget', async t => {
  const b = await backend(t), d = mount(b.harness);
  await d.open(); await d.choose('komplai'); assert.equal(d.heading(), titles.app);
  await d.click('deploy-komplai-create'); assert.equal(d.$('deploy-komplai-slug').value, 'budget');
  await d.submit(); await d.radio('private'); assert.equal(d.heading(), titles.files);
  await d.submit(); assert.equal(d.heading(), titles.review);
  b.hub.upload = () => Response.json({ error: 'busy' }, { status: 503 });
  await d.click('deployment-send');
  const created = b.hub.apps.find(app => app.name === 'Budget');
  assert.ok(created, 'komplai oprettede appen før afvisningen');
  assert.match(d.$('deployment-feedback').textContent, /travlt/);
  assert.equal(d.heading(), titles.files, 'testeren bliver i forløbet og kan prøve igen herfra');
  assert.equal(d.$('deploy-komplai-app').value, created.id, 'den oprettede app er valgt til næste forsøg');
  // Tilbage fører til appvalget og ikke til det samme trin igen.
  await d.click('deployment-back'); assert.equal(d.heading(), titles.app);
  await d.click('deploy-komplai-choose'); assert.equal(d.heading(), titles.existing);
  assert.equal(d.$('deploy-komplai-app').value, created.id);
  b.hub.upload = null;
  await d.submit(); assert.equal(d.heading(), titles.files);
  await d.submit(); assert.equal(d.heading(), titles.review, d.$('deployment-feedback').textContent);
  await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  assert.equal(b.hub.apps.length, 1, 'der er ikke oprettet en app mere');
  assert.ok(created.activeRelease, 'versionen er udgivet til den oprettede app');
  assert.equal((await b.store.project(root)).deploymentLast.appId, created.id);
});

test('R#27: med en live app i forvejen viser en afvist upload til en ny app ikke den gamle kvittering, og næste forsøg går til den nye app', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'private'); const before = (await b.store.project(root)).deploymentLast;
  await d.open(); assert.equal(d.heading(), titles.result);
  await d.click('deployment-new'); assert.equal(d.heading(), titles.files);
  await d.click('deployment-file-options'); await d.click('deployment-change-destination'); await d.click('deployment-change-app'); assert.equal(d.heading(), titles.app);
  await d.click('deploy-komplai-create'); d.$('deploy-komplai-name').value = 'Ny app'; d.$('deploy-komplai-name').oninput();
  await d.submit(); await d.radio('private'); await d.submit(); assert.equal(d.heading(), titles.review);
  b.hub.upload = () => Response.json({ error: 'busy' }, { status: 503 });
  await d.click('deployment-send');
  const created = b.hub.apps.find(app => app.name === 'Ny app');
  assert.deepEqual((await b.store.project(root)).deploymentLast, before, 'kvitteringen for den live app er bevaret');
  assert.equal(d.heading(), titles.files, 'den gamle apps kort vises ikke som svar på forsøget');
  assert.equal(d.$('deploy-komplai-app').value, created.id);
  b.hub.upload = null;
  await d.submit(); await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  assert.equal((await b.store.project(root)).deploymentLast.appId, created.id, 'versionen gik til den nye app, ikke til den gamle');
  assert.equal(b.hub.apps.length, 2);
});

test('R#27: en afvisning af en ny version til en eksisterende app holder testeren i forløbet, og Tilbage fører til appvalget', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Budget', slug: 'budget', visibility: 'private', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'private');
  await d.open(); await d.click('deployment-new'); assert.equal(d.heading(), titles.files);
  await d.submit(); assert.equal(d.heading(), titles.review);
  b.hub.upload = () => Response.json({ error: 'storage_limit' }, { status: 507 });
  await d.click('deployment-send');
  assert.equal(d.heading(), titles.files); assert.match(d.$('deployment-feedback').textContent, /plads til apps er brugt/);
  await d.click('deployment-back'); assert.equal(d.heading(), titles.app, 'første Tilbage virker');
});

// Skeptikerens forløb (a): projektet har en live app, afvisningen af den nye app, Luk og Udgiv igen.
test('R#27: efter Luk fortsætter Udgiv til appen, komplai oprettede ved det afviste forsøg, også når projektet har en live app', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'private'); const before = (await b.store.project(root)).deploymentLast;
  await changeApp(d);
  const created = await refusedNewApp(b, d, 'Ny app');
  d.close(); b.hub.upload = null;
  await d.open();
  assert.equal(d.heading(), titles.files, 'Udgiv fortsætter forsøget i stedet for at vise den gamle apps kort');
  assert.equal(d.$('deploy-komplai-app').value, created.id, 'den oprettede app er valgt, ikke den gamle');
  assert.equal(d.$('deploy-komplai-current').textContent, 'ny-app.komplai.run · Organisationen. Appen har ingen version endnu.');
  assert.match(d.$('deployment-feedback').textContent, /«Ny app»/, 'skærmen siger, hvorfor Udgiv starter her');
  assert.deepEqual((await b.store.project(root)).deploymentLast, before, 'den live apps kvittering er bevaret');
  await d.submit(); assert.equal(d.heading(), titles.review, d.$('deployment-feedback').textContent);
  assert.equal(d.$('deployment-review-app-name').textContent, 'Ny app');
  await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  assert.equal(b.hub.log.filter(line => line === 'POST /api/publish/native/apps').length, 1, 'ingen ny app ved forsøget efter genåbningen');
  assert.equal((await b.store.project(root)).deploymentLast.appId, created.id); assert.ok(created.activeRelease);
});

test('R#27: «Udgiv en ny version» på den live apps kort går også til den oprettede app efter Luk, og Eksisterende app har den valgt', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'private');
  await changeApp(d);
  const created = await refusedNewApp(b, d, 'Ny app');
  d.close(); b.hub.upload = null;
  await d.status(); assert.equal(d.heading(), titles.result, 'statusknappen viser den seneste udgivelse');
  assert.equal(d.$('deployment-result-app-name').textContent, 'Gammel');
  await d.click('deployment-new');
  assert.equal(d.heading(), titles.files); assert.equal(d.$('deploy-komplai-app').value, created.id, 'næste forsøg går til den oprettede app, ikke til den gamle');
  await d.click('deployment-back'); assert.equal(d.heading(), titles.app, 'Tilbage fører til appvalget');
  await d.click('deploy-komplai-choose'); assert.equal(d.heading(), titles.existing);
  assert.equal(d.$('deploy-komplai-app').value, created.id, 'Eksisterende app har den oprettede app valgt');
});

// Skeptikerens forløb (b): ingen tidligere udgivelse, afvisningen, Luk og Udgiv igen.
test('R#27: uden en tidligere udgivelse fortsætter Udgiv efter Luk til den oprettede app, også når komplai vælges igen, og der oprettes ingen ny app', async t => {
  const b = await backend(t), d = mount(b.harness);
  await d.open(); await d.choose('komplai');
  const created = await refusedNewApp(b, d);
  d.close(); b.hub.upload = null;
  await d.open();
  assert.equal(d.heading(), titles.files); assert.equal(d.$('deploy-komplai-app').value, created.id);
  assert.equal(d.$('deploy-komplai-current').textContent, 'budget.komplai.run · Organisationen. Appen har ingen version endnu.');
  // Tilbage til udbyderne og komplai igen fører til den samme app, ikke til et appvalg uden forvalg.
  await d.click('deployment-back'); assert.equal(d.heading(), titles.app);
  await d.click('deployment-back'); assert.equal(d.heading(), titles.providers);
  await d.choose('komplai'); assert.equal(d.heading(), titles.files); assert.equal(d.$('deploy-komplai-app').value, created.id);
  await d.submit(); assert.equal(d.heading(), titles.review, d.$('deployment-feedback').textContent);
  await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  assert.equal(b.hub.apps.length, 1, 'ingen ny app og ingen «Adressen er allerede i brug»'); assert.ok(created.activeRelease);
});

// Skeptikerens forløb (b) til ende: testeren vælger alligevel Ny app med samme navn og adresse.
test('R#27: vælger testeren alligevel Ny app med den oprettede apps adresse, siger Udgiv det og peger på Eksisterende app i stedet for at oprette endnu en', async t => {
  const b = await backend(t), d = mount(b.harness);
  await d.open(); await d.choose('komplai');
  const created = await refusedNewApp(b, d);
  d.close(); b.hub.upload = null;
  await d.open(); assert.equal(d.heading(), titles.files);
  await d.click('deployment-back'); assert.equal(d.heading(), titles.app);
  await d.click('deploy-komplai-create'); assert.equal(d.$('deploy-komplai-slug').value, 'budget');
  const own = 'Adressen bruges af appen «Budget», som komplai oprettede ved sidste forsøg. Vælg den under Eksisterende app, eller vælg en anden adresse.';
  // Ret adressen: kontrollen siger det samme, mens testeren skriver.
  await d.click('deploy-komplai-edit-address'); await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(d.$('deploy-komplai-slug-help').textContent, own);
  await d.submit(); assert.equal(d.heading(), titles.name);
  await d.submit(); await d.radio('private'); await d.submit();
  assert.equal(d.heading(), titles.files); assert.equal(d.$('deployment-feedback').textContent, own);
  assert.equal(b.hub.apps.length, 1, 'der er ikke oprettet en app mere');
  // Eksisterende app fører til den oprettede app.
  for (const step of [titles.access, titles.name, titles.app]) { await d.click('deployment-back'); assert.equal(d.heading(), step); }
  await d.click('deploy-komplai-choose'); d.$('deploy-komplai-app').value = created.id; d.$('deploy-komplai-app').onchange(); await d.idle();
  assert.equal(d.heading(), titles.files);
  await d.submit(); await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  assert.equal(b.hub.apps.length, 1); assert.ok(created.activeRelease);
});

test('R#27: gennemgår testeren en anden app efter afvisningen, går det nyeste valg forud: komplai fører til appvalget, og Luk viser kortet som før', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'private');
  await changeApp(d);
  await refusedNewApp(b, d, 'Ny app');
  b.hub.upload = null;
  await d.click('deployment-back'); assert.equal(d.heading(), titles.app);
  await d.click('deploy-komplai-choose'); d.$('deploy-komplai-app').value = appA; d.$('deploy-komplai-app').onchange(); await d.idle();
  await d.submit(); assert.equal(d.heading(), titles.review); assert.equal(d.$('deployment-review-app-name').textContent, 'Gammel');
  await d.click('deployment-edit'); assert.equal(d.heading(), titles.files);
  await d.click('deployment-back'); assert.equal(d.heading(), titles.providers);
  await d.choose('komplai'); assert.equal(d.heading(), titles.app, 'den gamle app var testerens nyeste valg');
  d.close(); await d.open(); assert.equal(d.heading(), titles.result, 'efter Luk viser Udgiv den live apps kort som før');
});

test('R#27: er komplai-adgangen udløbet ved genåbningen, åbner Udgiv som ellers, og login fører derefter til den oprettede app', async t => {
  const b = await backend(t), d = mount(b.harness);
  await d.open(); await d.choose('komplai');
  const created = await refusedNewApp(b, d);
  d.close(); b.hub.upload = null; await b.grant(new Date(Date.now() - 1000).toISOString());
  await d.open(); assert.equal(d.heading(), titles.destination, 'uden gyldig adgang vises Udgiv som ellers');
  await d.choose('komplai'); assert.equal(d.heading(), titles.login);
  await d.$('komplai-publish-login').onclick(); await d.idle(); assert.equal(d.heading(), titles.connect);
  await d.click('komplai-publish-confirm');
  assert.equal(d.heading(), titles.files, 'efter login fortsætter Udgiv til den oprettede app');
  assert.equal(d.$('deploy-komplai-app').value, created.id);
});

test('R#27: kan oversigten ikke hentes lige efter afvisningen, går næste «Gennemgå udgivelse» alligevel til den oprettede app', async t => {
  const b = await backend(t), d = mount(b.harness);
  await d.open(); await d.choose('komplai');
  await d.click('deploy-komplai-create'); await d.submit(); await d.radio('private'); await d.submit(); assert.equal(d.heading(), titles.review);
  const busy = () => Response.json({ error: 'busy' }, { status: 503 });
  // komplai afviser uploaden, og den næste oversigt fejler også.
  b.hub.upload = () => { b.hub.overview = () => { b.hub.overview = null; return busy(); }; return busy(); };
  await d.click('deployment-send');
  const created = b.hub.apps.find(app => app.name === 'Budget');
  assert.equal(d.heading(), titles.files); assert.equal(d.$('deploy-komplai-app').value, '', 'appen kunne ikke vælges endnu');
  b.hub.upload = null;
  await d.submit(); assert.equal(d.heading(), titles.review, d.$('deployment-feedback').textContent);
  assert.equal(d.$('deploy-komplai-app').value, created.id);
  await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  assert.equal(b.hub.apps.length, 1, 'ingen ny app'); assert.ok(created.activeRelease);
});

test('R#27: filtrin og gennemgang siger det samme om en app uden version: «Første version af appen», ikke «Erstatter den udgivne version»', async t => {
  const b = await backend(t), d = mount(b.harness);
  await d.open(); await d.choose('komplai');
  await refusedNewApp(b, d);
  assert.equal(d.$('deploy-komplai-current').textContent, 'budget.komplai.run · Organisationen. Appen har ingen version endnu.');
  b.hub.upload = null;
  await d.submit(); assert.equal(d.heading(), titles.review);
  assert.equal(d.summary().Udgivelse, 'Første version af appen');
  await d.click('deployment-send'); assert.equal(d.heading(), titles.result);
  // Har appen en udgivet version, erstatter den nye version den.
  await d.click('deployment-new'); assert.equal(d.heading(), titles.files);
  assert.equal(d.$('deploy-komplai-current').textContent, 'budget.komplai.run · Organisationen. En ny version erstatter den udgivne.');
  await d.submit(); assert.equal(d.heading(), titles.review);
  assert.equal(d.summary().Udgivelse, 'Erstatter den udgivne version');
});

test('R#29: Konto og adgang med en udløbet adgang fører til login og siger hvorfor, ikke til «Forbundet»', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Budget', slug: 'budget', visibility: 'public', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'public'); await b.grant(new Date(Date.now() - 1000).toISOString());
  await d.open(); assert.equal(d.heading(), titles.result);
  await d.click('deployment-komplai-account');
  assert.equal(d.heading(), titles.login);
  assert.match(d.$('komplai-publish-feedback').textContent, /udløbet/);
  assert.equal(d.$('komplai-publish-login').hidden, false);
});

test('R#29: Kontrollér med en tilbagekaldt adgang beder om login; «Log ind og kontrollér» henter status efter login', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Budget', slug: 'budget', visibility: 'public', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'public');
  b.hub.overview = () => Response.json({ error: 'unauthorised' }, { status: 401 });
  await d.open(); await d.click('deployment-check');
  assert.equal(d.$('deployment-state').textContent, 'Log ind med komplai igen');
  assert.doesNotMatch(d.$('deployment-state-note').textContent, /Prøv statuskontrollen igen/);
  const login = d.el('deployment-login');
  assert.deepEqual(d.mainActions(), ['deployment-login']); assert.equal(login.classList.contains('primary'), true); assert.equal(login.hidden, false);
  assert.equal(login.textContent, 'Log ind og kontrollér');
  await d.click('deployment-login'); assert.equal(d.heading(), titles.login);
  await d.$('komplai-publish-login').onclick(); await d.idle(); assert.equal(d.heading(), titles.connect);
  const checksBefore = b.calls.filter(call => call === 'deploymentCheck').length;
  await d.click('komplai-publish-confirm');
  assert.equal(b.calls.filter(call => call === 'deploymentCheck').length, checksBefore + 1, 'knappen sagde kontrollér, så status hentes efter login');
  assert.equal(d.heading(), titles.result);
  assert.equal(d.$('deployment-state').textContent, 'Udgivet');
  assert.equal(login.hidden, true);
});

test('K1: når Log ud fejler uden net, kan adgangen fjernes fra denne computer alene, og skærmen siger, hvad det betyder', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Budget', slug: 'budget', visibility: 'private', activeRelease: null }] }), d = mount(b.harness);
  await b.publish(appA, 'private');
  // Kontotrinnet med en valgt app: Udgiv en ny version › Ret filer og indstillinger › Destination og app › Konto og adgang. Fra
  // kortet er appen ikke hentet, så «Skift adgang i komplai» var skjult uanset rettelsen, og vagten kunne ikke fyre (N:D2-4).
  await d.open(); await d.click('deployment-new'); assert.equal(d.$('deploy-komplai-app').value, appA);
  await d.click('deployment-file-options'); await d.click('deployment-change-destination'); await d.click('deployment-account');
  assert.equal(d.heading(), titles.account); assert.equal(d.$('deploy-komplai-access').hidden, false, 'med en valgt app kan adgangen skiftes i komplai');
  b.hub.logoutOffline = true;
  await d.click('komplai-publish-logout');
  assert.equal(d.heading(), titles.account);
  assert.match(d.$('deployment-feedback').textContent, /kunne ikke kontaktes/);
  const forget = d.el('komplai-publish-forget');
  assert.equal(forget.hidden, false); assert.equal(forget.textContent, 'Fjern kun fra denne computer');
  assert.equal(d.$('deploy-komplai-access').hidden, true, 'trinnet har højst fire synlige valg: Log ud, Fjern, Tilbage og Luk');
  assert.equal((await publishingState(b.store)).connected, true, 'intet er fjernet, før testeren vælger det');
  await d.click('komplai-publish-forget');
  assert.equal(b.calls.includes('komplaiPublishForget'), true);
  assert.equal((await publishingState(b.store)).connected, false);
  assert.equal(d.heading(), titles.login);
  assert.match(d.$('komplai-publish-feedback').textContent, /fjernet fra denne computer.*gyldig hos komplai/);
  // Næste gang er knappen væk igen, til Log ud fejler.
  d.$('deployment-dialog').close(); await b.grant(); await d.open(); await account(d);
  assert.equal(forget.hidden, true);
});

// Kvitteringens Konto og adgang (under Se detaljer) står ikke på trinnene i forløbet. Appvalget har sit eget link (N:D2-3), og
// tests/d2-runde2.test.cjs tæller de synlige valg med den rigtige markup.
test('Kvitteringens Konto og adgang står kun på kvitteringen; appvalget har sit eget link, og de andre trin har intet', async t => {
  const b = await backend(t, { apps: [{ id: appA, name: 'Gammel', slug: 'gammel', visibility: 'private', activeRelease: 'release-0' }] }), d = mount(b.harness);
  const hidden = () => d.$('deployment-komplai-account').hidden;
  await d.open(); await d.choose('komplai'); assert.equal(d.heading(), titles.app); assert.equal(d.$('deploy-komplai-choose').hidden, false);
  assert.equal(hidden(), true, 'appvalget: Ny app, Eksisterende app og sit eget Konto og adgang, Tilbage og Luk');
  // Attrappen kender id'et, også før elementet er sat ind, så prøven kontrollerer også, at linket står i appvalget.
  const link = d.el('deploy-komplai-account');
  assert.equal(link.hidden, false, 'appvalgets eget Konto og adgang'); assert.equal(link.parent, d.doc.query('[data-deploy-step="app"]'), 'linket står i appvalget');
  await d.click('deploy-komplai-create'); assert.equal(d.heading(), titles.name); assert.equal(hidden(), true, 'navn');
  await d.submit(); assert.equal(d.heading(), titles.access); assert.equal(hidden(), true, 'adgang');
  await d.radio('private'); assert.equal(d.heading(), titles.files); assert.equal(hidden(), true, 'filer');
  await d.click('deployment-file-options'); assert.equal(d.heading(), titles.options); assert.equal(hidden(), true, 'ret');
  await d.click('deployment-change-destination'); assert.equal(d.heading(), titles.destinationOptions); assert.equal(hidden(), true, 'destination');
  await d.click('deployment-back'); await d.click('deployment-back'); assert.equal(d.heading(), titles.files);
  await d.submit(); assert.equal(d.heading(), titles.review); assert.equal(hidden(), true, 'gennemgang');
  await d.click('deployment-send'); assert.equal(d.heading(), titles.result); assert.equal(hidden(), false, 'kvitteringen har Konto og adgang');
});

test('Login efter Tilbage: login-trinnet viser «Log ind med komplai» igen og afbryder det ventende login', async t => {
  const b = await backend(t, { connected: false }), d = mount(b.harness);
  await d.open(); await d.choose('komplai'); assert.equal(d.heading(), titles.login);
  await d.$('komplai-publish-login').onclick(); await d.idle(); assert.equal(d.heading(), titles.connect);
  const cancels = b.calls.filter(call => call === 'komplaiCancel').length;
  await d.click('deployment-back');
  assert.equal(d.heading(), titles.login);
  assert.equal(d.$('komplai-publish-login').hidden, false, 'knappen Log ind med komplai er synlig');
  assert.equal(d.$('komplai-publish-cancel').hidden, true);
  assert.equal(b.calls.filter(call => call === 'komplaiCancel').length, cancels + 1, 'det ventende login er afbrudt');
  await d.$('komplai-publish-login').onclick(); await d.idle(); assert.equal(d.heading(), titles.connect, 'et nyt login virker');
});
