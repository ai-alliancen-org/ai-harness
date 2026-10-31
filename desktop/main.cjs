const { app, BrowserWindow, ipcMain, dialog, protocol, session, safeStorage, Menu, shell, webFrameMain, clipboard, nativeTheme, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createProject, openProject } = require('./core/projects.cjs');
const previewSession = require('./core/preview-session.cjs');
const { DevServer, inspect: inspectRuntime } = require('./core/dev-server.cjs');
const { WorkspaceRegistry } = require('./core/workspaces.cjs');
const { AsyncLocalStorage } = require('node:async_hooks');
const { normalizeRuntimeConfig } = require('./core/project-runtime.cjs');
const { GitHub } = require('./core/github.cjs');
const { Deployments } = require('./core/deployments.cjs');
const { Publishing } = require('./core/publishing.cjs');
const { Preferences } = require('./core/preferences.cjs');
const { Appearance, windowBackground } = require('./core/appearance.cjs');
const { Designs } = require('./core/designs.cjs');
const projectFiles = require('./core/project-files.cjs');
const previewEdit = require('./core/preview-edit.cjs');
const { History, PreviewImages, kindOf } = require('./core/history.cjs');
const { fileDetail } = require('./core/change-review.cjs');
const { OwnTools } = require('./core/own-tools.cjs');
const uiFiles = require('./core/ui-files.cjs');
const connections = require('./core/connections.cjs');
const networkJournal = require('./core/network-journal.cjs');
const networkReport = require('./core/network-report.cjs');
// Nøgler og GitHub-token indtastes kun i nøglevinduet. Hovedvinduet får en engangskvittering.
const { KeyWindow, connectionPurpose, githubPurpose } = require('./core/key-window.cjs');

// Appen hedder Aura. Datamappen og navnet i nøgleringen bevares fra før navneskiftet; se core/app-identity.cjs.
const { appIdentity, rememberKeychain, projectParent, DISPLAY_NAME } = require('./core/app-identity.cjs');
const identity = appIdentity({ appData: app.getPath('appData'), packaged: app.isPackaged, customUserData: app.commandLine.hasSwitch('user-data-dir'), userData: app.getPath('userData'), sessionData: app.getPath('sessionData') });
const appIcon = path.join(__dirname, 'ui/aura-icon.png');
rememberKeychain(identity);
app.setName(identity.keychainName);
app.setPath('userData', identity.userData);
app.setPath('sessionData', identity.sessionData);

protocol.registerSchemesAsPrivileged([...['harness', 'aura-preview'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })), KeyWindow.scheme()]);
let window, chosenParent = null;
let assets = [];
let github, publishing, deployments, deploymentSetup, restoration, promtePreview, komplaiPreview;
let registry, history, images;
let ownTools, updates, updating = false;
let appearance;
const requests = new AsyncLocalStorage(), operations = new Set(), spaces = new Map();
let selectedRoot = null;
function currentWorkbench() { return requests.getStore()?.bench || registry?.selected; }
// En IPC-handling beholder projektets ejer, også hvis brugeren skifter fane under et await.
const workbench = new Proxy({}, { get(_target, key) { const owner = currentWorkbench(), value = owner?.[key]; return typeof value === 'function' ? value.bind(owner) : value; } });
function currentProject() { return currentWorkbench()?.project || null; }
function requestChatID() { return requests.getStore()?.chat || currentWorkbench()?.chatID; }
function currentChat() { const id = requestChatID(); return id ? currentWorkbench()?.chats.get(id) : currentWorkbench()?.chat; }
function chatInput(value) { return { ...value, chat: value?.chat || requestChatID() }; }
function workspaceRoot() { const request = requests.getStore(); return request?.workspaceRoot || currentWorkbench()?.chat?.root || currentProject()?.root; }
function currentSpace() { return spaces.get(workspaceRoot()) || {}; }
function saveSpace() { /* Hver arbejdsmappe ejer nu sin tilstand direkte. */ }
function spaceFor(root = workspaceRoot()) { return spaces.get(root); }
function ownerFor(root) { return spaces.get(root)?.owner || [...registry.values()].find(bench => bench.project?.root === root || [...bench.chats.values()].some(chat => chat.root === root)); }
function makeServer(ctx) {
  return new DevServer({ runner: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked/core/dev-server-runner.cjs') : undefined, komplaiScript: komplaiScript(ctx.root),
    getRuntimeConfig: async () => { return normalizeRuntimeConfig((await ctx.owner.store.project(ctx.owner.project.root)).runtime || {}); },
    // Den sidste port huskes pr. arbejdsmappe, så en kopi og projektet ikke deler forhåndsvisningens lokale data.
    previewPort: {
      get: async () => { const port = (await ctx.owner.store.read()).previewPorts?.[ctx.owner.store.projectKey(ctx.root)]; return Number.isInteger(port) ? port : null; },
      set: port => ctx.owner.store.update(state => { state.previewPorts = { ...state.previewPorts, [ctx.owner.store.projectKey(ctx.root)]: port }; })
    },
    emit: state => {
      if (state.state === 'error') recordFailure('forhaandsvisning', 'server');
      if (state.state === 'running') { const old = ctx.preview; ctx.preview = null; void old?.close(); ctx.externalPreview = state.url; }
      else if (['starting', 'stopping', 'stopped', 'error'].includes(state.state)) ctx.externalPreview = null;
      const bench = ctx.owner, chat = bench.claims.get(ctx.root) || [...bench.chats.values()].find(c => c.root === ctx.root);
      const titles = { installing: 'Forhåndsvisning: installerer pakker', installed: 'Forhåndsvisning: pakkerne er installeret', starting: 'Forhåndsvisning: starter serveren', running: 'Forhåndsvisning: serveren kører', stopped: 'Forhåndsvisning: stoppet', error: 'Forhåndsvisning: fejl' };
      if (titles[state.state] && ctx.logged !== state.state && (state.state !== 'stopped' || ctx.logged)) { ctx.logged = state.state; chat?.log({ kind: 'preview', title: titles[state.state], detail: state.message || '', status: state.state === 'error' ? 'error' : ['installing','starting'].includes(state.state) ? 'running' : 'completed' }); }
      sendEvent({ type: 'preview.runtime', ...state, workspaceRoot: ctx.root, root: bench.project.root, project: ctx.detectedRuntime, chat: chat?.id });
    }
  });
}
async function selectSpace(root, owner = currentWorkbench()) {
  let ctx = spaces.get(root);
  if (!ctx) {
    ctx = { root, owner, key: owner.store.projectKey(root), preview: null, externalPreview: null, forceStatic: false };
    spaces.set(root, ctx);
    ctx.ready = (async () => {
      ctx.runtimeConfig = normalizeRuntimeConfig((await owner.store.project(owner.project.root)).runtime || {});
      ctx.detectedRuntime = await inspectRuntime(root, ctx.runtimeConfig).catch(error => ({ kind: 'unknown', supported: false, reason: error.message }));
      ctx.devServer = makeServer(ctx); await ctx.devServer.activate(root);
      if (!['vite','astro','services'].includes(ctx.detectedRuntime.kind) && (await openProject(root)).staticPreview) ctx.preview = previewSession.staticPreview(ctx);
    })();
    ctx.ready.catch(() => { if (spaces.get(root) === ctx) spaces.delete(root); });
  }
  await ctx.ready;
  if (registry.selected === owner && (owner.chat?.root || owner.project.root) === root) selectedRoot = root;
  const chat = [...owner.chats.values()].find(chat => chat.root === root && chat.id === owner.chatID);
  return { workspaceRoot: root, isolated: root !== owner.project.root, copy: chat?.copy ? { id: chat.copy.id, omissions: chat.copy.omissions } : null, previewURL: ctx.preview?.url || ctx.externalPreview || null, previewExternal: Boolean(ctx.externalPreview), runtime: { ...ctx.devServer.snapshot(), root: owner.project.root, workspaceRoot: root, project: ctx.detectedRuntime } };
}
async function chatState(state) { const request = requests.getStore(); if (request) { request.workspaceRoot = state.workspaceRoot; request.chat = state.chat; } return { ...state, preview: await selectSpace(state.workspaceRoot) }; }
async function closeSpaces() { await Promise.all([...spaces.values()].map(async ctx => { await ctx.ready.catch(() => {}); await ctx.devServer?.stop(); await ctx.preview?.close(); })); spaces.clear(); selectedRoot = null; }
let quitReady = false, shuttingDown = null;
const failures = [];
function recordFailure(area, type) { failures.push({ area, type, at: new Date().toISOString() }); if (failures.length > 10) failures.shift(); }
function supportReport() {
  // Hjælp må ikke kontakte nøgleringen. Kontrollen sker først ved brug af en nøgle.
  return require('./core/diagnostics.cjs').diagnostics({ version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, versions: require('./core/runtime.cjs').get()?.versions, project: Boolean(currentProject()), running: workbench?.running, preview: currentSpace().devServer?.state, failures });
}
function shutdown() {
  if (!shuttingDown) shuttingDown = (async () => { keyWindow.close(); github?.cancel(); deploymentSetup?.promte.cancelAll(); await registry?.close(); await closeSpaces(); await networkJournal.flush(); })().finally(() => { shuttingDown = null; });
  return shuttingDown;
}
const uiURL = 'harness://app/index.html';
const profileRoot = app.isPackaged ? path.join(process.resourcesPath, 'profiles') : path.join(__dirname, '..', 'profiles');
if (app.isPackaged) require('./core/runtime.cjs').configure(process.resourcesPath);

