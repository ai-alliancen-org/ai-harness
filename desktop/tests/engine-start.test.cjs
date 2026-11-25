const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findExecutable, VERSION, isolatedEnv, writePluginRuntime, pluginRuntimeFiles, pluginRuntimePatterns } = require('../core/engine.cjs');

// Små falske motorer som shell-scripts: en langsom, en med forkert version og en rigtig, der tæller sine kald.
const unix = { skip: process.platform === 'win32' };
async function engine(t, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-motor-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'opencode'); await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return { dir, file };
}

test('en langsom motor i den pakkede app giver en forklaring om ventetid, ikke en udviklerkommando', unix, async t => {
  const { file } = await engine(t, 'sleep 5');
  await assert.rejects(findExecutable({ bundled: { opencode: file }, timeout: 300 }), error => /kunne ikke starte sin AI-motor i tide/.test(error.message) && !/npm run/.test(error.message));
});

test('en manglende eller forkert motor i den pakkede app beder om en ny installation', unix, async t => {
  const { file } = await engine(t, 'echo 0.0.1');
  await assert.rejects(findExecutable({ bundled: { opencode: file }, timeout: 5000 }), /Installer appen igen/);
  await assert.rejects(findExecutable({ bundled: { opencode: path.join(os.tmpdir(), 'findes-ikke', 'opencode') }, timeout: 5000 }), /Installer appen igen/);
});

test('en kontrolleret motor kontrolleres kun én gang pr. kørsel', unix, async t => {
  const { dir, file } = await engine(t, `echo x >> "$(dirname "$0")/kald"\necho ${VERSION}`);
  assert.equal(await findExecutable({ bundled: { opencode: file }, timeout: 5000 }), file);
  assert.equal(await findExecutable({ bundled: { opencode: file }, timeout: 5000 }), file);
  assert.equal((await fs.readFile(path.join(dir, 'kald'), 'utf8')).trim().split('\n').length, 1);
});
test('plugin-opstart bruger den bundtede SDK og et isoleret hjem uden installation på nettet', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-plugin-start-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writePluginRuntime(dir); await writePluginRuntime(dir);
  for (const folder of [path.join(dir, 'config'), path.join(dir, 'config', 'opencode')]) {
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    const lock = JSON.parse(await fs.readFile(path.join(folder, 'package-lock.json'), 'utf8'));
    assert.equal(manifest.dependencies['@opencode-ai/plugin'], VERSION);
    assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
    const sdk = JSON.parse(await fs.readFile(path.join(folder, 'node_modules', '@opencode-ai', 'plugin', 'package.json'), 'utf8'));
    assert.equal(sdk.version, VERSION);
  }
  assert.ok((await pluginRuntimeFiles()).some(folder => folder.endsWith(path.join('@opencode-ai', 'sdk'))));
  const env = isolatedEnv(dir, { plugin: ['file:///trusted-plugin.mjs'] }, { commandIsolation: true });
  assert.equal(env.HOME, path.join(dir, 'home')); assert.equal(env.USERPROFILE, env.HOME); assert.equal(env.SHELL, '/bin/bash');
  assert.equal(isolatedEnv(dir, { plugin: ['file:///read-guard.mjs'] }).SHELL, undefined);
  // Startmiljøet har ingen hemmeligheder; adgangskoden og gatewaynøglen kommer ad en anden vej (engine-secrets.cjs).
  for (const key of ['OPENCODE_SERVER_PASSWORD', 'AURA_GATEWAY_TOKEN']) assert.equal(key in env, false, key);
});
test('pakkereglerne bevarer SDK-afhængigheder, når electron-builder flytter nested moduler til roden', async () => {
  const { minimatch } = require('minimatch'), patterns = await pluginRuntimePatterns();
  for (const file of ['node_modules/which/which.js', 'node_modules/isexe/index.js', 'node_modules/cross-spawn/node_modules/which/which.js', 'node_modules/@opencode-ai/plugin/dist/index.js']) {
    assert.equal(patterns.some(pattern => minimatch(file, pattern)), true, file + ' skal kunne læses af den eksterne motor');
  }
});
