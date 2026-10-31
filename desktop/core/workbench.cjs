const crypto = require('node:crypto');
const { Store } = require('./store.cjs');
const { WorkspaceHistory } = require('./workspace-history.cjs');
const connections = require('./connections.cjs');
const { Skills } = require('./skills.cjs');
const { Features } = require('./features.cjs');
const { loadLibrary } = require('./library.cjs');
const { OpenCodeEngine, VERSION } = require('./engine.cjs');
const { GitVersions } = require('./git.cjs');
const { Checkpoints } = require('./checkpoints.cjs');
const brief = require('./brief.cjs');
const { ChatSession, planningReply } = require('./chat-session.cjs');
const { Activity } = require('./activity.cjs');
const { Copies } = require('./copies.cjs');
const { capture } = require('./changes.cjs');
const { ApprovalsPolicy } = require('./approvals-policy.cjs');

// Det, der hører til hele projektet: forbindelser, funktioner, skills, briefen, versioner og forhåndsvisningens valg,
// og projektets samtaler. Hver samtale er en ChatSession med sin egen motor og opgave. Kun én samtale ad gangen kan
// arbejde i den samme mappe; den, der arbejder, har "krav" på mappen, indtil opgaven er færdig.
class Workbench {
  constructor({ directory, safeStorage, profiles, emit, store, history, library: sharedLibrary, registry, surface = 'desktop', engineFactory = options => new OpenCodeEngine(options) }) {
    if (!['desktop', 'cli'].includes(surface)) throw new Error('Ukendt Aura-brugerflade.');
    this.surface = surface;
    this.store = store || new Store(directory, safeStorage); this.history = history || new WorkspaceHistory(this.store); this.registry = registry || null;
    this.approvalsPolicy = new ApprovalsPolicy(this.store);
    this.connectionRemovals = registry?.connectionRemovals || new Set();
    // Biblioteket indlæses én gang. Funktionerne afgør, hvilke af dets skills appens AI kan hente.
    let library = null;
    this.library = sharedLibrary || (() => library ??= loadLibrary(profiles).catch(error => { library = null; throw error; }));
    this.features = new Features(this.store, this.library); this.skills = new Skills(this.library, this.store, this.features);
    // Versionen efter en opgave hører til den samtale, hvis opgave gemmes.
    this.git = new GitVersions();
    this.checkpoints = new Checkpoints(this.git, event => { const owner = this.checkpointOwner; if (owner) { owner.checkpointEvent(event); owner.emit(event); } else emit(event); });
    this.engineFactory = engineFactory; this.profiles = profiles; this.emit = emit; this.catalogs = new Map(); this.catalogTimes = new Map(); this.catalogRequests = new Map(); this.connectionVersions = new Map();
    this.chats = new Map(); this.chatID = null; this.claims = new Map(); this.project = null; this.previewSelections = new Map();
    // Samtalernes Ændringer og Aktivitet, så længe appen er åben, også når projektet lukkes og åbnes igen.
    this.memory = new Map(); this.lastChatID = null; this.copies = new Copies(this.store); this.allocation = Promise.resolve();
  }
  // Den åbne samtale. Handlinger uden en bestemt samtale gælder den.
  get chat() { return this.chats.get(this.chatID) || null; }
  get running() { return [...this.chats.values()].some(chat => chat.running || chat.sending || chat.starting || chat.finishing); }
  get finishing() { return [...this.chats.values()].find(chat => chat.finishing)?.finishing || null; }
  get workspace() { return this.chat?.data || null; }
  // Motorer og forbindelser i brug, så forhåndsvisningen aldrig peger på dem.
  servers() { return [...this.chats.values()].flatMap(chat => [chat.engine?.url, chat.gateway?.url]).filter(Boolean); }
  chatFor(id) {
    const chat = id ? this.chats.get(id) : this.chat;
    if (!chat) throw new Error(id ? 'Samtalen er ikke åben længere. Vælg den igen.' : this.project ? 'Start en ny samtale med + for at fortsætte.' : 'Åbn et projekt først.');
    return chat;
  }

