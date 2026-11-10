// Kortsamlingen (brugerens beslutning 10. november 2026, «Byg samlingen»): efter fem kort i én opgave spørger Aura én gang, om resten af
// opgaven må fortsætte i projektmappen. Projektmappen dækker det, projektets automatik dækker: filændringer og søgning i projektet og
// kommandoer, der kører i sandkassen. Beskyttede filer, mapper uden for projektet, kommandoer uden sandkasse, nettet og udgivelse spørger
// stadig. Prøverne går ad den rigtige vej gennem ChatSession (permissionAsked og reply) med den rigtige ApprovalsPolicy og det rigtige lager
// og med forespørgsler optaget fra OpenCode 1.19.5. Kun motoren er falsk: den husker svarene.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceRegistry } = require('../core/workspaces.cjs');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const sandbox = require('../core/command-sandbox.cjs');
const { VERSION } = require('../core/engine.cjs');

const profiles = path.join(__dirname, '../../profiles');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const FIXTURES = path.join(__dirname, 'fixtures', `opencode-${VERSION}`);
const EDITS = ['byg-git-filer__write-inde-absolut__1-edit', 'byg-git-filer__write-inde-ny-mappe__1-edit', 'byg-git-filer__write-inde-relativ__1-edit', 'byg-git-filer__edit-inde-absolut__1-edit', 'byg-git-filer__edit-inde-relativ__1-edit', 'apply-patch-git__patch-opdater-inde__1-edit', 'apply-patch-git__patch-tilfoej-inde__1-edit'];
const SEARCH = ['byg-git-soeg__grep-uden-sti__1-grep', 'byg-git-soeg__grep-sti-inde-relativ__1-grep', 'byg-git-soeg__grep-include__1-grep', 'byg-git-soeg__grep-sti-inde-absolut__1-grep'];
const COMMANDS = ['byg-git-soeg__bash-npm-build__1-bash', 'byg-git-soeg__bash-kort__1-bash', 'byg-git-soeg__bash-workdir-inde__1-bash'];
const COMMAND_OUTSIDE = 'byg-git-soeg__bash-workdir-ude__2-bash';
const OUTSIDE_READ = 'byg-git-filer__read-ude-absolut__1-external_directory';
const WEB = 'byg-git-soeg__webfetch__1-webfetch';
const DOOM = 'byg-git-soeg__doom-loop__1-doom_loop';
let unique = 0;

