const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const common = require('../core/protected-paths.cjs');
const { createReadGuard, writeReadGuard, writeSkills, permissions } = require('../core/engine.cjs');
const { protectedPath } = require('../core/git.cjs');
const projectFiles = require('../core/project-files.cjs');
const { capture } = require('../core/changes.cjs');
const { preparePromteArtifact } = require('../core/provider-promte.cjs');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');

const names = ['.env', '.env.local', '.envrc', 'production.env', 'production.env.local', 'production.environment', 'service.key', 'service.pem', 'certificate.p12', 'certificate.pfx', '.ssh/id_rsa', '.aws/config', '.gnupg/private/key', '.kube/config', '.azure/token.json', '.npmrc', '.pypirc', 'secrets/value.txt', '.secrets/value.txt', 'credentials.json', '.git/config', '.aura-private/state.json'];
const protectedNames = [...names, ...names.map(name => 'nested/' + name.toUpperCase())];
const aliases = ['service.KEY::$DATA', 'certificate.p12:stream', 'service.pem.', 'certificate.PFX ', '.KUBE./config', '.SSH /id_rsa', 'references./private.txt', '.kube.. /config', 'public:credentials.json'];
const ordinary = ['index.html', 'src/main.js', 'public/app.css', 'docs/environment.md', 'public/keynote.txt', 'references.md', 'certificate.p12.backup', '.git.notes'];

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-path-policy-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'); await fs.mkdir(root);
  const put = async name => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'Synthetic fixture.'); };
  return { base, root, put };
}

test('shared names and portable aliases are protected by the actual read, Git, file and approval adapters', async t => {
  const { base, root } = await fixture(t), read = createReadGuard({ fs, path, root });
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'state'), {}));
  const context = { projectRoot: root, workspaceRoot: root, mode: 'build', taskRules: new Set() };
  await policy.setProjectFiles(root, true);
  for (const name of [...protectedNames, ...aliases]) {
    assert.equal(common.isProtected(name), true, name);
    assert.equal(protectedPath(name), true, 'Git: ' + name);
    assert.equal(projectFiles.isProtected(name), true, 'file view: ' + name);
    await assert.rejects(read({ tool: 'read' }, { args: { filePath: name } }), /Aura beskytter/, 'read: ' + name);
    const result = await policy.allowed(context, { id: 'test', permission: 'edit', patterns: [], metadata: { filepath: path.join(root, name) } });
    assert.equal(result.allowed, false, 'automatic edit: ' + name);
    assert.equal(result.descriptor.persistable, false, 'remembered edit: ' + name);
  }
  for (const name of ordinary) assert.equal(common.isProtected(name), false, name);
  assert.equal(common.isProtected('nested\\.KUBE.\\config'), true);
});

test('real snapshots and file listings omit sensitive files and keep their existing generated-file and symlink exclusions', async t => {
  const { root, put } = await fixture(t);
  for (const name of [...names, ...ordinary, 'node_modules/package/index.js', 'dist/app.js', '.next/app.js']) await put(name);
  if (process.platform !== 'win32') await fs.symlink(path.join(root, 'index.html'), path.join(root, 'linked.html'));
  assert.deepEqual([...((await capture(root)).files.keys())].sort(), [...ordinary].sort());
  assert.deepEqual((await projectFiles.listFiles(root)).files.map(file => file.path).sort(), [...ordinary].sort());
  await assert.rejects(projectFiles.readFile(root, 'certificate.p12'), error => error.code === 'protected');
  assert.equal((await projectFiles.readFile(root, 'index.html')).text, 'Synthetic fixture.');
});

test('generated read plugin uses the same policy; references and skill files cannot release credentials or change target', async t => {
  const { base, root, put } = await fixture(t), directory = path.join(base, 'engine'); await fs.mkdir(directory);
  for (const name of ['references/selected.txt', 'references/token.pem', 'references/private.txt', '.kube/config', 'normal.txt']) await put(name);
  const skills = [{ name: 'harness-test', files: [{ path: 'SKILL.md', content: '# Test' }, { path: 'references/guide.md', content: 'Guide' }] }];
  await writeSkills(directory, skills);
  const configured = await writeReadGuard(directory, root, ['references/selected.txt', 'references/token.pem'], skills);
  const hooks = await (await import(configured.pluginURL)).AuraReadProtection();
  assert.equal(JSON.parse(await fs.readFile(configured.readyPath, 'utf8')).token, configured.token);
  const read = file => hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: file } });
  await read('references/selected.txt');
  await read(path.join(directory, 'config/skills/harness-test/references/guide.md'));
  for (const name of ['references/token.pem', 'references/private.txt', '.kube/config', 'missing.PFX']) await assert.rejects(read(name), /Aura beskytter/);
  if (process.platform !== 'win32') {
    await fs.unlink(path.join(root, 'references/selected.txt'));
    await fs.symlink(path.join(root, 'normal.txt'), path.join(root, 'references/selected.txt'));
    await assert.rejects(read('references/selected.txt'), /Aura beskytter/);
    await fs.symlink(path.join(root, '.kube/config'), path.join(root, 'public.txt'));
    await assert.rejects(read('public.txt'), /Aura beskytter/);
  }
});

