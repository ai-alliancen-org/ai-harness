// Spor M, trin 1b: søgning (grep) i projektet i Byg uden kort, kun fordi søgevagten fjerner beskyttede filer fra resultatet.
// Beviset mod den rigtige OpenCode 1.18.33 ligger i verifikationen; her prøves vagten, policyen og at vagten sidder i pluginet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const { createGrepGuard, writeReadGuard } = require('../core/engine.cjs');
const { classify } = require('../core/protected-paths.cjs');
const { approveAllApplies } = require('../core/chat-session.cjs');

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m1-soeg-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'); await fs.mkdir(path.join(root, 'src'), { recursive: true });
  for (const [file, text] of [['notes.txt', 'Hej NEEDLE'], ['src/app.js', 'useState NEEDLE'], ['.env', 'HEMMELIG_NEEDLE=syntetisk'], ['sub/credentials.json', 'CRED NEEDLE']]) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
  await fs.mkdir(path.join(root, 'references')); await fs.writeFile(path.join(root, 'references', 'r.txt'), 'REF NEEDLE');
  const store = new Store(path.join(base, 'data'), {}), policy = new ApprovalsPolicy(store);
  const context = { projectRoot: root, workspaceRoot: root, scratchRoot: path.join(base, 'scratch'), mode: 'build', taskRules: new Set(), commandSandboxSupported: true, grepGuard: true };
  return { base, root, policy, context, guard: createGrepGuard({ fs, path, root, classifyPath: classify }) };
}
const result = (root, ...files) => ['Found ' + files.length + ' matches', ...files.map(([file, text]) => `${path.join(root, file)}:\n  Line 1: ${text}\n`)].join('\n');
const grep = (metadata, id = 'g') => ({ id, permission: 'grep', patterns: [metadata.pattern], metadata, always: ['*'] });
// Som OpenCode kalder pluginet: tool.execute.before med værktøjets input, så tool.execute.after for samme kald.
let calls = 0;
async function search(hooks, args, output, callID = 'kald-' + ++calls) {
  const before = hooks.before || hooks['tool.execute.before'], after = hooks.after || hooks['tool.execute.after'];
  await before({ tool: 'grep', sessionID: 's', callID }, { args });
  await after({ tool: 'grep', sessionID: 's', callID, args }, output);
  return output;
}

test('søgevagten fjerner blokke for beskyttede filer, regner antallet om og lader almindelige filer stå', async t => {
  const { root, guard } = await fixture(t);
  const output = { output: result(root, ['notes.txt', 'Hej NEEDLE'], ['.env', 'HEMMELIG_NEEDLE=syntetisk'], ['src/app.js', 'useState NEEDLE'], ['sub/credentials.json', 'CRED NEEDLE'], ['references/r.txt', 'REF NEEDLE']) };
  await guard.after({ tool: 'grep' }, output);
  assert.doesNotMatch(output.output, /syntetisk|CRED|REF|\.env|credentials|references/);
  assert.match(output.output, /^Found 2 matches\n/); assert.match(output.output, /notes\.txt/); assert.match(output.output, /app\.js/);
  const only = { output: result(root, ['.env', 'HEMMELIG_NEEDLE=syntetisk']) };
  await guard.after({ tool: 'grep' }, only); assert.equal(only.output, 'No files found');
  const other = { output: 'uændret' }; await guard.after({ tool: 'read' }, other); assert.equal(other.output, 'uændret', 'kun grep røres');
});

test('søgevagten bevarer afkortningsmeddelelsen og skjuler alt, hvis resultatets form er ukendt', async t => {
  const { root, guard } = await fixture(t);
  const truncated = { output: 'Found 100 matches (more matches available)\n' + path.join(root, 'notes.txt') + ':\n  Line 1: a\n\n\n(Results truncated. Consider using a more specific path or pattern.)' };
  await guard.after({ tool: 'grep' }, truncated);
  assert.match(truncated.output, /^Found 1 matches \(more matches available\)\n/); assert.match(truncated.output, /Results truncated/);
  for (const strange of ['Ny form fra en nyere motor\n' + path.join(root, '.env') + ':\n  Line 1: HEMMELIG', 'Found 1 matches\nnoget uventet\n' + path.join(root, '.env') + ':\n  Line 1: HEMMELIG', undefined]) {
    const output = { output: strange }; await guard.after({ tool: 'grep' }, output);
    assert.match(output.output, /Aura skjuler søgeresultater/); assert.doesNotMatch(output.output, /HEMMELIG/);
  }
});

