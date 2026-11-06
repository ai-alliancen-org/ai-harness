const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const sandbox = require('../core/command-sandbox.cjs');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-sandbox-test-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), scratch = path.join(base, 'scratch'), other = path.join(base, 'andet');
  await Promise.all([root, scratch, other].map(file => fs.mkdir(file)));
  const configured = await sandbox.prepare({ workspaceRoot: root, scratchRoot: scratch, directory: path.join(base, 'policy') });
  const execute = async (command, cwd = root) => {
    const payload = Buffer.from(JSON.stringify({ command, cwd })).toString('base64url');
    try { const result = await run(configured.node, [configured.runner, configured.policyPath, payload], { cwd: root, timeout: 30000, env: { PATH: process.env.PATH, OPENCODE_CONFIG_CONTENT: 'SYNTETISK-MODELNØGLE', ANTHROPIC_API_KEY: 'SYNTETISK-UDVIDER' } }); return { ...result, code: 0 }; }
    catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
  };
  return { root, scratch, other, configured, execute };
}
test('Windows afviser automatisk isolation uden usikret reservevej', async () => {
  assert.equal((await sandbox.support({ platform: 'win32' })).available, false);
});
test('betroet plugin wrapper bash, validerer cwd og viser kun faste pakkehosts', async t => {
  if (!['darwin', 'linux'].includes(process.platform)) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t), plugin = await import(f.configured.pluginURL), hooks = await plugin.AuraCommandIsolation();
  const input = { args: { command: 'echo "$(touch forkert)"', workdir: f.root } };
  await hooks['tool.execute.before']({ tool: 'bash' }, input);
  assert.match(input.args.command, /^exec \/usr\/bin\/env -i /);
  assert.equal(input.args.command.includes('touch forkert'), false);
  await assert.rejects(hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'true', workdir: f.other } }), /uden for/);
  const policy = JSON.parse(await fs.readFile(f.configured.policyPath));
  assert.deepEqual(policy.config.network.allowedDomains, sandbox.PACKAGE_HOSTS);
  assert.equal(policy.config.network.strictAllowlist, true);
});
test('rigtig OS-isolation tillader projektarbejde og spærrer hemmeligheder, andre mapper, symlinks og arvede nøgler', async t => {
  if (!['darwin', 'linux'].includes(process.platform)) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  await fs.writeFile(path.join(f.other, 'hemmelig.txt'), 'SYNTETISK-HEMMELIGHED');
  await fs.writeFile(path.join(f.root, '.env'), 'SYNTETISK-PROJEKTNØGLE');
  await fs.mkdir(path.join(f.root, 'secrets')); await fs.writeFile(path.join(f.root, 'secrets', 'nøgle.txt'), 'SYNTETISK-NØGLE');
  await fs.symlink(f.other, path.join(f.root, 'genvej'));
  const script = `const fs = require('node:fs'); const cp = require('node:child_process'); const checks = {}; for (const [name,file] of Object.entries(${JSON.stringify({ outside: path.join(f.other, 'hemmelig.txt'), env: path.join(f.root, '.env'), secret: path.join(f.root, 'secrets', 'nøgle.txt'), symlink: path.join(f.root, 'genvej', 'hemmelig.txt') })})) { try { checks[name] = fs.readFileSync(file,'utf8'); } catch { checks[name] = 'denied'; } } for (const [name,file] of Object.entries(${JSON.stringify({ outsideWrite: path.join(f.other, 'skrevet.txt'), symlinkWrite: path.join(f.root, 'genvej', 'skrevet.txt') })})) { try { fs.writeFileSync(file,'forkert'); checks[name] = 'allowed'; } catch { checks[name] = 'denied'; } } checks.credentials = Boolean(process.env.OPENCODE_CONFIG_CONTENT || process.env.ANTHROPIC_API_KEY); checks.child = cp.spawnSync('/bin/cat',[${JSON.stringify(path.join(f.other, 'hemmelig.txt'))}],{encoding:'utf8'}).status; fs.writeFileSync('resultat.json',JSON.stringify(checks)); fs.writeFileSync(${JSON.stringify(path.join(f.scratch, 'ok.txt'))},'ok'); console.log('projektarbejde udført');`;
  await fs.writeFile(path.join(f.root, 'angreb.cjs'), script);
  const result = await f.execute(`${quote(f.configured.node)} angreb.cjs`);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /projektarbejde/);
  const checks = JSON.parse(await fs.readFile(path.join(f.root, 'resultat.json')));
  for (const key of ['outside', 'env', 'secret', 'symlink', 'outsideWrite', 'symlinkWrite']) assert.equal(checks[key], 'denied', key);
  assert.equal(checks.credentials, false); assert.notEqual(checks.child, 0);
  await assert.rejects(fs.access(path.join(f.other, 'skrevet.txt')));
  assert.equal(await fs.readFile(path.join(f.scratch, 'ok.txt'), 'utf8'), 'ok');
});
test('rigtig netværksisolation afviser net uden for pakkeregistrene (loopback er lukket, se b1-sandkasse)', async t => {
  if (!['darwin', 'linux'].includes(process.platform)) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  const result = await f.execute('/usr/bin/curl --max-time 5 --fail --silent --show-error https://example.com');
  assert.notEqual(result.code, 0); assert.match(result.stderr, /403|denied|refused|beskyttelse|isolation/i);
  const direct = await f.execute('/usr/bin/curl --noproxy "*" --max-time 3 --fail --silent --show-error http://127.0.0.1:9');
  // Port 9 lytter ingen på, så forbindelsen afvises af maskinen; loopback er lukket (b1-sandkasse), så forbindelsen afvises uanset porten.
  assert.notEqual(direct.code, 0);
});
test('npm installerer en fast pakke i projektet gennem det tilladte register', async t => {
  if (!['darwin', 'linux'].includes(process.platform)) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'syntetisk-isolationsprove', version: '1.0.0', private: true }));
  const result = await f.execute('npm install --ignore-scripts --no-audit --no-fund --package-lock=false --fetch-retries=0 --fetch-timeout=6000 is-number@7.0.0');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'node_modules/is-number/package.json'))).version, '7.0.0');
});
test('pakkens installationsscript og underprocesser har samme filgrænse', async t => {
  if (!['darwin', 'linux'].includes(process.platform)) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  await fs.writeFile(path.join(f.other, 'hemmelig.txt'), 'SYNTETISK-PAKKEHEMMELIGHED');
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'syntetisk-pakkescript', version: '1.0.0', private: true, scripts: { postinstall: 'node postinstall.cjs' } }));
  await fs.writeFile(path.join(f.root, 'postinstall.cjs'), `const fs=require('node:fs');let read=false,write=false;try{fs.readFileSync(${JSON.stringify(path.join(f.other, 'hemmelig.txt'))});read=true}catch{}try{fs.writeFileSync(${JSON.stringify(path.join(f.other, 'forkert.txt'))},'forkert');write=true}catch{}fs.writeFileSync('pakkescript-resultat.json',JSON.stringify({read,write}));`);
  const result = await f.execute('npm install --offline --no-audit --no-fund');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, 'pakkescript-resultat.json'))), { read: false, write: false });
});
