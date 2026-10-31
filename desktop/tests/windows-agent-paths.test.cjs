const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const requireFromPolicy = require('node:module').createRequire(path.join(__dirname, '../core/approvals-policy.cjs'));

// Rigtige Win32-strenge og Node path.win32, med et eksplicit modelleret filsystem.
// Det er ikke en Windows-kørsel: reparse points, ACL og netværksdrev kræver den native prøve.
async function fixture({ caseSensitive = false } = {}) {
  const paths = path.win32, root = 'C:\\Brugere\\Zoë\\Mit projekt', share = '\\\\server\\fælles\\Projekt';
  const entries = new Map(), key = file => caseSensitive ? paths.normalize(file).replace(/^[A-Z]:/, drive => drive.toLowerCase()) : paths.normalize(file).toLowerCase();
  function add(file, dir = false, real = file) { entries.set(key(file), { real, isDirectory: () => dir, isSymbolicLink: () => real !== file }); }
  for (const folder of ['C:\\', 'C:\\Brugere', 'C:\\Brugere\\Zoë', root, paths.join(root, 'src'), 'D:\\', 'D:\\Andet', '\\\\server\\fælles\\', share, paths.join(share, 'src')]) add(folder, true);
  add(paths.join(root, 'src', 'App.tsx')); add(paths.join(share, 'src', 'App.tsx'));
  if (caseSensitive) add(paths.join(root, 'src', 'APP.tsx'));
  add(paths.join(root, 'link'), true, 'D:\\Andet');
  const entry = async file => { const value = entries.get(key(file)); if (!value) throw Object.assign(new Error('Ikke fundet'), { code: 'ENOENT' }); return value; };
  const fileSystem = { lstat: entry, stat: entry, realpath: async file => (await entry(file)).real };
  const module = { exports: {} }, source = await fs.readFile(path.join(__dirname, '../core/approvals-policy.cjs'), 'utf8');
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name === 'node:path' ? paths : name === 'node:fs/promises' ? fileSystem : name === 'node:os' ? { homedir: () => 'C:\\Brugere\\Zoë', tmpdir: () => 'C:\\Temp' } : requireFromPolicy(name) });
  const data = { approvals: { version: 1, autoProjectFiles: true, autoCommands: false, rules: [] } };
  const store = { project: async () => data };
  const policy = new module.exports.ApprovalsPolicy(store), context = { projectRoot: root, workspaceRoot: root, mode: 'free', commandSandboxSupported: false };
  return { paths, root, share, policy, context, add, data, canonicalPath: module.exports.canonicalPath };
}
const edit = (file, patterns = [], input = file) => ({ id: 'fil', permission: 'edit', patterns, metadata: { filepath: file }, toolInput: { tool: 'write', filePath: input } });

test('Windows: OpenCodes canonical metadata og toolInput med andet drevbogstav er samme filmål', async () => {
  const { root, policy, context } = await fixture();
  const p = edit(root + '\\src\\App.tsx', ['src\\App.tsx'], root.replace(/^C:/, 'c:') + '\\src\\App.tsx');
  assert.equal((await policy.allowed(context, p)).source, 'project');
  const differentCase = edit(root + '\\src\\App.tsx', ['SRC/App.tsx'], root.toUpperCase() + '/SRC/App.tsx');
  assert.equal((await policy.allowed(context, differentCase)).source, 'project');
});

test('Windows: en mappe med case-sensitive filer får ikke tvetydig automatisk godkendelse', async () => {
  const { root, policy, context } = await fixture({ caseSensitive: true });
  const p = edit(root + '\\src\\App.tsx', ['src\\App.tsx'], root + '\\src\\APP.tsx');
  assert.equal((await policy.allowed(context, p)).allowed, false);
});

test('Windows: case-sensitive nabomapper og junctions får ikke projekt-, opgave- eller scratchadgang', async () => {
  const { paths, root, policy, context, add, data } = await fixture({ caseSensitive: true });
  const sibling = paths.join(paths.dirname(root), paths.basename(root).toUpperCase());
  add(sibling, true); add(paths.join(root, 'case-link'), true, sibling);
  context.taskRules = new Set();
  context.taskRules.add((await policy.describe(context, edit(paths.join(root, 'ny.txt')))).key);
  for (const file of [paths.join(sibling, 'ny.txt'), paths.join(root, 'case-link', 'ny.txt')]) {
    const result = await policy.allowed(context, edit(file));
    assert.equal(result.allowed, false, file); assert.equal(result.descriptor.projectFile, false, file);
    await assert.rejects(policy.grant(context, edit(file), { scope: 'task' }), /projektmappen/);
  }
  const scratch = paths.join(root, 'scratch'), otherScratch = paths.join(root, 'SCRATCH');
  add(scratch, true); add(otherScratch, true); data.approvals.autoProjectFiles = false;
  const scratchContext = { ...context, scratchRoot: scratch, taskRules: new Set() };
  assert.equal((await policy.allowed(scratchContext, edit(paths.join(scratch, 'ny.txt')))).source, 'scratch');
  assert.equal((await policy.allowed(scratchContext, edit(paths.join(otherScratch, 'ny.txt')))).allowed, false);
});

