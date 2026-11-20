const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { run, protectedPath, secretContent } = require('./git.cjs');

// En udgivelse læses fra Git-objekter, aldrig fra tilfældige buildfiler på disken.
// Adapteren afgør efterfølgende, hvilke projekttyper og konfigurationer den understøtter.
// Udgiv kan sættes op, mens appen bygges; selve udgivelsen bruger altid den seneste gemte version.
const NO_VERSION = 'Gem en version af appen, før du udgiver. Udgiv bruger altid den seneste gemte version.';
async function deploymentArtifact(root, directory = '.') {
  if (typeof directory !== 'string' || !directory || directory.includes('\\') || directory.includes('\0') || directory.startsWith('/') || directory.split('/').some(p => p === '..') || path.posix.normalize(directory) !== directory) throw new Error('Vælg en relativ projektmappe uden .. eller særlige stitegn.');
  root = await fs.realpath(root);
  const top = (await run(root, ['rev-parse', '--show-toplevel']).catch(() => { throw new Error(NO_VERSION); })).toString().trim();
  if (await fs.realpath(top) !== root) throw new Error('Åbn Git-repositoryets rodmappe før udgivelse.');
  if ((await run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).length) throw new Error('Gem eller gennemgå lokale ændringer før udgivelse.');
  const head = (await run(root, ['rev-parse', '--verify', 'HEAD']).catch(() => { throw new Error(NO_VERSION); })).toString().trim();
  const [name, at] = (await run(root, ['log', '-1', '--format=%s%x00%cI', head])).toString().trim().split('\0');
  const prefix = directory === '.' ? '' : directory + '/';
  const entries = (await run(root, ['ls-tree', '-rz', '--full-tree', head])).toString('utf8').split('\0').filter(Boolean);
  const files = []; let bytes = 0;
  for (const entry of entries) {
    const tab = entry.indexOf('\t'); const source = entry.slice(tab + 1);
    if (!source.startsWith(prefix)) continue;
    const file = source.slice(prefix.length);
    const [mode, type, sha] = entry.slice(0, tab).split(' ');
    if (tab < 0 || !file || /[\x00-\x1f\\:]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))) throw new Error('Udgivelsen indeholder en filsti, som ikke kan pakkes sikkert.');
    if (protectedPath(source) || type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`Udgivelsen indeholder en privat fil, et link eller et undermodul: ${source}.`);
    const size = Number((await run(root, ['cat-file', '-s', sha])).toString());
    bytes += size;
    if (files.length >= 2000 || size > 2 * 1024 * 1024 || bytes > 20 * 1024 * 1024) throw new Error('Udgivelsen overstiger 2.000 filer, 2 MB pr. fil eller 20 MB samlet.');
    const data = await run(root, ['cat-file', 'blob', sha]);
    if (secretContent(data.toString()) || /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\n/.test(data.toString())) throw new Error(`Mulig hemmelighed eller Git LFS-pointer i ${source}. Gennemgå filen før udgivelse.`);
    files.push({ file, source, mode, data, sha256: createHash('sha256').update(data).digest('hex') });
  }
  if (!files.length) throw new Error('Mappen har ingen filer i den gemte Git-version. Ignorerede eller ugemte buildfiler udgives ikke.');
  files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const hash = createHash('sha256').update(JSON.stringify(files.map(f => [f.file, f.sha256]))).digest('hex');
  return { root, directory, head, hash, bytes, files, version: { name, at } };
}
module.exports = { deploymentArtifact };
