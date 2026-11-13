// Projektskift og modelkataloget (T:test-mistral). Prøven kører de ordrette udsnit af ui/app.js i en lille DOM,
// som tests/setup-error-scope.test.cjs gør, med en <select>, der følger HTML's regler.
// 1) displayProject ventede på kataloget uden at fange fejlen. Et katalog, der afviste nøglen, stoppede åbningen
//    før reserven, der viser projektets gemte valg, og før samtalen blev fyldt i. Efter en reparation valgte
//    loadModels så udbyderens udgangspunkt over brugerens model.
// 2) Skrivefeltet beholdt det forrige projekts tekst, mens kataloget blev hentet eller fejlede. Et tastetryk eller
//    næste skift gemte teksten som det nye projekts kladde.
// 3) Åbn projekt og sidepanelet låste ikke afsendelsen, mens kataloget blev hentet, som start og oprettelse gør. Chippen
//    viste Vælg AI, og Send åbnede modelvalget med «Vælg model og eventuel modeludbyder.», selv om projektet havde en
//    gemt model. Låsen må hverken slippes for tidligt eller blive hængende, når åbninger overlapper hinanden.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KILDE = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const udsnit = (fra, til) => { const a = KILDE.indexOf(fra), b = KILDE.indexOf(til, a + 1); if (a < 0 || b < 0) throw new Error('udsnit ikke fundet: ' + fra); return KILDE.slice(a, b); };
const linje = fra => { const a = KILDE.indexOf(fra); if (a < 0) throw new Error('linje ikke fundet: ' + fra); return KILDE.slice(a, KILDE.indexOf('\n', a)); };
// Opstartens egen frigivelse af låsen: finally-blokken i opstartens action, som den står i app.js.
const OPSTART_SLIPPER = (() => { const l = linje('action(async () => { syncCreateAvailability();'); return l.slice(l.lastIndexOf('} finally {') + '} finally {'.length, l.lastIndexOf('} });')); })();

const CONN = 'conn-mistral';
const GEMT = { connectionID: CONN, modelID: 'mistral-large-4', routeID: '' };
const katalog = () => [
  { id: 'mistral-medium-latest', name: 'Mistral Medium', price: null, capabilities: { tools: true } },
  { id: 'mistral-large-4', name: 'Mistral Large 4', price: null, capabilities: { tools: true } },
  { id: 'mistral-large-2512', name: 'Mistral Large 3', price: null, capabilities: { tools: true } }
];

