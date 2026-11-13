const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ApprovalsPolicy, canonicalPath } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const { groupKey, receiptText } = require('../ui/approval-view.js');

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-policy-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), outside = path.join(base, 'ekstern'), scratch = path.join(base, 'scratch');
  await Promise.all([root, outside, scratch].map(folder => fs.mkdir(folder)));
  const store = new Store(path.join(base, 'data'), {}), policy = new ApprovalsPolicy(store);
  return { base, root, outside, scratch, store, policy, context: { projectRoot: root, workspaceRoot: root, scratchRoot: scratch, mode: 'build', taskRules: new Set(), commandSandboxSupported: true } };
}
const edit = file => ({ id: 'fil', permission: 'edit', metadata: { filepath: file }, patterns: [] });
const command = (text, cwd) => ({ id: 'kommando', permission: 'bash', metadata: {}, patterns: [text], toolInput: { tool: 'bash', command: text, workdir: cwd } });
const folder = value => ({ id: 'mappe', permission: 'external_directory', metadata: {}, patterns: [value + '/*'] });
// Gemte regler, som tidligere versioner skrev dem. beta2Rule er det, beta 2's grant() gemte (main:desktop/core/approvals-policy.cjs): match med
// input: stable(toolInput.input || null). Beta 3 gemte { kind, command, cwd }.
const ruleId = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
const beta2Rule = (command, cwd, input) => { const match = { kind: 'bash', command, cwd, input }; return { id: ruleId(match), kind: 'bash', label: `Kommando: ${command}`, target: command, match }; };
const beta3Rule = (command, cwd) => { const match = { kind: 'bash', command, cwd }; return { id: ruleId(match), kind: 'bash', label: `Kommando: ${command}`, target: command, match }; };
const saveRules = (store, root, rules) => store.update(state => { state.projects[store.projectKey(root)] = { approvals: { version: 1, autoProjectFiles: false, autoCommands: false, rules } }; });
// Som OpenCode 1.19.5 spørger: værktøjets input har command, workdir og AI'ens description (tests/fixtures/opencode-1.19.5).
const bashAsk = (command, cwd, description) => ({ id: 'p', permission: 'bash', patterns: [command], metadata: { command }, toolInput: { command, workdir: cwd, description, tool: 'bash', input: { command, workdir: cwd, description } } });

test('eksisterende projekter får ingen automatisk adgang; projektfiler kan slås til og fra og huskes efter genåbning', async t => {
  const { root, context, policy, store } = await fixture(t), p = edit(path.join(root, 'ny.txt'));
  assert.deepEqual(await policy.settings(root), { autoProjectFiles: false, autoCommands: false, autoCommandsUnisolated: false, rules: [] });
  assert.equal((await policy.allowed(context, p)).allowed, false);
  await policy.setProjectFiles(root, true);
  assert.equal((await new ApprovalsPolicy(store).allowed(context, p)).source, 'project');
  await policy.setProjectFiles(root, false);
  assert.equal((await policy.allowed(context, p)).allowed, false);
});

test('projektets filregel omfatter aldrig søskendemapper, hemmeligheder, links ud af projektet eller planning', async t => {
  const { root, outside, base, context, policy } = await fixture(t);
  await policy.setProjectFiles(root, true); await fs.mkdir(path.join(base, 'projekt-søster'));
  await fs.symlink(outside, path.join(root, 'link')); await fs.symlink(path.join(base, 'mangler'), path.join(root, 'dødt-link'));
  for (const file of [path.join(base, 'projekt-søster', 'a'), path.join(root, 'link', 'a'), path.join(root, 'dødt-link', 'a'), path.join(root, '.git', 'config'), path.join(root, '.env.local'), path.join(root, '.envrc'), path.join(root, 'key.pem'), path.join(root, 'references', 'privat')]) assert.equal((await policy.allowed(context, edit(file))).allowed, false, file);
  await assert.rejects(canonicalPath(root + '/link/../a'));
  for (const mode of ['chat', 'plan', undefined, 'ukendt']) assert.equal((await policy.allowed({ ...context, mode }, edit(path.join(root, 'a')))).allowed, false, mode);
  assert.equal((await policy.allowed(context, edit(path.join(root, 'ny', 'dyb', 'a')))).allowed, true);
});

