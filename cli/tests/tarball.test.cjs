// Tarballprøven (fund 41, 48 og 50 i gennemgangen af beta 3): CLI-pakken skal virke, som npm installerer den, og ikke kun fra repoet.
// Fra repoet findes desktop/node_modules, så de andre prøver kan ikke se, hvad pakken mangler. Her pakkes rodpakken med npm pack,
// arkivet udpakkes i en tom mappe og installeres med npm ci som beskrevet i udkastet til næste CLI-udgivelse.
// Motorens plugin-opstart og kommandobeskyttelsen køres fra den udpakkede, installerede pakke.
// npm henter pakkens afhængigheder fra registret eller fra npm's cache. Uden begge springes de prøver over, der kræver installationen.
// Den valgfrie OpenCode-motor hentes ikke; motorstarten bruger den låste motor fra repoet, hvis den findes.
// npm-shrinkwrap.json følger med arkivet, og pakken er installationens rod, så npm bruger både låsefil og overrides.
// npm 10.9.9 ignorerer shrinkwrap ved direkte installation af en lokal .tgz som afhængighed; den vej er ikke understøttet for næste CLI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createRequire } = require('node:module');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { unpack } = require('../../scripts/cli-release-contract.cjs');
const repo = path.join(__dirname, '..', '..');
const { VERSION } = require('../../desktop/core/engine.cjs');

// npm, som hører til den Node, der kører prøven.
function npmCli() {
  const bin = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath, path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const file = candidates.find(candidate => candidate && /npm-cli\.js$/.test(candidate) && fsSync.existsSync(candidate));
  if (!file) throw new Error('npm blev ikke fundet ved siden af den Node, der kører prøven.');
  return file;
}
const npm = (args, options = {}) => run(process.execPath, [npmCli(), ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 300000, ...options });

// Følg Nodes søgestier; pluginet har kun en import-eksport, så require.resolve(name) kan ikke bruges.
async function dependency(from, name) {
  for (const directory of from.resolve.paths(name) || []) {
    const file = path.join(directory, name, 'package.json');
    const manifest = await fs.readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (manifest?.name === name) return { manifest, require: createRequire(await fs.realpath(file)) };
  }
  throw new Error(`Manifestet for ${name} blev ikke fundet.`);
}

