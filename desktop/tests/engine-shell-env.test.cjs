// RN:B1-2: AI'ens kommandoer må ikke arve motorens opsætning og adgangskode. Motoren starter med OPENCODE_CONFIG_CONTENT (gatewayens
// midlertidige nøgle og adresse), OPENCODE_SERVER_PASSWORD og OPENCODE_SERVER_USERNAME i sit miljø (isolatedEnv). En kommando, der kører
// uden sandkasse (fx godkendt én gang), får motorens miljø med det, pluginets shell.env lægger ovenpå. Prøven går gennem det genererede
// plugin, som motoren indlæser. At OpenCode 1.19.5 bruger miljøet sådan, er kørt mod den rigtige motor (se docs/teststatus.md).
// Prøven viser, at kommandoen ikke ARVER værdierne. Den viser ikke, at en kommando ikke kan læse dem: en kommando uden sandkasse kører
// med brugerens rettigheder og kan læse motorens procesmiljø (fx ps eww -p <motorens pid> på macOS eller /proc/<pid>/environ på Linux).
// Det forhindrer kun sandkassen, hvor ps nægtes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeReadGuard, isolatedEnv } = require('../core/engine.cjs');

async function plugin(t, options = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-shell-env-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), directory = path.join(base, 'motor');
  await fs.mkdir(root); await fs.mkdir(directory);
  const configured = await writeReadGuard(directory, root, [], [], options);
  return { base, root, directory, hooks: await (await import(configured.pluginURL)).AuraReadProtection() };
}
// Som OpenCode starter en kommando: motorens eget miljø med pluginets shell.env ovenpå.
async function commandEnv(hooks, engineEnv) {
  const output = { env: {} };
  await hooks['shell.env']({ cwd: '/', sessionID: 's', callID: 'c' }, output);
  return { ...engineEnv, ...output.env };
}

test('en kommando arver ikke motorens opsætning, adgangskode eller brugernavn', async t => {
  const { directory, hooks } = await plugin(t);
  const engineEnv = isolatedEnv(directory, { provider: { harness: { options: { apiKey: 'SYNTETISK-GATEWAYNØGLE', baseURL: 'http://127.0.0.1:1/v1' } } } }, 'SYNTETISK-MOTORADGANGSKODE');
  // Forudsætningen: motoren har dem i sit miljø.
  for (const key of ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME']) assert.ok(engineEnv[key], key);
  const env = await commandEnv(hooks, engineEnv);
  for (const key of ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME']) assert.equal(Boolean(env[key]), false, key);
  assert.doesNotMatch(JSON.stringify(env), /SYNTETISK-GATEWAYNØGLE|SYNTETISK-MOTORADGANGSKODE/);
  // Resten af motorens miljø står, fx PATH og motorens egne mapper.
  assert.equal(env.PATH, engineEnv.PATH);
});

test('kommandoerne bruger stadig projektets .aura/tmp', async t => {
  const { root, directory } = await plugin(t);
  const tempRoot = path.join(root, '.aura', 'tmp');
  const { hooks } = await plugin(t, { tempRoot });
  const env = await commandEnv(hooks, isolatedEnv(directory, {}, 'SYNTETISK-MOTORADGANGSKODE'));
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(env[key], tempRoot, key);
  assert.equal(Boolean(env.OPENCODE_SERVER_PASSWORD), false);
});
