// Spor M, trin 2a: AI'en kan ikke læse motorens egne data (opencode.db med -wal og -shm, store.json og andre projekters runtime).
// Valgte skills (config/skills) og data/opencode/tool-output, som OpenCode selv beder modellen læse, forbliver åbne.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createReadGuard, writeReadGuard, writeSkills, permissions } = require('../core/engine.cjs');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');

async function fixture(t, { copy = false } = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m1-motor-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const app = path.join(base, 'appdata'), directory = path.join(app, 'runtime', 'noegle'), other = path.join(app, 'runtime', 'andet');
  const root = copy ? path.join(app, 'copies', 'c1', 'project') : path.join(base, 'projekt');
  await fs.mkdir(root, { recursive: true });
  for (const dir of [directory, other]) await fs.mkdir(path.join(dir, 'data', 'opencode', 'tool-output'), { recursive: true });
  for (const name of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) await fs.writeFile(path.join(directory, 'data', 'opencode', name), 'x');
  await fs.writeFile(path.join(other, 'data', 'opencode', 'opencode.db'), 'x'); await fs.writeFile(path.join(app, 'store.json'), '{}');
  await fs.writeFile(path.join(directory, 'data', 'opencode', 'tool-output', 'tool_1'), 'langt output');
  await fs.writeFile(path.join(root, 'normal.txt'), 'Offentlig');
  const skills = [{ name: 'harness-test', files: [{ path: 'SKILL.md', content: '# Prøve' }] }];
  await writeSkills(directory, skills);
  const selectedFiles = [path.join(directory, 'config', 'skills', 'harness-test', 'SKILL.md')];
  const guard = createReadGuard({ fs, path, root, selectedFiles, engineRoot: directory, storeRoot: app });
  const read = async file => { const output = { args: { filePath: file } }; await guard({ tool: 'read' }, output); return output.args.filePath; };
  return { base, app, directory, other, root, read, skills };
}

test('read afviser opencode.db med -wal og -shm, andre projekters runtime og store.json', async t => {
  const { app, directory, other, read } = await fixture(t);
  for (const file of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) await assert.rejects(read(path.join(directory, 'data', 'opencode', file)), /Aura beskytter denne fil/, file);
  await assert.rejects(read(path.join(other, 'data', 'opencode', 'opencode.db')), /Aura beskytter denne fil/);
  await assert.rejects(read(path.join(app, 'store.json')), /Aura beskytter denne fil/);
  await assert.rejects(read(path.join(directory, 'home')), /Aura beskytter denne fil/);
});

test('read lader valgte skills, tool-output og projektet stå åbne, også når projektet er en samtalekopi i appens mappe', async t => {
  for (const copy of [false, true]) {
    const { directory, root, read } = await fixture(t, { copy });
    const skill = path.join(directory, 'config', 'skills', 'harness-test', 'SKILL.md'), output = path.join(directory, 'data', 'opencode', 'tool-output', 'tool_1');
    assert.equal(await read(skill), skill, 'skill, kopi=' + copy); assert.equal(await read(output), output, 'tool-output, kopi=' + copy); assert.equal(await read(path.join(root, 'normal.txt')), path.join(root, 'normal.txt'), 'projekt, kopi=' + copy);
  }
});

test('et link i projektet til motorens data afvises, og et link til tool-output følger undtagelsen', { skip: process.platform === 'win32' }, async t => {
  const { directory, root, read } = await fixture(t);
  await fs.symlink(path.join(directory, 'data', 'opencode', 'opencode.db'), path.join(root, 'ufarlig.txt'));
  await assert.rejects(read('ufarlig.txt'), /Aura beskytter denne fil/);
  await fs.symlink(path.join(directory, 'data', 'opencode', 'tool-output', 'tool_1'), path.join(root, 'output.txt'));
  assert.equal(await read('output.txt'), path.join(directory, 'data', 'opencode', 'tool-output', 'tool_1'));
});

test('uden motormappe-parametre er vagten uændret (ingen spærring af motorens mapper)', async t => {
  const { directory, root } = await fixture(t);
  const guard = createReadGuard({ fs, path, root });
  const output = { args: { filePath: path.join(directory, 'data', 'opencode', 'opencode.db') } };
  await guard({ tool: 'read' }, output); assert.equal(output.args.filePath, path.join(directory, 'data', 'opencode', 'opencode.db'));
});

test('pluginet får motormappen og appens mappe med, når motoren ligger i runtime/<nøgle>', async t => {
  const { directory, root, app } = await fixture(t);
  const hooks = await (await import((await writeReadGuard(directory, root, [], [])).pluginURL)).AuraReadProtection();
  await assert.rejects(hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: path.join(app, 'store.json') } }), /Aura beskytter/);
  await assert.rejects(hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: path.join(directory, 'data', 'opencode', 'opencode.db') } }), /Aura beskytter/);
  const open = { args: { filePath: path.join(directory, 'data', 'opencode', 'tool-output', 'tool_1') } };
  await hooks['tool.execute.before']({ tool: 'read' }, open);
});

