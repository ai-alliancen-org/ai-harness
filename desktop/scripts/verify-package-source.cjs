// Filkontrol på tværs af platforme. Dette starter ikke installationsprogrammet.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('Uventet link i pakkens kildefiler: ' + relative);
  }
  return result.sort();
}
async function verify(resources, target) {
  const archive = path.join(resources, 'app.asar'), source = require('../package.json');
  const packed = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  for (const key of ['name', 'version', 'main', 'productName', 'license']) assert.equal(packed[key], source[key], `Forkert ${key} i den pakkede app`);
  assert.deepEqual(packed.dependencies, source.dependencies, 'Pakkens opdateringsafhængigheder afviger fra kildekoden');
  for (const [name, version] of Object.entries(source.dependencies || {})) {
    assert.equal(JSON.parse(asar.extractFile(archive, `node_modules/${name}/package.json`).toString()).version, version, `Forkert pakket version af ${name}`);
  }
  const updateConfig = require('js-yaml').load(await fs.readFile(path.join(resources, 'app-update.yml'), 'utf8'));
  assert.equal(updateConfig.provider, 'generic');
  assert.equal(updateConfig.url, 'https://ai-alliancen-org.github.io/ai-harness/updates/');
  const names = ['main.cjs', 'preload.cjs', ...await files(path.join(root, 'core'), 'core/'), ...await files(path.join(root, 'ui'), 'ui/')];
  assert.deepEqual(await fs.readFile(path.join(resources, 'LICENSE')), await fs.readFile(path.join(root, '../LICENSE')), 'Pakken skal bevare bibliotekets licens');
  const profileRoot = path.join(root, '../profiles');
  const profiles = ['grundregler.md', 'gitignore.txt', 'catalog.json', ...await files(path.join(profileRoot, 'skills'), 'skills/')];
  // En fil, som kun findes lokalt, er ikke med ved en senere Git-baseret bygning.
  execFileSync('git', ['ls-files', '--error-unmatch', '--', 'package.json', '../LICENSE', ...names, ...profiles.map(f => '../profiles/' + f)], { cwd: root, stdio: 'pipe' });
  for (const name of names) assert.deepEqual(asar.extractFile(archive, name), await fs.readFile(path.join(root, name)), `Pakken afviger fra kildekoden: ${name}`);
  for (const name of profiles) assert.deepEqual(await fs.readFile(path.join(resources, 'profiles', name)), await fs.readFile(path.join(profileRoot, name)), `Pakken afviger fra profilen: ${name}`);
  const lock = require('../runtime-lock.json'), manifest = JSON.parse(await fs.readFile(path.join(resources, 'runtime/manifest.json'), 'utf8'));
  assert(lock.targets[target], 'Ukendt platform'); assert.equal(manifest.target, target);
  assert.deepEqual(manifest.versions, { opencode: lock.opencode, git: lock.git, node: lock.node });
  assert.deepEqual(manifest.archives, lock.targets[target]);
  const expected = JSON.parse(await fs.readFile(path.join(root, '.runtime', target, 'manifest.json'), 'utf8'));
  const finalPayloads = target.startsWith('darwin-') ? await require('./signed-runtime-proof.cjs').expected(resources, target, expected.payloads) : null;
  const runtimePayload = await require('./runtime-integrity.cjs').verifyRuntime(path.join(resources, 'runtime'), manifest, expected, lock, target, finalPayloads);
  const proof = JSON.parse(await fs.readFile(path.join(resources, 'source-proof.json'), 'utf8'));
  const expectedProof = await require('./package-source-proof.cjs').sourceProof(root, ['package.json', 'package-lock.json', 'runtime-lock.json', '../LICENSE', ...names, ...profiles.map(f => '../profiles/' + f)]);
  assert.deepEqual(proof.files, expectedProof.files, 'Kildebeviset skal omfatte alle aktuelle produktfiler');
  const sourceIdentity = await require('./package-source-proof.cjs').verify(root, proof);
  return { sourceIdentity, version: packed.version, target, sourceFiles: names.length + 1, profileFiles: profiles.length, runtime: manifest.versions, runtimePayload, limitation: 'Filkontrol mod arbejdsmappe og låsefil. Ikke installation, signeringskontrol eller afprøvning på en anden computer.' };
}
if (require.main === module) {
  const [resources, target] = process.argv.slice(2);
  if (!resources || !target) { console.error('Angiv pakkens Resources/resources-mappe og runtime-platform.'); process.exitCode = 1; }
  else verify(path.resolve(resources), target).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verify, files };
