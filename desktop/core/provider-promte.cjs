const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const dns = require('node:dns/promises');
const { isIP } = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
const { zip } = require('./komplai-publish.cjs');

// Kontrakten følger den publicerede @promte/app-upload 0.2.0.
// Aura logger selv ind gennem Promtes browsergodkendelse og gemmer adgangen krypteret pr. vært.
// Et login fra Promtes CLI på samme computer bruges, hvis Aura ikke selv er logget ind.
const DEFAULT_HOST = 'https://app.promte.dk';
const LOGIN_TIMEOUT = 10 * 60 * 1000;
const ACCOUNT_REQUIRED = 'Kræver konto og betalt aftale';
const UNREADABLE = 'Promte-svaret kunne ikke kontrolleres. Se udgivelserne i Promte før et nyt forsøg.';
const NO_LIST = 'Denne Promte-installation viser ikke en liste over apps.';
const PROMTE_WEBSITE = 'Promte udgiver kun apps, der er bygget til Promte. Projektet er en almindelig hjemmeside, og den kan Promte ikke tage imod.';
const PROMTE_SETUP = 'Promte udgiver kun apps, der er bygget til Promte. Projektet er ikke sat op, som Promte kræver.';
const SKIP_DIRS = new Set(['node_modules', 'bower_components', '.git', '.hg', '.svn', '.promte-source', '.cache', '.yarn', '.npm', '.pnpm-store', '.turbo', '.vite', '.parcel-cache', '.next', '.nuxt', '.output', 'dist', 'build', 'out', 'coverage', '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', '.ssh', '.aws', '.azure', '.gcloud', '.kube', '.docker', '__macosx', '.claude', '.agents', '.codex', '.cursor', '.idea', '.vscode']);
const SKIP_FILE = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.ds_store|\.yarnrc(?:\.yml)?|\.secrets?|credentials(?:\.[^.]+)?|secrets?\.(?:json|ya?ml|toml)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|promte-app-upload\.config\.json|yarn\.lock|pnpm-lock\.yaml|vite\.config\.[cm]?[jt]s)$|\.(?:pem|key|p12|pfx|keystore|jks|zip|tar|tgz|gz|7z|rar|map|tsbuildinfo|log|pyc|o|so|dll|exe|class)$/i;
const UNSUPPORTED_BUILD_FILE = /^(?:(?:postcss|tailwind|babel|webpack|rollup)\.config\..+|\.babelrc(?:\..*)?|\.postcssrc(?:\..*)?)$/i;
const { isProtected } = require('./protected-paths.cjs');
const ignoredSource = file => isProtected(file) || file.split('/').some(p => SKIP_DIRS.has(p.toLowerCase())) || SKIP_FILE.test(path.posix.basename(file));
const runtimeDependencies = pkg => ({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
function preparePromteArtifact(artifact) {
  let pkg;
  try { pkg = JSON.parse(artifact.files.find(f => f.file === 'package.json')?.data); } catch {}
  const noDependencies = pkg && typeof pkg === 'object' && !Object.keys(runtimeDependencies(pkg)).length;
  const excluded = artifact.files.filter(f => ignoredSource(f.file) || (noDependencies && f.file === 'package-lock.json'));
  const files = artifact.files.filter(f => !excluded.includes(f)).map(f => ({ ...f, sha256: createHash('sha256').update(f.data).digest('hex') }));
  return { ...artifact, files, bytes: files.reduce((sum, f) => sum + f.data.length, 0), hash: createHash('sha256').update(JSON.stringify(files.map(f => [f.file, f.sha256]))).digest('hex'), excludedFiles: [...new Set([...(artifact.excludedFiles || []), ...excluded.map(f => f.file)])] };
}
function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b)));
  }
  if (isIP(address) === 6) return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  return false;
}
function promteHost(value = DEFAULT_HOST) {
  let u; try { u = new URL(value); } catch { throw Error('Angiv Promte-installationens HTTPS-adresse.'); }
  const hostname = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash || !hostname.includes('.') || isIP(hostname.replace(/^\[|\]$/g, '')) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname)) throw Error('Brug en offentlig HTTPS-adresse til Promte uden sti, port eller loginoplysninger.');
  return u.origin;
}
function identifier(value, label = 'arbejdsområdets ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) throw Error(`Angiv ${label} fra Promte.`);
  return value;
}
function promteConfiguration(input) {
  const directory = input.directory || '.';
  if (typeof directory !== 'string' || directory.includes('\\') || directory.includes(':') || directory.includes('\0') || directory.startsWith('/') || directory.split('/').includes('..') || path.posix.normalize(directory) !== directory) throw Error('Vælg en relativ projektmappe uden ..');
  return { provider: 'promte', mode: 'source', host: promteHost(input.host), workspaceId: identifier(input.workspaceId), directory, frontend: '.', api: '' };
}
function validatePromteArtifact(artifact) {
  if (!Array.isArray(artifact.files) || !artifact.files.length || artifact.files.length > 2000) throw Error('Promte kræver 1 til 2.000 kildefiler.');
  let bytes = 0;
  const seen = new Set();
  for (const { file, data } of artifact.files) {
    if (typeof file !== 'string' || !Buffer.isBuffer(data) || /[\x00-\x1f\\:]/.test(file) || file.startsWith('/') || file.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p)) || seen.has(file)) throw Error('Kildepakken indeholder en ugyldig eller gentaget filsti.');
    seen.add(file); bytes += data.length;
    if (ignoredSource(file)) throw Error(`Promte modtager ikke ${file}. Vælg en kildekodemappe uden byggeoutput, nøgler eller særskilt byggekonfiguration.`);
  }
  if (bytes > 50 * 1024 * 1024) throw Error('Promte-kildekoden må højst fylde 50 MB udpakket.');
  const problem = promteProblem([...seen], artifact.files.find(f => f.file === 'package.json')?.data);
  if (problem) throw Error(`${problem.kind === 'website' ? PROMTE_WEBSITE : PROMTE_SETUP} ${problem.detail}`);
}
// Er kildekoden en Promte-app? Promte bygger selv React-apps med sin faste Vite-opsætning. Reglerne bruges både før
// login, på projektets filer, og ved gennemgangen af den gemte version. Svaret er null eller { kind, detail }:
// "website" er et projekt uden package.json, fx en almindelig hjemmeside; "setup" er ikke sat op, som Promte kræver.
function promteProblem(files, manifest) {
  if (manifest === undefined) return { kind: 'website', detail: 'Promte-kildekoden mangler en gyldig package.json.' };
  const problem = detail => ({ kind: 'setup', detail });
  let pkg; try { pkg = JSON.parse(manifest); } catch { return problem('Promte-kildekoden mangler en gyldig package.json.'); }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return problem('package.json skal beskrive et Promte-projekt.');
  const unsupported = files.find(file => UNSUPPORTED_BUILD_FILE.test(path.posix.basename(file)));
  if (unsupported) return problem(`Promte modtager ikke ${unsupported}. Promte bygger med sin egen opsætning, så filen skal fjernes.`);
  const dependencies = runtimeDependencies(pkg);
  if (['react', 'react-dom', '@promte/app-library'].some(p => Object.hasOwn(dependencies, p))) return problem('Flyt react, react-dom og @promte/app-library til devDependencies. Promte leverer dem ved byggeriet.');
  if (Object.keys(dependencies).length && !files.includes('package-lock.json')) return problem('Gem package-lock.json sammen med projektets afhængigheder.');
  if (Object.keys(dependencies).length > 20) return problem('Promte understøtter højst 20 afhængigheder.');
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    if (/^(?:preinstall|install|postinstall|prepare|prebuild|postbuild)$/.test(name) || (name === 'build' && !['vite build', 'tsc && vite build'].includes(script))) return problem('Promte kræver sin faste byggeopsætning. Fjern installationsscripts og brug vite build som build-script.');
  }
  if (!files.includes('index.html') && !files.some(f => /^(?:src\/)?main\.(?:jsx|tsx|js|ts)$/.test(f))) return problem('Promte-kildekoden mangler index.html eller main.jsx/tsx/js/ts i roden eller src.');
  return null;
}
// Før login: projektets filer på disken med Promtes egne udeladelsesregler, så Udgiv kan sige det, før brugeren
// logger ind. Ugemte filer tæller med; selve udgivelsen kontrollerer fortsat den gemte version.
async function promteSourceProblem(root) {
  const files = [];
  async function walk(directory, prefix) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = prefix + entry.name;
      if (files.length > 2000 || ignoredSource(file)) continue;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), file + '/');
      else if (entry.isFile()) files.push(file);
    }
  }
  await walk(root, '');
  // Flere end 2.000 filer afgøres ved gennemgangen, som også kontrollerer grænserne.
  if (files.length > 2000) return null;
  let manifest; try { manifest = await fs.readFile(path.join(root, 'package.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return promteProblem(files, manifest);
}
async function readCredentials(host) {
  const location = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'promte', 'credentials.json');
  try {
    const stat = await fs.stat(location);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const saved = JSON.parse(await fs.readFile(location, 'utf8'))[host];
    return saved && typeof saved.token === 'string' && saved.token.length > 0 && !/[\r\n]/.test(saved.token) ? saved : null;
  } catch { return null; }
}
async function addressFor(host, lookup) {
  let addresses; try { addresses = await lookup(new URL(host).hostname, { all: true }); } catch { throw Error('Promte-adressen kunne ikke findes. Kontrollér adressen og forbindelsen.'); }
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('Promte-adressen må ikke pege på et lokalt eller privat netværk.');
  return addresses[0];
}
// Fasthold den kontrollerede DNS-adresse under selve TLS-forbindelsen.
function pinnedRequest(url, options, address) {
  return new Promise((resolve, reject) => {
    let timer;
    const request = https.request(url, { method: options.method || 'GET', headers: options.headers, lookup: (_host, lookupOptions, done) => lookupOptions?.all ? done(null, [address]) : done(null, address.address, address.family) }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) response.destroy(Error('For stort Promte-svar.')); else chunks.push(chunk); });
      response.on('error', error => { clearTimeout(timer); reject(error); });
      response.on('end', () => { clearTimeout(timer); resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, text: async () => Buffer.concat(chunks).toString('utf8') }); });
    });
    timer = setTimeout(() => request.destroy(Error('Promte svarede ikke.')), options.timeout || 30000);
    request.on('error', error => { clearTimeout(timer); reject(error); }); request.end(options.body);
  });
}
// Auras eget login gemmes krypteret under state.hosting.promte[vært].
async function savedLogin(store, host, now = Date.now()) {
  const saved = store ? (await store.read()).hosting?.promte?.[host] : null;
  if (!saved?.secret || !(Date.parse(saved.expiresAt) > now)) return null;
  return saved;
}
function tokenClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')) || {}; } catch { return {}; }
}
class PromteDeployment {
  constructor({ store, fetcher, readCredentials: reader = readCredentials, lookup = dns.lookup } = {}) { this.id = 'promte'; this.store = store; this.fetcher = fetcher; this.reader = reader; this.lookup = lookup; }
  async token(host) {
    const saved = await savedLogin(this.store, host);
    if (saved) return this.store.decrypt(saved);
    return (await this.reader(host))?.token;
  }
  async call(host, route, { body, token, upload = false, contentType, anonymous = false, accept = [] } = {}) {
    host = promteHost(host);
    const address = await addressFor(host, this.lookup);
    if (!token && !anonymous) token = await this.token(host);
    if (!token && !anonymous) throw Error('Log ind med Promte til den valgte installation.');
    const options = { method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', timeout: upload ? 120000 : 30000, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}) }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) };
    let response, value;
    try { response = await (this.fetcher ? this.fetcher(host + route, { ...options, signal: AbortSignal.timeout(options.timeout) }) : pinnedRequest(host + route, options, address)); const text = await response.text(); if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Error(); value = JSON.parse(text); } catch { throw Error(UNREADABLE); }
    if (accept.includes(response.status) && value && typeof value === 'object') return value;
    if (response.status === 401) throw Error('Promte-login er udløbet eller afvist. Log ind igen.');
    if (response.status === 403) throw Error('Du skal være administrator i Promte-arbejdsområdet for at udgive.');
    if (!response.ok || !value || typeof value !== 'object') throw Error('Promte kunne ikke gennemføre handlingen. Kontrollér arbejdsområde og udgivelser i Promte.');
    return value;
  }
  async inspect(input) {
    const c = promteConfiguration(input);
    const capabilities = await this.call(c.host, '/api/app-upload/capabilities?workspaceId=' + encodeURIComponent(c.workspaceId));
    // Aura sender kildekode, som Promte selv bygger (PR 12). Installationer, der kun tager færdigbyggede apps, får en klar besked.
    if (capabilities.available === true && capabilities.uploadMode === 'built') throw Error('Denne Promte-installation tager kun imod færdigbyggede apps. Aura sender kildekode, som Promte selv bygger, fx på https://kodning.promte.dk. Brug Promtes eget uploadværktøj her, eller vælg en anden Promte-adresse.');
    if (capabilities.available !== true || capabilities.uploadMode !== 'source') throw Error('Denne Promte-installation skal understøtte kildekodeupload. Kontakt administratoren om appbygning og din adgang.');
    // Appens navn vises, hvor Promte kan oplyse det. Ældre installationer viser ID'et.
    let name = c.workspaceId;
    try { const found = (await this.call(c.host, '/api/app-upload/workspaces')).workspaces?.find(w => w?.id === c.workspaceId); if (typeof found?.name === 'string' && found.name.trim()) name = found.name.slice(0, 200); } catch {}
    return { id: c.workspaceId, name, owner: new URL(c.host).hostname, host: new URL(c.host).hostname, portal: `${c.host}/workspaces/${encodeURIComponent(c.workspaceId)}`, region: 'Afhænger af jeres Promte-installation og dens tjenester.', settings: { uploadMode: 'source' }, environmentKeys: [], access: 'Adgang styres i Promte-arbejdsområdet. Kontrollér den med den tilsigtede bruger.', accountRequired: ACCOUNT_REQUIRED, uploadDestinations: [...new Set([c.host, DEFAULT_HOST])], materialNote: 'Kildekoden sendes til den valgte Promte-installation eller Promtes fælles uploadtjeneste på app.promte.dk. Promte bygger og gennemgår versionen.' };
  }
  async deploy(input, artifact, target, { onUploaded = async () => {} } = {}) {
    const c = promteConfiguration(input); validatePromteArtifact(artifact);
    if (target.id !== c.workspaceId || target.host !== new URL(c.host).hostname || target.settings?.uploadMode !== 'source') throw Error('Promte-destinationen har ændret sig. Gennemgå udgivelsen igen.');
    const archive = zip(artifact.files);
    if (archive.length > 20 * 1024 * 1024) throw Error('Promte-kildepakken må højst fylde 20 MB.');
    const prepared = await this.call(c.host, '/api/app-upload/prepare', { body: { workspaceId: c.workspaceId } });
    const version = Number(prepared.version);
    if (!Number.isSafeInteger(version) || version < 1) throw Error('Promte gav ikke et gyldigt versionsnummer. Kontrollér udgivelserne før et nyt forsøg.');
    const pending = { id: `version:${version}`, promteVersion: version, state: 'PREPARED', url: null };
    await onUploaded(pending);
    const uploadHost = prepared.uploadHost === 'same-server' ? c.host : promteHost(prepared.uploadHost || DEFAULT_HOST);
    if (![c.host, DEFAULT_HOST].includes(uploadHost) || typeof prepared.uploadToken !== 'string' || !prepared.uploadToken || /[\r\n]/.test(prepared.uploadToken)) throw Error('Promte gav en uploadadresse eller adgang, som ikke var med i gennemgangen. Kontrollér versionen i Promte.');
    const boundary = 'aura-' + randomUUID();
    const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="source.zip"\r\nContent-Type: application/zip\r\n\r\n`), archive, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    await this.call(uploadHost, '/api/upload-app?' + new URLSearchParams({ workspaceId: c.workspaceId, version: String(version) }), { body: multipart, token: prepared.uploadToken, upload: true, contentType: 'multipart/form-data; boundary=' + boundary });
    await onUploaded({ ...pending, state: 'UPLOADED' });
    const finalized = await this.call(c.host, '/api/app-upload/finalize', { body: { workspaceId: c.workspaceId, version, zipName: 'source.zip', zipSize: archive.length } });
    const result = { ...pending, state: releaseState(finalized.status), ...(typeof finalized.releaseId === 'string' ? { id: identifier(finalized.releaseId, 'versionens ID') } : {}) };
    await onUploaded(result);
    return result;
  }
  async status(input, receipt) {
    const c = promteConfiguration(input);
    if (!Number.isSafeInteger(receipt.promteVersion) || receipt.promteVersion < 1 || receipt.target?.id !== c.workspaceId || receipt.target?.host !== new URL(c.host).hostname) throw Error('Promte-versionen matcher ikke destinationen.');
    const byVersion = receipt.id === `version:${receipt.promteVersion}`;
    const response = await this.call(c.host, '/api/app-upload/releases' + (byVersion ? '' : '/' + encodeURIComponent(identifier(receipt.id, 'versionens ID'))) + '?workspaceId=' + encodeURIComponent(c.workspaceId));
    const release = byVersion ? (Array.isArray(response.releases) ? response.releases : []).find(r => Number(r.version) === receipt.promteVersion) : response.release;
    if (!release) return { state: 'AWAITING_UPDATE', url: null };
    if (Number(release.version) !== receipt.promteVersion || (release.workspaceId && release.workspaceId !== c.workspaceId) || (!byVersion && release.id && release.id !== receipt.id)) throw Error('Promtes status gælder en anden version eller et andet arbejdsområde.');
    // CLI-kontrakten lover ingen bestemt URL i release-svaret. Portal åbnes fra target.
    return { id: typeof release.id === 'string' ? identifier(release.id, 'versionens ID') : receipt.id, state: releaseState(release.status), url: null, promteVersion: receipt.promteVersion };
  }
}
const LOGIN_ENDED = { denied: 'Login blev afvist i Promte.', expired: 'Login udløb, før det blev godkendt. Prøv igen.', consumed: 'Login er allerede brugt. Prøv igen.', not_found: 'Login udløb, før det blev godkendt. Prøv igen.' };
class PromteSetup {
  constructor(store, { fetcher, lookup = dns.lookup, readCredentials: reader = readCredentials, openBrowser = url => require('electron').shell.openExternal(url), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
    this.store = store; this.reader = reader; this.openBrowser = openBrowser; this.sleep = sleep; this.now = now; this.logins = new Map();
    this.client = new PromteDeployment({ store, fetcher, lookup, readCredentials: reader });
  }
  async state({ host = DEFAULT_HOST } = {}) {
    host = promteHost(host);
    const saved = await savedLogin(this.store, host, this.now());
    const cli = saved ? null : await this.reader(host);
    // Aura logger selv ind, så Promtes CLI er ikke længere et krav.
    return { host, installed: true, connected: Boolean(saved || cli?.token), email: saved?.email || '', loginSource: saved ? 'aura' : cli?.token ? 'cli' : null, expiresAt: saved?.expiresAt || null, accountRequired: ACCOUNT_REQUIRED, loginURL: host, signupURL: 'https://promte.com/kontakt' };
  }
  /** Promte viser en godkendelsesside i browseren. Aura venter på svaret og gemmer adgangen krypteret. */
  cancel({ host, owner = '' } = {}) {
    if (host) host = promteHost(host);
    for (const pending of this.logins.values()) if (pending.owner === owner && (!host || pending.host === host)) pending.controller.abort();
    return true;
  }
  cancelAll() { for (const pending of this.logins.values()) pending.controller.abort(); }
  async login({ host = DEFAULT_HOST, owner = '' } = {}) {
    host = promteHost(host);
    const key = JSON.stringify([owner, host]);
    if (this.logins.has(key)) throw Error('Et login er allerede i gang. Afbryd det for at starte igen.');
    // Kontoen deles af projekterne. Et nyt login til samme vært erstatter et ældre
    // forsøg, så en sen browsergodkendelse ikke kan skifte kontoen tilbage.
    for (const earlier of this.logins.values()) if (earlier.host === host) earlier.controller.abort();
    const pending = { host, owner, controller: new AbortController() }; this.logins.set(key, pending);
    const { signal } = pending.controller;
    const check = () => { if (signal.aborted) throw Error('Login blev afbrudt.'); };
    const wait = promise => new Promise((resolve, reject) => {
      const abort = () => reject(Error('Login blev afbrudt.'));
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
      if (signal.aborted) abort();
    });
    try {
    const started = await wait(this.client.call(host, '/api/extension-auth/start', { body: { client: 'aura' }, anonymous: true }));
    let approve; try { approve = new URL(started.approveUrl); } catch {}
    if (typeof started.flowId !== 'string' || typeof started.flowSecret !== 'string' || !approve || approve.protocol !== 'https:' || approve.pathname !== '/extension-connect' || approve.username || approve.password) throw Error('Promte startede ikke et gyldigt login. Kontrollér adressen.');
    promteHost(approve.origin + '/');
    if (this.store) this.store.encrypt('kontrol');
    check(); await wait(this.openBrowser(approve.toString()));
    const deadline = Math.min(this.now() + LOGIN_TIMEOUT, Number(started.expiresAt) || Infinity);
    const route = '/api/extension-auth/status?' + new URLSearchParams({ flowId: started.flowId, flowSecret: started.flowSecret });
    let failures = 0;
    while (this.now() < deadline) {
      check(); await wait(this.sleep(Math.max(1000, Number(started.pollIntervalMs) || 1500)));
      let status;
      try { status = await wait(this.client.call(host, route, { anonymous: true, accept: [404] })); failures = 0; }
      catch { check(); if (++failures >= 3) throw Error('Aura kunne ikke få svar på login fra Promte. Prøv igen, eller kontrollér Promte-adressen.'); continue; }
      check();
      if (status.state === 'approved' && typeof status.token === 'string' && status.token && !/[\r\n]/.test(status.token)) {
        const exp = Number(tokenClaims(status.token).exp);
        const expiresAt = new Date(Number.isFinite(exp) ? exp * 1000 : this.now() + 30 * 86400000).toISOString();
        const email = typeof status.email === 'string' ? status.email.slice(0, 320) : '';
        await this.store.update(state => { check(); state.hosting = { ...state.hosting, promte: { ...state.hosting?.promte, [host]: { secret: this.store.encrypt(status.token), email, expiresAt } } }; });
        return this.state({ host });
      }
      if (LOGIN_ENDED[status.state]) throw Error(LOGIN_ENDED[status.state]);
    }
    throw Error(LOGIN_ENDED.expired);
    } finally { if (this.logins.get(key) === pending) this.logins.delete(key); }
  }
  async logout({ host = DEFAULT_HOST } = {}) {
    host = promteHost(host);
    for (const pending of this.logins.values()) if (pending.host === host) pending.controller.abort();
    await this.store.update(state => { if (state.hosting?.promte) delete state.hosting.promte[host]; });
    return this.state({ host });
  }
  /** App-arbejdsområder, som brugeren må uploade til. Promte bruger samme kontrol som ved upload. */
  async workspaces({ host = DEFAULT_HOST } = {}) {
    // Ældre installationer har ingen appliste og svarer med en almindelig side. Brugeren indtaster da ID'et.
    const value = await this.client.call(host, '/api/app-upload/workspaces').catch(error => { throw error.message === UNREADABLE ? Error(NO_LIST) : error; });
    if (!Array.isArray(value.workspaces)) throw Error(NO_LIST);
    return value.workspaces.filter(w => typeof w?.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(w.id)).slice(0, 500).map(w => ({ id: w.id, name: typeof w.name === 'string' && w.name.trim() ? w.name.slice(0, 200) : w.id, activeAppVersion: Number.isSafeInteger(w.activeAppVersion) ? w.activeAppVersion : null }));
  }
  /** Opretter et nyt app-arbejdsområde med brugeren som ejer, ligesom Promtes egen opret-knap. */
  async createWorkspace({ host = DEFAULT_HOST, name } = {}) {
    host = promteHost(host);
    name = typeof name === 'string' ? name.trim() : '';
    if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) throw Error('Giv appen et navn på højst 100 tegn.');
    const saved = await savedLogin(this.store, host, this.now());
    const token = await this.client.token(host);
    const uid = tokenClaims(token).uid;
    const email = saved?.email;
    if (!token || typeof uid !== 'string' || !uid || !email) throw Error('Log ind med Promte i Aura for at oprette en app.');
    const created = await this.client.call(host, '/api/addDoc', { body: { path: 'workspaces', data: { name, users: { [Buffer.from(email, 'utf8').toString('base64')]: 'owner' }, owner: uid, createdBy: email, type: 'app', deleted: false, published: false } } });
    return { id: identifier(created.id), name, activeAppVersion: null };
  }
}
const RELEASE_STATES = new Map(Object.entries({ published: 'READY', reviewing: 'REVIEWING', pending: 'REVIEWING', building: 'BUILDING', blocked: 'BLOCKED', rejected: 'REJECTED', failed: 'ERROR' }));
function releaseState(status) { return RELEASE_STATES.get(status) || 'UNKNOWN'; }
module.exports = { PromteDeployment, PromteSetup, promteConfiguration, preparePromteArtifact, validatePromteArtifact, promteProblem, promteSourceProblem, PROMTE_WEBSITE, PROMTE_SETUP, promteHost, publicAddress, addressFor, releaseState, DEFAULT_HOST };
