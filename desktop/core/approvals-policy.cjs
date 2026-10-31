// Tilladelser afgøres i hovedprocessen ud fra den aktuelle forespørgsel. Mønstre fra
// modellen bliver aldrig til generelle OpenCode-regler eller en tilladelse til bash.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const { isProtected: protectedPath } = require('./protected-paths.cjs');
const writable = mode => ['free', 'build'].includes(mode);

// realpath på den nærmeste eksisterende forælder dækker også nye filer. Et link
// uden et eksisterende mål afvises; det må ikke ligne en ny, almindelig fil.
async function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value) || value.length > 4096 || /[?*\[\]{}]/.test(value) || value.split(/[\\/]/).includes('..')) throw new Error('Stien kan ikke afgrænses sikkert.');
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
  const patterns = Array.isArray(p.patterns) ? p.patterns : [];
  // OpenCode viser projekt-relative patterns, men sender det konkrete absolutte
  // mål i metadata. Hvert mønster skal passe entydigt til et helt sti-suffix;
  // det må hverken indføre et nyt mål eller skjule ../, jokere eller navnesammenfald.
  const bindTargets = async values => {
    const safe = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\0\r\n?*\[\]{}]/.test(value) && !value.split(/[\\/]/).includes('..');
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
  if (candidates.length) {
    return bindTargets(candidates);
  }
  if (!['external_directory', 'read', 'grep', 'glob', 'list'].includes(p.permission)) return [];
  const specified = p.toolInput?.path || p.metadata?.path;
  const requested = specified ? [specified] : p.patterns;
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) return [];
  return requested.map(value => typeof value === 'string' && /[\\/]\*{1,2}$/.test(value) ? { value: value.replace(/[\\/]\*{1,2}$/, ''), subtree: true } : { value, subtree: p.permission === 'external_directory' });
}
async function broadDirectory(target) {
  const broad = [path.parse(target).root, os.homedir(), os.tmpdir()];
  for (const value of broad) { try { if (target === await canonicalPath(value)) return true; } catch {} }
  return /^(?:opencode|\.opencode)$/i.test(path.basename(target));
}

