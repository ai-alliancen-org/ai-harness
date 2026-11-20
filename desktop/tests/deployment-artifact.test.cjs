const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../core/git.cjs');
const { deploymentArtifact } = require('../core/deployment-artifact.cjs');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'harness-artifact-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await run(root, ['init']);
  await fs.mkdir(path.join(root, 'public'));
  await fs.writeFile(path.join(root, 'public/index.html'), '<h1>En bestemt version</h1>');
  await fs.writeFile(path.join(root, '.gitignore'), '/dist/\n');
  const save = async () => {
    await run(root, ['add', '.']);
    await run(root, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Testbruger', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Gem isoleret testmateriale']);
  };
  await save(); return { root, save };
}
test('udgivelsespakke indeholder præcis den gemte mappe og stabilt indholdsfingeraftryk', async t => {
  const { root } = await fixture(t);
  const first = await deploymentArtifact(root, 'public');
  assert.equal(first.version.name, 'Gem isoleret testmateriale');
  assert.ok(Number.isFinite(Date.parse(first.version.at)));
  assert.deepEqual(first.files.map(f => f.file), ['index.html']);
  assert.equal(first.files[0].data.toString(), '<h1>En bestemt version</h1>');
  assert.equal((await deploymentArtifact(root, 'public')).hash, first.hash);
  await fs.mkdir(path.join(root, 'dist')); await fs.writeFile(path.join(root, 'dist/index.html'), 'Kun på computeren');
  await assert.rejects(deploymentArtifact(root, 'dist'), /ingen filer/);
  assert.equal((await deploymentArtifact(root, 'public')).hash, first.hash);
});
test('lokale ændringer og ugyldige mappestier afvises før pakning', async t => {
  const { root } = await fixture(t);
  await assert.rejects(deploymentArtifact(root, '../andet'), /relativ/);
  await assert.rejects(deploymentArtifact(root, '/tmp'), /relativ/);
  await assert.rejects(deploymentArtifact(root, 'public/../public'), /relativ/);
  await fs.writeFile(path.join(root, 'public/index.html'), 'Ugemt');
  await assert.rejects(deploymentArtifact(root, 'public'), /lokale ændringer/);
});
test('hemmelighedsfiler og links kan ikke indgå i udgivelsespakken', async t => {
  const { root, save } = await fixture(t);
  await fs.writeFile(path.join(root, 'public/.env'), 'SYNTHETIC=eksempel'); await save();
  await assert.rejects(deploymentArtifact(root, 'public'), /privat fil/);
  await fs.unlink(path.join(root, 'public/.env'));
  await fs.symlink('../.gitignore', path.join(root, 'public/link')); await save();
  await assert.rejects(deploymentArtifact(root, 'public'), /link/);
});
test('mistænkeligt indhold i almindelig fil afvises', async t => {
  const { root, save } = await fixture(t);
  await fs.writeFile(path.join(root, 'public/config.js'), 'const api_key = "kun-syntetisk-testhemmelighed";'); await save();
  await assert.rejects(deploymentArtifact(root, 'public'), /hemmelighed/);
});
test('containerbyggemateriale bevarer den gemte Git-filtilstand for startscripts', async t => {
  const { root, save } = await fixture(t);
  await fs.writeFile(path.join(root, 'public/start.sh'), '#!/bin/sh\nexec node server.cjs\n');
  await save();
  await run(root, ['update-index', '--chmod=+x', 'public/start.sh']);
  await run(root, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Testbruger', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'gem kørbart startscript']);
  if (process.platform !== 'win32') await fs.chmod(path.join(root, 'public/start.sh'), 0o755);
  const artifact = await deploymentArtifact(root, 'public');
  assert.equal(artifact.files.find(f => f.file === 'start.sh').mode, '100755');
  assert.equal(artifact.files.find(f => f.file === 'index.html').mode, '100644');
});
