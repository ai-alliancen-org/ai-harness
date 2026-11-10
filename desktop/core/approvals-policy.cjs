// Tilladelser afgøres i hovedprocessen ud fra den aktuelle forespørgsel. Mønstre fra
// modellen bliver aldrig til generelle OpenCode-regler eller en tilladelse til bash.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const { isProtected: protectedPath, isProtectedIn } = require('./protected-paths.cjs');
const writable = mode => ['free', 'build'].includes(mode);

// realpath på den nærmeste eksisterende forælder dækker også nye filer. Et link
// uden et eksisterende mål afvises; det må ikke ligne en ny, almindelig fil.
async function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value) || value.length > 4096 || /[?*]/.test(value) || value.split(/[\\/]/).includes('..')) throw new Error('Stien kan ikke afgrænses sikkert.');
  if (path.sep === '\\') {
    // Kun fulde drev- og UNC-stier. NTFS-streams, enheder og navne, som Win32
    // omskriver, må ikke blive en almindelig automatisk filgodkendelse.
    if (/^[\\/]{2}[?.][\\/]/.test(value) || !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(value)) throw new Error('Stien kan ikke afgrænses sikkert.');
    const parts = value.slice(path.parse(value).root.length).split(/[\\/]/).filter(part => part && part !== '.');
    if (parts.some(part => /[<>:"|\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw new Error('Stien kan ikke afgrænses sikkert.');
  }
  let cursor = path.normalize(value); const tail = [];
  while (true) {
    try { await fs.lstat(cursor); return path.join(await fs.realpath(cursor), ...tail.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // lstat lykkes for et dødt link, men realpath gør ikke.
      try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Stien indeholder et link uden et gyldigt mål.'); } catch (entryError) { if (entryError.code !== 'ENOENT') throw entryError; }
      const parent = path.dirname(cursor); if (parent === cursor) throw error;
      tail.push(path.basename(cursor)); cursor = parent;
    }
  }
}
async function directory(value) { const canonical = await canonicalPath(value); if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Mappen findes ikke længere.'); return canonical; }
async function canonicalWithin(root, target) {
  if (!within(root, target)) return false;
  // path.win32.relative folder altid store/små bogstaver sammen, også i NTFS-
  // mapper, der skelner mellem dem. Bekræft derfor den faktiske rodforælder.
  let ancestor = target;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) ancestor = path.dirname(ancestor);
  return await directory(ancestor) === root;
}
const allCanonicalWithin = async (root, targets) => (await Promise.all(targets.map(target => canonicalWithin(root, target)))).every(Boolean);
async function fileTargets(p, workspace) {
  let candidates = [p.metadata?.filepath, p.metadata?.filePath, p.toolInput?.filePath, p.toolInput?.filepath].filter(value => typeof value === 'string');
  // OpenCode markerer en mappe med <mappe>/* i patterns. Stjernen fjernes, så mappen selv kan bindes, og mappen er et helt undertræ.
  const folderOnly = p.permission === 'external_directory';
  const patterns = (Array.isArray(p.patterns) ? p.patterns : []).map(value => folderOnly && typeof value === 'string' ? value.replace(/[\\/]\*{1,2}$/, '') : value);
  // OpenCode viser projekt-relative patterns, men sender det konkrete absolutte
  // mål i metadata. Hvert mønster skal passe entydigt til et helt sti-suffix;
  // det må hverken indføre et nyt mål eller skjule ../, jokere eller navnesammenfald.
  const bindTargets = async values => {
    // [ ] { } er almindelige tegn i stinavne (fx app/[slug]/page.tsx). Stierne sammenlignes bogstaveligt, og der dannes ingen glob af dem,
    // så parenteserne kan ikke passe på andre filer. ? og * afvises stadig, fordi de er jokere i OpenCodes mønstre.
    const safe = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\0\r\n?*]/.test(value) && !value.split(/[\\/]/).includes('..');
    if (values.length > 200 || patterns.length > 100 || [...values, ...patterns].some(value => !safe(value))) return [];
    const absolute = [...new Set(values.filter(value => path.isAbsolute(value)).map(value => path.normalize(value)))];
    // OpenCode normaliserer Windows-metadata, mens toolInput kan have et andet
    // drevbogstav. Identitet afgøres af filsystemet, ikke af store/små bogstaver.
    const canonical = await Promise.all(absolute.map(canonicalPath));
    const matches = async value => {
      if (path.isAbsolute(value)) return canonical.includes(await canonicalPath(value));
      const parts = value.split(/[\\/]/).filter(part => part && part !== '.');
      const identities = new Set(absolute.flatMap((target, targetIndex) => {
        const targetParts = target.split(/[\\/]/).filter(Boolean);
        const same = (a, b) => path.sep === '\\' ? a.toLowerCase() === b.toLowerCase() : a === b;
        return parts.length <= targetParts.length && parts.every((part, index) => same(part, targetParts[targetParts.length - parts.length + index])) ? [canonical[targetIndex]] : [];
      }));
      return parts.length > 0 && identities.size === 1;
    };
    if ((await Promise.all([...values, ...patterns].map(matches))).some(match => !match)) return [];
    return absolute.map(value => ({ value, subtree: false }));
  };
  if (p.toolInput?.tool === 'apply_patch') {
    if (p.metadata?.files !== undefined) {
      const files = p.metadata.files;
      if (!Array.isArray(files) || !files.length || files.length > 100 || files.some(file => !file || !['add', 'update', 'delete', 'move'].includes(file.type) || typeof file.filePath !== 'string' || !path.isAbsolute(file.filePath) || file.movePath !== undefined && (typeof file.movePath !== 'string' || !path.isAbsolute(file.movePath)))) return [];
      if (p.metadata.filepath !== undefined && p.metadata.filepath !== patterns.join(', ')) return [];
      // apply_patch.filepath er en visningsliste. files indeholder de faktiske
      // original- og flyttemål, som alle skal med i afgrænsningen.
      candidates = [p.metadata.filePath, p.toolInput.filePath, p.toolInput.filepath, ...files.flatMap(file => [file.filePath, file.movePath])].filter(value => typeof value === 'string');
    }
    const rawPatch = p.toolInput.patchText || p.toolInput.input?.patchText;
    const patch = typeof rawPatch === 'string' ? rawPatch.replace(/\r\n/g, '\n') : rawPatch;
    if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch\n') || !patch.trimEnd().endsWith('*** End Patch')) return [];
    const targets = [];
    for (const line of patch.split('\n')) {
      const header = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/);
      if (header) targets.push(header[1]);
      else if (line.startsWith('*** ') && !['*** Begin Patch', '*** End Patch', '*** End of File'].includes(line)) return [];
    }
    if (!targets.length || targets.length > 100) return [];
    const absolute = value => {
      if (typeof value !== 'string' || value.split(/[\\/]/).includes('..')) throw new Error('Patchens sti kan ikke afgrænses sikkert.');
      return path.isAbsolute(value) ? value : path.join(workspace, value);
    };
    return bindTargets([...candidates, ...targets.map(absolute)]);
  }
  // For mappeadgang er mønsteret <mappe>/* det autoritative mål. filepath kan være en fil inde i mappen, og den må ikke
  // gøres til undertræets rod.
  if (folderOnly) {
    const folders = patterns.filter(value => typeof value === 'string');
    const bound = folders.length ? await bindTargets(folders) : [];
    if (bound.length) return bound.map(item => ({ ...item, subtree: true }));
  }
  if (candidates.length) {
    return bindTargets(candidates);
  }
  if (!['external_directory', 'read', 'grep', 'glob', 'list'].includes(p.permission)) return [];
  // OpenCode 1.18.33 og 1.19.5 sender mappeadgang med metadata.filepath og metadata.parentDir (tests/fixtures); path er ældre.
  const specified = p.toolInput?.path || p.metadata?.path || p.metadata?.filepath || p.metadata?.parentDir;
  // Søgning (grep): patterns er søgeordet, ikke en sti. Uden sti søges hele projektet; en relativ sti regnes fra projektmappen.
  if (p.permission === 'grep') {
    if (specified !== undefined && typeof specified !== 'string') return [];
    return [{ value: !specified ? workspace : path.isAbsolute(specified) ? specified : path.join(workspace, specified), subtree: !specified }];
  }
  const requested = specified ? [specified] : p.patterns;
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) return [];
  return requested.map(value => typeof value === 'string' && /[\\/]\*{1,2}$/.test(value) ? { value: value.replace(/[\\/]\*{1,2}$/, ''), subtree: true } : { value, subtree: p.permission === 'external_directory' });
}
async function broadDirectory(target) {
  const broad = [path.parse(target).root, os.homedir(), os.tmpdir()];
  for (const value of broad) { try { if (target === await canonicalPath(value)) return true; } catch {} }
  // En mappe over hjemmemappen (fx /Users) er endnu bredere end hjemmemappen selv.
  try { const home = await canonicalPath(os.homedir()); if (home.startsWith(target.endsWith(path.sep) ? target : target + path.sep)) return true; } catch {}
  return /^(?:opencode|\.opencode)$/i.test(path.basename(target));
}

