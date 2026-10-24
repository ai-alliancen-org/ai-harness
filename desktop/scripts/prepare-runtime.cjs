// Hent kun versionslåste værktøjer ved bygning; aldrig ved brugerens opstart.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const lock = require('../runtime-lock.json');
const root = path.join(__dirname, '..');
async function download(entry, target) {
  const valid = data => entry.integrity ? `sha512-${createHash('sha512').update(data).digest('base64')}` === entry.integrity : createHash('sha256').update(data).digest('hex') === entry.checksum;
  try { if (valid(await fs.readFile(target))) return; } catch {}
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download afvist: ${new URL(entry.url).hostname} (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!valid(data)) throw new Error('Kontrolsum matcher ikke: ' + path.basename(target));
  await fs.writeFile(target, data);
}
async function prepare(target = `${process.platform}-${process.arch}`) {
  const entries = lock.targets[target]; if (!entries) throw new Error('Ukendt byggeplatform: ' + target);
  const output = path.join(root, '.runtime', target), cache = path.join(root, '.cache', 'runtime');
  await fs.mkdir(cache, { recursive: true });
  // Kun denne scripts genererede målmappe udskiftes, aldrig brugerprojekter.
  await fs.rm(output, { recursive: true, force: true }); await fs.mkdir(output, { recursive: true });
  for (const name of ['opencode', 'git', 'node']) {
    const entry = entries[name], archive = path.join(cache, path.basename(new URL(entry.url).pathname));
    console.log(`Kontrollerer ${name} til ${target}`); await download(entry, archive);
    const listing = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (listing.split('\n').some(p => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..'))) throw new Error('Ugyldig arkivsti.');
    const folder = path.join(output, name); await fs.mkdir(folder);
    execFileSync('tar', ['-xf', archive, '-C', folder, ...(name === 'git' ? [] : ['--strip-components', '1'])]);
  }
  const sources = path.join(output, 'sources'); await fs.mkdir(sources);
  for (const entry of lock.sources || []) await download(entry, path.join(sources, entry.name));
  await fs.cp(path.join(root, 'packaging', 'licenses'), path.join(output, 'licenses'), { recursive: true });
  const payloads = await require('./runtime-integrity.cjs').inventory(output);
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ target, versions: {opencode:lock.opencode,git:lock.git,node:lock.node}, sources:lock.sources || [], archives:entries, payloads }, null, 2));
  return output;
}
if (require.main === module) prepare(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, download };