test('faktiske mapper med store bogstaver kan ikke få automatisk eller husket filadgang', async t => {
  const { root, context, policy } = await fixture(t);
  await policy.setProjectFiles(root, true);
  for (const name of ['.GIT', 'Secrets', 'REFERENCES']) {
    const folder = path.join(root, name); await fs.mkdir(folder);
    const file = path.join(folder, 'syntetisk.txt'); await fs.writeFile(file, 'Syntetisk privat indhold');
    const result = await policy.allowed(context, edit(file));
    assert.equal(result.allowed, false, name); assert.equal(result.descriptor.persistable, false, name);
    await assert.rejects(policy.grant(context, edit(file), { scope: 'project' }), /kun godkendes én gang/);
  }
});

test('tilladelse til opgaven deler kun projektfiler og ophører med opgavens Set', async t => {
  const { root, outside, context, policy } = await fixture(t);
  await policy.grant(context, edit(path.join(root, 'første')), { scope: 'task' });
  assert.equal((await policy.allowed(context, edit(path.join(root, 'anden')))).source, 'task');
  assert.equal((await policy.allowed(context, edit(path.join(outside, 'anden')))).allowed, false);
  assert.equal((await policy.allowed({ ...context, taskRules: new Set() }, edit(path.join(root, 'anden')))).allowed, false);
  await assert.rejects(policy.grant(context, command('node a.js', root), { scope: 'task' }), /projektmappen/);
});

// Huskede kommandoer er fjernet (brugerens beslutning 10. november 2026): kommandoer styres af sandkassen, projektets automatik og «Godkend alt».
test('en kommando kan ikke huskes for projektet, heller ikke med kørende sandkasse eller uden isolation (beslutning 10. november 2026)', async t => {
  const { root, context, policy, store } = await fixture(t), p = command('node logic-test.js', root);
  for (const [what, ctx] of [['med kørende sandkasse', { ...context, commandSandbox: true }], ['uden kørende sandkasse', { ...context, commandSandbox: false }], ['uden isolation på Windows', { ...context, commandSandboxSupported: false, commandSandbox: false, commandUnisolated: true }]]) {
    assert.equal((await policy.describe(ctx, p)).persistable, false, `«Tillad altid i projektet» tilbydes ikke ${what}`);
    await assert.rejects(policy.grant(ctx, p, { scope: 'project' }), /kun godkendes én gang/, what);
  }
  assert.deepEqual((await store.project(root)).approvals?.rules || [], [], 'intet er gemt');
});

test('ændrede input og linkmål ændrer fingeraftryk og godkendelsesgruppe', async t => {
  const { root, outside, base, context, policy } = await fixture(t), link = path.join(base, 'arbejdslink');
  await fs.symlink(root, link); const p = command('node logic-test.js', link);
  const before = await policy.describe(context, p);
  await fs.unlink(link); await fs.symlink(outside, link);
  const after = await policy.describe(context, p);
  assert.notEqual(before.fingerprint, after.fingerprint); assert.notEqual(before.key, after.key);
  assert.equal((await policy.allowed(context, p)).allowed, false);
  const changed = await policy.describe(context, { ...p, toolInput: { ...p.toolInput, input: { environment: { EXTRA: 'andet' } } } });
  assert.notEqual(changed.fingerprint, after.fingerprint);
  await assert.rejects(policy.grant(context, p, { scope: 'project', fingerprint: before.fingerprint }), /ændret sig/);
});

test('en platform uden kommandoisolation tilbyder kun enkeltgodkendelse, også ved en tidligere gemt regel', async t => {
  const { root, context, policy, store } = await fixture(t), p = command('node logic-test.js', root);
  const match = { kind: 'bash', command: 'node logic-test.js', cwd: root };
  await saveRules(store, root, [{ id: ruleId(match), kind: 'bash', label: 'Kommando: node logic-test.js', target: 'node logic-test.js', match }]);
  for (const commandSandboxSupported of [false, undefined, 'true']) {
    const unsupported = { ...context, commandSandboxSupported, commandSandbox: false, autoCommandsSnapshot: false };
    const descriptor = await policy.describe(unsupported, p);
    assert.equal(descriptor.persistable, false);
    assert.equal((await policy.allowed(unsupported, p)).allowed, false);
    await assert.rejects(policy.grant(unsupported, p, { scope: 'project' }), /kun godkendes én gang/);
  }
  assert.equal((await policy.settings(root)).rules.length, 1, 'Den gemte regel bevares, indtil brugeren sletter den.');
});

