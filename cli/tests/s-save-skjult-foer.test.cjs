// Q:D1-4 i terminalen: en fil, hvis gemte version kan rumme en hemmelighed, kan nu vælges i /save (desktop/core/git.cjs giver
// beforeHidden i stedet for teksten fra før). Terminalen viste «før»: null, som om filen var ny. Nu står grunden i almindeligt dansk,
// og hemmeligheden vises stadig aldrig. Prøven kører save() fra cli/actions.cjs med det rigtige GitVersions i et midlertidigt projekt.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GitVersions, run } = require('../../desktop/core/git.cjs');
const { save } = require('../actions.cjs');

test('/save viser grunden til, at teksten fra før ikke vises, og aldrig hemmeligheden', async t => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-save-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  // Git i prøven må hverken læse eller skrive brugerens egen opsætning.
  const home = path.join(base, 'home'); await fs.mkdir(home);
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') });
  const dir = path.join(base, 'projekt'); await fs.mkdir(path.join(dir, 'public'), { recursive: true });
  const secret = 'ghp_' + 'Z9y8'.repeat(9);
  await fs.writeFile(path.join(dir, 'public/app.js'), `const token = "${secret}";\n`);
  const git = new GitVersions(); await git.startProject(dir);
  // Som et projekt, hvor hemmeligheden kom med i en version uden for Aura og siden er fjernet.
  await run(dir, ['add', '--', 'public/app.js']); await run(dir, ['commit', '-m', 'Gemt uden for Aura']);
  await fs.writeFile(path.join(dir, 'public/app.js'), 'const token = process.env.TOKEN;\n');
  const lines = [];
  const ui = { line: text => lines.push(String(text)), confirm: async () => false, ask: async () => 'x' };
  await save({ ui, bench: { project: { root: dir }, git } });
  const shown = JSON.parse(lines.find(line => line.startsWith('{')));
  assert.equal(shown.før, 'Teksten fra før vises ikke, fordi den gemte version kan indeholde en nøgle eller adgangskode. Den nye version er kontrolleret og kan gemmes.');
  assert.match(shown.efter, /process\.env\.TOKEN/);
  assert.equal(lines.join('\n').includes(secret.slice(4, 16)), false, 'hemmeligheden står ingen steder');
});
