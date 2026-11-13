const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID, createHash } = require('node:crypto');
const { stripVTControlCharacters } = require('node:util');
const runtime = require('./runtime.cjs');
const net = require('node:net');
const { startFileDigest, normalizeRuntimeConfig, detectServices, inspectPreviewDependencies, serviceDirectory } = require('./project-runtime.cjs');
const { npmInstallPolicy, npmFailure } = require('./npm-policy.cjs');
const secrets = require('./secrets.cjs');
const run = promisify(execFile);
const active = state => ['installing', 'starting', 'running', 'stopping'].includes(state);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Kun operativsystemets nødvendige variable. Ingen modelnøgler, NODE_OPTIONS eller npm-tokens.
function environment(source = process.env) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    const actual = Object.keys(source).find(item => item.toUpperCase() === key.toUpperCase());
    if (actual) env[key] = source[actual];
  }
  return { ...env, NO_COLOR: '1', FORCE_COLOR: '0', ASTRO_TELEMETRY_DISABLED: '1', npm_config_update_notifier: 'false' };
}
function cleanOutput(value) {
  // Det fælles modul kører først, mens Authorization-hoved, Bearer og KEY=værdi står intakte; de gamle mønstre tager resten.
  // Omvendt rækkefølge ville lade det gamle mønster skjule ordet Bearer og efterlade selve nøglen.
  return secrets.redact(stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''))
    .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{10,}|github_pat_[\w]+)\b/g, '[skjult nøgle]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[skjult]@')
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[skjult]');
}
// Nyt output skæres ned, før det renses: en enkelt lang bid fra en proces må ikke koste mere at rense end det, loggen kan rumme.
const CHUNK_LIMIT = 64_000;
const appendOutput = (previous, addition) => cleanOutput(previous + String(addition).slice(-CHUNK_LIMIT)).slice(-16000);
// Mange servere (Vite, Next, Astro) vælger selv deres port og lytter kun på "localhost", som kan være ::1. Serverens egen
// "Local: http://localhost:5173/"-linje er derfor den sikreste kilde. Kun lokale adresser tæller, og den sidste vinder.
function announcedURL(text) {
  const found = [...String(text || '').matchAll(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})(?:\/[^\s'")\]]*)?/g)];
  const last = found.at(-1);
  return last ? `http://${last[1]}:${last[2]}/` : null;
}
async function regular(root, name, max = 5_000_000) {
  try {
    const file = path.join(root, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > max) throw new Error(`${name} skal være en almindelig fil på højst ${max / 1_000_000} MB.`);
    return await fs.readFile(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function inspectFramework(root) {
  const manifest = await regular(root, 'package.json', 200_000);
  if (!manifest) return { kind: 'static', supported: false, reason: 'Projektet har ingen package.json.' };
  let pkg;
  try { pkg = JSON.parse(manifest); } catch { return { kind: 'unknown', supported: false, reason: 'package.json kan ikke læses. Bed AI’en rette filen, og prøv igen.' }; }
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  try { if ((await fs.lstat(path.join(root, 'node_modules'))).isSymbolicLink()) throw new Error('node_modules peger på en anden mappe. Brug en almindelig lokal installation.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const script = typeof pkg.scripts?.dev === 'string' ? pkg.scripts.dev.trim() : '';
  const kind = dependencies.astro ? 'astro' : dependencies.vite ? 'vite' : 'unknown';
  const files = { 'package.json': manifest };
  for (const name of ['package-lock.json', 'npm-shrinkwrap.json', '.npmrc', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', ...['vite.config', 'astro.config'].flatMap(base => ['js','mjs','cjs','ts','mts','cts'].map(ext => `${base}.${ext}`))]) files[name] = await regular(root, name);
  const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const npm = !pkg.packageManager || /^npm@/.test(pkg.packageManager);
  const otherLock = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].some(name => files[name] !== null);
  const simple = kind === 'vite' ? /^(vite|vite dev|vite serve)$/.test(script) : kind === 'astro' && script === 'astro dev';
  let installed = false;
  try {
    const modules = await fs.lstat(path.join(root, 'node_modules'));
    const localPackage = await regular(path.join(root, 'node_modules', kind), 'package.json');
    installed = modules.isDirectory() && Boolean(localPackage);
  } catch { /* Installation tilbydes, men køres aldrig som følge af inspektionen. */ }
  const supported = npm && !otherLock && Boolean(simple) && !pkg.workspaces;
  const reason = !npm || otherLock ? 'Projektet bruger en anden pakkehåndtering end npm. Tilslut en server, der allerede kører.' : pkg.workspaces ? 'Projektet har flere arbejdsområder. Åbn appens egen mappe, eller tilslut dens server.' : !simple ? 'Automatisk opstart kræver et dev-script med vite eller astro dev. Andre kommandoer kan køres separat og tilsluttes her.' : '';
  return { kind, label: kind === 'astro' ? 'Astro' : dependencies.react && kind === 'vite' ? 'React med Vite' : kind === 'vite' ? 'Vite' : 'Andet projekt', supported, installed, fingerprint, reason, install: files['package-lock.json'] || files['npm-shrinkwrap.json'] ? 'ci' : 'install', installPolicy: npmInstallPolicy(pkg, files), dependencies: Object.keys(dependencies).sort().slice(0, 100), script };
}
async function inspect(root, config = {}) {
  const [project, diagnostics] = await Promise.all([inspectRuntime(root, config), inspectPreviewDependencies(root, config)]);
  return { ...project, diagnostics };
}
// Overgang fra beta 2 (fund 24 og Q:C2-4, beta 3): dengang talte netlisten med i samtykkets fingeraftryk. Det gamle fingeraftryk
// beregnes med projektets aktuelle netliste og formlen fra core/project-runtime.cjs i beta 2. ai-preview.cjs lader et samtykke til det
// gælde, når pakker, opstart og netliste er de samme som dengang, og skriver det om til det nye. Uden netliste er de to ens.
const legacyDigest = detected => detected.config.network ? createHash('sha256').update(JSON.stringify({ config: detected.config, files: detected.files })).digest('hex') : null;
const legacy = value => value ? { legacyFingerprint: value } : {};
async function inspectRuntime(root, config = {}) {
  const detected = await detectServices(root, config), old = legacyDigest(detected);
  if (detected.config.mode === 'static') return { kind: 'static', supported: false, installed: true, reason: 'Enkel hjemmeside viser projektets public-mappe uden en projektserver.', runtimeConfig: detected.config, services: [], fingerprint: detected.fingerprint, ...legacy(old) };
  const normal = await inspectFramework(root);
  if (!detected.config.services?.length && ['vite', 'astro'].includes(normal.kind) && normal.supported) return { ...normal, runtimeConfig: detected.config, services: [], fingerprint: createHash('sha256').update(normal.fingerprint + detected.fingerprint).digest('hex'), ...legacy(old && createHash('sha256').update(normal.fingerprint + old).digest('hex')) };
  if (!detected.services.length || !detected.config.services?.length && /anden pakkehåndtering|flere arbejdsområder/.test(normal.reason || '')) return { ...normal, runtimeConfig: detected.config, services: [], fingerprint: detected.fingerprint, ...legacy(old) };
  const services = [], installs = [], fingerprints = [detected.fingerprint];
  for (const service of detected.services) {
    const cwd = await serviceDirectory(root, service.cwd);
    const detail = await detectServices(cwd, { mode: 'auto' });
    fingerprints.push(detail.fingerprint);
    let pkg; try { pkg = JSON.parse(detail.files['package.json']); } catch {}
    // Startfilerne, som kommandoen eller dens npm-script peger på, hører med til samtykket.
    fingerprints.push(await startFileDigest(root, cwd, service.command, service.command[0] === 'npm' && service.command[1] === 'run' ? pkg?.scripts?.[service.command[2]] : null));
    const program = service.command[0], python = /^python(?:3)?(?:\.exe)?$/.test(program);
    const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
    let installed = true;
    if (program === 'npm' || program === 'node') {
      try { if ((await fs.lstat(path.join(cwd, 'node_modules'))).isSymbolicLink()) throw Error('node_modules peger på en anden mappe. Brug en almindelig lokal installation.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Object.keys(dependencies).length) {
        try { installed = (await fs.lstat(path.join(cwd, 'node_modules'))).isDirectory(); } catch { installed = false; }
        for (const name of Object.keys(dependencies)) { if (!installed) break; try { await fs.access(path.join(cwd, 'node_modules', name, 'package.json')); } catch { installed = false; } }
      }
      if (pkg) installs.push({ kind: 'npm', cwd, install: detail.files['package-lock.json'] || detail.files['npm-shrinkwrap.json'] ? 'ci' : 'install', installPolicy: npmInstallPolicy(pkg, detail.files) });
    } else if (python && (detail.files['requirements.txt'] || detail.files['pyproject.toml'])) {
      try { if ((await fs.lstat(path.join(cwd, '.venv'))).isSymbolicLink()) throw Error('Python-miljøet peger på en anden mappe. Brug et lokalt .venv i projektet.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const localPython = path.join(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const dependencyHash = createHash('sha256').update(JSON.stringify([detail.files['requirements.txt'], detail.files['pyproject.toml']])).digest('hex');
      try { await fs.access(localPython); installed = (await fs.readFile(path.join(cwd, '.venv', 'aura-installed'), 'utf8')).trim() === dependencyHash; } catch { installed = false; }
      installs.push({ kind: 'python', cwd, requirements: Boolean(detail.files['requirements.txt']), dependencyHash });
    }
    const declaredScript = program === 'npm' && service.command[1] === 'run' ? pkg?.scripts?.[service.command[2]] : null;
    services.push({ ...service, cwd: service.cwd || '.', installed, python, ...(typeof declaredScript === 'string' ? { declaredScript } : {}) });
  }
  const dependencies = [...new Set(services.flatMap(service => service.python ? ['Python'] : ['Node.js']))];
  return { kind: 'services', label: services.length === 1 ? services[0].label : `${services.length} lokale tjenester`, supported: true, installed: services.every(s => s.installed), fingerprint: createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex'), ...legacy(old && createHash('sha256').update(JSON.stringify([old, ...fingerprints.slice(1)])).digest('hex')), reason: '', runtimeConfig: detected.config, services, installs, dependencies, script: services.map(s => s.command.join(' ')).join('\n') };
}
async function nodeRuntime() {
  const candidates = runtime.get() ? [runtime.get().node] : (process.env.PATH || '').split(path.delimiter).filter(p => path.isAbsolute(p)).map(p => path.join(p, process.platform === 'win32' ? 'node.exe' : 'node'));
  for (const candidate of candidates) {
    try {
      const node = await fs.realpath(candidate);
      const { stdout } = await run(node, ['--version'], { env: environment(), timeout: 5000, windowsHide: true });
      const [major, minor] = stdout.trim().replace(/^v/, '').split('.').map(Number);
      if (major < 22 || major === 22 && minor < 12) continue;
      const candidatesNpm = [process.platform === 'win32' ? path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js') : path.resolve(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')];
      if (!runtime.get()) for (const bin of (process.env.PATH || '').split(path.delimiter).filter(p => path.isAbsolute(p))) {
        try { const file = await fs.realpath(path.join(bin, 'npm')); if (path.basename(file) === 'npm-cli.js') candidatesNpm.push(file); } catch {}
      }
      for (const npm of candidatesNpm) { try { await fs.access(npm); return { node, npm }; } catch {} }
    } catch { /* Næste eksisterende installation. */ }
  }
  throw new Error('Node.js 22.12 eller nyere med npm blev ikke fundet. Brug installationspakken med de medfølgende værktøjer, eller få hjælp til at installere Node.js.');
}
async function findProgram(name, cwd) {
  const python = /^python(?:3)?(?:\.exe)?$/.test(name);
  const candidates = python ? [path.join(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')] : [];
  const names = python ? process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'] : [name];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(p => path.isAbsolute(p))) for (const candidate of names) candidates.push(path.join(directory, candidate));
  for (const candidate of candidates) {
    if (/\.(?:cmd|bat|ps1)$/i.test(candidate)) continue;
    try { await fs.access(candidate, require('node:fs').constants.X_OK); if ((await fs.stat(candidate)).isFile()) return python && candidate.startsWith(path.join(cwd, '.venv') + path.sep) ? candidate : await fs.realpath(candidate); } catch {}
  }
  throw Error(python ? 'Python blev ikke fundet. Installér Python gennem organisationens godkendte værktøj, eller vælg en anden opstart. Aura installerer ikke Python automatisk.' : `Programmet ${name} blev ikke fundet. Installér det gennem organisationens godkendte værktøj, eller ret opstarten.`);
}
async function freePort(requested = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', error => reject(Error(requested ? `Port ${requested} er optaget. Vælg en anden port, eller stop den anden tjeneste.` : error.message))); server.listen(requested, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function terminate(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).catch(() => {});
  } else {
    const signal = name => { try { process.kill(-child.pid, name); return true; } catch { return false; } };
    if (!signal('SIGTERM')) return;
    for (let n = 0; n < 20 && signal(0); n++) await delay(50);
    if (signal(0)) signal('SIGKILL');
  }
}
class DevServer {
  // previewPort husker projektets sidste port til Vite og Astro, så forhåndsvisningens lokale data bevares.
  constructor({ emit = () => {}, runner = path.join(__dirname, 'dev-server-runner.cjs'), komplaiScript = async () => null, runtimeConfig = {}, getRuntimeConfig, previewPort = { get: async () => null, set: async () => {} } } = {}) { this.emit = emit; this.runner = runner; this.komplaiScript = komplaiScript; this.previewPort = previewPort; this.root = null; this.state = 'idle'; this.output = ''; this.generation = 0; this.config = normalizeRuntimeConfig(runtimeConfig); this.getRuntimeConfig = getRuntimeConfig; this.children = []; this.services = []; }
  configure(config = {}) { if (active(this.state)) throw Error('Stop forhåndsvisningen, før opstarten ændres.'); this.config = normalizeRuntimeConfig(config); this.review = null; return this.config; }
  async runtimeConfig() { return normalizeRuntimeConfig(this.getRuntimeConfig ? await this.getRuntimeConfig(this.root) : this.config); }
  snapshot() { return { root: this.root, state: this.state, url: this.url || null, output: this.output, message: this.message || '', kind: this.kind, services: this.services || [], runtimeConfig: this.activeConfig || null }; }
  // Brugerens samtykke til en adresse gælder straks, også mens serveren kører. Kun netlisten skiftes; tjenesterne og opstarten er
  // de gennemgåede. Uden en kørende opstart er der intet at skifte: næste start læser netlisten fra lageret.
  useNetwork(network) { if (this.activeConfig) this.activeConfig = { ...this.activeConfig, network: normalizeRuntimeConfig({ network }).network }; return this.snapshot(); }
  update(state, message = '') { this.state = state; this.message = message; this.emit(this.snapshot()); }
  async activate(root) { await this.stop(); this.review = null; this.root = root; this.url = null; this.output = ''; this.kind = null; this.update('idle'); }
  async status() { return { ...this.snapshot(), project: this.root ? await inspect(this.root, await this.runtimeConfig()).catch(error => ({ kind: 'unknown', supported: false, reason: error.message })) : null }; }
  async prepare(action, scripts = false) {
    if (!this.root || active(this.state)) throw new Error('Stop den aktuelle server eller installation først.');
    if (!['install', 'start'].includes(action)) throw new Error('Ukendt handling.');
    const project = await inspect(this.root, await this.runtimeConfig());
    if (!project.supported) throw new Error(project.reason);
    if (action === 'start' && !project.installed) throw new Error('Installér projektets pakker først.');
    const custom = project.kind === 'services';
    const executables = !custom || project.services.some(s => ['node', 'npm'].includes(s.command[0])) ? await nodeRuntime() : {};
    if (custom) {
      executables.services = {};
      for (const service of project.services) {
        const cwd = await serviceDirectory(this.root, service.cwd), name = service.command[0];
        executables.services[service.id] = ['node', 'npm'].includes(name) ? executables.node : await findProgram(name, cwd);
      }
    }
    const review = { token: randomUUID(), root: this.root, action, scripts: scripts === true, project, executables };
    this.review = review;
    const npmCommand = item => [`npm ${item.install}`, '--no-audit', '--no-fund', '--include=dev', `--ignore-scripts=${scripts !== true}`, ...item.installPolicy.args].join(' ');
    const command = custom ? action === 'install' ? [...new Map(project.installs.map(item => [item.cwd, item])).values()].map(item => item.kind === 'npm' ? `${npmCommand(item)} (${path.relative(this.root, item.cwd) || '.'})${item.installPolicy.reason ? '\n' + item.installPolicy.reason : ''}` : `Python: opret projektets .venv og installér ${item.requirements ? 'requirements.txt' : 'projektets pyproject.toml'} dér. Pakkernes byggekommandoer kan køre.`).join('\n') : project.services.map(service => `${service.label}: ${service.command.join(' ')}${service.declaredScript ? `\npackage.json: ${service.declaredScript}` : ''}\nMappe: ${service.cwd}; HOST=127.0.0.1; PORT=${service.port || 'ledig port'}`).join('\n\n') : action === 'install' ? `${npmCommand(project)}${project.installPolicy.reason ? '\n' + project.installPolicy.reason : ''}` : `${project.kind === 'vite' ? 'Vite' : 'Astro'} dev · 127.0.0.1 · ledig port`;
    return { token: review.token, root: this.root, action, scripts: review.scripts, project, command };
  }
  async execute(token) {
    const review = this.review; this.review = null;
    if (!review || token !== review.token || review.root !== this.root || active(this.state)) throw new Error('Gennemgå handlingen igen før godkendelse.');
    const project = await inspect(this.root, await this.runtimeConfig());
    if (!project.supported || project.fingerprint !== review.project.fingerprint) throw new Error('Projektets opsætning er ændret. Gennemgå handlingen igen.');
    this.activeConfig = project.runtimeConfig;
    if (project.kind === 'services') return this.executeServices(review, project);
    // Den huskede port hentes før opstarten, så intet venter mellem generation og start af processen.
    const remembered = review.action === 'install' ? null : await this.previewPort.get().catch(() => null);
    const generation = ++this.generation;
    this.output = ''; this.url = null; this.kind = project.kind;
    const installing = review.action === 'install';
    const args = installing ? [review.executables.npm, project.install, '--no-audit', '--no-fund', '--include=dev', `--ignore-scripts=${!review.scripts}`, ...project.installPolicy.args] : [this.runner, this.root, project.kind];
    this.update(installing ? 'installing' : 'starting');
    const env = environment(); env.PATH = [path.dirname(review.executables.node), env.PATH || ''].join(path.delimiter);
    if (!installing && Number.isInteger(remembered)) env.AURA_PREVIEW_PORT = String(remembered);
    const child = spawn(review.executables.node, args, { cwd: this.root, env, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', ...(installing ? [] : ['ipc'])] });
    this.child = child;
    let timer;
    const failure = async message => {
      if (generation !== this.generation) return;
      clearTimeout(timer); const failedGeneration = ++this.generation; this.url = null;
      this.update('stopping', message); await terminate(child);
      if (this.generation !== failedGeneration) return;
      this.child = null; this.update('error', message);
    };
    const output = chunk => {
      if (generation !== this.generation) return;
      // Bevar en afgrænset, maskeret proceslog i hukommelsen. Send aldrig til modellen automatisk.
      this.output = appendOutput(this.output, chunk); this.emit(this.snapshot());
    };
    child.stdout.on('data', output); child.stderr.on('data', output);
    child.once('error', () => void failure('Programmet kunne ikke startes. Kontrollér adgang til projektet og Node.js.'));
    child.once('exit', async (code, signal) => {
      clearTimeout(timer);
      if (generation !== this.generation) return;
      if (installing && code === 0) {
        try {
          if (!(await inspect(this.root)).installed) return void failure('npm afsluttede, men frameworkets pakke mangler. Gennemgå pakkeadresserne og installér igen.');
          await terminate(child);
          if (generation !== this.generation) return;
          this.child = null; this.update('installed', 'Pakkerne er installeret. Du kan nu starte forhåndsvisningen.');
        } catch { void failure('Installationen kunne ikke kontrolleres. Gennemgå projektets package.json og pakker.'); }
      }
      else void failure(installing ? npmFailure(this.output) : `Serveren stoppede${code !== null ? ` med kode ${code}` : signal ? ` (${signal})` : ''}. Se detaljerne, og ret projektet før næste forsøg.`);
    });
    if (!installing) {
      timer = setTimeout(() => void failure('Serveren blev ikke klar. Se detaljerne, og kontrollér projektets opsætning.'), 45000);
      this.timer = timer;
      // Runneren beder om komplai Run-appens SDK, når forhåndsvisningen henter /_komplai/run/.
      child.on('message', async message => {
        if (message?.type !== 'komplai-sdk' || !Number.isSafeInteger(message.id) || typeof message.route !== 'string') return;
        const script = await this.komplaiScript(message.route).catch(() => null);
        if (generation === this.generation && child.connected) child.send({ type: 'komplai-sdk', id: message.id, script: typeof script === 'string' ? script : null });
      });
      child.on('message', async message => {
        if (generation !== this.generation || this.state !== 'starting' || message?.type !== 'ready') return;
        let url;
        try {
          url = new URL(message.url);
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash) throw new Error();
          const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) }); await response.body?.cancel();
          if (!response.ok) throw new Error();
        } catch { return void failure('Serveren startede, men siden kunne ikke vises. Se detaljerne, og kontrollér startsiden.'); }
        if (generation !== this.generation || this.state !== 'starting') return;
        clearTimeout(timer); this.url = url.href; this.update('running', 'Forhåndsvisningen kører.');
        void this.previewPort.set(Number(url.port)).catch(() => {});
      });
    }
    return this.snapshot();
  }
  async executeServices(review, project) {
    const generation = ++this.generation, installing = review.action === 'install';
    this.output = ''; this.url = null; this.kind = 'services'; this.services = []; this.children = [];
    this.update(installing ? 'installing' : 'starting');
    const env = environment();
    if (review.executables.node) env.PATH = [path.dirname(review.executables.node), env.PATH || ''].join(path.delimiter);
    const append = (label, chunk) => { if (generation === this.generation) { this.output = appendOutput(this.output, `[${label}] ${chunk}`); this.emit(this.snapshot()); } };
    const failed = async message => {
      if (generation !== this.generation) return;
      ++this.generation; this.url = null; this.services = [];
      const children = this.children.splice(0); this.update('stopping', message);
      await Promise.all(children.map(terminate));
      if (this.generation === generation + 1) this.update('error', message);
    };
    const launch = (file, args, cwd, label, childEnv = env) => {
      const child = spawn(file, args, { cwd, env: childEnv, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.push(child);
      child.stdout.on('data', data => append(label, data.toString())); child.stderr.on('data', data => append(label, data.toString()));
      return child;
    };
    const runStep = (file, args, cwd, label) => new Promise((resolve, reject) => {
      if (generation !== this.generation) return reject(Error('Handlingen blev stoppet.'));
      const child = launch(file, args, cwd, label);
      const timer = setTimeout(() => { void terminate(child); reject(Error(`${label} svarede ikke. Kontrollér procesloggen og netværket.`)); }, 10 * 60 * 1000);
      child.once('error', () => { clearTimeout(timer); reject(Error(`${label} kunne ikke startes.`)); });
      child.once('exit', code => { clearTimeout(timer); this.children = this.children.filter(c => c !== child); code === 0 ? resolve() : reject(Error(label === 'npm' ? npmFailure(this.output) : `${label} blev ikke gennemført. Se procesloggen.`)); });
    });
    if (installing) {
      void (async () => {
        const installs = [...new Map(project.installs.map(item => [item.cwd, item])).values()];
        if (!installs.length) throw Error('Projektet har ingen pakker at installere. Gennemgå opstarten i stedet.');
        for (const item of installs) {
          if (item.kind === 'npm') await runStep(review.executables.node, [review.executables.npm, item.install, '--no-audit', '--no-fund', '--include=dev', `--ignore-scripts=${!review.scripts}`, ...item.installPolicy.args], item.cwd, 'npm');
          else {
            const python = await findProgram('python3', item.cwd), localPython = path.join(item.cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
            if (!python.startsWith(path.join(item.cwd, '.venv') + path.sep)) await runStep(python, ['-m', 'venv', '.venv'], item.cwd, 'Python-miljø');
            await runStep(localPython, ['-m', 'pip', '--disable-pip-version-check', 'install', ...(item.requirements ? ['-r', 'requirements.txt'] : ['.'])], item.cwd, 'Python-pakker');
            await fs.writeFile(path.join(item.cwd, '.venv', 'aura-installed'), item.dependencyHash + '\n');
          }
        }
        if (generation !== this.generation) return;
        const next = await inspect(this.root, await this.runtimeConfig());
        if (!next.installed) throw Error('Pakkerne kunne ikke kontrolleres efter installationen. Se procesloggen.');
        this.update('installed', 'Pakkerne er installeret. Gennemgå opstarten for at se appen.');
      })().catch(error => void failed(error.message));
      return this.snapshot();
    }
    void (async () => {
      const services = [];
      for (const service of project.services) {
        const port = await freePort(service.port || 0);
        if (services.some(s => s.port === port)) throw Error('To tjenester fik samme port. Gennemgå opstarten igen.');
        services.push({ ...service, port, url: `http://127.0.0.1:${port}/` });
      }
      if (generation !== this.generation) return;
      const shared = Object.fromEntries(services.map(service => [`AURA_SERVICE_${service.id.replace(/-/g, '_').toUpperCase()}_URL`, service.url]));
      for (const service of services) {
        const cwd = await serviceDirectory(this.root, service.cwd), [program, ...input] = service.command;
        const args = input.map(arg => arg.replace(/\{host\}/g, '127.0.0.1').replace(/\{port\}/g, String(service.port)));
        if (program === 'npm') args.unshift(review.executables.npm);
        const child = launch(review.executables.services[service.id], args, cwd, service.label, { ...env, ...shared, HOST: '127.0.0.1', PORT: String(service.port), PYTHONUNBUFFERED: '1' });
        child.once('error', () => void failed(`${service.label} kunne ikke startes. Kontrollér program og argumenter.`));
        child.once('exit', code => { if (generation === this.generation) void failed(`${service.label} stoppede${code === null ? '' : ` med kode ${code}`}. Se procesloggen.`); });
      }
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline && generation === this.generation) {
        const probe = async (url, i) => { try { const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(500) }); await response.body?.cancel(); return response.status < (i === 0 ? 400 : 500); } catch { return false; } };
        const ready = await Promise.all(services.map(async (service, i) => {
          if (await probe(service.url, i)) return true;
          // Kun den første tjeneste (siden) kan følge serverens egen adresse, fordi loggen deles af alle tjenester.
          const announced = i === 0 ? announcedURL(this.output) : null;
          if (announced && announced !== service.url && await probe(announced, i)) { service.url = announced; service.port = Number(new URL(announced).port); return true; }
          return false;
        }));
        if (generation !== this.generation) return;
        if (ready.every(Boolean)) {
          this.services = services.map(({ id, label, url, port }) => ({ id, label, url, port })); this.url = services[0].url;
          this.update('running', 'Forhåndsvisningen kører.'); return;
        }
        await delay(150);
      }
      if (generation === this.generation) throw Error('De lokale tjenester blev ikke klar. De skal bruge de viste porte og lytte på 127.0.0.1. Se procesloggen, og ret opstarten.');
    })().catch(error => void failed(error.message));
    return this.snapshot();
  }
  async stop() {
    if (this.stopping) return this.stopping;
    clearTimeout(this.timer);
    this.review = null; ++this.generation; this.url = null; this.services = []; this.activeConfig = null;
    const child = this.child; this.child = null;
    const children = [...new Set([child, ...this.children].filter(Boolean))]; this.children = [];
    if (!children.length) { if (this.root) this.update('stopped', 'Forhåndsvisningen er stoppet.'); return; }
    this.update('stopping');
    this.stopping = Promise.all(children.map(terminate)).then(() => this.update('stopped', 'Handlingen er stoppet. Filer og eventuelt delvist installerede pakker er bevaret.')).finally(() => { this.stopping = null; });
    return this.stopping;
  }
}
module.exports = { appendOutput, announcedURL, DevServer, inspect, environment, cleanOutput, nodeRuntime, terminate, findProgram };
