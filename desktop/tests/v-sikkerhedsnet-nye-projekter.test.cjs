// Brugerens beslutning (c), 10. november 2026 («Ingen automatik»): et nyt projekt uden sikkerhedsnet spørger som før. Sikkerhedsnettet
// er funktionen Versioner og fortryd, automatiske versioner og Git, der kan gemme dem. Kommer nettet senere, gives standarderne
// (filændringer i projektet uden kort og kommandoer i sandkassen) én gang, og brugerens eget valg imellem røres aldrig. Slås
// versionerne fra igen, ændres intet.
// Prøven kører main.cjs' egne handlere med det rigtige lager, de rigtige funktioner, den rigtige godkendelsespolitik, rigtige
// projektfiler og rigtig Git. Kun Electron-delene (vinduer, IPC og forhåndsvisning) er små attrapper. Om et kort vises, afgøres
// af den rigtige ApprovalsPolicy.allowed for en filændring og en kommando, som OpenCode beder om dem.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const desktop = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(desktop, 'main.cjs'), 'utf8');
const { Store } = require('../core/store.cjs');
const { Features } = require('../core/features.cjs');
const { loadLibrary } = require('../core/library.cjs');
const { GitVersions, run } = require('../core/git.cjs');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Preferences } = require('../core/preferences.cjs');
const { createProject, openProject } = require('../core/projects.cjs');
const { storedRuntime, storedRuntimeNotice } = require('../core/preview-config.cjs');
const { normalizeRuntimeConfig } = require('../core/project-runtime.cjs');
const sandbox = require('../core/command-sandbox.cjs');
const profiles = path.join(desktop, '..', 'profiles');
let library = null;
const sharedLibrary = () => library ??= loadLibrary(profiles);

function cut(from, to) {
  const start = source.indexOf(from); assert.ok(start >= 0, `main.cjs mangler ${from}`);
  const end = source.indexOf(to, start + from.length); assert.ok(end > start, `main.cjs mangler ${to} efter ${from}`);
  return source.slice(start, end);
}
// En hjælpefunktion i main.cjs, som handlerne måske kalder. Findes den ikke, køres handlerne, som de står.
function helper(name) {
  const start = source.indexOf(`async function ${name}(`);
  return start < 0 ? '' : source.slice(start, source.indexOf('\n}\n', start) + 3);
}