async function activate(next) {
  await stopPicking('project');
  const owner = await registry.select(next), request = requests.getStore();
  if (request) { request.bench = owner; request.workspaceRoot = owner.chat?.root || owner.project.root; request.chat = owner.chatID; }
  try { const restored = await owner.restoration.previous(owner.project.root); if (restored) await owner.invalidatePlan(restored.id); }
  catch { await owner.invalidatePlan(crypto.randomUUID()); owner.historyWarning = 'Gendannelseskopien kan ikke læses. Projektfilerne er åbne, men den gamle plan er nulstillet.'; }
  assets = [];
  const context = await selectSpace(owner.chat?.root || owner.project.root, owner);
  return { ...owner.project, ...context, workbench: { ...await owner.state(), preview: context } };
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, value, selection) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Adgang afvist.');
    try {
      if (updating && !channel.startsWith('updates:')) throw new Error('Aura gør klar til genstart.');
      const requestedRoot = channel === 'workspace:draft' ? value?.root : selection?.root;
      const owner = requestedRoot ? registry.get(requestedRoot) : registry.selected;
      if (!owner) throw new Error('Projektet er ikke åbent længere. Vælg det igen.');
      const chatID = value && typeof value === 'object' && value.chat || selection?.chat;
      const chat = chatID ? owner.chatFor(chatID) : owner.chat;
      const context = { bench: owner, chat: chat?.id, workspaceRoot: chat?.root || owner.project?.root, channel };
      return { ok: true, value: await requests.run(context, () => action(value)) };
    }
    catch (error) {
      recordFailure(channel.startsWith('git:') ? 'git' : channel.startsWith('connections:') ? 'forbindelse' : 'app', ['EACCES','EPERM'].includes(error.code) ? 'adgang' : error.code === 'ENOENT' ? 'mangler-fil' : 'handling');
      const messages = { EEXIST: 'Der findes allerede en mappe med det projektnavn. Vælg et andet navn eller en anden placering.', ENOENT: 'En nødvendig fil eller mappe findes ikke. Kontrollér projektmappen.', EACCES: 'Aura har ikke adgang til mappen. Tillad mappeadgang i computerens indstillinger, og prøv igen, eller vælg en anden mappe.', EPERM: 'Computeren blokerer adgang til mappen. Tillad mappeadgang i indstillingerne, og prøv igen, eller vælg en anden mappe.' };
      return { ok: false, error: messages[error.code] || error.message };
    }
  });
}
handle('updates:state', () => updates.snapshot());
handle('updates:check', () => updates.check());
handle('updates:download', () => updates.download());
handle('updates:automatic', value => updates.automatic(value));
handle('updates:restart', () => updates.restart());
handle('updates:website', () => shell.openExternal('https://ai-alliancen-org.github.io/ai-harness/desktop.html'));
handle('updates:notes', () => {
  const version = updates.snapshot().available?.version;
  if (!version || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) throw new Error('Vælg en tilgængelig udgivelse.');
  return shell.openExternal(`https://github.com/ai-alliancen-org/ai-harness/releases/tag/v${version}`);
});
// Vedhæftninger til én besked. Filstier kommer kun fra computerens egen filvælger; reglerne står i
// core/chat-materials.cjs, og brugerfladen sender kun id'er, den har fået herfra.
require('./core/chat-materials-ipc.cjs').installChatMaterials({
  getWorkbench: () => registry?.selected,
  isSelected: bench => registry?.selected === bench,
  register: handle,
  dialog: { showOpenDialog: options => dialog.showOpenDialog(window, options) },
  exclusive,
  normalizeImage: require('./core/image-normalizer.cjs').createImageNormalizer({ nativeImage }),
  emit: event => sendEvent(event)
});
async function exclusive(action, forced) {
  const request = requests.getStore();
  // Nøglevinduet gemmer uden for hovedvinduets kald og siger derfor selv, hvilken kategori der låses.
  const category = forced || request?.channel?.split(':')[0] || 'app';
  const key = ['project', 'assets', 'tools', 'connections', 'hosting', 'komplai'].includes(category) ? category : `${workspaceRoot() || 'app'}:${category}`;
  if (operations.has(key)) throw new Error('Denne handling er allerede i gang. Du kan fortsat bruge de andre projekter.');
  operations.add(key);
  try { return await action(); } finally { operations.delete(key); }
}
// Nye projekter lægges i Dokumenter/Aura, medmindre brugeren selv har valgt en anden placering.
const defaultProjectParent = () => projectParent(app.getPath('documents'));
function projectLocation() {
  const parent = chosenParent || defaultProjectParent();
  return { chosen: Boolean(chosenParent), label: chosenParent ? parent : `Dokumenter › ${path.basename(parent)}`, path: parent };
}
handle('project:location', () => projectLocation());
handle('project:choose-location', () => exclusive(async () => {
  const selection = await dialog.showOpenDialog(window, { title: 'Vælg, hvor dine projekter skal ligge', defaultPath: chosenParent || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  if (!selection.canceled) chosenParent = await require('./core/projects.cjs').checkProjectAccess(selection.filePaths[0]);
  return projectLocation();
}));
handle('project:create', input => exclusive(async () => {
  const startup = await new Preferences(workbench.store).available({ ...input.startup, tests: input.tests });
  const parent = chosenParent || defaultProjectParent();
  if (!chosenParent) await fs.mkdir(parent, { recursive: true });
  // Uden funktionen Design og tilgængelighed bruges hverken designpakke, logo eller inspiration fra startsiden.
  const features = (await workbench.features.get()).effective;
  const created = await createProject(parent, features.design ? input : { ...input, color: null, links: [] }, features.design ? assets : [], profileRoot);
  // Med Versioner og fortryd får nye projekter Git fra start og en version efter hver AI-opgave, så de altid kan fortrydes.
  // Et hostingønske eller en designpakke under en slået fra funktion følger ikke med projektet. Brugerens gemte standarder bevares.
  const projectStartup = { ...startup.values, ...(features.deling ? {} : { hosting: '' }), ...(features.design ? {} : { designID: '' }) };
  await workbench.store.saveProject(created.root, { startup: projectStartup, ...(features.versioner ? { autoCheckpoint: true } : {}) });
  let versionWarning = '';
  if (features.versioner) {
    try { await workbench.git.startProject(created.root); }
    catch (error) { versionWarning = `Versioner kunne ikke slås til: ${error.message} Projektet er oprettet, og du kan gemme versioner senere.`; }
  }
  // De seneste valg er udgangspunktet for næste projekt. Brugeren kan glemme dem under Flere valg.
  await new Preferences(workbench.store).save(startup.values);
  const opened = await openProject(created.root);
  if (versionWarning) opened.warnings.push(versionWarning);
  return activate(opened);
}));
handle('project:open', () => exclusive(async () => {
  const selection = await dialog.showOpenDialog(window, { title: 'Åbn en mappe som arbejdsområde', properties: ['openDirectory'] });
  if (selection.canceled) return null;
  return activate(await openProject(selection.filePaths[0]));
}));
// Alle åbnede projekter med deres samtaler til sidepanelet og paletten. Det åbne projekts samtaler har deres status lige nu.
handle('project:recent', async () => Promise.all((await workbench.history.recent()).map(async item => ({ ...item, chats: await (registry.get(item.root) || registry.empty).chatList(item.root).catch(() => []) }))));
handle('project:reopen', id => exclusive(async () => {
  const item = (await workbench.history.recent()).find(p => p.id === id);
  if (!item) throw new Error('Projektet findes ikke på listen. Brug Åbn projekt for at vælge mappen.');
  return activate(await openProject(item.root));
}));
// Samtaler i projektet. En ny samtale starter tom; de tidligere står i sidepanelet og kan åbnes igen.
handle('workspace:new-conversation', () => exclusive(async () => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return chatState(await workbench.newChat()); }));
handle('chat:open', id => exclusive(async () => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return chatState(await workbench.openChat(id)); }));
handle('chat:archive', value => exclusive(async () => chatState(await workbench.archiveChat(value))));
handle('chat:rename', value => exclusive(() => workbench.renameChat(value)));
// Sletning flytter samtalens fil til papirkurven, så den kan hentes igen uden for Aura.
handle('chat:delete', value => exclusive(async () => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  const title = (await workbench.chatList()).find(item => item.id === value?.id)?.title || 'Ny samtale';
  const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Slet samtale', message: `Slet samtalen »${title}«?`, detail: (await workbench.history.readChat(currentProject().root, value.id)).copy ? 'Samtalen flyttes til papirkurven. Dens kopi og uflettede ændringer slettes. Projektfilerne og versionerne bevares.' : 'Samtalen flyttes til papirkurven. Projektfilerne og versionerne bevares.', buttons: ['Annuller', 'Slet samtalen'], defaultId: 0, cancelId: 0 });
  if (choice.response !== 1) return null;
  return chatState(await workbench.deleteChat(value, file => shell.trashItem(file)));
}));
let pendingMergeView = null;
handle('chat:merge-review', value => exclusive(async () => {
  pendingMergeView = null;
  const review = await workbench.mergeReview(value), chat = workbench.chatFor(value?.chat);
  const view = { ...(value?.view || { width: 1280, height: 800 }), page: currentPage() };
  review.images = { now: imageURL(await captureView(view, currentProject().root)), target: imageURL(await captureView(view, chat.root)), targetLabel: 'Samtalens kopi' };
  pendingMergeView = { token: review.token, root: currentProject().root, view };
  return review;
}));
handle('chat:merge', value => exclusive(async () => {
  const pending = pendingMergeView?.token === value?.token && pendingMergeView.root === currentProject()?.root ? pendingMergeView : null;
  pendingMergeView = null;
  // Tag før-billedet igen umiddelbart før indfletningen. Efter-billedet skal vise det faktisk flettede projekt,
  // også når brugeren valgte projektets linjer ved konflikt, og bindes til en eventuel gemt version.
  const before = pending ? await captureView(pending.view, pending.root) : null;
  const result = await workbench.mergeApply(value);
  const task = workbench.findTask(result.task), chat = workbench.chatFor(value?.chat);
  if (task && pending) {
    task.images = { pair: crypto.randomUUID(), view: pending.view };
    if (result.saved?.head) task.checkpoint = { status: 'saved', head: result.saved.head };
    await images.add(pending.root, before, { role: 'before', pair: task.images.pair, view: pending.view, task: task.id }).catch(() => null);
    if (result.savedFirst?.head) await images.add(pending.root, before, { role: 'after', view: pending.view, commit: result.savedFirst.head }).catch(() => null);
    chat.afterImage(task);
  }
  return { ...result, state: await chatState(result.state) };
}));
handle('workspace:draft', input => {
  if (!currentProject() || input.root !== currentProject().root) throw new Error('Projektet er skiftet. Kladden blev ikke gemt i en anden mappe.');
  return workbench.saveDraft({ chat: input.chat, text: input.text, mode: input.mode, dismissPlanOffer: input.dismissPlanOffer === true });
});
handle('project:new', () => exclusive(async () => {
  await stopPicking('project');
  registry.deselect(); selectedRoot = null; assets = [];
  return true;
}));
handle('assets:choose', kind => exclusive(async () => {
  if (!['logo', 'reference'].includes(kind)) throw new Error('Ukendt materialetype.');
  const selection = await dialog.showOpenDialog(window, { title: kind === 'logo' ? 'Vælg et logo' : 'Vælg inspirationsmateriale', properties: ['openFile', ...(kind === 'reference' ? ['multiSelections'] : [])], ...(kind === 'logo' ? { filters: [{ name: 'Billeder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] } : {}) });
  if (!selection.canceled) {
    const next = kind === 'logo' ? assets.filter(item => item.kind !== 'logo') : [...assets];
    if (next.length + selection.filePaths.length > 20) throw new Error('Vælg højst 20 filer.');
    for (const file of selection.filePaths) {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('Vælg almindelige filer på højst 10 MB.');
      next.push({ id: crypto.randomUUID(), kind, path: file });
    }
    assets = next;
  }
  return assets.map(({ id, kind, path: file }) => ({ id, kind, name: assets.find(a => a.id === id)?.name || path.basename(file) }));
}));
handle('assets:remove', id => {
  if (operations.has('assets')) throw new Error('Vent på valg af materiale.');
  assets = assets.filter(item => item.id !== id);
  return assets.map(({ id, kind, path: file }) => ({ id, kind, name: assets.find(a => a.id === id)?.name || path.basename(file) }));
});
// Den statiske forhåndsvisning starter, når projektet har sin første version. Kun én start ad gangen.
async function startStatic(root) {
  const ctx = spaceFor(root); if (!ctx) return false;
  if (ctx.preview) return true;
  if (!ctx.staticStart) ctx.staticStart = (async () => {
    const updated = await openProject(root);
    if (!spaces.has(root) || !updated.staticPreview || ctx.externalPreview) return false;
    ctx.preview = previewSession.staticPreview(ctx);
    sendEvent({ type: 'preview.ready', root: ctx.owner.project.root, workspaceRoot: root, url: ctx.preview.url });
    return true;
  })().finally(() => { ctx.staticStart = null; });
  return ctx.staticStart;
}
handle('preview:revision', async () => {
  const rootNow = workspaceRoot(), ctx = spaceFor(rootNow);
  if (!currentProject() || !ctx || ctx.externalPreview) return null;
  const nextRuntime = await inspectRuntime(rootNow, ctx.runtimeConfig).catch(error => ({ kind: 'unknown', supported: false, reason: error.message }));
  if (workspaceRoot() !== rootNow) return null;
  if (JSON.stringify(nextRuntime) !== JSON.stringify(ctx.detectedRuntime)) {
    ctx.detectedRuntime = nextRuntime; if (selectedRoot === rootNow) currentSpace().detectedRuntime = nextRuntime;
    sendEvent({ type: 'preview.runtime', ...ctx.devServer.snapshot(), root: currentProject()?.root, workspaceRoot: rootNow, project: nextRuntime });
  }
  if (!ctx.forceStatic && ['vite', 'astro', 'services'].includes(nextRuntime.kind)) {
    if (ctx.preview) { const old = ctx.preview; ctx.preview = null; if (selectedRoot === rootNow) currentSpace().preview = null; await old.close(); sendEvent({ type: 'preview.ready', workspaceRoot: rootNow, url: null }); }
    return null;
  }
  if (!ctx.preview && !await startStatic(rootNow)) return null;
  if (workspaceRoot() !== rootNow) return null;
  const root = path.join(rootNow, 'public');
  if (!(await fs.lstat(root)).isDirectory()) throw new Error('Den offentlige mappe mangler.');
  const entries = [];
  async function scan(dir, depth = 0) {
    if (depth > 12 || entries.length > 2000) throw new Error('Projektet overstiger forhåndsvisningens grænse.');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file, depth + 1);
      else if (entry.isFile()) { const stat = await fs.stat(file); entries.push(`${file}:${stat.mtimeMs}:${stat.size}`); }
    }
  }
  await scan(root);
  await fs.access(path.join(root, 'index.html'));
  return crypto.createHash('sha256').update(entries.sort().join('\n')).digest('hex');
});

handle('appearance:get', () => appearance.get());
handle('appearance:save', input => appearance.save(input));
handle('preferences:get', () => new Preferences(workbench.store).get());
handle('preferences:save', input => exclusive(() => new Preferences(workbench.store).save(input)));
handle('designs:clear', () => exclusive(() => { assets = []; return []; }));
handle('designs:list', () => new Designs(workbench.store).list());
handle('designs:save', input => exclusive(() => new Designs(workbench.store).save(input, assets)));
handle('designs:apply', id => exclusive(async () => { const design = await new Designs(workbench.store).get(id); assets = design.assets; return { color: design.color, links: design.links, assets: assets.map(({ id, kind, name }) => ({ id, kind, name })) }; }));
// Aura Harness i brugerens eget kodeværktøj. Mappen vælges her i hovedprocessen; brugerfladen sender ingen stier.
const tools = () => ownTools ??= new OwnTools({ profiles: profileRoot, git: workbench.git });
handle('tools:catalog', () => tools().catalog());
handle('tools:folder', () => exclusive(async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Vælg projektmappen', buttonLabel: 'Vælg mappe', properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : tools().choose(result.filePaths[0]);
}));
handle('tools:review', input => exclusive(() => {
  if (!Array.isArray(input?.tools) || input.tools.length > 40 || input.tools.some(id => typeof id !== 'string')) throw new Error('Vælg gyldige værktøjer.');
  if (input.skills !== undefined && (!Array.isArray(input.skills) || input.skills.length > 60 || input.skills.some(name => typeof name !== 'string'))) throw new Error('Vælg gyldige skills.');
  return tools().plan(input.tools, input.skills);
}));
handle('tools:install', input => exclusive(() => tools().install({ skipConflicts: input?.skipConflicts === true })));
handle('tools:removal', () => exclusive(() => tools().planRemoval()));
handle('tools:remove', () => exclusive(() => tools().remove()));
handle('tools:reveal', async () => { const error = await shell.openPath(tools().requireTarget()); if (error) throw new Error('Mappen kunne ikke åbnes.'); });

function requireProject() { if (!currentProject()) throw new Error('Åbn et projekt først.'); return currentProject().root; }
function requireIdleProject() {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  if (workbench.busyRoot(currentProject().root)) throw new Error('AI’en arbejder i projektets filer. Login og valg er klar; vent med at ændre eller sende denne version, til opgaven er færdig.');
  if (['installing', 'starting', 'stopping'].includes(currentSpace().devServer?.state)) throw new Error('Vent på opstarten af forhåndsvisningen, eller stop den først.');
  return currentProject().root;
}
handle('network:report', () => networkJournal.snapshot());
handle('network:save', async input => {
  if (!['json', 'csv'].includes(input?.format)) throw new Error('Vælg CSV eller JSON.');
  // Only main owns records. The renderer can choose filters, never export content.
  const report = networkReport.select(networkJournal.snapshot(), input?.filters);
  const chosen = await dialog.showSaveDialog(window, { title: 'Gem netværksrapport', defaultPath: `Aura-netvaerk.${input.format}`, filters: [{ name: 'Netværksrapport', extensions: [input.format] }] });
  if (chosen.canceled || !chosen.filePath) return false;
  await fs.writeFile(chosen.filePath, networkReport.serialize(report, input.format), { mode: 0o600 });
  return true;
});
handle('support:report', () => supportReport());
handle('support:save', async () => {
  const report = supportReport();
  const chosen = await dialog.showSaveDialog(window, { title: 'Gem fejlrapport', defaultPath: 'Aura-fejlrapport.json', filters: [{ name: 'Fejlrapport', extensions: ['json'] }] });
  if (chosen.canceled || !chosen.filePath) return false;
  await fs.writeFile(chosen.filePath, JSON.stringify(report, null, 2), { mode: 0o600 }); return true;
});
// Feedback går på e-mail til kontakten i package.json. Uden kontakt viser appen kun teksten om at skrive til den, der inviterede.
handle('support:contact', () => require('./core/feedback.cjs').contact());
// Appen giver ikke siden adgang til udklipsholderen. Kopiering går gennem hovedprocessen og kun som tekst.
handle('clipboard:write', text => { if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('Teksten kan ikke kopieres.'); clipboard.writeText(text); return true; });
handle('links:open', value => shell.openExternal(require('./core/external-links.cjs').externalURL(value)));
handle('support:feedback', async () => {
  const feedback = require('./core/feedback.cjs'), person = feedback.contact();
  if (!person) return false;
  await shell.openExternal(feedback.mail(person, { version: app.getVersion(), system: `${{ darwin: 'macOS', win32: 'Windows' }[process.platform] || process.platform} ${process.arch}` }));
  return true;
});
handle('git:status', async () => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  const root = currentProject().root, status = await workbench.git.status(root);
  status.busy = workbench.busyRoot(root);
  status.history = await history.describe(root, status.history);
  const { images: all } = await images.index(root);
  for (const item of status.history) item.image = [...all].reverse().find(entry => entry.commit === item.commit && entry.role === 'after')?.id || null;
  return { ...status, restoration: await restoration.status(root), autoCheckpoint: (await workbench.store.project(root)).autoCheckpoint === true };
});
// Visuel historik: én version med filer og billeder, navne og billederne selv.
handle('history:version', async commit => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  const root = currentProject().root, version = await history.version(root, commit);
  return { ...version, images: await images.pairFor(root, { commit }) };
});
handle('history:search', value => require('./core/history-search.cjs').searchHistory(workbench.history, value));
handle('history:rename', value => exclusive(async () => ({ name: await history.rename(requireIdleProject(), value?.commit, value?.name) })));
handle('history:image', async id => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  for (const root of new Set([workspaceRoot(), currentProject().root, ...(currentChat()?.changes.tasks.map(task => task.root) || [])])) {
    try { return await images.read(root, id); } catch { /* Billedet kan høre til en tidligere kopi i samtalen. */ }
  }
  throw new Error('Billedet findes ikke længere.');
});
// Gennemgang før en gendannelse eller fortrydelse: filerne, hvad der sker med dem, dine ugemte ændringer og et billede
// af forhåndsvisningen nu og af det, den går tilbage til. Billedet "nu" gemmes som før-billede, når handlingen udføres.
let pendingRestore = null;
const imageURL = data => data ? `data:image/jpeg;base64,${data.toString('base64')}` : null;
handle('git:restore-review', input => exclusive(async () => {
  const taskRoot = input?.task ? workbench.findTask(input.task)?.root : null;
  const root = taskRoot && taskRoot !== currentProject()?.root ? taskRoot : requireIdleProject();
  if (root !== workspaceRoot() || workbench.busyRoot(root)) throw new Error('Åbn den ledige samtale, hvis filer skal fortrydes.');
  if (input?.undo && input.expected && (await restoration.previous(root))?.id !== input.expected) throw new Error('En senere gendannelse har afløst indfletningen. Brug Versioner til at gennemgå den seneste handling.');
  let request = { ...(input?.commit ? { commit: input.commit } : {}), ...(input?.undo ? { undo: true } : {}), ...(input?.revert ? { revert: input.revert } : {}) };
  if (input?.task) {
    const task = workbench.findTask(input.task);
    if (!task || !task.files.length) throw new Error('Opgaven findes ikke længere i denne samtale. Brug Versioner for at gå længere tilbage.');
    request = { task: { files: task.files } };
  }
  const review = await restoration.review(root, request);
  const auto = (await workbench.store.project(root)).autoCheckpoint === true;
  let unsaved = [];
  if (review.git) { const repo = await workbench.git.repository(root); const changed = new Set(repo.files.map(file => file.file)); unsaved = review.files.map(file => file.file).filter(file => changed.has(file)); }
  Object.assign(review, { unsaved, saveFirst: auto && review.git && unsaved.length > 0, saveAfter: auto && review.git, framework: Boolean(currentSpace().externalPreview) });
  const view = input?.view && Number.isFinite(input.view.width) ? { page: currentPage(), width: input.view.width, height: input.view.height } : null;
  const now = view ? await captureView(view) : null;
  let target = null;
  if (request.commit) target = (await images.pairFor(root, { commit: request.commit }))?.after;
  else if (request.revert) target = (await images.pairFor(root, { commit: request.revert }))?.before;
  else if (input?.task) target = (await images.pairFor(root, { task: input.task }))?.before;
  review.images = { now: imageURL(now), target: target ? await images.read(root, target.id).catch(() => null) : null, targetLabel: request.commit ? 'Versionen' : 'Før opgaven' };
  pendingRestore = { token: review.token, root, view, now, request, kind: review.kind, task: input?.task || null, files: review.files.map(file => file.file), unsaved, signature: JSON.stringify(review.files) };
  return review;
}));
handle('git:restore', input => exclusive(async () => {
  const root = pendingRestore?.root || requireIdleProject();
  if (root !== workspaceRoot() || workbench.busyRoot(root)) throw new Error('Åbn den ledige samtale, hvis filer skal fortrydes.');
  const inCopy = root !== currentProject().root;
  const { token, label = '', choices = {} } = typeof input === 'string' ? { token: input } : input || {};
  if (typeof label !== 'string' || label.length > 300 || /[\r\n\0]/.test(label)) throw new Error('Ugyldig beskrivelse af gendannelsen.');
  if (!choices || typeof choices !== 'object' || Object.keys(choices).length > 200 || Object.values(choices).some(value => !['ours', 'theirs'].includes(value))) throw new Error('Ugyldigt valg i gendannelsen.');
  const pending = pendingRestore?.token === token && pendingRestore.root === root ? pendingRestore : null; pendingRestore = null;
  const auto = (await workbench.store.project(root)).autoCheckpoint === true;
  let applyToken = token, savedFirst = null;
  // Dine ugemte ændringer i de filer, der sættes tilbage, gemmes først som en version, så de kan hentes igen.
  if (auto && pending?.unsaved.length) {
    const review = await workbench.git.review(root);
    const files = review.files.filter(file => !file.blocked && pending.unsaved.includes(file.file)).map(file => file.file);
    if (files.length) savedFirst = await workbench.git.commit(root, { token: review.token, files, message: pending.kind === 'restore' ? 'Dine ændringer før gendannelsen' : 'Dine ændringer før fortrydelsen' });
    const again = await restoration.review(root, pending.request);
    if (JSON.stringify(again.files) !== pending.signature) throw new Error('Filerne har ændret sig. Gennemgå gendannelsen igen.');
    applyToken = again.token;
  }
  await workbench.ensureBaseline(requestChatID()).catch(() => {});
  await currentSpace().devServer.stop(); for (const chat of workbench.chats.values()) if (chat.root === root) await chat.close(false);
  let restored, error, saved = null;
  try { restored = await restoration.apply(root, applyToken, choices); } catch (failure) { error = failure.message; }
  // Med automatiske versioner gemmes gendannelsen som en ny version. Historikken bevares, og næste opgave kan gemmes for sig.
  if (restored && (await workbench.store.project(root)).autoCheckpoint === true) {
    try {
      const review = await workbench.git.review(root);
      const files = review.files.filter(f => !f.blocked && restored.paths.includes(f.file)).map(f => f.file);
      if (files.length) saved = await workbench.git.commit(root, { token: review.token, files, message: label.trim() || 'Gendannet version' });
    } catch (failure) { error = `Filerne er gendannet, men den nye version blev ikke gemt: ${failure.message}`; }
  }
  if (restored) workbench.log({ kind: 'restore', title: 'Filerne er sat tilbage', detail: `${label.trim() || 'Gendannet version'} · ${restored.paths.length === 1 ? '1 fil' : `${restored.paths.length} filer`}${saved ? ' · gemt som ny version' : ''}`, status: 'completed' }, requestChatID());
  if (error) workbench.log({ kind: 'error', title: 'Gendannelsen gik ikke helt igennem', detail: error, status: 'error' }, requestChatID());
  // activate kontrollerer journalen, også efter genstart eller en delvis gendannelse.
  if (!inCopy) { const restoredState = await restoration.previous(root); if (restoredState) await workbench.invalidatePlan(restoredState.id); }
  const reopened = null;
  // Ændringen står under Ændringer som din. Billedet efter tages i baggrunden af samme side i samme størrelse.
  // En opgave i denne samtale, der er fortrudt, kan ikke fortrydes igen fra kortet.
  if (restored?.files && pending?.task) { const done = workbench.findTask(pending.task); if (done) done.undone = true; }
  if (restored?.files) {
    const files = restored.changes.filter(change => change.binary || (change.before !== undefined && change.after !== undefined)).map(change => ({ ...change }));
    const task = workbench.recordEdit({ chat: requestChatID(), kind: 'undo', label: label.trim() || (pending?.kind === 'undo' ? 'Fortrudt gendannelse' : 'Gendannet version'), files, title: '', log: false });
    if (pending?.view) void (async () => {
      const pair = crypto.randomUUID();
      if (pending.now) await images.add(root, pending.now, { role: 'before', pair, view: pending.view, task: task.id });
      if (!currentSpace().externalPreview) await startStatic(root).catch(() => {});
      const after = await captureView(pending.view);
      if (after && currentProject()?.root === root) await images.add(root, after, { role: 'after', pair, view: pending.view, task: task.id, commit: saved?.head || null });
      if (saved?.head) await images.bind(root, pair, saved.head);
      sendEvent({ type: 'history.images', root, task: task.id, commit: saved?.head || null });
    })().catch(() => {});
  }
  return { restored, error, saved, savedFirst, project: reopened, state: await chatState(await workbench.state(requestChatID())) };
}));
handle('git:save', value => exclusive(async () => {
  const { note = '', view } = typeof value === 'string' || value === undefined ? { note: value || '' } : value;
  const root = requireIdleProject(), result = await workbench.git.saveAll(root, note || '');
  if (result.saved) workbench.log({ kind: 'checkpoint', title: 'Du gemte en version', detail: note || 'Uden beskrivelse', status: 'completed' }, requestChatID());
  // Et billede af forhåndsvisningen hører til den nye version. Før-billedet er det seneste af samme side og størrelse.
  if (result.head && view && Number.isFinite(view.width)) void (async () => {
    const shot = { page: currentPage(), width: view.width, height: view.height }, data = await captureView(shot);
    if (data && spaces.has(root)) await images.add(root, data, { role: 'after', view: shot, commit: result.head });
    sendEvent({ type: 'history.images', root, commit: result.head });
  })().catch(() => {});
  return result;
}));
handle('git:identity', value => exclusive(() => workbench.git.setIdentity(requireIdleProject(), value)));
handle('git:init', () => exclusive(() => workbench.git.initialize(requireIdleProject())));
handle('git:review', () => exclusive(() => workbench.git.review(requireIdleProject())));
handle('git:commit', input => exclusive(async () => {
  const root = requireIdleProject(), result = await workbench.git.commit(root, input);
  workbench.log({ kind: 'checkpoint', title: 'Du gemte en version med valgte filer', detail: String(input?.message || ''), status: 'completed' }, requestChatID());
  return result;
}));
handle('git:automatic', value => exclusive(async () => {
  const root = requireIdleProject();
  if (typeof value !== 'boolean') throw new Error('Ugyldigt valg af automatisk checkpoint.');
  if (value) {
    const repo = await workbench.git.repository(root);
    const block = await require('./core/checkpoints.cjs').automaticBlock(repo);
    if (block) throw new Error(block);
  }
  await workbench.store.saveProject(root, { autoCheckpoint: value });
  return value;
}));