// Et projekt uden automatik (som et åbnet eller ældre projekt) og en opgave i Arbejd direkte. Computeren har ingen sandkasse, medmindre prøven siger det.
async function project(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kortsamling-'))), events = [], engines = [];
  const registry = new WorkspaceRegistry({ directory: path.join(directory, 'data'), profiles, safeStorage, emit: event => events.push(event), engineFactory: options => {
    const engine = { options, active: false, grepGuard: true, session: { id: 'session-' + engines.length }, pending: new Map(), replies: [], start: async () => { engine.active = true; }, send: async () => {}, reply: async (id, allow) => { engine.replies.push({ id, allow }); engine.pending.delete(id); }, abort: async () => {}, close: async () => {}, stop: async () => {}, interrupt: async () => {} };
    engines.push(engine); return engine;
  } });
  t.after(async () => { await registry.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, 'projekt'), outside = path.join(directory, 'ekstern');
  for (const folder of [path.join(root, 'public'), path.join(root, 'src'), outside]) await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(root, 'notes.txt'), 'Hej NEEDLE\n'); await fs.writeFile(path.join(outside, 'fil.txt'), 'Ekstern\n');
  t.mock.method(sandbox, 'support', async () => ({ available: false, platform: 'darwin', reason: 'Prøven har ingen sandkasse.' }));
  const bench = await registry.select({ root, name: 'Kortsamling' });
  const saved = await bench.saveConnection({ kind: 'compatible', name: 'Prøve', baseURL: 'http://127.0.0.1:1/v1' }), connection = await bench.connection(saved.connections[0].id);
  bench.selection = async () => ({ connection, model: { id: 'test' }, route: null });
  bench.skills.context = async () => ({ rules: '', skills: [], titles: [], features: {}, integrations: [] });
  const f = { root: bench.project.root, outside, bench, events, engines };
  f.task = async (text = 'Byg siden') => {
    const disclosure = await bench.prepare({ connectionID: connection.id, modelID: 'test', mode: 'free', text });
    await bench.send({ text, fingerprint: disclosure.fingerprint, contextBinding: disclosure.contextBinding });
    f.chat = bench.chat; f.engine = bench.chat.engine;
  };
  return f;
}
// Motoren kører med sandkassen (som efter «Godkend alt» eller projektets automatik), uden at kommandoerne godkendes automatisk.
function sandboxRunning(f) { f.chat.prepared.commandIsolation = true; f.chat.commandSandbox = { prøve: true }; f.engine.sandbox = f.chat.commandSandbox; }
// En forespørgsel ad den rigtige vej: værktøjets del, som motoren har sendt, og så permission.asked. Hver får sit eget id og kald.
async function send(f, request) {
  const before = f.events.length;
  f.engine.pending.set(request.id, request);
  await f.chat.event({ type: 'permission.asked', properties: request });
  const after = f.events.slice(before), card = after.find(event => event.type === 'permission.asked' && event.properties?.id === request.id)?.properties || null;
  return { id: request.id, card, collect: card?.policy?.collect || null, auto: after.find(event => event.type === 'permission.auto') || null };
}
async function ask(f, name) {
  const n = ++unique, text = (await fs.readFile(path.join(FIXTURES, name + '.json'), 'utf8')).replaceAll('${ROOT:rel/}', f.root.slice(1)).replaceAll('${ROOT}', f.root).replaceAll('${OUTSIDE}', f.outside);
  const recorded = JSON.parse(text), request = { ...recorded.request, id: `${recorded.request.id}-${n}` };
  if (request.tool) {
    request.tool = { ...request.tool, callID: `${request.tool.callID}-${n}` };
    if (recorded.toolPartAtAsk) f.chat.runTools.set(`del-${n}`, { id: `del-${n}`, callID: request.tool.callID, tool: recorded.toolPartAtAsk.tool, state: { status: recorded.toolPartAtAsk.status, input: recorded.toolPartAtAsk.input } });
  }
  return send(f, request);
}
const once = (f, r) => f.chat.reply({ id: r.id, allow: true });
const collect = (f, r) => f.chat.reply({ id: r.id, ids: [r.id], allow: true, scope: 'collect' });
// Fem kort, besvaret ét ad gangen, som en bruger gør. Ingen af dem spørger om resten af opgaven.
async function fiveCards(f, names = [EDITS[0], SEARCH[0], EDITS[1], COMMANDS[0], EDITS[2]]) {
  for (const name of names) { const r = await ask(f, name); assert.ok(r.card, `${name} giver et kort`); assert.equal(r.collect, null, `${name}: endnu ikke fem kort`); await once(f, r); }
}

test('efter fem kort spørger det første kort i projektmappen om resten af opgaven; nettet, mapper udenfor og kommandoer uden sandkasse gør ikke', async t => {
  const f = await project(t); await f.task();
  await fiveCards(f);
  for (const name of [WEB, OUTSIDE_READ, COMMANDS[1]]) { const r = await ask(f, name); assert.ok(r.card, name); assert.equal(r.collect, null, `${name} hører ikke til projektmappen`); await once(f, r); }
  const r = await ask(f, EDITS[3]);
  assert.deepEqual(r.collect, { commands: false, search: true }, 'uden sandkasse dækker et ja filændringer og søgning i projektet, ikke kommandoer');
  assert.equal(r.auto, null); assert.equal(f.engine.pending.has(r.id), true, 'handlingen venter på svaret');
});

test('et ja godkender den ventende handling og resten af opgaven i projektmappen; beskyttede filer, mapper udenfor, nettet og kommandoer uden sandkasse spørger stadig', async t => {
  const f = await project(t); await f.task();
  await fiveCards(f);
  const r = await ask(f, EDITS[3]); assert.ok(r.collect);
  await collect(f, r);
  assert.deepEqual(f.engine.replies.at(-1), { id: r.id, allow: true }, 'kortet besvarer også den ventende handling');
  const entry = f.chat.activityList().find(item => item.id === `approval-${r.id}`);
  assert.equal(entry.status, 'allowed-task'); assert.match(entry.detail, /^Resten af opgaven må AI’en ændre filer i projektet og søge i projektets filer uden at spørge\.$/);
  for (const name of [EDITS[4], EDITS[5], EDITS[6], SEARCH[1], SEARCH[2], SEARCH[3]]) {
    const a = await ask(f, name);
    assert.equal(a.card, null, `${name} giver ikke et kort`); assert.equal(a.auto?.source, 'task', name); assert.deepEqual(f.engine.replies.at(-1), { id: a.id, allow: true }, name);
  }
  for (const name of [OUTSIDE_READ, WEB, COMMANDS[2]]) { const a = await ask(f, name); assert.ok(a.card, `${name} spørger stadig`); assert.equal(a.auto, null, name); assert.equal(a.collect, null, name); await once(f, a); }
  const secret = await send(f, { id: `hemmelig-${++unique}`, permission: 'edit', patterns: ['.env.local'], metadata: { filepath: path.join(f.root, '.env.local') } });
  assert.ok(secret.card, 'en beskyttet fil spørger stadig'); assert.equal(secret.auto, null);
});