test('lokale kommandoer kræver opt-in og en faktisk isoleret motor; aldrig planning, eksternt cwd eller andre værktøjer', async t => {
  const { root, outside, scratch, context, policy } = await fixture(t);
  await policy.setProjectFiles(root, true); const p = command('node build-copies.js', root);
  assert.equal((await policy.allowed(context, p)).allowed, false);
  await policy.setCommands(root, true);
  for (const commandSandbox of [undefined, false, 'true']) assert.equal((await policy.allowed({ ...context, commandSandbox }, p)).allowed, false, 'En allerede startet motor uden sandbox får ikke automatisk adgang.');
  const isolated = { ...context, commandSandbox: true, autoCommandsSnapshot: true };
  assert.equal((await policy.allowed({ ...isolated, autoCommandsSnapshot: false }, p)).allowed, false);
  assert.equal((await policy.allowed(isolated, p)).source, 'commands');
  assert.equal((await policy.allowed(isolated, command('node a.js', scratch))).source, 'commands');
  assert.equal((await policy.allowed(isolated, command('node a.js', outside))).allowed, false);
  for (const mode of ['chat', 'plan']) assert.equal((await policy.allowed({ ...isolated, mode }, p)).allowed, false);
  assert.equal((await policy.allowed(isolated, { permission: 'mcp', patterns: ['deploy'] })).allowed, false);
  await policy.setCommands(root, false);
  assert.equal((await policy.allowed(isolated, p)).source, 'commands', 'Den allerede isolerede opgave beholder sit snapshot.');
  assert.equal((await policy.allowed({ ...context, commandSandbox: false }, p)).allowed, false, 'Den næste opgave har ikke automatisk adgang.');
});

test('hjemmesidetilladelsen gælder præcis origin uden at omfatte lookalike, anden port eller adgangskoder', async t => {
  const { context, policy } = await fixture(t);
  const web = url => ({ id: 'web', permission: 'webfetch', metadata: { url } });
  await policy.grant(context, web('https://example.test/docs'), { scope: 'project' });
  assert.equal((await policy.allowed(context, web('https://example.test/andet'))).allowed, true);
  for (const url of ['https://example.test.evil.test/docs', 'http://example.test/docs', 'https://example.test:8443/docs', 'https://name:secret@example.test/docs', 'file:///tmp/a']) assert.equal((await policy.allowed(context, web(url))).allowed, false, url);
});

test('en valgt overordnet mappe dækker undermapper men ikke søskende, andre adgangstyper eller linkflugt', async t => {
  const { outside, base, root, context, policy } = await fixture(t);
  const child = path.join(outside, 'moedelokale-app-test'); await fs.mkdir(child);
  await policy.grant(context, folder(child), { scope: 'project', folder: outside });
  await fs.mkdir(path.join(outside, 'anden-test')); await fs.mkdir(path.join(base, 'ekstern-søster'));
  assert.equal((await policy.allowed(context, folder(path.join(outside, 'anden-test')))).allowed, true);
  assert.equal((await policy.allowed(context, folder(path.join(base, 'ekstern-søster')))).allowed, false);
  assert.equal((await policy.allowed(context, edit(path.join(child, 'a')))).allowed, false, 'læseadgang er ikke skriveadgang');
  await policy.grant(context, edit(path.join(child, 'a')), { scope: 'project', folder: outside });
  assert.equal((await policy.allowed(context, edit(path.join(outside, 'anden-test', 'b')))).allowed, true);
  await fs.symlink(root, path.join(outside, 'flugt'));
  assert.equal((await policy.allowed(context, edit(path.join(outside, 'flugt', 'a')))).allowed, false);
});

test('gemt mappeadgang afvises, hvis selve mappen udskiftes med et symlink', async t => {
  const { outside, base, context, policy } = await fixture(t);
  await policy.grant(context, edit(path.join(outside, 'a')), { scope: 'project', folder: outside });
  const moved = path.join(base, 'flyttet'); await fs.rename(outside, moved); await fs.symlink(moved, outside);
  assert.equal((await policy.allowed(context, edit(path.join(outside, 'b')))).allowed, false);
});

