'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, scan } = require('../core/secrets.cjs');

// Hver fixture har en tekst og de dele, der aldrig må stå tilbage efter rensning.
const fixtures = [
  ['Bearer-hoved', 'Authorization: Bearer abcDEF123456xyz789', ['abcDEF123456xyz789']],
  ['Bearer-hoved kort', 'authorization: Bearer abc', ['Bearer abc']],
  ['Bearer i JSON-hoved', '{"Authorization":"Bearer t0kenVaerdi9876"}', ['t0kenVaerdi9876']],
  ['Bearer uden hoved', 'curl -H "x: y" Bearer zzYY99887766aabb', ['zzYY99887766aabb']],
  ['x-api-key', 'x-api-key: kvLm3920pQrs', ['kvLm3920pQrs']],
  ['x-api-key i curl', "curl -H 'x-api-key: kvLm3920pQrs' https://api.example.dk", ['kvLm3920pQrs']],
  ['OPENAI_API_KEY', 'OPENAI_API_KEY=hemmeligVaerdi4711', ['hemmeligVaerdi4711']],
  ['GITHUB_TOKEN', 'GITHUB_TOKEN=abc123def456', ['abc123def456']],
  ['DB_PASSWORD', 'DB_PASSWORD=hunter2', ['hunter2']],
  ['CLIENT_SECRET i anførselstegn', 'CLIENT_SECRET="med mellemrum 42"', ['med mellemrum 42']],
  ['SECRET med enkelt anførsel', "APP_SECRET='abc def ghi 7'", ['abc def ghi 7']],
  ['JSON token', '{"token":"jsonTokenVaerdi123"}', ['jsonTokenVaerdi123']],
  ['JSON password', '{"password":"p4ssw0rd!x"}', ['p4ssw0rd!x']],
  ['JSON api_key', '{"api_key":"apiNoegle7788"}', ['apiNoegle7788']],
  ['JSON alle tre', '{"token":"aaa111bbb","password":"ccc222ddd","api_key":"eee333fff"}', ['aaa111bbb', 'ccc222ddd', 'eee333fff']],
  ['JSON med escapede anførselstegn', '"{\\"token\\":\\"escapedTok999\\"}"', ['escapedTok999']],
  ['sk-nøgle', 'brug sk-proj-abcdefghijklmnop1234', ['sk-proj-abcdefghijklmnop1234']],
  ['sk-ant-nøgle', 'sk-ant-api03-AbCdEfGhIjKlMnOp', ['sk-ant-api03-AbCdEfGhIjKlMnOp']],
  ['AWS-nøgle', 'aws id AKIAIOSFODNN7EXAMPLE her', ['AKIAIOSFODNN7EXAMPLE']],
  ['ghp_', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', ['ghp_abcdefghijklmnopqrstuvwxyz0123456789']],
  ['gho_', 'gho_abcdefghijklmnopqrstuvwxyz0123456789', ['gho_abcdefghijklmnopqrstuvwxyz0123456789']],
  ['github_pat_', 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuv', ['github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuv']],
  ['komp_publish_grant_', 'komp_publish_grant_' + 'a1'.repeat(32), ['komp_publish_grant_']],
  ['komp_publish_ hex', 'komp_publish_' + 'b2'.repeat(32), ['komp_publish_']],
  ['kp_live_', 'kp_live_' + 'Ab1_-'.repeat(9), ['kp_live_']],
  ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', ['eyJhbGciOiJIUzI1NiJ9', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r']],
  ['URL med bruger:kode', 'git clone https://bjorn:s3kretKode@github.com/x/y.git', ['s3kretKode', 'bjorn:']],
  ['postgres-URL', 'postgres://admin:pw99@db.example.dk:5432/app', ['pw99', 'admin']],
  ['privat nøgle', '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7x\nabcdef\n-----END RSA PRIVATE KEY-----', ['MIIEowIBAAKCAQEA7x', 'abcdef']],
  ['privat nøgle uden slutlinje', '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg', ['MIIEvQIBADANBg']],
  ['lang tilfældig nøgle efter nøglelignende variabel', 'SERVICE_KEY=Zk3pQ9vL2mXa8RtYb5NcW7HdJf1GsUe4OiAxCvBn', ['Zk3pQ9vL2mXa8RtYb5NcW7HdJf1GsUe4OiAxCvBn']],
  ['lang tilfældig nøgle med lowercase navn', 'api_key: Zk3pQ9vL2mXa8RtYb5NcW7HdJf1GsUe4OiAxCvBn', ['Zk3pQ9vL2mXa8RtYb5NcW7HdJf1GsUe4OiAxCvBn']],
  ['lang tilfældig nøgle helt uden præfiks', 'fejlen var Zk3pQ9vL2mXa8RtYb5NcW7HdJf1GsUe4OiAxCvBn i svaret', ['Zk3pQ9vL2mXa8RtYb5NcW7HdJf1GsUe4OiAxCvBn']],
  ['token i URL-parameter', 'GET /v1/data?token=abc123XYZ&side=2', ['abc123XYZ']],
  ['apiKey i camelCase', 'const cfg = { apiKey: "abcd1234efgh" }', ['abcd1234efgh']],
  ['password med mellemrum og lighedstegn', 'password = hunter22', ['hunter22']],
  ['Slack-token', 'xoxb-1234567890-abcdefghij', ['xoxb-1234567890-abcdefghij']]
];

