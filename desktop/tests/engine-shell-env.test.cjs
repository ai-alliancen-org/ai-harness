// RN:B1-2: AI'ens kommandoer må ikke arve motorens opsætning, adgangskode eller gatewaynøgle. Motoren starter med
// OPENCODE_CONFIG_CONTENT (gatewayens adresse, med en pladsholder i stedet for nøglen), OPENCODE_SERVER_USERNAME og, ad en anden vej end
// startmiljøet, OPENCODE_SERVER_PASSWORD og AURA_GATEWAY_TOKEN (engine-secrets.cjs). Nøglepluginet sletter de to sidste fra motorens
// miljø; read-guardens shell.env tømmer dem alle for kommandoerne som en ekstra sikring. Prøven går gennem det genererede plugin, som
// motoren indlæser. At andre programmer heller ikke kan læse dem i motorens proces efter starten (ps eww, /proc/<pid>/environ), viser
// g-motorens-noegler-rigtig-motor.test.cjs mod den rigtige motor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeReadGuard, isolatedEnv } = require('../core/engine.cjs');
const { secretEnv, withoutToken } = require('../core/engine-secrets.cjs');

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
const KEYS = ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME', 'AURA_GATEWAY_TOKEN'];

test('en kommando arver ikke motorens opsætning, adgangskode, brugernavn eller gatewaynøgle', async t => {
  const { directory, hooks } = await plugin(t);
  const config = { provider: { harness: { options: { apiKey: 'SYNTETISK-GATEWAYNØGLE', baseURL: 'http://127.0.0.1:1/v1' } } } };
  // Alt det, motoren får ved start: startmiljøet og hemmelighederne, som her lægges ved siden af.
  const engineEnv = { ...isolatedEnv(directory, withoutToken(config)), ...secretEnv('SYNTETISK-MOTORADGANGSKODE', 'SYNTETISK-GATEWAYNØGLE') };
  for (const key of KEYS) assert.ok(engineEnv[key], key);
  // Opsætningen i startmiljøet har pladsholderen, ikke gatewaynøglen.
  assert.doesNotMatch(engineEnv.OPENCODE_CONFIG_CONTENT, /SYNTETISK-GATEWAYNØGLE/);
  const env = await commandEnv(hooks, engineEnv);
  for (const key of KEYS) assert.equal(Boolean(env[key]), false, key);
  assert.doesNotMatch(JSON.stringify(env), /SYNTETISK-GATEWAYNØGLE|SYNTETISK-MOTORADGANGSKODE/);
  // Resten af motorens miljø står, fx PATH og motorens egne mapper.
  assert.equal(env.PATH, engineEnv.PATH);
});

test('kommandoerne bruger stadig projektets .aura/tmp', async t => {
  const { root, directory } = await plugin(t);
  const tempRoot = path.join(root, '.aura', 'tmp');
  const { hooks } = await plugin(t, { tempRoot });
  const env = await commandEnv(hooks, { ...isolatedEnv(directory, {}), ...secretEnv('SYNTETISK-MOTORADGANGSKODE') });
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(env[key], tempRoot, key);
  assert.equal(Boolean(env.OPENCODE_SERVER_PASSWORD), false);
});
