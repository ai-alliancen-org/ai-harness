const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isProtected } = require('./protected-paths.cjs');
const OMIT = new Set(['node_modules', '.next', 'dist', 'build', '.venv', '.aura']);
// En fil, der ikke er gyldig UTF-8 (fx Windows-1252), huskes ikke som tekst. Som tekst ville æ, ø og å blive til
// erstatningstegn, og Fortryd ville skrive filen tilbage sådan (fund N:C2-3, beta 3). Versioner gemmer filen byte for byte.
const utf8 = data => { try { new TextDecoder('utf-8', { fatal: true }).decode(data); return true; } catch { return false; } };
const sha = data => createHash('sha256').update(data).digest('hex');
async function capture(root) {
  // Filer, der er for store eller ikke er tekst, huskes kun ved navn, så en sammenligning ikke tror, de er nye eller slettede.
  // En binær fil eller en fil i et ældre tekstformat, der er læst, huskes også med sit indholds hash (opaque), så en ændring af den
  // kan ses under Ændringer uden linje-diff i stedet for at forsvinde tavst. aiHash er hashen af teksten, som AI'ens filværktøj ser den.
  const files = new Map(), skippedFiles = new Set(), opaque = new Map(); let bytes = 0, skipped = 0;
  async function visit(dir, depth) {
    if (depth > 12) { skipped++; return; }
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (OMIT.has(entry.name) || isProtected(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file, depth + 1);
      else if (entry.isFile()) {
        const size = (await fs.stat(file)).size;
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (size > 500000 || files.size >= 1000 || bytes + size > 10_000_000) { skipped++; skippedFiles.add(relative); continue; }
        const data = await fs.readFile(file);
        if (data.includes(0) || !utf8(data)) { skipped++; skippedFiles.add(relative); opaque.set(relative, { hash: sha(data), aiHash: sha(data.toString('utf8')) }); continue; }
        files.set(relative, data.toString('utf8')); bytes += size;
      }
    }
  }
  await visit(root, 0); return { files, skipped, skippedFiles, opaque };
}
// En fil, der kun er læst i det ene øjebliksbillede, er hverken ny eller slettet; den tælles som udeladt.
const unknown = (snapshot, file) => Boolean(snapshot.skippedFiles?.has(file));
// Filens indhold i et øjebliksbillede som hashes: null, når filen ikke findes, og undefined, når den ikke blev læst.
function fileState(snapshot, file) {
  if (snapshot.files.has(file)) { const text = sha(snapshot.files.get(file)); return { hash: text, aiHash: text }; }
  if (snapshot.opaque?.has(file)) return snapshot.opaque.get(file);
  return unknown(snapshot, file) ? undefined : null;
}
const isOpaque = (before, after, file) => Boolean(before.opaque?.has(file) || after.opaque?.has(file));
// En ændring af en binær fil eller en fil i et ældre tekstformat. Den har ingen tekst før og efter, så Fortryd lader den være.
function opaqueEntry(before, after, file) {
  const was = fileState(before, file), now = fileState(after, file);
  if (was === undefined || now === undefined || was?.hash === now?.hash) return null;
  return { file, binary: true, opaque: true, beforeExists: was !== null, afterExists: now !== null, beforeHash: was?.hash ?? 'deleted', afterHash: now?.hash ?? 'deleted', aiHash: now?.aiHash ?? null };
}
async function changes(root, before) {
  if (!before) return { files: [], skipped: 0 };
  const after = await capture(root), files = [];
  for (const file of new Set([...before.files.keys(), ...after.files.keys(), ...(before.opaque?.keys() || []), ...after.opaque.keys()])) {
    if (isOpaque(before, after, file)) { const entry = opaqueEntry(before, after, file); if (entry) files.push(entry); continue; }
    if (before.files.get(file) !== after.files.get(file) && !unknown(before, file) && !unknown(after, file)) files.push({ file, before: before.files.get(file) ?? null, after: after.files.get(file) ?? null });
  }
  return { skipped: before.skipped + after.skipped, files };
}
// Fortryd kan ikke sætte sådan en fil tilbage. Teksten bruges, når en opgave kun ændrede den slags filer.
const OPAQUE_UNDO = 'Aura kan ikke sætte opgavens filer tilbage, fordi de er binære eller gemt i et ældre tekstformat (ikke UTF-8). Brug Versioner.';
module.exports = { capture, changes, fileState, isOpaque, opaqueEntry, OPAQUE_UNDO };
