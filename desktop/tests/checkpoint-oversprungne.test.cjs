// Fund 6 (beta 3): springer en automatisk version en fil over, fx en fil med en mulig hemmelighed, står filnavnet i beskeden i
// Aktivitet. Før stod der kun «Gemt som en version. Du kan fortryde opgaven.», selv om filen hverken blev gemt eller fortrydes
// med opgaven. Prøven bruger de rigtige Checkpoints og GitVersions i et nyt testrepository.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GitVersions, run } = require('../core/git.cjs');
const { Checkpoints } = require('../core/checkpoints.cjs');

// Brugeren har godkendt commits og testidentitet alene i disse nye testrepositories (som i tests/git.test.cjs).
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-version-')));
  const home = path.join(root, 'home'); await fs.mkdir(home); process.env.HOME = home; process.env.USERPROFILE = home; process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  const project = path.join(root, 'projekt'); await fs.mkdir(path.join(project, 'public'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = new GitVersions(); await git.initialize(project);
  await run(project, ['config', '--local', 'user.name', 'Testbruger']); await run(project, ['config', '--local', 'user.email', 'test@example.invalid']);
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Første</h1>');
  const review = await git.review(project); await git.commit(project, { token: review.token, files: ['public/index.html'], message: 'Første version' });
  const events = [];
  return { project, checkpoints: new Checkpoints(git, event => events.push(event)), events };
}

test('fund 6: en version, der springer en fil over, nævner filen i beskeden', async t => {
  const { project, checkpoints, events } = await fixture(t);
  await checkpoints.begin(project, true, 'Tilføj konfiguration');
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Anden</h1>');
  await fs.writeFile(path.join(project, 'public/config.js'), 'const apiKey = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";');
  await checkpoints.finish();
  const saved = events.at(-1);
  assert.equal(saved.status, 'saved'); assert.deepEqual(saved.kept, ['public/config.js']);
  assert.match(saved.message, /^Gemt som en version\. Du kan fortryde opgaven\. /);
  assert.match(saved.message, /Disse filer blev ikke gemt og fortrydes ikke med opgaven.*: public\/config\.js\.$/);
});

test('fund 6: uden oversprungne filer er beskeden uændret, og en afbrudt opgave nævner også filen', async t => {
  const { project, checkpoints, events } = await fixture(t);
  await checkpoints.begin(project, true, 'Ret overskriften');
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Anden</h1>');
  await checkpoints.finish();
  assert.equal(events.at(-1).message, 'Gemt som en version. Du kan fortryde opgaven.');
  await checkpoints.begin(project, true, 'Tilføj konfiguration');
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Tredje</h1>');
  await fs.writeFile(path.join(project, 'public/config.js'), 'const apiKey = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";');
  checkpoints.cancel(); await checkpoints.finish();
  assert.match(events.at(-1).message, /^Opgaven blev afbrudt\. Det, den nåede at ændre, er gemt som en version, så du kan fortryde\. Disse filer blev ikke gemt .*: public\/config\.js\.$/);
});
