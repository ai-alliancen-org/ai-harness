const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID, scrypt: derive, createCipheriv, createDecipheriv } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { serviceName } = require('./keychain.cjs');
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
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Auras datamappe tilhører en anden bruger. Brug en mappe, du selv ejer, eller vælg en anden AURA_HOME.');
  if (process.platform !== 'win32' && stat.mode & 0o077) throw new Error('Auras datamappe er tilgængelig for andre brugere. Ret rettighederne til kun din bruger før start.');
  return fs.realpath(root);
}
async function readPrivate(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10000 || (process.platform !== 'win32' && stat.mode & 0o077)) throw new Error('Nøglelagerets metadata har ugyldige rettigheder eller format. Filen er bevaret.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
// Tre slags værdier kan stå i settings.json under "secret":
// AURA1 (gammel): krypteret med adgangssætningen. AURAK1:<konto>: nøglen ligger i computerens nøglering. AURAP1: kontrolværdi.
const LEGACY = 'AURA1', MARKER = 'AURAK1:', PROBE_MARKER = 'AURAP1', PROBE_VALUE = 'kontrol';
const ACCOUNT = /^[a-f0-9-]{36}$/;
const startsWith = (buffer, prefix) => buffer.length >= prefix.length && buffer.subarray(0, prefix.length).toString('latin1') === prefix;
const markerAccount = buffer => startsWith(buffer, MARKER) && ACCOUNT.test(buffer.subarray(MARKER.length).toString('utf8')) ? buffer.subarray(MARKER.length).toString('utf8') : null;
const isLegacy = secret => typeof secret === 'string' && startsWith(Buffer.from(secret, 'base64'), LEGACY);
function secretHolders(node, found = []) {
  if (Array.isArray(node)) for (const item of node) secretHolders(item, found);
  else if (node && typeof node === 'object') for (const [name, value] of Object.entries(node)) { if (name === 'secret' && typeof value === 'string') found.push(node); else secretHolders(value, found); }
  return found;
}
class Vault {
  // Med en nøglering gemmes nøgler dér, og adgangssætningen er kun reserve. Uden nøglering (null) bruges kun adgangssætningen.
  constructor(root, { keychain = null } = {}) {
    this.root = root; this.key = null; this.keychain = keychain;
    this.mode = keychain ? null : 'passphrase'; this.service = keychain ? serviceName(root) : null;
  }
  isEncryptionAvailable() { return this.mode === 'keychain' || Boolean(this.key); }
  encryptString(value) {
    if (this.mode === 'keychain') {
      // Skærmbillederne kontrollerer blot, at kryptering findes. Det skal ikke efterlade en post i nøgleringen.
      if (value === PROBE_VALUE) return Buffer.from(PROBE_MARKER);
      const account = randomUUID();
      try {
        this.keychain.set(this.service, account, value);
        if (this.keychain.get(this.service, account) !== value) throw new Error('Nøgleringen gav ikke nøglen tilbage uændret.');
      } catch (error) {
        try { this.keychain.delete(this.service, account); } catch { /* intet at rydde op */ }
        throw new Error(`Nøglen blev ikke gemt i computerens nøglering. ${error.message}`);
      }
      return Buffer.from(MARKER + account);
    }
    return this.seal(value);
  }
  seal(value) {
    if (!this.key) throw new Error('Lås terminalens nøglelager op først.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('aura-cli-v1'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from('AURA1'), iv, cipher.getAuthTag(), ciphertext]);
  }
  // Giver en forklaring på almindeligt dansk, hvis nøgleringen ikke kan levere nøglen.
  read(account) {
    if (!this.keychain) throw new Error('Nøglen ligger i computerens nøglering, men den kan ikke bruges i denne terminal.');
    let value;
    try { value = this.keychain.get(this.service, account); }
    catch (error) { throw new Error(`Nøglen ligger i computerens nøglering, men den kan ikke læses nu. ${error.message} Hjælper det ikke, så indtast nøglen igen med aura login.`); }
    if (value === null) throw new Error('Nøglen findes ikke længere i computerens nøglering, eller den hører til en anden datamappe. Opret forbindelsen igen med aura login.');
    return value;
  }
  verify(secret) {
    const account = typeof secret === 'string' ? markerAccount(Buffer.from(secret, 'base64')) : null;
    if (account) this.read(account);
  }
  decryptString(value) {
    if (startsWith(value, PROBE_MARKER)) return PROBE_VALUE;
    const account = markerAccount(value);
    if (account) return this.read(account);
    if (!this.key || value.length < 33 || value.subarray(0, 5).toString() !== 'AURA1') throw new Error('Nøglelageret er låst eller ugyldigt.');
    const cipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(5, 17));
    cipher.setAAD(Buffer.from('aura-cli-v1')); cipher.setAuthTag(value.subarray(17, 33));
    return Buffer.concat([cipher.update(value.subarray(33)), cipher.final()]).toString('utf8');
  }
  probe() {
    const account = randomUUID();
    try {
      this.keychain.set(this.service, account, 'aura-kontrol');
      if (this.keychain.get(this.service, account) !== 'aura-kontrol') throw new Error('Nøgleringen gav ikke en prøveværdi tilbage.');
    } finally { try { this.keychain.delete(this.service, account); } catch { /* prøveposten ryddes, så godt det kan */ } }
  }
  async unlock(ui) {
    if (this.mode === 'keychain' || this.key) return;
    if (this.mode === null) {
      try {
        this.probe(); this.mode = 'keychain';
        ui.line(`Nøgler gemmes i computerens nøglering (${this.keychain.name}). Adgangssætningen bruges kun som reserve.`);
        return;
      } catch (error) {
        this.mode = 'passphrase';
        ui.line(`Computerens nøglering kan ikke bruges. ${error.message} Nøglerne gemmes derfor i stedet krypteret med en adgangssætning, som du selv vælger.`);
        // Værktøjets egen fejltekst, fx fra PowerShell på Windows, står for sig under beskeden (RN:F-3).
        if (error.details) ui.line(`Detaljer: ${error.details}`);
      }
    }
    await this.unlockPassphrase(ui);
  }
  async unlockPassphrase(ui) {
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
        const check = this.seal('Aura CLI nøglelager').toString('base64');
        await fs.writeFile(file, JSON.stringify({ version: 1, salt, check }) + '\n', { flag: 'wx', mode: 0o600 });
      }
    } catch { this.close(); throw new Error('Nøglelageret kunne ikke åbnes eller oprettes. Kontrollér adgangssætningen; eksisterende filer er bevaret.'); }
  }
  // De gamle værdier (AURA1), der endnu ligger i settings.json.
  async pendingLegacy(store) { return [...new Set(secretHolders(await store.read()).map(holder => holder.secret).filter(isLegacy))]; }
  // Flytter nøgler fra adgangssætningslageret til nøgleringen. Hver ny post læses tilbage og skal stemme, før noget i
  // settings.json ændres; først da forsvinder den gamle kopi. Fejler nøgleringen, rulles de nye poster tilbage, og de gamle
  // bevares. En værdi, som den rigtige adgangssætning ikke kan åbne, kan aldrig bruges; den bliver liggende, men stopper ikke
  // flytningen af de andre (fund 46).
  async migrate(store, ui) {
    if (this.mode !== 'keychain') return 0;
    const legacy = await this.pendingLegacy(store);
    if (!legacy.length) return 0;
    ui.line('Dine gemte nøgler flyttes nu fra terminalens gamle adgangssætningslager til computerens nøglering. Når de er flyttet, bruges adgangssætningen ikke mere.');
    await this.unlockPassphrase(ui);
    const created = new Map(); let unreadable = 0;
    try {
      for (const old of legacy) {
        let plain;
        try { plain = this.decryptString(Buffer.from(old, 'base64')); } catch { unreadable++; continue; }
        const account = randomUUID();
        created.set(old, account);
        this.keychain.set(this.service, account, plain);
        if (this.keychain.get(this.service, account) !== plain) throw new Error('Nøgleringen gav ikke nøglen tilbage uændret.');
      }
      if (created.size) await store.update(state => {
        for (const holder of secretHolders(state)) { const account = created.get(holder.secret); if (account) holder.secret = Buffer.from(MARKER + account).toString('base64'); }
      });
    } catch (error) {
      for (const account of created.values()) { try { this.keychain.delete(this.service, account); } catch { /* bedst muligt */ } }
      throw new Error(`Nøglerne blev ikke flyttet. De gamle er bevaret uændret. ${error.message}`);
    } finally { this.close(); }
    if (created.size) ui.line(`${created.size} ${created.size === 1 ? 'nøgle er' : 'nøgler er'} flyttet til computerens nøglering. De gamle kopier er fjernet fra terminalens lager.`);
    if (unreadable) ui.line(unreadable === 1
      ? '1 gammel nøgle kunne ikke åbnes med adgangssætningen og er ikke flyttet. Fjern den gamle forbindelse med aura logout, og tilføj nøglen igen med aura login.'
      : `${unreadable} gamle nøgler kunne ikke åbnes med adgangssætningen og er ikke flyttet. Fjern de gamle forbindelser med aura logout, og tilføj nøglerne igen med aura login.`);
    return created.size;
  }
  // Sletter nøgleringens post for en fjernet forbindelse. Returnerer false, hvis værdien ikke var en post.
  forget(secret) {
    const account = this.keychain && typeof secret === 'string' ? markerAccount(Buffer.from(secret, 'base64')) : null;
    return account ? this.keychain.delete(this.service, account) : false;
  }
  close() { this.key?.fill(0); this.key = null; }
}
// Navnet på det program, der nu har låsens nummer, eller null, hvis det ikke kan afgøres.
function processName(pid, { platform = process.platform, runner = spawnSync } = {}) {
  try {
    if (platform === 'win32') {
      const result = runner('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const match = /^"([^"]+)","(\d+)"/m.exec(result.stdout || '');
      return match && Number(match[2]) === pid ? match[1] : null;
    }
    const result = runner('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5000 });
    const name = result.status === 0 ? String(result.stdout || '').trim() : '';
    return name ? path.basename(name) : null;
  } catch { return null; }
}
// Aura kører altid som et Node-program. Har låsens nummer fået et andet program, fx efter et nedbrud eller en genstart, er
// låsen forældet (fund 47). Kan navnet ikke afgøres, regnes processen for en mulig Aura.
const mayBeAura = name => name === null || /node/i.test(name);
async function lock(root) {
  const file = path.join(root, 'cli.lock'), token = randomUUID();
  const write = () => fs.writeFile(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
  try { await write(); }
  catch (error) {
    // En lås fra en proces, der ikke findes mere (fx en lukket terminal), eller hvis nummer nu bruges af et andet program,
    // overtages automatisk. En levende ejer, der kan være Aura, afviser stadig.
    if (error.code === 'EEXIST') {
      const record = await readPrivate(file).catch(() => null);
      let alive = true;
      if (record && Number.isSafeInteger(record.pid) && record.pid > 0) {
        try { process.kill(record.pid, 0); } catch (killError) { if (killError.code === 'ESRCH') alive = false; }
        if (alive && !mayBeAura(processName(record.pid))) alive = false;
      }
      if (!alive) {
        // Læs låsen igen efter omdøbningen: er det ikke den, vi vurderede som forældet, har en anden proces nået at overtage den.
        const moved = file + '.' + randomUUID(); let renamed = true; await fs.rename(file, moved).catch(() => { renamed = false; });
        const taken = renamed ? await fs.readFile(moved, 'utf8').then(text => JSON.parse(text), () => null) : null;
        if (renamed && taken?.token !== record.token) {
          // Gendan den andens lås, hvis stedet stadig er ledigt. link overskriver aldrig en nyere lås.
          await fs.link(moved, file).catch(() => {}); await fs.unlink(moved).catch(() => {});
          throw new Error(`En anden Aura-terminal bruger datamappen. Luk den først. (${file})`);
        }
        await fs.unlink(moved).catch(() => {});
        try { await write(); return () => { try { if (JSON.parse(sync.readFileSync(file)).token === token) sync.unlinkSync(file); } catch {} }; } catch { /* en anden proces nåede først */ }
      }
    }
    if (error.code === 'EEXIST') throw new Error(`En anden Aura-terminal bruger datamappen, eller en tidligere proces blev afbrudt. Luk den først. Ved en gammel lås: aura unlock. (${file})`);
    throw error;
  }
  return () => { try { if (JSON.parse(sync.readFileSync(file)).token === token) sync.unlinkSync(file); } catch {} };
}
// Hvordan låsens proces har det: findes ikke, kører under en anden bruger eller med andre rettigheder, eller kører.
function owner(pid) {
  try { process.kill(pid, 0); return 'running'; }
  catch (error) { if (error.code === 'ESRCH') return 'gone'; if (error.code === 'EPERM') return 'foreign'; throw error; }
}
async function unlockStale(root, ui) {
  const file = path.join(root, 'cli.lock');
  let stat; try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') { ui.line('Der er ingen lås at fjerne.'); return; } throw error; }
  if (stat.isDirectory()) throw new Error('Låsen er en mappe og kan ikke fjernes her. Gennemgå den manuelt.');
  // En lås med forkerte rettigheder eller ulæseligt indhold må ikke låse terminalen for altid. Pid læses, hvis den kan, og en levende proces, der kan være Aura, afviser stadig.
  let record = null, problem = '';
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 10000) problem = 'Låsen er ikke en almindelig lille fil.';
  else {
    if (process.platform !== 'win32' && stat.mode & 0o077) problem = 'Låsen er tilgængelig for andre brugere.';
    try { record = JSON.parse(await fs.readFile(file, 'utf8')); } catch { problem ||= 'Låsen kan ikke læses.'; }
  }
  const known = Number.isSafeInteger(record?.pid) && record.pid > 0;
  if (!known) problem ||= 'Låsen kan ikke læses.';
  // Nummeret vises, så brugeren kan se, hvilken proces låsen peger på (fund 47).
  let question = problem
    ? `${problem} Fjern den kun, hvis du er sikker på, at ingen anden Aura-terminal kører. Fjern låsen?`
    : `Den tidligere proces (${record.pid}) findes ikke. Fjern dens lås?`;
  if (known) {
    const state = owner(record.pid), name = state === 'gone' ? null : processName(record.pid), before = problem ? problem + ' ' : '';
    if (state !== 'gone' && !mayBeAura(name)) question = `${before}Låsen peger på proces ${record.pid}, men nummeret bruges nu af et andet program (${name}). Den tidligere Aura-proces findes ikke. Fjern låsen?`;
    else if (state === 'foreign') question = `${before}Låsen peger på proces ${record.pid}, som kører under en anden bruger eller med andre rettigheder. Det er næppe Aura, men fjern kun låsen, hvis ingen anden Aura-terminal er åben. Fjern låsen?`;
    else if (state === 'running') throw new Error(`Proces ${record.pid}, som har låsen, findes stadig og kan være en anden Aura-terminal. Luk den først. Har du ingen anden Aura-terminal åben, så genstart computeren; så overtager Aura låsen ved næste start.`);
  }
  if (await ui.confirm(question)) {
    // Omdøb først: en ny proces kan ikke få sin lås slettet ved den efterfølgende oprydning.
    const moved = file + '.' + randomUUID(); await fs.rename(file, moved); await fs.unlink(moved); ui.line('Den gamle lås er fjernet.');
  }
}
function separateState(project, state) {
  const inside = (a, b) => { const relative = path.relative(a, b); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  if (inside(project, state) || inside(state, project)) throw new Error('Projektet og Auras datamappe må ikke ligge inde i hinanden. Åbn en mere afgrænset projektmappe, eller vælg en anden AURA_HOME.');
}
module.exports = { Vault, isLegacy, dataDirectory, privateDirectory, lock, unlockStale, separateState, processName };
