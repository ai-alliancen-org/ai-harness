// Isolationen gælder agentens kommandoer. Auras særskilt godkendte preview/installationsforløb bruger ikke denne motor.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const run = promisify(execFile);
const PACKAGE_HOSTS = ['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org'];
const unpacked = file => file.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
const runnerPath = () => unpacked(path.join(__dirname, 'command-sandbox-runner.mjs'));
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const contains = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
async function nodePath() {
  const bundled = require('./runtime.cjs').get();
  const prepared = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'node', 'bin', 'node');
  for (const candidate of bundled ? [bundled.node] : [prepared, process.execPath]) {
    try { const { stdout } = await run(candidate, ['-p', 'process.versions.electron ? "electron" : process.versions.node'], { timeout: 10000 }); if (/^(2[2-9]|[3-9]\d)\./.test(stdout.trim())) return await fs.realpath(candidate); } catch { /* Næste betroede runtime. */ }
  }
  throw new Error('Aura mangler sin Node-runtime til isolerede kommandoer. Installer appen igen.');
}
async function support({ platform = process.platform } = {}) {
  if (!['darwin', 'linux'].includes(platform)) return { available: false, platform, reason: 'Automatisk kommandokørsel med teknisk isolation er endnu ikke understøttet på Windows.' };
  try {
    const node = await nodePath();
    const { stdout } = await run(node, [runnerPath(), '--check'], { timeout: 20000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', LANG: 'en_US.UTF-8' } });
    const result = JSON.parse(stdout.trim());
    return { available: result.errors.length === 0, platform, reason: result.errors.length ? 'Kommandobeskyttelsen kan ikke starte: ' + result.errors.join('; ') : '', warnings: result.warnings };
  } catch { return { available: false, platform, reason: 'Kommandobeskyttelsen kan ikke starte på denne computer. Automatisk kommandokørsel er slået fra.' }; }
}
async function prepare({ workspaceRoot, scratchRoot, directory }) {
  const status = await support();
  if (!status.available) throw new Error(status.reason);
  const root = await fs.realpath(workspaceRoot), scratch = await fs.realpath(scratchRoot), node = await nodePath();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const trusted = await fs.realpath(directory);
  if (contains(root, trusted) || contains(scratch, trusted)) throw new Error('Kommandobeskyttelsens indstillinger skal ligge uden for arbejdsområdet.');
  const home = path.join(scratch, 'home'), temp = path.join(scratch, 'tmp');
  await fs.mkdir(home, { recursive: true, mode: 0o700 }); await fs.mkdir(temp, { recursive: true, mode: 0o700 });
  const literal = value => ({ path: value, literal: true });
  const systemRead = process.platform === 'darwin'
    ? ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/share', '/System/Library', '/Library/Apple', '/private/etc/ssl', '/private/etc/resolv.conf', '/private/etc/hosts', '/private/etc/localtime']
    : ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib64', '/lib', '/lib64', '/usr/share', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/localtime'];
  // Runtimefilerne er læsbare, men brugerens hjem, appdata og øvrige projekter er ikke.
  const runtimeRoot = path.dirname(path.dirname(node));
  const sensitive = require('./protected-paths.cjs').toSandboxGlobs();
  const policy = { version: 1, workspaceRoot: root, scratchRoot: scratch, node, env: { PATH: [path.dirname(node), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp, LANG: 'en_US.UTF-8', npm_config_cache: path.join(home, '.npm'), PIP_CACHE_DIR: path.join(home, '.cache', 'pip') }, config: {
    network: { allowedDomains: PACKAGE_HOSTS, deniedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowUnixSockets: [], allowAllUnixSockets: false },
    filesystem: { denyRead: ['/', ...[root, scratch].flatMap(folder => sensitive.map(pattern => path.join(folder, pattern)))], allowRead: [root, scratch, runtimeRoot, ...systemRead, '/dev/null', '/dev/urandom', '/dev/random', '/dev/fd'].map(literal), allowWrite: [root, scratch].map(literal), denyWrite: ['/tmp/claude', '/private/tmp/claude', ...[root, scratch].flatMap(folder => sensitive.map(pattern => path.join(folder, pattern)))] },
    allowPty: false, enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false
  } };
  const identity = crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  const policyPath = path.join(trusted, 'policy.json'), pluginPath = path.join(trusted, 'plugin.mjs'), readyPath = path.join(trusted, 'ready.json'), readyToken = crypto.randomBytes(32).toString('hex');
  await fs.rm(readyPath, { force: true });
  await fs.writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 });
  const prefix = ['exec', '/usr/bin/env', '-i', ...Object.entries(policy.env).map(([key, value]) => key + '=' + quote(value)), quote(node), quote(runnerPath()), quote(policyPath)].join(' ');
  const source = `import fs from 'node:fs/promises';\nimport path from 'node:path';\nexport const AuraCommandIsolation = async () => {\n await fs.writeFile(${JSON.stringify(readyPath)}, ${JSON.stringify(JSON.stringify({ token: readyToken, identity }))}, { mode: 0o600 });\n return {\n 'shell.env': async (_input, output) => {\n  output.env = { ...Object.fromEntries(Object.keys(process.env).map(key => [key, ''])), ...${JSON.stringify(policy.env)}, SHELL: '/bin/bash' };\n },\n 'tool.execute.before': async (input, output) => {\n  if (input.tool !== 'bash') return;\n  const roots = ${JSON.stringify([root, scratch])};\n  const cwd = await fs.realpath(output.args.workdir || roots[0]);\n  if (!roots.some(root => { const rel = path.relative(root, cwd); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); })) throw new Error('Kommandoens arbejdsmappe ligger uden for projektet og opgavens midlertidige mappe.');\n  if (typeof output.args.command !== 'string') throw new Error('Kommandoen mangler.');\n  const payload = Buffer.from(JSON.stringify({ command: output.args.command, cwd })).toString('base64url');\n  output.args.command = ${JSON.stringify(prefix)} + " '" + payload + "'";\n  output.args.workdir = cwd;\n }\n};\n};\n`;
  await fs.writeFile(pluginPath, source, { mode: 0o600 });
  return { pluginURL: pathToFileURL(pluginPath).href, policyPath, identity, readyPath, readyToken, node, runner: runnerPath(), workspaceRoot: root, scratchRoot: scratch };
}
module.exports = { support, prepare, PACKAGE_HOSTS, contains, nodePath };