// Brugerens egen Git-opsætning må ikke påvirke prøven. Et tilfælde slår signering til med et program, der altid fejler, så Git
// ikke kan gemme projektets første version; det er en kendt måde, oprettelsen af versioner fejler på hos udviklere.
async function home(base, { signing = false } = {}) {
  const dir = path.join(base, 'hjem');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, '.gitconfig'), signing ? '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /usr/bin/false\n' : '');
  return dir;
}
function isolate(t, dir) {
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = dir; process.env.XDG_CONFIG_HOME = path.join(dir, '.config');
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

// Aura med main.cjs' egne handlere for oprettelse, funktioner, projektets indstillinger, versioner og forberedelse af en opgave.
async function aura(t, { signing = false, parentInRepository = false } = {}) {
  const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-sikkerhedsnet-')));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  isolate(t, await home(base, { signing }));
  let parent = path.join(base, 'Dokumenter', 'Aura');
  if (parentInRepository) {
    const outer = path.join(base, 'ydre-repository'); await fsp.mkdir(outer);
    execFileSync('git', ['init', '-q'], { cwd: outer });
    parent = path.join(outer, 'Aura');
  }
  const store = new Store(path.join(base, 'data'), {});
  const bench = { store, features: new Features(store, sharedLibrary), git: new GitVersions(), approvalsPolicy: new ApprovalsPolicy(store), chats: new Map(), project: null, logs: [], prepared: [], events: [] };
  bench.log = entry => bench.logs.push(entry);
  bench.busyRoot = () => false;
  // Forberedelsen af en opgave læser projektets godkendelser; attrappen husker, hvad den så.
  bench.prepare = async () => { const approvals = await bench.approvalsPolicy.settings(bench.project.root); bench.prepared.push(approvals); return { approvals }; };
  const handlers = {};
  const deps = {
    handle: (channel, action) => { handlers[channel] = action; }, exclusive: action => action(),
    workbench: bench, currentWorkbench: () => bench, registry: { values: () => (bench.project ? [bench] : []) },
    currentProject: () => bench.project, requireProject: () => bench.project.root, requireIdleProject: () => bench.project.root, workspaceRoot: () => bench.project?.root,
    requestChatID: () => null, chatInput: value => value,
    Preferences, createProject, openProject, profileRoot: profiles, fs: fsp, path,
    defaultProjectParent: () => parent,
    activate: async opened => { bench.project = { root: opened.root }; return opened; },
    // storedRuntimeNotice er main.cjs' egen import (Q:C1-4); projectSettings giver beskeden om en reddet opstart med.
    storedRuntime, storedRuntimeNotice, normalizeRuntimeConfig, inspectRuntime: async () => ({ kind: 'static' }), spaces: new Map(),
    currentPage: () => '', captureView: async () => null, images: { add: async () => {} }, sendEvent: event => bench.events.push(event),
    // Computeren i prøven har kommandosandkassen. Selve sandkassen har sine egne prøver.
    require: name => name === './core/command-sandbox.cjs' ? { ...sandbox, support: async () => ({ available: true, platform: process.platform, reason: '', warnings: [] }) } : require(path.join(desktop, name))
  };
  const pieces = [
    helper('settleDefaults'),
    cut("handle('project:create'", "handle('project:open'"),
    cut('async function projectSettings()', "handle('features:get'"),
    cut("handle('features:save'", "handle('preview:attach'"),
    cut("handle('git:save'", 'function hostingIdle()'),
    cut("handle('agent:prepare'", "handle('agent:send'")
  ];
  const names = Object.keys(deps);
  new Function(...names, `let chosenParent = null, assets = [];\n${pieces.join('\n')}`)(...names.map(name => deps[name]));
  const create = async (extra = {}) => handlers['project:create']({ name: 'Cykelruter', purpose: 'En liste over fiktive cykelruter.', color: null, links: [], tests: 'senere', startup: {}, ...extra });
  return { base, parent, store, bench, handlers, create };
}

// Det, OpenCode beder om, når AI'en skriver public/index.html og kører en bygning i projektet.
const editRequest = root => { const file = path.join(root, 'public', 'index.html'); return { id: 'skriv', permission: 'edit', patterns: ['public/index.html'], metadata: { filepath: file }, toolInput: { tool: 'write', filePath: file } }; };
const commandRequest = root => ({ id: 'byg', permission: 'bash', patterns: ['npm run build'], metadata: { command: 'npm run build' }, toolInput: { tool: 'bash', command: 'npm run build', workdir: root } });
const taskContext = (root, approvals) => ({ projectRoot: root, workspaceRoot: root, mode: 'free', taskRules: new Set(), commandSandboxSupported: true, commandSandbox: true, autoCommandsSnapshot: approvals?.autoCommands === true });
// «kort» betyder, at brugeren bliver spurgt. Ellers står kilden til den automatiske godkendelse.
async function decisions(bench, root) {
  const approvals = await bench.approvalsPolicy.settings(root), context = taskContext(root, approvals);
  const answer = async request => (await bench.approvalsPolicy.allowed(context, request)).source || 'kort';
  return { filer: await answer(editRequest(root)), kommandoer: await answer(commandRequest(root)) };
}
// Standarderne slår kommandoer til, når computeren har kommandosandkassen; prøven spørger samme undersøgelse, som Aura bruger.
const sandboxCommands = sandbox.support().then(support => support.available === true ? 'commands' : 'kort');
const ASKS = { filer: 'kort', kommandoer: 'kort' };
const defaults = async () => ({ filer: 'project', kommandoer: await sandboxCommands });
const waiting = async aura => (await aura.handlers['project:settings']()).pendingDefaults === true;
const log = async root => (await run(root, ['log', '--format=%s'])).toString().trim().split('\n');
// Brugeren slår versioner til for et projekt i appen: Funktioner, Slå versioner til, Hvem står bag versionerne, Gem version og
// til sidst «Gem en version efter hver AI-opgave». Kun det sidste trin giver sikkerhedsnettet.
async function enableVersions(a, root, { afterEach = async () => {} } = {}) {
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: true } }); await afterEach('funktionen');
  await a.handlers['git:init'](); await afterEach('git');
  await a.handlers['git:identity']({ name: 'Prøvebruger', email: 'proeve@example.invalid' }); await afterEach('identitet');
  assert.ok((await a.handlers['git:save']({ note: 'Første version' })).head); await afterEach('første version');
  assert.equal(await a.handlers['git:automatic'](true), true);
}

