const fs = require('node:fs/promises');
const path = require('node:path');
const { isProtected } = require('./protected-paths.cjs');
const OMIT = new Set(['node_modules', '.next', 'dist', 'build', '.venv']);
async function capture(root) {
  // Filer, der er for store eller ikke er tekst, huskes kun ved navn, så en sammenligning ikke tror, de er nye eller slettede.
  const files = new Map(), skippedFiles = new Set(); let bytes = 0, skipped = 0;
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
        if (data.includes(0)) { skipped++; skippedFiles.add(relative); continue; }
        files.set(relative, data.toString('utf8')); bytes += size;
      }
    }
  }
  await visit(root, 0); return { files, skipped, skippedFiles };
}
// En fil, der kun er læst i det ene øjebliksbillede, er hverken ny eller slettet; den tælles som udeladt.
const unknown = (snapshot, file) => Boolean(snapshot.skippedFiles?.has(file));
async function changes(root, before) {
  if (!before) return { files: [], skipped: 0 };
  const after = await capture(root);
  return { skipped: before.skipped + after.skipped, files: [...new Set([...before.files.keys(), ...after.files.keys()])].filter(file => before.files.get(file) !== after.files.get(file) && !unknown(before, file) && !unknown(after, file)).map(file => ({ file, before: before.files.get(file) ?? null, after: after.files.get(file) ?? null })) };
}
module.exports = { capture, changes };
