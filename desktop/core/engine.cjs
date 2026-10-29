const { spawn, execFile } = require('node:child_process');
const { promisify, isDeepStrictEqual } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const run = promisify(execFile);
const { EngineEvents } = require('./engine-events.cjs');
const { setTimeout: delay } = require('node:timers/promises');
// Skal svare til runtime-lock.json, som ikke kommer med i den pakkede app. En unit-test holder de to ens.
const VERSION = '1.18.33';

// Første opstart kan være langsom, fordi macOS eller et antivirusprogram kontrollerer motoren, før den må køre.
const VERSION_CHECK_MS = 120000;
const SUMMARIZE_TIMEOUT_MS = 20 * 60 * 1000;
let verified = null;
// Vagtprocessen tager kun en fuld sti eller programnavnet opencode. Et andet programnavn, fx fra HARNESS_OPENCODE_PATH,
// slås op i PATH, så vagtprocessen får den fulde sti.
async function guardedProgram(executable) {
  if (path.isAbsolute(executable) || executable === 'opencode') return executable;
  if (executable.includes(path.sep)) return path.resolve(executable);
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(entry => path.isAbsolute(entry))) {
    const candidate = path.join(directory, executable);
    try { await fs.access(candidate, require('node:fs').constants.X_OK); return candidate; } catch { /* Prøv næste mappe. */ }
  }
  throw new Error('AI-motoren blev ikke fundet: ' + executable);
}
async function findExecutable({ bundled = require('./runtime.cjs').get(), timeout = VERSION_CHECK_MS } = {}) {
  const binary = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  // Under udvikling bruges den version, `npm run runtime:prepare` har hentet og kontrolleret, før en eventuel egen installation.
  const prepared = path.join(__dirname, '..', '.runtime', `${process.platform}-${process.arch}`, 'opencode', 'bin', binary);
  const candidates = bundled ? [bundled.opencode] : [process.env.HARNESS_OPENCODE_PATH, prepared, path.join(os.homedir(), '.opencode', 'bin', binary), 'opencode'].filter(Boolean);
  let slow = false;
  for (const file of candidates) {
    if (file === verified) return file;
    try { const result = await run(file, ['--version'], { timeout, windowsHide: true }); if (result.stdout.trim() === VERSION) return (verified = file); }
    catch (error) { if (error.killed) slow = true; /* Prøv næste eksplicitte installationsplacering. */ }
  }
  // Den pakkede app har sin egen motor. Brugeren skal have en forklaring, de kan handle på, ikke en udviklerkommando.
  if (bundled) throw new Error(slow
    ? 'Aura kunne ikke starte sin AI-motor i tide. Computeren kan være travl, eller et antivirusprogram kan være ved at kontrollere programmet. Vent lidt, og prøv igen.'
    : 'Aura kan ikke starte sin AI-motor. Installer appen igen fra det link, du fik.');
  throw new Error(`OpenCode ${VERSION} blev ikke fundet. Kør npm run runtime:prepare, eller angiv HARNESS_OPENCODE_PATH ved start. Din eksisterende installation ændres ikke.`);
}
const SKILL_NAME = /^harness-[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_FILE = /^(SKILL\.md|references\/[a-z0-9-]+\.md)$/;
// OpenCode sammenligner fil- og læsetilladelser med stien i forhold til projektets Git-rod, eller til computerens rod uden Git.
// En mappe spærres derfor både som "mappe/…" og "…/mappe/…"; en fuld sti ville aldrig blive ramt. Sidste regel, der passer, gælder.
const everywhere = dir => [`${dir}/*`, `*/${dir}/*`];
// Aktive skills ligger i motorens egen konfigurationsmappe uden for projektet. Mappens navn er projektets nøgle, så mønsteret kun rammer den.
const skillPattern = directory => `*/${path.basename(directory)}/config/skills/*`;
function permissions(root, references, mode = 'free', skills = null) {
  const read = { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.key': 'deny', '*.pem': 'deny', '*.env:*': 'deny', '*.key:*': 'deny', '*.pem:*': 'deny' };
  // NTFS kan åbne samme fil via fx nøgle.key::$DATA. Et andet navn på dens
  // datastrøm ophæver ikke beskyttelsen, heller ikke før Auras godkendelseskort.
  for (const dir of ['.git', 'secrets', 'references']) for (const pattern of [...everywhere(dir), `${dir}:*`, `*/${dir}:*`]) read[pattern] = 'deny';
  // Udvalgte referencer har et unikt filnavn fra appen, så mønsteret kun rammer den valgte fil.
  for (const file of references) for (const pattern of [file, `*/${file}`]) read[pattern] = 'allow';
  const external = { '*': 'ask' };
  let skill = 'deny';
  if (skills?.names.length) {
    const pattern = skillPattern(skills.directory);
    read[pattern] = 'allow'; external[pattern] = 'allow';
    // Kun de skills, brugerens funktioner har slået til, kan hentes. OpenCodes egne skills er skjult.
    skill = { '*': 'deny', ...Object.fromEntries(skills.names.map(name => [name, 'allow'])) };
  }
  if (['chat', 'plan'].includes(mode)) return { '*': 'deny', read, glob: 'allow', list: 'allow', grep: 'ask', webfetch: 'ask', external_directory: external, skill, question: 'allow' };
  const edit = { '*': 'ask', '*.env*': 'deny', '*.key': 'deny', '*.pem': 'deny', '*.key:*': 'deny', '*.pem:*': 'deny' };
  for (const pattern of [...everywhere('.git'), '.git:*', '*/.git:*']) edit[pattern] = 'deny';
  if (skills?.names.length) edit[skillPattern(skills.directory)] = 'deny';
  return { '*': 'ask', read, glob: 'allow', grep: 'ask', list: 'allow', edit, bash: 'ask', external_directory: external, webfetch: 'ask', websearch: 'deny', task: 'deny', skill, lsp: 'deny', question: 'allow', todowrite: 'allow', todoread: 'allow' };
}
// Motorens skillmappe skrives forfra ved hver start, så en fravalgt skill eller en gammel tilpasning ikke bliver liggende.
async function writeSkills(directory, skills) {
  const root = path.join(directory, 'config', 'skills');
  await fs.rm(root, { recursive: true, force: true });
  for (const skill of skills) {
    if (!SKILL_NAME.test(skill.name) || !skill.files.some(file => file.path === 'SKILL.md')) throw new Error(`Skillen ${skill.name} er ugyldig.`);
    for (const file of skill.files) {
      if (!SKILL_FILE.test(file.path) || typeof file.content !== 'string') throw new Error(`Skillen ${skill.name} indeholder en ugyldig fil.`);
      const target = path.join(root, skill.name, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const references = skill.files.filter(item => item.path.startsWith('references/'));
      const content = file.path === 'SKILL.md' && references.length
        ? file.content + '\n\n## Referencefiler i denne kørsel\n\nLæs referencer med read-værktøjet og disse præcise filstier. De er en del af denne skill, ikke projektets private references-mappe.\n' + references.map(item => `- ${JSON.stringify(path.join(root, skill.name, item.path))}`).join('\n') + '\n'
        : file.content;
      await fs.writeFile(target, content, { mode: 0o600 });
    }
  }
}
function engineConfig(provider, model, permission) {
  return { $schema: 'https://opencode.ai/config.json', model: `harness/${model.id}`, small_model: `harness/${model.id}`, enabled_providers: ['harness'], provider: { harness: provider }, permission, agent: { plan: { permission } }, share: 'disabled', autoupdate: false, snapshot: false, plugin: [], mcp: {}, lsp: false, formatter: false };
}
function isolatedEnv(directory, config, password, { commandIsolation = false } = {}) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) if (process.env[key]) env[key] = process.env[key];
  for (const [key, sub] of Object.entries({ XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state' })) env[key] = path.join(directory, sub);
  // OpenCode søger altid også i HOME/.opencode, selv med projektkonfiguration slået fra.
  // Motorens plugins, pakker og hjælpeprocesser må kun bruge Auras egne mapper.
  env.HOME = path.join(directory, 'home'); env.USERPROFILE = env.HOME;
  Object.assign(env, { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG_DIR: path.join(directory, 'config'), OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'harness', OPENCODE_CLIENT: 'harness' });
  if (process.platform !== 'win32' && commandIsolation) env.SHELL = '/bin/bash';
  for (const flag of ['DISABLE_PROJECT_CONFIG', 'DISABLE_DEFAULT_PLUGINS', 'DISABLE_EXTERNAL_SKILLS', 'DISABLE_CLAUDE_CODE', 'DISABLE_AUTOUPDATE', 'DISABLE_MODELS_FETCH', 'DISABLE_LSP_DOWNLOAD', 'DISABLE_SHARE', 'DISABLE_EMBEDDED_WEB_UI']) env[`OPENCODE_${flag}`] = 'true';
  // OpenCode tilbyder kun spørgeværktøjet til sine egne klienter. Aura viser spørgsmålene selv, ét ad gangen med klikbare svar.
  env.OPENCODE_ENABLE_QUESTION_TOOL = 'true';
  // OpenCode 1.x sender højst 32.000 tokens pr. svar, uanset modellen. En tænkende model kunne bruge hele loftet på at
  // tænke og stoppe uden svar. Loftet hæves til Auras højeste, så modellens egen grænse i opsætningen bestemmer.
  env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = String(require('./connections.cjs').OUTPUT_CEILING);
  return require('./runtime.cjs').gitEnvironment(env);
}
const pluginModules = () => path.join(__dirname, '..', 'node_modules').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
async function pluginRuntimeFiles() {
  const seen = new Set(), modules = path.join(__dirname, '..', 'node_modules');
  async function visit(folder) {
    folder = await fs.realpath(folder); if (seen.has(folder)) return; seen.add(folder);
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies || {})) {
      let base = folder, target;
      while (true) {
        target = path.join(base, 'node_modules', name);
        if (await fs.access(path.join(target, 'package.json')).then(() => true, () => false)) break;
        const parent = path.dirname(base); if (parent === base) throw new Error('En låst plugin-afhængighed mangler: ' + name); base = parent;
      }
      await visit(target);
    }
  }
  await visit(path.join(modules, '@opencode-ai', 'plugin'));
  return [...seen];
}
async function pluginRuntimePatterns() {
  const files = await pluginRuntimeFiles(), patterns = new Set();
  for (const folder of files) {
    const { name } = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    // electron-builder kan flytte en nested afhængighed til node_modules-roden.
    // Den eksterne motor kan ikke falde tilbage til en kopi inde i app.asar.
    patterns.add(path.relative(path.join(__dirname, '..'), folder).split(path.sep).join('/') + '/**/*');
    patterns.add(`node_modules/${name}/**/*`);
    patterns.add(`node_modules/**/node_modules/${name}/**/*`);
  }
  return [...patterns];
}
async function writePluginRuntime(directory) {
  const modules = await fs.realpath(pluginModules());
  const sdk = JSON.parse(await fs.readFile(path.join(modules, '@opencode-ai', 'plugin', 'package.json'), 'utf8'));
  if (sdk.version !== VERSION) throw new Error('Plugin-understøttelsen matcher ikke Auras AI-motor. Installer appen igen.');
  // OpenCode venter på npm-installation før enhver lokal plugin. Den låste SDK følger med appen;
  // et lokalt modul-link og en tilhørende lockfil gør denne opstart uafhængig af nettet.
  for (const folder of [path.join(directory, 'config'), path.join(directory, 'config', 'opencode')]) {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const target = path.join(folder, 'node_modules');
    const previous = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (previous && await fs.realpath(target).catch(() => null) !== modules) await fs.rm(target, { recursive: true, force: true });
    if (!previous || await fs.realpath(target).catch(() => null) !== modules) await fs.symlink(modules, target, process.platform === 'win32' ? 'junction' : 'dir');
    const dependencies = { '@opencode-ai/plugin': VERSION };
    for (const name of ['package.json', 'package-lock.json']) await fs.readFile(path.join(folder, name), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'aura-agent-plugins', private: true, dependencies }), { mode: 0o600 });
    await fs.writeFile(path.join(folder, 'package-lock.json'), JSON.stringify({ name: 'aura-agent-plugins', lockfileVersion: 3, packages: { '': { dependencies }, 'node_modules/@opencode-ai/plugin': { version: VERSION } } }), { mode: 0o600 });
  }
}
// Funktionen indlejres i en lokal plugin, så kontrollen sker før OpenCodes read.
// Den bruger kun Nodes indbyggede moduler og virker også uden kommandosandbox.
function createReadGuard({ fs, path, root, references = [], selectedFiles = [] }) {
  const selected = new Set([...references.map(file => path.resolve(root, file)), ...selectedFiles]);
  const protectedFile = file => file.split(/[\\/]/).some(component => {
    const name = component.split(':')[0].replace(/[. ]+$/, '').toLowerCase();
    return ['.git', 'secrets', 'references'].includes(name) || name.startsWith('.env') || /\.(key|pem)$/.test(name);
  });
  return async (input, output) => {
    if (input.tool !== 'read') return;
    const file = output.args?.filePath;
    if (typeof file !== 'string' || !file || /[\0\r\n]/.test(file)) throw new Error('Aura beskytter denne fil: stien kan ikke læses sikkert.');
    const requested = path.resolve(root, file);
    // En valgt reference må kun åbne præcis den valgte fil, ikke et nyt linkmål.
    if (protectedFile(requested) && !selected.has(requested)) throw new Error('Aura beskytter denne fil.');
    const actual = await fs.realpath(requested);
    if ((protectedFile(requested) || protectedFile(actual)) && !selected.has(actual)) throw new Error('Aura beskytter denne fil.');
    // OpenCodes egen eksterne-mappekontrol og læsetilladelse ser det faktiske mål.
    output.args.filePath = actual;
  };
}
async function writeReadGuard(directory, root, references, skills = []) {
  root = await fs.realpath(root);
  const pluginPath = path.join(directory, 'read-guard.mjs'), readyPath = path.join(directory, 'read-guard-ready.json'), token = randomBytes(32).toString('hex');
  const selectedFiles = skills.flatMap(skill => skill.files.map(file => path.join(directory, 'config', 'skills', skill.name, file.path)));
  await fs.rm(readyPath, { force: true });
  const source = `import fs from 'node:fs/promises';\nimport path from 'node:path';\nconst guard = (${createReadGuard.toString()})({ fs, path, root: ${JSON.stringify(root)}, references: ${JSON.stringify(references)}, selectedFiles: ${JSON.stringify(selectedFiles)} });\nexport const AuraReadProtection = async () => {\n await fs.writeFile(${JSON.stringify(readyPath)}, ${JSON.stringify(JSON.stringify({ token }))}, { mode: 0o600 });\n return { 'tool.execute.before': guard };\n};\n`;
  await fs.writeFile(pluginPath, source, { mode: 0o600 });
  return { pluginURL: pathToFileURL(pluginPath).href, readyPath, token };
}
class OpenCodeEngine {
  // resume: en tidligere OpenCode-session for samme samtale. Findes den ikke længere, oprettes en ny.
  constructor({ root, directory, provider, model, references = [], mode = 'free', skills = [], resume = null, sandbox = null, detached = false, recovery = {}, onEvent = () => {} }) { Object.assign(this, { root, directory, provider, model, references, mode, skills, resume, sandbox, detached, recovery, onEvent }); this.promptEpoch = 0; this.closedPermissions = new Set(); this.closedQuestions = new Set(); this.pendingQuestions = new Map(); this.pending = new Map(); this.active = false; this.resumed = false; }
  async request(url, method = 'GET', body, signal) {
    const response = await fetch(`${this.url}${url}`, { method, headers: { authorization: this.auth, 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(this.root) }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal || AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw Object.assign(new Error(`Agentmotoren afviste handlingen (HTTP ${response.status}).`), { status: response.status });
    if (response.status === 204) return null;
    return response.json();
  }
  // Fortsætter samtalens tidligere OpenCode-session, hvis motoren stadig kender den; ellers oprettes en ny.
  async openSession() {
    this.resumed = false;
    if (typeof this.resume === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(this.resume)) {
      try { const session = await this.request(`/session/${this.resume}`); if (session?.id === this.resume) { this.session = session; this.resumed = true; } } catch { /* Sessionen findes ikke længere. */ }
    }
    if (!this.resumed) this.session = await this.request('/session', 'POST', { title: 'Aura' });
    return this.session;
  }
  async start() {
    const executable = await findExecutable();
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.directory = await fs.realpath(this.directory);
    await fs.mkdir(path.join(this.directory, 'home'), { recursive: true, mode: 0o700 });
    await writeSkills(this.directory, this.skills);
    await writePluginRuntime(this.directory);
    const readGuard = await writeReadGuard(this.directory, this.root, this.references, this.skills);
    const password = randomBytes(32).toString('hex');
    this.auth = `Basic ${Buffer.from(`harness:${password}`).toString('base64')}`;
    const permission = permissions(this.root, this.references, this.mode, { directory: this.directory, names: this.skills.map(skill => skill.name) });
    if (this.sandbox) {
      const trustedPattern = `*/${path.basename(path.dirname(this.sandbox.policyPath))}/*`;
      permission.read[trustedPattern] = 'deny';
      if (typeof permission.edit === 'object') permission.edit[trustedPattern] = 'deny';
      permission.external_directory[trustedPattern] = 'deny';
    }
    this.config = engineConfig(this.provider, this.model, permission);
    this.config.plugin = [readGuard.pluginURL, ...(this.sandbox ? [this.sandbox.pluginURL] : [])];
    if (/\{(?:env|file):/.test(JSON.stringify(this.config))) throw new Error('Konfigurationen indeholder en ikke tilladt variabelhenvisning.');
    // Terminalklienten styrer Stop via API'et; dens Ctrl+C må ikke også ramme motorens procesgruppe.
    const args = ['serve', '--hostname', '127.0.0.1', '--port', '0'], env = isolatedEnv(this.directory, this.config, password, { commandIsolation: Boolean(this.sandbox) });
    this.enginePID = null;
    if (process.platform === 'win32') this.child = spawn(executable, args, { cwd: this.root, env, detached: this.detached, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    else {
      // På macOS og Linux startes OpenCode gennem en vagtproces, så motoren også stopper, hvis Aura eller CLI'en
      // forsvinder brat. Vagtprocessen kører med appens egen Node eller Electron som Node. Efter forslag i #31.
      const guardian = path.join(__dirname, 'engine-guardian.cjs').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      const node = require('./runtime.cjs').get()?.node || process.execPath;
      // Vagtprocessen har sin egen procesgruppe, så et signal til hele Auras gruppe ikke rammer den og ejeren samtidig.
      // Den opdager ejerens død gennem IPC-forbindelsen.
      this.child = spawn(node, [guardian, await guardedProgram(executable), ...args], { cwd: this.root, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      this.child.on('message', message => { if (message?.type === 'engine' && Number.isInteger(message.pid)) this.enginePID = message.pid; });
    }
    // Ingen rå proceslogs sendes til UI; de kan indeholde projektindhold.
    this.child.stderr.resume();
    this.child.on('exit', () => {
      if (!this.active) return;
      // Forsvinder vagtprocessen uventet, stoppes motorens procesgruppe her, så den ikke lever videre uden ejer.
      if (this.enginePID) { try { process.kill(-this.enginePID, 'SIGKILL'); } catch { /* Gruppen er allerede væk. */ } }
      this.active = false; this.handleEvent({ type: 'engine.error', message: 'Agentmotoren stoppede. Start opgaven igen for at oprette en ny session.', failure: { kind: 'engine' } });
    });
    try {
      this.url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Agentmotoren kunne ikke starte. Kontrollér installationen.')), 30000);
        let output = '';
        const done = callback => value => { clearTimeout(timer); callback(value); };
        this.child.once('error', done(() => reject(new Error('Agentmotoren kunne ikke startes.'))));
        this.child.once('exit', done(() => reject(new Error('Agentmotoren afsluttede under opstart.'))));
        this.child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-8000); const found = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (found) done(resolve)(found[0]); });
      });
      const health = await this.request('/global/health');
      if (health.version !== VERSION) throw new Error('Agentmotorens version matcher ikke den afprøvede version.');
      const effective = await this.request('/config');
      if (effective.small_model !== this.config.small_model || !isDeepStrictEqual(effective.enabled_providers, ['harness']) || effective.provider?.harness?.npm !== this.provider.npm || effective.provider?.harness?.options?.baseURL !== this.provider.options.baseURL || effective.provider?.harness?.options?.apiKey !== this.provider.options.apiKey || effective.model !== this.config.model || effective.share !== 'disabled' || effective.snapshot !== false || !isDeepStrictEqual(effective.permission, permission) || !isDeepStrictEqual(effective.agent?.plan?.permission, permission) || Object.keys(effective.mcp || {}).length || !isDeepStrictEqual(effective.plugin || [], this.config.plugin)) throw new Error('Agentens effektive indstillinger afviger. En lokal eller administreret konfiguration kan være årsagen.');
      const readReady = await fs.readFile(readGuard.readyPath, 'utf8').then(JSON.parse).catch(() => null);
      if (readReady?.token !== readGuard.token) throw new Error('Filbeskyttelsen blev ikke indlæst. Opgaven blev ikke startet.');
      if (this.sandbox) {
        const ready = await fs.readFile(this.sandbox.readyPath, 'utf8').then(JSON.parse).catch(() => null);
        if (ready?.token !== this.sandbox.readyToken || ready?.identity !== this.sandbox.identity) throw new Error('Kommandobeskyttelsen blev ikke indlæst. Opgaven blev ikke startet.');
      }
      await this.openSession();
      this.active = true;
      this.listen();
      await this.eventStream.ready;
      return this.session.id;
    } catch (error) { await this.close(); throw error; }
  }
  async listen() {
    this.eventStream?.close();
    this.eventStream = new EngineEvents(this, this.recovery);
    this.eventsAbort = this.eventStream.controller;
    return this.eventStream.run();
  }
  handleEvent(event) {
    const props = event.properties || {}, sessionID = props.sessionID || props.part?.sessionID || props.info?.sessionID;
    if (sessionID && sessionID !== this.session?.id) return;
    if (!this.compaction && event.type === 'session.status' && props.status?.type === 'idle') return this.handleEvent({ type: 'session.idle', properties: props });
    // A delayed snapshot/idle from the completed turn must not terminate the
    // next ChatSession while it is preparing its new prompt. Only messages owned
    // by this prompt can open/complete the turn, even in the same server session.
    if (this.promptID && !this.compaction) {
      const terminal = event.type === 'session.idle' || event.type === 'session.status' && props.status?.type === 'idle';
      const turnEvent = terminal || event.type.startsWith('message.') || event.type.startsWith('permission.') || event.type.startsWith('question.');
      if (turnEvent && this.completedPromptID === this.promptID) return;
      if (event.type === 'message.updated') {
        const info = props.info;
        if (info?.id !== this.promptID && info?.parentID !== this.promptID) return;
        this.currentMessageIDs ||= new Set(); this.currentMessageIDs.add(info.id);
        if (info.role === 'assistant') this.currentReplySeen = true;
      }
      const messageID = props.part?.messageID || props.messageID;
      if (event.type.startsWith('message.part.') && messageID && !this.currentMessageIDs?.has(messageID)) return;
      if (terminal) {
        if (!this.currentReplySeen) return;
        this.completedPromptID = this.promptID;
      }
    }
    // OpenCode udsender både status-idle og session.idle. Status er også en autoritativ afslutning;
    // ChatSession deduplikerer dem med sin igangværende finalisering.
    if (event.type === 'permission.asked') {
      // Preserve the exact object bound to an in-flight approval. Reconnection
      // must neither duplicate its dialog nor re-use an already answered request.
      if (this.pending.has(props.id) || this.closedPermissions.has(props.id)) return;
      this.pending.set(props.id, props);
    }
    if (event.type === 'question.asked') { if (this.pendingQuestions.has(props.id) || this.closedQuestions.has(props.id)) return; this.pendingQuestions.set(props.id, props); }
    if (['question.replied', 'question.rejected'].includes(event.type)) { this.pendingQuestions.delete(props.requestID || props.id); this.closedQuestions.add(props.requestID || props.id); }
    if (event.type === 'permission.replied') { this.pending.delete(props.requestID); this.closedPermissions.add(props.requestID); }
    const compaction = this.compaction;
    if (!compaction && event.type === 'message.updated' && props.info?.role === 'assistant') {
      if (props.info.time?.completed && props.info.finish && props.info.finish !== 'tool-calls') this.watchCompletion(props.info.id);
      else this.cancelCompletionCheck();
    }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) this.cancelCompletionCheck();
    this.onEvent(compaction ? { ...event, compacting: true } : event);
    if (compaction && event.type === 'session.idle') compaction.resolve();
    if (compaction && ['session.error', 'engine.error'].includes(event.type)) compaction.reject(new Error(event.message || props.error?.data?.message || 'Samtalen kunne ikke sammenfattes.'));
  }
  async send(text, system) {
    if (!this.active) throw new Error('Agenten er ikke startet.');
    this.cancelCompletionCheck(); ++this.promptEpoch;
    // OpenCode's IDs sort by their timestamp prefix. Supply an explicit ID so a
    // lost HTTP acknowledgement can be checked without posting the prompt twice.
    const time = ((BigInt(Date.now()) * 4096n) & ((1n << 48n) - 1n)).toString(16).padStart(12, '0');
    const messageID = this.promptID = 'msg_' + time + randomBytes(7).toString('hex');
    this.currentReplySeen = false; this.currentMessageIDs = new Set([messageID]);
    const epoch = this.promptEpoch, signal = this.eventsAbort?.signal;
    try {
      return await this.request(`/session/${this.session.id}/prompt_async`, 'POST', { messageID, model: { providerID: 'harness', modelID: this.model.id }, agent: ['chat', 'plan'].includes(this.mode) ? 'plan' : 'build', system, parts: [{ type: 'text', text }] });
    } catch (error) {
      if (error.status && error.status < 500 || signal?.aborted) throw error;
      for (const wait of this.recovery.delays || [500, 1500, 3000]) {
        if (epoch !== this.promptEpoch || !this.active || signal?.aborted) throw error;
        this.handleEvent({ type: 'engine.recovery', recovery: { phase: 'checking' } });
        await delay(wait, undefined, { signal });
        try {
          const messages = await this.messages(), statuses = await this.request('/session/status');
          if (epoch !== this.promptEpoch || signal?.aborted) throw error;
          if (messages.some(m => m.info?.id === messageID && m.info.role === 'user') &&
              (statuses?.[this.session.id]?.type === 'busy' || messages.some(m => m.info?.parentID === messageID && m.info?.time?.completed))) {
            if (this.eventStream) { this.eventStream.snapshotMode = true; await this.eventStream.reconcile(); }
            this.handleEvent({ type: 'engine.recovery', recovery: { phase: 'recovered' } }); return;
          }
        } catch { /* A failed read is not permission to repeat the POST. */ }
      }
      throw new Error('Det kunne ikke bekræftes, om agenten modtog beskeden. Aura sender den ikke igen automatisk, så handlinger ikke gentages.');
    }
  }
  async abort() { ++this.promptEpoch; this.eventStream?.close(); this.cancelCompletionCheck(); this.cancelCompaction(); if (this.session && this.url) await this.request(`/session/${this.session.id}/abort`, 'POST'); this.pending.clear(); this.pendingQuestions.clear(); }
  cancelCompletionCheck() { clearTimeout(this.completionTimer); this.completionTimer = null; this.completionCheck = null; }
  watchCompletion(message) {
    this.cancelCompletionCheck();
    const check = this.completionCheck = { message, errors: 0 };
    const poll = async () => {
      if (!this.active || this.compaction || this.completionCheck !== check) return;
      try { if (await this.verifyCompletion(check)) return; check.errors = 0; }
      catch {
        if (this.completionCheck !== check) return;
        if (++check.errors >= 3) { this.handleEvent({ type: 'engine.error', message: 'Svaret er modtaget, men agentens afslutning kunne ikke bekræftes. Opgaven er standset; gennemgå resultatet.', failure: { kind: 'engine' } }); await this.abort().catch(() => {}); return; }
      }
      if (this.completionCheck === check) this.completionTimer = setTimeout(poll, 1500);
    };
    this.completionTimer = setTimeout(poll, 1000);
  }
  async verifyCompletion(check) {
    const statuses = await this.request('/session/status');
    if (!this.active || this.compaction || this.completionCheck !== check || this.pending.size || this.pendingQuestions.size) return false;
    if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) throw new Error('Ugyldig sessionsstatus.');
    // OpenCode udelader idle-sessioner fra statusoversigten. Kontrollen starter kun efter en faktisk
    // afsluttet assistant-message med finish-kode, aldrig på baggrund af tekst som "Færdig".
    const status = statuses[this.session.id];
    if (!status || status.type === 'idle') { this.handleEvent({ type: 'session.idle', recovered: true, properties: { sessionID: this.session.id } }); return true; }
    return false;
  }
  // En afvisning med en besked stopper ikke opgaven: AI'en får beskeden som rettelse og fortsætter.
  async reply(id, allow, message) { if (!this.pending.has(id)) throw new Error('Godkendelsen findes ikke længere.'); await this.request(`/permission/${encodeURIComponent(id)}/reply`, 'POST', { reply: allow ? 'once' : 'reject', ...(!allow && message ? { message } : {}) }); this.pending.delete(id); this.closedPermissions.add(id); }
  async messages() { return this.request(`/session/${this.session.id}/message`); }
  // OpenCode sammenfatter samtalen med samme model og fortsætter fra sammenfatningen. Planen og filerne røres ikke.
  async summarize({ timeout = SUMMARIZE_TIMEOUT_MS } = {}) {
    if (!this.active) throw new Error('Agenten er ikke startet.');
    if (this.compaction) throw new Error('Samtalen er allerede ved at blive sammenfattet.');
    const controller = new AbortController(), operation = { controller };
    const idle = new Promise((resolve, reject) => { operation.resolve = resolve; operation.reject = reject; });
    this.compaction = operation;
    const timer = setTimeout(() => this.cancelCompaction(new Error('Sammenfatningen tog for lang tid. Prøv igen.')), timeout);
    try {
      // summarize er et modelkald, ikke en almindelig 15-sekunders kontrol. Begge kanaler skal være afsluttet,
      // før næste prompt starter; et sent idle fra sammenfatningen må ikke afslutte brugerens nye opgave.
      const request = this.request(`/session/${this.session.id}/summarize`, 'POST', { providerID: 'harness', modelID: this.model.id, auto: false }, controller.signal).then(async result => {
        operation.httpCompleted = true;
        if (this.eventStream?.snapshotMode) await this.eventStream.settle();
        return result;
      });
      const [result] = await Promise.all([request, idle]);
      return result;
    } finally { clearTimeout(timer); controller.abort(); if (this.compaction === operation) this.compaction = null; }
  }
  cancelCompaction(error = new Error('Sammenfatningen blev stoppet.')) { if (this.compaction) { this.compaction.controller.abort(error); this.compaction.reject(error); } }
  async diff() { return this.request(`/session/${this.session.id}/diff`); }
  async close() {
    ++this.promptEpoch; this.eventStream?.close(); this.pendingQuestions.clear();
    // Er vagtprocessen allerede væk, stoppes motorens gruppe direkte.
    if (this.child && this.child.exitCode !== null && this.enginePID) { try { process.kill(-this.enginePID, 'SIGKILL'); } catch { /* Gruppen er allerede væk. */ } }
    this.cancelCompletionCheck(); this.cancelCompaction(); this.active = false; this.eventsAbort?.abort(); this.pending.clear(); if (this.child && this.child.exitCode === null) { this.child.kill(); await new Promise(resolve => { const timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 3000); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); }); } }
}
module.exports = { OpenCodeEngine, findExecutable, isolatedEnv, permissions, engineConfig, writeSkills, writePluginRuntime, pluginRuntimeFiles, pluginRuntimePatterns, createReadGuard, writeReadGuard, VERSION, SUMMARIZE_TIMEOUT_MS };
