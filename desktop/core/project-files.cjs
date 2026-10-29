// Skrivebeskyttet adgang til projektets filer for fanen Kode og for filhenvisninger til AI'en.
// Reglerne følger appens øvrige filbeskyttelse: Git-historik, private referencer, hemmelighedsfiler, installerede
// pakker og symbolske links vises aldrig, og en fil med mulig nøgle i indholdet vises heller ikke.
const fs = require('node:fs/promises');
const path = require('node:path');
const { protectedPath, secretContent } = require('./git.cjs');

const TEXT_LIMIT = 1024 * 1024, IMAGE_LIMIT = 2 * 1024 * 1024;
// Genererede mapper og værktøjsmapper, der ikke hjælper brugeren med at forstå sit projekt.
const GENERATED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.parcel-cache', '.svelte-kit', '.astro', 'coverage', '.idea', '.vscode']);
const NOISE = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// Samme regler som agentens læsetilladelser: også fx produktion.env og mappen secrets er beskyttet.
function isProtected(file) {
  return protectedPath(file);
}
class FileError extends Error { constructor(message, code) { super(message); this.code = code; } }

// En relativ sti med skråstreger. Absolutte stier, '..' og tomme led afvises, før disken læses.
function normalize(file) {
  if (typeof file !== 'string' || !file || file.length > 1000 || file.includes('\0') || file.includes('\\')) throw new FileError('Filen ligger ikke i projektet.', 'outside');
  if (path.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) throw new FileError('Filen ligger ikke i projektet.', 'outside');
  const parts = file.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new FileError('Filen ligger ikke i projektet.', 'outside');
  return parts.join('/');
}

async function locate(root, file) {
  const relative = normalize(file);
  if (isProtected(relative)) throw new FileError('Filen er beskyttet og vises ikke i Aura. Det gælder fx nøgler, private referencer og Git-historik.', 'protected');
  let target = root;
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new FileError('Filen findes ikke i projektet.', 'missing'); throw error; }
    if (stat.isSymbolicLink()) throw new FileError('Symbolske links vises ikke, fordi de kan pege uden for projektet.', 'symlink');
  }
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new FileError('Det er ikke en fil.', 'not-file');
  return { relative, target, stat };
}

// Læser én fil til visning. Billeder returneres som data-adresse; anden binær fil afvises.
async function readFile(root, file) {
  const { relative, target, stat } = await locate(root, file);
  const image = IMAGES[path.extname(relative).toLowerCase()];
  if (image) {
    if (stat.size > IMAGE_LIMIT) throw new FileError('Billedet er for stort til at blive vist her.', 'large');
    return { path: relative, kind: 'image', size: stat.size, dataURL: `data:${image};base64,${(await fs.readFile(target)).toString('base64')}` };
  }
  if (stat.size > TEXT_LIMIT) throw new FileError('Filen er for stor til at blive vist her. Grænsen er 1 MB.', 'large');
  const data = await fs.readFile(target);
  if (data.includes(0)) throw new FileError('Filen er ikke tekst og kan ikke vises her.', 'binary');
  const text = data.toString('utf8');
  if (secretContent(text)) throw new FileError('Filen kan indeholde en nøgle eller adgangskode, så den vises ikke her.', 'secret');
  return { path: relative, kind: 'text', size: stat.size, text };
}

// En filhenvisning til AI'en skal pege på en almindelig tekstfil, som Aura selv ville vise.
async function checkReference(root, reference) {
  const file = await readFile(root, reference?.path);
  if (file.kind !== 'text') throw new FileError('Du kan kun henvise til tekstfiler.', 'binary');
  const lines = file.text.split('\n').length;
  let from = reference.from ?? null, to = reference.to ?? reference.from ?? null;
  if (from !== null && (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > lines)) throw new FileError('Linjerne findes ikke i filen.', 'lines');
  return { path: file.path, from, to };
}
const referenceLabel = ref => ref.from ? `${ref.path} (${ref.from === ref.to ? `linje ${ref.from}` : `linje ${ref.from}–${ref.to}`})` : ref.path;

// Projektets filer til filvalget, uden indhold. Beskyttede, genererede og skjulte systemfiler er udeladt.
async function listFiles(root, { limit = 3000 } = {}) {
  const files = [];
  let truncated = false;
  async function visit(dir, prefix, depth) {
    if (depth > 12 || truncated) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'da'));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || NOISE.test(entry.name) || isProtected(relative)) continue;
      if (entry.isDirectory()) { if (!GENERATED.has(entry.name)) await visit(path.join(dir, entry.name), relative, depth + 1); continue; }
      if (!entry.isFile()) continue;
      if (files.length >= limit) { truncated = true; return; }
      files.push({ path: relative, image: Boolean(IMAGES[path.extname(entry.name).toLowerCase()]) });
    }
  }
  await visit(root, '', 0);
  return { files, truncated };
}

module.exports = { readFile, listFiles, checkReference, referenceLabel, isProtected, normalize, FileError };
