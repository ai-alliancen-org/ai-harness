const path = require('node:path');
const { Arch } = require('builder-util');
const profileResources = [{ from: '../LICENSE', to: 'LICENSE' }, { from: '../profiles', to: 'profiles', filter: ['grundregler.md','gitignore.txt','catalog.json','skills/**/*'] }];
module.exports = {
  appId: 'org.ai-alliancen.harness', productName: 'Aura',
  directories: { output: 'release', buildResources: 'packaging' },
  files: ['main.cjs', 'preload.cjs', 'core/**/*', 'ui/**/*', 'package.json', 'runtime-lock.json'],
  asar: true, asarUnpack: ['core/engine-guardian.cjs', 'core/dev-server-runner.cjs', 'core/command-sandbox-runner.mjs', 'core/pdf-text-worker.cjs', 'node_modules/pdfjs-dist/**/*', 'node_modules/@anthropic-ai/sandbox-runtime/**/*', 'node_modules/@pondwader/socks5-server/**/*', 'node_modules/commander/**/*', 'node_modules/node-forge/**/*', 'node_modules/zod/**/*'], npmRebuild: false,
  extraResources: profileResources,
  artifactName: 'Aura-${version}-${os}-${arch}.${ext}',
  mac: { target: ['dmg','zip'], category: 'public.app-category.developer-tools', icon: 'packaging/icon.png', identity: process.env.HARNESS_SIGN_IDENTITY || null, hardenedRuntime: true, entitlements: 'packaging/entitlements.mac.plist', entitlementsInherit: 'packaging/entitlements.mac.plist', sign: require('./scripts/sign-mac.cjs').sign, notarize: false },
  dmg: { sign: false },
  win: { icon: 'packaging/icon.png', target: ['nsis'], signAndEditExecutable: true },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, deleteAppDataOnUninstall: false, language: '1030' },
  publish: { provider: 'generic', url: 'https://ai-alliancen-org.github.io/ai-harness/updates/', channel: 'beta' },
  generateUpdatesFilesForAllChannels: false,
  beforePack: async context => {
    await require('./scripts/create-icon.cjs').syncAuraIcons();
    const pluginPatterns = await require('./core/engine.cjs').pluginRuntimePatterns();
    context.packager.config.asarUnpack = [...new Set([...context.packager.config.asarUnpack, ...pluginPatterns])];
    const target = `${context.electronPlatformName}-${Arch[context.arch]}`;
    const folder = path.join(__dirname, '.runtime', target);
    const manifest = require(path.join(folder, 'manifest.json'));
    if (manifest.target !== target) throw new Error('Forkert runtime til pakningen.');
    // Runtime-værktøjerne skal være præcis de forberedte, og pakken får et kildebevis. Pakning kræver committede filer.
    if (manifest.payloads?.schemaVersion !== 1) throw new Error('Forbered runtime igen med npm run runtime:prepare før pakning.');
    const integrity = require('./scripts/runtime-integrity.cjs');
    await integrity.verifyRuntime(folder, manifest, manifest, require('./runtime-lock.json'), target);
    await integrity.verifyLicenses(path.join(__dirname, 'packaging', 'licenses'), manifest);
    await integrity.verifyInstalled(__dirname);
    const proof = path.join(__dirname, '.runtime', `source-proof-${target}.json`);
    await require('./scripts/package-source-proof.cjs').create(__dirname, proof);
    context.packager.config.extraResources = [...profileResources, { from: folder, to: 'runtime' }, { from: proof, to: 'source-proof.json' }];
  }
};