  // En samtales Ændringer og Aktivitet. De senest brugte huskes; en åben samtale glemmes aldrig.
  changesFor(id, root) {
    let changes = this.memory.get(id);
    if (!changes) { const projectRoot = this.project?.root || root; changes = { baseline: null, current: null, startedAt: null, tasks: [], activity: new Activity(entry => this.emit({ type: 'activity', root: projectRoot, workspaceRoot: this.chats.get(id)?.root || root, entry, chat: id })) }; }
    this.memory.delete(id); this.memory.set(id, changes);
    for (const key of this.memory.keys()) if (this.memory.size > 8 && key !== id && !this.chats.has(key)) this.memory.delete(key);
    return changes;
  }

  // ---------- Hvem arbejder i hvilken mappe ----------
  // Reservationen omfatter også opstarten, så to samtidige Send aldrig vælger projektmappen begge to.
  allocate(chat) {
    const operation = this.allocation.then(async () => {
      const holder = this.claims.get(chat.root);
      if (holder && holder !== chat) {
        const copy = await this.copies.create(this.project.root, chat.id);
        await chat.close(false);
        try { chat.data = await this.history.updateChat(this.project.root, chat.id, data => { data.copy = { id: copy.id }; data.opencode = null; }); }
        catch (error) { await this.copies.remove(copy); throw error; }
        chat.copy = copy; chat.root = copy.root; chat.prepared.root = copy.root;
        chat.changes.baseline = null; chat.changes.current = null; chat.changes.basis = null;
        await this.workspaceHook?.(chat);
        chat.emit({ type: 'chat.workspace', root: this.project.root, workspaceRoot: copy.root, isolated: true });
        chat.log({ kind: 'copy', title: 'Opgaven får sin egen kopi', detail: 'Projektfilerne ændres først, når du vælger Flet ind i projektet.', status: 'completed' });
      }
      this.claims.set(chat.root, chat);
    });
    this.allocation = operation.catch(() => {}); return operation;
  }
  claimable(chat) {
    const other = this.claims.get(chat.root);
    if (other && other !== chat && (other.running || other.starting || other.finishing)) throw new Error(`Samtalen »${other.title || 'Ny samtale'}« arbejder allerede i projektet. Vent, til den er færdig, eller stop den.`);
  }
  claim(chat) { this.claimable(chat); this.claims.set(chat.root, chat); }
  release(chat) { if (this.claims.get(chat.root) === chat) this.claims.delete(chat.root); }
  busyRoot(root) { return [...this.chats.values()].some(chat => chat.root === root && (chat.sending || chat.running || chat.starting || chat.finishing)); }
  // Motorer for samme mappe deler arbejdsmappe; en anden samtales ledige motor lukkes, før en ny starter.
  async closeOthers(chat) { for (const other of this.chats.values()) if (other !== chat && other.root === chat.root && !other.running && other.engine) await other.close(false); }
  // Sidepanelet opdateres samlet, højst én gang pr. 100 ms.
  chatsChanged() {
    if (this.chatsTimer || !this.project) return;
    this.chatsTimer = setTimeout(() => { this.chatsTimer = null; if (this.project) this.chatList().then(chats => this.emit({ type: 'chats.updated', root: this.project.root, chats, active: this.chatID }), () => {}); }, 100);
  }

