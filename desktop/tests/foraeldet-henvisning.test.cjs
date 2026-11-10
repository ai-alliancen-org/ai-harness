// Q:B2-2 (fund 13, anden halvdel): en filhenvisning i skrivefeltet, der ikke passer til filen længere, fordi filen er ændret
// eller slettet, fik prepare til at afvise beskeden med fx «index.html: Linjerne findes ikke i filen.». Henvisningen blev
// stående, så hvert Send gav samme fejl, til brugeren fandt ×. Nu fjernes netop de henvisninger, der ikke kan bruges, og
// beskeden siger på dansk, hvilken det var, og hvad brugeren kan gøre.
// Prøven bruger den rigtige ChatSession.prepare og projectFiles.readFile (samme læsning som Kode-fanen) og de ordrette
// udsnit af ui/workspace.js og ui/app.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Workbench } = require('../core/workbench.cjs');
const projectFiles = require('../core/project-files.cjs');

const workspaceSource = fs.readFileSync(path.join(__dirname, '../ui/workspace.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (kilde, fra, til) => { const a = kilde.indexOf(fra), b = kilde.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return kilde.slice(a, b); };
const linje = (kilde, fra) => { const a = kilde.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return kilde.slice(a, kilde.indexOf('\n', a)); };
const plain = value => JSON.parse(JSON.stringify(value));

// Et projekt med en fil på tre linjer. Henvisningen til linje 40-52 er fra før, filen blev kortere.
async function projekt(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-henvisning-')); t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'projekt'); await fsp.mkdir(root);
  await fsp.writeFile(path.join(root, 'index.html'), '<h1>Hej</h1>\n<p>Kort</p>\n<p>Side</p>');
  await fsp.writeFile(path.join(root, 'style.css'), 'h1 { color: red; }');
  return { directory, root };
}
// Den rigtige prepare med et fast modelvalg, så der ikke skal bruges en forbindelse.
async function bench(t, root, directory) {
  const workbench = new Workbench({ directory: path.join(directory, 'data'), profiles: path.join(__dirname, '../../profiles'), emit() {}, safeStorage: {} });
  await workbench.activate({ root, name: 'Henvisninger' }); t.after(() => workbench.close());
  workbench.selection = async () => ({ connection: { id: 'c', kind: 'compatible', name: 'Test', baseURL: 'http://127.0.0.1:9/v1' }, model: { id: 'm', name: 'm' }, route: null });
  return workbench;
}

class El {
  constructor(tag = 'div', text = '') { this.tagName = tag; this.text = text || ''; this.children = []; this.hidden = false; this.value = ''; this.checked = false; this.disabled = false; this.dataset = {}; this.listeners = {}; this.attributes = {}; }
  get textContent() { return this.text + this.children.map(item => typeof item === 'string' ? item : item.textContent).join(' '); }
  set textContent(value) { this.text = value; this.children = []; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() {}
}
// Skrivefeltets henvisninger fra ui/workspace.js og Send-handleren fra ui/app.js i samme lille DOM. Hovedprocessen er den
// rigtige prepare og den rigtige readFile bag codeRead.
async function skrivefelt(t, { root, directory }) {
  const workbench = await bench(t, root, directory);
  const elements = new Map(), $ = selector => { if (!elements.has(selector)) elements.set(selector, new El()); return elements.get(selector); };
  const beskeder = [], handlinger = [], forberedt = [];
  const harness = {
    prepare: async value => { forberedt.push(plain(value.fileRefs)); try { return { ok: true, value: await workbench.chat.prepare(value) }; } catch (error) { return { ok: false, error: error.message }; } },
    codeRead: async file => projectFiles.readFile(root, file).then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }))
  };
  const context = {
    $, navigator: { platform: 'MacIntel' }, view: {}, current: { root }, running: false, projectLoading: false, pendingSend: null, acceptedFingerprint: null, activePlan: null,
    state: { connections: [{ id: 'c' }] }, selectedOwner: () => ({ root, chat: 'samtale' }), updateWorkMode() {}, saveChatDraft() {}, applyRunning() {}, reviewKey: data => data.fingerprint,
    async sendNow() {}, showData() {}, showSetup() {}, openTaskSettings() {}, connectionFailed() {},
    node: (tag, text) => new El(tag, text), message(text, error) { beskeder.push({ text, error }); },
    window: { ConversationMode: require('../ui/conversation-mode.js'), harness }
  };
  vm.createContext(context);
  vm.runInContext(linje(appSource, 'async function call(method, value, owner) {'), context);
  vm.runInContext(linje(appSource, 'async function action(fn) {'), context);
  const action = context.action; context.action = fn => { const promise = action(fn); handlinger.push(promise); return promise; };
  // Henvisningerne og deres oprydning, som de står i workspace.js, med skrivefeltets API.
  vm.runInContext(`${udsnit(workspaceSource, '// ---------- Filhenvisninger til AI\'en ----------', '// ---------- Filhenvisninger i samtalen ----------')}
    window.workspace = { references: () => references.map(ref => ({ ...ref })), add: ref => { references.push(ref); renderReferences(); }, dropStale: typeof dropStale === 'function' ? dropStale : undefined };`, context);
  vm.runInContext(udsnit(appSource, "$('#data-button').onclick", "$('#stop').onclick"), context);
  context.selection = () => ({ mode: 'chat', includeHistory: false, connectionID: 'c', modelID: 'm', text: $('#prompt').value, fileRefs: context.window.workspace.references() });
  $('#prompt').value = 'Ret overskriften'; $('#work-mode').value = 'chat'; $('#connection-select').value = 'c'; $('#model-select').value = 'm'; $('#route-row').hidden = true;
  return { context, $, beskeder, forberedt, harness, add: ref => context.window.workspace.add(ref), refs: () => plain(context.window.workspace.references()), send: async () => { $('#chat-form').onsubmit({ preventDefault() {} }); await Promise.all(handlinger); }, gennemgaa: async () => { $('#data-button').onclick(); await Promise.all(handlinger); } };
}

