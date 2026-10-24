const path = require('node:path');
const { Workbench } = require('../desktop/core/workbench.cjs');
const { OpenCodeEngine } = require('../desktop/core/engine.cjs');
const { openProject } = require('../desktop/core/projects.cjs');
const { Restoration } = require('../desktop/core/restoration.cjs');
const { DevServer } = require('../desktop/core/dev-server.cjs');
const { Deployments } = require('../desktop/core/deployments.cjs');
const { separateState } = require('./storage.cjs');
const { Cancelled } = require('./terminal.cjs');
const { login, selectModel, unlockConnection, disclose } = require('./connections.cjs');
const actions = require('./actions.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const modes = { plan: 'Planlæg', build: 'Byg efter planen', free: 'Arbejd direkte' };

class Application {
  constructor({ directory, vault, ui, profiles = path.join(__dirname, '..', 'profiles'), engineFactory, loginFactory, openBrowser }) {
    Object.assign(this, { directory, vault, ui, profiles, loginFactory, openBrowser });
    this.queue = Promise.resolve(); this.parts = new Map(); this.tools = new Map(); this.references = [];
    this.mode = 'plan'; this.selection = null; this.closing = false; this.answering = false; this.operation = 0; this.includeHistory = false;
    this.bench = new Workbench({ surface: 'cli', directory, safeStorage: vault, profiles, engineFactory: engineFactory || (options => new OpenCodeEngine({ ...options, detached: true })), emit: event => this.event(event) });
    this.bench.restoration = new Restoration(this.bench.git, this.bench.store);
    this.deployments = new Deployments(this.bench.store);
    this.dev = new DevServer();
  }
  async open(folder) {
    const project = await openProject(path.resolve(folder));
    separateState(project.root, this.directory);
    await this.bench.activate(project); await this.dev.activate(project.root);
    const state = await this.bench.state();
    if (!this.bench.chat) throw new Error(state.historyWarning || 'Samtalen kunne ikke åbnes. Eksisterende filer er bevaret.');
    this.selection = state.projectSettings.selection || null;
    this.mode = (Object.hasOwn(modes, state.workspace.mode) ? state.workspace.mode : 'plan');
    this.ui.line(`\nAura · ${project.name}\n${project.root}`);
    if (state.historyWarning) this.ui.line(state.historyWarning);
    if (state.workspace.messages.length) this.ui.line('Samtalen er genåbnet. /history viser tidligere beskeder.');
    if (state.workspace.draft) this.ui.line('Der ligger en kladde. /draft viser den og lader dig sende den.');
    for (const warning of project.warnings || []) this.ui.line(warning);
  }
  event(event) {
    if (event.chat && event.chat !== this.bench.chatID) return;
    if (event.type === 'run.review') this.review = event;
    if (event.type === 'permission.asked' || event.type === 'question.asked') {
      this.queue = this.queue.then(async () => {
        if (this.closing || !this.bench.running) return;
        this.flush(); this.answering = true;
        try {
          if (event.type === 'permission.asked') await this.permission(event.properties);
          else await this.question(event.properties);
        } catch (error) {
          if (error.code !== 'CANCELLED') this.ui.line(`Handlingen blev ikke godkendt: ${error.message}`);
          await this.stop();
        } finally { this.answering = false; this.render(); }
      }).catch(error => this.ui.line(error.message));
    }
    if (event.type === 'message.part.updated' || event.type === 'message.part.delta' || event.type === 'message.updated') this.render();
    const tool = event.type === 'message.part.updated' && event.properties?.part;
    if (tool?.type === 'tool' && !this.answering && this.tools.get(tool.id) !== tool.state?.status) {
      this.tools.set(tool.id, tool.state?.status);
      const status = { pending: 'venter', running: 'arbejder', completed: 'afsluttet', error: 'fejlede' }[tool.state?.status] || 'opdateret';
      this.ui.line(`\n${tool.tool} · ${status}`);
    }
    if (['engine.error', 'history.error', 'session.error'].includes(event.type)) this.ui.line(`\n${event.message || event.properties?.error?.data?.message || 'Opgaven kunne ikke fortsætte.'}`);
    if (event.type === 'session.new') this.ui.line('Ny modelsession. Planlægning medtager afklaringen; /context kan medtage tidligere samtaletekst ved direkte arbejde.');
  }
  render(final = false) {
    if (this.answering) return;
    const chat = this.bench.chat;
    for (const part of chat?.runText?.values() || []) {
      if (part.type !== 'text' || chat.runRoles.get(part.messageID) !== 'assistant') continue;
      // Hele linjer behandles samlet: kontrolsekvenser og nøgler må ikke slippe ud delt over streamingpakker.
      const raw = part.text || '', previous = this.parts.get(part.id) || 0;
      const end = final ? raw.length : raw.lastIndexOf('\n') + 1;
      if (end > previous) { this.ui.write(raw.slice(previous, end)); this.parts.set(part.id, end); }
    }
  }
  flush() { this.render(true); this.ui.line(); }
  async permission(request) {
    this.ui.line(`\nAI'en beder om tilladelse: ${request.permission}`);
    this.ui.line(`Arbejdsmappe: ${request.workspaceRoot || this.bench.project.root}`);
    this.ui.line(JSON.stringify({ handling: request.toolInput, mål: request.patterns, detaljer: request.metadata }, null, 2));
    const allow = await this.ui.confirm('Tillad denne handling én gang?');
    await this.bench.reply({ id: request.id, allow });
    this.ui.line(allow ? 'Handlingen er godkendt.' : 'Handlingen er afvist.');
  }
  async question(request) {
    const answers = [];
    for (const question of request.questions || []) {
      const options = (question.options || []).map(o => ({ label: `${o.label}${o.description ? ': ' + o.description : ''}`, value: o.label }));
      this.ui.line(question.question);
      const selected = options.length ? await this.ui.choose('Vælg et svar', [...options, { label: 'Skriv mit eget svar', value: '__custom' }]) : '__custom';
      if (!selected) throw new Error('Spørgsmålet blev afbrudt. Opgaven stoppes.');
      // Et enkelt valg er også et gyldigt svar på et spørgsmål, der tillader flere.
      answers.push([selected === '__custom' ? await this.ui.ask('Dit svar', { required: true }) : selected]);
    }
    await this.bench.question({ id: request.id, answers });
  }
  async status() {
    const state = await this.bench.state(), usage = state.usage || {};
    const connection = state.connections.find(c => c.id === this.selection?.connectionID);
    this.ui.line(`\n${modes[this.mode]} · ${connection?.name || 'Ingen AI valgt'} · ${this.selection?.modelID || 'Ingen model'} · indsats: modellens standard`);
    const costs = [];
    if (usage.calls > (usage.otherCalls || 0) && !usage.unpriced) costs.push(`${Number(usage.cost || 0).toFixed(6)} USD`);
    for (const [currency, value] of Object.entries(usage.otherCosts || {})) costs.push(`${Number(value).toFixed(6)} ${currency}`);
    if (usage.unpriced) costs.push('ukendt for nogle kald');
    this.ui.line(`Samtalen: ${usage.input || 0} tokens ind · ${usage.output || 0} ud · anslået pris: ${costs.join(' + ') || 'endnu intet forbrug'}`);
  }
  async submit(text) {
    if (!text.trim()) return;
    const operation = ++this.operation;
    const check = () => { if (operation !== this.operation || this.closing) throw new Cancelled(); };
    await this.bench.saveDraft({ text, mode: this.mode });
    check();
    if (!this.selection) this.selection = await selectModel(this);
    check();
    if (!this.selection) return;
    await unlockConnection(this, this.selection.connectionID);
    check();
    if (this.mode === 'build') {
      if (!this.bench.chat.plan) throw new Error('Lav en plan først med /plan, eller vælg /work til direkte ændringer.');
      this.ui.line(this.bench.chat.plan.text);
      if (!await this.ui.confirm('Byg efter denne plan?')) return;
    }
    const data = await this.bench.prepare({ ...this.selection, text, mode: this.mode, planID: this.bench.chat.plan?.id, references: this.references, includeHistory: this.includeHistory });
    check();
    if (!await disclose(this.ui, data)) return;
    check();
    this.parts.clear(); this.tools.clear(); this.review = null;
    this.ui.line('\nAI arbejder. Ctrl+C stopper opgaven; filer, der allerede er ændret, bliver liggende.');
    await this.bench.send({ text, fingerprint: data.fingerprint, contextBinding: data.contextBinding });
    while (this.bench.running || this.bench.finishing) await pause(50);
    await this.queue; this.flush();
    this.result();
    if (this.mode === 'plan' && this.bench.chat.plan) this.ui.line('Planen er gemt. Vælg /build, når du vil bygge efter den.');
    if (this.mode === 'build') { this.mode = 'free'; this.ui.line('Næste besked kan ændre resultatet. /plan starter ny planlægning.'); }
    await this.status();
  }
  result() {
    if (this.review?.status === 'stopped') this.ui.line('Opgaven er stoppet. Du kan skrive en ny besked.');
    if (this.review?.unavailable || !this.review) this.ui.line('Ændringerne kunne ikke opgøres. Gennemgå projektets filer.');
    else if (this.review.files.length) this.ui.line(`${this.review.files.length} ændrede filer i denne opgave. /diff viser ændringer; /undo kan fortryde den seneste opgave.`);
    else this.ui.line('Der blev ikke ændret filer i denne opgave.');
    if (this.review?.skipped) this.ui.line(`${this.review.skipped} filer indgår ikke i sammenligningen. Gennemgå dem særskilt.`);
  }
  async stop() { ++this.operation; if (this.bench.running && !this.bench.finishing) await this.bench.stop(); this.pendingLogin?.cancel(); }
  async command(line) {
    const [name, ...words] = line.trim().split(/\s+/); const argument = words.join(' ');
    switch (name) {
      case '/exit': return false;
      case '/help': this.ui.line('Skriv en opgave, eller brug:\n/plan  /build  /work  /model  /login  /history  /chats  /new\n/draft  /context  /references  /rules  /diff  /undo  /save  /versions\n/preview  /server  /deploy  /status  /exit'); break;
      case '/plan': this.mode = 'plan'; this.ui.line('Næste besked bruges til planlægning.'); break;
      case '/build': this.mode = 'build'; await this.submit(argument || 'Byg efter den viste plan.'); break;
      case '/work': this.mode = 'free'; this.ui.line('Næste besked kan ændre projektet efter godkendelse.'); break;
      case '/model': this.selection = await selectModel(this) || this.selection; break;
      case '/login': { const id = await login(this, argument || undefined); if (id) this.selection = await selectModel(this, id) || this.selection; break; }
      case '/history': for (const m of this.bench.workspace.messages) this.ui.line(`\n${m.role === 'user' ? 'Dig' : m.role === 'assistant' ? 'AI' : 'Aura'}:\n${m.text}`); break;
      case '/new': await this.bench.newChat(); this.mode = 'plan'; this.references = []; this.includeHistory = false; this.ui.line('Ny samtale. Projektfilerne er uændrede.'); break;
      case '/chats': { const id = await this.ui.choose('Vælg samtale', (await this.bench.chatList()).map(c => ({ value: c.id, label: c.title || 'Ny samtale' }))); if (id) { await this.bench.openChat(id); this.mode = (Object.hasOwn(modes, this.bench.workspace.mode) ? this.bench.workspace.mode : 'plan'); this.references = []; this.includeHistory = false; } break; }
      case '/context': this.ui.line('De seneste beskeder sendes som ekstra kontekst, også efter modelskift. De kan indeholde tidligere valgte referencer. /history viser teksten.'); this.includeHistory = await this.ui.confirm('Medtag denne samtales tekst i kommende opgaver, indtil du skifter samtale eller lukker?'); break;
      case '/draft': { const text = this.bench.workspace.draft; this.ui.line(text || 'Ingen kladde.'); if (text && await this.ui.confirm('Send kladden?')) await this.submit(text); break; }
      case '/references': await actions.references(this); break;
      case '/rules': await actions.rules(this); break;
      case '/diff': await actions.diff(this); break;
      case '/undo': await actions.undo(this); break;
      case '/save': await actions.save(this); break;
      case '/versions': await actions.versions(this); break;
      case '/preview': await actions.preview(this); break;
      case '/server': await actions.server(this); break;
      case '/deploy': await actions.deploy(this); break;
      case '/status': await this.status(); break;
      default: throw new Error('Ukendt kommando. Skriv /help.');
    }
    return true;
  }
  async chat() {
    this.ui.line('Beskriv, hvad du vil lave. /help viser mulighederne. Ctrl+C afbryder, /exit lukker.');
    await this.status();
    while (!this.closing && !this.ui.ended) {
      try {
        const text = await this.ui.ask('Dig');
        if (text.startsWith('/')) { if (!await this.command(text)) break; }
        else await this.submit(text);
      } catch (error) {
        this.ui.line(error.message);
        await this.stop();
      }
    }
  }
  async close() {
    this.closing = true; this.ui.interrupt(); this.pendingLogin?.cancel();
    try {
      await this.stop(); await this.queue;
    } finally {
      const results = await Promise.allSettled([this.dev.stop(), this.preview?.close(), this.bench.close()]);
      this.vault.close();
      for (const result of results) if (result.status === 'rejected') this.ui.line(`Oprydning: ${result.reason.message}`);
    }
  }
}
module.exports = { Application, modes };