function miljoe() {
  const log = [], kald = [];
  class El {
    constructor(tag = 'div') { this.tagName = tag; this._text = ''; this.children = []; this.hidden = false; this.dataset = {}; this.disabled = false; this.open = false; this.value = ''; this.checked = false; this.attrs = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
    set textContent(v) { this.children = []; this._text = String(v); }
    append(...items) { for (const i of items) this.children.push(typeof i === 'string' ? Object.assign(new El('#text'), { _text: i }) : i); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; } getAttribute(k) { return this.attrs[k] ?? null; }
    focus() {} reset() {} scrollIntoView() {} click() {}
  }
  // En <select> med HTML's regler: værdien er den valgte options værdi, og en ukendt værdi giver ''.
  class Select extends El {
    constructor() { super('select'); this.sel = -1; delete this.value; }
    get options() { return this.children; }
    append(...items) { super.append(...items); if (this.sel < 0 && this.children.length) this.sel = 0; }
    replaceChildren(...items) { this.children = []; this.sel = -1; this.append(...items); }
    get value() { return this.sel >= 0 ? this.children[this.sel].value : ''; }
    set value(v) { this.sel = this.children.findIndex(o => o.value === String(v)); }
    get selectedOptions() { return this.sel >= 0 ? [this.children[this.sel]] : []; }
  }
  const document = { body: { classList: { add() {}, remove() {}, toggle() {} } }, querySelectorAll: () => [], createElement: tag => tag === 'select' ? new Select() : new El(tag), createTextNode: text => Object.assign(new El('#text'), { _text: text }) };
  const elementer = new Map(), selects = new Set(['#model-select', '#connection-select', '#route-select', '#setup-connection', '#work-mode']);
  const $ = s => { if (!elementer.has(s)) elementer.set(s, selects.has(s) ? new Select() : new El()); return elementer.get(s); };
  // Arbejdsmåderne findes som options, så fillChat kan sætte dem.
  $('#work-mode').append(...['chat', 'plan', 'free', 'build'].map(value => Object.assign(new El('option'), { value })));
  const styring = { katalog: 'ok', ventende: [] };
  const timere = [];
  const c = {
    $, document, console, Map, Set, Promise, Error, JSON,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: { _d: new Map(), setItem(k, v) { this._d.set(k, String(v)); }, getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }, removeItem(k) { this._d.delete(k); } },
    clearTimeout() {}, setTimeout(fn) { timere.push(fn); return timere.length; }, requestAnimationFrame() {},
    window: {
      harness: { selectContext() {} }, dispatchEvent() {}, previewServer: null,
      workspace: { onProject() { log.push('workspace.onProject'); } }, versions: { refreshStatus() { log.push('versions.refreshStatus'); } },
      HistoryPages: require('../ui/history-pages.js'), ModelAdvice: require('../ui/model-advice.js'),
      ProviderBrand: { decorate(button, { label } = {}) { button.textContent = label; } }
    },
    views: new Map(), view: null, current: null, state: null, running: false, activePlan: null,
    modelRequest: 0, projectDisplayRequest: 0, recovery: '', setupActive: false, modelCatalog: [], revision: null, previewRevisions: new Map(),
    acceptedFingerprint: null, autoConnect: true, preferredConnection: CONN, lastProjectKey: 'harness.lastProject.v1',
    verifiedConnection: '', setupGeneration: 0, pendingSend: null, setupStep: 'choice', guidedSetup: false, repeatSetup: null, pendingAI: false, localDiscoveryGeneration: 0, draftTimer: null, editingConnection: '',
    // Tilstanden efter opstarten: ingen lås. projectLocks og loadingSelection bruges kun af den rettede kode.
    projectLoading: false, projectLocks: 0, loadingSelection: null,
    selectedOwner: () => c.current ? { root: c.current.root, chat: c.view.id } : null, selection: () => ({ connectionID: c.$('#connection-select').value, modelID: c.$('#model-select').value }),
    showSetup(text) { log.push(`showSetup: ${text}`); }, showData() { log.push('showData'); }, async sendNow() { log.push('sendNow'); }, reviewKey: data => data.fingerprint,
    // Samtalens visning sættes i siden; her er det nok at registrere den.
    mountView(v) { c.view = v; c.running = v.running; c.acceptedFingerprint = null; c.pendingSend = null; log.push('mountView'); },
    async refreshRecent() { log.push('refreshRecent'); },
    setupControls() {}, updateWorkMode() {}, usePreviewContext() {}, message(text, error) { log.push(`message(${error ? 'fejl' : 'info'}): ${text}`); },
    applyFeatures() {}, renderConnectionList() {}, renderSetup() {}, renderStartupConnections() {}, hostingLabel: x => x, testLabel: x => x,
    renderShortlist() {}, renderContextUsage() {}, updateConnectionChecks() {}, setupPage(step) { c.setupStep = step; }, completeIntroduction() {}, moveConnectionForm() {},
    storedMessage() {}, renderHistoryControls() {}, updatePlanOffer() {}, renderUsage() {}, renderApproveAll() {}, updateStartIdea() {}, updateIdeaApproach() {},
    // applyRunning er den rigtige fra app.js (nedenfor), så prøven kan se, hvilke knapper låsen slår fra.
    runTimer: null, clearInterval() {}, setInterval() { return 1; }, renderStatus() {},
    openTaskSettings() { log.push('openTaskSettings'); }, updateStartupSummary() {},
    connectionChecks: { begin: () => 1, finish() {}, get() {}, clear() {} },
    call(method, value) {
      kald.push(method);
      if (method === 'models') {
        if (styring.katalog === 'vent') return new Promise((res, rej) => styring.ventende.push({ res, rej }));
        if (styring.katalog === 'afvis') return Promise.reject(new Error('Serveren afviste adgangen. Kontrollér API-nøglen og tilladelserne.'));
        return Promise.resolve(katalog());
      }
      if (method === 'saveDraft') { log.push(`saveDraft(${value.root} · ${value.chat}): ${JSON.stringify(value.text)}`); return Promise.resolve(true); }
      if (method === 'prepare') { log.push('prepare'); return new Promise(() => {}); }
      if (method === 'recentProjects') return Promise.resolve(Object.entries(styring.projekter || {}).map(([id, p]) => ({ id, root: p.root, name: p.name })));
      if (method === 'reopenProject') return Promise.resolve(styring.projekter[value]);
      return Promise.resolve(null);
    }
  };
  c.globalThis = c; vm.createContext(c);
  for (const kode of [
    linje('function node(tag, text, className)'), linje('function option(value, label)'), linje('const featuredProviders = '),
    udsnit('function makeView(id) {', 'let view = makeView(null);'), linje('const viewFor = id =>'),
    udsnit('async function saveChatDraft(required = false) {', 'function option(value, label)'),
    udsnit('function connectionFailed(reason) {', "$('#setup-local').onclick"),
    udsnit('async function displayProject(project', '// Skift til en anden samtale i samme projekt.'),
    udsnit('function invalidateConnection(id, detail) {', 'function checkLabel(id) {'),
    udsnit('function renderConnections() {', "$('#connections-search').oninput"),
    udsnit('function catalogResult(models) {', 'async function checkConnection(id) {'),
    udsnit('// Kataloget fra nøglevinduets kontrol af netop denne nøgle', 'function selection() {'),
    udsnit('const effortNames = ', '// Forbruget i samtalen'),
    udsnit('function showConnectionWarning(reason) {', "$('#repair-connection').onclick"),
    udsnit('function preselectRecommended(connectionID) {', 'function renderShortlist() {'),
    linje('const defaultMode = '),
    'var connectionUse = ' + udsnit("$('#connection-use').onclick = ", "$('#connection-test').onclick").replace("$('#connection-use').onclick = ", ''),
    // Skrivefeltets input-lytter som en navngiven funktion, så prøven kan trykke en tast.
    'function promptInput() {' + udsnit("$('#prompt').addEventListener('input', () => {", "\n});\n$('#work-mode')").replace("$('#prompt').addEventListener('input', () => {", '') + '\n}',
    udsnit('function applyRunning() {', 'function showSkill() {'),
    // Send og Enter går gennem formularens submit. Genåbningen ved start låser selv, som før.
    udsnit("$('#chat-form').onsubmit = event => {", "$('#prompt').addEventListener('keydown'"),
    udsnit('async function reopenLast() {', 'async function loadDesigns()'),
    // Låsens hjælpere findes kun i den rettede kode.
    ...(KILDE.includes('function lockProject()') ? [udsnit('function lockProject()', '// Et accepteret resumé')] : [])
  ]) vm.runInContext(kode, c);
  c.action = fn => fn();
  c.view = c.makeView(null);
  return { c, $, log, kald, styring, timere };
}
const projekt = (root, chat, { selection, draft = '' } = {}) => ({
  root, name: path.basename(root), purpose: '', assets: [], warnings: [], runtime: null,
  workbench: { chat, connections: [{ id: CONN, name: 'Mistral API', kind: 'mistral' }], retiredConnections: [], definitions: { mistral: { provider: 'Mistral' } },
    projectSettings: selection ? { selection } : {}, workspace: { messages: [], draft, mode: 'chat', status: 'idle' }, preview: null }
});
const vent = () => new Promise(resolve => setImmediate(resolve));
async function aabent(rootA = '/p/Mit prøveprojekt', chat = 'chat-A') {
  const h = miljoe();
  await h.c.displayProject(projekt(rootA, chat, { selection: GEMT }));
  assert.equal(h.$('#model-select').value, 'mistral-large-4', 'udgangspunktet: projektets gemte valg er valgt');
  h.log.length = 0; h.kald.length = 0;
  return h;
}