test('hverken generel tmp-, home-, filsystem- eller opencode-adgang kan gemmes som mappe', async t => {
  const { outside, base, context, policy } = await fixture(t);
  for (const value of [os.tmpdir(), os.homedir(), path.parse(outside).root]) await assert.rejects(policy.grant(context, folder(value), { scope: 'project', folder: value }));
  const engine = path.join(base, 'opencode'); await fs.mkdir(engine);
  await assert.rejects(policy.grant(context, folder(engine), { scope: 'project', folder: engine }));
});

test('kun Auras konkrete scratchmappe giver automatisk filadgang, aldrig bash eller skrivning under planning', async t => {
  const { scratch, outside, context, policy } = await fixture(t);
  assert.equal((await policy.allowed(context, edit(path.join(scratch, 'a')))).source, 'scratch');
  assert.equal((await policy.allowed(context, folder(scratch))).source, 'scratch');
  assert.equal((await policy.allowed(context, edit(path.join(outside, 'a')))).allowed, false);
  assert.equal((await policy.allowed(context, command('node a.js', scratch))).allowed, false);
  assert.equal((await policy.allowed({ ...context, scratchRoot: undefined }, edit(path.join(scratch, 'a')))).allowed, false);
  assert.equal((await policy.allowed({ ...context, mode: 'plan' }, edit(path.join(scratch, 'a')))).allowed, false);
  assert.equal((await policy.allowed({ ...context, mode: 'plan' }, { ...folder(scratch), toolInput: { tool: 'write' } })).allowed, false);
  await fs.symlink(outside, path.join(scratch, 'link'));
  assert.equal((await policy.allowed(context, edit(path.join(scratch, 'link', 'a')))).allowed, false);
  assert.equal((await policy.allowed(context, { ...edit(path.join(scratch, 'a')), patterns: [path.join(outside, 'b')] })).allowed, false, 'et andet mål må ikke skjules i patterns');
});

test('UI grupperer kun efter hovedprocessens nøgle og samler kvitteringer med antal', () => {
  assert.notEqual(groupKey({ id: 'a', permission: 'edit' }), groupKey({ id: 'b', permission: 'edit' }));
  assert.equal(groupKey({ id: 'a', policy: { key: 'canonical', match: {} } }), groupKey({ id: 'b', policy: { key: 'canonical', match: {} } }));
  assert.equal(receiptText({ count: 3, automatic: true, label: 'projektets filer' }), '3 handlinger godkendt automatisk: projektets filer.');
  assert.match(receiptText({ count: 2, scope: 'project', label: 'node logic-test.js' }), /^2 handlinger godkendt med tilladelse gemt i projektet/);
});

test('metadata skjuler ikke relative patterns eller eksterne og beskyttede mål i en patch', async t => {
  const { root, outside, context, policy } = await fixture(t); await policy.setProjectFiles(root, true);
  const file = path.join(root, 'a.js');
  for (const pattern of ['../ekstern/a.js', 'anden.js', '*']) assert.equal((await policy.allowed(context, { ...edit(file), patterns: [pattern] })).allowed, false);
  const patch = target => ({ ...edit(file), toolInput: { tool: 'apply_patch', patchText: `*** Begin Patch\n*** Update File: a.js\n@@\n-før\n+efter\n*** Add File: ${target}\n+indhold\n*** End Patch` } });
  assert.equal((await policy.allowed(context, patch('b.js'))).source, 'project');
  for (const target of [path.join(outside, 'b.js'), '../ekstern/b.js', '.env.local']) assert.equal((await policy.allowed(context, patch(target))).allowed, false, target);
  await fs.symlink(outside, path.join(root, 'link'));
  assert.equal((await policy.allowed(context, patch('link/b.js'))).allowed, false);
  const move = { ...edit(file), toolInput: { tool: 'apply_patch', patchText: `*** Begin Patch\n*** Update File: a.js\n*** Move to: ${path.join(outside, 'b.js')}\n@@\n-før\n+efter\n*** End Patch` } };
  assert.equal((await policy.allowed(context, move)).allowed, false);
  assert.equal((await policy.allowed(context, { ...edit(file), toolInput: { tool: 'apply_patch' } })).allowed, false);
});