test('et nej gælder resten af opgaven: kortene kommer ét ad gangen, og Aura spørger ikke igen', async t => {
  const f = await project(t); await f.task();
  await fiveCards(f);
  const r = await ask(f, EDITS[3]); assert.ok(r.collect);
  // «Nej, spørg hver gang» gør kortet til et almindeligt kort i brugerfladen, og handlingen besvares som før.
  await once(f, r);
  for (const name of [EDITS[4], SEARCH[1], EDITS[5], EDITS[6], SEARCH[2], SEARCH[3]]) {
    const a = await ask(f, name);
    assert.ok(a.card, name); assert.equal(a.collect, null, `${name}: Aura spørger kun én gang i opgaven`);
    if (name === SEARCH[3]) await assert.rejects(collect(f, a), /ikke længere aktuelt/, 'et ja kan ikke gives på et andet kort');
    await once(f, a);
  }
});

test('svaret om resten af opgaven gælder kun kortet med spørgsmålet', async t => {
  const f = await project(t); await f.task();
  const first = await ask(f, EDITS[0]);
  await assert.rejects(collect(f, first), /ikke længere aktuelt/);
  assert.equal(f.engine.pending.has(first.id), true, 'handlingen venter stadig');
  await once(f, first);
  const next = await ask(f, EDITS[1]); assert.ok(next.card, 'intet ja er gemt'); assert.equal(next.auto, null);
});

test('et kort, der lægges sammen med et vist kort for samme adgang, er ikke et nyt kort', async t => {
  const f = await project(t); await f.task();
  const a = await ask(f, EDITS[0]), b = await ask(f, EDITS[1]);
  assert.ok(a.card && b.card); assert.equal(a.card.policy.key, b.card.policy.key, 'samme adgang: brugerfladen viser ét kort');
  await f.chat.reply({ id: a.id, ids: [a.id, b.id], allow: true });
  for (const name of [SEARCH[0], EDITS[2], COMMANDS[0], EDITS[3]]) { const r = await ask(f, name); assert.equal(r.collect, null, `${name}: kun ${name === EDITS[3] ? 'fem' : 'få'} kort er vist`); await once(f, r); }
  assert.ok((await ask(f, EDITS[4])).collect, 'det sjette viste kort spørger');
});

test('gentagelsesvagtens kort tæller med, men spørger aldrig om resten af opgaven', async t => {
  const f = await project(t); await f.task();
  for (let i = 0; i < 3; i++) assert.equal((await ask(f, DOOM)).card, null, 'de første tre gentagelser besvares uden kort');
  await fiveCards(f, [EDITS[0], SEARCH[0], EDITS[1], COMMANDS[0]]);
  const loop = await ask(f, DOOM); assert.ok(loop.card, 'gentagelsesvagtens kort er det femte'); assert.equal(loop.collect, null); await once(f, loop);
  const again = await ask(f, DOOM); assert.ok(again.card); assert.equal(again.collect, null, 'gentagelsesvagten hører ikke til projektmappen'); await once(f, again);
  assert.ok((await ask(f, EDITS[2])).collect);
});

