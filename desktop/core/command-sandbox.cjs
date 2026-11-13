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
// Systemets læsbare mapper på macOS. Command Line Tools læses, så git virker; hele /Library/Developer gives ikke,
// og intet af det kan skrives. Git behøver hverken xcode-select-linket (/var/select) eller systemets gitconfig,
// som begge ligger bag symlinks, der ikke kan åbnes uden at give hele /var og /etc: miljøet peger i stedet git direkte på
// Command Line Tools (DEVELOPER_DIR) og slår systemets gitconfig fra (GIT_CONFIG_NOSYSTEM). Intet nyt kan læses eller skrives.
const DARWIN_SYSTEM_READ = ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/share', '/System/Library', '/Library/Apple', '/Library/Developer/CommandLineTools', '/private/etc/ssl', '/private/etc/resolv.conf', '/private/etc/hosts', '/private/etc/localtime'];
// Forstavelserne på de indpakninger, denne proces selv har lavet. Kun en kommando, der begynder præcis sådan, pakkes ud i visningen.
const wrappers = new Set();
function unwrap(command) {
  if (typeof command !== 'string') return command;
  for (const prefix of wrappers) {
    if (!command.startsWith(prefix + " '") || !command.endsWith("'")) continue;
    const encoded = command.slice(prefix.length + 2, -1);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) continue;
    try { const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()); if (typeof payload?.command === 'string') return payload.command; } catch { /* Vises uændret. */ }
  }
  return command;
}
async function nodePath() {
  const bundled = require('./runtime.cjs').get();
  const prepared = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'node', 'bin', 'node');
  for (const candidate of bundled ? [bundled.node] : [prepared, process.execPath]) {
    try { const { stdout } = await run(candidate, ['-p', 'process.versions.electron ? "electron" : process.versions.node'], { timeout: 10000 }); if (/^(2[2-9]|[3-9]\d)\./.test(stdout.trim())) return await fs.realpath(candidate); } catch { /* Næste betroede runtime. */ }
  }
  throw new Error('Aura mangler sin Node-runtime til isolerede kommandoer. Installer appen igen.');
}
// Kun en platform helt uden sandkasse kan få kommandoer uden isolation. En Mac eller Linux, hvor sandkassen ikke kan starte, får ingen reservevej.
const canRunUnisolated = support => Boolean(support) && support.available !== true && typeof support.platform === 'string' && !['darwin', 'linux'].includes(support.platform);
async function support({ platform = process.platform } = {}) {
  // Windows har ingen kommandosandkasse. Brugeren kan vælge at køre kommandoer uden isolation (se canRunUnisolated); det er aldrig en stille reservevej.
  if (!['darwin', 'linux'].includes(platform)) return { available: false, platform, unisolatedPossible: true, reason: 'Automatisk kommandokørsel med teknisk isolation er endnu ikke understøttet på Windows.' };
  try {
    const node = await nodePath();
    const { stdout } = await run(node, [runnerPath(), '--check'], { timeout: 20000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', LANG: 'en_US.UTF-8' } });
    const result = JSON.parse(stdout.trim());
    return { available: result.errors.length === 0, platform, reason: result.errors.length ? 'Kommandobeskyttelsen kan ikke starte: ' + result.errors.join('; ') : '', warnings: result.warnings };
  } catch { return { available: false, platform, reason: 'Kommandobeskyttelsen kan ikke starte på denne computer. Automatisk kommandokørsel er slået fra.' }; }
}
const GIT_SECRET = /\b(?:https?|ftp):\/\/[^\/\s@]+@|extraheader|^\s*(?:password|token)\s*=/im;
// Finder .git i projektet (højst tre niveauer ned, uden node_modules) og læser den config, git faktisk bruger,
// også når .git er en fil, der peger på en anden mappe (worktree, undermodul). Kan en config ikke læses, regnes den ikke som ren.
async function gitConfigHoldsSecret(root) {
  const configs = new Set(), read = async file => { try { return await fs.readFile(file, 'utf8'); } catch (error) { return error.code === 'ENOENT' ? '' : null; } };
  const walk = async (folder, depth) => {
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (/^\.git$/i.test(entry.name)) {
        if (entry.isDirectory()) configs.add(path.join(full, 'config'));
        else { const pointer = /^gitdir:\s*(.+)$/m.exec((await read(full)) || ''); if (pointer) { const dir = path.resolve(folder, pointer[1].trim()); configs.add(path.join(dir, 'config')); const common = (await read(path.join(dir, 'commondir'))) || ''; if (common.trim()) configs.add(path.join(path.resolve(dir, common.trim()), 'config')); } else configs.add(full); }
      } else if (entry.isDirectory() && depth < 3 && entry.name !== 'node_modules') await walk(full, depth + 1);
    }
  };
  await walk(root, 0);
  for (const file of configs) { const text = await read(file); if (text === null || GIT_SECRET.test(text)) return true; }
  return false;
}
async function prepare({ workspaceRoot, scratchRoot, directory }) {
  const status = await support();
  if (!status.available) throw new Error(status.reason);
  const root = await fs.realpath(workspaceRoot), scratch = await fs.realpath(scratchRoot), node = await nodePath();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const trusted = await fs.realpath(directory);
  if (contains(root, trusted) || contains(scratch, trusted)) throw new Error('Kommandobeskyttelsens indstillinger skal ligge uden for arbejdsområdet.');
  // HOME og pakkecaches ligger i appdata ved siden af indstillingerne, aldrig i projektet: en npm-installation kan ellers lægge
  // hundredvis af filer i projektmappen (OneDrive, Git). Kun den midlertidige mappe ligger i .aura/tmp.
  const home = path.join(path.dirname(trusted), 'home'), temp = path.join(scratch, 'tmp');
  if (contains(root, home)) throw new Error('Kommandobeskyttelsens hjemmemappe skal ligge uden for arbejdsområdet.');
  await fs.mkdir(home, { recursive: true, mode: 0o700 }); await fs.mkdir(temp, { recursive: true, mode: 0o700 });
  // allowLocalBinding er slået fra. Sandbox-runtime kan ikke afgrænse loopback til kommandoens egne porte: åbnes den, når
  // kommandoen også brugerens øvrige lokale tjenester (andre projekters servere, databaser, Ollama). Prøven b1-skeptiker 1 viser det.
  // Kun hvis Command Line Tools findes. Ellers står git uden værktøjer, som før (kun Xcode.app ligger uden for læselisten).
  const developerDir = process.platform === 'darwin' ? await fs.stat('/Library/Developer/CommandLineTools/usr/bin/git').then(() => '/Library/Developer/CommandLineTools', () => null) : null;
  const literal = value => ({ path: value, literal: true });
  const systemRead = process.platform === 'darwin'
    ? DARWIN_SYSTEM_READ
    : ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib64', '/lib', '/lib64', '/usr/share', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/localtime'];
  // Runtimefilerne er læsbare, men brugerens hjem, appdata og øvrige projekter er ikke.
  const runtimeRoot = path.dirname(path.dirname(node));
  const sensitive = require('./protected-paths.cjs').toSandboxGlobs();
  // Git skal kunne læse .git (status, log, diff), så .git-mønstrene udgår af læsespærringen. De bliver i skrivespærringen:
  // hooks, config og objekter kan fortsat ikke ændres. Øvrige skjulte navne (.aura-private, nøgler, .env) er stadig spærret.
  const gitNames = ['**/.[gG][iI][tT]', '**/.[gG][iI][tT]:*'];
  // Git må ikke selv læse sin config uden at få al config: en nøgle i en fjernadresse (https://nøgle@vært/...) ville kunne
  // læses med "cat .git/config" og gå til samtalen. Derfor holdes .git kun åben, når ingen config i projektet rummer en nøgle.
  // Ellers spærres .git for læsning som før, og git virker ikke i sandkassen (prøven b1-skeptiker 2).
  const gitHoldsSecret = await gitConfigHoldsSecret(root);
  const sensitiveRead = gitHoldsSecret ? sensitive : sensitive.filter(pattern => !gitNames.includes(pattern));
  const policy = { version: 1, workspaceRoot: root, scratchRoot: scratch, node, env: { PATH: [path.dirname(node), ...(developerDir ? [developerDir + '/usr/bin'] : []), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp, NODE_DISABLE_COMPILE_CACHE: '1', LANG: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1', ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}), npm_config_cache: path.join(home, '.npm'), PIP_CACHE_DIR: path.join(home, '.cache', 'pip') }, config: {
    network: { allowedDomains: PACKAGE_HOSTS, deniedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowUnixSockets: [], allowAllUnixSockets: false },
    filesystem: { denyRead: ['/', ...[root, scratch].flatMap(folder => sensitiveRead.map(pattern => path.join(folder, pattern)))], allowRead: [root, scratch, home, runtimeRoot, ...systemRead, '/dev/null', '/dev/urandom', '/dev/random', '/dev/fd'].map(literal), allowWrite: [root, scratch, home].map(literal), denyWrite: ['/tmp/claude', '/private/tmp/claude', ...[root, scratch].flatMap(folder => sensitive.map(pattern => path.join(folder, pattern)))] },
    allowPty: false, enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false
  } };
  const identity = crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  const policyPath = path.join(trusted, 'policy.json'), pluginPath = path.join(trusted, 'plugin.mjs'), readyPath = path.join(trusted, 'ready.json'), readyToken = crypto.randomBytes(32).toString('hex');
  await fs.rm(readyPath, { force: true });
  await fs.writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 });
  const prefix = ['exec', '/usr/bin/env', '-i', ...Object.entries(policy.env).map(([key, value]) => key + '=' + quote(value)), quote(node), quote(runnerPath()), quote(policyPath)].join(' ');
  wrappers.add(prefix);
  const source = `import fs from 'node:fs/promises';\nimport path from 'node:path';\nexport const AuraCommandIsolation = async () => {\n await fs.writeFile(${JSON.stringify(readyPath)}, ${JSON.stringify(JSON.stringify({ token: readyToken, identity }))}, { mode: 0o600 });\n return {\n 'shell.env': async (_input, output) => {\n  output.env = { ...Object.fromEntries(Object.keys(process.env).map(key => [key, ''])), ...${JSON.stringify(policy.env)}, SHELL: '/bin/bash' };\n },\n 'tool.execute.before': async (input, output) => {\n  if (input.tool !== 'bash') return;\n  const roots = ${JSON.stringify([root, scratch])};\n  const cwd = await fs.realpath(output.args.workdir || roots[0]);\n  if (!roots.some(root => { const rel = path.relative(root, cwd); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); })) throw new Error('Kommandoens arbejdsmappe ligger uden for projektet og opgavens midlertidige mappe.');\n  if (typeof output.args.command !== 'string') throw new Error('Kommandoen mangler.');\n  const payload = Buffer.from(JSON.stringify({ command: output.args.command, cwd })).toString('base64url');\n  output.args.command = ${JSON.stringify(prefix)} + " '" + payload + "'";\n  output.args.workdir = cwd;\n }\n};\n};\n`;
  await fs.writeFile(pluginPath, source, { mode: 0o600 });
  return { pluginURL: pathToFileURL(pluginPath).href, policyPath, identity, readyPath, readyToken, node, runner: runnerPath(), workspaceRoot: root, scratchRoot: scratch };
}
module.exports = { unwrap, support, canRunUnisolated, prepare, PACKAGE_HOSTS, contains, nodePath, DARWIN_SYSTEM_READ };
