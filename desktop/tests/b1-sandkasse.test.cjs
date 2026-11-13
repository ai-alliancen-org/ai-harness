// Spor B1: localhost, git og den oprindelige kommando i sandkassen. Prøverne kører rigtige kommandoer i den rigtige isolation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const sandbox = require('../core/command-sandbox.cjs');
const { toolEntry, approvalTarget } = require('../core/activity.cjs');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const supported = ['darwin', 'linux'].includes(process.platform);
async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-b1-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'), scratch = path.join(base, 'scratch');
  await Promise.all([root, scratch].map(file => fs.mkdir(file)));
  const configured = await sandbox.prepare({ workspaceRoot: root, scratchRoot: scratch, directory: path.join(base, 'policy') });
  const execute = async (command, cwd = root) => {
    const payload = Buffer.from(JSON.stringify({ command, cwd })).toString('base64url');
    try { return { ...(await run(configured.node, [configured.runner, configured.policyPath, payload], { cwd: root, timeout: 40000, env: { PATH: process.env.PATH } })), code: 0 }; }
    catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
  };
  return { root, scratch, configured, execute };
}

test('9a (ændret af skeptiker 1): loopback er lukket, så en kommando hverken kan lytte eller forbinde lokalt', async t => {
  if (!supported) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'lokal.cjs'), `require('node:http').createServer().listen(0,'127.0.0.1',()=>{console.log('LYTTER');process.exit(0)}).on('error',e=>{console.log('AFVIST '+e.code);process.exit(3)});`);
  const result = await f.execute(`${quote(f.configured.node)} lokal.cjs`);
  assert.notEqual(result.code, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /LYTTER/);
});

test('9a: en fremmed adresse nås ikke', async t => {
  if (!supported) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'ude.cjs'), `const c=require('node:net').connect({host:'93.184.216.34',port:80,timeout:3000});c.on('connect',()=>{console.log('FORBUNDET');process.exit(0)});c.on('error',e=>{console.log('AFVIST '+e.code);process.exit(1)});c.on('timeout',()=>{console.log('AFVIST tid');process.exit(1)});`);
  const outside = await f.execute(`${quote(f.configured.node)} ude.cjs`);
  assert.notEqual(outside.code, 0, outside.stdout);
  assert.doesNotMatch(outside.stdout, /FORBUNDET/);
});

test('9b: git status og git log virker i sandkassen, men .git/hooks kan ikke skrives', async t => {
  if (!supported) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  const git = (args, cwd = f.root) => run('/usr/bin/git', args, { cwd, env: { PATH: '/usr/bin:/bin', HOME: f.scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } });
  await git(['init', '-q']); await fs.writeFile(path.join(f.root, 'a.txt'), 'a'); await git(['add', 'a.txt']); await git(['commit', '-q', '-m', 'første']);
  await fs.writeFile(path.join(f.root, 'b.txt'), 'b');
  const status = await f.execute('git status --short');
  assert.equal(status.code, 0, status.stderr); assert.match(status.stdout, /b\.txt/);
  const log = await f.execute('git log -1 --format=%s');
  assert.equal(log.code, 0, log.stderr); assert.match(log.stdout, /første/);
  const hook = await f.execute('echo "#!/bin/sh" > .git/hooks/pre-commit');
  assert.notEqual(hook.code, 0, 'sandkassen må ikke kunne skrive en git-hook');
  await assert.rejects(fs.access(path.join(f.root, '.git', 'hooks', 'pre-commit')));
});

test('9b: git åbner ikke for flere stier: ingen /var, /etc eller /private/etc i læselisten, og miljøet peger på Command Line Tools', async t => {
  for (const file of ['/var', '/etc', '/private/var', '/private/etc', '/Library/Developer', '/var/select', '/private/var/select']) assert.equal(sandbox.DARWIN_SYSTEM_READ.includes(file), false, file);
  if (process.platform !== 'darwin') return t.skip('Kun macOS.');
  const f = await fixture(t), policy = JSON.parse(await fs.readFile(f.configured.policyPath));
  assert.equal(policy.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(policy.env.DEVELOPER_DIR, '/Library/Developer/CommandLineTools');
  assert.deepEqual(policy.config.filesystem.allowWrite.map(entry => entry.path).sort(), [f.root, f.scratch, path.join(path.dirname(f.configured.policyPath), '..', 'home')].map(file => path.resolve(file)).sort());
  assert.ok(policy.config.filesystem.denyWrite.some(pattern => /\[gG\]\[iI\]\[tT\]/.test(pattern)), '.git skal stadig være spærret for skrivning');
});

test('9c: Aktivitet viser den oprindelige kommando, ikke den indpakkede', async t => {
  if (!supported) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t), plugin = await import(f.configured.pluginURL), hooks = await plugin.AuraCommandIsolation();
  const original = `echo 'hej' && git status "æ ø"`;
  const input = { args: { command: original, workdir: f.root } };
  await hooks['tool.execute.before']({ tool: 'bash' }, input);
  assert.match(input.args.command, /^exec \/usr\/bin\/env -i /);
  const entry = toolEntry({ id: 'p1', tool: 'bash', state: { status: 'running', input: { command: input.args.command }, metadata: {} } }, f.root);
  assert.equal(entry.target, original);
  assert.equal(approvalTarget({ permission: 'bash', metadata: { command: input.args.command }, patterns: [input.args.command] }, f.root), original);
  const plain = toolEntry({ id: 'p2', tool: 'bash', state: { status: 'completed', input: { command: 'ls -la' } } }, f.root);
  assert.equal(plain.target, 'ls -la');
});