  // ---------- Projekt og samtaler ----------
  async state(chatID) {
    const chat = chatID ? this.chatFor(chatID) : this.chat, project = this.project;
    const state = await this.store.read();
    return { connections: state.connections.filter(c => Object.hasOwn(connections.definitions, c.kind)).map(c => this.store.publicConnection(c)), retiredConnections: state.connections.filter(c => c.kind === 'komplai').map(c => ({ id: c.id, kind: c.kind, name: c.name, hasKey: Boolean(c.secret), account: { authMethod: c.account?.authMethod === 'token' ? 'token' : 'oauth' } })), definitions: connections.definitions, engineVersion: VERSION, projectSettings: project ? await this.store.project(project.root) : {}, running: this.running, workspace: chat?.data || null, historyWarning: this.historyWarning || chat?.historyWarning || '', usage: chat ? chat.currentUsage() : null, features: await this.features.get(project?.root), brief: project ? this.brief : null, plan: chat?.plan || null, lastPlan: chat?.lastPlan || null, chat: chat?.id || null, chatRunning: Boolean(chat?.running), workspaceRoot: chat?.root || project?.root, isolated: Boolean(chat?.copy), copy: chat?.copy ? { id: chat.copy.id, omissions: chat.copy.omissions } : null, chats: project ? await this.chatList(project.root) : [] };
  }
  async activate(project) {
    await this.close();
    if (this.chatID) this.lastChatID = this.chatID;
    this.chats.clear(); this.claims.clear(); this.chatID = null;
    this.project = project; this.historyWarning = ''; this.restorationID = null;
    this.brief = brief.initialBrief(project.purpose); this.previewSelections = new Map();
    try {
      const data = await this.history.open(project);
      // En gemt brief, der ikke kan læses, erstattes ikke stiltiende: idéen bruges, og den gemte fil bevares.
      if (data.brief) { try { this.brief = brief.normalizeBrief(data.brief); } catch { this.historyWarning = 'Den gemte brief kan ikke læses. Idéen bruges som udgangspunkt; filen er bevaret.'; } }
      await this.openChat(data.active);
    } catch (error) { this.historyWarning = error.message; this.chatID = null; }
    return this.state();
  }
  // Åbner en samtale. En samtale, der arbejder, fortsætter i baggrunden, mens en anden er åben.
  async openChat(id) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    let chat = this.chats.get(id);
    if (!chat) {
      const data = await this.history.openChat(this.project.root, id);
      const copy = data.copy?.id ? await this.copies.load(data.copy.id, this.project.root) : null;
      if (data.copy && !copy) { data.copy = null; await this.history.updateChat(this.project.root, id, item => { item.copy = null; }); }
      chat = new ChatSession(this, data, copy?.root || this.project.root); chat.copy = copy;
      await chat.restoreConcretePlan();
      if (copy) chat.log({ kind: 'copy', title: 'Samtalens kopi er hentet', detail: 'Den er endnu ikke flettet ind i projektet.', status: 'completed' });
      this.chats.set(id, chat);
    } else await this.history.updateProject(this.project.root, project => { project.active = id; });
    this.chatID = id;
    if (this.restorationID && !chat.copy) await chat.invalidatePlan(this.restorationID);
    this.chatsChanged();
    return this.state();
  }
  async newChat() {
    if (!this.project) throw new Error('Åbn et projekt først.');
    const data = await this.history.createChat(this.project.root);
    return this.openChat(data.id);
  }
  async renameChat(input) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    const data = await this.history.renameChat(this.project.root, input?.id, input?.title);
    const chat = this.chats.get(data.id); if (chat) chat.data = { ...chat.data, title: data.title, renamed: data.renamed };
    this.chatsChanged();
    return { title: data.title };
  }
  async archiveChat(input) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    const chat = this.chats.get(input?.id);
    if (chat?.running || chat?.sending || chat?.starting || chat?.finishing) throw new Error('Vent, til opgaven er færdig, før du arkiverer samtalen.');
    const archived = input?.archived !== false;
    if (chat) chat.archiving = true;
    let data;
    try { data = await this.history.archiveChat(this.project.root, input?.id, archived); }
    finally { if (chat) chat.archiving = false; }
    if (chat) { chat.data = { ...chat.data, archived }; if (archived) chat.preparedInvalidated = true; }
    if (archived && this.chatID === data.id) {
      const project = await this.history.project(this.project.root);
      this.chatID = null;
      return project.active ? this.openChat(project.active) : this.newChat();
    }
    this.chatsChanged(); return this.state();
  }
  // Sletning flytter samtalen væk med remove, fx til papirkurven. En samtale, der arbejder, kan ikke slettes.
  async deleteChat(input, remove) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    const chat = this.chats.get(input?.id);
    if (chat?.running || chat?.sending || chat?.finishing) throw new Error('Stop opgaven i samtalen, før du sletter den.');
    const data = await this.history.readChat(this.project.root, input.id);
    const copy = chat?.copy || (data.copy?.id ? await this.copies.load(data.copy.id, this.project.root) : null);
    const project = await this.history.removeChat(this.project.root, input?.id, remove);
    if (chat) { await chat.close(); this.chats.delete(chat.id); }
    if (copy) { await this.releaseWorkspace?.(copy.root); await this.copies.remove(copy); }
    this.memory.delete(input?.id);
    if (this.chatID === input?.id) { this.chatID = null; return project.active ? this.openChat(project.active) : this.newChat(); }
    this.chatsChanged();
    return this.state();
  }
  // Projektets samtaler med deres status lige nu: arbejder, venter på dig, afbrudt eller klar.
  async chatList(root = this.project?.root) {
    const list = await this.history.chats(root);
    return list.map(item => { const live = root === this.project?.root ? this.chats.get(item.id) : null; return { ...item, title: live?.data.title || item.title, running: Boolean(live?.running), waiting: Boolean(live?.running && live?.waiting), isolated: Boolean(live?.copy || item.copy), mergeReady: Boolean((live?.copy || item.copy) && !live?.running) }; });
  }
  async newConversation() { return this.newChat(); }

  // ---------- Det, der gælder hele projektet ----------
  // Uden en åben samtale, fx mens projektet genåbnes efter en gendannelse, logges i den samtale, der sidst var åben.
  log(entry, chatID) { const chat = chatID ? this.chats.get(chatID) : this.chat; return chat ? chat.log(entry) : this.memory.get(chatID || this.lastChatID)?.activity.put(entry); }
  activityList(id) { return this.chats.get(id || this.chatID)?.activityList() || []; }
  session(id) { return this.chats.get(id || this.chatID)?.session() || null; }
  // Efter en gendannelse beskriver planerne en anden version. Den åbne samtale nulstilles nu, de andre, når de åbnes.
  async invalidatePlan(restorationID) { this.restorationID = restorationID; if (!this.chat?.copy) await this.chat?.invalidatePlan(restorationID); }
  // Briefen: brugerens egne ord. Ændringer gælder fra næste besked og starter ikke en ny modelsession.
  async saveBrief(input) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    const next = brief.normalizeBrief(input);
    next.updatedAt = new Date().toISOString();
    return this.storeBrief(next);
  }
  async addWishes(wishes) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    if (!Array.isArray(wishes) || wishes.length > 10 || wishes.some(w => typeof w?.label !== 'string' || typeof w?.value !== 'string')) throw new Error('Ugyldige ønsker.');
    return this.storeBrief(brief.normalizeBrief(brief.addWishes(this.brief, wishes)));
  }
  async storeBrief(next) {
    const root = this.project.root;
    if (this.historyWarning && !this.chat) throw new Error('Briefen kan ikke gemmes, fordi samtalefilen ikke kan læses.');
    await this.history.saveBrief(root, next);
    if (this.project?.root === root) { this.brief = next; this.emit({ type: 'brief.updated', root, brief: next }); }
    return next;
  }
  // Et valgt element huskes, så beskeden til AI'en og tekstrettelsen bruger Auras eget valg og ikke data fra skærmen.
  rememberSelection(selection) {
    selection = { ...selection, workspaceRoot: this.chat?.root };
    this.previewSelections.set(selection.id, selection);
    for (const key of this.previewSelections.keys()) if (this.previewSelections.size > 20) this.previewSelections.delete(key);
    return selection;
  }

  // ---------- Forbindelser og modeller ----------
  async saveConnection(input, options) { await this.storeConnection(input, options); return this.state(); }
  // Gemmer forbindelsen og returnerer dens id. Er nøglen lige kontrolleret, gemmes kataloget fra kontrollen, så den ikke
  // hentes en gang til.
  async storeConnection(input, { catalog = null } = {}) {
    if (input?.kind === 'komplai' || (input?.id && (await this.connection(input.id)).kind === 'komplai')) throw new Error('komplai bruges nu kun til udgivelse via Udgiv. Vælg en anden AI-forbindelse.');
    const connection = connections.normalize(input);
    connection.revision = crypto.randomUUID();
    await this.store.update(state => {
      const previous = state.connections.find(c => c.id === connection.id);
      if (input.id && !previous) throw new Error('Forbindelsen findes ikke.');
      // En Corti-nøgle hører til sit eget miljø. Uden ny nøgle beholder forbindelsen adressen fra den gemte nøgle.
      if (connection.kind === 'corti' && !input.apiKey && !input.clearKey && previous?.kind === 'corti') connection.baseURL = previous.baseURL;
      connection.secret = input.apiKey ? this.store.encrypt(connections.cleanKey(input.apiKey, connection.kind).key) : (input.clearKey || previous?.kind !== connection.kind || previous?.baseURL !== connection.baseURL ? undefined : previous?.secret);
      state.connections = [...state.connections.filter(c => c.id !== connection.id), connection];
    });
    await this.invalidateConnection(connection.id);
    if (Array.isArray(catalog)) this.catalogs.set(connection.id, catalog);
    return connection.id;
  }
  async removeConnection(id) {
    this.assertConnectionIdle(id);
    if (this.connectionRemovals.has(id)) throw new Error('Forbindelsen er allerede ved at blive fjernet.');
    this.connectionRemovals.add(id);
    try {
      const connection = await this.connection(id);
      if (connection.kind === 'komplai') {
        // Et indsat token kan også bruges i andre programmer. Fjernelse her tilbagekalder kun Auras egne loginadgange.
        if (connection.account?.authMethod !== 'token') await require('./komplai.cjs').disconnect(connection, this.store.decrypt(connection));
      }
      await this.store.update(state => { this.assertConnectionIdle(id); state.connections = state.connections.filter(c => c.id !== id); });
      await this.invalidateConnection(id); return this.state();
    } finally { this.connectionRemovals.delete(id); }
  }
  assertConnectionIdle(id) {
    const chats = this.registry ? this.registry.allChats() : [...this.chats.values()];
    if (chats.some(chat => (chat.running || chat.sending || chat.starting || chat.finishing) && (chat.running || chat.starting || chat.finishing ? chat.runConnectionID || chat.prepared?.connection?.id : chat.prepared?.connection?.id) === id)) throw new Error('Forbindelsen bruges af en opgave. Vent, til den er færdig, eller stop den først.');
  }
  invalidateConnection(id) {
    if (this.registry) return this.registry.invalidateConnection(id);
    return this.connectionChanged(id);
  }
  connectionChanged(id) {
    this.connectionVersions.set(id, (this.connectionVersions.get(id) || 0) + 1);
    this.catalogRequests.delete(id); this.catalogs.delete(id);
    const closing = [];
    for (const chat of this.chats.values()) if (chat.prepared?.connection?.id === id) {
      // Igangværende kald beholder deres forbindelse. Næste opgave skal forberedes med den nye revision.
      chat.preparedInvalidated = true;
      if (!chat.running && !chat.sending && !chat.starting && !chat.finishing) {
        const operation = (chat.connectionClosing || Promise.resolve()).then(() => chat.close(false));
        chat.connectionClosing = operation; closing.push(operation);
        operation.finally(() => { if (chat.connectionClosing === operation) chat.connectionClosing = null; }).catch(() => {});
      }
    }
    return Promise.all(closing);
  }
  async closeEngines() { for (const chat of this.chats.values()) if (!chat.running) await chat.close(false); }
  async connection(id) { const connection = (await this.store.read()).connections.find(c => c.id === id); if (!connection) throw new Error('Vælg en gemt forbindelse.'); return connection; }
  async models(id) {
    const request = Symbol(); this.catalogRequests.set(id, request); this.catalogs.delete(id);
    const connection = await this.connection(id);
    connections.assertSupported(connection);
    const models = (await connections.listModels(connection, this.store.decrypt(connection))).map(model => ({ ...model, effortLevels: connections.effortLevels(connection, model) }));
    // Et sent katalogsvar må ikke genindføre adgang efter redigering, fjernelse eller en nyere kontrol.
    if (this.catalogRequests.get(id) !== request) throw new Error('Forbindelsen blev ændret eller kontrolleret igen. Hent modellerne på ny.');
    this.catalogs.set(id, models); this.catalogTimes.set(id, new Date().toISOString()); return models;
  }
  async routes(id, modelID) { const connection = await this.connection(id); connections.assertSupported(connection); return connections.routes(connection, this.store.decrypt(connection), modelID); }
  async selection(input) {
    if (!this.project) throw new Error('Åbn et projekt først.');
    if (typeof input.modelID !== 'string' || !/^[a-zA-Z0-9_./:@+-]{1,200}$/.test(input.modelID)) throw new Error('Vælg en gyldig model.');
    const connection = await this.connection(input.connectionID);
    // Kataloget hentes igen før afsendelse, så ændret pris/model giver nye oplysninger.
    const model = (await this.models(connection.id)).find(m => m.id === input.modelID);
    if (!model) throw new Error('Modellen findes ikke længere hos denne forbindelse.');
    const routes = await this.routes(connection.id, model.id);
    const route = routes.find(r => r.id === input.routeID);
    if (connection.kind === 'openrouter' && !route) throw new Error('Vælg en konkret OpenRouter-udbyder.');
    if ((await this.connection(connection.id)).revision !== connection.revision) throw new Error('Forbindelsen blev ændret. Gennemgå oplysningerne igen.');
    await this.store.saveProject(this.project.root, { selection: { connectionID: connection.id, modelID: model.id, routeID: route?.id || '' } });
    return { connection, model, route };
  }

  // ---------- Handlinger i en samtale ----------
  // Uden input.chat gælder handlingen den åbne samtale.
  prepare(input) { return this.chatFor(input?.chat).prepare(input); }
  send(input) { return this.chatFor(input?.chat).send(input); }
  stop(input) { return this.chatFor(input?.chat).stop(); }
  // Godkendelser og spørgsmål hører til den samtale, hvis motor stillede dem.
  reply(input) { const chat = input?.chat ? this.chatFor(input.chat) : [...this.chats.values()].find(item => item.engine?.pending.has(input?.id)) || this.chatFor(); return chat.reply(input); }
  question(input) { const chat = input?.chat ? this.chatFor(input.chat) : [...this.chats.values()].find(item => item.questions?.has(input?.id)) || this.chatFor(); return chat.question(input); }
  editPlan(input) { return this.chatFor(input?.chat).editPlan(input); }
  restorePlan(input) { return this.chatFor(input?.chat).restorePlan(input); }
  saveDraft(input) { return this.chatFor(input?.chat).saveDraft(input); }
  changeOverview(input) { return this.chatFor(input?.chat).changeOverview(); }
  changeFile(input) { return this.chatFor(input?.chat).changeFile(input); }
  changedFiles(input) { return this.chats.get(input?.chat || this.chatID)?.changedFiles() || new Map(); }
  textEdit(input) { return this.chatFor(input?.chat).textEdit(input); }
  undoTask(input) { return this.chatFor(input?.chat).undoTask(input); }
  recordEdit(input) { return this.chatFor(input?.chat).recordEdit(input); }
  ensureBaseline(chatID) { return this.chatFor(chatID).ensureBaseline(); }
  findTask(id) { for (const changes of this.memory.values()) { const task = changes.tasks.find(item => item.id === id); if (task) return task; } return null; }
  async mergeReview(input) {
    const chat = this.chatFor(input?.chat);
    if (!chat.copy) throw new Error('Samtalen arbejder i projektet og har ingen kopi at flette.');
    if (this.busyRoot(this.project.root) || this.busyRoot(chat.root)) throw new Error('Vent på opgaven i projektet og i denne kopi, før du fletter.');
    const diff = await this.copies.diff(chat.copy);
    if (diff.unsupported.length) throw new Error(`Kopien har ændringer, der kræver manuel gennemgang: ${diff.unsupported.join(', ')}. Kopien er bevaret.`);
    const request = { merge: diff }, review = await this.restoration.review(this.project.root, request);
    const auto = (await this.store.project(this.project.root)).autoCheckpoint === true && (await this.features.get(this.project.root)).effective.versioner === true;
    let unsaved = [];
    if (review.git) { const repo = await this.git.repository(this.project.root); unsaved = review.files.map(f => f.file).filter(f => repo.files.some(item => item.file === f)); }
    Object.assign(review, { unsaved, saveFirst: auto && review.git && Boolean(unsaved.length), saveAfter: auto && review.git, copy: chat.copy.id });
    this.pendingMerge = { chat: chat.id, copy: chat.copy.id, token: review.token, request, signature: JSON.stringify(review.files), source: JSON.stringify(diff), unsaved, git: review.git };
    return review;
  }
  async mergeApply(input) {
    if (input?.choices && (typeof input.choices !== 'object' || Object.keys(input.choices).length > 200 || Object.values(input.choices).some(value => !['ours','theirs'].includes(value)))) throw new Error('Ugyldigt valg af linjer.');
    const pending = this.pendingMerge; this.pendingMerge = null;
    const chat = this.chatFor(input?.chat), root = this.project.root;
    if (!pending || pending.chat !== chat.id || pending.token !== input?.token || pending.copy !== chat.copy?.id) throw new Error('Gennemgå kopien igen før indfletning.');
    if (this.busyRoot(root) || this.busyRoot(chat.root)) throw new Error('Vent på opgaven i projektet og i denne kopi, før du fletter.');
    if (JSON.stringify(await this.copies.diff(chat.copy)) !== pending.source) throw new Error('Kopien har ændret sig. Gennemgå den igen.');
    const auto = pending.git && (await this.store.project(root)).autoCheckpoint === true && (await this.features.get(root)).effective.versioner === true;
    let token = pending.token, savedFirst = null, saved = null, error = null;
    if (auto && pending.unsaved.length) {
      const status = await this.git.review(root), files = status.files.filter(f => !f.blocked && pending.unsaved.includes(f.file)).map(f => f.file);
      // Kontrollér filerne inden den første versionsskrivning, også når kopien er ændret eksternt.
      const verify = await this.restoration.review(root, pending.request);
      if (JSON.stringify(verify.files) !== pending.signature) throw new Error('Projektfilerne har ændret sig. Gennemgå indfletningen igen.');
      if (files.length) savedFirst = await this.git.commit(root, { token: status.token, files, message: 'Dine ændringer før indfletningen' });
      token = (await this.restoration.review(root, pending.request)).token;
    }
    const baseline = await capture(root);
    const restored = pending.request.merge.files.length && pending.signature !== '[]' ? await this.restoration.apply(root, token, input.choices || {}) : { files: 0, paths: [], changes: [] };
    if (auto && restored.paths.length) {
      try { const status = await this.git.review(root), files = status.files.filter(f => !f.blocked && restored.paths.includes(f.file)).map(f => f.file); if (files.length) saved = await this.git.commit(root, { token: status.token, files, message: `Flettet ind: ${chat.title || 'Samtalens kopi'}` }); }
      catch (failure) { error = `Filerne er flettet ind, men versionen kunne ikke gemmes: ${failure.message}`; }
    }
    // Journalen gør indfletningen fortrydelig. Kopien ryddes først, når handlingen er registreret i samtalen.
    const copy = chat.copy;
    await chat.close(false); await this.releaseWorkspace?.(chat.root);
    chat.data = await this.history.updateChat(root, chat.id, data => { data.copy = null; data.opencode = null; });
    await this.copies.write({ ...copy, merged: true });
    chat.copy = null; chat.root = root; chat.prepared = null; chat.changes.baseline = baseline; chat.changes.current = null; chat.changes.startedAt = Date.now(); chat.changes.basis = 'merge';
    const files = restored.changes.map(f => ({ ...f }));
    const edit = files.length ? chat.recordEdit({ kind: 'merge', label: `Flettet ind: ${chat.title}`, files, title: 'Du flettede samtalens kopi ind', detail: `${files.length} filer · dine linjer bevares ved konflikt` }) : null;
    await this.copies.remove(copy); await this.workspaceHook?.(chat); this.chatsChanged();
    return { restored, error, saved, savedFirst, task: edit?.id || null, state: await this.state() };
  }
  // Lukker samtalernes motorer og afbryder en opgave i gang. Projektet og samtalerne forbliver åbne; activate skifter dem.
  async close() {
    for (const chat of this.chats.values()) await chat.close();
    clearTimeout(this.chatsTimer); this.chatsTimer = null;
    await this.history.queue;
  }
}
module.exports = { Workbench, planningReply };