test('kommandoer i sandkassen hører til projektmappen, og kort, der allerede venter i projektmappen, besvares med ja', async t => {
  const f = await project(t); await f.task(); sandboxRunning(f);
  await fiveCards(f, [COMMANDS[0], COMMANDS[1], EDITS[0], COMMANDS[2], SEARCH[0]]);
  const r = await ask(f, COMMANDS[0]);
  assert.deepEqual(r.collect, { commands: true, search: true });
  const waitingEdit = await ask(f, EDITS[1]), waitingOutside = await ask(f, OUTSIDE_READ);
  assert.ok(waitingEdit.card); assert.equal(waitingEdit.collect, null); assert.ok(waitingOutside.card);
  await collect(f, r);
  const answered = f.engine.replies.map(reply => reply.id);
  assert.ok(answered.includes(r.id) && answered.includes(waitingEdit.id), 'den ventende filændring er også godkendt');
  assert.equal(answered.includes(waitingOutside.id), false, 'mappen uden for projektet venter stadig på dig');
  assert.equal(f.chat.activityList().find(item => item.id === `approval-${waitingEdit.id}`).status, 'allowed-task');
  assert.equal((await ask(f, COMMANDS[2])).auto?.source, 'task', 'en kommando i sandkassen i projektet');
  const outsideCommand = await ask(f, COMMAND_OUTSIDE);
  assert.ok(outsideCommand.card, 'en kommando, der kører uden for projektet, spørger stadig'); assert.equal(outsideCommand.auto, null);
});

test('tælleren og et ja nulstilles ved Stop og ved næste opgave', async t => {
  const f = await project(t); await f.task();
  await fiveCards(f);
  await collect(f, await ask(f, EDITS[3]));
  assert.equal((await ask(f, EDITS[4])).auto?.source, 'task');
  await f.chat.stop();
  assert.deepEqual([f.chat.taskRules.size, f.chat.cardsShown, f.chat.collectOffer], [0, 0, null], 'Stop nulstiller svaret og tælleren');
  // Næste opgave efter Stop: kortene kommer igen, og spørgsmålet kommer igen efter fem kort.
  await f.task('Næste opgave');
  const first = await ask(f, EDITS[5]); assert.ok(first.card, 'et ja gælder ikke næste opgave'); assert.equal(first.collect, null); await once(f, first);
  await fiveCards(f, [SEARCH[1], EDITS[6], COMMANDS[1], EDITS[0]]);
  const offered = await ask(f, EDITS[1]); assert.ok(offered.collect, 'tælleren er nulstillet');
  await collect(f, offered);
  // En opgave, der slutter af sig selv: næste opgave starter forfra.
  f.chat.event({ type: 'session.idle' }); await f.chat.finishing;
  await f.task('Tredje opgave');
  const third = await ask(f, EDITS[2]); assert.ok(third.card); assert.equal(third.auto, null); await once(f, third);
  await fiveCards(f, [SEARCH[2], EDITS[3], COMMANDS[2], EDITS[4]]);
  assert.ok((await ask(f, EDITS[5])).collect, 'spørgsmålet kommer igen i den nye opgave');
});