test('Windows: case-sensitive nabomapper får ikke automatisk kommando eller en husket mapperegel', async () => {
  const { paths, root, policy, context, add, data } = await fixture({ caseSensitive: true });
  const sibling = paths.join(paths.dirname(root), paths.basename(root).toUpperCase()); add(sibling, true);
  const isolated = { ...context, commandSandboxSupported: true, commandSandbox: true, autoCommandsSnapshot: true };
  const command = workdir => ({ id: 'bash', permission: 'bash', toolInput: { tool: 'bash', command: 'node app.js', workdir } });
  assert.equal((await policy.allowed(isolated, command(root))).source, 'commands');
  assert.equal((await policy.allowed(isolated, command(sibling))).allowed, false);
  const folder = 'C:\\Ekstern', other = 'C:\\EKSTERN'; add(folder, true); add(other, true);
  const match = { kind: 'edit', folder };
  data.approvals.rules.push({ id: require('node:crypto').createHash('sha256').update(JSON.stringify(match)).digest('hex'), kind: 'edit', label: 'Mappe', target: folder, match });
  assert.equal((await policy.allowed(context, edit(paths.join(folder, 'ny.txt')))).source, 'rule');
  assert.equal((await policy.allowed(context, edit(paths.join(other, 'ny.txt')))).allowed, false);
  await assert.rejects(policy.grant(context, edit(paths.join(other, 'ny.txt')), { scope: 'project', folder }), /indeholder de viste filer/);
});

test('Windows: nye filer og UNC-projekter tillades, men andet drev og junctionflugt gør ikke', async () => {
  const { paths, root, share, policy, context } = await fixture();
  assert.equal((await policy.allowed(context, edit(paths.join(root, 'ny', 'fil.txt'), ['ny/fil.txt']))).allowed, true);
  assert.equal((await policy.allowed({ ...context, projectRoot: share, workspaceRoot: share }, edit(paths.join(share, 'src', 'App.tsx'), ['src/App.tsx']))).allowed, true);
  for (const file of ['D:\\Andet\\fil.txt', paths.join(root, 'link', 'fil.txt')]) assert.equal((await policy.allowed(context, edit(file))).allowed, false, file);
});

test('Windows: streams, device paths, drevrelative stier og Win32-navnealiaser får ingen automatisk adgang', async () => {
  const { root, policy, context, canonicalPath } = await fixture();
  for (const file of [root + '\\api.key::$DATA', root + '\\normal.txt:skjult', root + '\\NUL.txt', root + '\\COM1', root + '\\LPT¹', root + '\\fil.txt.', root + '\\fil.txt ', root + '\\secrets. \\fil', '\\\\.\\C:\\fil', '\\\\?\\C:\\fil', '\\rodrelativ\\fil', 'C:relativ.txt']) {
    await assert.rejects(canonicalPath(file), /afgrænses/);
    const result = await policy.allowed(context, edit(file));
    assert.equal(result.allowed, false, file); assert.equal(result.descriptor.persistable, false, file);
  }
});

test('Windows: beskyttede mappenavne genkendes uanset store og små bogstaver', async () => {
  const { root, policy, context } = await fixture();
  for (const name of ['.GIT', 'Secrets', 'REFERENCES']) {
    const result = await policy.allowed(context, edit(root + '\\' + name + '\\fil.txt'));
    assert.equal(result.allowed, false, name); assert.equal(result.descriptor.persistable, false, name);
  }
});

test('Windows: en CRLF-patch bevarer alle konkrete fil- og flyttemål', async () => {
  const { root, policy, context } = await fixture();
  const p = { id: 'patch', permission: 'edit', patterns: ['src\\App.tsx'], metadata: { filepath: 'src\\App.tsx', files: [{ filePath: root + '\\src\\App.tsx', movePath: root + '\\src\\Ny.tsx', type: 'move' }] }, toolInput: { tool: 'apply_patch', patchText: '*** Begin Patch\r\n*** Update File: src/App.tsx\r\n*** Move to: src/Ny.tsx\r\n@@\r\n-gammelt\r\n+nyt\r\n*** End Patch\r\n' } };
  assert.equal((await policy.allowed(context, p)).source, 'project');
  p.toolInput.patchText = p.toolInput.patchText.replace('src/Ny.tsx', 'D:\\Andet\\Ny.tsx');
  assert.equal((await policy.allowed(context, p)).allowed, false);
});
