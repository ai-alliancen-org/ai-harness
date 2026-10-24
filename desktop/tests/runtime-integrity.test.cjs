const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { inventory, verifyRuntime } = require('../scripts/runtime-integrity.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-runtime-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'node/bin'), { recursive: true });
  await fs.writeFile(path.join(root, 'node/bin/node'), 'synthetic executable', { mode: 0o755 });
  await fs.writeFile(path.join(root, 'LICENSE'), 'synthetic license');
  const lock = { node: 'test-node', git: 'test-git', opencode: 'test-engine', sources: [], targets: { fixture: { node: { checksum: 'synthetic' } } } };
  const manifest = { target: 'fixture', versions: { node: lock.node, git: lock.git, opencode: lock.opencode }, sources: [], archives: lock.targets.fixture, payloads: await inventory(root) };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, lock, manifest, verify: () => verifyRuntime(root, manifest, manifest, lock, 'fixture') };
}
test('a locked payload inventory verifies bytes, license, modes and internal links without executing tools', async t => {
  const f = await fixture(t);
  if (process.platform !== 'win32') await fs.symlink('bin/node', path.join(f.root, 'node/current'));
  f.manifest.payloads = await inventory(f.root);
  assert.equal((await f.verify()).files, process.platform === 'win32' ? 2 : 3);
  assert.equal((await inventory(f.root)).sha256, f.manifest.payloads.sha256);
});
for (const change of ['alter', 'missing', 'extra', 'executable']) test('rejects runtime payload drift: ' + change, async t => {
  if (change === 'executable' && process.platform === 'win32') return t.skip('Windows has no portable executable mode bit');
  const f = await fixture(t), file = path.join(f.root, 'node/bin/node');
  if (change === 'alter') await fs.writeFile(file, 'modified runtime');
  if (change === 'missing') await fs.unlink(file);
  if (change === 'extra') await fs.writeFile(path.join(f.root, 'extra'), 'untracked payload');
  if (change === 'executable') await fs.chmod(file, 0o644);
  await assert.rejects(f.verify(), /Runtime-payload/);
});
test('a rewritten packaged ledger, stale platform or archive declaration cannot hide changed payloads', async t => {
  const f = await fixture(t), original = structuredClone(f.manifest);
  await fs.writeFile(path.join(f.root, 'LICENSE'), 'changed license');
  f.manifest.payloads = await inventory(f.root);
  await assert.rejects(verifyRuntime(f.root, f.manifest, original, f.lock, 'fixture'), /runtimebevis/);
  await assert.rejects(verifyRuntime(f.root, { ...f.manifest, target: 'wrong' }, original, f.lock, 'fixture'), /platform/);
  await assert.rejects(verifyRuntime(f.root, { ...f.manifest, archives: {} }, original, f.lock, 'fixture'), /arkiver/);
});
test('rejects absolute, escaping, dangling and ancestor-symlink payload links', async t => {
  if (process.platform === 'win32') return t.skip('Creating symlinks may require Windows privileges');
  for (const target of ['/etc/passwd', '../../outside', 'missing']) {
    const f = await fixture(t); await fs.symlink(target, path.join(f.root, 'node/link'));
    await assert.rejects(inventory(f.root));
  }
});

test('special object property names cannot hide unexpected runtime payloads', async t => {
 const f = await fixture(t);
 await fs.writeFile(path.join(f.root, '__proto__'), 'unexpected executable', { mode: 0o755 });
 const actual = await inventory(f.root);assert.ok(Object.hasOwn(actual.entries, '__proto__'));
 assert.notEqual(actual.sha256, f.manifest.payloads.sha256);await assert.rejects(f.verify(), /Runtime-payload/);
});

test('a controlled macOS signing transformation has a separate exact-byte receipt; later executable changes fail', { skip: process.platform !== 'darwin' }, async t => {
  const { execFileSync } = require('node:child_process');
  const { record, expected, receiptPath } = require('../scripts/signed-runtime-proof.cjs');
  const f = await fixture(t), target = 'darwin-synthetic-test', resources = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-signed-proof-'));
  t.after(() => fs.rm(resources, { recursive: true, force: true }));
  t.after(() => fs.rm(receiptPath(target), { force: true }));
  await fs.mkdir(path.join(resources, 'runtime')); await fs.copyFile('/usr/bin/true', path.join(resources, 'runtime', 'tool'));
  await fs.writeFile(path.join(resources, 'source-proof.json'), '{"source":"synthetic"}');
  const input = await inventory(path.join(resources, 'runtime'));
  const manifest = { ...f.manifest, target, payloads: input }, lock = { ...f.lock, targets: { [target]: f.manifest.archives } };
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path.join(resources, 'runtime', 'tool')], { stdio: 'pipe' });
  await assert.rejects(verifyRuntime(path.join(resources, 'runtime'), manifest, manifest, lock, target));
  const receipt = await record(resources, target, input);
  assert.notEqual(receipt.payloads.sha256, input.sha256);
  const final = await expected(resources, target, input);
  await verifyRuntime(path.join(resources, 'runtime'), manifest, manifest, lock, target, final);
  await fs.appendFile(path.join(resources, 'runtime', 'tool'), 'modified');
  await assert.rejects(verifyRuntime(path.join(resources, 'runtime'), manifest, manifest, lock, target, final));
  await fs.writeFile(path.join(resources, 'source-proof.json'), '{"source":"other"}');
  await assert.rejects(expected(resources, target, input), /andre kildefiler/);
});