// OpenCode lader den sidste passende regel gælde. Prøven efterligner det og tjekker rækkefølgen i permissions(); den rigtige motor er
// kørt med de samme regler i verifikationen (se returneret JSON).
function decide(rules, target) {
  const matches = pattern => new RegExp('^' + pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(target);
  let action = null; for (const [pattern, value] of Object.entries(rules)) if (matches(pattern)) action = value; return action;
}
test('permissions(): read og external_directory afviser motorens data efter "../*" og lader skills og tool-output stå', async t => {
  const { directory, other, app, root, skills } = await fixture(t);
  const set = mode => permissions(root, [], mode, { directory, names: skills.map(skill => skill.name) });
  for (const mode of ['plan', 'build']) {
    const { read, external_directory: external } = set(mode);
    for (const rules of [read, external]) {
      for (const file of [path.join(directory, 'data/opencode/opencode.db'), path.join(directory, 'data/opencode/opencode.db-wal'), path.join(other, 'data/opencode/opencode.db'), path.join(app, 'store.json')]) {
        for (const form of [file, file.slice(1), '../../..' + file]) assert.equal(decide(rules, form), 'deny', mode + ' ' + form);
      }
      for (const file of [path.join(directory, 'data/opencode/tool-output/tool_1'), path.join(directory, 'config/skills/harness-test/SKILL.md')]) for (const form of [file, file.slice(1)]) assert.equal(decide(rules, form), 'allow', mode + ' ' + form);
    }
    assert.equal(decide(read, 'normal.txt'), 'allow'); assert.equal(decide(read, '.env'), 'deny', 'navnebeskyttelsen står stadig efter');
  }
  // Uden motormappe i kaldet er reglerne som før.
  assert.equal(decide(permissions(root, [], 'build').read, path.join(app, 'store.json')), 'allow');
});

test('permissions(): en samtalekopi i appens mappe forbliver åben for read og external_directory', async t => {
  const { directory, root, skills } = await fixture(t, { copy: true });
  const { read, external_directory: external } = permissions(root, [], 'build', { directory, names: skills.map(skill => skill.name) });
  const file = path.join(root, 'src/app.js');
  for (const form of [file, file.slice(1)]) { assert.equal(decide(read, form), 'allow'); assert.equal(decide(external, form), 'ask', 'mappeadgang spørger som før'); }
  assert.equal(decide(read, path.join(root, '.env')), 'deny', 'beskyttede navne i kopien er stadig afvist (read)');
});

test('godkendelsespolitikken giver aldrig en gemt regel for motorens data', async t => {
  const { base, app, directory, root } = await fixture(t);
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  const context = { projectRoot: root, workspaceRoot: root, scratchRoot: path.join(base, 'scratch'), mode: 'build', taskRules: new Set(), storeRoot: app, engineRoot: directory };
  const file = path.join(directory, 'data', 'opencode', 'opencode.db');
  const decision = await policy.allowed(context, { id: 'x', permission: 'external_directory', patterns: [path.dirname(file) + '/*'], metadata: { filepath: file, parentDir: path.dirname(file) }, always: [path.dirname(file) + '/*'] });
  assert.equal(decision.allowed, false); assert.equal(decision.descriptor.persistable, false, 'ingen "tillad altid" for motorens data');
  const store = await policy.describe(context, { id: 'y', permission: 'read', patterns: [], metadata: { filepath: path.join(app, 'store.json') } });
  assert.equal(store.persistable, false); assert.equal(store.engineData, true);
  // Valgte skills og tool-output er undtaget, og projektet selv er det også.
  const output = path.join(directory, 'data', 'opencode', 'tool-output', 'tool_1');
  assert.equal((await policy.describe(context, { id: 'z', permission: 'external_directory', patterns: [path.dirname(output) + '/*'], metadata: { filepath: output, parentDir: path.dirname(output) } })).engineData, false);
  assert.equal((await policy.describe(context, { id: 'p', permission: 'read', patterns: [], metadata: { filepath: path.join(root, 'normal.txt') } })).engineData, false);
  // En gammel gemt mappetilladelse, der dækker appens mappe, giver ingen automatisk godkendelse.
  await policy.update(root, data => { const match = { kind: 'external_directory', folder: base }; data.rules.push({ id: require('node:crypto').createHash('sha256').update(JSON.stringify(match)).digest('hex'), kind: 'external_directory', label: 'x', target: base, match }); });
  assert.equal((await policy.allowed(context, { id: 'x2', permission: 'external_directory', patterns: [path.dirname(file) + '/*'], metadata: { filepath: file, parentDir: path.dirname(file) } })).allowed, false);
});