test('med Versioner og fortryd får et nyt projekt Git, automatiske versioner og standarderne som før', async t => {
  const a = await aura(t), opened = await a.create(), root = opened.root;
  assert.deepEqual(opened.warnings, []);
  assert.deepEqual(await log(root), ['Projekt oprettet']);
  assert.equal((await a.store.project(root)).autoCheckpoint, true);
  assert.deepEqual(await decisions(a.bench, root), await defaults(), 'filændringer i projektet og kommandoer i sandkassen uden kort');
  assert.equal(await waiting(a), false, 'projektet venter ikke på noget');
});

test('beslutning (c): uden Versioner og fortryd får et nyt projekt hverken automatiske filændringer eller kommandoer', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  await assert.rejects(fsp.access(path.join(root, '.git')), 'intet Git uden versioner');
  assert.notEqual((await a.store.project(root)).autoCheckpoint, true);
  assert.deepEqual(await decisions(a.bench, root), ASKS, 'projektet spørger som før');
  assert.equal(await waiting(a), true, 'projektet venter på sikkerhedsnettet');
});

test('beslutning (c): slår brugeren versioner til bagefter, gives standarderne én gang, og et senere fravalg af versioner ændrer intet', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  assert.deepEqual(await decisions(a.bench, root), ASKS);
  // En ledig samtale har forberedt en opgave med de gamle valg; en samtale i gang beholder sin forberedelse.
  a.bench.chats.set('ledig', { prepared: null }); a.bench.chats.set('travl', { running: true, prepared: { kører: true } });
  // Indtil automatiske versioner er slået til, er der intet sikkerhedsnet, og projektet spørger stadig.
  await enableVersions(a, root, { afterEach: async step => {
    assert.deepEqual(await decisions(a.bench, root), ASKS, `efter ${step}`); assert.equal(await waiting(a), true, `efter ${step}`);
    a.bench.chats.get('ledig').prepared = { gammel: true };
  } });
  assert.deepEqual(await decisions(a.bench, root), await defaults(), 'automatikken kommer med sikkerhedsnettet');
  assert.equal(await waiting(a), false);
  assert.equal(a.bench.chats.get('ledig').prepared, null, 'næste opgave forberedes igen med de nye valg');
  assert.deepEqual(a.bench.chats.get('travl').prepared, { kører: true });
  assert.deepEqual(await log(root), ['Første version']);
  // Én gang: brugeren slår filændringer fra og slår automatiske versioner fra og til igen. Brugerens valg bevares.
  await a.handlers['project:settings-save']({ autoProjectFiles: false });
  assert.equal(await a.handlers['git:automatic'](false), false); assert.equal(await a.handlers['git:automatic'](true), true);
  assert.deepEqual(await decisions(a.bench, root), { filer: 'kort', kommandoer: await sandboxCommands });
  // Slås versionerne fra igen, ændres projektets indstillinger ikke.
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  assert.deepEqual(await decisions(a.bench, root), { filer: 'kort', kommandoer: await sandboxCommands });
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: true } });
  assert.deepEqual(await decisions(a.bench, root), { filer: 'kort', kommandoer: await sandboxCommands });
});

test('beslutning (c): brugerens eget valg i Projektets indstillinger, mens projektet venter, overskrives aldrig', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  assert.deepEqual(await decisions(a.bench, root), ASKS);
  // Brugeren vælger selv: kommandoer skal ikke køre automatisk. Valget er det samme som nu, men det er et valg.
  await a.handlers['project:settings-save']({ autoCommands: false });
  assert.equal(await waiting(a), false, 'brugerens valg afløser standarderne');
  await enableVersions(a, root);
  assert.deepEqual(await decisions(a.bench, root), ASKS, 'brugerens valg står');
});

