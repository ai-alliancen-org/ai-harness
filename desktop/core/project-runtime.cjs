const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const NETWORK_KINDS = ['scripts', 'connect', 'images', 'styles'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const cleanText = (value, limit = 2000) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
// Skemaet https: er kun tilladt for billeder og medier: det giver ingen kode og ingen stilarter (beslutning for beta 2).
function networkOrigin(value, kind) {
  if (kind === 'images' && value === 'https:') return 'https:';
  let url; try { url = new URL(value); } catch { throw Error('Netadgang skal være en fuld adresse med https.'); }
  if (!cleanText(value, 500) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || value.includes('*') || !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw Error('Angiv kun en præcis serveradresse uden sti, login, parametre eller jokertegn.');
  if (!['https:', 'wss:'].includes(url.protocol) && !LOOPBACK.has(url.hostname)) throw Error('Eksterne tjenester skal bruge https eller wss.');
  return url.origin;
}
function normalizeRuntimeConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Projektets opstart skal være en opsætning.');
  const mode = value.mode ?? 'auto';
  if (!['auto', 'static'].includes(mode)) throw Error('Vælg Automatisk eller Enkel hjemmeside.');
  const result = { mode };
  if (value.services !== undefined) {
    if (!Array.isArray(value.services) || value.services.length > 4) throw Error('Et projekt kan starte højst fire lokale tjenester.');
    const ids = new Set(), ports = new Set();
    result.services = value.services.map((item, i) => {
      if (!item || typeof item !== 'object' || !/^[a-z][a-z0-9-]{0,39}$/.test(item.id || '') || ids.has(item.id)) throw Error('Hver lokal tjeneste skal have sit eget korte ID.');
      ids.add(item.id);
      if (!cleanText(item.label, 100)) throw Error('Giv hver tjeneste et navn.');
      if (!Array.isArray(item.command) || !item.command.length || item.command.length > 64 || item.command.some(arg => !cleanText(arg))) throw Error('En startkommando skal være en liste med program og argumenter.');
      if (!/^[a-zA-Z0-9_.-]+$/.test(item.command[0]) || /^(?:sh|bash|zsh|cmd|powershell|pwsh|npx)(?:\.exe)?$/i.test(item.command[0]) || /\.(?:cmd|bat|ps1)$/i.test(item.command[0])) throw Error('Vælg selve programmet, fx node, npm eller python3; shellkommandoer og npx kan ikke bruges her.');
      const cwd = item.cwd || '.';
      if (!cleanText(cwd, 500) || path.posix.isAbsolute(cwd) || path.win32.isAbsolute(cwd) || /^[a-z]:/i.test(cwd) || cwd.includes('\\') || cwd.split('/').includes('..') || path.posix.normalize(cwd) !== cwd) throw Error('Tjenestens mappe skal ligge i projektet.');
      if (item.port !== undefined && (!Number.isInteger(item.port) || item.port < 1024 || item.port > 65535 || ports.has(item.port))) throw Error('Brug forskellige lokale porte mellem 1024 og 65535.');
      if (item.port) ports.add(item.port);
      const command = [...item.command]; if (/^(?:node|npm)\.exe$/i.test(command[0])) command[0] = command[0].slice(0, -4).toLowerCase();
      return { id: item.id, label: item.label, command, cwd, ...(item.port ? { port: item.port } : {}) };
    });
  }
  if (value.network !== undefined) {
    if (!value.network || typeof value.network !== 'object' || Array.isArray(value.network)) throw Error('Projektets netadgang skal være en opsætning.');
    result.network = {};
    for (const kind of NETWORK_KINDS) {
      const entries = value.network[kind] ?? [];
      if (!Array.isArray(entries) || entries.length > 20) throw Error('Der kan angives højst 20 adresser pr. slags netadgang.');
      result.network[kind] = [...new Set(entries.map(entry => networkOrigin(entry, kind)))];
    }
  }
  return result;
}
function describeRuntime(config = {}) {
  const c = normalizeRuntimeConfig(config);
  return { mode: c.mode, label: c.mode === 'static' ? 'Enkel hjemmeside' : 'Automatisk', services: (c.services || []).map(s => ({ id: s.id, label: s.label, command: s.command.join(' '), cwd: s.cwd, port: s.port || null })), network: c.network || Object.fromEntries(NETWORK_KINDS.map(k => [k, []])) };
}
async function serviceDirectory(root, relative = '.') {
  const base = await fs.realpath(root), directory = await fs.realpath(path.resolve(base, relative));
  // Windows kan have case-sensitive mapper: App og APP er da forskellige
  // projekter, selv om path.relative behandler navnene som ens. Følg de faktiske
  // overordnede mapper; realpath bevarer almindelige drev- og UNC-aliaser.
  let ancestor = directory, inside = false;
  while (true) {
    if (await fs.realpath(ancestor) === base) { inside = true; break; }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!inside) throw Error('Tjenestens mappe peger uden for projektet.');
  if (!(await fs.stat(directory)).isDirectory()) throw Error('Tjenestens mappe findes ikke.');
  return directory;
}
async function readProjectText(root, file) {
  try { const filename = path.join(root, file), stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200_000) return null; return fs.readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function detectServices(root, config = {}) {
  const c = normalizeRuntimeConfig(config), files = {};
  for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc', 'requirements.txt', 'pyproject.toml', 'manage.py', 'app.py', 'main.py']) files[name] = await readProjectText(root, name);
  let services = c.services || [];
  if (c.mode !== 'static' && !services.length) {
    let pkg; try { pkg = JSON.parse(files['package.json']); } catch {}
    const script = pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.start ? 'start' : null;
    if (script && (!pkg.packageManager || /^npm@/.test(pkg.packageManager)) && !pkg.workspaces) services = [{ id: 'web', label: 'Projektets lokale app', command: ['npm', 'run', script], cwd: '.' }];
    else if (files['manage.py']?.includes('django')) services = [{ id: 'web', label: 'Django', command: ['python3', 'manage.py', 'runserver', '{host}:{port}', '--noreload'], cwd: '.' }];
    else if (/\bFastAPI\s*\(/.test(files['main.py'] || '')) services = [{ id: 'web', label: 'Python med FastAPI', command: ['python3', '-m', 'uvicorn', 'main:app', '--host', '{host}', '--port', '{port}'], cwd: '.' }];
    else if (/\bFlask\s*\(/.test(files['app.py'] || '')) services = [{ id: 'web', label: 'Python med Flask', command: ['python3', '-m', 'flask', '--app', 'app', 'run', '--host', '{host}', '--port', '{port}', '--no-reload'], cwd: '.' }];
  }
  return { config: c, services: c.mode === 'static' ? [] : services, files, fingerprint: createHash('sha256').update(JSON.stringify({ config: c, files })).digest('hex') };
}

async function inspectPreviewDependencies(root, config = {}) {
  const network = normalizeRuntimeConfig(config).network || {}, diagnostics = [];
  const publicRoot = path.join(root, 'public');
  try { if ((await fs.lstat(publicRoot)).isSymbolicLink()) return diagnostics; } catch { return diagnostics; }
  const html = (await readProjectText(publicRoot, 'index.html') || '').replace(/<!--[\s\S]*?-->/g, '');
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0], script = match[1].toLowerCase() === 'script';
    if (!script && !/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const address = tag.match(script ? /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i : /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)?.slice(1).find(Boolean);
    if (!address || !/^(?:https?:)?\/\//i.test(address)) continue;
    let origin; try { origin = new URL(address.startsWith('//') ? 'https:' + address : address).origin; } catch { continue; }
    const kind = script ? 'scripts' : 'styles';
    if (network[kind]?.includes(origin) || diagnostics.some(item => item.kind === kind && item.origin === origin)) continue;
    diagnostics.push({ kind, origin, resourceType: script ? 'script' : 'stylesheet', reason: 'declared-remote-dependency', file: 'public/index.html', message: `Startsiden henviser til ${script ? 'kode' : 'typografi'} fra ${origin}, som projektets netadgang ikke tillader.`, repair: 'Ret forhåndsvisningen: public/index.html henviser til eksterne browserbiblioteker, som bliver blokeret. Undersøg den konkrete fejl, og brug lokale filer eller projektets lokale pakker og bygning. Bevar den valgte teknologi, udseendet, funktionerne og eksisterende data. React er ikke et krav. Eksterne API’er og login er særskilte integrationer og skal bevares. Fremlæg nødvendige installationer til gennemgang. Fjern ikke funktioner eller erstat rigtige data med eksempeldata.' });
  }
  return diagnostics;
}

// Netlisten for nye projekter: Tailwind, webskrifter og billeder fra https (beslutning for beta 2). Eksisterende projekter ændres ikke.
const CDN_HOSTS = ['https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com'];
const DESIGN_PREVIEW_NETWORK = { scripts: [...CDN_HOSTS], styles: [...CDN_HOSTS, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'], connect: [], images: ['https:'] };
module.exports = { normalizeRuntimeConfig, describeRuntime, describe: describeRuntime, detectServices, inspectPreviewDependencies, serviceDirectory, networkOrigin, NETWORK_KINDS, LOOPBACK, DESIGN_PREVIEW_NETWORK };