test('OpenCodes relative edit/write-patterns bindes entydigt til de absolutte værktøjsmål', async t => {
  const { root, outside, context, policy } = await fixture(t); await policy.setProjectFiles(root, true);
  const file = path.join(root, 'public', 'index.html');
  for (const tool of ['write', 'edit']) {
    const request = { id: tool, permission: 'edit', patterns: ['public/index.html'], metadata: { filepath: file, diff: '+ny tekst' }, toolInput: { tool, filePath: file } };
    assert.equal((await policy.allowed(context, request)).source, 'project');
    assert.equal((await policy.allowed(context, { ...request, toolInput: { tool, filePath: 'public/index.html' } })).source, 'project');
    for (const pattern of ['../public/index.html', 'public/*', 'public/index.html/andet', 'publicx/index.html', 'andet.html', path.join(outside, 'index.html')]) assert.equal((await policy.allowed(context, { ...request, patterns: [pattern] })).allowed, false, pattern);
    assert.equal((await policy.allowed(context, { ...request, patterns: ['public/index.html', 'andet.html'] })).allowed, false);
    assert.equal((await policy.allowed({ ...context, mode: 'plan' }, request)).allowed, false);
    const ambiguous = { ...request, patterns: ['index.html'], toolInput: { tool, filePath: path.join(root, 'anden', 'index.html') } };
    assert.equal((await policy.allowed(context, ambiguous)).allowed, false, 'Et kort mønster må ikke vælge mellem to forskellige mål.');
    const sibling = { ...request, metadata: { filepath: path.join(outside, 'public', 'index.html') }, toolInput: { tool, filePath: path.join(outside, 'public', 'index.html') } };
    assert.equal((await policy.allowed(context, sibling)).allowed, false, 'Et korrekt suffix giver ikke adgang uden for projektet.');
  }
  await fs.symlink(outside, path.join(root, 'ud')); const linked = path.join(root, 'ud', 'index.html');
  assert.equal((await policy.allowed(context, { ...edit(linked), patterns: ['ud/index.html'] })).allowed, false);
});

test('OpenCodes apply_patch-visningsliste erstatter aldrig metadata.files eller patchens flyttemål', async t => {
  const { root, outside, context, policy } = await fixture(t); await policy.setProjectFiles(root, true);
  const patch = `*** Begin Patch\n*** Update File: a.js\n@@\n-før\n+efter\n*** Add File: b.js\n+indhold\n*** End Patch`;
  const request = { id: 'patch', permission: 'edit', patterns: ['a.js', 'b.js'], metadata: { filepath: 'a.js, b.js', files: [{ filePath: path.join(root, 'a.js'), relativePath: 'a.js', type: 'update' }, { filePath: path.join(root, 'b.js'), relativePath: 'b.js', type: 'add' }] }, toolInput: { tool: 'apply_patch', patchText: patch } };
  assert.equal((await policy.allowed(context, request)).source, 'project');
  const externalMove = structuredClone(request); externalMove.metadata.files[0].movePath = path.join(outside, 'a.js'); externalMove.metadata.files[0].type = 'move';
  assert.equal((await policy.allowed(context, externalMove)).allowed, false);
  const extra = structuredClone(request); extra.patterns.push('ukendt.js'); extra.metadata.filepath += ', ukendt.js';
  assert.equal((await policy.allowed(context, extra)).allowed, false);
  const display = structuredClone(request); display.metadata.filepath = path.join(outside, 'hemmelig.js');
  assert.equal((await policy.allowed(context, display)).allowed, false);
});

test('et nyt projekt får filændringer i projektet og kommandoer i sandkassen automatisk, hvor sandkassen findes (beslutning for beta 2)', async t => {
  const { root, policy } = await fixture(t);
  assert.equal((await policy.settings(root)).autoProjectFiles, false, 'et eksisterende projekt er uændret');
  await policy.applyNewProjectDefaults(root, { commandsAvailable: true });
  assert.deepEqual([(await policy.settings(root)).autoProjectFiles, (await policy.settings(root)).autoCommands], [true, true]);
});

test('uden sandkasse slås kun filændringer til, så en ny opgave ikke fejler på kommandoer', async t => {
  const { root, policy } = await fixture(t);
  await policy.applyNewProjectDefaults(root, { commandsAvailable: false });
  assert.deepEqual([(await policy.settings(root)).autoProjectFiles, (await policy.settings(root)).autoCommands], [true, false]);
});

