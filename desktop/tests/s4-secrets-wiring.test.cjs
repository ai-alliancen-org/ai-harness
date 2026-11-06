// Fund 4: den fælles rensning er koblet på de rensere, som komplai-sporet ejer (connections, git, pages-publishing).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const connections = require('../core/connections.cjs');
const { secretContent } = require('../core/git.cjs');
const { verifyMaterial } = require('../core/pages-publishing.cjs');

const GRANT = 'komp_publish_grant_' + 'a1'.repeat(32);
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

test('S4-4: connections.redact skjuler Authorization-hoved, KEY=værdi, JWT og privat nøgle', () => {
  const secret = 'Zx9Qm3Tp7Vb2Nk5Ld8Hs1Jf4Gc6Rw0Ya';
  for (const text of [`Authorization: Bearer ${secret}`, `MIN_API_KEY=${secret}`, `{"password": "hemmelig-værdi-123"}`, `token ${JWT}`, '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', `fejl ${GRANT}`, `postgres://bruger:kodeord123@db.example.invalid/x`]) {
    const out = connections.redact(text);
    for (const part of [secret, 'hemmelig-værdi-123', JWT, 'abc\n', GRANT, 'kodeord123']) assert.ok(!out.includes(part), `${part} står stadig i: ${out}`);
  }
});

test('S4-4: connections.redact bevarer eksisterende adfærd og harmløs tekst', () => {
  assert.equal(connections.redact('Udbyderen svarede 401: modellen findes ikke.'), 'Udbyderen svarede 401: modellen findes ikke.');
  assert.match(connections.redact('Authorization: Bearer sk-abcdefghij123456'), /Authorization: Bearer/);
  assert.ok(!connections.redact('x sk-abcdefghij123456 y').includes('sk-abcdefghij'));
  assert.ok(!connections.redact('nøgle ' + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0123456789').includes('abcdefghijklmnop'));
});

test('S4-4: git.secretContent spærrer komplais udgivelsesadgang, JWT og URL med kodeord, men ikke almindelig kode', () => {
  assert.equal(secretContent(`const g = '${GRANT}';`), true);
  assert.equal(secretContent(`const t = "${JWT}";`), true);
  assert.equal(secretContent('const u = "postgres://bruger:kodeord123@db.example.invalid/x";'), true);
  assert.equal(secretContent('-----BEGIN RSA PRIVATE KEY-----\nabc'), true);
  assert.equal(secretContent('const token = await hentToken();\nconst apiKey = process.env.KEY;\nfunction x() { return 1; }\n'), false);
});

test('S4-4: workflowets verifyMaterial afviser komplais udgivelsesadgang i filerne', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-s4-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'w'), runner = path.join(root, 'r'), sha = 'a'.repeat(40);
  await fs.mkdir(path.join(workspace, 'public'), { recursive: true }); await fs.mkdir(runner);
  await fs.writeFile(path.join(workspace, 'public/index.html'), `<p>${GRANT}</p>`);
  const env = { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runner, GITHUB_SHA: sha, REVIEWED_SHA: sha, REVIEWED_HASH: 'b'.repeat(64), AURA_DIRECTORY: 'public' };
  await assert.rejects(verifyMaterial(env), /hemmelighed/);
});