// Almindelig tekst og kode uden hemmeligheder skal stå uændret.
const harmless = [
  'Vi bruger ordet token i en sætning om tokens ind og ud.',
  'Bearer authentication er en metode, og bearer tokens beskrives i dokumentationen.',
  'Indtast din adgangskode i feltet og tryk Gem. Nøgle: se vejledningen.',
  'const token = await hentToken();',
  'const password = getPassword();',
  'function check(apiKey) { return apiKey ? process.env.API_KEY : null; }',
  'password: string;',
  'const key = "navn"; const map = { key: value };',
  'API_KEY=<din nøgle her>',
  'token: null',
  'git commit 3f786850e387550fdab836ed7e6dc881de23001b er en hash',
  'sti /Users/bjorn/GitHub/os_harness/desktop/core/secrets.cjs åbnet',
  'risk-assessment og disk-usage-report er almindelige ord',
  'https://example.dk/side?x=1 og https://github.com/a/b.git',
  'max_tokens: 1000 og primary_key=id',
  'En almindelig dansk sætning med komma, punktum og tal 12345.'
];

function check(redactFn, [name, input, parts]) {
  const out = redactFn(input);
  for (const part of parts) {
    if (out.includes(part)) throw new Error(`${name}: "${part}" står tilbage i "${out}"`);
  }
  if (!out.includes('[skjult]')) throw new Error(`${name}: ingen [skjult] i "${out}"`);
}

test('hver fixture skjules helt og meldes af scan uden værdier', () => {
  for (const fixture of fixtures) {
    check(redact, fixture);
    const found = scan(fixture[1]);
    assert.ok(found.length > 0, `${fixture[0]}: scan fandt intet`);
    for (const part of fixture[2]) assert.ok(!JSON.stringify(found).includes(part), `${fixture[0]}: scan røber værdi`);
  }
});

test('hver fixture fejler mod en tom redact, så prøven kan fejle', () => {
  const empty = text => text;
  for (const fixture of fixtures) assert.throws(() => check(empty, fixture), undefined, `${fixture[0]} bestod mod tom redact`);
});

test('almindelig tekst og kode uden hemmeligheder står uændret', () => {
  for (const text of harmless) {
    assert.equal(redact(text), text, `ødelagt: ${text}`);
    assert.deepEqual(scan(text), [], `falsk fund: ${text}`);
  }
});

test('Bearer-tokenet selv skjules, ikke kun ordet', () => {
  const out = redact('Authorization: Bearer abcDEF123456xyz789');
  assert.equal(out, 'Authorization: Bearer [skjult]');
});

test('rensning er idempotent og tåler ikke-tekst', () => {
  for (const fixture of fixtures) { const once = redact(fixture[1]); assert.equal(redact(once), once, fixture[0]); }
  assert.equal(redact(undefined), '');
  assert.equal(redact(null), '');
  assert.equal(redact(42), '42');
});

// Vagten mod katastrofal tilbagesporing måler processens egen CPU-tid, ikke vægurets tid, og tager den bedste af højst tre kørsler.
// Under parallel belastning (fx hele suiten) kunne vægurets tid ellers nå over 200 ms uden en rigtig fejl (spor P, beta 3). Et mønster,
// der sporer katastrofalt tilbage, bruger CPU-tiden selv og er langsomt hver gang, så vagten fyrer stadig.
const cpuMs = fn => { const start = process.cpuUsage(); fn(); const used = process.cpuUsage(start); return (used.user + used.system) / 1000; };
const bestOf = (fn, limit) => { let best = Infinity; for (let i = 0; i < 3 && best >= limit; i++) best = Math.min(best, cpuMs(fn)); return best; };
test('1 MB gentaget input behandles på under 200 ms CPU-tid pr. mønster', () => {
  const inputs = [
    ...fixtures.map(f => [f[0], f[1]]),
    ...harmless.map((t, i) => ['harmløs ' + i, t]),
    ['punktummer', 'a.a.a.a.'], ['bindestreger', 'a-a-a-a-'], ['understreger', 'ab_'], ['KEY og citat', 'KEY="'],
    ['URL uden slut', 'https://a:'], ['kolon-kæde', 'x:y:z:'], ['BEGIN uden slut', '-----BEGIN PRIVATE KEY-----'],
    ['Bearer-gentagelse', 'Bearer a'], ['lang række', 'aB3'], ['token uden værdi', 'token=']
  ];
  for (const [name, unit] of inputs) {
    const big = (unit + ' ').repeat(Math.ceil(1024 * 1024 / (unit.length + 1)));
    const ms = bestOf(() => redact(big), 200);
    assert.ok(ms < 200, `${name}: ${ms.toFixed(0)} ms CPU-tid`);
  }
});