test('et almindeligt navn, der er et link til en beskyttet fil, og en sti, der ikke findes, skjules', { skip: process.platform === 'win32' }, async t => {
  const { root, guard } = await fixture(t);
  await fs.symlink(path.join(root, '.env'), path.join(root, 'offentligt.txt'));
  const output = { output: result(root, ['offentligt.txt', 'HEMMELIG_NEEDLE=syntetisk'], ['src/findes-ikke.js', 'x'], ['notes.txt', 'Hej NEEDLE']) };
  await guard.after({ tool: 'grep' }, output);
  assert.doesNotMatch(output.output, /syntetisk|offentligt|findes-ikke/); assert.match(output.output, /^Found 1 matches/);
});

test('en søgning, der peger direkte på en beskyttet sti eller et link dertil, afvises før den kører', async t => {
  const { root, guard } = await fixture(t);
  for (const target of ['.env', 'references', path.join(root, '.git'), 'sub/credentials.json']) await assert.rejects(guard.before({ tool: 'grep' }, { args: { pattern: 'x', path: target } }), /Aura beskytter denne fil/, target);
  if (process.platform !== 'win32') { await fs.symlink(path.join(root, '.env'), path.join(root, 'link.txt')); await assert.rejects(guard.before({ tool: 'grep' }, { args: { pattern: 'x', path: 'link.txt' } }), /Aura beskytter/); }
  for (const args of [{ pattern: 'x' }, { pattern: 'x', path: 'src' }, { pattern: 'x', path: '' }]) await guard.before({ tool: 'grep' }, { args });
});

test('vagten sidder i det genererede plugin som tool.execute.before og tool.execute.after', async t => {
  const { base, root } = await fixture(t);
  const directory = path.join(base, 'motor'); await fs.mkdir(directory);
  const configured = await writeReadGuard(directory, root, [], []);
  const hooks = await (await import(configured.pluginURL)).AuraReadProtection();
  assert.equal(typeof hooks['tool.execute.after'], 'function');
  const output = { output: result(root, ['.env', 'HEMMELIG_NEEDLE=syntetisk'], ['notes.txt', 'Hej NEEDLE']) };
  await hooks['tool.execute.after']({ tool: 'grep' }, output);
  assert.doesNotMatch(output.output, /syntetisk/); assert.match(output.output, /notes\.txt/);
  await assert.rejects(hooks['tool.execute.before']({ tool: 'grep' }, { args: { pattern: 'x', path: '.env' } }), /Aura beskytter/);
});

test('Byg tillader søgning i projektet uden kort, når projektfiler er slået til og søgevagten er indlæst', async t => {
  const { root, policy, context } = await fixture(t);
  await policy.setProjectFiles(root, true);
  for (const metadata of [{ pattern: 'NEEDLE' }, { pattern: 'NEEDLE', path: path.join(root, 'src') }, { pattern: 'NEEDLE', path: 'src' }, { pattern: 'useState', include: '*.js' }]) {
    const decision = await policy.allowed(context, grep(metadata));
    assert.equal(decision.allowed, true, JSON.stringify(metadata)); assert.equal(decision.source, 'project'); assert.equal(decision.descriptor.persistable, false);
  }
});

test('søgning forbliver et kort uden søgevagt, uden indstillingen, i Samtale og Planlæg og uden for projektet eller i beskyttede stier', async t => {
  const { base, root, policy, context } = await fixture(t);
  const metadata = { pattern: 'NEEDLE' };
  assert.equal((await policy.allowed(context, grep(metadata))).allowed, false, 'indstillingen for projektfiler er ikke slået til');
  await policy.setProjectFiles(root, true);
  assert.equal((await policy.allowed({ ...context, grepGuard: false }, grep(metadata))).allowed, false, 'uden søgevagt');
  assert.equal((await policy.allowed({ ...context, grepGuard: undefined }, grep(metadata))).allowed, false);
  for (const mode of ['plan', 'chat']) assert.equal((await policy.allowed({ ...context, mode }, grep(metadata))).allowed, false, mode);
  const outside = path.join(base, 'ekstern'); await fs.mkdir(outside);
  for (const path_ of [outside, '../ekstern', path.join(root, '.env'), path.join(root, 'references'), '.git']) assert.equal((await policy.allowed(context, grep({ pattern: 'NEEDLE', path: path_ }))).allowed, false, path_);
  if (process.platform !== 'win32') { await fs.symlink(outside, path.join(root, 'ud')); assert.equal((await policy.allowed(context, grep({ pattern: 'NEEDLE', path: path.join(root, 'ud') }))).allowed, false, 'et link, der peger ud'); }
});