// Uden isolation kan kun kommandoens tekst kontrolleres: hvert ord og hver sti i den og arbejdsmappen sammenlignes med de beskyttede navne
// (.env, nøgler, .git, references). Det er en grænse for, hvad der tillades uden kort, ikke en isolation.
function commandNamesProtected(command, cwd, workspace) {
  if (isProtectedIn(workspace, cwd)) return true;
  if (command.split(/[\s"'`;&|<>(){}=,]+/).filter(Boolean).some(token => protectedPath(token) || WILDCARD_OR_SHORT_NAME.test(token))) return true;
  return command.split(/[;&|\n]+/).some(changesGit);
}
// Et jokertegn (.e*, refer*) eller et kort Windows-navn (ENV~1) kan ramme et beskyttet navn uden at nævne det, og det kan en tekstkontrol ikke afgøre.
// Derfor kræver de kortet. Det samme gælder git-kommandoer, der kan ændre .git (commit, config, remote m.fl.); kun læsende kommandoer slipper igennem.
const WILDCARD_OR_SHORT_NAME = /[*?[\]]|~\d/;
const GIT_READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'blame', 'shortlog', 'describe', 'grep', 'help', 'version', '--version']);
function changesGit(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  if (!/^git(?:\.exe)?$/i.test(words[0] || '')) return false;
  for (let i = 1; i < words.length; i++) {
    if (words[i] === '-C' || words[i] === '-c') { i++; continue; }
    if (words[i].startsWith('-') && words[i] !== '--version') continue;
    return !GIT_READ_ONLY.has(words[i].toLowerCase());
  }
  return false;
}

// Projektets valg af automatiske kommandoer fra projektets indstillinger (project:settings-save i main.cjs). support er
// command-sandbox.support(). Med sandkassen kører kommandoerne isoleret. Uden den må valget kun tændes på en platform helt uden sandkasse
// (Windows) og kun med brugerens udtrykkelige valg om at køre uden isolation efter advarslen (beslutningen 5. november 2026, valg 3).
// En Mac eller Linux, hvor sandkassen ikke kan starte, får ingen reservevej. Giver null, når valget ikke ændres.
function projectCommandSettings(value, support) {
  for (const name of ['autoCommands', 'autoCommandsUnisolated']) if (value?.[name] !== undefined && typeof value[name] !== 'boolean') throw new Error('Ugyldigt valg af Auto-godkend.');
  if (value?.autoCommands === undefined) { if (value?.autoCommandsUnisolated !== undefined) throw new Error('Ugyldigt valg af Auto-godkend.'); return null; }
  if (value.autoCommands === false) return { enabled: false, unisolated: false };
  if (support?.available === true) return { enabled: true, unisolated: false };
  if (value.autoCommandsUnisolated === true && require('./command-sandbox.cjs').canRunUnisolated(support)) return { enabled: true, unisolated: true };
  throw new Error(support?.reason || 'Automatisk kommandokørsel er ikke tilgængelig på denne computer.');
}

// Huskede kommandoer findes ikke længere (brugerens beslutning 10. november 2026, «Fjern funktionen»). Kommandoer styres af sandkassen,
// projektets automatik og «Godkend alt». Kommandoregler, som beta 2 (nøglet med AI'ens input) og beta 3 (nøglet med kommando og mappe) har
// gemt, bevares i lageret, men matcher aldrig. Projektets tilladelser viser dem som «Ikke i brug» med kommando og mappe, så to regler for samme
// kommando i to mapper kan skelnes (RN:A-2), og samme kommando i samme mappe står som én række, som sletter dem alle. Beta 2 kunne gemme
// sandkassens indpakning («exec /usr/bin/env -i ... command-sandbox-runner.mjs' ... '<base64url>'»); den vises som den kommando, den pakker ind.
const SANDBOX_WRAPPED = /^exec \/usr\/bin\/env -i .*command-sandbox-runner\.mjs' .* '([A-Za-z0-9_-]+)'$/s;
function storedCommand(rule) {
  const match = rule?.match;
  if (rule?.kind !== 'bash' || !match || typeof match !== 'object' || typeof match.command !== 'string' || typeof match.cwd !== 'string') return null;
  let command = match.command, cwd = match.cwd;
  const wrapped = SANDBOX_WRAPPED.exec(command);
  if (wrapped) { try { const payload = JSON.parse(Buffer.from(wrapped[1], 'base64url').toString()); if (typeof payload?.command === 'string') { command = payload.command; if (typeof payload.cwd === 'string') cwd = payload.cwd; } } catch { /* Vises, som den er gemt. */ } }
  return { command, cwd };
}
function commandLabel({ command, cwd }, root) {
  const relative = path.relative(root, cwd), inside = within(root, cwd);
  const where = relative === '' ? 'i projektmappen' : inside ? `i mappen ${relative.split(path.sep).join('/')}` : `i ${cwd}`;
  const text = command.replace(/\s+/g, ' ').trim();
  return `Kommando: ${text.length > 200 ? text.slice(0, 200) + ' …' : text} · ${where}`;
}
const sameCommand = (a, b) => Boolean(a && b) && a.command === b.command && a.cwd === b.cwd;

// Kortsamlingen (brugerens beslutning 10. november 2026, «Byg samlingen»): et ja til «resten af opgaven i projektmappen» dækker det, projektets
// automatik dækker: filændringer i projektet, søgning i projektet med søgevagten og kommandoer, der kører i sandkassen i projektet. Beskyttede
// filer, mapper uden for projektet, kommandoer uden sandkasse, nettet og udgivelse er ikke dækket og spørger stadig. Svaret ligger som
// TASK_PROJECT i opgavens taskRules og forsvinder med dem ved næste opgave og ved Stop.
const TASK_PROJECT = 'projektmappen';
function coversProjectFolder(descriptor, context) {
  if (!descriptor?.match || descriptor.blockedMode || descriptor.engineData || !writable(context?.mode)) return false;
  if (descriptor.projectFile) return true;
  if (descriptor.projectSearch) return context.grepGuard === true;
  return descriptor.kind === 'bash' && descriptor.projectCommand === true && context.commandSandbox === true;
}

class ApprovalsPolicy {
  constructor(store) { this.store = store; }
  async settings(root) {
    root = await directory(root); const data = (await this.store.project(root)).approvals;
    const valid = data?.version === 1 && Array.isArray(data.rules) ? data.rules.filter(rule => rule && /^[a-f0-9]{64}$/.test(rule.id) && rule.id === digest(rule.match) && ['bash', 'webfetch', 'edit', 'read', 'grep', 'glob', 'list', 'external_directory'].includes(rule.kind) && rule.kind === rule.match?.kind && typeof rule.label === 'string' && typeof rule.target === 'string').slice(0, 200) : [];
    // Gamle kommandoregler står som «Ikke i brug» (inactive) og bruges aldrig af allowed.
    const rules = [], commands = [];
    for (const rule of valid) {
      if (rule.kind !== 'bash') { rules.push(rule); continue; }
      const command = storedCommand(rule);
      if (!command || commands.some(item => sameCommand(item, command))) continue;
      commands.push(command); rules.push({ ...rule, label: commandLabel(command, root), inactive: true });
    }
    return { autoProjectFiles: data?.version === 1 && data.autoProjectFiles === true, autoCommands: data?.version === 1 && data.autoCommands === true, autoCommandsUnisolated: data?.version === 1 && data.autoCommands === true && data.autoCommandsUnisolated === true, rules };
  }
  async update(root, change) {
    root = await directory(root);
    // Store køer hele læs/ændr/skriv-forløbet; to samtidige godkendelser må ikke
    // overskrive hinandens regel eller en samtidig tilbagekaldelse.
    await this.store.update(state => {
      const key = this.store.projectKey(root), project = state.projects[key] ||= {}, old = project.approvals;
      const value = { version: 1, autoProjectFiles: old?.version === 1 && old.autoProjectFiles === true, autoCommands: old?.version === 1 && old.autoCommands === true, autoCommandsUnisolated: old?.version === 1 && old.autoCommands === true && old.autoCommandsUnisolated === true, rules: old?.version === 1 && Array.isArray(old.rules) ? old.rules.slice(0, 200) : [] };
      change(value); project.approvals = value;
    });
    return this.settings(root);
  }
  // Nye projekter bruger projektmappen som grænse (beslutning for beta 2): filændringer i projektet sker uden kort, med versioner og
  // fortryd som sikkerhedsnet, og kommandoer kører automatisk i sandkassen, hvor den findes. Kaldes kun, når projektet har sit
  // sikkerhedsnet (beslutning (c), 10. november 2026; core/new-project-defaults.cjs). Eksisterende projekter ændres ikke.
  async applyNewProjectDefaults(root, { commandsAvailable }) {
    await this.setProjectFiles(root, true);
    if (commandsAvailable === true) await this.setCommands(root, true);
  }
  setProjectFiles(root, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Vælg, om projektfiler skal godkendes automatisk.');
    return this.update(root, data => { data.autoProjectFiles = enabled; });
  }
  // unisolated gemmer brugerens eksplicitte valg om at køre uden isolation (Windows). Uden valget gemmes intet, og slås kommandoer fra, forsvinder det.
  setCommands(root, enabled, { unisolated = false } = {}) {
    if (typeof enabled !== 'boolean') throw new Error('Vælg, om lokale kommandoer skal godkendes automatisk.');
    return this.update(root, data => { data.autoCommands = enabled; data.autoCommandsUnisolated = enabled && unisolated === true; });
  }
  revoke(root, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Tilladelsen findes ikke.');
    // En gammel kommandoregel står som én række for samme kommando i samme mappe (settings), så sletningen tager dem alle.
    return this.update(root, data => {
      const command = storedCommand(data.rules.find(rule => rule?.id === id));
      data.rules = data.rules.filter(rule => rule?.id !== id && !(command && sameCommand(storedCommand(rule), command)));
    });
  }
  async describe(context, p) {
    const kind = typeof p?.permission === 'string' ? p.permission : 'unknown';
    // commandSandbox: om motoren kører med sandkassen nu. Kortet bruger det til at sige, at «Godkend alt» først dækker kommandoer fra næste opgave.
    const descriptor = { kind, label: 'Denne handling', target: '', projectFile: false, projectSearch: false, engineData: false, persistable: false, scratch: false, commandSandbox: context?.commandSandbox === true, key: `request:${p?.id || ''}` };
    try {
      const project = await directory(context.projectRoot), workspace = await directory(context.workspaceRoot);
      let match, identity = null;
      if (kind === 'bash') {
        const command = p.toolInput?.command || p.metadata?.command;
        if (typeof command !== 'string' || !command.trim() || command.length > 32000 || command.includes('\0')) throw new Error('Kommandoen mangler.');
        const cwd = await directory(p.toolInput?.workdir || p.metadata?.workdir || workspace);
        // Kommandoen indgår byte for byte, sammen med arbejdsmappen, i nøglen, der lægger kort for samme handling sammen. npm test er ikke npm *.
        // AI'ens begrundelse og tidsgrænse skifter fra gang til gang og hører ikke til nøglen: ellers blev samme kommando aldrig lagt sammen.
        match = { kind, command, cwd };
        descriptor.target = command; descriptor.label = `Kommando: ${command}`;
        // En kommando kan ikke huskes (brugerens beslutning 10. november 2026): persistable forbliver false, og grant afviser 'project'.
        // Uden isolation (Windows, brugerens valg) afgør commandProtected, om projektets automatik eller «Godkend alt» må køre kommandoen.
        if (context.commandUnisolated === true) { descriptor.unisolated = true; descriptor.commandProtected = commandNamesProtected(command, cwd, workspace); }
        // Kører kommandoen i projektet eller i opgavens midlertidige mappe? Kortsamlingen dækker kun dem (coversProjectFolder).
        const roots = [workspace];
        if (context.scratchRoot) { try { roots.push(await directory(context.scratchRoot)); } catch { /* Mappen findes ikke endnu. */ } }
        descriptor.projectCommand = (await Promise.all(roots.map(root => canonicalWithin(root, cwd)))).some(Boolean);
      } else if (kind === 'webfetch') {
        const raw = p.toolInput?.url || p.metadata?.url || (p.patterns?.length === 1 ? p.patterns[0] : null);
        const url = new URL(raw);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname || /[\s*]/.test(url.hostname)) throw new Error('Adressen kan ikke afgrænses sikkert.');
        match = { kind, origin: url.origin };
        descriptor.target = url.origin; descriptor.label = `Hjemmeside: ${url.origin}`; descriptor.persistable = true;
      } else if (['edit', 'read', 'grep', 'glob', 'list', 'external_directory'].includes(kind)) {
        const requested = await fileTargets(p, workspace); if (!requested.length) throw new Error('Ingen entydig sti.');
        const targets = [];
        for (const item of requested) {
          const canonical = await canonicalPath(item.value);
          if (isProtectedIn(workspace, item.value) || isProtectedIn(workspace, canonical)) throw new Error('Beskyttede filer kræver særskilt gennemgang.');
          if (item.subtree) await directory(canonical);
          targets.push({ path: canonical, subtree: item.subtree });
        }
        targets.sort((a, b) => a.path.localeCompare(b.path) || Number(a.subtree) - Number(b.subtree));
        // Både den viste sti og dens faktiske mål skal være inde i arbejdsområdet.
        const inProject = requested.every(item => within(path.resolve(context.workspaceRoot), path.resolve(item.value))) && await allCanonicalWithin(workspace, targets.map(item => item.path));
        // Motorens egne data (opencode.db, store.json, andre projekters runtime) får aldrig en gemt regel eller en automatisk godkendelse.
        // Valgte skills og tool-output, som OpenCode selv beder modellen læse, er undtaget.
        const closed = [];
        for (const value of [context.storeRoot, context.engineRoot]) if (value) { try { closed.push(await canonicalPath(value)); } catch { /* Mappen findes ikke. */ } }
        const engineRoot = context.engineRoot ? await canonicalPath(context.engineRoot).catch(() => null) : null;
        const open = engineRoot ? [path.join(engineRoot, 'data', 'opencode', 'tool-output'), path.join(engineRoot, 'config', 'skills')] : [];
        descriptor.engineData = targets.some(item => !within(workspace, item.path) && closed.some(base => within(base, item.path)) && !open.some(base => within(base, item.path)));
        descriptor.projectFile = kind === 'edit' && inProject;
        // Filerne i projektet, som kortet viser dem. OpenCode giver apply_patch-stier relativt til Git-roden (eller computerens rod uden Git),
        // så kortet må ikke selv skære i metadata.filepath.
        if (descriptor.projectFile) descriptor.files = targets.map(item => path.relative(workspace, item.path).split(path.sep).join('/'));
        // Søgning i projektet er en læsning. Den tillades kun uden kort, når motoren har søgevagten (se allowed).
        descriptor.projectSearch = kind === 'grep' && inProject;
        // En søgning i det output, OpenCode selv har gemt og beder modellen søge i, får sin egen tekst på kortet.
        descriptor.toolOutput = kind === 'grep' && Boolean(engineRoot) && targets.every(item => within(path.join(engineRoot, 'data', 'opencode', 'tool-output'), item.path));
        let scratch = null;
        if (context.scratchRoot) { try { scratch = await directory(context.scratchRoot); } catch {} }
        descriptor.scratch = Boolean(scratch && requested.every(item => within(path.resolve(context.scratchRoot), path.resolve(item.value))) && await allCanonicalWithin(scratch, targets.map(item => item.path)));
        match = { kind, targets };
        descriptor.target = targets.map(item => item.path + (item.subtree ? path.sep + '*' : '')).join('\n');
        // Dette er kun et forslag, som brugeren skal se og vælge på kortet.
        const parent = targets.length === 1 ? (targets[0].subtree ? targets[0].path : path.dirname(targets[0].path)) : null;
        if (parent && !await broadDirectory(parent)) descriptor.folder = parent;
        descriptor.label = `${kind === 'edit' ? 'Filændring' : kind === 'external_directory' ? 'Mappeadgang' : 'Læsning'}: ${descriptor.target}`;
        descriptor.persistable = (kind !== 'edit' || writable(context.mode)) && !(await Promise.all(targets.map(item => item.subtree ? broadDirectory(item.path) : false))).some(Boolean);
        // Søgning i projektet styres af indstillingen for projektfiler og søgevagten, ikke af en gemt regel.
        if (descriptor.projectSearch || descriptor.engineData) descriptor.persistable = false;
        if (descriptor.projectFile) identity = { kind, projectFiles: workspace };
      }
      if (match) {
        descriptor.match = match;
        descriptor.key = digest({ project, workspace, ...(identity || match) });
        // Planning må heller ikke genbruge gamle skrivetilladelser eller en
        // eksterne-mappegodkendelse, der udspringer af et skriveværktøj.
        const tool = p.toolInput?.tool || p.tool?.name;
        descriptor.blockedMode = !writable(context.mode) && (['edit', 'bash'].includes(kind) || ['write', 'edit', 'apply_patch', 'bash'].includes(tool));
        if (descriptor.blockedMode) { descriptor.persistable = false; descriptor.scratch = false; }
      }
      descriptor.fingerprint = digest(stable({ project, workspace, mode: context.mode, permission: kind, patterns: p.patterns, metadata: p.metadata, toolInput: p.toolInput, match: descriptor.match }));
    } catch {
      descriptor.persistable = false; descriptor.projectFile = false; descriptor.projectSearch = false; descriptor.engineData = false; descriptor.scratch = false; descriptor.toolOutput = false; descriptor.projectCommand = false; delete descriptor.match; delete descriptor.files;
      descriptor.key = `request:${p?.id || ''}`;
      descriptor.fingerprint = digest(stable({ permission: kind, patterns: p?.patterns, metadata: p?.metadata, toolInput: p?.toolInput, mode: context.mode }));
    }
    return descriptor;
  }
  async allowed(context, p) {
    const descriptor = await this.describe(context, p);
    if (!descriptor.match || descriptor.blockedMode || descriptor.engineData) return { allowed: false, descriptor };
    if (descriptor.kind === 'bash' && context.commandSandbox !== true && !(context.commandUnisolated === true && descriptor.commandProtected === false)) return { allowed: false, descriptor };
    if (descriptor.scratch) return { allowed: true, source: 'scratch', descriptor };
    if (descriptor.projectFile && context.taskRules?.has(descriptor.key)) return { allowed: true, source: 'task', descriptor };
    // Kortsamlingen: brugeren har sagt ja til resten af opgaven i projektmappen.
    if (context.taskRules?.has(TASK_PROJECT) && coversProjectFolder(descriptor, context)) return { allowed: true, source: 'task', descriptor };
    const settings = await this.settings(context.projectRoot);
    if (descriptor.projectFile && settings.autoProjectFiles) return { allowed: true, source: 'project', descriptor };
    // Søgevagten i motoren (createGrepGuard) fjerner beskyttede filer fra resultatet. Uden den, og i Samtale og Planlæg, bliver det ved kortet.
    if (descriptor.projectSearch && writable(context.mode) && context.grepGuard === true && settings.autoProjectFiles) return { allowed: true, source: 'project', descriptor };
    // Hovedprocessen bekræfter både opgavens opt-in og motorens aktive sandbox.
    if (descriptor.kind === 'bash' && context.autoCommandsSnapshot === true && (context.commandSandbox === true || (context.commandUnisolated === true && context.autoCommandsUnisolated === true))) {
      const roots = [await directory(context.workspaceRoot)];
      if (context.scratchRoot) roots.push(await directory(context.scratchRoot));
      if ((await Promise.all(roots.map(root => canonicalWithin(root, descriptor.match.cwd)))).some(Boolean)) return { allowed: true, source: 'commands', descriptor };
    }
    // En gammel kommandoregel (inactive) bruges aldrig, heller ikke hvis en kommando skulle blive persistable.
    if (descriptor.persistable && settings.rules.some(rule => !rule.inactive && rule.kind !== 'bash' && rule.id === digest(descriptor.match))) return { allowed: true, source: 'rule', descriptor };
    if (descriptor.persistable && descriptor.match.targets) for (const rule of settings.rules) {
      if (rule.inactive || rule.kind !== descriptor.kind || typeof rule.match?.folder !== 'string') continue;
      try {
        const folder = await directory(rule.match.folder);
        if (folder !== rule.match.folder || await broadDirectory(folder)) continue;
        if (await allCanonicalWithin(folder, descriptor.match.targets.map(target => target.path))) return { allowed: true, source: 'rule', descriptor };
      } catch { /* En fjernet mappe eller et ændret link ophæver tilladelsen. */ }
    }
    return { allowed: false, descriptor };
  }
  async grant(context, p, { scope, folder, fingerprint } = {}) {
    const descriptor = await this.describe(context, p);
    if (fingerprint !== undefined && descriptor.fingerprint !== fingerprint) throw new Error('Handlingen har ændret sig. Gennemgå den igen.');
    if (scope === 'task') {
      if (!descriptor.projectFile || descriptor.blockedMode || !context.taskRules) throw new Error('Kun filændringer i projektmappen kan tillades for hele opgaven.');
      context.taskRules.add(descriptor.key); return descriptor;
    }
    // Kortsamlingen: kun en handling, som et ja dækker, kan give ja til resten af opgaven i projektmappen.
    if (scope === 'collect') {
      if (!context.taskRules || !coversProjectFolder(descriptor, context)) throw new Error('Kun handlinger i projektmappen kan godkendes for resten af opgaven.');
      context.taskRules.add(TASK_PROJECT); return descriptor;
    }
    if (scope !== 'project' || descriptor.kind === 'bash' || !descriptor.persistable || !descriptor.match) throw new Error('Denne handling kan kun godkendes én gang.');
    let match = descriptor.match, label = descriptor.label, target = descriptor.target;
    if (folder !== undefined) {
      if (!match.targets || descriptor.projectFile) throw new Error('Denne handling kan ikke få en mappetilladelse.');
      const canonical = await directory(folder);
      if (await broadDirectory(canonical) || protectedPath(folder) || protectedPath(canonical) || !await allCanonicalWithin(canonical, match.targets.map(item => item.path))) throw new Error('Vælg en afgrænset mappe, som indeholder de viste filer.');
      match = { kind: descriptor.kind, folder: canonical }; target = canonical;
      label = `${descriptor.kind === 'edit' ? 'Filændringer' : 'Mappeadgang'}: ${canonical}`;
    }
    if (descriptor.projectFile) await this.setProjectFiles(context.projectRoot, true);
    else await this.update(context.projectRoot, data => {
      const rule = { id: digest(match), kind: descriptor.kind, label, target, match };
      data.rules = [...data.rules.filter(item => item.id !== rule.id), rule].slice(-200);
    });
    return descriptor;
  }
}
module.exports = { ApprovalsPolicy, canonicalPath, within, projectCommandSettings, coversProjectFolder, TASK_PROJECT };