test('engine policy generates read and edit denials without changing mode or selected-skill permissions', () => {
  const skills = { directory: '/temporary/session', names: ['harness-test'] };
  for (const mode of ['chat', 'plan', 'build', 'free']) {
    const rules = permissions('/project', ['references/selected.txt', 'references/token.pem'], mode, skills);
    for (const pattern of common.toOpenCodeGlobs()) {
      assert.equal(rules.read[pattern], 'deny', mode + ': ' + pattern);
      if (rules.edit) assert.equal(rules.edit[pattern], 'deny', mode + ': ' + pattern);
    }
    assert.equal(rules.read['references/selected.txt'], 'allow');
    assert.equal(rules.read['references/token.pem'], undefined);
    assert.equal(rules.skill['harness-test'], 'allow');
    assert.equal(rules.read['*/session/config/skills/*'], 'allow');
    assert.equal(rules['*'], ['chat', 'plan'].includes(mode) ? 'deny' : 'ask');
  }
});

test('Promte export adds shared protection while retaining destination-specific exclusions', () => {
  const extra = ['.gcloud/config', '.docker/config.json', '.netrc', 'backup.zip', 'trace.log', '.agents/config.json', 'dist/index.html'];
  const files = [...protectedNames, ...aliases, ...extra, ...ordinary].map(file => ({ file, data: Buffer.from('Synthetic source.') }));
  assert.deepEqual(preparePromteArtifact({ files }).files.map(file => file.file).sort(), [...ordinary].sort());
});

test('sandbox glob parser covers the common names and preserves ordinary names', async () => {
  const { denyGlobRegex } = await import('../node_modules/@anthropic-ai/sandbox-runtime/dist/sandbox/glob-pattern.js');
  const rules = common.toSandboxGlobs().map(pattern => new RegExp(denyGlobRegex(pattern)));
  for (const name of [...protectedNames, ...aliases]) assert.equal(rules.some(rule => rule.test('project/' + name)), true, name);
  for (const name of ordinary) assert.equal(rules.some(rule => rule.test('project/' + name)), false, name);
});

test('native command sandbox blocks newly covered names for reads, writes and child processes', async t => {
  const sandbox = require('../core/command-sandbox.cjs');
  const support = await sandbox.support(); if (!support.available) return t.skip(support.reason);
  const { base, root, put } = await fixture(t), scratch = path.join(base, 'scratch'); await fs.mkdir(scratch);
  const checked = ['.kube/config', '.azure/token.json', '.gnupg/key', 'certificate.p12', 'certificate.pfx', 'nested/.KUBE/config', '.npmrc'];
  for (const name of checked) await put(name);
  const configured = await sandbox.prepare({ workspaceRoot: root, scratchRoot: scratch, directory: path.join(base, 'policy') });
  const policy = JSON.parse(await fs.readFile(configured.policyPath));
  for (const pattern of common.toSandboxGlobs()) {
    assert.ok(policy.config.filesystem.denyRead.includes(path.join(root, pattern)));
    assert.ok(policy.config.filesystem.denyWrite.includes(path.join(root, pattern)));
  }
  const script = `const fs=require('node:fs'),cp=require('node:child_process');const leaks=[];for(const file of ${JSON.stringify(checked)}){try{fs.readFileSync(file);leaks.push('read:'+file)}catch{}try{fs.appendFileSync(file,'wrong');leaks.push('write:'+file)}catch{}}if(cp.spawnSync(process.execPath,['-e',"require('node:fs').readFileSync('.kube/config')"],{stdio:'ignore'}).status===0)leaks.push('child');fs.writeFileSync('result.json',JSON.stringify(leaks));`;
  await fs.writeFile(path.join(root, 'check.cjs'), script);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const payload = Buffer.from(JSON.stringify({ command: quote(configured.node) + ' check.cjs', cwd: root })).toString('base64url');
  await promisify(execFile)(configured.node, [configured.runner, configured.policyPath, payload], { cwd: root, timeout: 30000 });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'result.json'))), []);
  for (const name of checked) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), 'Synthetic fixture.');
});