test('samme kommando i samme mappe samles på ét kort uanset AI\'ens begrundelse og tidsgrænse, men ikke en anden kommando eller mappe (beta 3)', async t => {
  const { root, policy, context } = await fixture(t);
  const sandboxContext = { ...context, commandSandbox: true, commandSandboxSupported: true };
  const bash = (command, input = {}, workdir) => ({ id: 'p', permission: 'bash', patterns: [command], metadata: { command }, toolInput: { tool: 'bash', command, ...(workdir ? { workdir } : {}), input: { command, ...input } } });
  const a = await policy.describe(sandboxContext, bash('npm test', { description: 'Kører testene', timeout: 120000 }));
  const b = await policy.describe(sandboxContext, bash('npm test', { description: 'Prøver igen', timeout: 30000 }));
  assert.equal(a.key, b.key, 'begrundelse og timeout hører ikke til nøglen');
  assert.notEqual(a.key, (await policy.describe(sandboxContext, bash('npm run build', { description: 'Kører testene' }))).key);
  await fs.mkdir(path.join(root, 'sub'));
  assert.notEqual(a.key, (await policy.describe(sandboxContext, bash('npm test', {}, path.join(root, 'sub')))).key, 'en anden mappe er et andet kort');
});

test('en mappe over hjemmemappen er for bred til at blive husket (beta 3)', async t => {
  const { policy, context } = await fixture(t);
  const home = require('node:os').homedir();
  const over = path.dirname(home);
  const d = await policy.describe({ ...context, mode: 'build' }, { id: 'p', permission: 'external_directory', patterns: [over + '/*'], metadata: { filepath: over, parentDir: over } });
  assert.equal(d.persistable, false, 'mappen over hjemmemappen kan ikke huskes');
});

// Fund 1 og 10 i gennemgangen af beta 3: «Tillad uden isolation» i projektets indstillinger kunne ikke gemmes på Windows, fordi
// project:settings-save i main.cjs kastede sandkassens begrundelse og aldrig gav valget videre. Afgørelsen ligger nu her.
test('projektets valg af automatiske kommandoer: Windows kan vælge uden isolation, men en Mac eller Linux uden sandkasse kan ikke', async t => {
  const { projectCommandSettings } = require('../core/approvals-policy.cjs');
  const { support } = require('../core/command-sandbox.cjs');
  const windows = await support({ platform: 'win32' });
  // Det, ui/project-settings.js sender efter advarslen, gemmes som et valg uden isolation.
  assert.deepEqual(projectCommandSettings({ autoCommands: true, autoCommandsUnisolated: true }, windows), { enabled: true, unisolated: true });
  // Uden brugerens udtrykkelige valg er der ingen stille reservevej.
  assert.throws(() => projectCommandSettings({ autoCommands: true }, windows), /teknisk isolation er endnu ikke understøttet på Windows/);
  assert.throws(() => projectCommandSettings({ autoCommands: true, autoCommandsUnisolated: false }, windows), /Windows/);
  // En Mac eller Linux, hvor sandkassen ikke kan starte, får aldrig kommandoer uden isolation.
  const broken = { available: false, platform: 'darwin', reason: 'Kommandobeskyttelsen kan ikke starte på denne computer. Automatisk kommandokørsel er slået fra.' };
  assert.throws(() => projectCommandSettings({ autoCommands: true, autoCommandsUnisolated: true }, broken), /Kommandobeskyttelsen kan ikke starte/);
  // Med sandkassen kører kommandoerne isoleret, også hvis valget uden isolation sendes med.
  assert.deepEqual(projectCommandSettings({ autoCommands: true, autoCommandsUnisolated: true }, { available: true, platform: 'darwin' }), { enabled: true, unisolated: false });
  assert.deepEqual(projectCommandSettings({ autoCommands: true }, { available: true, platform: 'linux' }), { enabled: true, unisolated: false });
  // Fravalg kræver ingen sandkasse og fjerner også valget uden isolation. Uden autoCommands ændres intet.
  assert.deepEqual(projectCommandSettings({ autoCommands: false }, null), { enabled: false, unisolated: false });
  assert.equal(projectCommandSettings({ autoProjectFiles: true }, null), null);
  for (const value of [{ autoCommands: 'ja' }, { autoCommands: true, autoCommandsUnisolated: 'ja' }, { autoCommandsUnisolated: true }]) assert.throws(() => projectCommandSettings(value, windows), /Ugyldigt valg af Auto-godkend/, JSON.stringify(value));
  // Hele vejen til det gemte valg, som ChatSession læser.
  const { root, policy } = await fixture(t);
  const choice = projectCommandSettings({ autoCommands: true, autoCommandsUnisolated: true }, windows);
  await policy.setCommands(root, choice.enabled, { unisolated: choice.unisolated });
  assert.deepEqual(await policy.settings(root), { autoProjectFiles: false, autoCommands: true, autoCommandsUnisolated: true, rules: [] });
  const off = projectCommandSettings({ autoCommands: false }, null);
  await policy.setCommands(root, off.enabled, { unisolated: off.unisolated });
  assert.equal((await policy.settings(root)).autoCommandsUnisolated, false);
});