test('«Godkend alt» dækker stadig ikke søgning', async t => {
  const { policy, context } = await fixture(t);
  const descriptor = await policy.describe(context, grep({ pattern: 'NEEDLE', path: 'src' }));
  assert.equal(approveAllApplies(true, descriptor, { sandbox: true }), false);
});

test('samtalens godkendelseskontekst siger kun, at søgevagten er indlæst, når motoren har meldt det', async t => {
  const { Workbench } = require('../core/workbench.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m1-ctx-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles: path.join(__dirname, '../../profiles'), emit: () => {}, safeStorage: {} });
  await bench.activate({ root: directory, name: 'Prøve' }); const chat = bench.chat;
  t.after(async () => { chat.engine = null; await bench.close(); });
  chat.engine = null; assert.equal(chat.approvalContext().grepGuard, false);
  chat.engine = { grepGuard: false }; assert.equal(chat.approvalContext().grepGuard, false);
  chat.engine = { grepGuard: true }; assert.equal(chat.approvalContext().grepGuard, true);
});

test('et link i projektet, der peger på en fil uden for projektet, skjules i søgeresultatet', { skip: process.platform === 'win32' }, async t => {
  const { base, root, guard } = await fixture(t);
  await fs.writeFile(path.join(base, 'hemmelig.txt'), 'UDEN_FOR NEEDLE');
  await fs.symlink(path.join(base, 'hemmelig.txt'), path.join(root, 'l.txt'));
  const output = { output: result(root, ['notes.txt', 'Hej NEEDLE'], ['l.txt', 'UDEN_FOR NEEDLE']) };
  await guard.after({ tool: 'grep' }, output);
  assert.ok(!output.output.includes('UDEN_FOR'), 'indholdet uden for projektet skal skjules');
  assert.match(output.output, /Found 1 matches/);
  assert.ok(output.output.includes('Hej NEEDLE'));
});

// Fund 3 i gennemgangen af beta 3: en søgning uden for projektet kræver altid brugerens ja på et kort (OpenCode spørger, og «Godkend alt»
// dækker ikke søgning). Vagten skjulte alligevel alle resultater uden for projektet, så modellen fik "No files found" efter godkendelsen.
test('en godkendt søgning uden for projektet viser resultaterne i målet, men ikke beskyttede filer eller noget uden for målet', { skip: process.platform === 'win32' }, async t => {
  const { base, root } = await fixture(t);
  const outside = path.join(base, 'ekstern'), other = path.join(base, 'andet');
  for (const folder of [outside, other]) await fs.mkdir(folder);
  await fs.writeFile(path.join(outside, 'noter.txt'), 'Ekstern NEEDLE'); await fs.writeFile(path.join(outside, '.env'), 'EKSTERN_HEMMELIG NEEDLE');
  await fs.writeFile(path.join(other, 'fremmed.txt'), 'FREMMED NEEDLE'); await fs.symlink(path.join(other, 'fremmed.txt'), path.join(outside, 'genvej.txt'));
  const guard = createGrepGuard({ fs, path, root, classifyPath: classify });
  const output = { output: result(outside, ['noter.txt', 'Ekstern NEEDLE'], ['.env', 'EKSTERN_HEMMELIG NEEDLE'], ['genvej.txt', 'FREMMED NEEDLE']) };
  await search(guard, { pattern: 'NEEDLE', path: outside }, output);
  assert.match(output.output, /^Found 1 matches\n/); assert.match(output.output, /Ekstern NEEDLE/);
  assert.doesNotMatch(output.output, /EKSTERN_HEMMELIG|FREMMED|genvej/);
  // En relativ sti ud af projektet regnes fra projektmappen, som OpenCode gør.
  const relative = { output: result(outside, ['noter.txt', 'Ekstern NEEDLE']) };
  await search(guard, { pattern: 'NEEDLE', path: '../ekstern' }, relative);
  assert.match(relative.output, /Ekstern NEEDLE/);
  // En søgning i projektet skjuler stadig alt uden for projektet, også når stien er angivet.
  const inside = { output: result(root, ['notes.txt', 'Hej NEEDLE']) + '\n' + result(outside, ['noter.txt', 'Ekstern NEEDLE']).replace(/^Found 1 matches\n/, '') };
  await search(guard, { pattern: 'NEEDLE', path: 'src' }, inside);
  assert.doesNotMatch(inside.output, /Ekstern/); assert.match(inside.output, /Hej NEEDLE/);
});

test('en godkendt søgning i motorens gemte værktøjsoutput giver resultater, mens motorens øvrige data stadig skjules', { skip: process.platform === 'win32' }, async t => {
  const { base, root } = await fixture(t);
  const store = path.join(base, 'appdata'), engineRoot = path.join(store, 'runtime', 'noegle'), toolOutput = path.join(engineRoot, 'data', 'opencode', 'tool-output');
  await fs.mkdir(toolOutput, { recursive: true }); await fs.writeFile(path.join(toolOutput, 'tool_1'), '39999');
  await fs.writeFile(path.join(store, 'store.json'), 'STORE 39999'); await fs.writeFile(path.join(engineRoot, 'data', 'opencode', 'log.txt'), 'MOTOR 39999');
  const guard = createGrepGuard({ fs, path, root, classifyPath: classify, engineRoot, storeRoot: store });
  const output = { output: result(toolOutput, ['tool_1', '39999']) };
  await search(guard, { pattern: '^39999$', path: toolOutput }, output);
  assert.match(output.output, /^Found 1 matches\n[\s\S]*Line 1: 39999/);
  // Selv en godkendt søgning i hele appens mappe viser ikke motorens egne data, ligesom læsevagten.
  const wide = { output: result(store, ['store.json', 'STORE 39999'], ['runtime/noegle/data/opencode/log.txt', 'MOTOR 39999'], ['runtime/noegle/data/opencode/tool-output/tool_1', '39999']) };
  await search(guard, { pattern: '39999', path: store }, wide);
  assert.doesNotMatch(wide.output, /STORE|MOTOR/); assert.match(wide.output, /^Found 1 matches\n/);
});

test('pluginet giver søgningens mål videre til vagten efter søgningen', { skip: process.platform === 'win32' }, async t => {
  const { base, root } = await fixture(t);
  const outside = path.join(base, 'ekstern'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'noter.txt'), 'Ekstern NEEDLE');
  const directory = path.join(base, 'motor'); await fs.mkdir(directory);
  const hooks = await (await import((await writeReadGuard(directory, root, [], [])).pluginURL)).AuraReadProtection();
  const output = { output: result(outside, ['noter.txt', 'Ekstern NEEDLE']) };
  await search(hooks, { pattern: 'NEEDLE', path: outside }, output);
  assert.match(output.output, /Ekstern NEEDLE/);
});