let base, archive, installed, unavailable = null;
before(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-tarball-')));
  const packed = path.join(base, 'pakke'), target = path.join(base, 'installation');
  await fs.mkdir(packed); await fs.mkdir(target);
  const { stdout } = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', packed], { cwd: repo });
  archive = path.join(packed, JSON.parse(stdout)[0].filename);
  installed = path.join(target, 'package');
  // Den kontrollerede udpakning svarer til tar -xzf: kun arkivets tilladte almindelige filer skrives i den nye mappe.
  for (const [name, content] of unpack(await fs.readFile(archive))) {
    const file = path.join(installed, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  // Den nye installationsvej, men uden den valgfrie OpenCode-motor; motorprøven bruger repoets låste motor.
  try { await npm(['ci', '--prefix', './package', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: target }); }
  catch (error) {
    // Uden net og uden pakkerne i npm's cache kan installationen ikke prøves her. Så springes de prøver over, der kræver den, med grunden.
    // Kun npm's egne fejlkoder for et register, der ikke kan nås, eller en pakke, der mangler i cachen offline, giver det. Alle andre fejl,
    // fx en afhængighed, registret ikke har (E404), er rigtige fejl.
    const code = /npm (?:error|ERR!) code (ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENOTCACHED)\b/.exec(`${error.stdout || ''}\n${error.stderr || ''}`)?.[1];
    if (!code) throw error;
    unavailable = `npm-registret kan ikke nås, og npm's cache mangler pakkens afhængigheder (${code}). Prøven kræver net eller en fyldt npm-cache.`;
  }
});
after(() => base && fs.rm(base, { recursive: true, force: true }));

test('npm-pakken følger CLI-kontrakten og får motorens plugin-SDK og kommandobeskyttelse som almindelige afhængigheder', async () => {
  const files = unpack(await fs.readFile(archive));
  assert.ok(files.has('desktop/core/engine.cjs') && files.has('desktop/core/command-sandbox-runner.mjs'));
  assert.ok(![...files.keys()].some(name => name.includes('node_modules')), 'afhængighederne pakkes ikke ind i arkivet');
  const own = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const desktop = JSON.parse(await fs.readFile(path.join(repo, 'desktop', 'package.json'), 'utf8'));
  // De direkte afhængigheder har samme præcise versioner som desktopappen, så CLI'en og appen starter den samme motor med det samme
  // plugin-SDK. Den publicerbare låsefil skal være identisk med den kontrollerede kildefil.
  for (const name of ['@opencode-ai/plugin', '@anthropic-ai/sandbox-runtime']) assert.equal(own.dependencies?.[name], desktop.dependencies[name], name);
  assert.equal(own.dependencies['@opencode-ai/plugin'], VERSION);
  assert.ok(files.has('npm-shrinkwrap.json'), 'den transitive låsefil kommer med i npm-pakken');
  assert.deepEqual(files.get('npm-shrinkwrap.json'), await fs.readFile(path.join(repo, 'npm-shrinkwrap.json')));
  assert.deepEqual(JSON.parse(files.get('npm-shrinkwrap.json')).packages[''].dependencies, own.dependencies);
});

test('den udpakkede CLI beholder sikkerhedsrettelserne fra shrinkwrap efter npm ci i pakkens rod', async t => {
  if (unavailable) return t.skip(unavailable);
  const lock = JSON.parse(await fs.readFile(path.join(installed, 'npm-shrinkwrap.json'), 'utf8'));
  const request = createRequire(path.join(installed, 'package.json'));
  const plugin = await dependency(request, '@opencode-ai/plugin');
  const sandbox = await dependency(request, '@anthropic-ai/sandbox-runtime');
  const effect = await dependency(plugin.require, 'effect');
  const resolved = [effect, await dependency(effect.require, 'toml'), await dependency(plugin.require, 'zod'),
    await dependency(sandbox.require, 'node-forge'), await dependency(sandbox.require, 'zod')];
  for (const { manifest: { name, version } } of resolved) {
    const locked = new Set(Object.entries(lock.packages).filter(([file]) => file === `node_modules/${name}` || file.endsWith(`/node_modules/${name}`)).map(([, pkg]) => pkg.version));
    assert.ok(locked.has(version), `${name}@${version} skal være en af de kontrollerede versioner: ${[...locked].join(', ')}`);
  }
  // sandbox-runtime bruger fortsat v3-API'et. Den rettede Zod-pakke skal bevare denne indgang.
  const { z } = sandbox.require('zod/v3');
  assert.deepEqual(z.object({ command: z.string() }).parse({ command: 'syntetisk' }), { command: 'syntetisk' });
});

test('motorens plugin-opstart lykkes fra den installerede pakke', async t => {
  if (unavailable) return t.skip(unavailable);
  const engine = require(path.join(installed, 'desktop', 'core', 'engine.cjs'));
  const directory = await fs.mkdtemp(path.join(base, 'motor-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await engine.writePluginRuntime(directory); await engine.writePluginRuntime(directory);
  for (const folder of [path.join(directory, 'config'), path.join(directory, 'config', 'opencode')]) {
    const sdk = JSON.parse(await fs.readFile(path.join(folder, 'node_modules', '@opencode-ai', 'plugin', 'package.json'), 'utf8'));
    assert.equal(sdk.version, VERSION);
  }
  // Pakkereglerne til desktopappen finder stadig SDK'et og dets afhængigheder.
  assert.ok((await engine.pluginRuntimeFiles()).some(folder => folder.endsWith(path.join('@opencode-ai', 'sdk'))));
});

// core/chat-session.cjs kræver ui/approval-view.js. Manglede filen i pakken, kunne terminalen ikke indlæse workbench (fund efter G1 og G2).
test('terminalens kerne (workbench og chat-session) kan indlæses fra den installerede pakke', async t => {
  if (unavailable) return t.skip(unavailable);
  for (const file of ['chat-session.cjs', 'workbench.cjs']) assert.doesNotThrow(() => require(path.join(installed, 'desktop', 'core', file)), file);
  assert.equal(typeof require(path.join(installed, 'cli', 'app.cjs')).Application, 'function');
});

test('AI-motoren starter fra den installerede pakke', async t => {
  if (unavailable) return t.skip(unavailable);
  let executable;
  try { executable = await require('../../desktop/core/engine.cjs').findExecutable({ timeout: 60000 }); }
  catch { return t.skip(`OpenCode ${VERSION} findes ikke på denne computer. Kør npm run runtime:prepare i desktop/.`); }
  const { OpenCodeEngine } = require(path.join(installed, 'desktop', 'core', 'engine.cjs'));
  const project = await fs.mkdtemp(path.join(base, 'projekt-')), directory = await fs.mkdtemp(path.join(base, 'motor-'));
  const previous = process.env.HARNESS_OPENCODE_PATH; process.env.HARNESS_OPENCODE_PATH = executable;
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Prøve', options: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'ikke-en-rigtig-noegle' }, models: { model: { name: 'model', tool_call: true, limit: { context: 32768, output: 4096 } } } };
  const engine = new OpenCodeEngine({ root: project, directory, provider, model: { id: 'model' }, mode: 'build', startTimeout: 120000 });
  try { assert.match(await engine.start(), /^ses_/); }
  finally { await engine.close(); if (previous === undefined) delete process.env.HARNESS_OPENCODE_PATH; else process.env.HARNESS_OPENCODE_PATH = previous; }
});

test('kommandobeskyttelsen kan starte fra den installerede pakke, som den kan fra repoet', { skip: !['darwin', 'linux'].includes(process.platform) && 'Kommandobeskyttelsen findes kun på macOS og Linux.' }, async t => {
  if (unavailable) return t.skip(unavailable);
  const runner = path.join(installed, 'desktop', 'core', 'command-sandbox-runner.mjs');
  // Samme miljø som command-sandbox.cjs bruger til kontrollen. Runneren skal kunne indlæse sandbox-runtime fra pakkens afhængigheder;
  // om computeren har sandkassens egne programmer (fx bubblewrap på Linux), er en anden sag.
  let output, checked = null;
  try { output = (await run(process.execPath, [runner, '--check'], { timeout: 20000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', LANG: 'en_US.UTF-8' } })).stdout; checked = JSON.parse(output); }
  catch (error) { output = `${error.stdout || ''}${error.stderr || ''}${error.message}`; }
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find package/);
  if (checked) assert.ok(Array.isArray(checked.errors));
  // Kan kommandobeskyttelsen starte fra repoet på denne computer, skal den også kunne fra pakken.
  const fromRepo = await require('../../desktop/core/command-sandbox.cjs').support();
  if (fromRepo.available) assert.equal((await require(path.join(installed, 'desktop', 'core', 'command-sandbox.cjs')).support()).available, true);
});

test('en isoleret kommando kører fra den installerede pakke', async t => {
  if (unavailable) return t.skip(unavailable);
  const sandbox = require(path.join(installed, 'desktop', 'core', 'command-sandbox.cjs'));
  if (!(await require('../../desktop/core/command-sandbox.cjs').support()).available) return t.skip('Kommandobeskyttelsen kan ikke starte på denne computer.');
  const work = await fs.mkdtemp(path.join(base, 'isoleret-')), root = path.join(work, 'projekt'), scratch = path.join(work, 'scratch');
  await fs.mkdir(root); await fs.mkdir(scratch);
  const configured = await sandbox.prepare({ workspaceRoot: root, scratchRoot: scratch, directory: path.join(work, 'policy') });
  assert.equal(configured.runner, path.join(await fs.realpath(installed), 'desktop', 'core', 'command-sandbox-runner.mjs'));
  const payload = Buffer.from(JSON.stringify({ command: 'echo hej | tr a-z A-Z', cwd: configured.workspaceRoot })).toString('base64url');
  const { stdout } = await run(configured.node, [configured.runner, configured.policyPath, payload], { cwd: root, timeout: 60000, env: { PATH: process.env.PATH } });
  assert.equal(stdout.trim(), 'HEJ');
});