// Fund 9 og brugerens beslutning 10. november 2026 («Fjern funktionen»): huskede kommandoer findes ikke længere. Gemte kommandoregler fra
// beta 2 (nøglet med AI'ens input) og beta 3 (nøglet med kommando og mappe) bevares i lageret, men matcher aldrig. Projektets tilladelser viser
// dem som «Ikke i brug» med kommando og mappe, så de kan slettes. Andre gemte tilladelser virker som før.
const q = value => `'${value}'`;
// Sandkassens indpakning (command-sandbox.cjs), som beta 2 gemte, når værktøjets input var tomt.
const wrappedCommand = (command, cwd) => ['exec', '/usr/bin/env', '-i', `PATH=${q('/app/node/bin:/usr/bin:/bin')}`, `TMPDIR=${q('/appdata/scratch/noegle/opgave-1/tmp')}`, q('/app/node/bin/node'), q('/app/core/command-sandbox-runner.mjs'), q('/appdata/sandboxes/policy/policy.json')].join(' ') + ` '${Buffer.from(JSON.stringify({ command, cwd })).toString('base64url')}'`;

test('gemte kommandoregler fra beta 2 og beta 3 bruges aldrig, heller ikke med kørende sandkasse eller uden isolation (fund 9, beslutning 10. november 2026)', async t => {
  const { root, context, policy, store } = await fixture(t);
  await saveRules(store, root, [beta2Rule('npm test', root, { command: 'npm test', description: 'Kører testene', workdir: root }), beta3Rule('npm run build', root), beta2Rule(wrappedCommand('npm run lint', root), root, {})]);
  const contexts = [['med kørende sandkasse', { ...context, commandSandbox: true, autoCommandsSnapshot: false }], ['uden kørende sandkasse', { ...context, commandSandbox: false }], ['uden isolation på Windows', { ...context, commandSandboxSupported: false, commandSandbox: false, commandUnisolated: true, autoCommandsSnapshot: false }]];
  for (const [what, ctx] of contexts) for (const ask of [bashAsk('npm test', root, 'Kører testene'), bashAsk('npm run build', root, 'Bygger'), bashAsk('npm run lint', root, 'Tjekker')]) {
    const result = await policy.allowed(ctx, ask);
    assert.equal(result.allowed, false, `${ask.toolInput.command} ${what}`); assert.equal(result.descriptor.persistable, false, `${ask.toolInput.command} ${what}`);
  }
  assert.equal((await store.project(root)).approvals.rules.length, 3, 'reglerne bevares i lageret, til brugeren sletter dem');
});

