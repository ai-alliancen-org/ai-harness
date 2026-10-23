// Samtalekopier er lokale arbejdsmapper uden Git-metadata. Grundlaget gemmes fra selve kopien,
// så ændringer i projektet under kopieringen aldrig tilskrives samtalen ved indfletning.
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { protectedPath, secretContent } = require('./git.cjs');
const OMIT = new Set(['.git', '.next', 'dist', 'build', '.venv', '.secrets']);
const digest = data => createHash('sha256').update(data).digest('hex');
const validID = id => /^[a-f0-9-]{36}$/.test(id || '');
// A leftover merged copy is removable only while its entire tree is unchanged.
// Include generated/dependency files too: removing the directory removes those files.
// This is a bounded metadata comparison, not an atomic filesystem lock.
async function cleanupFingerprint(root) {
  const hash = createHash('sha256'), deadline = Date.now() + 2000; let entries = 0;
  const stamp = stat => [stat.mode, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
  const check = () => { if (++entries > 100000 || Date.now() > deadline) throw new Error('Kopiens oprydningsgrundlag er uafklaret.'); };
  async function visit(file, relative) {
    check();
    const before = await fs.lstat(file, { bigint: true }), version = stamp(before);
    // Replacing our own copy.json changes only the outer directory's timestamps.
    // Its other entries and every nested directory retain full version checks.
    hash.update(JSON.stringify([relative, ...(relative ? version : version.slice(0, 3))]) + '\n');
    if (before.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort()) {
        if (!relative && name === 'copy.json') continue;
        await visit(path.join(file, name), relative ? `${relative}/${name}` : name);
      }
    } else if (before.isSymbolicLink()) hash.update(JSON.stringify(await fs.readlink(file)) + '\n');
    else if (!before.isFile()) throw new Error('Kopiens filtype kræver manuel gennemgang.');
    if (JSON.stringify(stamp(await fs.lstat(file, { bigint: true }))) !== JSON.stringify(version)) throw new Error('Kopien ændrede sig under kontrollen.');
  }
  try {
    if ((await fs.realpath(root)) !== root || !(await fs.lstat(root)).isDirectory()) return null;
    await visit(root, ''); if (Date.now() > deadline) return null;
    return { version: 1, digest: hash.digest('hex'), entries };
  } catch { return null; } // A failed or incomplete comparison never authorizes deletion.
}
async function snapshot(root) {
  const files = new Map(), blocked = new Map(); let bytes = 0;
  async function visit(dir, depth = 0) {
    if (depth > 20) throw new Error('Kopien har for mange mappeniveauer.');
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, e.name), file = path.relative(root, absolute).split(path.sep).join('/');
      if (OMIT.has(e.name) || e.name === 'node_modules') continue;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) { blocked.set(file, 'symbolsk link'); continue; }
      if (protectedPath(file)) {
        // Private referencer kan være med i kopien efter brugerens tilvalg. Kun deres kontrolsum gemmes;
        // ændret privat indhold skal ikke forsvinde lydløst, når resten af kopien flettes.
        if (stat.isDirectory() && (file === 'references' || file.startsWith('references/'))) { await visit(absolute, depth + 1); continue; }
        blocked.set(file, stat.isFile() && stat.size <= 2 * 1024 * 1024 ? digest(await fs.readFile(absolute)) : `${stat.size}:${stat.mtimeMs}`); continue;
      }
      if (stat.isDirectory()) { await visit(absolute, depth + 1); continue; }
      if (!stat.isFile()) { blocked.set(file, 'ukendt filtype'); continue; }
      if (stat.size > 2 * 1024 * 1024 || files.size >= 2000 || bytes + stat.size > 64 * 1024 * 1024) { blocked.set(file, `${stat.size}:${stat.mtimeMs}`); continue; }
      const data = await fs.readFile(absolute);
      if (secretContent(data.toString()) || (data.includes(0) && !/\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(file))) { blocked.set(file, digest(data)); continue; }
      files.set(file, { data: data.toString('base64'), hash: digest(data), mode: stat.mode & 0o111 ? '100755' : '100644' }); bytes += data.length;
    }
  }
  await visit(root); return { files, blocked };
}
class Copies {
  constructor(store) { this.store = store; this.directory = path.join(store.root, 'copies'); }
  folder(id) { if (!validID(id)) throw new Error('Ugyldig samtalekopi.'); return path.join(this.directory, id); }
  async load(id, projectRoot) {
    const folder = this.folder(id);
    try { await fs.lstat(folder); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error();
      const data = JSON.parse(await fs.readFile(path.join(folder, 'copy.json'), 'utf8'));
      if (data.version !== 1 || data.id !== id || data.projectRoot !== projectRoot || !Array.isArray(data.base) || !Array.isArray(data.blocked)) throw new Error();
      const root = path.join(folder, 'project');
      if (!(await fs.lstat(root)).isDirectory() || (await fs.realpath(root)) !== root) throw new Error();
      return { ...data, root };
    } catch { throw new Error('Samtalekopien kan ikke læses. Den er bevaret i Auras lokale data.'); }
  }
  async create(projectRoot, chat) {
    const id = randomUUID(), folder = this.folder(id), root = path.join(folder, 'project');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const omissions = [];
    try {
      await fs.writeFile(path.join(folder, 'creating.json'), JSON.stringify({ version: 1, id }), { mode: 0o600 });
      async function clone(source, target, relative = '') {
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
          const rel = relative ? `${relative}/${entry.name}` : entry.name, from = path.join(source, entry.name), to = path.join(target, entry.name);
          if ((OMIT.has(entry.name) && !rel.startsWith('node_modules/')) || entry.name === '.git' || (entry.name === 'node_modules' && process.platform !== 'darwin')) continue;
          // Referencer kopieres lokalt, men adgang til dem følger stadig det synlige referencevalg.
          if (protectedPath(rel) && !rel.startsWith('references/') && rel !== 'references' && !rel.startsWith('node_modules/') && rel !== 'node_modules') { omissions.push(rel); continue; }
          const stat = await fs.lstat(from);
          if (stat.isSymbolicLink()) {
            // npm bruger interne links til fx .bin/vite. De peger på kopiens egne pakker, aldrig på projektet.
            const linked = rel.startsWith('node_modules/') ? await fs.realpath(from).catch(() => null) : null;
            if (linked && linked.startsWith(path.join(projectRoot, 'node_modules') + path.sep)) {
              await fs.symlink(path.relative(path.dirname(to), path.join(root, path.relative(projectRoot, linked))), to);
            } else omissions.push(rel);
            continue;
          }
          if (!stat.isDirectory() && !stat.isFile()) { omissions.push(rel); continue; }
          if (stat.isDirectory()) { await fs.mkdir(to, { mode: 0o700 }); await clone(from, to, rel); }
          else {
            // COPYFILE_FICLONE bruger en klon, hvor filsystemet understøtter den, ellers almindelig kopiering.
            await fs.copyFile(from, to, constants.COPYFILE_FICLONE); await fs.chmod(to, stat.mode & 0o777);
          }
        }
      }
      await clone(projectRoot, root);
      const base = await snapshot(root), data = { version: 1, id, chat, projectRoot, createdAt: new Date().toISOString(), base: [...base.files], blocked: [...base.blocked], omissions };
      await this.write(data); await fs.rm(path.join(folder, 'creating.json')); return { ...data, root };
    } catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error; }
  }
  async write(data) {
    const folder = this.folder(data.id), temp = path.join(folder, `copy-${randomUUID()}.tmp`);
    const { root, ...saved } = data;
    if (saved.merged === true) saved.cleanupProof = await cleanupFingerprint(folder);
    await fs.writeFile(temp, JSON.stringify(saved), { mode: 0o600 }); await fs.rename(temp, path.join(folder, 'copy.json'));
  }
  async diff(copy) {
    const after = await snapshot(copy.root), base = new Map(copy.base), blocked = new Map(copy.blocked), files = [], unsupported = [];
    for (const file of new Set([...base.keys(), ...after.files.keys(), ...blocked.keys(), ...after.blocked.keys()])) {
      if (blocked.has(file) || after.blocked.has(file)) { if (blocked.get(file) !== after.blocked.get(file)) unsupported.push(file); continue; }
      const before = base.get(file), now = after.files.get(file);
      if (before && now && before.mode !== now.mode) { unsupported.push(file); continue; }
      if (before?.hash !== now?.hash) files.push({ file, base: before ? Buffer.from(before.data, 'base64') : null, theirs: now ? Buffer.from(now.data, 'base64') : null, mode: now?.mode || before?.mode });
    }
    files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
    return { files, unsupported: unsupported.sort() };
  }
  async remove(copy) { await fs.rm(this.folder(copy.id), { recursive: true, force: true }); }
  // Kun uændrede flettede kopier med et kendt grundlag ryddes automatisk. Ukendt materiale bevares.
  async cleanup() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validID(entry.name)) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.folder(entry.name), 'copy.json'), 'utf8'));
        if (data.version === 1 && data.id === entry.name && data.merged === true && data.cleanupProof?.version === 1 && /^[a-f0-9]{64}$/.test(data.cleanupProof.digest)) {
          const current = await cleanupFingerprint(this.folder(entry.name));
          if (current && current.entries === data.cleanupProof.entries && current.digest === data.cleanupProof.digest) await fs.rm(this.folder(entry.name), { recursive: true, force: true });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') continue;
        // Et manglende manifest er ikke i sig selv bevis for en afbrudt oprettelse. Bevar uflettet eller ukendt
        // materiale; kun oprettelsens egen markør giver lov til at rydde den ufærdige mappe.
        try { const creating = JSON.parse(await fs.readFile(path.join(this.folder(entry.name), 'creating.json'), 'utf8')); if (creating.version === 1 && creating.id === entry.name) await fs.rm(this.folder(entry.name), { recursive: true, force: true }); } catch { /* Ukendt materiale bevares. */ }
      }
    }
  }
}
module.exports = { Copies, snapshot };