// Afgørelsen i ApprovalsPolicy: hvad et ja dækker, og at det kun kan gives for en handling, det dækker.
test('kun handlinger i projektmappen kan godkendes for resten af opgaven, og et ja dækker præcis dem', async t => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kortsamling-politik-'))); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), outside = path.join(base, 'ekstern'); await fs.mkdir(path.join(root, 'src'), { recursive: true }); await fs.mkdir(outside);
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  const context = { projectRoot: root, workspaceRoot: root, scratchRoot: path.join(root, '.aura', 'tmp'), mode: 'free', grepGuard: true, commandSandbox: false, commandSandboxSupported: true, taskRules: new Set() };
  const edit = file => ({ id: 'e', permission: 'edit', metadata: { filepath: file }, patterns: [] });
  const bash = cwd => ({ id: 'b', permission: 'bash', patterns: ['npm test'], metadata: { command: 'npm test' }, toolInput: { tool: 'bash', command: 'npm test', workdir: cwd } });
  const grep = where => ({ id: 'g', permission: 'grep', patterns: ['NEEDLE'], metadata: { pattern: 'NEEDLE', ...(where ? { path: where } : {}) } });
  const web = { id: 'w', permission: 'webfetch', metadata: { url: 'https://example.test/' } };
  const folder = { id: 'f', permission: 'external_directory', patterns: [outside + '/*'], metadata: { filepath: path.join(outside, 'a.txt'), parentDir: outside } };
  for (const [what, ctx, p] of [['nettet', context, web], ['en mappe uden for projektet', context, folder], ['en beskyttet fil', context, edit(path.join(root, '.env'))], ['en kommando uden sandkasse', context, bash(root)], ['en kommando i sandkassen uden for projektet', { ...context, commandSandbox: true }, bash(outside)], ['søgning uden søgevagt', { ...context, grepGuard: false }, grep()], ['søgning uden for projektet', context, grep(outside)], ['en filændring i Planlæg', { ...context, mode: 'plan' }, edit(path.join(root, 'a.txt'))]]) {
    await assert.rejects(policy.grant(ctx, p, { scope: 'collect' }), /resten af opgaven/, what);
    assert.equal(ctx.taskRules.size, 0, what);
  }
  const taskRules = new Set(), task = { ...context, taskRules };
  await policy.grant(task, edit(path.join(root, 'a.txt')), { scope: 'collect' });
  assert.equal(taskRules.size, 1);
  const source = async (ctx, p) => { const result = await policy.allowed({ ...ctx, taskRules }, p); return result.allowed ? result.source : false; };
  assert.equal(await source(context, edit(path.join(root, 'src', 'b.js'))), 'task');
  assert.equal(await source(context, grep()), 'task'); assert.equal(await source(context, grep('src')), 'task');
  assert.equal(await source({ ...context, grepGuard: false }, grep()), false);
  assert.equal(await source({ ...context, commandSandbox: true }, bash(root)), 'task'); assert.equal(await source({ ...context, commandSandbox: true }, bash(path.join(root, 'src'))), 'task');
  for (const [what, ctx, p] of [['kommando uden sandkasse', context, bash(root)], ['kommando uden for projektet', { ...context, commandSandbox: true }, bash(outside)], ['nettet', context, web], ['mappe udenfor', context, folder], ['beskyttet fil', context, edit(path.join(root, '.env.local'))], ['Planlæg', { ...context, mode: 'plan' }, edit(path.join(root, 'a.txt'))]]) assert.equal(await source(ctx, p), false, what);
  assert.equal((await policy.allowed({ ...context, taskRules: new Set() }, edit(path.join(root, 'a.txt')))).allowed, false, 'en anden opgave har ikke svaret');
});

// Fejningen efter et ja rører kun viste kort. En forespørgsel, som permissionAsked stadig afgør, svarer den selv på; ellers fik motoren to svar.
test('et ja rører ikke en forespørgsel, Aura stadig er ved at afgøre', async t => {
  const f = await project(t); await f.task();
  await fiveCards(f);
  const r = await ask(f, EDITS[3]); assert.ok(r.collect);
  // Som midt i permissionAsked: forespørgslen ligger i approvals, men kortet er endnu ikke vist.
  const p = { id: `undervejs-${++unique}`, permission: 'edit', patterns: ['public/undervejs.html'], metadata: { filepath: path.join(f.root, 'public', 'undervejs.html') } };
  const context = f.chat.approvalContext(), descriptor = await f.bench.approvalsPolicy.describe(context, p);
  f.engine.pending.set(p.id, p); f.chat.approvals.set(p.id, { p, descriptor, engine: f.engine, generation: f.chat.generation, context, request: p });
  await collect(f, r);
  assert.equal(f.engine.replies.some(reply => reply.id === p.id), false, 'forespørgslen under afgørelse får ikke et svar fra fejningen');
  assert.equal(f.engine.replies.some(reply => reply.id === r.id), true);
});

// Kan motoren ikke tage imod svaret på et kort, der venter ved siden af, er svaret om resten af opgaven stadig givet, og kortet bliver stående.
test('et ja går igennem, selv om et kort ved siden af ikke kan besvares; det kort bliver stående', async t => {
  const f = await project(t); await f.task();
  await fiveCards(f);
  const r = await ask(f, EDITS[3]), waiting = await ask(f, SEARCH[1]);
  assert.ok(r.collect); assert.ok(waiting.card);
  const reply = f.engine.reply;
  f.engine.reply = async (id, allow) => { if (id === waiting.id) throw new Error('Godkendelsen findes ikke længere.'); return reply(id, allow); };
  await collect(f, r);
  const answered = f.engine.replies.map(item => item.id);
  assert.equal(answered.includes(r.id), true, 'den ventende handling på spørgsmålskortet er godkendt'); assert.equal(answered.includes(waiting.id), false);
  assert.equal(f.chat.approvals.has(waiting.id), true, 'kortet venter stadig på brugeren');
  assert.equal(f.chat.activityList().find(item => item.id === `approval-${r.id}`).status, 'allowed-task');
});