test('et katalog, der afviser nøglen, stopper ikke åbningen, og projektets gemte valg står under skrivefeltet', async () => {
  const h = await aabent();
  h.styring.katalog = 'afvis';
  await h.c.displayProject(projekt('/p/Mit prøveprojekt', 'chat-A', { selection: GEMT }));
  assert.equal(h.$('#model-select').value, 'mistral-large-4', 'reserven viser det gemte valg i stedet for en tom liste');
  assert.match(h.$('#model-chip').textContent, /mistral-large-4/, 'modelchippen viser brugerens model, ikke Vælg AI');
  assert.equal(h.$('#connection-warning').hidden, false, 'advarslen om forbindelsen står stadig');
  assert.match(h.$('#connection-warning-text').textContent, /Serveren afviste adgangen/);
  for (const trin of ['refreshRecent', 'workspace.onProject', 'versions.refreshStatus']) assert.ok(h.log.includes(trin), `${trin} kører, selv om kataloget fejlede`);
});

test('efter en reparation vælger appen brugerens model, ikke udbyderens udgangspunkt', async () => {
  const h = await aabent();
  h.styring.katalog = 'afvis';
  await h.c.displayProject(projekt('/p/Mit prøveprojekt', 'chat-A', { selection: GEMT }));
  // Gennemgå AI-forbindelse › ny nøgle › Fortsæt.
  h.styring.katalog = 'ok';
  h.c.setupActive = true; h.c.setupStep = 'saved'; h.$('#setup-connection').append(Object.assign(h.c.document.createElement('option'), { value: CONN })); h.$('#setup-connection').value = CONN; h.c.verifiedConnection = CONN;
  await h.c.leaveSetup(true);
  assert.equal(h.$('#model-select').value, 'mistral-large-4');
  assert.match(h.$('#model-chip').textContent, /Mistral Large 4/);
});

