const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID, scrypt: derive, createCipheriv, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(derive);
function dataDirectory(env = process.env, platform = process.platform, home = os.homedir()) {
  const location = env.AURA_HOME || (platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'AuraCLI') : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'AuraCLI') : path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'aura-cli'));
  if (!path.isAbsolute(location)) throw new Error('AURA_HOME og systemets datamappe skal være absolutte stier.');
  return location;
}
async function privateDirectory(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Auras datamappe skal være en almindelig mappe, ikke et symbolsk link.');
  if (process.platform !== 'win32' && stat.mode & 0o077) throw new Error('Auras datamappe er tilgængelig for andre brugere. Ret rettighederne til kun din bruger før start.');
  return fs.realpath(root);
}
async function readPrivate(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10000 || (process.platform !== 'win32' && stat.mode & 0o077)) throw new Error('Nøglelagerets metadata har ugyldige rettigheder eller format. Filen er bevaret.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
class Vault {
  constructor(root) { this.root = root; this.key = null; }
  isEncryptionAvailable() { return Boolean(this.key); }
  encryptString(value) {
    if (!this.key) throw new Error('Lås terminalens nøglelager op først.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('aura-cli-v1'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from('AURA1'), iv, cipher.getAuthTag(), ciphertext]);
  }
  decryptString(value) {
    if (!this.key || value.length < 33 || value.subarray(0, 5).toString() !== 'AURA1') throw new Error('Nøglelageret er låst eller ugyldigt.');
    const cipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(5, 17));
    cipher.setAAD(Buffer.from('aura-cli-v1')); cipher.setAuthTag(value.subarray(17, 33));
    return Buffer.concat([cipher.update(value.subarray(33)), cipher.final()]).toString('utf8');
  }
  async unlock(ui) {
    if (this.key) return;
    const file = path.join(this.root, 'vault.json');
    let record;
    try { record = await readPrivate(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (record && (record.version !== 1 || !/^[a-f0-9]{32}$/.test(record.salt) || typeof record.check !== 'string')) throw new Error('Nøglelagerets format kan ikke læses. Det er bevaret.');
    if (!record) ui.line('Vælg en adgangssætning til terminalens nøglelager. Den kan ikke gendannes. Nøgler krypteres; samtaler og projektfiler gør ikke.');
    const password = await ui.ask(record ? 'Adgangssætning til nøglelager' : 'Ny adgangssætning (mindst 12 tegn)', { secret: true, required: true });
    ui.protect(password);
    if (!record && (password.length < 12 || password !== await ui.ask('Gentag adgangssætningen', { secret: true }))) throw new Error('Brug mindst 12 tegn, og skriv samme adgangssætning to gange.');
    const salt = record?.salt || randomBytes(16).toString('hex');
    this.key = await scrypt(password, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    try {
      if (record) {
        if (this.decryptString(Buffer.from(record.check, 'base64')) !== 'Aura CLI nøglelager') throw new Error();
      } else {
        const check = this.encryptString('Aura CLI nøglelager').toString('base64');
        await fs.writeFile(file, JSON.stringify({ version: 1, salt, check }) + '\n', { flag: 'wx', mode: 0o600 });
      }
    } catch { this.close(); throw new Error('Nøglelageret kunne ikke åbnes eller oprettes. Kontrollér adgangssætningen; eksisterende filer er bevaret.'); }
  }
  close() { this.key?.fill(0); this.key = null; }
}
async function lock(root) {
  const file = path.join(root, 'cli.lock'), token = randomUUID();
  const write = () => fs.writeFile(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
  try { await write(); }
  catch (error) {
    // En lås fra en proces, der ikke findes mere (fx en lukket terminal), overtages automatisk. En levende ejer afviser stadig.
    if (error.code === 'EEXIST') {
      const record = await readPrivate(file).catch(() => null);
      let alive = true;
      if (record && Number.isSafeInteger(record.pid) && record.pid > 0) { try { process.kill(record.pid, 0); } catch (killError) { if (killError.code === 'ESRCH') alive = false; } }
      if (!alive) {
        const moved = file + '.' + randomUUID(); await fs.rename(file, moved).catch(() => {}); await fs.unlink(moved).catch(() => {});
        try { await write(); return () => { try { if (JSON.parse(sync.readFileSync(file)).token === token) sync.unlinkSync(file); } catch {} }; } catch { /* en anden proces nåede først */ }
      }
    }
    if (error.code === 'EEXIST') throw new Error(`En anden Aura-terminal bruger datamappen, eller en tidligere proces blev afbrudt. Luk den først. Ved en gammel lås: aura unlock. (${file})`);
    throw error;
  }
  return () => { try { if (JSON.parse(sync.readFileSync(file)).token === token) sync.unlinkSync(file); } catch {} };
}
async function unlockStale(root, ui) {
  const file = path.join(root, 'cli.lock'), record = await readPrivate(file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!record) { ui.line('Der er ingen lås at fjerne.'); return; }
  if (!Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error('Låsen kan ikke læses. Gennemgå den manuelt.');
  try { process.kill(record.pid, 0); throw new Error('Processen findes stadig. Luk den, før låsen fjernes.'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (await ui.confirm('Den tidligere proces findes ikke. Fjern dens lås?')) {
    // Omdøb først: en ny proces kan ikke få sin lås slettet ved den efterfølgende oprydning.
    const moved = file + '.' + randomUUID(); await fs.rename(file, moved); await fs.unlink(moved); ui.line('Den gamle lås er fjernet.');
  }
}
function separateState(project, state) {
  const inside = (a, b) => { const relative = path.relative(a, b); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  if (inside(project, state) || inside(state, project)) throw new Error('Projektet og Auras datamappe må ikke ligge inde i hinanden. Åbn en mere afgrænset projektmappe, eller vælg en anden AURA_HOME.');
}
module.exports = { Vault, dataDirectory, privateDirectory, lock, unlockStale, separateState };
