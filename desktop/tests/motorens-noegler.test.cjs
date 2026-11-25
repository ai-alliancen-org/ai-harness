// Motorens hemmeligheder (engine-secrets.cjs): adgangskoden og gatewaynøglen kommer uden om startmiljøets opsætning, og nøglepluginet
// tager dem, sletter dem fra motorens miljø og giver gatewaynøglen tilbage gennem config-hooket. Her indlæses pluginet i Node i en
// separat proces, som motoren ville; Node har ikke bun:ffi, så overskrivningen af startmiljøet prøves mod den rigtige motor i
// g-motorens-noegler-rigtig-motor.test.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const secrets = require('../core/engine-secrets.cjs');

async function folder(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-motornoegler-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
// Indlæser pluginet i en ny proces med de givne hemmeligheder, som OpenCode gør, og kalder config-hooket to gange (to indlæsninger).
async function loadPlugin(pluginURL, env) {
  const script = `const plugin = await import(${JSON.stringify(pluginURL)});
const config = () => ({ provider: { harness: { options: { apiKey: ${JSON.stringify(secrets.PLACEHOLDER)}, baseURL: 'http://127.0.0.1:1/v1' } } } });
const first = config(), second = config();
await (await plugin.AuraEngineSecrets()).config(first);
await (await plugin.AuraEngineSecrets()).config(second);
console.log(JSON.stringify({ env: { password: process.env.OPENCODE_SERVER_PASSWORD ?? null, token: process.env.AURA_GATEWAY_TOKEN ?? null }, keys: [first, second].map(c => c.provider.harness.options.apiKey) }));`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(stdout);
}

test('nøglepluginet sletter hemmelighederne fra motorens miljø og giver gatewaynøglen tilbage ved hver indlæsning', async t => {
  const plugin = await secrets.writePlugin(await folder(t));
  const result = await loadPlugin(plugin.pluginURL, secrets.secretEnv('SYNTETISK-ADGANGSKODE', 'SYNTETISK-GATEWAYNOEGLE'));
  assert.deepEqual(result.env, { password: null, token: null }, 'motorens kopi af miljøet har dem ikke mere');
  assert.deepEqual(result.keys, ['SYNTETISK-GATEWAYNOEGLE', 'SYNTETISK-GATEWAYNOEGLE'], 'opsætningen får den rigtige nøgle hver gang');
  const report = await secrets.verify(plugin, { expected: secrets.KEYS });
  assert.deepEqual(report.received.sort(), [...secrets.KEYS].sort());
  // Node kan ikke overskrive startmiljøet. Kræves det skjult, afvises starten.
  assert.equal(report.hidden, false);
  await assert.rejects(secrets.verify(plugin, { expected: secrets.KEYS, requireHidden: true }), /kunne ikke skjules for andre programmer/);
});

test('uden gatewaynøgle bliver pladsholderen stående, og kontrollen kræver kun adgangskoden', async t => {
  const plugin = await secrets.writePlugin(await folder(t));
  const result = await loadPlugin(plugin.pluginURL, secrets.secretEnv('SYNTETISK-ADGANGSKODE', ''));
  assert.deepEqual(result.keys, [secrets.PLACEHOLDER, secrets.PLACEHOLDER]);
  await secrets.verify(plugin, { expected: ['OPENCODE_SERVER_PASSWORD'] });
  await assert.rejects(secrets.verify(plugin, { expected: secrets.KEYS }), /blev ikke indlæst/);
});

test('kontrollen afviser en manglende eller fremmed kvittering', async t => {
  const directory = await folder(t);
  const plugin = await secrets.writePlugin(directory);
  await assert.rejects(secrets.verify(plugin), /Beskyttelsen af motorens nøgler blev ikke indlæst/);
  await fs.writeFile(plugin.readyPath, JSON.stringify({ token: 'en anden', received: [...secrets.KEYS], hidden: true }));
  await assert.rejects(secrets.verify(plugin), /blev ikke indlæst/);
  await fs.writeFile(plugin.readyPath, JSON.stringify({ token: plugin.readyToken, received: [...secrets.KEYS], hidden: true }));
  await secrets.verify(plugin, { requireHidden: true });
  // En ny start skriver et nyt plugin med en ny kvittering; den gamle gælder ikke.
  const next = await secrets.writePlugin(directory);
  assert.notEqual(next.readyToken, plugin.readyToken);
  await assert.rejects(secrets.verify(next), /blev ikke indlæst/);
});

test('startopsætningen har pladsholderen i stedet for gatewaynøglen, og originalen er uændret', () => {
  const config = { model: 'harness/m', provider: { harness: { npm: 'x', options: { apiKey: 'SYNTETISK-GATEWAYNOEGLE', baseURL: 'http://127.0.0.1:1/v1' } } } };
  const started = secrets.withoutToken(config);
  assert.equal(started.provider.harness.options.apiKey, secrets.PLACEHOLDER);
  assert.equal(config.provider.harness.options.apiKey, 'SYNTETISK-GATEWAYNOEGLE');
  assert.doesNotMatch(JSON.stringify(started), /SYNTETISK-GATEWAYNOEGLE/);
  assert.deepEqual(secrets.withoutToken({ provider: { harness: { options: { baseURL: 'x' } } } }), { provider: { harness: { options: { baseURL: 'x' } } } });
  assert.deepEqual(secrets.secretEnv('a', 'b'), { OPENCODE_SERVER_PASSWORD: 'a', AURA_GATEWAY_TOKEN: 'b' });
  assert.deepEqual(secrets.secretEnv('a', undefined), { OPENCODE_SERVER_PASSWORD: 'a' });
});
