// Beskyttede navne gælder stien inde i projektet, ikke mapperne over det: et projekt i en mappe som "secrets-app" eller "Aftaler m.m."
// skal kunne læses af AI'en. Selve beskyttede filer i projektet er stadig beskyttede (#56, fund fra gennemgangen 3. november).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createReadGuard } = require('../core/engine.cjs');
const { createPathClassifier, RULES } = require('../core/protected-paths.cjs');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');

async function projekt(t, mappenavn) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-ancestors-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, mappenavn, 'projekt'); await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'almindelig.txt'), 'ok'); await fs.writeFile(path.join(root, '.env'), 'HEMMELIG');
  return { base, root };
}

test('læsevagten tillader almindelige filer i et projekt under en mappe med secrets, credentials eller punktum i navnet, og beskytter stadig .env', async t => {
  for (const mappe of ['secrets-app', 'kommunens-credentials', 'Aftaler m.m.']) {
    const { root } = await projekt(t, mappe);
    const guard = createReadGuard({ fs, path, root, classifyPath: createPathClassifier(RULES) });
    await assert.doesNotReject(guard({ tool: 'read' }, { args: { filePath: path.join(root, 'almindelig.txt') } }), mappe);
    await assert.rejects(guard({ tool: 'read' }, { args: { filePath: path.join(root, '.env') } }), /beskytter/, mappe);
  }
});

test('godkendelsespolitikken behandler en almindelig fil i et projekt under secrets-app som en projektfil', async t => {
  const { base, root } = await projekt(t, 'secrets-app');
  const policy = new ApprovalsPolicy(new Store(path.join(base, 'data'), {}));
  const context = { projectRoot: root, workspaceRoot: root, mode: 'build', taskRules: new Set() };
  const input = file => ({ id: 'p', permission: 'edit', patterns: ['almindelig.txt'], metadata: { filepath: file }, toolInput: { tool: 'write', filePath: file } });
  const ok = await policy.describe(context, input(path.join(root, 'almindelig.txt')));
  assert.equal(ok.projectFile, true, 'en almindelig fil i projektet er en projektfil');
  const hemmelig = await policy.describe(context, input(path.join(root, '.env')));
  assert.equal(hemmelig.projectFile, false, '.env er stadig beskyttet');
});