test('beslutning (c): «Tillad altid i projektet» på et kort, mens projektet venter, er brugerens valg; kommandoer slås ikke til bagefter', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  assert.deepEqual(await decisions(a.bench, root), ASKS);
  await a.bench.approvalsPolicy.grant(taskContext(root), editRequest(root), { scope: 'project' });
  assert.deepEqual(await decisions(a.bench, root), { filer: 'project', kommandoer: 'kort' });
  await enableVersions(a, root);
  assert.deepEqual(await decisions(a.bench, root), { filer: 'project', kommandoer: 'kort' }, 'Aura slår ikke kommandoer til oven i brugerens valg');
  assert.equal(await waiting(a), false);
});

test('beslutning (c): ligger projektet inde i et andet Git-repository, kan versionerne ikke gemmes, og projektet spørger', async t => {
  const a = await aura(t, { parentInRepository: true });
  const root = (await a.create()).root;
  await assert.rejects(fsp.access(path.join(root, '.git')), 'projektet får ikke sit eget repository');
  assert.equal((await a.store.project(root)).autoCheckpoint, true, 'brugerens valg af versioner gemmes stadig');
  assert.deepEqual(await decisions(a.bench, root), ASKS);
  assert.equal(await waiting(a), true);
});

// Git kan ikke gemme projektets første version ved oprettelsen (signering). Brugeren retter det og gemmer versionen i appen.
for (const via of ['git:save', 'git:commit']) {
  test(`beslutning (c): fejler Git ved oprettelsen, spørger projektet, til første version er gemt med ${via}`, async t => {
    const a = await aura(t, { signing: true });
    const opened = await a.create(), root = opened.root;
    assert.match(opened.warnings.join(' '), /Versioner kunne ikke slås til/);
    assert.equal((await a.store.project(root)).autoCheckpoint, true);
    assert.deepEqual(await decisions(a.bench, root), ASKS, 'uden en gemt version er der intet sikkerhedsnet');
    assert.equal(await waiting(a), true);
    // Brugeren retter signeringen og fjerner de filer, Git nåede at stage, i sit eget Git-værktøj, som appens besked beder om.
    await fsp.writeFile(path.join(process.env.HOME, '.gitconfig'), '');
    execFileSync('git', ['rm', '-r', '-q', '--cached', '.'], { cwd: root });
    if (via === 'git:save') assert.ok((await a.handlers['git:save']({ note: 'Første version' })).head);
    else {
      const review = await a.handlers['git:review']();
      assert.ok((await a.handlers['git:commit']({ token: review.token, files: review.files.filter(file => !file.blocked).map(file => file.file), message: 'Første version' })).head);
    }
    assert.deepEqual(await decisions(a.bench, root), await defaults(), 'den gemte version fuldender sikkerhedsnettet');
    assert.equal(await waiting(a), false);
  });
}

test('beslutning (c): retter brugeren Git uden for Aura, får projektet standarderne, før næste opgave forberedes', async t => {
  const a = await aura(t, { signing: true });
  const root = (await a.create()).root;
  assert.deepEqual(await decisions(a.bench, root), ASKS);
  await fsp.writeFile(path.join(process.env.HOME, '.gitconfig'), '');
  execFileSync('git', ['commit', '-q', '-m', 'Min første version'], { cwd: root });
  await a.handlers['agent:prepare']({ text: 'Byg siden' });
  assert.deepEqual(a.bench.prepared.map(approvals => [approvals.autoProjectFiles, approvals.autoCommands]), [[true, true]], 'opgaven forberedes med standarderne');
  assert.equal(await waiting(a), false);
});

test('beslutning (c): slår brugeren funktionen til igen, efter at Git er rettet uden for Aura, gives standarderne straks', async t => {
  const a = await aura(t, { signing: true });
  const root = (await a.create()).root;
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  await fsp.writeFile(path.join(process.env.HOME, '.gitconfig'), '');
  execFileSync('git', ['commit', '-q', '-m', 'Min første version'], { cwd: root });
  await a.handlers['agent:prepare']({ text: 'Byg siden' });
  assert.deepEqual(await decisions(a.bench, root), ASKS, 'uden funktionen er der intet sikkerhedsnet');
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: true } });
  assert.deepEqual(await decisions(a.bench, root), await defaults());
  assert.equal(await waiting(a), false);
});

