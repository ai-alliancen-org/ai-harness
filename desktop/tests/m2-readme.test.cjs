const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createProject } = require('../core/projects.cjs');
const profiles = path.join(__dirname, '../../profiles');
// Årsag 7c: README i et nyt projekt må ikke sige, at kun public/ vises. Et framework- eller tjenesteprojekt vises også.
test('README i et nyt projekt påstår ikke, at kun public/ vises', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-m2-readme-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = await createProject(parent, { name: 'Readmeprøve', purpose: 'En prøve', color: null, links: [], tests: 'manuel' }, [], profiles);
  const readme = await fs.readFile(path.join(project.root, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /Kun public\/ vises/);
  assert.match(readme, /forhåndsvisning/);
});
