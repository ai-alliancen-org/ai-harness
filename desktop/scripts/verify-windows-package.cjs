// Statisk kontrol af de faktiske Windows-filer. Starter hverken app eller installer.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const semver = require('semver');
const yaml = require('js-yaml');
async function sha256(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function peMachine(file) {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(64); assert.equal((await handle.read(header, 0, 64, 0)).bytesRead, 64, 'PE-header mangler: ' + file);
    assert.equal(header.toString('ascii', 0, 2), 'MZ', 'Filen er ikke et Windows-program: ' + file);
    const offset = header.readUInt32LE(60); assert.ok(offset >= 64 && offset < 1024 * 1024, 'Ugyldig PE-position');
    const pe = Buffer.alloc(6); assert.equal((await handle.read(pe, 0, 6, offset)).bytesRead, 6, 'PE-header afkortet');
    assert.equal(pe.subarray(0, 4).toString('hex'), '50450000', 'PE-signatur mangler');
    return pe.readUInt16LE(4);
  } finally { await handle.close(); }
}
async function executableMetadata(file, archive, version) {
  const { NtExecutable, NtExecutableResource, Resource } = require('resedit');
  const entries = NtExecutableResource.from(NtExecutable.from(await fs.readFile(file))).entries;
  const info = Resource.VersionInfo.fromEntries(entries)[0]; assert.ok(info, 'Windows-versionsteksten mangler.');
  const locale = info.getAllLanguagesForStringValues()[0], values = info.getStringValues(locale);
  assert.equal(values.ProductName, 'Aura'); assert.equal(values.FileDescription, 'Aura'); assert.equal(values.FileVersion, version);
  assert.ok(entries.some(entry => entry.type === 14), 'Windows-ikonet mangler.');
  const integrity = entries.find(entry => entry.type === 'INTEGRITY'); assert.ok(integrity, 'Windows-programmets ASAR-integritet mangler.');
  const records = JSON.parse(Buffer.from(integrity.bin).toString('utf8'));
  const record = records.find(item => item.file.replace(/\\+/g, '/') === 'resources/app.asar');
  assert.equal(record?.alg, 'SHA256');
  assert.equal(record.value, createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex'), 'Windows-programmet forventer et andet app.asar-indhold.');
  return { productName: values.ProductName, fileVersion: values.FileVersion, productVersion: values.ProductVersion, asarIntegrity: record.value };
}
function namesIn(archive) { return asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')); }
async function pluginClosure(archive) {
  const names = namesIn(archive), known = new Set(names), visited = new Set(), packages = [];
  function manifest(folder) { return JSON.parse(asar.extractFile(archive, folder + '/package.json')); }
  async function visit(folder) {
    if (visited.has(folder)) return; visited.add(folder);
    const pkg = manifest(folder); let files = 0;
    for (const name of names.filter(name => name.startsWith(folder + '/'))) {
      const stat = asar.statFile(archive, name);
      if (stat.files) continue;
      // En nested pakke valideres også særskilt, når den findes i afhængighedsgrafen.
      assert.equal(stat.unpacked, true, 'OpenCode kan ikke læse en plugin-fil inde i app.asar: ' + name);
      const physical = path.join(archive + '.unpacked', ...name.split('/'));
      const item = await fs.lstat(physical); assert.ok(item.isFile(), 'Plugin-fil mangler eller er et link: ' + name);
      assert.equal(stat.integrity?.algorithm, 'SHA256', 'Plugin-filens kontrolsum mangler: ' + name);
      assert.equal(await sha256(physical), stat.integrity.hash, 'Plugin-filen matcher ikke apparkivets kontrolsum: ' + name);
      files++;
    }
    assert.ok(files > 0, 'Plugin-pakken er tom: ' + folder);
    packages.push({ name: pkg.name, version: pkg.version, folder, files });
    for (const [name, range] of Object.entries(pkg.dependencies || {})) {
      let base = folder, found;
      while (base !== '.') {
        const candidate = path.posix.join(base, 'node_modules', name);
        if (known.has(candidate + '/package.json')) { found = candidate; break; }
        base = path.posix.dirname(base);
      }
      if (!found && known.has('node_modules/' + name + '/package.json')) found = 'node_modules/' + name;
      assert.ok(found, 'Plugin-afhængighed mangler: ' + name);
      // npm bruger rodpakkens eksplicitte overrides, bl.a. den sikkerhedsrettede Effect-version.
      // Kontrollér den præcise override frem for at kræve den ældre version fra pluginets manifest.
      const override = require('../package.json').overrides?.[name];
      assert.ok(semver.satisfies(manifest(found).version, typeof override === 'string' ? override : range), 'Forkert version af plugin-afhængighed: ' + name);
      await visit(found);
    }
  }
  await visit('node_modules/@opencode-ai/plugin'); return packages;
}
async function inspect(directory, { candidate = false } = {}) {
  const resources = path.join(directory, 'resources'), archive = path.join(resources, 'app.asar');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json'));
  const update = yaml.load(await fs.readFile(path.join(resources, 'app-update.yml'), 'utf8'));
  const runtime = JSON.parse(await fs.readFile(path.join(resources, 'runtime/manifest.json'), 'utf8'));
  assert.ok(['win32-x64', 'win32-arm64'].includes(runtime.target));
  const machine = runtime.target === 'win32-x64' ? 0x8664 : 0xaa64;
  const binaries = {};
  for (const name of ['Aura.exe', 'resources/runtime/node/node.exe', 'resources/runtime/git/cmd/git.exe', 'resources/runtime/opencode/bin/opencode.exe']) {
    const file = path.join(directory, name); assert.equal(await peMachine(file), machine, 'Forkert Windows-arkitektur: ' + name);
    binaries[name] = { bytes: (await fs.stat(file)).size, sha256: await sha256(file) };
  }
  assert.equal(metadata.name, 'aura-desktop'); assert.equal(metadata.productName, 'Aura');
  assert.equal(update.provider, 'generic'); assert.equal(update.url, 'https://ai-alliancen-org.github.io/ai-harness/updates/'); assert.equal(update.channel, 'beta');
  const executable = await executableMetadata(path.join(directory, 'Aura.exe'), archive, metadata.version);
  const result = { version: metadata.version, dependencies: metadata.dependencies, target: runtime.target, runtime: runtime.versions, update, binaries, executable };
  if (candidate) {
    result.source = await require('./verify-package-source.cjs').verify(resources, runtime.target);
    result.pluginRuntime = await pluginClosure(archive);
    for (const name of ['core/dev-server-runner.cjs', 'core/command-sandbox-runner.mjs']) {
      assert.equal(asar.statFile(archive, name).unpacked, true, 'Ekstern proces kan ikke læse ' + name);
      assert.deepEqual(await fs.readFile(path.join(archive + '.unpacked', name)), await fs.readFile(path.join(__dirname, '..', name)));
    }
    // verify-package-source har sammenlignet denne kode byte for byte med pakken.
    // Windows-grenen returnerer før en proces startes og kan derfor afprøves her.
    result.commandSandbox = await require('../core/command-sandbox.cjs').support({ platform: 'win32' });
    assert.equal(result.commandSandbox.available, false);
  }
  return result;
}
async function verify(oldDirectory, newDirectory) {
  const old = await inspect(oldDirectory), candidate = await inspect(newDirectory, { candidate: true });
  assert.ok(semver.gt(candidate.version, old.version)); assert.equal(candidate.target, old.target);
  assert.deepEqual(candidate.update, old.update, 'Opdateringskanal, cache eller signaturkrav er ændret. Gennemgå migrationen.');
  const unchangedRuntimeBinaries = [];
  if (JSON.stringify(old.runtime) === JSON.stringify(candidate.runtime)) {
    for (const [name, value] of Object.entries(old.binaries).filter(([name]) => name !== 'Aura.exe')) {
      assert.equal(candidate.binaries[name].sha256, value.sha256, 'Runtime skiftede bytes uden versionsændring: ' + name); unchangedRuntimeBinaries.push(name);
    }
  }
  return { status: 'bestået', old, candidate, unchangedRuntimeBinaries, limitation: 'Faktiske Windows-pakkefiler kontrolleret på værtsmaskinen. Starter ikke Windows, NSIS eller updateren og beviser ikke installation, SmartScreen eller drift på Windows.' };
}
if (require.main === module) {
  const [oldDirectory, newDirectory, report] = process.argv.slice(2);
  if (!oldDirectory || !newDirectory) { console.error('Angiv tidligere og ny win-unpacked-mappe samt eventuelt rapportsti.'); process.exitCode = 1; }
  else verify(path.resolve(oldDirectory), path.resolve(newDirectory)).then(async result => { if (report) await fs.writeFile(report, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verify, inspect, peMachine, pluginClosure };