test('gamle kommandoregler vises som ikke i brug med kommando og mappe, også den indpakkede form, og sletning fjerner dem helt (fund 9, RN:A-2)', async t => {
  const { root, outside, policy, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'web'));
  // Samme kommando i samme mappe fra beta 2 og beta 3 er én række. Samme kommando i en anden mappe er en anden række.
  await saveRules(store, root, [
    beta2Rule('npm test', root, { command: 'npm test', description: 'Kører testene', workdir: root }), beta3Rule('npm test', root),
    beta3Rule('npm test', path.join(root, 'web')), beta3Rule('ls', outside), beta2Rule(wrappedCommand('npm run build', path.join(root, 'web')), root, {})
  ]);
  const rows = (await policy.settings(root)).rules;
  assert.deepEqual(rows.map(rule => [rule.label, rule.inactive]), [['Kommando: npm test · i projektmappen', true], ['Kommando: npm test · i mappen web', true], [`Kommando: ls · i ${outside}`, true], ['Kommando: npm run build · i mappen web', true]]);
  // Sletning af rækken fjerner både reglen fra beta 2 og den fra beta 3.
  await policy.revoke(root, rows[0].id);
  assert.deepEqual((await policy.settings(root)).rules.map(rule => rule.label), ['Kommando: npm test · i mappen web', `Kommando: ls · i ${outside}`, 'Kommando: npm run build · i mappen web']);
  assert.deepEqual((await store.project(root)).approvals.rules.map(rule => rule.match.cwd), [path.join(root, 'web'), outside, root]);
  for (const rule of (await policy.settings(root)).rules) await policy.revoke(root, rule.id);
  assert.deepEqual((await store.project(root)).approvals.rules, [], 'alle gamle kommandoregler kan slettes');
});

test('andre gemte tilladelser virker som før ved siden af gamle kommandoregler, og en ugyldig regel røres ikke (fund 9)', async t => {
  const { root, outside, context, policy, store } = await fixture(t);
  const web = { kind: 'webfetch', origin: 'https://example.test' };
  const webRule = { id: ruleId(web), kind: 'webfetch', label: 'Hjemmeside: https://example.test', target: 'https://example.test', match: web };
  const folderMatch = { kind: 'external_directory', folder: outside };
  const folderRule = { id: ruleId(folderMatch), kind: 'external_directory', label: `Mappeadgang: ${outside}`, target: outside, match: folderMatch };
  // En regel, hvis id ikke passer til dens match, er ugyldig og skjult.
  const forged = { ...beta3Rule('rm -rf data', root), id: 'f'.repeat(64) };
  await saveRules(store, root, [beta3Rule('npm test', root), webRule, folderRule, forged]);
  const rules = (await policy.settings(root)).rules;
  assert.deepEqual(rules.map(rule => [rule.label, rule.inactive === true]), [['Kommando: npm test · i projektmappen', true], ['Hjemmeside: https://example.test', false], [`Mappeadgang: ${outside}`, false]]);
  assert.equal((await policy.allowed(context, { id: 'w', permission: 'webfetch', metadata: { url: 'https://example.test/side' } })).source, 'rule', 'hjemmesiden er stadig tilladt');
  assert.equal((await policy.allowed(context, folder(outside))).source, 'rule', 'mappen er stadig tilladt');
  assert.equal((await policy.allowed({ ...context, commandSandbox: true }, bashAsk('rm -rf data', root, 'Rydder op'))).allowed, false, 'den forfalskede regel gælder ikke');
  await policy.revoke(root, rules[0].id);
  assert.deepEqual((await store.project(root)).approvals.rules.map(rule => rule.id), [webRule.id, folderRule.id, forged.id], 'kun kommandoreglen er slettet');
  assert.equal((await policy.allowed(context, { id: 'w', permission: 'webfetch', metadata: { url: 'https://example.test/side' } })).source, 'rule');
});

// Vagterne bag persistable: selv hvis describe en dag sagde, at en kommando kunne huskes, gemmer grant den ikke, og allowed bruger ingen
// gemt kommandoregel (beslutning 10. november 2026). describe erstattes kun i denne prøve.
test('en kommando gemmes og bruges ikke som projekttilladelse, heller ikke hvis describe sagde persistable (beslutning 10. november 2026)', async t => {
  const { root, context, policy, store } = await fixture(t);
  await saveRules(store, root, [beta3Rule('npm test', root)]);
  const describe = policy.describe.bind(policy);
  policy.describe = async (...args) => { const descriptor = await describe(...args); return descriptor.kind === 'bash' ? { ...descriptor, persistable: true } : descriptor; };
  const isolated = { ...context, commandSandbox: true, autoCommandsSnapshot: false };
  await assert.rejects(policy.grant(isolated, bashAsk('npm run build', root, 'Bygger'), { scope: 'project' }), /kun godkendes én gang/);
  assert.equal((await store.project(root)).approvals.rules.length, 1, 'intet nyt er gemt');
  assert.equal((await policy.allowed(isolated, bashAsk('npm test', root, 'Kører testene'))).allowed, false, 'den gemte regel for præcis denne kommando bruges ikke');
});
