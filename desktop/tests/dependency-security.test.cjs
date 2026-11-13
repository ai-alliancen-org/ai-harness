const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const semver = require('semver');

// Kontroller de pakker, pluginet og sandkassen faktisk finder, også hvis npm flytter dem til en nested mappe.
// Pluginet har kun en import-eksport; søgestierne virker også uden en require-eksport til dets indgang.
function dependency(from, name) {
  for (const directory of from.resolve.paths(name) || []) {
    const file = path.join(directory, name, 'package.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (manifest.name === name) return { manifest, require: createRequire(fs.realpathSync(file)) };
  }
  throw new Error(`Afhængigheden ${name} blev ikke fundet.`);
}
const request = createRequire(path.join(__dirname, '..', 'package.json'));
const plugin = dependency(request, '@opencode-ai/plugin');
const sandbox = dependency(request, '@anthropic-ai/sandbox-runtime');
const effect = dependency(plugin.require, 'effect');
const toml = dependency(effect.require, 'toml');
const zod = dependency(plugin.require, 'zod');

test('motorens og sandkassens installerede afhængigheder har de rettede sikkerhedsversioner', () => {
  const dependencies = [[effect, '4.0.0-beta.103'], [toml, '5.0.1'], [zod, '4.6.6'],
    [dependency(sandbox.require, 'zod'), '4.6.6'], [dependency(sandbox.require, 'node-forge'), '1.4.3']];
  for (const [{ manifest: { name, version } }, minimum] of dependencies) {
    assert.ok(semver.gte(version, minimum), `${name}@${version} skal være mindst ${minimum}`);
  }
  // sandbox-runtime bruger v3-API'et, som fortsat findes i den rettede Zod 4-pakke.
  const { z } = sandbox.require('zod/v3');
  assert.deepEqual(z.object({ command: z.string() }).parse({ command: 'syntetisk' }), { command: 'syntetisk' });
});

test('GHSA-h895-cgqg-jf52: TOML kan ikke skrive gennem Date til Object.prototype', () => {
  // Advisoryens fire linjer køres i en tids- og hukommelsesbegrænset proces, så en regression ikke forurener testsuiten.
  const payload = '"b.c" = 1979-05-27T07:32:00Z\n[[\'"b\']]\n["b.c"]\n__proto__.__proto__.auraTomlSecurityProbe = "yes"\n';
  const source = `
    const assert = require('node:assert/strict');
    const toml = require(process.argv[1]);
    assert.equal(Object.hasOwn(Object.prototype, 'auraTomlSecurityProbe'), false);
    assert.throws(() => toml.parse(${JSON.stringify(payload)}));
    assert.equal(Object.hasOwn(Object.prototype, 'auraTomlSecurityProbe'), false);
    assert.equal(({}).auraTomlSecurityProbe, undefined);
    console.log('safe');
  `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', source, toml.require.resolve('toml')],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
  assert.equal(child.stdout.trim(), 'safe');
});

test('GHSA-chp3-j5qr-2vfr: Effect afviser cookie-attributter indsat gennem navn, domæne eller sti', async () => {
  const Cookies = await import(pathToFileURL(effect.require.resolve('effect/unstable/http/Cookies')).href);
  const cases = [
    ['session; SameSite=None', {}, 'InvalidCookieName'],
    ['session', { domain: 'legit.com; Domain=.parent.tld' }, 'InvalidCookieDomain'],
    ['session', { path: '/; SameSite=None' }, 'InvalidCookiePath']
  ];
  for (const [name, options, reason] of cases) {
    const result = Cookies.makeCookie(name, 'syntetisk', options);
    assert.equal(result._tag, 'Failure', reason);
    assert.equal(result.failure.reason._tag, reason);
  }
  const valid = Cookies.makeCookieUnsafe('session', 'syntetisk', { domain: 'example.test', path: '/', httpOnly: true });
  assert.equal(Cookies.serializeCookie(valid), 'session=syntetisk; Domain=example.test; Path=/; HttpOnly');
});

test('GHSA-mrhx-c7xc-m3w5: Zod afviser en for stor samling før elementer og fejl ophobes', () => {
  const { z } = zod.require('zod');
  let visits = 0;
  const item = z.preprocess(value => { visits++; return value; }, z.string());
  const schema = z.array(item).max(2);
  const result = schema.safeParse(Array(64).fill(null));
  assert.equal(result.success, false);
  assert.equal(visits, 0, 'størrelsesgrænsen skal stoppe før validering af hvert ugyldigt element');
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
  // Elementvalideringen skal stadig ske for en samling inden for grænsen.
  assert.deepEqual(schema.parse(['syntetisk']), ['syntetisk']);
  assert.equal(visits, 1);
});
