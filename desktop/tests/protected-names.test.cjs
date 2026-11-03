// De delte beskyttede navne må ikke ramme almindelige kildefiler: en komponent som SecretsPage.jsx eller en fil som api.envelope.js
// skal kunne udgives. Rigtige hemmelighedsnavne er stadig beskyttede (fund fra gennemgangen 3. november, regression fra #56).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isProtected } = require('../core/protected-paths.cjs');
const { protectedPath } = require('../core/git.cjs');

const ALMINDELIGE = ['src/pages/SecretsPage.jsx', 'src/hooks/useSecrets.js', 'docs/secrets-policy.md', 'src/environment.js', 'README.md'];
const HEMMELIGE = ['.env', '.env.local', 'production.env', 'secrets/nogle.txt', '.secrets/x', 'secrets.json', 'id.pem', 'api.key', '.ssh/config', '.aws/credentials', '.kube/config', '.npmrc', 'references/privat.txt', '.git/config'];

test('almindelige kildefiler med secrets i navnet er ikke beskyttede', () => {
  for (const file of ALMINDELIGE) assert.equal(isProtected(file), false, file);
});

test('rigtige hemmelighedsnavne er stadig beskyttede', () => {
  for (const file of HEMMELIGE) assert.equal(isProtected(file), true, file);
});

test('Git-kontrollen bruger de samme navne', () => {
  for (const file of ['src/pages/SecretsPage.jsx', 'src/hooks/useSecrets.js']) assert.equal(protectedPath(file), false, file);
  for (const file of ['.env', 'secrets/nogle.txt', 'id.pem']) assert.equal(protectedPath(file), true, file);
});

test('Promte sender aldrig .aura (AI-kladder og udgivelsesindstillinger) med fra projektets rod', () => {
  const { preparePromteArtifact } = require('../core/provider-promte.cjs');
  const fil = (file, tekst = 'x') => ({ file, data: Buffer.from(tekst) });
  const artifact = preparePromteArtifact({ files: [fil('package.json', '{"name":"p"}'), fil('index.html'), fil('src/main.jsx'), fil('.aura/tmp/op1/noter.md'), fil('.aura/publishing/vercel.json')] });
  const names = artifact.files.map(f => f.file);
  assert.deepEqual(names.sort(), ['index.html', 'package.json', 'src/main.jsx']);
});