test('en tom modelliste efter en fejlet hentning bevarer også projektets valg, når forbindelsen bruges igen', async () => {
  for (const vej of ['Fortsæt i opsætningen', 'Brug forbindelsen']) {
    const h = await aabent();
    // Brugeren vælger forbindelsen igen, og hentningen fejler: listen er tom.
    h.styring.katalog = 'afvis';
    await assert.rejects(h.c.loadModels());
    assert.equal(h.$('#model-select').value, '', 'listen er tom efter fejlen');
    h.styring.katalog = 'ok';
    if (vej === 'Fortsæt i opsætningen') {
      h.c.setupActive = true; h.c.setupStep = 'saved'; h.$('#setup-connection').append(Object.assign(h.c.document.createElement('option'), { value: CONN })); h.$('#setup-connection').value = CONN; h.c.verifiedConnection = CONN;
      await h.c.leaveSetup(true);
    } else {
      h.c.editingConnection = CONN; h.$('#connections-dialog').close = () => {};
      await h.c.connectionUse();
    }
    assert.equal(h.$('#model-select').value, 'mistral-large-4', `${vej}: projektets gemte model, ikke udbyderens udgangspunkt`);
  }
});

test('skifter man projekt, mens kataloget hentes, står det nye projekts kladde straks i skrivefeltet', async () => {
  const h = await aabent('/p/Projekt A');
  h.$('#prompt').value = 'A: halvskrevet besked';
  h.styring.katalog = 'vent';
  const aabning = h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT, draft: 'B: min gemte kladde' }));
  await vent();
  assert.equal(h.$('#prompt').value, 'B: min gemte kladde', 'skrivefeltet hører til B, mens kataloget hentes');
  // Et tastetryk i feltet gemmes for B med B's egen tekst.
  h.$('#prompt').value += '!'; h.c.promptInput(); for (const fn of h.timere.splice(0)) await fn();
  assert.equal(JSON.parse(h.c.localStorage.getItem('harness.chatDraft./p/Projekt B.chat-B')).text, 'B: min gemte kladde!');
  assert.ok(h.log.filter(x => x.startsWith('saveDraft')).every(x => !x.includes('A: halvskrevet')), 'A\'s tekst gemmes aldrig i B');
  h.styring.ventende.shift().res(katalog()); await aabning;
  assert.equal(h.$('#prompt').value, 'B: min gemte kladde!', 'kladden overlever, at kataloget svarer');
  assert.equal(h.$('#model-select').value, 'mistral-large-4');
});

