const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { names, sha256, unpack, allowedSource, lockedOpenCode, guideProblem, draftFile, draftProblem } = require('./cli-release-contract.cjs');
const root = path.resolve(__dirname, '..');
const git = async (...args) => (await run('git', args, { cwd: root })).stdout.trim();
async function sourceState(local) {
  const commit = await git('rev-parse', 'HEAD');
  const dirty = Boolean(await git('status', '--porcelain', '--untracked-files=all'));
  if (dirty && !local) throw new Error('Udgivelse kræver en ren arbejdsmappe. Brug --local til en prøve, som ikke må udgives.');
  return { commit, dirty, publishable: !local && !dirty };
}
async function verifySources(bytes, local = false) {
  const files = unpack(bytes), tracked = new Set((await git('ls-files', '-z')).split('\0'));
  const candidates = new Set((await git('ls-files', '-z', '--cached', '--others', '--exclude-standard')).split('\0').filter(allowedSource));
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify([...candidates].sort())) throw new Error('Arkivet mangler kildefiler eller indeholder ekstra filer.');
  const hashes = {};
  for (const [name, content] of files) {
    if (!local && !tracked.has(name)) throw new Error(`Pakket fil følges ikke af Git: ${name}`);
    const source = path.join(root, name), stat = await fs.lstat(source);
    if (!stat.isFile() || !content.equals(await fs.readFile(source))) throw new Error(`Pakken matcher ikke kildefilen: ${name}`);
    hashes[name] = sha256(content);
  }
  return hashes;
}
async function check(directory, { local = false, commit } = {}) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'))), expected = names(pkg.version);
  // En udgivelse må ikke sende guider og noter om den forrige CLI med ud, fordi udkastet til næste udgivelse er glemt (fund 45).
  if (!local) {
    const draft = await fs.readFile(path.join(root, draftFile), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const problem = draftProblem(draft, pkg.version);
    if (problem) throw new Error(problem);
  }
  const listed = (await fs.readdir(directory)).sort();
  if (JSON.stringify(listed) !== JSON.stringify([...expected].sort())) throw new Error('Udgivelsesmappen har manglende eller ekstra filer.');
  const files = new Map(await Promise.all(expected.map(async name => [name, await fs.readFile(path.join(directory, name))])));
  // En udgivelse må ikke sende guider med en anden motorversion end pakkens. En lokal prøve kontrollerer kun filnavnet.
  const opencode = local ? null : lockedOpenCode(pkg);
  for (const name of expected.slice(1, 4)) { const problem = guideProblem(name, files.get(name).toString('utf8'), { tarball: expected[0], opencode }); if (problem) throw new Error(problem); }
  const manifest = JSON.parse(files.get('CLI-RELEASE.json'));
  if (manifest.version !== pkg.version || manifest.package !== expected[0] || !/^[a-f0-9]{40}$/.test(manifest.source?.commit || '')
    || (commit && manifest.source.commit !== commit) || (!local && (manifest.source.publishable !== true || manifest.source.dirty !== false))) throw new Error('CLI-pakkens version eller kildegrundlag kan ikke udgives.');
  const hashes = await verifySources(files.get(expected[0]), local);
  if (JSON.stringify(manifest.sources) !== JSON.stringify(hashes)) throw new Error('CLI-pakkens kildefingeraftryk stemmer ikke.');
  const sums = expected.filter(n => n !== 'SHA256SUMS.txt').map(n => `${sha256(files.get(n))}  ${n}`).sort().join('\n') + '\n';
  if (files.get('SHA256SUMS.txt').toString() !== sums) throw new Error('SHA256SUMS.txt stemmer ikke med filerne.');
  const payload = expected.slice(0, 4).map(name => ({ name, bytes: files.get(name).length, sha256: sha256(files.get(name)) }));
  if (JSON.stringify(manifest.files) !== JSON.stringify(payload)) throw new Error('CLI-filoversigten stemmer ikke med filerne.');
  return { files, manifest };
}
async function build(directory, { local = false } = {}) {
  // Opret kun en ny mappe. Tidligere pakker og deres beviser må ikke overskrives.
  const source = await sourceState(local);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
  if (pkg.name !== 'aura-harness' || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('CLI-versionen og låsefilen stemmer ikke.');
  const expected = names(pkg.version);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory);
  const npm = process.env.npm_execpath;
  const command = npm ? process.execPath : 'npm';
  const args = [...(npm ? [npm] : []), 'pack', '--json', '--ignore-scripts', '--pack-destination', directory];
  await run(command, args, { cwd: root, maxBuffer: 1024 * 1024 });
  const archive = await fs.readFile(path.join(directory, expected[0]));
  const sources = await verifySources(archive, local);
  const opencode = local ? null : lockedOpenCode(pkg);
  for (const name of expected.slice(1, 4)) {
    const guide = await fs.readFile(path.join(root, 'cli', name), 'utf8');
    const problem = guideProblem(name, guide, { tarball: expected[0], opencode });
    if (problem) throw new Error(problem);
    await fs.writeFile(path.join(directory, name), guide);
  }
  if (JSON.stringify(await sourceState(local)) !== JSON.stringify(source)) throw new Error('Git-grundlaget ændrede sig under pakningen.');
  await verifySources(archive, local);
  const files = await Promise.all(expected.slice(0, 4).map(async name => { const bytes = await fs.readFile(path.join(directory, name)); return { name, bytes: bytes.length, sha256: sha256(bytes) }; }));
  await fs.writeFile(path.join(directory, 'CLI-RELEASE.json'), JSON.stringify({ version: pkg.version, package: expected[0], source, sources, files }, null, 2) + '\n');
  const sums = await Promise.all(expected.filter(n => n !== 'SHA256SUMS.txt').map(async name => `${sha256(await fs.readFile(path.join(directory, name)))}  ${name}`));
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), sums.sort().join('\n') + '\n');
  return check(directory, { local, commit: source.commit });
}
if (require.main === module) {
  const args = process.argv.slice(2), local = args.includes('--local'), verify = args.includes('--check');
  const positional = args.filter(a => !['--local', '--check'].includes(a));
  if (positional.length !== 1 || positional[0].startsWith('--')) { console.error('Brug: node scripts/build-cli-release.cjs NY_MAPPE [--local | --check]'); process.exitCode = 1; }
  else (verify ? check(path.resolve(positional[0]), { local, commit: process.env.GITHUB_SHA }) : build(path.resolve(positional[0]), { local }))
    .then(({ manifest }) => console.log(`CLI ${manifest.version}: filer og kildekode kontrolleret. ${manifest.source.publishable ? 'Ren kildeversion.' : 'Lokal prøve, må ikke udgives.'} Ingen upload udført.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { build, check, verifySources, sourceState };
