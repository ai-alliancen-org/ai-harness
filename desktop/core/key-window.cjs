// Nøglevinduet. AI-nøgler og GitHub-nøgler indtastes kun her: i et eget vindue med egen session og egen proces, så
// hovedvinduets indhold, fx AI-svar og forhåndsvisningen, aldrig ser nøglen. Hovedvinduet siger, hvad nøglen skal bruges
// til, og får en kvittering tilbage. Nøglen renses og kontrolleres, før den gemmes. Efter forslag i #32 og #33.
const fs = require('node:fs/promises');
const path = require('node:path');
const connections = require('./connections.cjs');

const SCHEME = 'aura-noegle';
const ORIGIN = `${SCHEME}://vindue`;
const PAGE = `${ORIGIN}/index.html`;
// Uden persist: sessionen lever kun i hukommelsen og deles ikke med hovedvinduet.
const PARTITION = 'aura-noegle';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FILES = new Map([['index.html', ['key-window.html', 'text/html; charset=utf-8']], ['key-window.js', ['key-window.js', 'text/javascript']], ['styles.css', ['styles.css', 'text/css']]]);
const LOGO = /^provider-[a-z-]+\.svg$/;
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
// Kun en server, der ikke kan nås, må gemmes uden kontrol (brugerens beslutning 26. oktober 2026).
const UNREACHABLE = ['unreachable', 'timeout'];

class KeyWindow {
  /**
   * electron: { BrowserWindow, session, ipcMain }. parent() giver hovedvinduet, background() vinduets farve før
   * tegning, openAccount(kind) åbner udbyderens side til nøgler.
   */
  constructor({ electron, uiDir, preload, parent, background, title, openAccount }) {
    Object.assign(this, { electron, uiDir, preload, parent, background, title, openAccount });
    this.win = null; this.current = null; this.ready = false;
  }
  // Skemaet skal registreres, før appen er klar.
  static scheme() { return { scheme: SCHEME, privileges: { standard: true, secure: true } }; }

