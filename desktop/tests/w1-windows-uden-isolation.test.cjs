// Valg 3 (5. november 2026): på en platform uden kommandosandkasse (Windows) må automatiske kommandoer, gemte kommandoregler og
// «Godkend alt» tillades UDEN isolation, men kun efter brugerens eksplicitte valg. Windows er simuleret; intet her er kørt på en rigtig Windows-maskine.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const sandbox = require('../core/command-sandbox.cjs');
const { approveAllApplies, commandUnisolatedFor } = require('../core/chat-session.cjs');

const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const WINDOWS = { available: false, platform: 'win32', unisolatedPossible: true, reason: 'Isolation understøttes endnu ikke på Windows.' };
const command = (text, cwd, id = 'kommando') => ({ id, permission: 'bash', metadata: {}, patterns: [text], toolInput: { tool: 'bash', command: text, workdir: cwd } });

async function policyFixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-w1-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), outside = path.join(base, 'ekstern'), scratch = path.join(base, 'scratch');
  await Promise.all([root, outside, scratch].map(folder => fs.mkdir(folder)));
  const store = new Store(path.join(base, 'data'), {}), policy = new ApprovalsPolicy(store);
  const win = { projectRoot: root, workspaceRoot: root, scratchRoot: scratch, mode: 'build', taskRules: new Set(), commandSandboxSupported: false, commandSandbox: false, commandUnisolated: true, autoCommandsSnapshot: true, autoCommandsUnisolated: true };
  return { root, outside, scratch, policy, win };
}
async function benchFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-w1-bench-')), events = [], engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit: event => events.push(event), engineFactory: options => {
    const engine = { options, active: false, session: { id: 'session-' + engines.length }, pending: new Map(), sent: [], replies: [], start: async () => { engine.active = true; }, send: async (text, system) => engine.sent.push({ text, system }), reply: async (id, allow) => { engine.replies.push({ id, allow }); engine.pending.delete(id); }, close: async () => {}, stop: async () => {}, interrupt: async () => {} };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, 'p'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'index.html'), 'a');
  const bench = await registry.select({ root: await fs.realpath(root), name: 'p' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Prøve', baseURL: 'http://127.0.0.1:1/v1' }), connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  bench.skills.context = async () => ({ rules: '', skills: [], titles: [], features: {}, integrations: [] });
  return { bench, engines, events, connection, root: bench.project.root };
}
async function start(t, support, { setup } = {}) {
  const f = await benchFixture(t);
  t.mock.method(sandbox, 'support', async () => support);
  if (setup) await setup(f);
  const input = { connectionID: f.connection.id, modelID: 'test', mode: 'free', text: 'Byg' }, disclosure = await f.bench.prepare(input);
  await f.bench.send({ text: 'Byg', fingerprint: disclosure.fingerprint, contextBinding: disclosure.contextBinding });
  return { ...f, engine: f.engines[0], chat: f.bench.chat };
}
async function ask(f, p) { f.engine.pending.set(p.id, p); await f.chat.permissionAsked({ type: 'permission.asked', properties: p }); return f.engine.replies.some(reply => reply.id === p.id && reply.allow === true); }

test('support melder, at kun en platform uden sandkasse kan vælge at køre uden isolation', async () => {
  const win = await sandbox.support({ platform: 'win32' });
  assert.equal(win.available, false); assert.equal(win.unisolatedPossible, true);
  assert.equal(sandbox.canRunUnisolated(win), true);
  assert.equal(sandbox.canRunUnisolated({ available: false, platform: 'linux', reason: 'x' }), false, 'en Linux-maskine, hvor sandkassen ikke kan starte, får ingen reservevej');
  assert.equal(sandbox.canRunUnisolated({ available: false, platform: 'darwin' }), false);
  assert.equal(sandbox.canRunUnisolated({ available: true, platform: 'win32' }), false);
  assert.equal(sandbox.canRunUnisolated({ available: false }), false, 'Samtale og Planlæg har ingen platform og får ingen reservevej');
});

test('projektets valg gemmes kun sammen med automatiske kommandoer og slukkes med dem', async t => {
  const { root, policy } = await policyFixture(t);
  assert.deepEqual(await policy.settings(root), { autoProjectFiles: false, autoCommands: false, autoCommandsUnisolated: false, rules: [] });
  assert.equal((await policy.setCommands(root, true)).autoCommandsUnisolated, false, 'uden eksplicit valg gemmes intet om isolation');
  assert.equal((await policy.setCommands(root, true, { unisolated: true })).autoCommandsUnisolated, true);
  assert.equal((await policy.setProjectFiles(root, true)).autoCommandsUnisolated, true, 'andre indstillinger rører ikke valget');
  const off = await policy.setCommands(root, false, { unisolated: true });
  assert.equal(off.autoCommands, false); assert.equal(off.autoCommandsUnisolated, false);
});

test('uden isolation tillades en kommando i projektet automatisk, men kun når alle led er valgt', async t => {
  const { root, outside, policy, win } = await policyFixture(t), p = command('npm run build', root);
  assert.deepEqual([(await policy.allowed(win, p)).allowed, (await policy.allowed(win, p)).source], [true, 'commands']);
  assert.equal((await policy.allowed({ ...win, commandUnisolated: false }, p)).allowed, false, 'uden valget er Windows som før');
  assert.equal((await policy.allowed({ ...win, autoCommandsUnisolated: false }, p)).allowed, false, 'uden projektets valg tillades intet automatisk');
  assert.equal((await policy.allowed({ ...win, autoCommandsSnapshot: false }, p)).allowed, false);
  assert.equal((await policy.allowed(win, command('npm run build', outside))).allowed, false, 'en mappe uden for projektet kræver stadig kortet');
  assert.equal((await policy.allowed({ ...win, mode: 'plan' }, p)).allowed, false, 'låste handlinger er stadig låst');
  assert.equal((await policy.allowed({ ...win, mode: 'chat' }, p)).allowed, false);
});

test('uden isolation tillades en kommando, der nævner beskyttede navne, hverken automatisk eller som gemt regel', async t => {
  const { root, policy, win } = await policyFixture(t);
  for (const text of ['type .env', 'cat ./.env.local', 'cat "config/.env"', 'type .ssh\\id_rsa', 'cat .git/config', 'copy a.txt references\\b.txt', 'node x.js --key=$HOME/.aws/credentials', 'git config .git/hooks/pre-commit']) {
    const result = await policy.allowed(win, command(text, root));
    assert.equal(result.allowed, false, text); assert.equal(result.descriptor.commandProtected, true, text); assert.equal(result.descriptor.persistable, false, text);
  }
  await assert.rejects(policy.grant(win, command('type .env', root), { scope: 'project' }), /én gang/);
  assert.equal((await policy.describe(win, command('node index.js', root))).commandProtected, false);
  assert.equal((await policy.describe({ ...win, mode: 'plan' }, command('node index.js', root))).persistable, false);
});

test('en gemt kommandoregel bruges uden isolation kun når valget er tændt', async t => {
  const { root, policy, win } = await policyFixture(t), p = command('node lokal.cjs', root), noAuto = { ...win, autoCommandsSnapshot: false, autoCommandsUnisolated: false };
  assert.equal((await policy.describe({ ...win, commandUnisolated: false }, p)).persistable, false, 'uden valget tilbydes «Tillad altid» ikke');
  assert.equal((await policy.describe(noAuto, p)).persistable, true);
  await policy.grant(noAuto, p, { scope: 'project' });
  assert.equal((await policy.allowed(noAuto, p)).source, 'rule');
  assert.equal((await policy.allowed({ ...noAuto, commandUnisolated: false }, p)).allowed, false, 'reglen virker ikke, når valget er slået fra');
});

test('på Mac og Linux er godkendelserne uændrede af den nye tilstand', async t => {
  const { root, policy, win } = await policyFixture(t), mac = { ...win, commandSandboxSupported: true, commandSandbox: true, commandUnisolated: undefined, autoCommandsUnisolated: undefined }, p = command('npm test', root);
  const result = await policy.allowed(mac, p);
  assert.equal(result.source, 'commands'); assert.equal(result.descriptor.persistable, true);
  assert.equal('commandProtected' in result.descriptor, false); assert.equal('unisolated' in result.descriptor, false);
  assert.equal((await policy.allowed({ ...mac, commandSandbox: false }, p)).allowed, false, 'uden sandkasse tillades intet, når Windows-valget ikke er tændt');
  assert.equal((await policy.allowed(mac, command('cat .env', root))).allowed, true, 'sandkassen tager sig af beskyttede navne, som før');
});

test('Godkend alt uden isolation gælder kommandoer, men aldrig beskyttede navne, låste handlinger, nettet eller mapper udefra', () => {
  const kort = { match: { kind: 'bash', command: 'npm test' }, blockedMode: false };
  assert.equal(approveAllApplies(true, kort, { unisolated: true }), true);
  assert.equal(approveAllApplies(true, kort, { unisolated: false }), false);
  assert.equal(approveAllApplies(true, kort), false);
  assert.equal(approveAllApplies(true, { ...kort, commandProtected: true }, { unisolated: true }), false);
  assert.equal(approveAllApplies(true, { ...kort, blockedMode: true }, { unisolated: true }), false);
  for (const kind of ['webfetch', 'grep', 'external_directory']) assert.equal(approveAllApplies(true, { match: { kind } }, { unisolated: true }), false, kind);
  assert.equal(approveAllApplies(true, { ...kort, commandProtected: true }, { sandbox: true }), true, 'med sandkasse er reglen som før');
});

test('kun en platform uden sandkasse og et eksplicit valg giver kommandoer uden isolation', () => {
  const win = { available: false, platform: 'win32', unisolatedPossible: true };
  assert.equal(commandUnisolatedFor({ support: win, autoCommandsSnapshot: true, autoCommandsUnisolated: true }), true);
  assert.equal(commandUnisolatedFor({ support: win, approveAll: true, approveAllUnisolated: true }), true);
  assert.equal(commandUnisolatedFor({ support: win, autoCommandsSnapshot: true }), false, 'et gammelt valg uden eksplicit accept er ikke nok');
  assert.equal(commandUnisolatedFor({ support: win, approveAll: true }), false);
  assert.equal(commandUnisolatedFor({ support: { available: true, platform: 'darwin' }, autoCommandsSnapshot: true, autoCommandsUnisolated: true, approveAll: true, approveAllUnisolated: true }), false);
  assert.equal(commandUnisolatedFor({ support: { available: false, platform: 'linux' }, autoCommandsUnisolated: true, autoCommandsSnapshot: true }), false);
});

test('simuleret Windows: projektets valg lader en opgave starte uden sandkasse og godkender kun almindelige kommandoer', async t => {
  const f = await start(t, WINDOWS, { setup: async ({ bench, root }) => { await bench.approvalsPolicy.setCommands(root, true, { unisolated: true }); } });
  assert.equal(f.engine.options.sandbox, null, 'der er ingen sandkasse at starte');
  assert.equal(f.chat.commandUnisolatedNow(), true); assert.equal(f.chat.prepared.commandIsolation, false);
  assert.equal(await ask(f, command('npm run build', f.root, 'a')), true);
  assert.equal(await ask(f, command('type .env', f.root, 'b')), false, 'beskyttede navne kræver kortet');
  assert.equal(f.engine.pending.has('b'), true);
  const card = f.events.filter(event => event.type === 'permission.asked').at(-1);
  assert.equal(card.properties.policy.commandProtected, true); assert.equal(card.properties.policy.persistable, false);
});

test('simuleret Windows: automatiske kommandoer uden det eksplicitte valg afvises som før', async t => {
  const f = await benchFixture(t);
  t.mock.method(sandbox, 'support', async () => WINDOWS);
  await f.bench.approvalsPolicy.setCommands(f.root, true);
  await assert.rejects(f.bench.prepare({ connectionID: f.connection.id, modelID: 'test', mode: 'free', text: 'Byg' }), /Windows/);
});

test('simuleret Windows: Godkend alt kræver et eksplicit valg om isolation og kan ses og slås fra', async t => {
  const f = await start(t, WINDOWS);
  const first = command('node ny.cjs', f.root, 'a'); f.engine.pending.set('a', first); await f.chat.permissionAsked({ type: 'permission.asked', properties: first });
  const card = f.events.filter(event => event.type === 'permission.asked').at(-1).properties.policy;
  assert.equal(card.approveAllAvailable, true); assert.equal(card.approveAllUnisolated, true, 'kortet skal vide, at valget er uden isolation, så advarslen vises');
  await assert.rejects(f.bench.reply({ id: 'a', allow: true, scope: 'chat' }), /isolation/);
  assert.equal(f.chat.approveAll, false); assert.equal(f.engine.pending.has('a'), true);
  await f.bench.reply({ id: 'a', allow: true, scope: 'chat', unisolated: true });
  assert.equal(f.chat.approveAll, true); assert.equal(f.chat.view().approveAllUnisolated, true);
  const changed = f.events.filter(event => event.type === 'approve-all').at(-1);
  assert.equal(changed.enabled, true); assert.equal(changed.unisolated, true);
  assert.equal(await ask(f, command('npm run build', f.root, 'b')), true);
  assert.equal(await ask(f, command('cat .git/config', f.root, 'c')), false, 'beskyttede navne kræver stadig kortet');
  const web = { id: 'd', permission: 'webfetch', metadata: {}, patterns: [], toolInput: { url: 'https://example.com/' } };
  assert.equal(await ask(f, web), false, 'nettet automatiseres aldrig');
  f.chat.approveAllOff();
  assert.equal(f.chat.approveAll, false); assert.equal(f.chat.view().approveAllUnisolated, false);
  assert.equal(await ask(f, command('npm run build', f.root, 'e')), false, 'efter Slå fra spørges der igen');
});

test('Mac og Linux: et unisolated-svar kan ikke omgå sandkassen og Godkend alt ændrer sig ikke', async t => {
  const f = await start(t, { available: true, platform: 'darwin', reason: '' });
  const p = command('node ny.cjs', f.root, 'a'); f.engine.pending.set('a', p); await f.chat.permissionAsked({ type: 'permission.asked', properties: p });
  const card = f.events.filter(event => event.type === 'permission.asked').at(-1).properties.policy;
  assert.equal(card.approveAllAvailable, true); assert.equal('approveAllUnisolated' in card, false);
  assert.equal(f.chat.prepared.commandUnisolatedPossible, false);
  await f.bench.reply({ id: 'a', allow: true, scope: 'chat', unisolated: true });
  assert.equal(f.chat.view().approveAllUnisolated, false);
});

test('låste handlinger i Samtale og Planlæg forbliver låste på simuleret Windows', async t => {
  const f = await start(t, WINDOWS, { setup: async ({ bench, root }) => { await bench.approvalsPolicy.setCommands(root, true, { unisolated: true }); } });
  f.chat.runMode = 'plan'; f.chat.approveAll = true; f.chat.approveAllUnisolated = true;
  assert.equal(await ask(f, command('npm run build', f.root, 'a')), false);
  assert.equal(f.engine.pending.has('a'), true);
});