test('beslutning (c): et nyt projekt i en mappe med samme sti som et slettet projekt arver ikke dets automatik', async t => {
  const a = await aura(t);
  const old = (await a.create()).root;
  assert.deepEqual(await decisions(a.bench, old), await defaults());
  // Brugeren sletter projektmappen uden for Aura og opretter et projekt med samme navn, nu uden versioner. Lageret har stadig
  // det gamle projekts valg under samme sti.
  await fsp.rm(old, { recursive: true, force: true });
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  assert.equal(root, old, 'samme sti');
  assert.deepEqual(await decisions(a.bench, root), ASKS, 'det nye projekt spørger');
  assert.equal(await waiting(a), true);
});

test('beslutning (c): uden kommandosandkassen giver sikkerhedsnettet kun filændringer uden kort, og kun én gang', async t => {
  const defaultsModule = require('../core/new-project-defaults.cjs');
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  // Sikkerhedsnettet bygges uden om handlerne, så kun modulet afgør det her.
  await a.bench.features.save(null, { scope: 'alle', values: { versioner: true } });
  await a.bench.git.initialize(root); await a.bench.git.setIdentity(root, { name: 'Prøvebruger', email: 'proeve@example.invalid' });
  await a.bench.git.saveAll(root, 'Første version'); await a.store.saveProject(root, { autoCheckpoint: true });
  const noSandbox = { support: async () => ({ available: false, reason: 'Ingen sandkasse på denne computer.' }) };
  assert.equal(await defaultsModule.safetyNet(a.bench, root), true);
  assert.equal(await defaultsModule.settle(a.bench, root, noSandbox), true);
  assert.deepEqual(await decisions(a.bench, root), { filer: 'project', kommandoer: 'kort' });
  assert.equal(await defaultsModule.settle(a.bench, root, { support: async () => ({ available: true }) }), false, 'standarderne gives kun én gang');
  assert.deepEqual(await decisions(a.bench, root), { filer: 'project', kommandoer: 'kort' });
});

// Skeptikerens fund efter første runde (spor V). Projektets indstillinger må ikke vise ventetiden, når brugeren allerede har valgt
// med «Tillad altid i projektet», forklaringen skal sige den faktiske grund til, at sikkerhedsnettet mangler, og brugeren skal
// få at vide, når Aura giver standarderne, uanset hvilket trin der fuldendte nettet.
const reason = async a => (await a.handlers['project:settings']()).pendingReason?.kind ?? null;
const given = a => a.bench.events.filter(event => event.type === 'approvals.defaults');

test('beslutning (c): efter «Tillad altid i projektet» viser Projektets indstillinger ikke længere, at projektet venter', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  assert.equal(await waiting(a), true);
  await a.bench.approvalsPolicy.grant(taskContext(root), editRequest(root), { scope: 'project' });
  const settings = await a.handlers['project:settings']();
  assert.deepEqual([settings.approvals.autoProjectFiles, settings.approvals.autoCommands, settings.pendingDefaults, settings.pendingReason], [true, false, false, null], 'brugeren har valgt; Aura slår ikke kommandoer til bagefter');
});

test('beslutning (c): forklaringen siger, hvad der mangler: funktionen, automatiske versioner eller en version, Git kan gemme', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  assert.equal(await reason(a), 'funktion', 'funktionen Versioner og fortryd er slået fra');
  await enableVersions(a, root, { afterEach: async step => assert.equal(await reason(a), 'automatisk', `efter ${step}: funktionen er slået til, men projektet gemmer ikke en version efter hver AI-opgave`) });
  assert.equal(await reason(a), null);
  const signed = await aura(t, { signing: true });
  const signedRoot = (await signed.create()).root;
  const settings = await signed.handlers['project:settings']();
  assert.deepEqual([settings.pendingDefaults, settings.pendingReason?.kind], [true, 'git'], 'automatiske versioner er valgt, men Git kan ikke gemme dem');
  // Detaljen er Gits egen grund, samme kontrol som opgavens automatiske version (her: filerne, Git nåede at stage).
  assert.equal(settings.pendingReason.detail, await require('../core/checkpoints.cjs').automaticBlock(await signed.bench.git.repository(signedRoot)));
  assert.match(settings.pendingReason.detail, /staged ændringer/);
  const inside = await aura(t, { parentInRepository: true });
  await inside.create();
  assert.equal(await reason(inside), 'git');
});

