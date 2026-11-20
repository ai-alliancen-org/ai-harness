const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const { pluginClosure, peMachine } = require('../scripts/verify-windows-package.cjs');
test('pakkekontrollen kræver den låste Effect-override og afviser både gammel og ukendt version', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-package-override-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const expected = require('../package.json').overrides.effect;
  for (const version of ['4.0.0-beta.94', expected, '4.0.0-beta.104']) {
    for (const [name, pkg] of [['@opencode-ai/plugin', { version: '1.19.5', dependencies: { effect: '4.0.0-beta.94' } }], ['effect', { version }]]) {
      const folder = path.join(source, 'node_modules', name); await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, ...pkg }));
    }
    const archive = path.join(root, version + '.asar');
    await asar.createPackageWithOptions(source, archive, { unpackDir: 'node_modules' });
    if (version === expected) assert.equal((await pluginClosure(archive)).find(p => p.name === 'effect').version, expected);
    else await assert.rejects(pluginClosure(archive), /Forkert version.*effect/);
  }
});
test('pakkekontrollen finder en transitiv SDK-afhængighed, der ligger forkert i ASAR', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-package-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  for (const [name, dependencies] of [['@opencode-ai/plugin', { '@opencode-ai/sdk': '1.18.33' }], ['@opencode-ai/sdk', {}]]) {
    const folder = path.join(source, 'node_modules', name); await fs.mkdir(path.join(folder, 'dist'), { recursive: true });
    await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.18.33', dependencies }));
    await fs.writeFile(path.join(folder, 'dist/index.js'), 'export const test = true;');
  }
  const missing = path.join(root, 'missing.asar');
  await asar.createPackageWithOptions(source, missing, { unpackDir: 'node_modules/@opencode-ai/plugin' });
  await assert.rejects(pluginClosure(missing), /app\.asar.*@opencode-ai\/sdk/);
  const complete = path.join(root, 'complete.asar');
  await asar.createPackageWithOptions(source, complete, { unpackDir: 'node_modules' });
  assert.deepEqual((await pluginClosure(complete)).map(p => p.name).sort(), ['@opencode-ai/plugin', '@opencode-ai/sdk']);
  const sdkFile = path.join(complete + '.unpacked', 'node_modules/@opencode-ai/sdk/dist/index.js');
  await fs.writeFile(sdkFile, 'ændrede bytes'); await assert.rejects(pluginClosure(complete), /matcher ikke apparkivets kontrolsum/);
  await fs.rm(sdkFile);
  await assert.rejects(pluginClosure(complete), { code: 'ENOENT' });
});
test('pakkekontrollen skelner x64 og ARM64 og afviser en ugyldig PE-fil', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-pe-audit-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'program.exe'), bytes = Buffer.alloc(134);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  await fs.writeFile(file, bytes); assert.equal(await peMachine(file), 0x8664);
  bytes.writeUInt16LE(0xaa64, 132); await fs.writeFile(file, bytes); assert.equal(await peMachine(file), 0xaa64);
  bytes.writeUInt32LE(0xffffffff, 60); await fs.writeFile(file, bytes); await assert.rejects(peMachine(file), /Ugyldig PE-position/);
  await fs.writeFile(file, 'forkert'); await assert.rejects(peMachine(file), /PE-header mangler/);
});
test('NSIS-prøven ser den nye ASAR-version, når installeren erstatter samme filsti', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-asar-upgrade-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), archive = path.join(root, 'app.asar'); await fs.mkdir(source);
  const { readPackageVersion } = require('../scripts/verify-windows-nsis-upgrade.cjs');
  for (const version of ['0.5.0-beta.3', '0.6.0-beta.1']) {
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ version }));
    await asar.createPackage(source, archive);
    assert.equal(readPackageVersion(archive), version);
  }
});