test('skifter man projekt, og kataloget fejler, gemmer næste skift ikke det forrige projekts tekst i det nye', async () => {
  const h = await aabent('/p/Projekt A');
  h.$('#prompt').value = 'A: halvskrevet besked';
  h.styring.katalog = 'afvis';
  // Fejlen fanges her, så prøven måler kladden; at åbningen ikke må kaste, måler den første prøve.
  await h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT, draft: 'B: min gemte kladde' })).catch(() => {});
  assert.equal(h.$('#prompt').value, 'B: min gemte kladde', 'skrivefeltet viser B\'s kladde, ikke A\'s tekst');
  // Åbn projekt og sidepanelet gemmer kladden, før de skifter.
  await h.c.saveChatDraft();
  assert.deepEqual(h.log.filter(x => x.startsWith('saveDraft')), ['saveDraft(/p/Projekt B · chat-B): "B: min gemte kladde"']);
});

// B har sin egen gemte model, så prøverne kan se, at chippen viser netop B's valg.
const GEMT_B = { connectionID: CONN, modelID: 'mistral-large-2512', routeID: '' };

test('mens kataloget hentes efter et projektskift, står projektets gemte model under skrivefeltet, ikke Vælg AI', async () => {
  const h = await aabent('/p/Projekt A');
  h.styring.katalog = 'vent';
  const aabning = h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT_B }));
  await vent();
  assert.match(h.$('#model-chip').textContent, /mistral-large-2512 · Mistral/, 'chippen viser B\'s gemte model, mens kataloget hentes');
  // En anden opdatering af chippen imens, fx en statushændelse, viser stadig B's model.
  h.c.updateModelSummary();
  assert.match(h.$('#model-chip').textContent, /mistral-large-2512/);
  h.styring.ventende.shift().res(katalog()); await aabning;
  assert.match(h.$('#model-chip').textContent, /Mistral Large 3 · Mistral/, 'bagefter katalogets navn for samme model');
});

test('Send, mens kataloget hentes efter et projektskift, åbner ikke modelvalget og sender ikke', async () => {
  const h = await aabent('/p/Projekt A');
  h.styring.katalog = 'vent';
  const aabning = h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT_B, draft: 'B: skriv en overskrift' }));
  await vent();
  // Send og Enter går gennem formularen.
  h.$('#chat-form').onsubmit({ preventDefault() {} }); await vent();
  assert.deepEqual(h.log.filter(x => x === 'openTaskSettings' || x.startsWith('message(fejl)') || x === 'prepare' || x.startsWith('showSetup')), [], 'intet modelvalg, ingen fejl og ingen afsendelse, mens kataloget hentes');
  assert.equal(h.c.projectLoading, true, 'afsendelse og modelvalg er låst, som ved start og oprettelse');
  h.styring.ventende.shift().res(katalog()); await aabning;
  assert.equal(h.c.projectLoading, false, 'låsen slippes, når kataloget er hentet');
  assert.equal(h.$('#model-select').value, 'mistral-large-2512');
  assert.equal(h.$('#prompt').value, 'B: skriv en overskrift', 'teksten står klar til at blive sendt');
});