test('B1-skeptiker 1: en tjeneste på maskinens loopback uden for sandkassen kan ikke nås fra en kommando', async t => {
  if (!supported) return t.skip('Denne platforms isolation understøttes ikke.');
  const f = await fixture(t);
  const host = require('node:http').createServer((_q, r) => r.end('HOSTSECRET'));
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  t.after(() => host.close());
  const port = host.address().port;
  await fs.writeFile(path.join(f.root, 'vaert.cjs'), `const c=require('node:net').connect({host:'127.0.0.1',port:${port},timeout:3000});let b='';c.on('data',d=>b+=d);c.on('connect',()=>c.write('GET / HTTP/1.0\\r\\n\\r\\n'));c.on('end',()=>{console.log('FIK '+b);process.exit(0)});c.on('error',e=>{console.log('AFVIST '+e.code);process.exit(1)});c.on('timeout',()=>{console.log('AFVIST tid');process.exit(1)});`);
  const result = await f.execute(`${quote(f.configured.node)} vaert.cjs`);
  assert.doesNotMatch(result.stdout, /HOSTSECRET/);
  assert.notEqual(result.code, 0, result.stdout);
  const policy = JSON.parse(await fs.readFile(f.configured.policyPath));
  assert.equal(policy.config.network.allowLocalBinding, false);
});

test('B1-skeptiker 2: en nøgle i .git/config kan ikke læses af en kommando (så er .git lukket), og ellers virker git', async t => {
  if (!supported) return t.skip('Denne platforms isolation understøttes ikke.');
  const setup = async remote => {
    const f = await fixture(t);
    const git = args => run('/usr/bin/git', args, { cwd: f.root, env: { PATH: '/usr/bin:/bin', HOME: f.scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } });
    await git(['init', '-q']); await fs.writeFile(path.join(f.root, 'a.txt'), 'a'); await git(['add', 'a.txt']); await git(['commit', '-q', '-m', 'første']);
    await git(['remote', 'add', 'origin', remote]);
    return f;
  };
  const secret = await setup('https://tok123HEMMELIG@github.com/x/y');
  const prepared = await sandbox.prepare({ workspaceRoot: secret.root, scratchRoot: secret.scratch, directory: path.join(path.dirname(secret.root), 'policy2') });
  const policy = JSON.parse(await fs.readFile(prepared.policyPath));
  assert.ok(policy.config.filesystem.denyRead.some(pattern => /\[gG\]\[iI\]\[tT\]/.test(pattern)), '.git skal være spærret for læsning, når config rummer en nøgle');
  const payload = Buffer.from(JSON.stringify({ command: 'cat .git/config', cwd: secret.root })).toString('base64url');
  const cat = await run(prepared.node, [prepared.runner, prepared.policyPath, payload], { cwd: secret.root, timeout: 40000, env: { PATH: process.env.PATH } }).catch(error => ({ stdout: error.stdout || '', stderr: error.stderr || '' }));
  assert.doesNotMatch(cat.stdout, /tok123HEMMELIG/);
  const clean = await setup('git@github.com:x/y.git');
  await fs.writeFile(path.join(clean.root, 'b.txt'), 'b');
  clean.execute = (await (async () => { const p2 = await sandbox.prepare({ workspaceRoot: clean.root, scratchRoot: clean.scratch, directory: path.join(path.dirname(clean.root), 'policy3') }); return async command => { const pl = Buffer.from(JSON.stringify({ command, cwd: clean.root })).toString('base64url'); try { return { ...(await run(p2.node, [p2.runner, p2.policyPath, pl], { cwd: clean.root, timeout: 40000, env: { PATH: process.env.PATH } })), code: 0 }; } catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; } }; })());
  const status = await clean.execute('git status --short');
  assert.equal(status.code, 0, status.stderr); assert.match(status.stdout, /b\.txt/);
});

test('B1-skeptiker 3: en forfalsket indpakning i en rå agentkommando vises ikke som en anden kommando', async t => {
  const { originalCommand } = require('../core/activity.cjs');
  const forged = "exec /usr/bin/env -i X=1 evil '" + Buffer.from(JSON.stringify({ command: 'ls' })).toString('base64url') + "'";
  assert.equal(originalCommand(forged), forged);
  assert.equal(approvalTarget({ permission: 'bash', metadata: { command: forged }, patterns: [] }, '/p'), forged);
  // Den rigtige indpakning fra hooket pakkes stadig ud.
  if (!supported) return;
  const f = await fixture(t), hooks = await (await import(f.configured.pluginURL)).AuraCommandIsolation();
  const input = { args: { command: 'echo hej', workdir: f.root } };
  await hooks['tool.execute.before']({ tool: 'bash' }, input);
  assert.equal(originalCommand(input.args.command), 'echo hej');
  // Samme nyttelast bag en fremmed forstavelse (anden node, anden politik) pakkes ikke ud.
  const swapped = input.args.command.replace(/ '[^']*' '([A-Za-z0-9_-]+)'$/, " '/tmp/evil.mjs' '$1'");
  assert.equal(originalCommand(swapped), swapped);
});
