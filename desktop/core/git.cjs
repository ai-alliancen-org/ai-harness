const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const digest = data => createHash('sha256').update(data).digest('hex');
const LIMIT = 2 * 1024 * 1024;

function run(root, args, input, configuration = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' });
  env.GIT_CONFIG_COUNT = String(configuration.length);
  configuration.forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value; });
  return new Promise((resolve, reject) => {
    const runtime = require('./runtime.cjs');
    const child = execFile(runtime.get()?.git || 'git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, env: runtime.gitEnvironment(env), timeout: 30000, maxBuffer: 8 * LIMIT, windowsHide: true, encoding: 'buffer' }, (error, stdout) => {
      if (error) { const failure = new Error(error.code === 'ENOENT' ? 'Git blev ikke fundet. Installer Git, og genstart appen.' : 'Git kunne ikke gennemføre handlingen. Kontrollér repository, låsefiler, hooks og eventuel commitsignering.'); failure.code = error.code; reject(failure); }
      else resolve(stdout);
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
async function optional(root, args) { try { return (await run(root, args)).toString('utf8').trim(); } catch (error) { if (error.code === 'ENOENT') throw error; return ''; } }
async function exists(file) { try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function parseStatus(raw) {
  const fields = raw.toString('utf8').split('\0'); const files = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    const status = fields[i].slice(0, 2), file = fields[i].slice(3);
    if (/[RC]/.test(status)) { const from = fields[++i]; files.push({ file: from, status: ' D' }); }
    files.push({ file, status });
  }
  return files;
}
const { isProtected } = require('./protected-paths.cjs');
function protectedPath(file) {
  return isProtected(file) || file.split(/[\\/]/).some(part => part.toLowerCase() === 'node_modules');
}
function secretContent(text) {
  return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-|or-v1-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|kp_live_[A-Za-z0-9_-]{43}|komp_publish_(?:grant_)?[a-f0-9]{64})\b/i.test(text) || /(?:api[_-]?key|secret|password|access[_-]?token)\s*["']?\s*[:=]\s*["'][^"'\r\n]{12,}["']/i.test(text);
}
async function content(root, file) {
  if (!file || path.isAbsolute(file) || file.split('/').some(p => p === '..' || p === '.git') || file.includes('\0')) throw new Error('Ugyldig Git-filsti.');
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) return { blocked: 'Symbolske links kræver manuel Git-gennemgang.', hash: 'symlink' }; }
    catch (e) { if (e.code === 'ENOENT') return { hash: 'deleted', text: null }; throw e; }
  }
  const stat = await fs.stat(current);
  if (!stat.isFile() || stat.size > LIMIT) return { blocked: 'Mappen eller filen overstiger versionsvisningens grænse på 2 MB.', hash: `${stat.size}:${stat.mtimeMs}` };
  const data = await fs.readFile(current);
  const hash = digest(data);
  if (protectedPath(file)) return { hash, blocked: 'Privat reference eller mulig hemmelighedsfil.' };
  if (data.includes(0)) return /\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(file) ? { hash, binary: true, text: null, mode: stat.mode & 0o111 ? '100755' : '100644' } : { hash, blocked: 'Denne binære filtype kræver manuel Git-gennemgang uden for appen.' };
  const text = data.toString('utf8');
  if (secretContent(text)) return { hash, blocked: 'Mulig nøgle eller hemmelighed i indholdet. Gennemgå filen uden for appen.' };
  return { hash, text, mode: stat.mode & 0o111 ? '100755' : '100644' };
}