class ApprovalsPolicy {
  constructor(store) { this.store = store; }
  async settings(root) {
    root = await directory(root); const data = (await this.store.project(root)).approvals;
    const rules = data?.version === 1 && Array.isArray(data.rules) ? data.rules.filter(rule => rule && /^[a-f0-9]{64}$/.test(rule.id) && rule.id === digest(rule.match) && ['bash', 'webfetch', 'edit', 'read', 'grep', 'glob', 'list', 'external_directory'].includes(rule.kind) && rule.kind === rule.match?.kind && typeof rule.label === 'string' && typeof rule.target === 'string').slice(0, 200) : [];
    return { autoProjectFiles: data?.version === 1 && data.autoProjectFiles === true, autoCommands: data?.version === 1 && data.autoCommands === true, rules };
  }
  async update(root, change) {
    root = await directory(root);
    // Store køer hele læs/ændr/skriv-forløbet; to samtidige godkendelser må ikke
    // overskrive hinandens regel eller en samtidig tilbagekaldelse.
    await this.store.update(state => {
      const key = this.store.projectKey(root), project = state.projects[key] ||= {}, old = project.approvals;
      const value = { version: 1, autoProjectFiles: old?.version === 1 && old.autoProjectFiles === true, autoCommands: old?.version === 1 && old.autoCommands === true, rules: old?.version === 1 && Array.isArray(old.rules) ? old.rules.slice(0, 200) : [] };
      change(value); project.approvals = value;
    });
    return this.settings(root);
  }
  setProjectFiles(root, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Vælg, om projektfiler skal godkendes automatisk.');
    return this.update(root, data => { data.autoProjectFiles = enabled; });
  }
  setCommands(root, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Vælg, om lokale kommandoer skal godkendes automatisk.');
    return this.update(root, data => { data.autoCommands = enabled; });
  }
  revoke(root, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Tilladelsen findes ikke.');
    return this.update(root, data => { data.rules = data.rules.filter(rule => rule.id !== id); });
  }
  async describe(context, p) {
    const kind = typeof p?.permission === 'string' ? p.permission : 'unknown';
    const descriptor = { kind, label: 'Denne handling', target: '', projectFile: false, persistable: false, scratch: false, key: `request:${p?.id || ''}` };
    try {
      const project = await directory(context.projectRoot), workspace = await directory(context.workspaceRoot);
      let match, identity = null;
      if (kind === 'bash') {
        const command = p.toolInput?.command || p.metadata?.command;
        if (typeof command !== 'string' || !command.trim() || command.length > 32000 || command.includes('\0')) throw new Error('Kommandoen mangler.');
        const cwd = await directory(p.toolInput?.workdir || p.metadata?.workdir || workspace);
        // Kommandoen matches byte for byte, sammen med arbejdsmappen og eventuelle
        // ekstra argumenter. En tidligere tilladt npm-kommando tillader ikke npm *.
        match = { kind, command, cwd, input: stable(p.toolInput?.input || null) };
        descriptor.target = command; descriptor.label = `Kommando: ${command}`;
        descriptor.persistable = writable(context.mode) && context.commandSandboxSupported === true;
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
          if (protectedPath(item.value) || protectedPath(canonical)) throw new Error('Beskyttede filer kræver særskilt gennemgang.');
          if (item.subtree) await directory(canonical);
          targets.push({ path: canonical, subtree: item.subtree });
        }
        targets.sort((a, b) => a.path.localeCompare(b.path) || Number(a.subtree) - Number(b.subtree));
        // Både den viste sti og dens faktiske mål skal være inde i arbejdsområdet.
        const inProject = requested.every(item => within(path.resolve(context.workspaceRoot), path.resolve(item.value))) && await allCanonicalWithin(workspace, targets.map(item => item.path));
        descriptor.projectFile = kind === 'edit' && inProject;
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
      descriptor.persistable = false; descriptor.projectFile = false; descriptor.scratch = false; delete descriptor.match;
      descriptor.key = `request:${p?.id || ''}`;
      descriptor.fingerprint = digest(stable({ permission: kind, patterns: p?.patterns, metadata: p?.metadata, toolInput: p?.toolInput, mode: context.mode }));
    }
    return descriptor;
  }
  async allowed(context, p) {
    const descriptor = await this.describe(context, p);
    if (!descriptor.match || descriptor.blockedMode) return { allowed: false, descriptor };
    if (descriptor.kind === 'bash' && context.commandSandbox !== true) return { allowed: false, descriptor };
    if (descriptor.scratch) return { allowed: true, source: 'scratch', descriptor };
    if (descriptor.projectFile && context.taskRules?.has(descriptor.key)) return { allowed: true, source: 'task', descriptor };
    const settings = await this.settings(context.projectRoot);
    if (descriptor.projectFile && settings.autoProjectFiles) return { allowed: true, source: 'project', descriptor };
    // Hovedprocessen bekræfter både opgavens opt-in og motorens aktive sandbox.
    if (descriptor.kind === 'bash' && context.commandSandbox === true && context.autoCommandsSnapshot === true) {
      const roots = [await directory(context.workspaceRoot)];
      if (context.scratchRoot) roots.push(await directory(context.scratchRoot));
      if ((await Promise.all(roots.map(root => canonicalWithin(root, descriptor.match.cwd)))).some(Boolean)) return { allowed: true, source: 'commands', descriptor };
    }
    if (descriptor.persistable && settings.rules.some(rule => rule.id === digest(descriptor.match))) return { allowed: true, source: 'rule', descriptor };
    if (descriptor.persistable && descriptor.match.targets) for (const rule of settings.rules) {
      if (rule.kind !== descriptor.kind || typeof rule.match?.folder !== 'string') continue;
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
    if (scope !== 'project' || !descriptor.persistable || !descriptor.match) throw new Error('Denne handling kan kun godkendes én gang.');
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
module.exports = { ApprovalsPolicy, canonicalPath, within };
