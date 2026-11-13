// Q:D1-5: springer den automatiske version efter en opgave en fil over (fx en fil med en mulig hemmelighed), gemmes og
// fortrydes filen ikke sammen med opgaven. Aktivitet nævnte filen, men resultatkortet sagde stadig kun «Gemt» og tilbød at
// fortryde opgaven. Kortet skal sige, hvilken fil det gælder, og at den ikke fortrydes.
// Prøven kører de ordrette udsnit af ui/app.js i en lille DOM, som tests/result-dialog.test.cjs gør.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div', text = '') { this.tagName = tag; this.text = text || ''; this.children = []; this.hidden = false; this.dataset = {}; this.className = ''; this.classList = { add() {}, toggle() {}, contains: () => false }; }
  get textContent() { return this.text + this.children.map(item => typeof item === 'string' ? item : item.textContent).join('\n'); }
  set textContent(value) { this.text = value; this.children = []; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  querySelectorAll(selector) { return this.children.filter(item => typeof item !== 'string').flatMap(item => [...(item.tagName === selector ? [item] : []), ...item.querySelectorAll(selector)]); }
  scrollIntoView() {} focus() {}
}
function card() {
  const elements = new Map(), $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const view = { id: 'samtale', review: new Element('section'), log: new Element(), followChat: false, historyPending: [], lastSentText: 'Tilføj konfiguration' };
  const context = { $, view, current: { root: '/p' }, state: { connections: [] }, projectLoading: false, node: (tag, text) => new Element(tag, text), action: fn => fn(), call: async () => {}, shortLabel: value => value, checkPreview() {}, requestAnimationFrame: fn => fn(), window: { ApprovalView: require('../ui/approval-view.js'), workspace: { show() {}, showChange() {} } } };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function updatePlanOffer('), source.indexOf('let localDiscoveryGeneration')), context);
  return { context, view };
}
const checkpoint = kept => ({ type: 'git.checkpoint', status: 'saved', head: 'abc123', kept, files: ['public/index.html'] });

test('springer versionen en fil over, siger resultatkortet hvilken, og at den ikke fortrydes med opgaven', () => {
  const { context, view } = card();
  view.lastCheckpoint = checkpoint(['public/config.js']);
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/index.html', 'public/config.js'] }, view);
  const text = view.review.textContent;
  assert.match(text, /2 filer ændret · Gemt/);
  assert.match(text, /public\/config\.js kom ikke med i versionen og fortrydes ikke sammen med opgaven/);
});

test('flere oversprungne filer nævnes med antal, og en lang liste afkortes', () => {
  const { context, view } = card();
  view.lastCheckpoint = checkpoint(['a.js', 'b.js', 'c.js', 'd.js', 'e.js']);
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/index.html', 'a.js', 'b.js', 'c.js', 'd.js', 'e.js'] }, view);
  assert.match(view.review.textContent, /5 filer kom ikke med i versionen og fortrydes ikke sammen med opgaven: a\.js, b\.js, c\.js og 2 flere\./);
});

test('en stoppet opgave og en opgave med fejl nævner også den oversprungne fil', () => {
  const { context, view } = card();
  view.lastCheckpoint = checkpoint(['public/config.js']);
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'stopped', files: ['public/index.html', 'public/config.js'] }, view);
  assert.match(view.review.textContent, /så du kan fortryde det/);
  assert.match(view.review.textContent, /public\/config\.js kom ikke med i versionen og fortrydes ikke sammen med opgaven/);
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'error', failure: { kind: 'network' }, files: ['public/index.html', 'public/config.js'] }, view);
  assert.match(view.review.textContent, /public\/config\.js kom ikke med i versionen/);
});

// Skeptikerens fund (resten af Q:D1-5): kortet efter en afvist handling har Fortryd opgaven under Flere valg, men nævnte ikke
// den oversprungne fil.
test('kortet efter en afvist handling nævner også den oversprungne fil, som Fortryd opgaven ikke fortryder', () => {
  const { context, view } = card();
  view.lastCheckpoint = checkpoint(['public/config.js']);
  Object.assign(view, { rejectedThisRun: true, lastRejection: { title: 'Må AI’en køre en kommando?', target: 'npm install' } });
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/index.html', 'public/config.js'] }, view);
  const text = view.review.textContent;
  assert.match(text, /Du afviste en handling, så AI’en stoppede/);
  assert.ok(view.review.querySelectorAll('button').some(button => button.textContent === 'Fortryd opgaven'), 'forudsætning: kortet tilbyder at fortryde opgaven');
  assert.match(text, /public\/config\.js kom ikke med i versionen og fortrydes ikke sammen med opgaven/);
});

test('uden oversprungne filer, eller når versionen slet ikke blev gemt, står der intet om det', () => {
  const { context, view } = card();
  view.lastCheckpoint = checkpoint([]);
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/index.html'] }, view);
  assert.doesNotMatch(view.review.textContent, /kom ikke med i versionen/);
  // Uden en gemt version fortryder Aura opgaven fra sit eget øjebliksbillede, og så kommer alle opgavens filer med.
  view.lastCheckpoint = { type: 'git.checkpoint', status: 'skipped', message: 'Versionen blev ikke gemt automatisk: …', kept: ['public/config.js'] };
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/index.html'] }, view);
  assert.doesNotMatch(view.review.textContent, /kom ikke med i versionen/);
});

// Hele vejen med rigtig Git: Checkpoints springer en fil med en mulig hemmelighed over, og kortet tegnes ud fra netop den
// hændelse, appen får (git.checkpoint med kept). Brugeren har godkendt testidentiteten i disse nye testrepositories.
test('med rigtig Git: hændelsen fra den automatiske version giver kortets besked om den oversprungne fil', async t => {
  const fsp = require('node:fs/promises'), os = require('node:os');
  const { GitVersions, run } = require('../core/git.cjs');
  const { Checkpoints } = require('../core/checkpoints.cjs');
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-kort-version-')));
  const home = path.join(root, 'home'); await fsp.mkdir(home); process.env.HOME = home; process.env.USERPROFILE = home; process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  const project = path.join(root, 'projekt'); await fsp.mkdir(path.join(project, 'public'), { recursive: true });
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const git = new GitVersions(); await git.initialize(project);
  await run(project, ['config', '--local', 'user.name', 'Testbruger']); await run(project, ['config', '--local', 'user.email', 'test@example.invalid']);
  await fsp.writeFile(path.join(project, 'public/index.html'), '<h1>Første</h1>');
  const review = await git.review(project); await git.commit(project, { token: review.token, files: ['public/index.html'], message: 'Første version' });
  const events = [], checkpoints = new Checkpoints(git, event => events.push(event));
  await checkpoints.begin(project, true, 'Tilføj konfiguration');
  await fsp.writeFile(path.join(project, 'public/index.html'), '<h1>Anden</h1>');
  await fsp.writeFile(path.join(project, 'public/config.js'), 'const apiKey = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";');
  await checkpoints.finish();
  const { context, view } = card();
  view.lastCheckpoint = events.at(-1);
  assert.equal(view.lastCheckpoint.status, 'saved', 'forudsætning: versionen er gemt');
  context.renderRunReview({ task: 'opgave', mode: 'build', status: 'idle', files: ['public/config.js', 'public/index.html'] }, view);
  assert.match(view.review.textContent, /public\/config\.js kom ikke med i versionen og fortrydes ikke sammen med opgaven/);
});