// N:A-1 (skeptikeren, vist med rigtig OpenCode 1.19.5): en søgning i en mappe i projektet godkendes uden kort, og mappen skiftes derefter til
// et link ud af projektet. OpenCodes egen kontrol er leksikalsk og spørger ikke. Vagten må derfor bruge målet fra før søgningen, ikke stien,
// som den ser ud bagefter.
test('målet fra før søgningen gælder: en mappe, der skiftes til et link ud af projektet under søgningen, viser ikke indhold udefra', { skip: process.platform === 'win32' }, async t => {
  const { base, root } = await fixture(t);
  const outside = path.join(base, 'ekstern'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'noter.txt'), 'Ekstern NEEDLE');
  await fs.mkdir(path.join(root, 'del')); await fs.writeFile(path.join(root, 'del', 'egen.txt'), 'Egen NEEDLE');
  const plugin = await (await import((await writeReadGuard(await fs.mkdtemp(path.join(base, 'motor-')), root, [], [])).pluginURL)).AuraReadProtection();
  for (const hooks of [createGrepGuard({ fs, path, root, classifyPath: classify }), plugin]) {
    const before = hooks.before || hooks['tool.execute.before'], after = hooks.after || hooks['tool.execute.after'];
    const args = { pattern: 'NEEDLE', path: 'del' };
    await before({ tool: 'grep', sessionID: 's', callID: 'skift' }, { args });
    // Mappen skiftes til et link ud af projektet, mens søgningen kører. Resultatet viser filen gennem linket.
    await fs.rm(path.join(root, 'del'), { recursive: true, force: true }); await fs.symlink(outside, path.join(root, 'del'));
    const output = { output: result(root, ['del/noter.txt', 'Ekstern NEEDLE'], ['notes.txt', 'Hej NEEDLE']) };
    await after({ tool: 'grep', sessionID: 's', callID: 'skift', args }, output);
    assert.doesNotMatch(output.output, /Ekstern/, 'indholdet uden for projektet når ikke modellen');
    assert.match(output.output, /^Found 1 matches\n[\s\S]*Hej NEEDLE/);
    // Et mål, der lå uden for projektet før søgningen (og derfor fik et kort), gælder stadig for netop det kald.
    const approved = await search(hooks, { pattern: 'NEEDLE', path: outside }, { output: result(outside, ['noter.txt', 'Ekstern NEEDLE']) });
    assert.match(approved.output, /Ekstern NEEDLE/);
    // Uden et kald før søgningen, eller med et andet kald, gælder projektets grænse.
    const unknown = { output: result(outside, ['noter.txt', 'Ekstern NEEDLE']) };
    await before({ tool: 'grep', sessionID: 's', callID: 'et-kald' }, { args: { pattern: 'NEEDLE', path: outside } });
    await after({ tool: 'grep', sessionID: 's', callID: 'et-andet-kald', args: { pattern: 'NEEDLE', path: outside } }, unknown);
    assert.equal(unknown.output, 'No files found');
    await fs.rm(path.join(root, 'del')); await fs.mkdir(path.join(root, 'del'));
  }
});