// Versioner i nye projekter står under dette navn, indtil brugeren selv vælger et. Adressen kan aldrig modtage post (.invalid).
const ANONYMOUS = { name: 'Aura-bruger', email: 'bruger@aura.invalid' };
class GitVersions {
  constructor() { this.reviews = new Map(); this.busy = false; }
  async repository(root) {
    root = await fs.realpath(root);
    await run(root, ['--version']);
    const top = await optional(root, ['rev-parse', '--show-toplevel']);
    if (!top) {
      if (await optional(root, ['rev-parse', '--is-bare-repository']) === 'true') throw new Error('Et bare repository kan ikke bruges som arbejdsområde.');
      if (await exists(path.join(root, '.git'))) throw new Error('Git-mappen kan ikke læses. Den bliver ikke genoprettet.');
      return { root, initialized: false, block: 'Projektet har endnu ingen Git-historik.' };
    }
    if (await fs.realpath(top) !== root) return { root, initialized: true, block: 'Åbn selve repositoryets rodmappe for at gemme versioner.', wrongRoot: true };
    const gitDir = (await run(root, ['rev-parse', '--absolute-git-dir'])).toString().trim();
    const branch = await optional(root, ['symbolic-ref', '--short', 'HEAD']);
    const head = await optional(root, ['rev-parse', '--verify', 'HEAD']);
    const operation = (await Promise.all(['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer','index.lock'].map(name => exists(path.join(gitDir, name))))).some(Boolean);
    const raw = await run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
    const files = parseStatus(raw);
    const identity = { name: await optional(root, ['config', 'user.name']), email: await optional(root, ['config', 'user.email']) };
    const staged = files.some(f => f.status !== '??' && f.status[0] !== ' ');
    const block = operation ? 'Afslut den igangværende Git-handling, før du gemmer en version.' : !branch ? 'Repositoryet har ingen aktiv branch. Vælg en branch i dit Git-værktøj.' : files.some(f => /U/.test(f.status) || ['AA','DD'].includes(f.status)) ? 'Løs Git-konflikterne først.' : staged ? 'Der er allerede staged ændringer. Afslut dem i dit Git-værktøj først; appen ændrer ikke dit eksisterende filvalg.' : !identity.name || !identity.email ? 'Git mangler user.name eller user.email. Opsæt din Git-identitet, før du gemmer en version.' : '';
    return { root, initialized: true, gitDir, branch, head, files, raw: raw.toString('base64'), identity, block };
  }
  async status(root) {
    const repo = await this.repository(root);
    const history = repo.head ? (await run(root, ['log', '-12', '--format=%h%x00%s%x00%H%x00%cI'])).toString().split('\n').filter(Boolean).map(line => { const [id, message, commit, at] = line.split('\0'); return { id, message, commit, at }; }) : [];
    return { initialized: repo.initialized, block: repo.block, wrongRoot: Boolean(repo.wrongRoot), branch: repo.branch || '', head: repo.head || '', identity: repo.identity, changes: repo.files?.length || 0, history };
  }
  async initialize(root) {
    const repo = await this.repository(root);
    if (repo.initialized) throw new Error('Mappen ligger allerede i et Git-repository.');
    await run(repo.root, ['init']);
    return this.status(repo.root);
  }
  // Nye projekter fra appen får Git fra start: en lokal historik, en anonym identitet, hvis computeren ikke har en,
  // og en første version af startfilerne. Eksisterende mapper og repositories røres aldrig her.
  async startProject(root, message = 'Projekt oprettet') {
    let repo = await this.repository(root);
    if (repo.initialized) return { started: false };
    await run(repo.root, ['init', '-b', 'main']);
    repo = await this.repository(repo.root);
    if (!repo.identity.name) await run(repo.root, ['config', '--local', 'user.name', ANONYMOUS.name]);
    if (!repo.identity.email) await run(repo.root, ['config', '--local', 'user.email', ANONYMOUS.email]);
    const review = await this.review(repo.root);
    const files = review.files.filter(file => !file.blocked).map(file => file.file);
    if (files.length) await this.commit(repo.root, { token: review.token, files, message });
    return { started: true, files: files.length };
  }
  // Gem version med ét klik: alle ændrede filer, som versionsgemningen accepterer. Afviste filer nævnes og bliver ugemte.
  async saveAll(root, note = '') {
    if (typeof note !== 'string' || note.length > 300 || /[\r\n\0]/.test(note)) throw new Error('Skriv en beskrivelse på én linje og højst 300 tegn.');
    const review = await this.review(root);
    const files = review.files.filter(file => !file.blocked).map(file => file.file);
    const kept = review.files.filter(file => file.blocked).map(file => file.file);
    if (!files.length) return { saved: 0, kept };
    const result = await this.commit(root, { token: review.token, files, message: note.trim() || 'Gemt version' });
    return { saved: files.length, kept, head: result.head };
  }
  async setIdentity(root, input) {
    const repo = await this.repository(root);
    if (!repo.initialized || repo.wrongRoot) throw new Error('Opret eller åbn først projektets egen Git-historik.');
    if (repo.identity.name && repo.identity.email) throw new Error('Der findes allerede en Git-identitet. Den ændres ikke her.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || /[\r\n\0<>]/.test(input.name) || typeof input.email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.email) || input.email.length > 254) throw new Error('Skriv dit navn og en gyldig e-mailadresse.');
    if (!repo.identity.name) await run(repo.root, ['config', '--local', 'user.name', input.name.trim()]);
    if (!repo.identity.email) await run(repo.root, ['config', '--local', 'user.email', input.email.trim()]);
    return this.status(repo.root);
  }
  async review(root) {
    const repo = await this.repository(root);
    if (!repo.initialized || repo.block) throw new Error(repo.block);
    if (repo.files.length > 200) throw new Error('Der er flere end 200 ændrede filer. Gennemgå dem i dit Git-værktøj.');
    const files = [];
    for (const file of repo.files) {
      const value = await content(repo.root, file.file);
      if (protectedPath(file.file)) value.blocked = 'Privat reference eller mulig hemmelighedsfil.';
      let before = null;
      if (!value.blocked && repo.head && file.status !== '??') {
        const data = await run(repo.root, ['show', `${repo.head}:${file.file}`]).catch(() => null);
        if (data) {
          if (data.length > LIMIT || (data.includes(0) && !value.binary) || secretContent(data.toString())) value.blocked = 'Tidligere indhold kræver manuel gennemgang uden for appen.';
          else before = value.binary ? null : data.toString();
        }
      }
      files.push({ file: file.file, status: file.status, ...value, before: value.blocked ? null : before, text: value.blocked ? null : value.text });
    }
    const token = randomUUID();
    this.reviews.clear(); this.reviews.set(token, { repo, files });
    return { token, branch: repo.branch, files: files.map(({ hash, mode, ...file }) => file) };
  }
  async commit(root, input) {
    if (this.busy) throw new Error('En version er allerede ved at blive gemt.');
    this.busy = true;
    try {
      const review = this.reviews.get(input.token); this.reviews.delete(input.token);
      if (!review || review.repo.root !== await fs.realpath(root)) throw new Error('Gennemgå ændringerne igen før versionsgemning.');
      if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 300 || /[\r\n\0]/.test(input.message)) throw new Error('Skriv en versionsbeskrivelse på én linje og højst 300 tegn.');
      if (!Array.isArray(input.files) || !input.files.length || new Set(input.files).size !== input.files.length) throw new Error('Vælg mindst én fil.');
      const selected = input.files.map(name => review.files.find(f => f.file === name));
      if (selected.some(f => !f || f.blocked)) throw new Error('Filvalget indeholder ukendte eller blokerede filer.');
      const now = await this.repository(root);
      if (now.block || now.head !== review.repo.head || now.branch !== review.repo.branch || now.raw !== review.repo.raw) throw new Error('Git-status har ændret sig. Gennemgå filerne igen.');
      for (const file of review.files) {
        const value = await content(now.root, file.file);
        if (value.hash !== file.hash || value.mode !== file.mode) throw new Error('Filerne har ændret sig siden gennemgangen. Gennemgå dem igen.');
      }
      // Kun navngivne filer stages; allerede staged indhold er afvist ovenfor.
      await run(now.root, ['add', '--', ...input.files]);
      try {
        await run(now.root, ['commit', '--only', '-m', input.message.trim(), '--', ...input.files]);
      } catch {
        throw new Error('Versionen kunne ikke gemmes. De valgte filer kan være staged; ingen filer er slettet eller nulstillet. Kontrollér Git-hooks, signering og Git-status i dit Git-værktøj, før du prøver igen.');
      }
      const head = await optional(now.root, ['rev-parse', '--verify', 'HEAD']);
      if (!head || head === now.head) throw new Error('Git bekræftede ikke en ny version. Kontrollér historikken.');
      return { head, message: input.message.trim() };
    } finally { this.busy = false; }
  }
}
module.exports = { GitVersions, run, secretContent, protectedPath, content, ANONYMOUS };
