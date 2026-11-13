// Godkendelseskortet (ui/approvals.js) i en lille falsk DOM med den rigtige ApprovalsPolicy og rigtige OpenCode 1.19.5-forespørgsler.
// Fund 3, 4, 5, 8 og 15 i gennemgangen af beta 3: kortet skal sige, hvilken fil det gælder, hvor søgningen sker, hvad gentagelsesvagten er,
// og hvad «Godkend alt» faktisk dækker.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const ApprovalView = require('../ui/approval-view.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'opencode-1.19.5');

class TextNode { constructor(value) { this.nodeValue = String(value); this.parentNode = null; } get textContent() { return this.nodeValue; } }
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this.className = ''; this.parentNode = null; this.scrollTop = 0; this.type = ''; this.tabIndex = -1; }
  append(...items) { for (const item of items) { const child = typeof item === 'string' ? new TextNode(item) : item; if (child.parentNode) child.parentNode.childNodes = child.parentNode.childNodes.filter(c => c !== child); child.parentNode = this; this.childNodes.push(child); } }
  insertBefore(child, reference) { const index = this.childNodes.indexOf(reference); if (child.parentNode) child.parentNode.childNodes = child.parentNode.childNodes.filter(c => c !== child); child.parentNode = this; if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; if (value !== '' && value != null) this.append(String(value)); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  remove() { if (this.parentNode) { this.parentNode.childNodes = this.parentNode.childNodes.filter(c => c !== this); this.parentNode = null; } }
  scrollIntoView() {} focus() {}
  get children() { return this.childNodes.filter(child => child instanceof Element); }
  querySelectorAll(selector) {
    const out = [], matches = el => selector.startsWith('.') ? el.className.split(/\s+/).includes(selector.slice(1)) : el.tagName === selector.toUpperCase();
    const walk = el => { for (const child of el.children) { if (matches(child)) out.push(child); walk(child); } };
    walk(this); return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
let lastView = null;
function render(props, calls = []) {
  const v = lastView = { id: 'samtale', root: props.workspaceRoot, log: new Element('div'), approvals: new Element('div'), runStartedAt: 1, waitingFor: [] };
  const document = { createElement: tag => new Element(tag), createTextNode: text => new TextNode(text), getElementById: () => null, activeElement: null };
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const info = (label, text) => { const button = node('button', 'i', 'info'); button.type = 'button'; button.setAttribute('aria-label', `Mere om ${label}`); button.dataset.info = text; return button; };
  const context = { window: { ApprovalView, harness: { onEvent: () => {} } }, document, node, info, action: async fn => fn(), call: async (...args) => { calls.push(args); }, waitFor: () => {}, doneWaiting: () => {}, setStatusDetail: () => {}, viewFor: () => v, current: null, MutationObserver: class { observe() {} }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui', 'approvals.js'), 'utf8'), context, { filename: 'ui/approvals.js' });
  context.window.approvals.show(props, v);
  return v.approvals.querySelector('section');
}
const title = box => box.querySelector('.approval-title').textContent;
const what = box => { const facts = box.querySelector('dl'); const index = facts.children.findIndex(el => el.tagName === 'DT' && el.textContent === 'Hvad'); return index < 0 ? null : facts.children[index + 1].textContent; };
const buttons = box => box.querySelectorAll('button').map(button => button.textContent);
const hints = box => box.querySelectorAll('p').map(p => p.textContent).join('\n');

async function project(t) {
  const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-kort-ui-')));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'Dokumenter', 'projekt');
  await fsp.mkdir(path.join(root, 'public'), { recursive: true }); await fsp.writeFile(path.join(root, 'notes.txt'), 'Hej verden NEEDLE\n');
  const store = { project: async () => ({ approvals: { version: 1, autoProjectFiles: false, rules: [] } }), projectKey: key => key, update: async () => {} };
  const context = { projectRoot: root, workspaceRoot: root, mode: 'build', scratchRoot: path.join(root, '.aura', 'tmp'), commandSandbox: false, commandSandboxSupported: true, grepGuard: true, storeRoot: path.join(base, 'appdata'), engineRoot: path.join(base, 'appdata', 'runtime', 'noegle'), taskRules: new Set() };
  return { base, root, context, policy: new ApprovalsPolicy(store) };
}
const recorded = (file, root) => JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')).policyInput).replace(/\$\{ROOT(:rel\/)?\}/g, (_, rel) => rel ? root.slice(1) : root).replace(/\$\{WORKSPACE(:rel\/)?\}/g, (_, rel) => rel ? root.slice(1) : root));
async function card(f, p, extra = {}, calls) {
  const { descriptor } = await f.policy.allowed(f.context, p);
  return render({ ...p, policy: { ...descriptor, approveAllAvailable: false, ...extra }, workspaceRoot: f.root }, calls);
}

test('apply_patch-kortet viser filen i projektet, også når OpenCode giver stien relativt (fund 5)', async t => {
  const f = await project(t);
  // Med Git er filepath relativ til worktree ("notes.txt"); uden Git er det roden uden foranstillet skråstreg.
  const withGit = await card(f, recorded('apply-patch-git__patch-opdater-inde__1-edit.json', f.root));
  assert.equal(title(withGit), 'Må AI’en ændre filer i projektet?');
  assert.match(what(withGit), /^notes\.txt · 1 linje tilføjet, 1 fjernet$/);
  const withoutGit = await card(f, recorded('apply-patch-uden-git__patch-tilfoej-inde__1-edit.json', f.root));
  assert.match(what(withoutGit), /^public\/patch\.html · ny fil/);
  // Kontrol: edit med absolut sti som før.
  const edit = await card(f, recorded('byg-git-filer__edit-inde-absolut__1-edit.json', f.root));
  assert.match(what(edit), /^notes\.txt/);
});

test('søgekortet siger, om søgningen sker i projektet, uden for projektet eller i et gemt resultat (fund 3)', async t => {
  const f = await project(t);
  const outside = path.join(f.base, 'Dokumenter', 'ekstern'), toolOutput = path.join(f.context.engineRoot, 'data', 'opencode', 'tool-output');
  await fsp.mkdir(outside); await fsp.mkdir(toolOutput, { recursive: true });
  const grep = (search, id) => ({ id, permission: 'grep', patterns: ['NEEDLE'], always: ['*'], metadata: { pattern: 'NEEDLE', ...(search ? { path: search } : {}) } });
  assert.equal(title(await card(f, grep(undefined, 'a'))), 'Må AI’en søge i projektets filer?');
  const ude = await card(f, grep(outside, 'b'));
  assert.equal(title(ude), 'Må AI’en søge i filer uden for projektet?');
  assert.equal(what(ude), outside);
  assert.equal(title(await card(f, grep(toolOutput, 'c'))), 'Må AI’en søge i et gemt resultat?');
});

test('gentagelsesvagtens kort har sin egen tekst og to valg: fortsæt eller stop opgaven, ikke «Afvis med en besked» (fund 8)', async t => {
  // En afvisning af gentagelsesvagten stopper opgaven i AI-motoren som en fejl, også med en besked (målt i fixtures/opencode-1.19.5/gentagelse).
  const f = await project(t), calls = [];
  const p = { id: 'loop', permission: 'doom_loop', patterns: ['read'], always: ['read'], metadata: { tool: 'read', input: { filePath: path.join(f.root, 'notes.txt') } } };
  const box = await card(f, p, { approveAllAvailable: true }, calls);
  assert.equal(title(box), 'AI’en gentager det samme. Skal den fortsætte?');
  assert.equal(what(box), 'Læse en fil: notes.txt');
  assert.deepEqual(buttons(box), ['Fortsæt', 'Stop opgaven'], 'hverken «Afvis med en besked», «Godkend alt» eller «Flere valg»');
  // Stop opgaven gør det samme som Stop-knappen, så resultatkortet siger «Du stoppede opgaven» og ikke en modelfejl.
  await box.querySelectorAll('button').find(button => button.textContent === 'Stop opgaven').onclick();
  // Objekterne er skabt i kortets vm-kontekst, så de sammenlignes som JSON.
  assert.equal(JSON.stringify(calls.map(call => [call[0], call[1], call[2]?.chat])), JSON.stringify([['stop', { chat: 'samtale' }, 'samtale']]));
  await box.querySelectorAll('button').find(button => button.textContent === 'Fortsæt').onclick();
  assert.equal(calls[1][0], 'reply'); assert.equal(calls[1][1].allow, true); assert.equal(calls[1][1].id, 'loop');
});

test('«Godkend alt» lover kun det, den dækker: hjemmesider, søgning og mapper uden for projektet spørger stadig (fund 4 og 15)', async t => {
  const f = await project(t);
  const web = { id: 'w', permission: 'webfetch', patterns: ['https://eksempel.dk/'], always: ['*'], metadata: { url: 'https://eksempel.dk/', format: 'text' } };
  // Hjemmesidens kort har ikke «Godkend alt» (Q:A-4), så det lover heller intet om nettet.
  const mac = await card(f, web, { approveAllAvailable: true });
  assert.equal(buttons(mac).includes('Godkend alt i denne samtale'), false);
  assert.doesNotMatch(hints(mac), /hente fra nettet|uden for projektmappen|Hjemmesider, søgning/);
  // En kommando i en opgave, der er startet uden isolation, spørger resten af opgaven, også efter «Godkend alt».
  const bash = { id: 'b', permission: 'bash', patterns: ['npm run build'], always: ['npm run build *'], metadata: { command: 'npm run build' } };
  assert.match(hints(await card(f, bash, { approveAllAvailable: true })), /resten af opgaven/);
  assert.doesNotMatch(hints(await card({ ...f, context: { ...f.context, commandSandbox: true } }, { ...bash, id: 'b2' }, { approveAllAvailable: true })), /resten af opgaven/);
  // Windows: uden isolation spørger kommandoer, der kan røre beskyttede filer eller Git, stadig.
  const windows = await card(f, { ...bash, id: 'b3' }, { approveAllAvailable: true, approveAllUnisolated: true });
  assert.doesNotMatch(hints(windows), /spørger ikke igen i denne samtale/);
  assert.match(hints(windows), /Hjemmesider, søgning og mapper uden for projektet spørger stadig/);
});

test('statuslinjen for «Godkend alt» lover ikke nettet, søgning eller mapper uden for projektet (fund 4 og 15)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const status = /<span id="approve-all-status"[^>]*><span>([^<]*)<\/span>/.exec(html)?.[1];
  assert.ok(status, 'statuslinjen findes');
  assert.doesNotMatch(status, /nettet/);
  assert.match(status, /Hjemmesider, søgning og mapper uden for projektet spørger stadig/);
});

// Q:A-4: «Godkend alt i denne samtale» vises kun på kort, funktionen kan dække (approveAllApplies i core/chat-session.cjs). Hjemmesider,
// mapper uden for projektet, søgning og låste eller beskyttede handlinger dækkes aldrig, så knappen står ikke på deres kort.
test('«Godkend alt» står kun på kort, den kan dække: ikke hjemmeside, mappe uden for projektet, søgning eller beskyttede filer (Q:A-4)', async t => {
  const f = await project(t);
  const outside = path.join(f.base, 'Dokumenter', 'ekstern'); await fsp.mkdir(outside);
  const hasAll = box => buttons(box).includes('Godkend alt i denne samtale');
  const never = {
    hjemmeside: { id: 'w', permission: 'webfetch', patterns: ['https://eksempel.dk/'], always: ['*'], metadata: { url: 'https://eksempel.dk/', format: 'text' } },
    mappe: recorded('byg-git-filer__read-ude-absolut__1-external_directory.json', f.root).valueOf(),
    søgning: { id: 's', permission: 'grep', patterns: ['NEEDLE'], always: ['*'], metadata: { pattern: 'NEEDLE' } },
    beskyttet: { id: 'h', permission: 'edit', patterns: ['.env'], always: ['*'], metadata: { filepath: path.join(f.root, '.env') } }
  };
  never.mappe = JSON.parse(JSON.stringify(never.mappe).replaceAll('${OUTSIDE}', outside));
  for (const [what, p] of Object.entries(never)) assert.equal(hasAll(await card(f, p, { approveAllAvailable: true })), false, what);
  const edit = await card(f, recorded('byg-git-filer__edit-inde-absolut__1-edit.json', f.root), { approveAllAvailable: true });
  const bash = await card(f, { id: 'b', permission: 'bash', patterns: ['npm run build'], always: ['npm run build *'], metadata: { command: 'npm run build' } }, { approveAllAvailable: true });
  assert.equal(hasAll(edit), true, 'filændringer i projektet'); assert.equal(hasAll(bash), true, 'kommandoer');
  assert.match(hints(bash), /Hjemmesider, søgning og mapper uden for projektet spørger stadig/);
  // Windows uden isolation: en kommando, der nævner beskyttede navne, dækkes aldrig af «Godkend alt» (approveAllApplies), så knappen står ikke der.
  const windows = { ...f, context: { ...f.context, commandSandboxSupported: false, commandUnisolated: true } };
  const protectedCommand = await card(windows, { id: 'wb1', permission: 'bash', patterns: ['cat .env'], always: ['cat *'], metadata: { command: 'cat .env' } }, { approveAllAvailable: true, approveAllUnisolated: true });
  const plainCommand = await card(windows, { id: 'wb2', permission: 'bash', patterns: ['npm run build'], always: ['npm run build *'], metadata: { command: 'npm run build' } }, { approveAllAvailable: true, approveAllUnisolated: true });
  assert.equal(hasAll(protectedCommand), false, 'en kommando med beskyttede navne uden isolation'); assert.equal(hasAll(plainCommand), true, 'en almindelig kommando uden isolation');
});

// N:A-7: kan Aura ikke afgrænse søgningens sti, må kortet ikke sige «projektets filer». Hvad viser stien og søgeordet.
test('søgekortet lover ikke projektets filer, når stien ikke kan afgrænses, og viser stien (N:A-7)', async t => {
  const f = await project(t);
  // Bogstaveligt '..' i stien (path.join ville rydde det væk): describe kan ikke binde den.
  const loose = `${f.root}/../../ekstern`;
  const box = await card(f, { id: 'g', permission: 'grep', patterns: ['NEEDLE'], always: ['*'], metadata: { pattern: 'NEEDLE', path: loose } });
  assert.equal(title(box), 'Må AI’en søge i filer?');
  assert.doesNotMatch(hints(box) + title(box), /projektets filer/);
  assert.equal(what(box), `${loose} · søgeord: NEEDLE`);
  // En søgning i projektet uden sti er som før.
  assert.equal(title(await card(f, { id: 'g2', permission: 'grep', patterns: ['NEEDLE'], always: ['*'], metadata: { pattern: 'NEEDLE' } })), 'Må AI’en søge i projektets filer?');
});

// Brugerens beslutning 10. november 2026 («Fjern funktionen»): en kommando kan ikke huskes. Kortet tilbyder aldrig «Tillad altid i projektet»
// for en kommando og lover ikke en gemt kommandotilladelse, heller ikke hvis en ældre hovedproces skulle sende persistable.
test('et kommandokort tilbyder aldrig «Tillad altid i projektet» og lover ingen gemt kommandotilladelse (beslutning 10. november 2026)', async t => {
  const f = await project(t);
  const bash = { id: 'b', permission: 'bash', patterns: ['npm test'], always: ['npm test *'], metadata: { command: 'npm test' } };
  for (const persistable of [false, true]) {
    const box = await card(f, { ...bash, id: `b-${persistable}` }, { persistable });
    assert.deepEqual(buttons(box).filter(text => text !== 'i').slice(0, 2), ['Tillad én gang', 'Afvis'], `persistable: ${persistable}`);
    assert.doesNotMatch(hints(box), /gemt tilladelse|den viste kommando/, `persistable: ${persistable}`);
  }
  // En hjemmeside kan stadig huskes.
  const web = await card(f, { id: 'w', permission: 'webfetch', patterns: ['https://eksempel.dk/'], always: ['*'], metadata: { url: 'https://eksempel.dk/', format: 'text' } });
  assert.ok(buttons(web).includes('Tillad altid i projektet'));
  assert.match(hints(web), /En gemt tilladelse gælder den viste hjemmeside/);
});

// Kortsamlingen (brugerens beslutning 10. november 2026): efter fem kort spørger Aura én gang, om resten af opgaven må fortsætte i projektmappen.
// Kortet stiller ét spørgsmål med to valg, siger hvad der stadig spørger, og besvarer også den ventende handling.
test('kortet om resten af opgaven stiller ét spørgsmål med to valg og besvarer også den ventende handling (beslutning 10. november 2026)', async t => {
  const f = await project(t), calls = [];
  const p = recorded('byg-git-filer__edit-inde-absolut__1-edit.json', f.root);
  const box = await card(f, p, { collect: { commands: false, search: true }, approveAllAvailable: true }, calls);
  const v = lastView;
  assert.equal(title(box), 'Må resten af opgaven fortsætte i projektmappen?');
  assert.deepEqual(buttons(box), ['Ja, resten af opgaven', 'Nej, spørg hver gang'], 'to valg, ingen Flere valg og ingen Godkend alt');
  const facts = box.querySelector('dl').textContent;
  assert.match(facts, /Hvis du siger jaAI’en må ændre filer i projektet og søge i projektets filer uden at spørge resten af opgaven\. Det, der venter nu, godkendes også\./);
  assert.match(facts, /Spørger stadigBeskyttede filer, mapper uden for projektet, kommandoer, nettet og udgivelse\./);
  assert.match(facts, /Venter nunotes\.txt/);
  await box.querySelectorAll('button').find(button => button.textContent === 'Ja, resten af opgaven').onclick();
  assert.equal(JSON.stringify(calls.map(call => [call[0], call[1]])), JSON.stringify([['reply', { id: p.id, ids: [p.id], allow: true, scope: 'collect', chat: 'samtale' }]]));
  assert.equal(v.approvals.querySelector('section'), null, 'kortet er besvaret');
  assert.match(v.log.textContent, /^1 handling godkendt: ændre filer i projektet: notes\.txt\. Resten af opgaven må AI’en ændre filer i projektet og søge i projektets filer uden at spørge\.$/);
  // Med sandkassen i motoren hører isolerede kommandoer med, og kommandoer står ikke under Spørger stadig.
  const sandboxed = await card(f, { ...p, id: 'med-sandkasse' }, { collect: { commands: true, search: true } });
  assert.match(sandboxed.querySelector('dl').textContent, /ændre filer i projektet, søge i projektets filer og køre kommandoer isoleret i projektet uden at spørge/);
  assert.match(sandboxed.querySelector('dl').textContent, /Spørger stadigBeskyttede filer, mapper uden for projektet, nettet og udgivelse\./);
});

test('«Nej, spørg hver gang» gør kortet til et almindeligt kort for handlingen uden at svare (beslutning 10. november 2026)', async t => {
  const f = await project(t), calls = [];
  const p = recorded('byg-git-filer__edit-inde-absolut__1-edit.json', f.root);
  const box = await card(f, p, { collect: { commands: false, search: true } }, calls);
  const v = lastView;
  await box.querySelectorAll('button').find(button => button.textContent === 'Nej, spørg hver gang').onclick();
  assert.deepEqual(calls, [], 'intet er sendt endnu');
  const normal = v.approvals.querySelector('section');
  assert.notEqual(normal, box); assert.equal(box.parentNode, null);
  assert.equal(title(normal), 'Må AI’en ændre filer i projektet?');
  assert.deepEqual(buttons(normal).slice(0, 3), ['Tillad én gang', 'Tillad altid i projektet', 'Afvis']);
  await normal.querySelectorAll('button').find(button => button.textContent === 'Tillad én gang').onclick();
  assert.equal(calls.length, 1); assert.equal(calls[0][1].scope, undefined); assert.equal(calls[0][1].allow, true);
});
