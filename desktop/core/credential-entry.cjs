// SPDX-License-Identifier: EUPL-1.2
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
function binding(purpose, value = {}) {
  if (!['connection','github'].includes(purpose)) throw new Error('Ukendt nøglehandling.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ugyldige nøgleoplysninger.');
  if (value.apiKey || value.token || value.secret) throw new Error('Nøgler må kun indtastes i det sikre nøglevindue.');
  if (purpose === 'github') {
    if (Object.keys(value).some(key => key !== 'generation') || value.generation !== undefined && (!Number.isSafeInteger(value.generation) || value.generation < 0)) throw new Error('GitHub-adgang bruger kun den faste GitHub-modtager.');
    return crypto.createHash('sha256').update(JSON.stringify(['github','https://api.github.com',value.generation ?? 0])).digest('hex');
  }
  const fields = ['id', 'kind', 'name', 'baseURL', 'deployment', 'protocol', 'clearKey'];
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error('Ugyldige nøgleoplysninger.');
  return crypto.createHash('sha256').update(JSON.stringify([purpose, fields.map(key => [key, value[key] ?? null])])).digest('hex');
}
class CredentialReceipts {
  constructor({ now = Date.now, lifetime = 120000 } = {}) { this.now = now; this.lifetime = lifetime; this.entries = new Map(); }
  put(purpose, configuration, key) {
    const bound = binding(purpose, configuration);
    if (typeof key !== 'string' || !key.length || key.length > 4096 || /[\r\n\0]/.test(key)) throw new Error('API-nøglen er ugyldig.');
    this.prune();
    if (this.entries.size >= 4) this.entries.delete(this.entries.keys().next().value);
    const receipt = crypto.randomBytes(32).toString('hex');
    this.entries.set(receipt, { purpose, bound, key, expires:this.now() + this.lifetime });
    return receipt;
  }
  consume(purpose, configuration, receipt) {
    const entry = this.entries.get(receipt); this.entries.delete(receipt); this.prune();
    if (!entry || entry.expires <= this.now() || entry.bound !== binding(purpose, configuration)) throw new Error('Nøglekvitteringen er udløbet eller oplysningerne er ændret. Indtast nøglen igen.');
    return entry.key;
  }
  prune() { for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(id); }
  clear() { this.entries.clear(); }
  clearPurpose(purpose) { for (const [id, entry] of this.entries) if (entry.purpose === purpose) this.entries.delete(id); }
}
function credentialResourceURL(file) { if (!path.isAbsolute(file)) throw new Error('Det sikre nøglevindue kræver en lokal appressource.'); return pathToFileURL(file).href; }
function createCredentialEntry({ BrowserWindow, ipcMain, safeStorage, parent, createSession }) {
  const receipts = new CredentialReceipts();
  const file = path.join(__dirname, '../ui/credential-entry.html'), url = credentialResourceURL(file);
  let active, closed = false;
  async function request({ purpose = 'connection', configuration = {} } = {}) {
    binding(purpose, configuration);
    const connection = purpose === 'connection' ? require('./connections.cjs').normalize(configuration) : null;
    if (closed || active) throw new Error('Afslut det åbne nøglevindue først.');
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Sikker nøglebeskyttelse er ikke tilgængelig. Ingen nøgle blev gemt.');
    const channel = `aura-secret-${crypto.randomBytes(16).toString('hex')}`, owner = parent();
    const secureSession = createSession?.();
    const win = new BrowserWindow({ width:560, height:450, resizable:false, minimizable:false, maximizable:false, show:false, title:'Aura · sikker nøgle', backgroundColor:'#ffffff', ...(owner ? { parent:owner, modal:true } : {}), webPreferences:{ preload:path.join(__dirname,'credential-entry-preload.cjs'), additionalArguments:[`--aura-secret-channel=${channel}`], ...(secureSession ? { session:secureSession } : {}), sandbox:true, contextIsolation:true, nodeIntegration:false, devTools:false } });
    return new Promise((resolve, reject) => {
      let settled = false;
      function finish(value) { if (settled) return; settled = true; ipcMain.removeHandler(channel); active = undefined; resolve(value); if (!win.isDestroyed()) win.destroy(); }
      active = { purpose, close:() => finish({ canceled:true }) };
      ipcMain.handle(channel, (event, message) => {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== url) throw new Error('Nøglehandlingen kommer fra et forkert vindue.');
        if (message?.action === 'context') return purpose === 'github' ? { name:'GitHub', endpoint:'https://api.github.com', kind:'github', label:'GitHub-token' } : { name:connection.name, endpoint:connection.baseURL, kind:connection.kind };
        if (message?.action === 'cancel') { finish({ canceled:true }); return; }
        if (message?.action !== 'submit') throw new Error('Ukendt nøglehandling.');
        const receipt = receipts.put(purpose, configuration, message.value);
        finish({ canceled:false, keyReceipt:receipt }); return { ok:true };
      });
      win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
      win.webContents.once('render-process-gone', () => finish({ canceled:true }));
      win.webContents.on('will-navigate', (event, target) => { if (target !== url) event.preventDefault(); });
      win.on('closed', () => finish({ canceled:true }));
      win.once('ready-to-show', () => win.show());
      void win.loadFile(file).catch(() => { if (settled) return; settled = true; ipcMain.removeHandler(channel); active = undefined; if (!win.isDestroyed()) win.destroy(); reject(new Error('Det sikre nøglevindue kunne ikke åbnes.')); });
    });
  }
  return {
    request,
    connection(input = {}) {
      if (input.apiKey || input.secret || input.token) throw new Error('Indtast nøglen i det sikre nøglevindue.');
      const { apiKey:ignored, keyReceipt, ...configuration } = input;
      return keyReceipt ? { ...configuration, apiKey:receipts.consume('connection', configuration, keyReceipt) } : configuration;
    },
    github(input, generation = 0) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'keyReceipt') || typeof input.keyReceipt !== 'string') throw new Error('Indtast GitHub-token i det sikre nøglevindue.');
      return receipts.consume('github', { generation }, input.keyReceipt);
    },
    cancelGithub() { if (active?.purpose === 'github') active.close(); receipts.clearPurpose('github'); },
    revoke() { active?.close(); receipts.clear(); },
    close() { closed = true; active?.close(); receipts.clear(); }
  };
}
module.exports = { createCredentialEntry, credentialResourceURL, CredentialReceipts, binding };
