// Motorens hemmeligheder: adgangskoden til OpenCodes server, gatewayens midlertidige nøgle og nøglen til forhåndsvisningens bro.
// Mens motoren kører, giver de adgang til motoren, til brugerens AI-forbindelse og til at starte forhåndsvisningen, så andre
// programmer på computeren må ikke kunne læse dem.
//
// OpenCode 1.19.5 tager adgangskoden kun fra sit miljø, og et program med brugerens rettigheder kan læse en proces' startmiljø
// (ps eww på macOS, /proc/<pid>/environ på Linux). Derfor:
// - gatewaynøglen står ikke i den opsætning, motoren starter med, men i sin egen variabel (pladsholderen står i opsætningen), og
//   broens nøgle står ikke i forhåndsvisningens pluginfil;
// - på macOS og Linux får motoren dem gennem vagtprocessens private IPC-forbindelse, så vagtprocessens eget miljø er rent;
// - Auras plugin, som motoren indlæser før alle andre, tager værdierne, overskriver de oprindelige i motorens hukommelse og
//   sletter dem fra motorens kopi af miljøet, så heller ikke motorens hjælpeprogrammer (rg, git) eller kommandoer arver dem;
// - pluginets config-hook sætter gatewaynøglen ind i opsætningen i hukommelsen, hver gang OpenCode indlæser den, og
//   forhåndsvisningens plugin henter broens nøgle hos pluginet, når AI'en bruger værktøjet (preview-bridge.cjs).
// Prøvet mod den rigtige motor: OpenCode læser adgangskoden én gang ved start og bruger sin egen kopi af miljøet, så
// overskrivningen ændrer kun det, andre programmer kan se. Indtil pluginet er indlæst (de første sekunder af opstarten, før AI'en
// kan køre noget), står værdierne stadig i motorens startmiljø. På Windows overskrives intet; dér er der heller ingen sandkasse.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

// Vagtprocessen har sin egen kopi af listen (engine-guardian.cjs); den pakkes ud af app.asar for sig selv og kan ikke indlæse modulet.
const KEYS = Object.freeze(['OPENCODE_SERVER_PASSWORD', 'AURA_GATEWAY_TOKEN', 'AURA_PREVIEW_TOKEN']);
// Står i stedet for gatewaynøglen i den opsætning, motoren starter med. Kommer den rigtige nøgle ikke frem, afviser gatewayen kaldet.
const PLACEHOLDER = 'aura-gateway-noeglen-gives-af-plugin';
// Navnet (Symbol.for), pluginet gemmer værdierne under i motorens proces. Forhåndsvisningens plugin henter broens nøgle dér.
const HELD = 'aura.engine.secrets';

// Pluginet kører i OpenCodes Bun. bun:ffi indlæses dynamisk, så modulet også kan indlæses i Node (prøverne); dér skjules intet.
function pluginSource({ readyPath, readyToken }) {
  return `import fs from 'node:fs/promises';
// Genereret af Aura (desktop/core/engine-secrets.cjs). Tager motorens hemmeligheder én gang pr. proces.
const keys = ${JSON.stringify(KEYS)};
const held = globalThis[Symbol.for(${JSON.stringify(HELD)})] ??= await (async () => {
  const secrets = {};
  for (const key of keys) if (typeof process.env[key] === 'string' && process.env[key]) secrets[key] = process.env[key];
  let hidden = false;
  if (process.platform !== 'win32') {
    try {
      const { dlopen, FFIType, toArrayBuffer } = await import('bun:ffi');
      const names = process.platform === 'darwin' ? ['/usr/lib/libSystem.B.dylib'] : ['libc.so.6', 'libc.musl-' + (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '.so.1'];
      const symbols = { getenv: { args: [FFIType.cstring], returns: FFIType.ptr }, strlen: { args: [FFIType.ptr], returns: FFIType.u64 } };
      let libc = null;
      for (const name of names) { try { libc = dlopen(name, symbols).symbols; break; } catch { /* Prøv næste navn. */ } }
      if (libc) {
        // getenv peger på værdien i selve startmiljøet. Den overskrives på stedet med lige så mange stjerner.
        for (const key of Object.keys(secrets)) {
          const pointer = libc.getenv(Buffer.from(key + '\\0'));
          if (pointer) new Uint8Array(toArrayBuffer(pointer, 0, Number(libc.strlen(pointer)))).fill(42);
        }
        hidden = true;
      }
    } catch { hidden = false; }
  }
  for (const key of keys) delete process.env[key];
  return { secrets, hidden };
})();
export const AuraEngineSecrets = async () => {
  await fs.writeFile(${JSON.stringify(readyPath)}, JSON.stringify({ token: ${JSON.stringify(readyToken)}, received: Object.keys(held.secrets), hidden: held.hidden }), { mode: 0o600 });
  return {
    config: async config => {
      const options = config?.provider?.harness?.options;
      if (options && held.secrets.AURA_GATEWAY_TOKEN) options.apiKey = held.secrets.AURA_GATEWAY_TOKEN;
    },
  };
};
`;
}
async function writePlugin(directory) {
  const pluginPath = path.join(directory, 'engine-secrets.mjs'), readyPath = path.join(directory, 'engine-secrets-ready.json'), readyToken = randomBytes(32).toString('hex');
  await fs.rm(readyPath, { force: true });
  await fs.writeFile(pluginPath, pluginSource({ readyPath, readyToken }), { mode: 0o600 });
  return { pluginURL: pathToFileURL(pluginPath).href, readyPath, readyToken };
}
// Det, motoren får uden for sit startmiljø: adgangskoden og, når de findes, gatewaynøglen og forhåndsvisningens nøgle.
function secretEnv(password, gatewayToken, previewToken) {
  const env = { OPENCODE_SERVER_PASSWORD: password };
  if (typeof gatewayToken === 'string' && gatewayToken) env.AURA_GATEWAY_TOKEN = gatewayToken;
  if (typeof previewToken === 'string' && previewToken) env.AURA_PREVIEW_TOKEN = previewToken;
  return env;
}
// Opsætningen, motoren starter med: som den rigtige, men med pladsholderen i stedet for gatewaynøglen.
function withoutToken(config) {
  const copy = structuredClone(config), options = copy?.provider?.harness?.options;
  if (options?.apiKey) options.apiKey = PLACEHOLDER;
  return copy;
}
// Pluginet skal være indlæst og have fået det, motoren blev startet med. På macOS skal det også have skjult det.
async function verify({ readyPath, readyToken }, { expected = KEYS, requireHidden = false } = {}) {
  const report = await fs.readFile(readyPath, 'utf8').then(JSON.parse).catch(() => null);
  if (report?.token !== readyToken || !Array.isArray(report.received) || !expected.every(key => report.received.includes(key))) throw new Error('Beskyttelsen af motorens nøgler blev ikke indlæst. Opgaven blev ikke startet.');
  if (requireHidden && report.hidden !== true) throw new Error('Motorens nøgler kunne ikke skjules for andre programmer på computeren. Opgaven blev ikke startet.');
  return report;
}
module.exports = { KEYS, PLACEHOLDER, HELD, pluginSource, writePlugin, secretEnv, withoutToken, verify };