// N:A-3: pluginet giver motorens og appens mapper videre til søgevagten. Uden dem viste en godkendt søgning i appens mappe motorens egne
// data (opencode.db og store.json), som læsevagten ellers skjuler. Prøven går gennem det genererede plugin, så den fejler, hvis de forsvinder.
test('pluginet giver motorens og appens mapper videre: en godkendt søgning i appens mappe viser ikke motorens egne data', { skip: process.platform === 'win32' }, async t => {
  const { base, root } = await fixture(t);
  const store = path.join(base, 'appdata'), directory = path.join(store, 'runtime', 'noegle'), data = path.join(directory, 'data', 'opencode');
  await fs.mkdir(path.join(data, 'tool-output'), { recursive: true });
  await fs.writeFile(path.join(store, 'store.json'), '{"STORE":"NEEDLE"}'); await fs.writeFile(path.join(data, 'opencode.db'), 'MOTOR NEEDLE'); await fs.writeFile(path.join(data, 'tool-output', 'tool_1'), 'GEMT NEEDLE');
  const other = path.join(store, 'runtime', 'andet-projekt'); await fs.mkdir(other); await fs.writeFile(path.join(other, 'opencode.db'), 'ANDET NEEDLE');
  const hooks = await (await import((await writeReadGuard(directory, root, [], [])).pluginURL)).AuraReadProtection();
  const output = await search(hooks, { pattern: 'NEEDLE', path: store }, { output: result(store, ['store.json', '{"STORE":"NEEDLE"}'], ['runtime/noegle/data/opencode/opencode.db', 'MOTOR NEEDLE'], ['runtime/andet-projekt/opencode.db', 'ANDET NEEDLE'], ['runtime/noegle/data/opencode/tool-output/tool_1', 'GEMT NEEDLE']) });
  assert.doesNotMatch(output.output, /STORE|MOTOR|ANDET|store\.json|opencode\.db/);
  assert.match(output.output, /^Found 1 matches\n[\s\S]*GEMT NEEDLE/);
});