  setup() {
    if (this.ready) return; this.ready = true;
    const session = this.session = this.electron.session.fromPartition(PARTITION, { cache: false });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', event => event.preventDefault());
    session.setSpellCheckerEnabled?.(false);
    // Vinduet må kun hente sine egne filer. Alt andet, også internettet, afvises.
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${ORIGIN}/`) }));
    session.protocol.handle(SCHEME, request => this.serve(request));
    const ipc = this.electron.ipcMain;
    const on = (channel, action) => ipc.handle(channel, async (event, value) => {
      if (!this.fromWindow(event)) throw new Error('Adgang afvist.');
      return action(value);
    });
    on('key-window:context', () => this.current.context);
    on('key-window:submit', value => this.submit(value));
    on('key-window:save-anyway', () => this.saveAnyway());
    on('key-window:cancel', () => { this.cancel(); return true; });
    on('key-window:help', () => { if (this.current?.context.help) this.openAccount(this.current.kind); return true; });
    on('key-window:resize', height => {
      const value = Math.round(Number(height));
      if (Number.isFinite(value)) this.win.setContentSize(520, Math.min(720, Math.max(180, value)));
      // Vinduet vises først, når siden har sagt, hvor højt det skal være, så det ikke skifter størrelse for øjnene af en.
      this.current?.reveal?.();
      return true;
    });
  }
  // Kun nøglevinduets egen side må kalde kanalerne, ikke hovedvinduet, forhåndsvisningen eller en indlejret ramme.
  fromWindow(event) {
    const win = this.win;
    return Boolean(win && !win.isDestroyed() && this.current && event.sender === win.webContents && event.senderFrame && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === PAGE);
  }
  async serve(request) {
    const url = new URL(request.url), name = url.pathname.slice(1);
    // Node kender ikke appens eget skema, så url.origin er "null". Skema og vært sammenlignes derfor selv.
    const file = `${url.protocol}//${url.host}` === ORIGIN ? FILES.get(name) || (LOGO.test(name) ? [name, 'image/svg+xml'] : null) : null;
    if (!file) return new Response('Ikke fundet', { status: 404 });
    try {
      return new Response(await fs.readFile(path.join(this.uiDir, file[0])), { headers: { 'content-type': file[1], 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
    } catch { return new Response('Ikke fundet', { status: 404 }); }
  }

  /** Åbner vinduet til ét formål og giver kvitteringen, eller null, hvis brugeren annullerer. */
  open(purpose) {
    if (this.current) return Promise.reject(new Error('Nøglevinduet er allerede åbent. Indtast nøglen der, eller luk det.'));
    const parent = this.parent();
    if (!parent || parent.isDestroyed()) return Promise.reject(new Error('Aura er ved at lukke.'));
    this.setup();
    return new Promise((resolve, reject) => {
      this.current = { ...purpose, resolve, reject, busy: false, offered: false, reveal: null };
      const win = this.win = new this.electron.BrowserWindow({
        parent, modal: true, show: false, width: 520, height: 240, useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        title: this.title, backgroundColor: this.background(), autoHideMenuBar: true,
        webPreferences: { session: this.session, preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, devTools: false, spellcheck: false, navigateOnDragDrop: false }
      });
      win.removeMenu?.();
      win.setContentProtection?.(true);
      const contents = win.webContents;
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const blocked of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) contents.on(blocked, event => event.preventDefault());
      contents.on('render-process-gone', () => this.finish(null));
      const reveal = () => { if (!win.isDestroyed()) win.show(); };
      if (this.current) this.current.reveal = reveal;
      // Svarer siden ikke med en højde, vises vinduet alligevel.
      win.once('ready-to-show', () => setTimeout(reveal, 150));
      // Mens en nøgle gemmes, må vinduet ikke lukkes: så ville hovedvinduet tro, at brugeren annullerede.
      win.on('close', event => { if (this.win === win && this.current?.busy) event?.preventDefault?.(); });
      win.on('closed', () => { if (this.win === win) this.win = null; this.finish(null); });
      win.loadURL(PAGE).catch(() => this.finish(null));
    });
  }
  async submit(raw) {
    const current = this.current;
    if (!current || current.busy) return { error: 'Vent, nøglen bliver kontrolleret.' };
    current.busy = true; current.offered = false;
    try {
      const result = await current.submit(String(raw ?? ''));
      if (result.receipt) { this.settle(current, result.receipt); return { done: true }; }
      current.offered = result.offerSave === true;
      return { error: result.error, details: result.details || '', offerSave: current.offered };
    } catch (error) {
      // Kendte fejl har en tekst uden nøglen. En ukendt fejl kan i princippet nævne den og vises derfor ikke.
      return { error: error?.reason ? error.message : 'Nøglen kunne ikke kontrolleres. Prøv igen.', details: error?.reason ? error.details || '' : '' };
    } finally { current.busy = false; this.settle(current, null); }
  }
  async saveAnyway() {
    const current = this.current;
    if (!current?.offered || current.busy || !current.saveAnyway) return { error: 'Kontrollér nøglen først.' };
    current.busy = true;
    try { const receipt = await current.saveAnyway(); this.settle(current, receipt); return { done: true }; }
    catch (error) { return { error: error?.reason ? error.message : 'Forbindelsen kunne ikke gemmes. Prøv igen.' }; }
    finally { current.busy = false; this.settle(current, null); }
  }
  // Brugerens Annullér virker ikke, mens en gemning er i gang. Gemningen afgør, hvad hovedvinduet får at vide.
  cancel() { if (this.current?.busy) return; this.finish(null); }
  // Afslutter vinduet. Er en gemning i gang (nedlukning eller en lukket side), venter svaret på gemningen,
  // så hovedvinduet får kvitteringen og opdaterer sin tilstand i stedet for at tro, at brugeren annullerede.
  finish(receipt) {
    const current = this.current; if (!current) return;
    this.current = null;
    current.forget?.();
    const win = this.win; this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
    if (current.busy && receipt === null) { current.closing = true; return; }
    current.resolve(receipt);
  }
  // Svarer for en gemning, der blev afsluttet, mens vinduet allerede var lukket.
  settle(current, receipt) {
    if (receipt) current.result = receipt;
    if (this.current === current) { if (receipt) this.finish(receipt); return; }
    if (current.closing && !current.busy) { current.closing = false; current.resolve(current.result ?? null); }
  }
  // Ved nedlukning: luk vinduet og glem en nøgle, der venter på Gem alligevel.
  close() { const current = this.current; if (current) current.busy = false; this.finish(null); }
}

const recipient = connection => {
  const url = new URL(connection.baseURL);
  return { host: url.host, loopback: LOOPBACK.includes(url.hostname), insecure: url.protocol === 'http:' && !LOOPBACK.includes(url.hostname) };
};

/**
 * En AI-forbindelse. input er forbindelsens oplysninger uden nøgle. store(input, { catalog }) gemmer og giver id'et,
 * state() giver hovedvinduets nye tilstand, og lock(fn) kører en gemning ad gangen.
 */
function connectionPurpose({ input, store, state, lock = fn => fn(), accountKinds = [] }) {
  if (!input || typeof input !== 'object' || 'apiKey' in input || 'secret' in input) throw new Error('Nøglen indtastes i nøglevinduet.');
  const metadata = { id: input.id, kind: input.kind, name: input.name, baseURL: input.baseURL, deployment: input.deployment, protocol: input.protocol };
  const base = connections.normalize(metadata);
  const def = connections.definitions[base.kind], provider = def.provider || def.name, where = recipient(base);
  const own = ['compatible', 'ollama', 'azure'].includes(base.kind);
  const context = {
    heading: `Indtast din nøgle til ${provider}`, label: base.kind === 'zen' ? 'Nøgle fra OpenCode Zen' : 'API-nøgle', logo: `provider-${base.kind}.svg`, provider,
    // Modtageren kommer fra hovedprocessen. Ved Corti afgør nøglen adressen.
    recipient: base.kind === 'corti' ? 'Nøglen sendes til Corti i EU, EU-S eller Frankrig, alt efter hvor nøglen hører til.' : `Nøglen sendes til ${where.host}.`,
    warning: where.insecure ? `Forbindelsen til ${where.host} er ikke krypteret. Nøglen kan ses af andre på netværket.` : own ? `Det er en adresse, du selv har angivet. Kontrollér, at ${where.host} er rigtig.` : '',
    help: accountKinds.includes(base.kind), action: 'Kontrollér og gem', checking: `Kontrollerer nøglen hos ${provider} …`
  };
  let waiting = null;
  const save = async (key, name, catalog) => lock(async () => {
    const id = await store({ ...metadata, name, apiKey: key }, { catalog });
    return { id, state: await state(), models: catalog || null, checked: Boolean(catalog) };
  });
  return {
    kind: base.kind, context,
    async submit(raw) {
      waiting = null;
      const { key, changes } = connections.cleanKey(raw, base.kind, { strict: true });
      // Fejl fra adressen eller nøglens miljø har en fast tekst uden nøglen og vises derfor, i stedet for en generel fejl.
      let checked;
      try { checked = connections.normalize({ ...metadata, apiKey: key }); }
      catch (error) { throw Object.assign(error, { reason: error.reason || 'invalid' }); }
      // Står standardnavnet uændret, følger det regionen, fx Corti S1 · EU-S.
      const name = base.kind === 'corti' && (!input.name || input.name === def.name) ? connections.cortiName(checked.baseURL) : metadata.name;
      let models;
      try { models = await connections.listModels(checked, key); }
      catch (error) {
        if (UNREACHABLE.includes(error.reason)) waiting = { key, name };
        return { error: error.reason ? error.message : 'Nøglen kunne ikke kontrolleres. Prøv igen.', details: error.details || '', offerSave: Boolean(waiting) };
      }
      return { receipt: { ...(await save(key, name, models)), changes, name } };
    },
    async saveAnyway() {
      if (!waiting) throw Object.assign(new Error('Kontrollér nøglen først.'), { reason: 'invalid' });
      const { key, name } = waiting; waiting = null;
      return { ...(await save(key, name, null)), changes: [], name };
    },
    forget() { waiting = null; }
  };
}

/** En GitHub-nøgle til Sikkerhedskopi eller Udgiv. GitHub kontrollerer nøglen, før den gemmes. */
function githubPurpose({ github, target }) {
  const backup = target === 'backup';
  return {
    kind: 'github',
    context: {
      heading: 'Indtast din GitHub-nøgle', label: 'GitHub-nøgle (personligt adgangstoken)', logo: 'provider-github-pages.svg', provider: 'GitHub',
      recipient: 'Nøglen sendes til api.github.com.',
      warning: backup ? 'Nøglen skal kunne læse og skrive i det repository, du vil gemme sikkerhedskopien i.' : 'Nøglen skal kunne læse og skrive i repositoryet og starte GitHub Actions, hvis du udgiver med dem.',
      help: false, action: 'Kontrollér og gem', checking: 'Kontrollerer nøglen hos GitHub …'
    },
    async submit(raw) {
      const { key, changes } = connections.cleanKey(raw, 'github', { strict: true });
      try { const state = await github.connectToken(key); return { receipt: { github: state, changes } }; }
      catch (error) { return { error: error.message, details: '' }; }
    }
  };
}

module.exports = { KeyWindow, connectionPurpose, githubPurpose, SCHEME, PAGE };
