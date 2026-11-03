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

test('eksisterende projekter får ingen automatisk adgang; projektfiler kan slås til og fra og huskes efter genåbning', async t => {
  const { root, context, policy, store } = await fixture(t), p = edit(path.join(root, 'ny.txt'));
  assert.deepEqual(await policy.settings(root), { autoProjectFiles: false, autoCommands: false, rules: [] });
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

test('kommandoer matches fuldt sammen med den kanoniske arbejdsmappe, og kan tilbagekaldes', async t => {
  const { root, outside, context, policy } = await fixture(t), p = command('node logic-test.js', root);
  await policy.grant(context, p, { scope: 'project' });
  assert.equal((await policy.allowed(context, p)).allowed, false, 'Heller ikke en husket kommando må køres automatisk uden isolation.');
  const isolated = { ...context, commandSandbox: true, autoCommandsSnapshot: false };
  assert.equal((await policy.allowed(isolated, p)).source, 'rule');
  for (const other of [command('node build-copies.js', root), command('node logic-test.js && rm -rf data', root), command('node logic-test.js', outside), command('node  logic-test.js', root)]) assert.equal((await policy.allowed(isolated, other)).allowed, false);
  assert.equal((await policy.allowed({ ...isolated, mode: 'plan' }, p)).allowed, false);
  const [rule] = (await policy.settings(root)).rules; await policy.revoke(root, rule.id);
  assert.equal((await policy.allowed(isolated, p)).allowed, false);
});

test('ændrede input og linkmål ændrer fingeraftryk og godkendelsesgruppe', async t => {
  const { root, outside, base, context, policy } = await fixture(t), link = path.join(base, 'arbejdslink');
  await fs.symlink(root, link); const p = command('node logic-test.js', link);
  const before = await policy.describe(context, p); await policy.grant(context, p, { scope: 'project' });
  await fs.unlink(link); await fs.symlink(outside, link);
  const after = await policy.describe(context, p);
  assert.notEqual(before.fingerprint, after.fingerprint); assert.notEqual(before.key, after.key);
  assert.equal((await policy.allowed(context, p)).allowed, false);
  const changed = await policy.describe(context, { ...p, toolInput: { ...p.toolInput, input: { environment: { EXTRA: 'andet' } } } });
  assert.notEqual(changed.fingerprint, after.fingerprint);
  await assert.rejects(policy.grant(context, p, { scope: 'project', fingerprint: before.fingerprint }), /ændret sig/);
});

test('en platform uden kommandoisolation tilbyder kun enkeltgodkendelse, også ved en tidligere gemt regel', async t => {
  const { root, context, policy } = await fixture(t), p = command('node logic-test.js', root);
  await policy.grant(context, p, { scope: 'project' });
  for (const commandSandboxSupported of [false, undefined, 'true']) {
    const unsupported = { ...context, commandSandboxSupported, commandSandbox: false, autoCommandsSnapshot: false };
    const descriptor = await policy.describe(unsupported, p);
    assert.equal(descriptor.persistable, false);
    assert.equal((await policy.allowed(unsupported, p)).allowed, false);
    await assert.rejects(policy.grant(unsupported, p, { scope: 'project' }), /kun godkendes én gang/);
  }
  assert.equal((await policy.settings(root)).rules.length, 1, 'Den gemte regel bevares til en platform med isolation eller brugerens tilbagekaldelse.');
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

test('en husket kommando matcher uanset AI\'ens begrundelse og tidsgrænse, men ikke en anden kommando eller mappe (beta 3)', async t => {
  const { root, policy, context } = await fixture(t);
  const sandboxContext = { ...context, commandSandbox: true, commandSandboxSupported: true };
  const bash = (command, input = {}, workdir) => ({ id: 'p', permission: 'bash', patterns: [command], metadata: { command }, toolInput: { tool: 'bash', command, ...(workdir ? { workdir } : {}), input: { command, ...input } } });
  const a = await policy.describe(sandboxContext, bash('npm test', { description: 'Kører testene', timeout: 120000 }));
  const b = await policy.describe(sandboxContext, bash('npm test', { description: 'Prøver igen', timeout: 30000 }));
  assert.equal(a.key, b.key, 'begrundelse og timeout hører ikke til nøglen');
  assert.notEqual(a.key, (await policy.describe(sandboxContext, bash('npm run build', { description: 'Kører testene' }))).key);
  await fs.mkdir(path.join(root, 'sub'));
  assert.notEqual(a.key, (await policy.describe(sandboxContext, bash('npm test', {}, path.join(root, 'sub')))).key, 'en anden mappe er en anden tilladelse');
});

test('en mappe over hjemmemappen er for bred til at blive husket (beta 3)', async t => {
  const { policy, context } = await fixture(t);
  const home = require('node:os').homedir();
  const over = path.dirname(home);
  const d = await policy.describe({ ...context, mode: 'build' }, { id: 'p', permission: 'external_directory', patterns: [over + '/*'], metadata: { filepath: over, parentDir: over } });
  assert.equal(d.persistable, false, 'mappen over hjemmemappen kan ikke huskes');
});
