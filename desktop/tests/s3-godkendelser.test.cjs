const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const { isProtected, toSandboxGlobs, toOpenCodeGlobs } = require('../core/protected-paths.cjs');

// Fund 5: beskyttelseslisten.
test('fund 5: nye hemmelighedsnavne er beskyttede i alle mapper', () => {
  for (const name of ['.netrc', 'id_rsa', 'id_rsa.pub', 'id_rsa_backup', 'id_ed25519', 'id_ed25519.pub', 'main.tfvars', 'prod.auto.tfvars', '.htpasswd', 'credentials', 'credentials.json', 'credentials.yml', '.credentials', '.git-credentials', 'aws.credentials', 'Credentials.JSON']) {
    assert.equal(isProtected(name), true, name);
    assert.equal(isProtected('mappe/under/' + name), true, 'i undermappe: ' + name);
  }
});
test('fund 5: almindelig kode med credentials i navnet er ikke længere spærret', () => {
  for (const name of ['CredentialsForm.tsx', 'credentials-provider.ts', 'src/components/CredentialsForm.tsx', 'lib/credentials-provider.ts', 'useCredentials.js', 'my-credentials-helper.md', 'netrc.md', 'identity.md', 'tfvars.md', 'htpasswd-guide.md']) assert.equal(isProtected(name), false, name);
});
test('fund 5: legitimationsfiler med credentials som endelse eller forstavelse er stadig beskyttede', () => {
  for (const name of ['aws_credentials', 'gcp-credentials.json', 'service-account-credentials.json', 'credentials_prod.json', 'application_default_credentials.json', 'a/b/gcp-credentials.json', 'Prod-Credentials.YAML']) {
    assert.equal(isProtected(name), true, name);
  }
});
test('fund 5: det, der var beskyttet før, er det stadig, og secrets er et navn og ikke en delstreng', () => {
  for (const name of ['.ssh/config', '.aws/credentials', '.gnupg/x', '.kube/config', '.azure/x', '.npmrc', '.pypirc', '.env', '.env.local', 'prod.env', 'a.key', 'a.pem', 'a.p12', 'a.pfx', 'secrets', '.secrets', 'secrets.json', 'a/secrets/b']) assert.equal(isProtected(name), true, name);
  for (const name of ['SecretsPage.jsx', 'useSecrets.js', 'src/mysecrets.ts']) assert.equal(isProtected(name), false, name);
  assert.equal(isProtected('.git/config'), true); assert.equal(isProtected('references/x'), true);
});
test('fund 5: motorens og sandkassens mønstre følger den nye liste', () => {
  const sandbox = toSandboxGlobs().join('\n'), engine = toOpenCodeGlobs();
  for (const pattern of ['.netrc', 'id_rsa*', 'id_ed25519*', '*.tfvars', '.htpasswd']) assert.ok(engine.includes(pattern), pattern);
  assert.match(sandbox, /\*\*\/\[\.\]|\*\*\/\.\[nN\]\[eE\]\[tT\]\[rR\]\[cC\]/);
  assert.doesNotMatch(engine.join('\n'), /\*credentials\*/);
});

// Fund 10 og 11: godkendelser.
async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s3-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), scratch = path.join(base, 'scratch');
  await fs.mkdir(root); await fs.mkdir(scratch);
  const store = new Store(path.join(base, 'data'), {}), policy = new ApprovalsPolicy(store);
  return { root, policy, context: { projectRoot: root, workspaceRoot: root, scratchRoot: scratch, mode: 'build', taskRules: new Set(), commandSandboxSupported: true } };
}
const edit = file => ({ id: 'fil', permission: 'edit', metadata: { filepath: file }, patterns: [] });
test('fund 10: stier med [ ] { } giver et kort med stien og kan auto-godkendes som projektfil', async t => {
  const { root, policy, context } = await fixture(t);
  for (const rel of ['app/[slug]/page.tsx', 'app/(grp)/{id}/x.ts', 'app/[...rest]/page.tsx']) {
    const file = path.join(root, rel);
    const d = await policy.describe(context, edit(file));
    assert.ok(d.match, rel + ' skal kunne afgrænses'); assert.equal(d.projectFile, true, rel); assert.ok(d.target.includes(rel), d.target);
  }
  await policy.setProjectFiles(root, true);
  assert.equal((await policy.allowed(context, edit(path.join(root, 'app/[slug]/page.tsx')))).source, 'project');
});
test('fund 10: relative mønstre med [ ] binder til det konkrete mål', async t => {
  const { root, policy, context } = await fixture(t);
  const file = path.join(root, 'app/[slug]/page.tsx');
  const d = await policy.describe(context, { id: 'x', permission: 'edit', metadata: { filepath: file }, patterns: ['app/[slug]/page.tsx'] });
  assert.ok(d.match); assert.equal(d.projectFile, true);
  const other = await policy.describe(context, { id: 'x', permission: 'edit', metadata: { filepath: path.join(root, 'app/s/page.tsx') }, patterns: ['app/[slug]/page.tsx'] });
  assert.equal(other.match, undefined, 'mønstret må ikke tolkes som glob og passe på en anden fil');
});
test('fund 10: ? * nul og .. afvises stadig, og en sti med [ ] passer ikke på andre filer', async t => {
  const { root, policy, context } = await fixture(t);
  for (const file of [root + '/a?b.txt', root + '/a*b.txt', root + '/a\0b.txt', root + '/x/../a.txt']) assert.equal((await policy.describe(context, edit(file))).match, undefined, JSON.stringify(file));
  await policy.setProjectFiles(root, false);
  const a = await policy.describe(context, edit(path.join(root, 'app/[slug]/page.tsx'))), b = await policy.describe(context, edit(path.join(root, 'app/s/page.tsx')));
  assert.notDeepEqual(a.match, b.match, 'reglen binder den bogstavelige sti');
  // En gemt fil-regel (uden mappe) for [slug] må ikke tillade s.
  const noProject = { ...context };
  const file = { id: 'f', permission: 'read', metadata: { filepath: path.join(root, 'app/[slug]/page.tsx') }, patterns: [] };
  const ok = await policy.describe(noProject, file); assert.ok(ok.match);
  await policy.grant(noProject, file, { scope: 'project' });
  assert.equal((await policy.allowed(noProject, file)).allowed, true);
  assert.equal((await policy.allowed(noProject, { ...file, metadata: { filepath: path.join(root, 'app/s/page.tsx') } })).allowed, false);
});
// Fund 11 og brugerens beslutning 10. november 2026 («Fjern funktionen»): en kommando kan ikke huskes, heller ikke med kørende sandkasse.
test('fund 11: Tillad altid tilbydes aldrig for en kommando, heller ikke når sandkassen kører', async t => {
  const { root, policy, context } = await fixture(t);
  const bash = { id: 'b', permission: 'bash', patterns: ['npm test'], metadata: {}, toolInput: { tool: 'bash', command: 'npm test', workdir: root } };
  for (const commandSandbox of [false, undefined, true]) {
    assert.equal((await policy.describe({ ...context, commandSandbox }, bash)).persistable, false, String(commandSandbox));
    await assert.rejects(policy.grant({ ...context, commandSandbox }, bash, { scope: 'project' }), /én gang/, String(commandSandbox));
  }
});