function hostingIdle() { /* Login og udgivelsesvalg ændrer ikke projektfiler. */ }
async function sharingContext() { return { projectName: currentProject()?.name || '', viewingCopy: Boolean(currentChat()?.copy), copyCount: currentProject() ? (await workbench.chatList()).filter(chat => chat.isolated).length : 0 }; }
handle('hosting:state', async () => ({ context: await sharingContext(), ...await github.state(), project: Boolean(currentProject()), publication: currentProject() ? await publishing.status(currentProject().root).catch(error => ({ message: error.message, selected: null })) : null }));
handle('hosting:login', () => exclusive(async () => { hostingIdle(); return github.startLogin(); }));
handle('hosting:poll', id => exclusive(async () => { hostingIdle(); publishing.reviews.clear(); return github.poll(id); }));
handle('hosting:cancel', () => { github.cancel(); return true; });
handle('hosting:browser', () => { if (!github.pending) throw new Error('Start login først.'); return shell.openExternal('https://github.com/login/device'); });
handle('hosting:disconnect', () => exclusive(async () => { hostingIdle(); publishing.reviews.clear(); return github.disconnect(); }));
handle('hosting:catalog', () => exclusive(async () => { hostingIdle(); return { owners: await github.owners(), repositories: await github.repositories() }; }));
handle('hosting:create', input => exclusive(async () => { hostingIdle(); return github.create(input); }));
handle('hosting:attach', fullName => exclusive(() => publishing.attach(requireProject(), fullName)));
handle('hosting:review', () => exclusive(async () => ({ ...await publishing.review(requireProject()), context: await sharingContext() })));
handle('hosting:push', token => exclusive(() => publishing.push(requireIdleProject(), token)));
handle('hosting:open', async () => { const root = requireProject(); const selected = (await workbench.store.project(root)).publication; if (!selected) throw new Error('Vælg repository først.'); return shell.openExternal('https://github.com/' + require('./core/github.cjs').repository(selected.fullName)); });

