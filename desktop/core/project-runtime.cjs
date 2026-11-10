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
// Startfilerne: de filer, en tjenestes kommando peger på (fx server.js i "node server.js"), også når kommandoen er et npm-script i
// package.json. De indgår i samtykkets fingeraftryk, så en ændret startfil kræver nyt samtykke. Kun almindelige filer inde i projektet.
// Kun kildefiler: data- og logfiler, som et program selv skriver til, må ikke få samtykket til at udløbe hver gang.
const START_FILE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|py|rb|php|go|sh)$/i;
const MODULE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.php', '.go', '.sh'];
const JS_FILE = /\.[cm]?[jt]sx?$/i;
const START_FILE_LIMIT = 2_000_000, START_FILE_COUNT = 200;
// Ordene i kommandoen eller scriptet, der kan pege på en startfil: med endelse (server.js) eller uden (server, .), som da afprøves mod kendte endelser.
function startFileCandidates(command, script) {
  const words = [...command.slice(1)];
  if (typeof script === 'string') words.push(...script.split(/\s+|&&|\|\||;|\|/));
  return [...new Set(words.map(word => word.replace(/^["']|["']$/g, '')).filter(word => word && !word.startsWith('-') && !/[{}$`<>*?=:]/.test(word) && word.length < 300))].slice(0, 64);
}
async function isFile(file) { try { const stat = await fs.lstat(file); return stat.isFile() || stat.isSymbolicLink(); } catch { return false; } }
async function packageMain(directory) {
  try { const main = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')).main; return typeof main === 'string' ? main : null; } catch { return null; }
}
// Finder den fil, et navn eller en modulsti peger på: selve filen, navnet med en kendt endelse, eller mappens main og index.
async function resolveStartFile(target, depth = 0) {
  let stat; try { stat = await fs.lstat(target); } catch { stat = null; }
  if (stat && !stat.isDirectory() && START_FILE_EXTENSIONS.test(target)) return target;
  if (!START_FILE_EXTENSIONS.test(target)) for (const extension of MODULE_EXTENSIONS) if (await isFile(target + extension)) return target + extension;
  if (stat?.isDirectory()) {
    const main = depth < 2 ? await packageMain(target) : null;
    if (main) { const found = await resolveStartFile(path.resolve(target, main), depth + 1); if (found) return found; }
    for (const extension of MODULE_EXTENSIONS) if (await isFile(path.join(target, 'index' + extension))) return path.join(target, 'index' + extension);
  }
  return null;
}
function relativeImports(text) {
  const found = new Set();
  for (const match of text.matchAll(/(?:\brequire\s*\(|\bimport\s*\(|\bfrom\s+|\bimport\s+)\s*["'](\.{1,2}(?:\/[^"'\n]*)?)["']/g)) found.add(match[1]);
  return [...found].slice(0, 100);
}
async function startFileDigest(root, cwd, command, script) {
  const base = await fs.realpath(root), found = {}, seen = new Set(), queue = [];
  const inside = file => { const relative = path.relative(base, file); return !relative.startsWith('..') && !path.isAbsolute(relative); };
  for (const word of startFileCandidates(command, script)) {
    if (path.isAbsolute(word) || word.split(/[\\/]/).includes('..')) continue;
    const file = await resolveStartFile(path.resolve(cwd, word)).catch(() => null);
    if (file) queue.push(file);
  }
  // Mappens main i package.json gælder også (fx "node ." og "npm start" uden navngiven fil).
  if (command.length > 1 || script) { const main = await packageMain(cwd); if (main && !path.isAbsolute(main) && !main.split(/[\\/]/).includes('..')) { const file = await resolveStartFile(path.resolve(cwd, main)).catch(() => null); if (file) queue.push(file); } }
  while (queue.length && Object.keys(found).length < START_FILE_COUNT) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const stat = await fs.lstat(file), key = path.relative(base, file).split(path.sep).join('/');
      if (!inside(file)) continue;
      if (stat.isSymbolicLink()) { found[key] = 'link:' + await fs.readlink(file); continue; }
      if (!stat.isFile()) continue;
      if (!inside(await fs.realpath(file))) continue;
      if (stat.size > START_FILE_LIMIT) { found[key] = `stor:${stat.size}:${stat.mtimeMs}`; continue; }
      const content = await fs.readFile(file);
      found[key] = createHash('sha256').update(content).digest('hex');
      // Moduler, som en JavaScript-fil selv indlæser med en relativ sti, hører med til det samtykket dækker.
      if (JS_FILE.test(file)) for (const specifier of relativeImports(content.toString('utf8'))) {
        const module = await resolveStartFile(path.resolve(path.dirname(file), specifier)).catch(() => null);
        if (module && inside(module)) queue.push(module);
      }
    } catch { /* Findes ikke: ikke en startfil. */ }
  }
  return found;
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
  // Samtykket til start dækker pakker og opstart, ikke netlisten: den styrer kun, hvad siden må hente i forhåndsvisningen,
  // og den ændres af brugeren selv, fx med Tillad. Uden netliste er fingeraftrykket det samme som før (fund 24, beta 3).
  const { network, ...startup } = c;
  return { config: c, services: c.mode === 'static' ? [] : services, files, fingerprint: createHash('sha256').update(JSON.stringify({ config: startup, files })).digest('hex') };
}

async function inspectPreviewDependencies(root, config = {}) {
  const network = normalizeRuntimeConfig(config).network || {}, diagnostics = [];
  const publicRoot = path.join(root, 'public');
  try { if ((await fs.lstat(publicRoot)).isSymbolicLink()) return diagnostics; } catch { return diagnostics; }
  const html = (await readProjectText(publicRoot, 'index.html') || '').replace(/<!--[\s\S]*?-->/g, '');
  const report = (address, script, via) => {
    if (typeof address !== 'string' || !/^(?:https?:)?\/\//i.test(address.trim())) return;
    address = address.trim();
    let origin; try { origin = new URL(address.startsWith('//') ? 'https:' + address : address).origin; } catch { return; }
    const kind = script ? 'scripts' : 'styles';
    if (network[kind]?.includes(origin) || diagnostics.some(item => item.kind === kind && item.origin === origin)) return;
    diagnostics.push({ kind, origin, resourceType: script ? 'script' : 'stylesheet', reason: 'declared-remote-dependency', file: 'public/index.html', message: `Startsiden henviser til ${script ? (via || 'kode') : 'typografi'} fra ${origin}, som projektets netadgang ikke tillader.`, repair: 'Ret forhåndsvisningen: public/index.html henviser til eksterne browserbiblioteker, som bliver blokeret. Undersøg den konkrete fejl, og brug lokale filer eller projektets lokale pakker og bygning. Bevar den valgte teknologi, udseendet, funktionerne og eksisterende data. React er ikke et krav. Eksterne API’er og login er særskilte integrationer og skal bevares. Fremlæg nødvendige installationer til gennemgang. Fjern ikke funktioner eller erstat rigtige data med eksempeldata.' });
  };
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0], script = match[1].toLowerCase() === 'script';
    if (!script && !/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const address = tag.match(script ? /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i : /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)?.slice(1).find(Boolean);
    report(address, script);
  }
  // Importmap og ESM-imports i indlejrede scripts henter også fra nettet, selv om der ikke står src på tagget.
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1], body = match[2];
    if (!body.trim()) continue;
    if (/\btype\s*=\s*["']?importmap\b/i.test(attributes)) {
      let map; try { map = JSON.parse(body); } catch { map = null; }
      const addresses = value => Object.values(value && typeof value === 'object' ? value : {}).filter(item => typeof item === 'string');
      for (const address of [...addresses(map?.imports), ...Object.values(map?.scopes && typeof map.scopes === 'object' ? map.scopes : {}).flatMap(addresses)]) report(address, true, 'et importkort (importmap) med kode');
      continue;
    }
    // Kun rigtig JavaScript læses, og kommentarer og almindelige strenge springes over, så tekst som ligner et import ikke giver falske diagnoser.
    const type = (attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1).find(item => item !== undefined);
    if (type !== undefined && type.trim() && !/^(?:module|(?:text|application)\/(?:javascript|ecmascript|babel|jsx))\s*(?:;.*)?$/i.test(type.trim())) continue;
    for (const address of importAddresses(body)) report(address, true, 'kode (ESM-import)');
  }
  return diagnostics;
}

// Finder importadresser i JavaScript uden at læse kommentarer eller strenge, der ikke står lige efter import, import( eller from.
function importAddresses(code) {
  const found = [];
  let index = 0, previous = '', dotted = false;
  while (index < code.length) {
    const char = code[index];
    if (char === '/' && code[index + 1] === '/') { const end = code.indexOf('\n', index); index = end < 0 ? code.length : end + 1; continue; }
    if (char === '/' && code[index + 1] === '*') { const end = code.indexOf('*/', index + 2); index = end < 0 ? code.length : end + 2; continue; }
    if (char === '"' || char === "'" || char === '`') {
      let end = index + 1;
      while (end < code.length && code[end] !== char) { if (code[end] === '\\') end++; else if (char !== '`' && code[end] === '\n') break; end++; }
      const text = code.slice(index + 1, end);
      if ((previous === 'import' || previous === 'from' || previous === 'import(') && !dotted && code[end] === char && !text.includes('${')) found.push(text);
      index = end + 1; previous = 'literal'; dotted = false; continue;
    }
    if (/\s/.test(char)) { index++; continue; }
    if (/[\w$]/.test(char)) { let end = index; while (end < code.length && /[\w$]/.test(code[end])) end++; dotted = previous === '.'; previous = code.slice(index, end); index = end; continue; }
    dotted = false;
    previous = char === '(' && previous === 'import' ? 'import(' : char;
    index++;
  }
  return found;
}

// Netlisten for nye projekter (valg 4, 5. november 2026): en kort fast liste. Tailwind som kode, Google Fonts som typografi og skrifter.
// Alt andet, også eksterne billeder, kræver brugerens samtykke pr. adresse. Eksisterende projekter ændres ikke.
const DESIGN_PREVIEW_NETWORK = { scripts: ['https://cdn.tailwindcss.com'], styles: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'], connect: [], images: [] };
module.exports = { startFileDigest, normalizeRuntimeConfig, describeRuntime, describe: describeRuntime, detectServices, inspectPreviewDependencies, serviceDirectory, networkOrigin, NETWORK_KINDS, LOOPBACK, DESIGN_PREVIEW_NETWORK };