test('en henvisning, der ikke passer til filen længere, fjernes fra beskeden, og næste Send har den ikke med', async t => {
  const h = await skrivefelt(t, await projekt(t));
  const gyldig = { path: 'index.html', from: 1, to: 2 }, gammel = { path: 'index.html', from: 40, to: 52 }, anden = { path: 'style.css' };
  for (const ref of [gyldig, gammel, anden]) h.add(ref);
  await h.send();
  assert.equal(h.beskeder.length, 1);
  assert.match(h.beskeder[0].text, /^Henvisningen til index\.html · linje 40.52 er fjernet fra beskeden\. Linjerne findes ikke i filen\. Send igen, eller henvis til filen på ny under Kode\.$/);
  assert.equal(h.beskeder[0].error, true);
  assert.deepEqual(h.refs(), [gyldig, anden], 'kun den henvisning, der ikke kan bruges, er fjernet');
  await h.send();
  assert.equal(h.beskeder.length, 1, 'næste Send giver ikke samme fejl');
  assert.deepEqual(h.forberedt.at(-1), [gyldig, anden]);
});

test('er filen slettet, fjernes alle henvisninger til den', async t => {
  const material = await projekt(t), h = await skrivefelt(t, material);
  h.add({ path: 'style.css', from: 1, to: 1 }); h.add({ path: 'style.css' }); h.add({ path: 'index.html' });
  await fsp.rm(path.join(material.root, 'style.css'));
  await h.send();
  // En slettet fil kan man ikke henvise til igen, så beskeden foreslår det ikke (skeptikerens fund).
  assert.match(h.beskeder[0].text, /^2 henvisninger til style\.css er fjernet fra beskeden\. Filen findes ikke i projektet\. Send igen\.$/);
  assert.deepEqual(h.refs(), [{ path: 'index.html' }]);
});

// Skeptikerens fund: når henvisningen fjernes, fordi filen er blevet for stor eller kan indeholde en hemmelighed, sluttede
// beskeden med «henvis til filen på ny under Kode». Det kan ikke lade sig gøre for den fil, fordi Kode ikke viser den.
test('en fil, der er blevet for stor eller kan indeholde en hemmelighed, foreslår ikke en ny henvisning', async t => {
  const material = await projekt(t), h = await skrivefelt(t, material);
  h.add({ path: 'style.css' }); h.add({ path: 'index.html', from: 1, to: 1 });
  await fsp.writeFile(path.join(material.root, 'style.css'), 'const apiKey = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";');
  await h.send();
  assert.match(h.beskeder[0].text, /^Henvisningen til style\.css er fjernet fra beskeden\. Filen kan indeholde en nøgle eller adgangskode, så den vises ikke her\. Send igen\.$/);
  await fsp.writeFile(path.join(material.root, 'index.html'), 'x'.repeat(1024 * 1024 + 1));
  await h.send();
  assert.match(h.beskeder[1].text, /^Henvisningen til index\.html · linje 1 er fjernet fra beskeden\. Filen er for stor til at blive vist her\. Grænsen er 1 MB\. Send igen\.$/);
  assert.deepEqual(h.refs(), []);
});

test('andre fejl i forberedelsen rører ikke henvisningerne', async t => {
  const h = await skrivefelt(t, await projekt(t));
  h.harness.prepare = async () => ({ ok: false, error: 'Denne handling er allerede i gang. Du kan fortsat bruge de andre projekter.' });
  h.harness.codeRead = async () => { throw new Error('må ikke læses'); };
  h.add({ path: 'index.html', from: 40, to: 52 });
  await h.send();
  assert.equal(h.beskeder[0].text, 'Denne handling er allerede i gang. Du kan fortsat bruge de andre projekter.');
  assert.equal(h.refs().length, 1);
});

test('Før du sender rydder også en henvisning, der ikke passer længere', async t => {
  const h = await skrivefelt(t, await projekt(t));
  h.add({ path: 'index.html', from: 40, to: 52 });
  await h.gennemgaa();
  assert.match(h.beskeder[0].text, /^Henvisningen til index\.html · linje 40.52 er fjernet fra beskeden\. Linjerne findes ikke i filen\./);
  assert.deepEqual(h.refs(), []);
});