handle('deployment:guides', () => require('./core/hosting-guidance.cjs').catalog());
handle('deployment:guide-open', input => shell.openExternal(require('./core/hosting-guidance.cjs').link(input?.id, input?.kind)));
handle('deployment:state', async () => ({ ...await deployments.state(requireProject()), context: await sharingContext() }));
handle('deployment:source', async () => deployments.source(requireProject()));
handle('deployment:setup', input => exclusive(() => deploymentSetup.act(requireProject(), input)));
handle('deployment:setup-cancel', input => {
  if (input?.provider !== 'promte') throw new Error('Denne loginhandling kan ikke afbrydes herfra.');
  return deploymentSetup.promte.cancel({ host: input.host, owner: requireProject() });
});
handle('deployment:setup-open', async input => shell.openExternal(await deploymentSetup.open(requireProject(), input)));
handle('deployment:tracking', async input => {
  if (!currentProject()) return null;
  const root = currentProject().root;
  return { root, ...await deploymentSetup.tracking(root, input?.refresh === true) };
});
handle('deployment:review', input => exclusive(async () => ({ ...await deployments.review(requireProject(), input), context: await sharingContext() })));
handle('deployment:send', token => exclusive(() => deployments.deploy(requireIdleProject(), token)));
handle('deployment:check', () => exclusive(() => deployments.check(requireProject())));
handle('deployment:open', async kind => {
  if (kind?.komplaiApp) {
    const app = (await deployments.providers.komplai.overview()).apps.find(app => app.id === kind.komplaiApp);
    if (!app) throw new Error('Vælg en af dine apps hos komplai.');
    return shell.openExternal(`${require('./core/komplai-publish.cjs').HUB}/publish?app=${encodeURIComponent(app.id)}`);
  }
  const state = await deployments.state(requireProject());
  if(kind==='settings') return shell.openExternal(await deployments.settings(requireProject()));
  if (!state.last) throw new Error('Ingen udgivelse registreret.');
  const url = kind === 'portal' ? state.last.target.portal : state.last.url;
  if (!url || !/^https:\/\//.test(url)) throw new Error('Intet link tilgængeligt.');
  return shell.openExternal(url);
});

// Faste sider hos udbyderne til nøglevejledningen. Kontrolleret 29. september 2026. Andre adresser åbnes aldrig herfra.
const accountPages = connections.accountPages;
handle('connections:account', value => {
  const kind = typeof value === 'string' ? value : value?.kind, page = typeof value === 'string' ? 'start' : value?.page || 'start';
  if (!Object.hasOwn(accountPages, kind) || !Object.hasOwn(accountPages[kind], page)) throw new Error('Denne forbindelse opsættes hos din organisation eller på din egen server.');
  return shell.openExternal(accountPages[kind][page]);
});

handle('setup:status', async () => {
  try {
    if (currentProject()) { const status = await workbench.git.status(currentProject().root); return { git: status.block || `Git er klar · branch ${status.branch}`, project: true }; }
    const version = (await require('./core/git.cjs').run(app.getPath('userData'), ['--version'])).toString().trim();
    return { git: `${version} · projektets historik og identitet kontrolleres, når du åbner et projekt.`, project: false };
  } catch (error) { return { git: error.message, project: Boolean(currentProject()) }; }
});
handle('connections:discover', () => require('./core/local-discovery.cjs').discoverLocalModels());
const komplaiLogin = new (require('./core/komplai.cjs').KomplaiLogin)();
handle('komplai:login', () => komplaiLogin.start(url => shell.openExternal(url)));
handle('komplai:cancel', () => komplaiLogin.cancel());
// Login giver kun en særskilt udgivelsesadgang. Tidligere AI-handlinger accepteres ikke.
handle('komplai:connect', value => exclusive(async () => {
  if (!value || typeof value.organisationId !== 'string' || value.publishing !== true || value.coding) throw new Error('Vælg komplai Run til udgivelse.');
  await komplaiLogin.connectPublishing(value.organisationId, workbench.store);
  komplaiLogin.cancel();
  return workbench.state(requestChatID());
}));
handle('komplai:publish-state', () => require('./core/komplai.cjs').publishingState(workbench.store));
handle('komplai:publish-overview', () => deployments.providers.komplai.overview());
handle('komplai:publish-address', value => deployments.providers.komplai.address(value?.slug, value?.appId));
handle('komplai:publish-disconnect', () => exclusive(() => require('./core/komplai.cjs').disconnectPublishing(workbench.store)));
handle('connections:state', () => workbench.state(requestChatID()));
handle('connections:save', value => exclusive(() => {
  // Hovedvinduet må aldrig bære en nøgle. Den indtastes i nøglevinduet, som gemmer den selv.
  if (value && typeof value === 'object' && ('apiKey' in value || 'secret' in value)) throw new Error('Nøglen indtastes i nøglevinduet. Brug Indtast nøgle.');
  return workbench.saveConnection(value);
}));
// Nøglevinduet: AI-nøgler og GitHub-token indtastes kun her, i et eget vindue med sin egen session.
const keyWindow = new KeyWindow({
  electron: { BrowserWindow, ipcMain, session }, uiDir: path.join(__dirname, 'ui'),
  preload: path.join(__dirname, 'core', 'key-window-preload.cjs'),
  parent: () => window, background: () => windowBackground(nativeTheme), title: 'Indtast nøgle',
  openAccount: kind => { const pages = accountPages[kind]; if (pages) shell.openExternal(pages.keys || pages.start); }
});
// Hovedvinduet siger, hvad nøglen skal bruges til, og får kun kvitteringen: id, ny tilstand, modelkatalog fra
// kontrollen og hvad rensningen rettede. Gemningen sker i hovedprocessen under den samme lås som Gem forbindelse.
handle('key:connection', value => {
  const bench = currentWorkbench(), chat = requestChatID();
  return keyWindow.open(connectionPurpose({
    input: value,
    store: (input, options) => exclusive(() => bench.storeConnection(input, options), 'connections'),
    state: () => bench.state(chat),
    accountKinds: Object.keys(accountPages)
  }));
});
handle('key:github', value => keyWindow.open(githubPurpose({
  github: { connectToken: key => exclusive(async () => { hostingIdle(); publishing.reviews.clear(); return github.connectToken(key); }, 'hosting') },
  target: value?.target === 'publish' ? 'publish' : 'backup'
})));
handle('key:cancel', () => { keyWindow.cancel(); return true; });
handle('connections:remove', value => exclusive(() => workbench.removeConnection(value)));
handle('connections:models', value => workbench.models(value));
handle('connections:routes', value => workbench.routes(value.connectionID, value.modelID));
handle('agent:prepare', value => exclusive(() => workbench.prepare(chatInput(value))));
handle('agent:send', value => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  value = chatInput(value);
  const server = spaceFor(workbench.chatFor(value.chat).root)?.devServer;
  if (server && ['installing', 'starting', 'stopping'].includes(server.state)) throw new Error('Vent på opstarten af forhåndsvisningen, eller stop den først.');
  return workbench.send(value);
});
handle('agent:stop', value => workbench.stop(chatInput(value)));
handle('agent:reply', value => workbench.reply(chatInput(value)));
handle('agent:question', value => workbench.question(chatInput(value)));
// Afklaring og plan: briefen er brugerens egne ord, og planen kan rettes af brugeren. Intet sendes, før næste besked.
handle('plan:brief', value => exclusive(() => workbench.saveBrief(value)));
handle('plan:wishes', value => exclusive(() => workbench.addWishes(value)));
handle('plan:edit', value => exclusive(() => workbench.editPlan(chatInput(value))));
handle('plan:restore', value => exclusive(() => workbench.restorePlan(chatInput(value))));
// Arbejdsfladens faner: Ændringer, Kode og Aktivitet. Alt er skrivebeskyttet; stier valideres her i hovedprocessen.
// Ændringer: opgaverne i denne samtale med deres før/efter-billeder, når Aura har taget dem.
handle('changes:overview', async value => {
  if (!currentProject()) return { running: false, tasks: [], session: null };
  value = chatInput(value);
  const root = workbench.chatFor(value?.chat).root, overview = await workbench.changeOverview(value);
  for (const task of overview.tasks) task.images = await images.pairFor(workbench.findTask(task.id)?.root || root, { task: task.id }).catch(() => null);
  return overview;
});
handle('changes:file', async value => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  // En fil i en gemt version: før og efter læses fra Git. Ellers fra Auras øjebliksbilleder i denne samtale.
  if (typeof value?.source === 'string' && value.source.startsWith('version:')) {
    const root = currentProject().root, commit = value.source.slice(8), file = await history.file(root, commit, value.file);
    const kind = kindOf((await require('./core/git.cjs').run(root, ['log', '-1', '--format=%s', commit])).toString().trim());
    return file.hidden ? { file: value.file, change: 'ændret', by: ['ai', 'stopped'].includes(kind) ? 'ai' : 'dig', secret: true, added: 0, removed: 0, hunks: [] } : fileDetail(value.file, file.before, file.after, ['ai', 'stopped'].includes(kind) ? 'ai' : 'dig');
  }
  return workbench.changeFile(chatInput(value));
});
handle('code:list', async value => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  value = chatInput(value);
  const root = workbench.chatFor(value?.chat).root, result = await projectFiles.listFiles(root), changed = workbench.changedFiles(value);
  return { root, truncated: result.truncated, files: result.files.map(file => ({ ...file, changed: changed.get(file.path) || null })), deleted: [...changed].filter(([, kind]) => kind === 'slettet').map(([file]) => file) };
});
handle('code:read', file => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return projectFiles.readFile(workspaceRoot(), file); });
handle('activity:list', value => currentProject() ? workbench.activityList(value?.chat || requestChatID()) : []);
handle('skills:list', () => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return workbench.skills.list(currentProject().root); });
handle('skills:save', value => exclusive(async () => {
  requireProject();
  for (const chat of workbench.chats.values()) if (!chat.running && !chat.sending && !chat.starting && !chat.finishing) { chat.prepared = null; await chat.close(false); }
  return workbench.skills.save(currentProject().root, value);
}));
// Funktioner: standarden for alle projekter og undtagelser for det åbne projekt. Ændringer gælder fra næste opgave.
async function projectSettings() {
  const root = requireProject(), config = await workbench.store.project(root);
  return { runtime: normalizeRuntimeConfig(config.runtime || {}), approvals: await workbench.approvalsPolicy.settings(root), commandSandbox: await require('./core/command-sandbox.cjs').support() };
}
handle('project:settings', projectSettings);
handle('project:settings-save', value => exclusive(async () => {
  const root = requireProject();
  if (!value || typeof value !== 'object') throw new Error('Vælg en projektindstilling.');
  const runtime = value.runtime === undefined ? null : normalizeRuntimeConfig(value.runtime);
  for (const name of ['autoProjectFiles', 'autoCommands']) if (value[name] !== undefined && typeof value[name] !== 'boolean') throw new Error('Ugyldigt valg af Auto-godkend.');
  if (value.autoCommands === true) { const sandbox = await require('./core/command-sandbox.cjs').support(); if (!sandbox.available) throw new Error(sandbox.reason); }
  if (runtime) await workbench.store.saveProject(root, { runtime });
  if (value.autoProjectFiles !== undefined) await workbench.approvalsPolicy.setProjectFiles(root, value.autoProjectFiles);
  if (value.autoCommands !== undefined) await workbench.approvalsPolicy.setCommands(root, value.autoCommands);
  if (value.revoke !== undefined) await workbench.approvalsPolicy.revoke(root, value.revoke);
  for (const chat of workbench.chats.values()) if (!chat.running && !chat.sending && !chat.starting && !chat.finishing) chat.prepared = null;
  for (const ctx of spaces.values()) if (ctx.owner === currentWorkbench() && !['running','starting','installing','stopping'].includes(ctx.devServer?.state)) {
    ctx.runtimeConfig = normalizeRuntimeConfig((await workbench.store.project(root)).runtime || {});
    ctx.detectedRuntime = await inspectRuntime(ctx.root, ctx.runtimeConfig);
    ctx.devServer.configure(ctx.runtimeConfig);
  }
  return projectSettings();
}));
handle('features:get', () => workbench.features.get(currentProject()?.root));
handle('features:save', value => exclusive(async () => {
  const result = await workbench.features.save(currentProject()?.root, value);
  for (const bench of registry.values()) for (const chat of bench.chats.values()) if (!chat.running && !chat.sending && !chat.starting && !chat.finishing) chat.prepared = null;
  return result;
}));
handle('preview:attach', value => exclusive(async () => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  if (!value) { await currentSpace().devServer.stop(); currentSpace().forceStatic = true; currentSpace().externalPreview = null; if (currentSpace().preview) await currentSpace().preview.close(); const next = await openProject(workspaceRoot()); currentSpace().preview = next.staticPreview ? previewSession.staticPreview(currentSpace()) : null; return currentSpace().preview?.url || null; }
  let url; try { url = new URL(value); } catch { throw new Error('Angiv en lokal serveradresse.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Brug en lokal http- eller https-adresse uden login eller parametre.');
  if (registry.servers().some(server => server === url.origin || server.startsWith(url.origin + '/'))) throw new Error('Agentens interne server kan ikke bruges som forhåndsvisning.');
  if ([...spaces.values()].some(ctx => ctx.root !== selectedRoot && (ctx.preview?.url?.startsWith(url.origin + '/') || ctx.externalPreview?.startsWith(url.origin + '/')))) throw new Error('Vælg samtalen i sidepanelet for at se dens forhåndsvisning.');
  try { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) }); await response.body?.cancel(); if (!response.ok) throw new Error(); }
  catch { throw new Error('Den lokale udviklingsserver svarer ikke. Start den separat; appen kører ingen kommando automatisk.'); }
  await currentSpace().devServer.stop();
  if (currentSpace().preview) await currentSpace().preview.close(); currentSpace().preview = null; currentSpace().externalPreview = url.href;
  return currentSpace().externalPreview;
}));
// Forhåndsvisningen af en Promte-app: Aura svarer som Promte og sender appens kald videre.
handle('promte:preview-connect', async () => currentProject() ? promtePreview.connect(currentProject().root, { workspaceRoot: workspaceRoot() }) : { active: false });
handle('promte:preview-login', async () => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return promtePreview.login(currentProject().root, workspaceRoot()); });
handle('promte:preview-create', async () => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return promtePreview.create(currentProject().root, workspaceRoot()); });
handle('promte:preview-fetch', async input => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return promtePreview.fetch(currentProject().root, input); });
// Forhåndsvisningen af en komplai Run-app: Aura sender SDK'ets kald til Hubs forhåndsvisning af din egen app.
// Valg og app følger projektet; manifestet læses fra den viste arbejdsmappe.
function komplaiScript(root) { const owner = ownerFor(root); return route => owner?.project ? komplaiPreview.script(owner.project.root, route).catch(() => null) : Promise.resolve(null); }
handle('komplai:preview-state', async () => currentProject() ? komplaiPreview.state(currentProject().root) : { active: false });
handle('komplai:preview-create', async () => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return komplaiPreview.create(currentProject().root); });
handle('komplai:preview-call', async input => currentProject() ? komplaiPreview.call(currentProject().root, input, workspaceRoot()) : { status: 503, body: { error: 'unavailable' } });
handle('preview:runtime', async () => ({ ...await currentSpace().devServer.status(), root: currentProject()?.root, workspaceRoot: workspaceRoot() }));
// Kontrol af forhåndsvisningen efter en opgave: blev siden vist, og skrev den fejl i konsollen? Aura klikker ikke i siden.
const previewLog = { documents: [], errors: [] };
const previewOrigin = () => currentSpace().preview?.url || (currentSpace().externalPreview ? new URL(currentSpace().externalPreview).origin + '/' : null);
function fromPreview(url) { const origin = previewOrigin(); return Boolean(origin && typeof url === 'string' && url.startsWith(origin)); }
function remember(list, entry) { list.push(entry); while (list.length > 50) list.shift(); }
handle('preview:check', input => {
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  const since = Number(input?.since) || 0, origin = previewOrigin();
  if (!origin) return { preview: false };
  const documents = previewLog.documents.filter(item => item.at >= since && item.url?.startsWith(origin)), errors = previewLog.errors.filter(item => item.at >= since && item.url?.startsWith(origin));
  const last = documents.at(-1) || null;
  const result = { preview: true, loaded: Boolean(last), status: last?.status || null, errors: errors.slice(0, 5).map(({ message, source, line }) => ({ message, source, line })), errorCount: errors.length };
  const shown = !last ? 'siden svarede ikke' : last.status >= 400 ? `siden svarede med fejl ${last.status}` : 'siden blev vist';
  workbench.log({ kind: 'check', title: 'Kontrol af forhåndsvisningen', detail: `${shown[0].toUpperCase()}${shown.slice(1)} · ${errors.length ? `${errors.length} ${errors.length === 1 ? 'fejl' : 'fejl'} i siden: ${errors[0].message}` : 'ingen fejl i konsollen'}. Aura har ikke klikket eller afprøvet funktioner.`, status: !last || last.status >= 400 || errors.length ? 'error' : 'completed' }, requestChatID());
  return result;
});
// Billeder af forhåndsvisningen til historikken. De tages i et skjult vindue med sin egen session uden lagring. Det
// må kun hente fra forhåndsvisningens egen adresse og får hverken preload, Node, tilladelser eller downloads.
let imageSessionReady = null, captureQueue = Promise.resolve();
function previewAllowed(url) { return Boolean(previewSession.contextForURL(spaces.values(), url)); }
function previewDiagnostic(ctx, diagnostic) {
  if (!ctx) return;
  sendEvent({ type: 'preview.diagnostic', root: ctx.owner.project.root, workspaceRoot: ctx.root, diagnostic });
}
function configurePreviewSession(ses) {
  return previewSession.installSession(ses, {
    contexts: () => spaces.values(),
    sdk: (ctx, route) => komplaiScript(ctx.root)(route),
    onDiagnostic: previewDiagnostic
  });
}
function imageSession() {
  if (imageSessionReady) return;
  const ses = session.fromPartition('aura-billeder');
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  configurePreviewSession(ses);
  imageSessionReady = true;
}
// Siden, brugeren ser i forhåndsvisningen, i forhold til dens egen adresse. Den statiske servers nøgle er ikke med.
function currentPage() {
  const base = currentSpace().preview?.url || currentSpace().externalPreview, frame = previewFrame();
  if (!base || !frame) return '';
  return frame.url.startsWith(base) ? frame.url.slice(base.length).split('#')[0].slice(0, 300) : '';
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function captureView(view, root = workspaceRoot()) {
  const ctx = spaceFor(root), base = ctx?.preview?.url || ctx?.externalPreview;
  if (!base || !view || !Number.isFinite(view.width) || !Number.isFinite(view.height)) return Promise.resolve(null);
  const width = Math.round(Math.min(1920, Math.max(320, view.width))), height = Math.round(Math.min(1600, Math.max(320, view.height)));
  const page = typeof view.page === 'string' && !/^[a-z][a-z0-9+.-]*:|^\/\/|\.\./i.test(view.page) ? view.page.replace(/^\/+/, '') : '';
  const shoot = async () => {
    imageSession();
    const shot = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { partition: 'aura-billeder', offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false, backgroundThrottling: false, spellcheck: false } });
    shot.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    shot.webContents.on('will-navigate', event => event.preventDefault());
    try {
      await Promise.race([shot.loadURL(base + page), wait(10000).then(() => { throw new Error('Siden svarede ikke.'); })]);
      await wait(700);
      const image = await shot.webContents.capturePage();
      if (image.isEmpty()) return null;
      return (image.getSize().width > 1200 ? image.resize({ width: 1200, quality: 'good' }) : image).toJPEG(78);
    } catch { return null; }
    finally { if (!shot.isDestroyed()) shot.destroy(); }
  };
  const result = captureQueue.then(shoot, shoot); captureQueue = result.catch(() => {});
  return result;
}
// Ændringstilstand i forhåndsvisningen. Brugeren slår den selv til; først da indsættes valgscriptet i previewets
// ramme. Sandbox, indholdspolitik og netværksregler er de samme, og siden kan ikke kalde Aura. Hvert valg hentes som
// data og renses her, før det vises eller bruges.
const picking = { active: false, key: '', generation: 0, selected: '' };
const sendEvent = event => { if (window && !window.isDestroyed()) window.webContents.send('harness:event', event); };
function previewFrame() {
  const main = window?.webContents.mainFrame;
  if (!main || !previewOrigin()) return null;
  return main.frames.find(frame => { try { return !frame.detached && fromPreview(frame.url); } catch { return false; } }) || null;
}
async function injectPicker() {
  const frame = previewFrame();
  if (!frame) throw new Error('Forhåndsvisningen er ikke klar. Vent, til siden er vist, og prøv igen.');
  const generation = ++picking.generation;
  await frame.executeJavaScript(previewEdit.pickerSource({ key: picking.key, selected: picking.selected }));
  void pickLoop(frame, generation);
}
async function pickLoop(frame, generation) {
  const key = JSON.stringify(picking.key);
  while (picking.active && generation === picking.generation) {
    let value;
    try { value = await frame.executeJavaScript(`window[${key}] ? window[${key}].next() : null`); } catch { return; }
    if (!picking.active || generation !== picking.generation || !value || typeof value !== 'object') return;
    if (value.type === 'exit') { await stopPicking('esc'); return; }
    if (value.type === 'pick') await pickedElement(value.element, frame.url).catch(error => sendEvent({ type: 'preview.pick', state: 'error', message: error.message }));
  }
}
async function stopPicking(reason) {
  if (!picking.active) return;
  picking.active = false; picking.generation++;
  const frame = previewFrame(), key = JSON.stringify(picking.key);
  try { await frame?.executeJavaScript(`window[${key}] && window[${key}].stop()`); } catch { /* Rammen er måske allerede væk. */ }
  sendEvent({ type: 'preview.pick', state: 'off', reason });
}
// Et valgt element: hvor teksten står i koden, og om Aura kan rette den direkte.
async function pickedElement(raw, frameURL) {
  const root = workspaceRoot(), origin = previewOrigin();
  if (!root || !origin) return;
  const selection = previewEdit.sanitizeSelection(raw);
  // Siden i forhold til forhåndsvisningens egen adresse, fx med Astros base-sti. Den statiske servers nøgle i stien sendes aldrig videre.
  const base = currentSpace().preview?.url || currentSpace().externalPreview || origin, url = String(frameURL || '');
  const relative = url.startsWith(base) ? url.slice(base.length) : url.startsWith(origin) ? url.slice(origin.length) : '';
  selection.page = '/' + relative.split(/[?#]/)[0];
  selection.pageFile = previewEdit.pageFileFor(relative, currentSpace().preview ? 'static' : currentSpace().detectedRuntime?.kind);
  const found = selection.leaf && selection.raw && !selection.secret ? await previewEdit.findText(root, selection.raw, { tag: selection.tag, pageFile: selection.pageFile }) : { matches: [] };
  if (workspaceRoot() !== root || !picking.active) return;
  const choice = previewEdit.chooseSource(found.matches, { pageFile: selection.pageFile });
  selection.source = choice.match ? { file: choice.match.file, line: choice.match.line } : null;
  selection.places = choice.match ? [] : found.matches.slice(0, 5).map(match => `${match.file}:${match.line}`);
  selection.sourceNote = choice.reason === 'many' ? `teksten står flere steder: ${selection.places.join(', ')}` : '';
  selection.edit = previewEdit.editability(selection, choice);
  selection.id = crypto.randomUUID();
  picking.selected = selection.selector;
  workbench.rememberSelection(selection);
  sendEvent({ type: 'preview.selected', root: currentProject().root, workspaceRoot: root, selection: { id: selection.id, name: selection.name, tag: selection.tag, text: selection.text, raw: selection.edit.possible ? selection.raw : '', label: selection.label, page: selection.page, source: selection.source, places: selection.places, edit: selection.edit, secret: selection.secret } });
}
handle('preview:pick', async value => {
  if (!value?.on) { await stopPicking('user'); return { active: false }; }
  if (!currentProject()) throw new Error('Åbn et projekt først.');
  if (workbench.busyRoot(workspaceRoot())) throw new Error('Vent, til AI’en er færdig i denne mappe, før du retter i siden.');
  if (!previewOrigin()) throw new Error('Forhåndsvisningen kører ikke. Start den først.');
  if (picking.active) await stopPicking('restart');
  Object.assign(picking, { active: true, key: previewEdit.newKey(), selected: '' });
  try { await injectPicker(); } catch (error) { picking.active = false; picking.generation++; throw error; }
  return { active: true };
});
handle('preview:edit-text', value => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return workbench.textEdit(value); });
handle('changes:undo', value => exclusive(() => { if (!currentProject()) throw new Error('Åbn et projekt først.'); return workbench.undoTask(value); }));
// Viser forhåndsvisningen teksten nu? Bruges efter en rettelse; svaret kommer fra siden og er kun en kontrol.
handle('preview:contains', async value => {
  const text = String(value?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000), frame = previewFrame();
  if (!text || !frame) return false;
  try { return (await frame.executeJavaScript(`String(document.body ? document.body.textContent : '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)})`)) === true; } catch { return false; }
});
handle('preview:prepare', value => exclusive(async () => {
  return currentSpace().devServer.prepare(value?.action, value?.scripts === true);
}));
handle('preview:execute', token => exclusive(async () => {
  if (workbench.busyRoot(workspaceRoot())) throw new Error('Vent på opgaven i denne samtale.');
  currentSpace().forceStatic = false;
  return currentSpace().devServer.execute(token);
}));
handle('preview:stop', () => currentSpace().devServer.stop().then(() => currentSpace().devServer.snapshot()));

app.whenReady().then(async () => {
  await networkJournal.configure({ directory: path.join(app.getPath('userData'), 'harness', 'network-journal') });
  app.setAboutPanelOptions({ applicationName: DISPLAY_NAME, applicationVersion: app.getVersion() });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: DISPLAY_NAME, submenu: [
      { label: `Om ${DISPLAY_NAME}`, role: 'about' },
      { label: 'Opdateringer …', click: () => sendEvent({ type: 'updates.open' }) },
      ...(process.platform === 'darwin' ? [
        { type: 'separator' }, { label: 'Tjenester', role: 'services' },
        { type: 'separator' }, { label: `Skjul ${DISPLAY_NAME}`, role: 'hide' },
        { label: 'Skjul andre', role: 'hideOthers' }, { label: 'Vis alle', role: 'unhide' }
      ] : []),
      { type: 'separator' }, { label: `Afslut ${DISPLAY_NAME}`, role: 'quit' }
    ] },
    { label: 'Rediger', submenu: [
      { label: 'Fortryd', role: 'undo' }, { label: 'Gentag', role: 'redo' },
      { type: 'separator' }, { label: 'Klip', role: 'cut' }, { label: 'Kopiér', role: 'copy' },
      { label: 'Sæt ind', role: 'paste' }, { label: 'Vælg alt', role: 'selectAll' }
    ] },
    { label: 'Vis', submenu: [
      { label: 'Faktisk størrelse', role: 'resetZoom' }, { label: 'Zoom ind', role: 'zoomIn' },
      { label: 'Zoom ud', role: 'zoomOut' }, { type: 'separator' }, { label: 'Fuld skærm', role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ type: 'separator' }, { label: 'Udviklerværktøjer', role: 'toggleDevTools' }] : [])
    ] },
    { label: 'Vindue', submenu: [
      { label: 'Minimér', role: 'minimize' }, { label: 'Zoom vindue', role: 'zoom' },
      { label: 'Luk vindue', role: 'close' },
      ...(process.platform === 'darwin' ? [{ type: 'separator' }, { label: 'Vis alle forrest', role: 'front' }] : [])
    ] }
  ]));
  registry = new WorkspaceRegistry({ directory: path.join(app.getPath('userData'), 'harness'), safeStorage, profiles: profileRoot,
    emit: event => { if (['session.error','engine.error'].includes(event.type)) recordFailure('agent', 'model'); sendEvent(event); },
    configure: bench => {
      bench.restoration = new (require('./core/restoration.cjs').Restoration)(bench.git, bench.store);
      bench.imageHook = async (role, task, extra = {}) => {
        const root = task.root;
        if (!task.images || !spaces.has(root)) return;
        if (role === 'before') task.images.view = { ...task.images.view, page: registry.selected === bench && selectedRoot === root ? currentPage() : '' };
        else if (!spaceFor(root)?.externalPreview) await startStatic(root).catch(() => false);
        const data = await captureView(task.images.view, root);
        if (data && spaces.has(root)) await images.add(root, data, { role, pair: task.images.pair, view: task.images.view, task: task.id, commit: role === 'after' ? extra.commit || null : null });
        if (role === 'after') { if (extra.commit) await images.bind(root, task.images.pair, extra.commit); sendEvent({ type: 'history.images', root: bench.project.root, workspaceRoot: root, task: task.id, commit: extra.commit || null }); }
      };
      bench.workspaceHook = async chat => {
        const value = await selectSpace(chat.root, bench);
        sendEvent({ type: 'chat.preview', root: bench.project.root, chat: chat.id, ...value });
      };
      bench.releaseWorkspace = async root => { const ctx = spaceFor(root); if (!ctx) return; await ctx.ready; await ctx.devServer.stop(); await ctx.preview?.close(); spaces.delete(root); sendEvent({ type: 'chat.copy-removed', root: bench.project.root, workspaceRoot: root }); if (selectedRoot === root) selectedRoot = null; };
    }
  });
  // Gendannelsestokens holdes af den projekt-ejer, som oprettede dem.
  restoration = new Proxy({}, { get(_target, key) { const owner = currentWorkbench().restoration, value = owner[key]; return typeof value === 'function' ? value.bind(owner) : value; } });
  history = new History(registry.store); images = new PreviewImages(registry.store);
  // Udseendet sættes, før vinduet åbnes, så et mørkt vindue ikke blinker lyst.
  appearance = new Appearance(registry.store, nativeTheme); await appearance.start();
  await workbench.copies.cleanup();
  github = new GitHub(workbench.store); publishing = new Publishing({ store: workbench.store, git: workbench.git, provider: github });
  deployments = new Deployments(workbench.store, { github });
  deploymentSetup = new (require('./core/deployment-setup.cjs').DeploymentSetup)(workbench.store, github, deployments);
  promtePreview = new (require('./core/promte-preview.cjs').PromtePreview)(workbench.store, { setup: deploymentSetup.promte, enabled: async root => (await workbench.features.get(root)).effective['integration-promte'] === true });
  komplaiPreview = new (require('./core/komplai-preview.cjs').KomplaiPreview)(workbench.store, { provider: deployments.providers.komplai, enabled: async root => (await workbench.features.get(root)).effective['integration-komplai-run'] === true });
  updates = new (require('./core/updates.cjs').Updates)({
    updater: app.isPackaged && ['darwin', 'win32'].includes(process.platform) ? require('electron-updater').autoUpdater : null,
    store: workbench.store, version: app.getVersion(), enabled: app.isPackaged,
    emit: event => { if (['error', 'ready'].includes(event.value.phase) && updating) { updating = false; quitReady = false; } sendEvent(event); },
    busy: () => operations.size > 0 || updating || registry.allChats().some(c => c.running || c.sending || c.starting || c.finishing)
      || [...spaces.values()].some(ctx => ['installing', 'starting', 'stopping'].includes(ctx.devServer?.state)),
    prepare: async () => {
      updating = true;
      try { await workbench.store.queue; await workbench.history.queue; await shutdown(); quitReady = true; }
      catch (error) { updating = false; quitReady = false; throw error; }
    }
  });
  await updates.start();
  protocol.handle('harness', async request => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    const providerAsset = /^provider-(alexandra|anthropic|azure|compatible|corti|komplai|mistral|ollama|openai|openrouter|zen|promte|github-pages|cloudflare|vercel)\.svg$/.test(name);
    if (url.host !== 'app' || (!providerAsset && name !== 'provider-cloudflare.png' && !uiFiles.has(name))) return new Response('Ikke fundet', { status: 404 });
    return new Response(await fs.readFile(path.join(__dirname, 'ui', name)), { headers: { 'Content-Type': name === 'aura-icon.png' ? 'image/png' : providerAsset ? 'image/svg+xml' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  configurePreviewSession(session.defaultSession);
  session.defaultSession.webRequest.onCompleted(details => {
    if (details.resourceType === 'subFrame' && previewAllowed(details.url)) remember(previewLog.documents, { at: Date.now(), status: details.statusCode, url: details.url });
  });
  function createWindow() {
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 980, minHeight: 720, backgroundColor: windowBackground(nativeTheme), title: DISPLAY_NAME, icon: appIcon, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Fejl, som forhåndsvisningens side selv skriver i konsollen. Kun previewets ramme; appens egne meddelelser tælles ikke.
    window.webContents.on('console-message', event => {
      if (event.level !== 'error' || !previewAllowed(event.frame?.url || '')) return;
      const diagnostic = previewSession.diagnosticForConsole(event);
      if (diagnostic) previewDiagnostic(previewSession.contextForURL(spaces.values(), event.frame?.url), diagnostic);
      const clean = require('./core/dev-server.cjs').cleanOutput;
      remember(previewLog.errors, { at: Date.now(), url: event.frame.url, message: clean(String(event.message || '')).slice(0, 300), source: String(event.sourceId || '').replace(previewOrigin() || '', ''), line: event.lineNumber || null });
    });
    // Genindlæses forhåndsvisningen i ændringstilstand, indsættes valgscriptet igen i den nye side.
    window.webContents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
      if (isMainFrame || !picking.active) return;
      let frame = null; try { frame = webFrameMain.fromId(processId, routingId); } catch { return; }
      if (frame && fromPreview(frame.url)) injectPicker().catch(() => {});
    });
    // ⌘K (Ctrl+K på Windows og Linux) åbner kommandopaletten, også når fokus står i forhåndsvisningen.
    window.webContents.on('before-input-event', (event, input) => {
      const modifier = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
      if (input.type !== 'keyDown' || input.isAutoRepeat || String(input.key).toLowerCase() !== 'k' || !modifier || input.alt || input.shift) return;
      event.preventDefault(); sendEvent({ type: 'palette.toggle' });
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const created = window;
    created.on('close', event => { if (quitReady) return; event.preventDefault(); shutdown().finally(() => { if (!created.isDestroyed()) created.destroy(); }); });
    created.on('closed', () => { window = null; assets = []; registry.deselect(); });
    window.loadURL(uiURL);
  }
  if (process.platform === 'darwin') app.dock.setIcon(appIcon);
  createWindow();
  nativeTheme.on('updated', () => window?.setBackgroundColor(windowBackground(nativeTheme)));
  app.on('activate', () => { if (!window) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => { komplaiLogin.cancel(); if (quitReady) return; event.preventDefault(); shutdown().finally(() => { quitReady = true; app.quit(); }); });