test('et katalog, der fejler efter et projektskift, slipper låsen igen', async () => {
  const h = await aabent('/p/Projekt A');
  h.styring.katalog = 'afvis';
  await h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT_B }));
  assert.equal(h.c.projectLoading, false, 'Send kan bruges igen, og advarslen fører til reparationen');
  assert.equal(h.$('#connection-warning').hidden, false);
  assert.match(h.$('#model-chip').textContent, /mistral-large-2512/, 'reserven viser B\'s gemte model');
});

test('to projektskift oven i hinanden: låsen og chippen følger det sidste, til dets katalog er hentet', async () => {
  const h = await aabent('/p/Projekt A');
  h.styring.katalog = 'vent';
  const tilB = h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT })); await vent();
  // Et klik på et tredje projekt i sidepanelet, før B's katalog svarer.
  const tilC = h.c.displayProject(projekt('/p/Projekt C', 'chat-C', { selection: GEMT_B })); await vent();
  assert.equal(h.styring.ventende.length, 2, 'B og C venter begge på kataloget');
  h.styring.ventende.shift().res(katalog()); await tilB;
  assert.equal(h.c.projectLoading, true, 'B er færdig, men C henter stadig sit katalog');
  h.c.updateModelSummary();
  assert.match(h.$('#model-chip').textContent, /mistral-large-2512/, 'chippen viser stadig C\'s gemte model');
  h.styring.ventende.shift().res(katalog()); await tilC;
  assert.equal(h.c.projectLoading, false, 'låsen slippes, når det sidste katalog er hentet');
  assert.equal(h.$('#model-select').value, 'mistral-large-2512');
});

test('et projektskift under opstarten efterlader ikke låsen, og opstarten slipper den ikke for tidligt', async () => {
  const h = miljoe();
  // Opstarten holder låsen fra start (app.js begynder med projectLoading = true), og reopenLast åbner det seneste projekt.
  h.c.projectLoading = true; h.c.projectLocks = 1;
  h.styring.projekter = { a: projekt('/p/Projekt A', 'chat-A', { selection: GEMT }) };
  h.c.localStorage.setItem(h.c.lastProjectKey, '/p/Projekt A');
  h.styring.katalog = 'vent';
  const genaabning = h.c.reopenLast(); await vent(); await vent();
  // Brugeren åbner et andet projekt fra sidepanelet, før A's katalog svarer.
  const tilB = h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT_B })); await vent();
  assert.equal(h.styring.ventende.length, 2, 'A og B venter begge på kataloget');
  h.styring.ventende.shift().res(katalog()); await genaabning;
  vm.runInContext(OPSTART_SLIPPER, h.c);
  assert.equal(h.c.projectLoading, true, 'B henter stadig sit katalog, så afsendelsen er låst');
  h.styring.ventende.shift().res(katalog()); await tilB;
  assert.equal(h.c.projectLoading, false, 'låsen er sluppet, ikke efterladt');
});

test('mens kataloget hentes efter et projektskift, ser Send, modelvalget og arbejdsmåden slået fra ud, og bagefter er de til igen', async () => {
  const h = await aabent('/p/Projekt A');
  const knapper = () => ['#send', '#model-chip', '#composer-mode'].map(s => h.$(s).disabled);
  assert.deepEqual(knapper(), [false, false, false], 'udgangspunktet: alt kan bruges');
  h.styring.katalog = 'vent';
  const aabning = h.c.displayProject(projekt('/p/Projekt B', 'chat-B', { selection: GEMT_B, draft: 'B: tekst' }));
  await vent();
  // Arbejdsmådens menu åbner ikke under låsen (composer-options.js). Knappen skal derfor se slået fra ud som Send og chippen,
  // så et klik ikke bare forsvinder.
  assert.deepEqual(knapper(), [true, true, true], 'Send, modelchippen og arbejdsmåden er slået fra, mens kataloget hentes');
  h.styring.ventende.shift().res(katalog()); await aabning;
  assert.deepEqual(knapper(), [false, false, false], 'alt kan bruges igen, når kataloget er hentet');
});