test('beslutning (c): når sikkerhedsnettet giver standarderne, får brugeren besked én gang, uanset hvilket trin der fuldendte det', async t => {
  const a = await aura(t);
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const root = (await a.create()).root;
  await enableVersions(a, root, { afterEach: async step => assert.deepEqual(given(a), [], `ingen besked efter ${step}`) });
  assert.deepEqual(given(a), [{ type: 'approvals.defaults', root, files: true, commands: (await sandboxCommands) === 'commands' }]);
  assert.equal(await a.handlers['git:automatic'](false), false); assert.equal(await a.handlers['git:automatic'](true), true);
  assert.equal(given(a).length, 1, 'standarderne og beskeden kommer kun én gang');
  // Fuldender en gemt version nettet, får brugeren samme besked.
  const signed = await aura(t, { signing: true });
  const signedRoot = (await signed.create()).root;
  await fsp.writeFile(path.join(process.env.HOME, '.gitconfig'), '');
  execFileSync('git', ['rm', '-r', '-q', '--cached', '.'], { cwd: signedRoot });
  assert.ok((await signed.handlers['git:save']({ note: 'Første version' })).head);
  assert.deepEqual(given(signed).map(event => event.root), [signedRoot]);
  // Et projekt, hvor brugeren selv har valgt, får ingen besked.
  const chosen = await aura(t);
  await chosen.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const chosenRoot = (await chosen.create()).root;
  await chosen.handlers['project:settings-save']({ autoCommands: false });
  await enableVersions(chosen, chosenRoot);
  assert.deepEqual(given(chosen), []);
});

// Q:B2-1: Electron-prøverne (verify-features, verify-versions og measure-screens) kører Git gennem en indpakning uden brugerens
// og systemets Git-opsætning (GIT_CONFIG_GLOBAL=/dev/null), altså uden navn og e-mail. Her køres samme indpakning med rigtig Git:
// et nyt projekt med versioner får sit sikkerhedsnet (Aura giver projektet et lokalt navn) og godkender filændringen uden kort, så
// scripterne skal vente på kvitteringen. Uden versioner spørger projektet, så scripterne venter på kortet der
// (tests/v-electron-forventninger.test.cjs kontrollerer scripterne mod dette).
test('Q:B2-1: med Electron-prøvernes Git-opsætning kommer intet kort med versioner, og kortet kommer uden', async t => {
  const a = await aura(t);
  const bin = path.join(a.base, 'bin'); await fsp.mkdir(bin);
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  // Som i scripterne, og indpakningen skriver hvert kald i en logfil, så prøven ved, at Aura gik gennem den.
  const calls = path.join(a.base, 'git-kald.txt');
  await fsp.writeFile(path.join(bin, 'git'), `#!/bin/sh\necho "$@" >> '${calls}'\nexport GIT_CONFIG_GLOBAL=/dev/null\nexport GIT_CONFIG_NOSYSTEM=1\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const saved = process.env.PATH; process.env.PATH = bin + path.delimiter + saved; t.after(() => { process.env.PATH = saved; });
  const opened = await a.create(), root = opened.root;
  assert.deepEqual(opened.warnings, []);
  assert.match(await fsp.readFile(calls, 'utf8'), /commit/, 'Aura gemte projektets første version gennem indpakningen');
  assert.deepEqual(await log(root), ['Projekt oprettet']);
  assert.deepEqual(await decisions(a.bench, root), await defaults(), 'filændringen godkendes uden kort; samtalen kvitterer');
  await a.handlers['features:save']({ scope: 'alle', values: { versioner: false } });
  const without = (await a.create({ name: 'Uden versioner' })).root;
  assert.deepEqual(await decisions(a.bench, without), ASKS, 'uden versioner kommer kortet');
  const settings = await a.handlers['project:settings']();
  assert.deepEqual([settings.approvals.autoProjectFiles, settings.approvals.autoCommands, settings.pendingDefaults], [false, false, true], 'det, verify-features trin 6 kontrollerer');
});
