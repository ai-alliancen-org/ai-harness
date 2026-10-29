const $ = selector => document.querySelector(selector);
let current = null, revision = null, polling = false, state = null, modelRequest = 0, acceptedFingerprint = null, pendingSend = null, running = false;
let projectLoading = true, projectDisplayRequest = 0, navigationRequest = 0, startupLoads = 0;
// Opret projekt er låst, så længe et projekt åbnes eller oprettes, eller opstartsvalgene hentes. Efter forslag i #49.
function syncCreateAvailability() {
  $('#create').disabled = projectLoading || startupLoads > 0;
  $('#create').textContent = projectLoading ? 'Åbner projektmappen …' : 'Opret projekt';
}
// Et accepteret resumé gælder samme modelsession og samme delte materiale, også filhenvisninger.
const reviewKey = data => `${data.fingerprint}|${data.consentKey}`;
let skillList = [], skillOwner = null, featuresOwner = null;
function message(text, error = false) {
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dialog) { let notice = dialog.querySelector('.dialog-notice'); if (!notice) { notice = document.createElement('p'); notice.className = 'dialog-notice'; notice.setAttribute('role', 'status'); dialog.append(notice); } notice.textContent = text; }
  // Beskeden tager sin egen plads, så den aldrig dækker skrivefeltet eller en knap.
  const surface = current && !$('#workspace').hidden ? $('#workspace') : !$('#setup').hidden ? $('#setup') : $('#onboarding');
  const anchor = surface.id === 'workspace' ? surface.querySelector('.work-grid') : surface.id === 'onboarding' ? $('#create-form') : surface.querySelector('section');
  surface.insertBefore($('#message'), anchor);
  $('#message').textContent = text; $('#message').classList.toggle('error', error); $('#message').hidden = false;
}
async function call(method, value, owner) { const result = await window.harness[method](value, owner); if (!result.ok) throw new Error(result.error); return result.value; }
const selectedOwner = () => current ? { root: current.root, chat: view.id } : null;
async function action(fn) { $('#message').hidden = true; try { return await fn(); } catch (error) { message(error.message, true); } }
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
// Hver samtale har sin egen visning: beskeder, godkendelser, resultatkort, plan og status for dens opgave. Kun den åbne
// samtales visning står i siden med de faste id'er; de andre lever videre og opdateres af deres egne hændelser.
const views = new Map();
function makeView(id) {
  const v = { id, historyPending: [], historyLoaded: false, historyNotice: '', unfinishedParts: new Set(), log: node('div'), approvals: node('div'), review: node('section', undefined, 'journey-card'), roles: new Map(), parts: new Map(), partTypes: new Map(), assistantText: new Map(), pendingMarkdown: new Set(), activityGroup: null, lastSentText: '', lastTarget: '', lastTargetRef: null, lastCheckpoint: null, rejectedThisRun: false, lastRejection: null, running: false, runStartedAt: 0, runLabel: '', statusDetail: '', waitingFor: [], plan: null, planCard: false, unread: false, draft: null, followChat: true, scrollTop: 0, lastSignalAt: 0, receivedChars: 0 };
  v.log.setAttribute('aria-live', 'polite'); v.review.hidden = true; v.review.setAttribute('aria-live', 'polite');
  if (id) views.set(id, v);
  return v;
}
let view = makeView(null);
view.log = document.getElementById('messages'); view.approvals = document.getElementById('approvals'); view.review = document.getElementById('run-review');
const viewFor = id => !id ? view : views.get(id) || makeView(id);
// Den åbne samtales visning sættes i siden. Status, plan og knapper følger den.
function mountView(v) {
  if (view !== v) { view.scrollTop = $('#chat-content').scrollTop; view.historyNotice = ''; }
  for (const [key, id] of [['log', 'messages'], ['approvals', 'approvals'], ['review', 'run-review']]) {
    const old = document.getElementById(id); if (old === v[key]) continue;
    old.removeAttribute('id'); v[key].id = id; old.replaceWith(v[key]);
  }
  view = v; v.root ||= current?.root || null;
  window.harness.selectContext?.(current ? { root: current.root, chat: v.id } : null);
  acceptedFingerprint = null; pendingSend = null;
  requestAnimationFrame(() => { if (view !== v) return; $('#chat-content').scrollTop = v.followChat ? $('#chat-content').scrollHeight : v.scrollTop; updateChatScroll(); }); v.unread = false; running = v.running; activePlan = v.plan;
  $('#plan-card').hidden = !v.planCard || !v.plan;
  updatePlanOffer(v);
  applyRunning(); renderHistoryControls();
}
const anyRunning = () => running || [...views.values()].some(v => v.running);
// En samtales navn, som sidepanelet viser det.
const chatTitle = id => window.chats?.projects().find(project => project.root === current?.root)?.chats?.find(chat => chat.id === id)?.title || 'Ny samtale';
// ⓘ: en kort forklaring, der åbnes med et klik og lukkes med Escape eller et klik udenfor. Teksten står i knappens data-info.
// Boblen flyttes ind i den åbne dialog, så den ikke bliver utilgængelig bag en modal dialog.
const infoPop = node('div', '', 'info-pop'); infoPop.id = 'info-pop'; infoPop.popover = 'auto'; infoPop.setAttribute('role', 'dialog'); infoPop.tabIndex = -1;
let infoSource = null, infoClosed = { at: 0, source: null };
function info(label, text) { const button = node('button', 'i', 'info'); button.type = 'button'; button.setAttribute('aria-label', `Mere om ${label}`); button.setAttribute('aria-expanded', 'false'); button.dataset.info = text; return button; }
function showInfo(button) {
  // Et klik uden for boblen lukker den allerede ved museklikket. Et klik på samme ⓘ skal derfor ikke åbne den igen.
  if (infoClosed.source === button && performance.now() - infoClosed.at < 400) return;
  const open = infoPop.matches(':popover-open');
  if (open) infoPop.hidePopover();
  if (open && infoSource === button) return;
  infoSource = button; infoPop.textContent = button.dataset.info; infoPop.setAttribute('aria-label', button.getAttribute('aria-label') || 'Forklaring');
  (button.closest('dialog[open]') || document.body).append(infoPop);
  infoPop.showPopover(); button.setAttribute('aria-expanded', 'true');
  const box = button.getBoundingClientRect(), width = Math.min(320, innerWidth - 32);
  infoPop.style.width = `${width}px`;
  const left = Math.min(Math.max(16, box.left + box.width / 2 - width / 2), innerWidth - width - 16);
  const below = box.bottom + 8 + infoPop.offsetHeight <= innerHeight - 16;
  Object.assign(infoPop.style, { left: `${left}px`, top: `${below ? box.bottom + 8 : Math.max(16, box.top - 8 - infoPop.offsetHeight)}px` });
  infoPop.focus();
}
// beforetoggle kommer med det samme, når et klik udenfor lukker boblen; toggle kommer først efter klikket.
// Knappens aria-expanded følger boblen med det samme; toggle kommer først senere, og så ville tilstanden halte bagefter.
infoPop.addEventListener('beforetoggle', event => { if (event.newState === 'closed' && infoSource) { infoClosed = { at: performance.now(), source: infoSource }; infoSource.setAttribute('aria-expanded', 'false'); } });
infoPop.addEventListener('toggle', event => {
  if (event.newState !== 'closed' || !infoSource || infoPop.matches(':popover-open')) return;
  if (document.activeElement === document.body || infoPop.contains(document.activeElement)) infoSource.focus();
});
document.addEventListener('click', event => { const button = event.target.closest('button.info'); if (button) { event.preventDefault(); event.stopPropagation(); showInfo(button); } }, true);
// Sidepanelets projekter og samtaler: se chats.js.
async function refreshRecent() { await window.chats?.refresh(); }
let draftTimer;
async function saveChatDraft(required = false) {
  clearTimeout(draftTimer);
  if (!current) return;
  const root = current.root, chat = view.id, text = $('#prompt').value, mode = $('#work-mode').value;
  if (!chat) return;
  view.draft = { text, mode };
  try { localStorage.setItem(`harness.chatDraft.${root}.${chat}`, JSON.stringify({ text, mode })); } catch {}
  $('#draft-status').textContent = 'Gemmer kladde …';
  try { await call('saveDraft', { root, chat, text, mode }, { root, chat }); if (current?.root === root && view.id === chat && $('#prompt').value === text) $('#draft-status').textContent = 'Kladde gemt på denne computer'; }
  catch { if (current?.root === root && view.id === chat) $('#draft-status').textContent = 'Kladden kunne ikke gemmes. Kopiér teksten, før du lukker.'; if (required === true) throw new Error('Kladden kunne ikke gemmes. Kopiér teksten, før du opdaterer.'); }
}
function option(value, label) { const el = node('option', label); el.value = value; return el; }
// AI'ens svar er markdown og vises med ui/markdown.js uden at blive til HTML. Kopiknapperne kommer, når svaret er
// færdigt, og et link åbnes kun i browseren, efter at hovedprocessen har godkendt adressen.
function markdownInto(element, text, complete = true) {
  window.MarkdownView.render(element, text, {
    complete,
    visible: value => window.ConversationMode.visible(value),
    copy: element.classList.contains('assistant') ? (value, button) => copyText(value, button) : undefined,
    openLink: url => action(() => call('openExternalLink', { url })),
    // Stier til filer i projektet bliver til links, der åbner filen under Kode.
    decorate: target => { window.ChatDisplay.swatches(target); window.workspace?.linkify(target); }
  });
}
// Under streaming gemmes den rå tekst, og visningen opdateres højst én gang pr. skærmopdatering.
function showAssistant(id, text, v = view) {
  v.assistantText.set(id, text); partElement(id, 'assistant', v);
  if (!v.pendingMarkdown.size) requestAnimationFrame(() => { for (const part of v.pendingMarkdown) { markdownInto(partElement(part, 'assistant', v), v.assistantText.get(part), !v.running); if (v.running) v.unfinishedParts.add(part); else v.unfinishedParts.delete(part); } v.pendingMarkdown.clear(); });
  v.pendingMarkdown.add(id);
}
function appendMessage(text, role = 'assistant', v = view) {
  const active = v === view;
  if (active) { $('#project-intro').hidden = true; $('#start-idea').hidden = true; }
  const el = node('div', text, `chat-message ${role}`); if (role === 'assistant' && text) markdownInto(el, text); v.log.append(el);
  if (active && role === 'user') view.followChat = true;
  return el;
}
const chatContent = $('#chat-content');
function updateChatScroll() { $('#chat-latest').hidden = chatContent.scrollHeight - chatContent.scrollTop - chatContent.clientHeight < 48; }
chatContent.addEventListener('scroll', () => { view.followChat = chatContent.scrollHeight - chatContent.scrollTop - chatContent.clientHeight < 48; view.scrollTop = chatContent.scrollTop; updateChatScroll(); }, { passive: true });
chatContent.addEventListener('wheel', event => { if (event.deltaY < 0) view.followChat = false; }, { passive: true });
new MutationObserver(() => { if (view.followChat) chatContent.scrollTop = chatContent.scrollHeight; updateChatScroll(); }).observe(chatContent, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
$('#chat-latest').onclick = () => { view.followChat = true; chatContent.scrollTop = chatContent.scrollHeight; updateChatScroll(); };
let guidedSetup = false, setupStep = 'choice';
let setupActive = false, setupGeneration = 0, verifiedConnection = '', recovery = '';
let preferredConnection = '', autoConnect = false;
try { preferredConnection = localStorage.getItem('harness.preferredConnection') || ''; } catch {}
function setupControls() {
  syncCreateAvailability();
  const id = $('#setup-connection').value, busy = projectLoading;
  $('#setup-test').disabled = !id || busy;
  $('#setup-continue').disabled = !id || verifiedConnection !== id || busy;
  $('#new').disabled = busy; $('#open').disabled = busy;
  $('#skills-button').disabled = busy || setupActive || !current; $('#features-button').disabled = busy;
  $('#setup-local').disabled = busy;
  $('#setup-git-open').disabled = busy;
  $('#setup-edit').disabled = !id || busy;
  $('#setup-continue').hidden = verifiedConnection !== id || !id;
  $('#setup-test').hidden = Boolean(id && verifiedConnection === id);
  $('#setup-add-another').hidden = !id || verifiedConnection !== id;
  updateSetupStatus();
}
// Det rolige statuspanel til højre i opsætningen. Det læser kun det, appen allerede ved: ingen netkald, kun
// textContent, og grønt først, når en kontrol faktisk er lykkedes. Efter forslag i #17.
const STATUS_STEPS = ['choice', 'provider', 'saved', 'local'];
let previewKind = '';
function updateSetupStatus() {
  const panel = $('#setup-status');
  panel.hidden = !setupActive || !STATUS_STEPS.includes(setupStep);
  if (panel.hidden) return;
  const details = setupStep === 'provider' && $('#setup-provider').dataset.view === 'details';
  const saved = (state?.connections || []).find(c => c.id === (setupStep === 'saved' ? $('#setup-connection').value : details ? $('#connection-id').value : ''));
  const kind = details ? $('#provider-kind').value : setupStep === 'local' ? 'ollama' : saved?.kind || previewKind || '';
  const name = saved?.name || (kind ? providerCards.find(item => item.kind === kind)?.name || state?.definitions[kind]?.name || kind : '');
  const view = window.SetupStatus.describe({ kind, name, saved: Boolean(saved), preview: Boolean(previewKind), check: saved ? connectionChecks.get(saved.id) : null, verified: Boolean(saved && verifiedConnection === saved.id) });
  const logo = kind ? window.ProviderBrand.asset(kind) : null;
  $('#setup-status-logo').hidden = !logo;
  if (logo) $('#setup-status-logo').src = logo;
  $('#setup-status-provider').textContent = view.provider;
  $('#setup-status-connection').textContent = view.connection;
  $('#setup-status-model').textContent = view.model;
  for (const [index, item] of [...$('#setup-status-path').children].entries()) item.dataset.active = String(view.active[index] === true);
  $('#setup-status-note').dataset.state = view.state;
  $('#setup-status-note').textContent = view.note;
}
function moveConnectionForm(guided) {
  const parent = guided ? $('#setup-provider-body') : $('#connection-form-home');
  if (!guided) $('#connection-advanced').hidden = false;
  parent.append($('#connection-form'), $('#connection-feedback'));
  updateKeyRow();
}
function setupPage(step) {
  ++setupGeneration;
  setupStep = step;
  const headings = { choice: ['Hvordan vil du forbinde din AI?', 'Vælg den adgang, du allerede har.'], provider: ['Hvem er din udbyder?', 'Har du ikke en nøgle, viser vi dig, hvordan du får en.'], local: ['AI på din computer', 'Vi leder efter modeller, du allerede har i Ollama.'], saved: ['Din AI-forbindelse', 'Kontrollér forbindelsen, før du fortsætter.'], tools: ['Avanceret opsætning', 'Forbindelser og lokale værktøjer.'], features: ['Hvad skal Aura hjælpe med?', 'Du kan altid ændre det under Indstillinger › Funktioner.'], 'features-pick': ['Hvad vil du slå til?', 'Vælg de funktioner, du vil bruge. Resten kan du slå til senere under Indstillinger › Funktioner.'] };
  $('#setup-title').textContent = headings[step][0]; $('#setup-subtitle').textContent = headings[step][1];
  $('#setup-eyebrow').textContent = step.startsWith('features') ? 'FUNKTIONER' : 'DIN AI';
  for (const el of document.querySelectorAll('[data-setup-step]')) el.hidden = el.dataset.setupStep !== step;
  moveConnectionForm(step === 'provider');
  $('#setup-advanced').hidden = step !== 'choice';
  $('#setup').dataset.step = step;
  $('#setup-title').focus(); window.scrollTo(0, 0); setupControls();
}
// Udbyderne vises på lige vilkår. Et valg åbner kun den valgte forbindelses opsætning.
const featuredProviders = [{ kind: 'anthropic' }, { kind: 'mistral' }, { kind: 'corti' }, { kind: 'alexandra' }];
const providerCards = [
  { kind: 'alexandra', name: 'Alexandra', text: 'Alexandra AI Platform.' },
  { kind: 'azure', name: 'Azure', text: 'OpenAI og Microsoft Foundry.' },
  { kind: 'anthropic', name: 'Claude', text: 'Anthropic API.' },
  { kind: 'corti', name: 'Corti', text: 'Corti API.' },
  { kind: 'compatible', name: 'Egen server', text: 'Et kompatibelt API.' },
  { kind: 'mistral', name: 'Mistral', text: 'Mistral API.' },
  { kind: 'ollama', name: 'Ollama', text: 'Lokalt eller på en server.' },
  { kind: 'openai', name: 'OpenAI', text: 'OpenAI API.' },
  { kind: 'zen', name: 'OpenCode Zen', text: 'OpenCode Zen API.' },
  { kind: 'openrouter', name: 'OpenRouter', text: 'OpenRouter API.' }
];
function providerPicker() {
  previewKind = '';
  $('#setup-provider').dataset.view = 'choose'; $('#setup-provider-body').hidden = true; $('#provider-cards').hidden = false;
  $('#provider-other-cards').hidden = true; $('#provider-more').hidden = false;
  $('#setup-title').textContent = 'Hvem vil du forbinde?'; $('#setup-subtitle').textContent = 'Vælg den udbyder eller server, du har adgang til.'; $('#setup-title').focus();
  updateSetupStatus();
}
function chooseProvider(kind) {
  previewKind = '';
  $('#provider-kind').value = kind; updateProvider();
  $('#setup-provider').dataset.view = 'details'; $('#provider-cards').hidden = true;
  $('#provider-other-cards').hidden = true; $('#provider-more').hidden = true;
  $('#setup-title').textContent = `Forbind ${providerCards.find(item => item.kind === kind)?.name || kind}`;
  $('#setup-subtitle').textContent = ['ollama', 'compatible'].includes(kind) ? 'Indtast adressen på din modelserver.' : 'Brug din adgangsnøgle fra udbyderen.';
  $('#connection-advanced').hidden = false;
  $('#setup-provider-body').hidden = false; $('#setup-title').focus();
  updateSetupStatus();
}
// Ollama nås gennem "AI på min computer" og står derfor ikke mellem udbyderne.
const otherProviderKinds = ['azure', 'compatible', 'openai', 'zen', 'openrouter'];
function providerCard(kind) {
  const item = providerCards.find(entry => entry.kind === kind) || { kind, name: kind, text: '' };
  const card = node('button', undefined, 'provider-card'); card.type = 'button'; card.dataset.kind = item.kind;
  const logo = node('img'); logo.src = window.ProviderBrand.asset(item.kind) || ''; logo.alt = ''; logo.width = 28; logo.height = 28;
  const status = node('small'); status.dataset.providerStatus = item.kind;
  card.append(logo, node('strong', item.name), node('span', item.text), status);
  card.onclick = () => chooseProvider(item.kind);
  // Forhåndsvisning: panelet viser den udbyder, musen hviler på, uden at vælge eller sende noget.
  const preview = value => { previewKind = value; updateSetupStatus(); };
  card.onpointerenter = () => preview(item.kind); card.onfocus = () => preview(item.kind);
  card.onpointerleave = () => preview(''); card.onblur = () => preview('');
  return card;
}
function renderProviderCards() {
  $('#provider-cards').replaceChildren(...featuredProviders.map(item => providerCard(item.kind)));
  $('#provider-other-cards').replaceChildren(...otherProviderKinds.map(providerCard));
  updateProviderStatuses();
}
$('#provider-more').onclick = () => {
  $('#provider-other-cards').hidden = false; $('#provider-more').hidden = true;
  $('#provider-other-cards').querySelector('.provider-card')?.focus();
};
function setupProvider(connection) {
  $('#connection-form').reset(); $('#connection-id').value = connection?.id || ''; $('#connection-feedback').textContent = '';
  $('#connection-form').classList.remove('all-providers'); renderProviderCards();
  $('#provider-kind').value = connection?.kind || 'anthropic'; updateProvider();
  $('.key-guide').open = false; setupPage('provider');
  if (connection) { chooseProvider(connection.kind); fillConnection(connection); }
  else providerPicker();
}
function renderSetup() {
  const previous = $('#setup-connection').value || preferredConnection;
  $('#setup-connection').replaceChildren(option('', 'Vælg forbindelse'), ...(state?.connections || []).map(c => option(c.id, c.name)));
  if (state?.connections.some(c => c.id === previous)) $('#setup-connection').value = previous;
  else verifiedConnection = '';
  $('#setup-use-saved').hidden = !state?.connections.length;
  $('#setup-saved-hint').textContent = state?.connections.length === 1 ? state.connections[0].name : 'Vælg blandt dine gemte forbindelser.';
  if (!verifiedConnection) $('#setup-ai').textContent = $('#setup-connection').value ? 'Gemt opsætning · endnu ikke kontrolleret i denne session.' : 'Tilføj en forbindelse, eller fortsæt uden AI.';
  setupControls();
}
async function setupGit() {
  $('#setup-git-refresh').disabled = true;
  try { const result = await call('setupStatus'); $('#setup-git').textContent = result.git; $('#setup-git-open').hidden = !result.project || !featureOn('versioner'); }
  finally { $('#setup-git-refresh').disabled = false; }
}
function showSetup(reason = '', fromIntroduction = false) {
  guidedSetup = fromIntroduction; document.body.classList.toggle('setup-guided', fromIntroduction);
  setupActive = true; $('#setup').hidden = false; $('#workspace').hidden = true; $('#onboarding').hidden = true;
  $('#view-title').textContent = 'Opsætning'; $('#setup-reason').textContent = reason; $('#setup-reason').hidden = !reason;
  renderSetup(); setupPage('choice'); action(discoverLocal);
}
function connectionFailed(reason) {
  invalidateConnection($('#connection-select').value, reason);
  verifiedConnection = ''; ++setupGeneration; acceptedFingerprint = null; pendingSend = null; setupControls();
  if (state?.connections.some(c => c.id === $('#connection-select').value)) $('#setup-connection').value = $('#connection-select').value;
  recovery = `AI-forbindelsen skal gennemgås: ${reason} Dit projekt og din kladde er bevaret.`;
  if (!running) { showConnectionWarning(recovery); recovery = ''; }
}
async function leaveSetup(useAI) {
  const choosingFeatures = setupStep.startsWith('features');
  const id = $('#setup-connection').value;
  // Forbindelsen er kontrolleret før spørgsmålet om funktioner, så et valg dér fører altid videre.
  if (choosingFeatures) useAI = pendingAI;
  else {
    if (useAI && (!id || verifiedConnection !== id)) return;
    if (useAI) { preferredConnection = id; try { localStorage.setItem('harness.preferredConnection', id); } catch {} }
  }
  // Første gang spørger appen, hvad den skal hjælpe med, før projektet oprettes. Vælg senere beholder standarden: alle funktioner.
  if (guidedSetup && !repeatSetup && !choosingFeatures && !state?.features?.chosen) { pendingAI = useAI; setupPage('features'); return; }
  const returningToConnections = Boolean(repeatSetup);
  autoConnect = returningToConnections && !useAI ? repeatSetup.autoConnect : useAI;
  repeatSetup = null;
  ++setupGeneration; ++localDiscoveryGeneration; moveConnectionForm(false);
  guidedSetup = false; completeIntroduction('guided');
  document.body.classList.remove('setup-guided'); setupActive = false; $('#setup').hidden = true; $('#workspace').hidden = !current; $('#onboarding').hidden = Boolean(current);
  $('#view-title').textContent = current ? 'Arbejdsområde' : 'Projektopstart'; setupControls();
  if (useAI && current) { const saved = $('#connection-select').value === id ? { modelID: $('#model-select').value, routeID: $('#route-select').value } : {}; $('#connection-select').value = id; await loadModels(saved); }
  applyFeatures();
  (current ? $('#prompt') : $('#purpose')).focus();
  if (returningToConnections && !useAI) $('#connections-button').click();
}
$('#setup-local').onclick = () => action(() => leaveSetup(false));
$('#setup-add-another').onclick = () => setupProvider();
$('#setup-continue').onclick = () => action(() => leaveSetup(true));
$('#setup-manage').onclick = () => $('#connections-button').click();
$('#setup-git-refresh').onclick = () => action(setupGit);
$('#setup-git-open').onclick = () => $('#git-button').click();
$('#setup-connection').onchange = () => { ++setupGeneration; verifiedConnection = ''; $('#setup-ai').textContent = 'Forbindelsen er ikke kontrolleret.'; setupControls(); };
function catalogMessage(id, models) {
  const featured = featuredProviders.some(item => item.kind === state.connections.find(c => c.id === id)?.kind);
  return models[0]?.configuredDeployment ? 'Adgangen svarer. Dit deployment afprøves først, når du sender en opgave.' : !models.length ? 'Forbindelsen svarer uden modeller. Tjek adgangen hos udbyderen, eller ret oplysningerne.' : featured ? 'Forbindelsen virker. Appen starter med udbyderens eget udgangspunkt, som du kan skifte under skrivefeltet.' : 'Forbindelsen svarer. Du vælger model i projektet.';
}
async function testSetupConnection() {
  const id = $('#setup-connection').value, generation = ++setupGeneration;
  verifiedConnection = ''; setupControls(); $('#setup-test').disabled = true; $('#setup-ai').textContent = 'Henter modelkatalog fra den valgte server …';
  try {
    const models = await checkedModels(id);
    if (generation !== setupGeneration || id !== $('#setup-connection').value) return;
    verifiedConnection = models.length ? id : '';
    $('#setup-ai').textContent = catalogMessage(id, models);
    if (models.length) $('#setup-subtitle').textContent = 'Forbindelsen er gemt.';
  } catch (error) { if (generation === setupGeneration) $('#setup-ai').textContent = `Kontrollen mislykkedes: ${error.message} Rediger forbindelsen, eller prøv igen.`; }
  finally { if (generation === setupGeneration) setupControls(); }
}
$('#setup-test').onclick = () => action(testSetupConnection);
$('#setup-use-saved').onclick = () => { setupPage('saved'); if (!$('#setup-connection').value && state.connections.length === 1) $('#setup-connection').value = state.connections[0].id; setupControls(); };
$('#setup-advanced').onclick = () => { setupPage('tools'); action(setupGit); };
$('#setup-edit').onclick = () => setupProvider(state.connections.find(c => c.id === $('#setup-connection').value));
$('#setup-local-address').onclick = () => { setupProvider(); chooseProvider('ollama'); };
function showAssets(assets) {
  $('#assets').replaceChildren();
  for (const asset of assets) {
    const item = node('li', `${asset.kind === 'logo' ? 'Logo' : 'Reference'}: ${asset.name} `);
    const button = node('button', 'Fjern', 'text-button'); button.type = 'button';
    button.addEventListener('click', () => action(async () => showAssets(await call('removeAsset', asset.id))));
    item.append(button); $('#assets').append(item);
  }
}
const previewFrames = new Map(); const previewRevisions = new Map();
function usePreviewContext(context) {
  if (!current || !context) return;
  const root = context.workspaceRoot || current.root;
  let frame = previewFrames.get(root);
  if (!frame) { frame = previewFrames.size ? node('iframe', undefined, 'preview-frame') : ($('#preview') || node('iframe', undefined, 'preview-frame')); frame.title = 'Dit projekts lokale forhåndsvisning'; previewFrames.set(root, frame); if (!frame.isConnected) $('#preview-stage').append(frame); }
  for (const other of previewFrames.values()) { other.removeAttribute('id'); other.hidden = other !== frame; other.inert = other !== frame; }
  frame.id = 'preview'; frame.hidden = false; frame.dataset.root = root;
  if (current.workspaceRoot) previewRevisions.set(current.workspaceRoot, revision);
  current.workspaceRoot = root; current.isolated = Boolean(context.isolated); revision = previewRevisions.get(root) || null;
  if (state && 'copy' in context) state.copy = context.copy;
  $('#workspace-scope').hidden = !context.isolated; $('#copy-notice').hidden = !context.isolated;
  $('#copy-path').textContent = root;
  $('#copy-omissions').textContent = state?.copy?.omissions?.length ? `Udeladt af kopien: ${state.copy.omissions.slice(0, 8).join(', ')}. Nøgler og Git-historik kopieres ikke.` : 'Nøgler, Git-historik og symbolske links kopieres ikke. Ændringer gennemgås før indfletning.';
  showPreview(context.previewURL, context.previewExternal); window.previewServer?.update(context.runtime); window.previewLayout?.();
}
function showPreview(url, external = false) {
  if (current) { current.previewURL = url; current.previewExternal = Boolean(url && external); }
  $('#preview-stage').hidden = !url; $('#preview').hidden = !url; $('#preview-empty').hidden = Boolean(url);
  // Hver statisk forhåndsvisning har sin egen aura-preview-origin, adskilt fra
  // appens harness-origin. Den må derfor bruge sit eget lokale lager.
  $('#preview').setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  if (url) { if ($('#preview').getAttribute('src') !== url) $('#preview').src = url; } else $('#preview').removeAttribute('src');
  $('#preview-status').textContent = url ? (external ? 'Tilsluttet lokal server' : 'Lokal forhåndsvisning') : 'Ingen forhåndsvisning';
  window.previewEdit?.onPreview();
}
async function displayProject(project, { firstTask = false } = {}) {
  if (!project) return;
  const request = ++projectDisplayRequest;
  window.harness.selectContext?.({ root: project.root, chat: project.workbench.chat });
  ++modelRequest; recovery = ''; $('#connection-warning').hidden = true; document.body.classList.remove('setup-guided'); setupActive = false; $('#setup').hidden = true; setupControls();
  modelCatalog = []; $('#model-shortlist').replaceChildren(); $('#work-mode').value = 'chat'; updateWorkMode();
  if (current?.workspaceRoot) previewRevisions.set(current.workspaceRoot, revision);
  current = project; revision = null; acceptedFingerprint = null;
  window.dispatchEvent(new CustomEvent('aura:project', { detail: { root: project.root } }));
  // Projekter beholder samtaler, godkendelser og forhåndsvisning i baggrunden.
  const known = views.has(project.workbench.chat);
  mountView(viewFor(project.workbench.chat));
  if (firstTask) view.firstProjectTask = true;
  try { localStorage.setItem(lastProjectKey, project.root); } catch {}
  $('#idea-options').open = false; for (const el of document.querySelectorAll('#idea-options select')) el.value = '';
  $('#new').removeAttribute('aria-current'); $('#view-title').textContent = 'Arbejdsområde';
  $('#onboarding').hidden = true; $('#workspace').hidden = false; $('#skills-button').disabled = false;
  $('#project-name').textContent = project.name; $('#project-purpose').textContent = project.purpose || 'Eksisterende mappe. Beskriv din opgave i samtalen.'; $('#project-path').textContent = project.root;
  $('#reference-choices').replaceChildren();
  for (const asset of (project.assets || []).filter(a => a.kind === 'reference')) {
    const label = node('label', undefined, 'check-label'); const input = node('input'); input.type = 'checkbox'; input.value = asset.file;
    label.append(input, document.createTextNode(asset.name)); $('#reference-choices').append(label);
  }
  if (!$('#reference-choices').children.length) $('#reference-choices').textContent = 'Ingen referencefiler registreret i projektet.';
  $('#task-dialog .reference-choice').hidden = !(project.assets || []).some(a => a.kind === 'reference');
  usePreviewContext(project.workbench.preview || project);
  window.previewServer?.update(project.runtime);
  if (project.warnings?.length) message(project.warnings.join(' '));
  state = project.workbench; $('#connection-select').value = ''; renderConnections(); applyFeatures();
  const saved = state.projectSettings.selection;
  const startup = state.projectSettings.startup;
  const preferredProjectConnection = saved?.connectionID || startup?.connectionID;
  const unavailableSelection = Boolean(preferredProjectConnection && !state.connections.some(c => c.id === preferredProjectConnection));
  const retiredSelection = (state.retiredConnections || []).some(c => c.id === preferredProjectConnection);
  if (autoConnect && preferredProjectConnection && !unavailableSelection) { $('#connection-select').value = preferredProjectConnection; await loadModels(saved || {}); }
  else if (!preferredProjectConnection && autoConnect && state.connections.some(c => c.id === preferredConnection)) { $('#connection-select').value = preferredConnection; await loadModels(); }
  if (request !== projectDisplayRequest || current !== project) return;
  if (!$('#connection-select').value && preferredProjectConnection && state.connections.some(c => c.id === preferredProjectConnection)) $('#connection-select').value = preferredProjectConnection;
  $('#project-startup').textContent = startup ? `Hostingønske: ${hostingLabel(startup.hosting)} · Tests: ${testLabel(startup.tests)}` : 'Ingen opstartsvalg gemt for dette projekt.';
  $('#model-options').open = !$('#model-select').value; $('#start-idea').textContent = project.purpose ? 'Forbered første besked' : 'Beskriv din idé'; updateModelSummary();
  if (saved && state.connections.some(c => c.id === saved.connectionID) && !$('#model-select').value) {
    $('#connection-select').value = saved.connectionID; $('#model-select').replaceChildren(option(saved.modelID, saved.modelID));
    if (saved.routeID) { $('#route-row').hidden = false; $('#route-select').replaceChildren(option(saved.routeID, saved.routeID)); }
    updateModelSummary(); $('#model-options').open = false;
  }
  fillChat(state, !known);
  if (unavailableSelection) showConnectionWarning(retiredSelection ? 'komplai bruges nu kun til udgivelse. Vælg en anden AI for at fortsætte samtalen. Dit projekt og din kladde er bevaret.' : 'Den gemte AI-forbindelse er ikke tilgængelig. Vælg en anden AI for at fortsætte samtalen. Dit projekt og din kladde er bevaret.');
  await refreshRecent();
  if (request !== projectDisplayRequest || current !== project) return;
  await window.workspace?.onProject();
  window.versions?.refreshStatus();
  $('#project-name').tabIndex = -1; if (!setupActive) $('#project-name').focus();
}
// Den åbne samtales indhold: beskeder, kladde, arbejdsmåde, plan og besked om en afbrudt opgave. fresh betyder, at
// beskederne skal vises fra den gemte samtale; ellers står de allerede i samtalens visning.
function fillChat(next, fresh) {
  const history = next.workspace, v = view;
  // En tom visning, som en hændelse oprettede, før samtalen blev åbnet, skal også hente de gemte beskeder og planen.
  fresh = window.HistoryPages.needsRestore(fresh, v);
  if (fresh) {
    // Kun den nyeste side tegnes; ældre beskeder hentes med knappen over samtalen.
    const page = window.HistoryPages.takePrevious(history?.messages || []);
    Object.assign(v, { historyPending: page.older, historyLoaded: true, historyNotice: '' });
    for (const item of page.recent) storedMessage(item, v);
  }
  renderHistoryControls();
  const empty = !v.log.children.length;
  $('#project-intro').hidden = !empty; $('#start-idea').hidden = !empty;
  $('#resume-notice').hidden = !history?.messages?.length && !next.historyWarning; $('#resume-notice').open = false;
  $('#include-history').checked = false;
  if (fresh) v.planOffer = history?.planOffer === true;
  if (fresh) { v.plan = next.plan || null; v.planCard = Boolean(next.plan) && ['chat', 'plan'].includes(history?.mode); }
  updatePlanOffer(v);
  activePlan = v.plan; $('#plan-card').hidden = !v.planCard || !v.plan;
  $('#work-mode').value = v.firstProjectTask ? 'free' : 'chat';
  $('#prompt').value = '';
  if (history) {
    $('#prompt').value = history.draft || '';
    if (history.messages.length || history.draft) $('#work-mode').value = history.mode === 'build' && !next.plan ? defaultMode() : history.mode;
    $('#resume-notice summary').textContent = ['interrupted', 'working'].includes(history.status) && !v.running ? 'Den forrige opgave blev afbrudt' : 'Tidligere samtale';
    $('#resume-text').textContent = ['interrupted', 'working'].includes(history.status) && !v.running ? 'Den forrige opgave blev afbrudt. Gennemgå filerne, før du fortsætter. Intet er genstartet.' : 'Din samtale er hentet fra denne computer. Hos samme AI kan samtalen fortsætte med tidligere beskeder og værktøjsresultater. Start Ny samtale for et nyt forløb. Du kan også vælge at medsende en ekstra kopi, fx ved skift af AI.';
    if (history.trimmed) $('#resume-text').textContent += ' Den ældste del af samtalen er udeladt af hensyn til størrelse.';
  }
  if (next.historyWarning) $('#resume-text').textContent = next.historyWarning;
  // Kladden: det, der står i skrivefeltet i denne samtale, også hvis den ikke nåede at blive gemt.
  // Før samtalerne havde projektet én lokal kladde; den flyttes én gang til den samtale, der åbnes først.
  try { const key = `harness.chatDraft.${current.root}`, legacy = localStorage.getItem(key); if (legacy !== null) { if (localStorage.getItem(`${key}.${v.id}`) === null) localStorage.setItem(`${key}.${v.id}`, legacy); localStorage.removeItem(key); } } catch {}
  try { const draft = JSON.parse(localStorage.getItem(`harness.chatDraft.${current.root}.${v.id}`)); if (draft && typeof draft.text === 'string' && (draft.text || !['working','interrupted'].includes(history?.status))) { $('#prompt').value = draft.text; if (['chat','plan','free'].includes(draft.mode)) { $('#work-mode').value = draft.mode; v.modeChosen = true; } } } catch {}
  if (v.draft) { $('#prompt').value = v.draft.text; if (['chat','plan','free','build'].includes(v.draft.mode)) $('#work-mode').value = v.draft.mode; }
  v.contextUsage = next.contextUsage || null;
  window.chatMaterials?.sync();
  renderUsage(v.usage || next.usage);
  updateWorkMode(); $('#draft-status').textContent = history?.draft ? 'Kladde hentet fra denne computer' : '';
  updateStartIdea(); applyRunning();
  window.planning?.onProject(next);
}
// Skift til en anden samtale i samme projekt. En samtale, der arbejder, fortsætter i baggrunden.
async function showChat(next) {
  if (!next?.chat) return;
  ++projectDisplayRequest;
  window.harness.selectContext?.({ root: current?.root, chat: next.chat });
  state = next;
  const known = views.has(next.chat);
  mountView(viewFor(next.chat));
  fillChat(next, !known);
  usePreviewContext(next.preview);
  window.workspace?.clearReferences();
  await window.workspace?.onChat?.();
  window.chats?.render();
  if (view.followChat) $('#chat-content').scrollTop = $('#chat-content').scrollHeight;
}
// Forbindelser bliver gemt hver for sig. Kontrolstatus gælder kun katalogkald i denne appsession.
let editingConnection = '', connectionPage = 0, checkingConnections = false, repeatSetup = null;
const connectionChecks = ConnectionOverview.tracker();
function invalidateConnection(id, detail) {
  if (!state?.connections.some(c => c.id === id)) return;
  const check = connectionChecks.begin(id);
  connectionChecks.finish(id, check, { status: 'error', detail });
  updateConnectionChecks();
}
function checkLabel(id) {
  const check = connectionChecks.get(id);
  if (!check) return 'Ikke kontrolleret';
  if (check.status === 'checking') return 'Kontrollerer …';
  if (check.status === 'error') return 'Ikke forbundet';
  const time = new Date(check.checkedAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  return check.count ? `Forbundet · kontrolleret ${time}` : 'Ingen modeller i kataloget';
}
function updateConnectionChecks() {
  for (const el of document.querySelectorAll('[data-connection-status]')) {
    el.textContent = checkLabel(el.dataset.connectionStatus);
    const check = connectionChecks.get(el.dataset.connectionStatus);
    el.dataset.state = check?.status === 'ok' && check.count ? 'connected' : check?.status || 'unchecked';
    el.title = check?.detail || 'Forbindelsen er gemt, men endnu ikke kontrolleret efter appstart.';
  }
  updateProviderStatuses();
}
function updateProviderStatuses() {
  for (const el of document.querySelectorAll('[data-provider-status]')) {
    const connections = (state?.connections || []).filter(c => c.kind === el.dataset.providerStatus);
    const connected = connections.filter(c => { const check = connectionChecks.get(c.id); return check?.status === 'ok' && check.count; }).length;
    const failures = connections.filter(c => connectionChecks.get(c.id)?.status === 'error').length;
    el.textContent = !connections.length ? 'Ikke tilføjet' : connected ? `${connected} af ${connections.length} forbundet` : failures === connections.length ? 'Ikke forbundet' : `${connections.length} gemt · ikke kontrolleret`;
    el.dataset.state = connected === connections.length && connected ? 'connected' : failures === connections.length && failures ? 'error' : 'unchecked';
    el.title = connections.map(c => `${c.name}: ${checkLabel(c.id)}`).join('\n');
  }
}
function renderConnectionList() {
  const retired = state.retiredConnections || [];
  const connections = [...state.connections, ...retired];
  const result = ConnectionOverview.page(connections, state.definitions, $('#connections-search').value, connectionPage);
  $('#retired-connections-notice').hidden = !retired.length;
  connectionPage = result.index;
  $('#saved-connections').replaceChildren(...result.items.map(connection => {
    const row = node('div', undefined, 'saved-connection'), text = node('span');
    const isRetired = retired.some(item => item.id === connection.id);
    text.append(node('strong', connection.name), node('small', isRetired ? 'komplai · tidligere AI-forbindelse' : state.definitions[connection.kind]?.name || connection.kind));
    if (isRetired) {
      const remove = node('button', connection.account?.authMethod === 'token' ? 'Fjern fra Aura' : 'Log ud og fjern', 'text-button danger');
      remove.type = 'button'; remove.setAttribute('aria-label', `${remove.textContent}: ${connection.name}`);
      remove.title = connection.account?.authMethod === 'token' ? 'Fjerner det gemte token fra Aura. Tokenet kan stadig bruges i andre programmer.' : 'Tilbagekalder den gamle AI-adgang og fjerner forbindelsen. komplai Run bevares.';
      remove.onclick = () => action(async () => { remove.disabled = true; try { await removeSavedConnection(connection.id); $('#connections-search').focus(); } finally { remove.disabled = false; } });
      row.append(text, remove); return row;
    }
    const status = node('small'); status.dataset.connectionStatus = connection.id; text.append(status);
    const edit = node('button', 'Åbn', 'text-button'); edit.type = 'button'; edit.setAttribute('aria-label', `Åbn ${connection.name}`);
    edit.onclick = () => editConnection(connection);
    row.append(text, edit); return row;
  }));
  if (!result.total) $('#saved-connections').append(node('p', connections.length ? 'Ingen forbindelser passer til søgningen.' : 'Ingen forbindelser endnu.', 'hint'));
  $('#connections-pages').hidden = result.pages === 1;
  $('#connections-page').textContent = `${result.index + 1} af ${result.pages}`;
  $('#connections-prev').disabled = !result.index; $('#connections-next').disabled = result.index === result.pages - 1;
  $('#connections-check').disabled = checkingConnections || !state.connections.length;
  updateConnectionChecks();
}
function renderConnections() {
  const previous = $('#connection-select').value;
  $('#connection-select').replaceChildren(option('', 'Vælg forbindelse'), ...state.connections.map(c => option(c.id, c.name)));
  renderConnectionList();
  if (state.connections.some(c => c.id === previous)) $('#connection-select').value = previous;
  else { $('#model-select').replaceChildren(option('', 'Hent modeller fra forbindelsen')); $('#route-row').hidden = true; }
  renderSetup(); renderStartupConnections();
}
$('#connections-search').oninput = () => { connectionPage = 0; renderConnectionList(); };
$('#connections-prev').onclick = () => { --connectionPage; renderConnectionList(); };
$('#connections-next').onclick = () => { ++connectionPage; renderConnectionList(); };
function catalogResult(models) {
  const detail = models[0]?.configuredDeployment ? `Adgangen svarer. Deploymentet ${models[0].id} afprøves først, når du sender en opgave.` : models.length ? `${models.length} ${models.length === 1 ? 'model' : 'modeller'} i kataloget. Kodearbejde og ledig kvote er ikke afprøvet.` : 'Forbindelsen svarer uden modeller. Tjek adgangen hos udbyderen.';
  return { status: 'ok', count: models.length, deployment: Boolean(models[0]?.configuredDeployment), detail };
}
async function checkedModels(id) {
  const check = connectionChecks.begin(id); updateConnectionChecks();
  try {
    const models = await call('models', id);
    connectionChecks.finish(id, check, catalogResult(models));
    return models;
  } catch (error) {
    connectionChecks.finish(id, check, { status: 'error', detail: error.message });
    throw error;
  } finally { updateConnectionChecks(); }
}
async function checkConnection(id) {
  try { return catalogResult(await checkedModels(id)); }
  catch (error) { return { status: 'error', detail: error.message }; }
}
$('#connections-check').onclick = () => action(async () => {
  if (checkingConnections) return;
  checkingConnections = true; renderConnectionList(); $('#connections-feedback').textContent = 'Henter modelkataloger …';
  const queue = state.connections.map(c => c.id), total = queue.length; let successful = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(2, total) }, async () => {
      while (queue.length) { const result = await checkConnection(queue.shift()); if (result?.status === 'ok' && result.count) ++successful; }
    }));
    $('#connections-feedback').textContent = `${successful} af ${total} forbindelser svarer med modeller. Ingen AI-opgave er sendt.`;
  } finally { checkingConnections = false; renderConnectionList(); }
});
function connectionView(view) {
  $('#connections-list').hidden = view !== 'list'; $('#connection-edit').hidden = view !== 'edit';
  $('#connections-heading').textContent = view === 'edit' ? 'Din forbindelse' : 'AI-forbindelser';
}
function fillConnection(connection) {
  $('#connection-name').value = connection.name; $('#base-url').value = connection.baseURL;
  $('#azure-endpoint').value = connection.kind === 'azure' ? connection.baseURL : '';
  $('#azure-deployment').value = connection.deployment || ''; $('#azure-protocol').value = connection.protocol || 'responses';
}
function editConnection(connection) {
  moveConnectionForm(false); editingConnection = connection.id;
  $('#connection-form').reset(); $('#connection-id').value = connection.id; $('#provider-kind').value = connection.kind; updateProvider(); fillConnection(connection);
  $('#clear-key').checked = false;
  $('#connection-feedback').textContent = connectionChecks.get(connection.id)?.detail || ''; connectionView('edit');
  $('#connection-use').disabled = projectLoading;
  $('#connection-use').focus();
}
$('#connection-back').onclick = () => { connectionView('list'); renderConnectionList(); $('#connections-search').focus(); };
$('#connection-add').onclick = () => { $('#connections-dialog').close(); showSetup(); };
$('#connections-setup').onclick = () => {
  repeatSetup = { autoConnect }; $('#connections-dialog').close(); showSetup('', true);
};
$('#connection-use').onclick = () => action(async () => {
  const id = editingConnection;
  preferredConnection = id; try { localStorage.setItem('harness.preferredConnection', id); } catch {}
  $('#connections-dialog').close();
  if (current) {
    const saved = $('#connection-select').value === id ? { modelID: $('#model-select').value, routeID: $('#route-select').value } : {};
    $('#connection-select').value = id; autoConnect = true; openTaskSettings(); await loadModels(saved);
  } else { renderStartupConnections(); $('#startup-connection').value = id; autoConnect = true; updateStartupSummary(); message('Forbindelsen er valgt. Beskriv det, du vil bygge.'); }
});
$('#connection-test').onclick = () => action(async () => {
  const id = editingConnection; $('#connection-test').disabled = true; $('#connection-feedback').textContent = 'Kontrollerer den gemte forbindelse …';
  try { const result = await checkConnection(id); if (result && !setupActive && id === $('#connection-id').value) $('#connection-feedback').textContent = result.detail; }
  finally { $('#connection-test').disabled = false; }
});
async function removeSavedConnection(id) {
  const selected = $('#connection-select').value;
  state = await call('removeConnection', id); connectionChecks.clear(id); ++setupGeneration; verifiedConnection = ''; acceptedFingerprint = null; renderConnections();
  connectionView('list'); $('#connections-feedback').textContent = 'Forbindelsen er fjernet.';
  if (current && selected === id) connectionFailed('Den valgte forbindelse er fjernet.');
}
$('#connection-remove').onclick = () => action(() => removeSavedConnection(editingConnection));
// Trin for trin til en nøgle hos de tre udbydere i opsætningen. Knapperne åbner faste sider via hovedprocessen. Kontrolleret 29. september 2026.
const keyGuides = {
  openai: { steps: [['Åbn din OpenAI API-konto.', 'start', 'Åbn'], ['Opret en API-nøgle.', 'keys', 'Åbn'], ['Indsæt nøglen herunder.']], cost: 'OpenAI API afregnes separat fra et ChatGPT-abonnement. Prisen afhænger af model og tokenforbrug.' },
  azure: { steps: [['Åbn dit projekt i Microsoft Foundry.', 'start', 'Åbn'], ['Kopiér serveradresse, API-nøgle og deployment-navn.'], ['Indsæt oplysningerne her.']] },
  anthropic: {
    steps: [['Opret en konto i Claude Console.', 'start', 'Åbn', 'Claude Console er Anthropics side for udviklere og ikke det samme som Claude.ai. Anthropic kan spørge til din brug og i nogle tilfælde bede om ID.'],
      ['Køb kredit under Billing.', 'billing', 'Åbn', 'Du betaler forud med kort.'],
      ['Sæt en månedlig grænse.', null, null, 'Under Spend limits på siden Billing, så forbruget ikke kan løbe løbsk.'],
      ['Opret en API-nøgle, og kopiér den.', 'keys', 'Åbn', 'Nøglen vises kun én gang.'],
      ['Indsæt den herunder.']],
    cost: 'Du ser modtager og pris for modellen, før noget sendes, og forbruget under skrivefeltet.'
  },
  mistral: {
    steps: [['Opret en konto i Mistral Studio.', 'start', 'Åbn', 'På mistral.ai hedder det Login › Studio. Gratisplanen kræver ikke kort, men Mistral må bruge data fra gratisplanen til træning.'],
      ['Slå betalt forbrug til, og sæt en månedlig grænse.', 'billing', 'Åbn', 'Under Billing.'],
      ['Fravælg træning.', 'privacy', 'Åbn', 'Under Privacy.'],
      ['Opret en API-nøgle, og kopiér den.', 'keys', 'Åbn', 'Nøglen vises kun én gang.'],
      ['Indsæt den herunder.']],
    cost: 'Du betaler, når gratisplanens kredit er brugt. Du ser modtager og pris for modellen, før noget sendes, og forbruget under skrivefeltet.'
  },
  corti: {
    steps: [['Opret en konto i Corti Console.', 'start', 'Åbn', 'Brug din arbejdsmail.'],
      ['Opret et projekt i regionen EU.', 'console', 'Åbn', 'Et nyt projekt giver 50 USD i prøvekredit.'],
      ['Sæt en månedlig grænse.', null, null, 'Under Billing i Corti Console.'],
      ['Hent en API-nøgle under Corti Models, og kopiér den.', 'keys', 'Åbn'],
      ['Indsæt den herunder.']],
    cost: 'Du betaler, når prøvekreditten er brugt. Du ser modtager og pris for modellen, før noget sendes, og forbruget under skrivefeltet.'
  },
  alexandra: {
    steps: [['Opret en konto på Alexandra AI Platform.', 'start', 'Åbn', 'Alexandra Instituttets AI-platform med behandling i Danmark.'],
      ['Opret en API-nøgle under API-nøgler, og kopiér den.', 'keys', 'Åbn', 'Selve nøglen vises kun, når du opretter den. Der findes personlige og organisationsejede nøgler.'],
      ['Sæt en månedlig forbrugsgrænse under Fakturering.', 'billing', 'Åbn', 'Grænsen gælder også beløb, der er reserveret til igangværende kald.'],
      ['Indsæt nøglen herunder.']],
    cost: 'Platformen kræver saldo eller kredit hos Alexandra. Priserne er i DKK pr. million tokens. Du ser modtager og pris for modellen, før noget sendes, og forbruget under skrivefeltet.'
  }
};
// Trin i almindeligt dansk: én kort linje, en knap til udbyderens side og uddybning bag ⓘ.
function renderKeyGuide(kind) {
  const guide = keyGuides[kind];
  $('#key-steps').replaceChildren(...(guide?.steps || []).map(([text, page, label, more]) => {
    const item = node('li', text);
    if (more) item.append(info(text.replace(/\.$/, '').toLocaleLowerCase('da'), more));
    if (page) { const button = node('button', label, 'text-button'); button.type = 'button'; button.setAttribute('aria-label', `${label}: ${text}`); button.onclick = () => action(() => call('providerAccount', { kind, page })); item.append(' ', button); }
    return item;
  }));
  $('#key-steps').hidden = !guide;
  $('#cost-info').dataset.info = guide?.cost || 'Du ser modtager og pris for modellen, før noget sendes, og forbruget under skrivefeltet.';
  $('#provider-account').hidden = Boolean(guide);
  $('#key-guide-summary').textContent = guide ? 'Har du ikke en nøgle? Sådan får du en' : 'Hvor finder jeg min nøgle?';
}
function updateProvider() {
  const definition = state?.definitions[$('#provider-kind').value]; if (!definition) return;
  const help = { openai: 'Brug en OpenAI API-nøgle. Den afregnes separat fra dit ChatGPT-abonnement.', azure: 'Brug API-nøglen og deployment-navnet fra din Azure OpenAI- eller Foundry-ressource.', corti: 'Du skal bruge en nøgle fra Corti Models i et projekt i EU, EU-S eller Frankrig. Appen skifter aldrig automatisk til USA eller en anden model.', alexandra: 'Du skal bruge en API-nøgle fra Alexandra AI Platform. Appen bruger kun platformens egen adresse i Danmark. Adgangen til den enkelte model styres af din organisation.', mistral: 'Du skal bruge en API-nøgle fra Mistral.', anthropic: 'Du skal bruge en API-nøgle fra Anthropic. Et Claude Pro- eller Max-abonnement kan ikke bruges her.', openrouter: 'Brug din OpenRouter-nøgle. Du vælger selv model og den udbyder, der modtager dine data. Gratis modeller er markeret i listen.', zen: 'Brug en nøgle fra OpenCode Zen. Zens gratis modeller virker ikke i Aura, fordi Zen kun giver gratis adgang fra OpenCodes egne programmer. Zens modeller kører i USA.', ollama: 'Forbind til en Ollama-server, som allerede kører. Kontrollér adressen nedenfor; appen installerer ikke modeller.', compatible: 'Brug adressen fra din organisation eller egen modelserver. Serveren kan køre lokalt eller på jeres netværk.' };
  $('#provider-info').dataset.info = help[$('#provider-kind').value]; renderKeyGuide($('#provider-kind').value);
  $('.key-guide').hidden = ['ollama', 'compatible'].includes($('#provider-kind').value);
  const isAzure = $('#provider-kind').value === 'azure';
  $('#azure-fields').hidden = !isAzure; $('#azure-endpoint').required = isAzure; $('#azure-deployment').required = isAzure;
  $('#base-url').required = !isAzure;
  for (const el of [$('#base-url'), $('#base-url').previousElementSibling, $('#base-url-help').nextElementSibling]) el.hidden = isAzure;
  $('#base-url').value = definition.baseURL; $('#connection-advanced').open = ['ollama', 'compatible'].includes($('#provider-kind').value); $('#base-url').readOnly = !['ollama', 'compatible'].includes($('#provider-kind').value);
  if (!$('#connection-id').value) { const used = new Set((state?.connections || []).map(c => c.name)); let name = definition.name, number = 2; while (used.has(name)) name = `${definition.name} ${number++}`; $('#connection-name').value = name; }
  updateKeyRow(); updateSetupStatus();
}
// Nøglen indtastes i nøglevinduet. Formularen siger kun, om der er en gemt nøgle, og hvad næste skridt er.
function updateKeyRow() {
  const kind = $('#provider-kind').value, keyless = ['ollama', 'compatible'].includes(kind);
  const id = $('#connection-id').value, saved = id ? (state?.connections || []).find(c => c.id === id) : null;
  const hasKey = Boolean(saved?.hasKey);
  $('#key-row-label').textContent = keyless ? 'Nøgle, hvis serveren kræver en' : 'API-nøgle';
  $('#key-state').textContent = hasKey ? 'Nøglen er gemt krypteret på denne computer. Indtast en ny nøgle for at skifte den.'
    : keyless ? 'Serveren kræver normalt ingen nøgle. Kræver den en, indtaster du den i et separat vindue.'
    : 'Nøglen indtastes i et separat vindue og kontrolleres, før den gemmes. Hovedvinduet ser den aldrig.';
  $('#enter-key').textContent = hasKey ? 'Indtast ny nøgle' : 'Indtast nøgle';
  $('#clear-key-row').hidden = !hasKey;
  // En ny forbindelse hos en udbyder gemmes kun med en kontrolleret nøgle. Så er Indtast nøgle det eneste valg.
  const canSaveWithoutKey = Boolean(saved) || keyless;
  $('#save-connection').hidden = !canSaveWithoutKey;
  $('#save-connection').textContent = saved ? 'Gem forbindelse' : 'Gem uden nøgle';
  $('#save-connection').classList.toggle('primary', canSaveWithoutKey);
  $('#enter-key').classList.toggle('primary', !canSaveWithoutKey);
}
function connectionInput() {
  const kind = $('#provider-kind').value;
  return { id: $('#connection-id').value || undefined, kind, name: $('#connection-name').value, baseURL: kind === 'azure' ? $('#azure-endpoint').value : $('#base-url').value, deployment: $('#azure-deployment').value, protocol: $('#azure-protocol').value };
}
// Kataloget fra nøglevinduets kontrol af netop denne nøgle gælder som kontrollen, så der ikke kontrolleres to gange.
function recordCatalog(id, models) {
  const check = connectionChecks.begin(id);
  connectionChecks.finish(id, check, catalogResult(models));
  updateConnectionChecks();
}
async function loadModels(saved = {}) {
  const id = $('#connection-select').value; const generation = ++modelRequest; acceptedFingerprint = null;
  modelCatalog = []; $('#model-shortlist').replaceChildren(); $('#model-evidence').textContent = '';
  $('#model-select').replaceChildren(option('', id ? 'Henter modeller …' : 'Vælg en forbindelse først')); $('#route-row').hidden = true;
  updateModelSummary();
  if (!id) return;
  try {
    const models = await checkedModels(id); if (generation !== modelRequest) return;
    modelCatalog = models; $('#model-search').value = ''; renderShortlist();
    $('#model-select').replaceChildren(option('', 'Vælg model'));
    for (const model of models) {
      const free = model.price && model.price.prompt != null && model.price.completion != null && Number(model.price.prompt) === 0 && Number(model.price.completion) === 0;
      $('#model-select').append(option(model.id, `${model.name}${free ? ' · gratis*' : ''}`));
    }
    if (saved.modelID && models.some(m => m.id === saved.modelID)) { $('#model-select').value = saved.modelID; await loadRoutes(saved.routeID); }
    else preselectRecommended(id);
    markChosenModel(); updateModelSummary(); $('#connection-warning').hidden = true; $('#connection-status').textContent = state.connections.find(c => c.id === id)?.name || 'Ingen model valgt';
  } catch (error) { if (generation === modelRequest) { $('#model-select').replaceChildren(option('', 'Forbindelsen kunne ikke læses')); connectionFailed(error.message); } throw error; }
}
async function loadRoutes(saved = '') {
  acceptedFingerprint = null;
  const id = $('#connection-select').value, modelID = $('#model-select').value;
  const connection = state.connections.find(c => c.id === id); $('#route-row').hidden = connection?.kind !== 'openrouter';
  if (connection?.kind !== 'openrouter' || !modelID) return;
  const routes = await call('routes', { connectionID: id, modelID });
  if ($('#connection-select').value !== id || $('#model-select').value !== modelID) return;
  $('#route-select').replaceChildren(option('', 'Vælg udbyder – ingen automatisk routing'));
  for (const route of routes) $('#route-select').append(option(route.id, route.name));
  if (routes.some(route => route.id === saved)) $('#route-select').value = saved;
  renderContextUsage();
}
function selection() { return { text: $('#prompt').value.trim(), chatMaterials: window.chatMaterials?.selection() || null, effort: view?.effort || null, includeHistory: $('#include-history').checked, mode: $('#work-mode').value, planID: activePlan?.id, connectionID: $('#connection-select').value, modelID: $('#model-select').value, routeID: $('#route-select').value, references: [...document.querySelectorAll('#reference-choices input:checked')].map(el => el.value), fileRefs: window.workspace?.references() || [], previewTarget: window.workspace?.target()?.id || null, view: window.previewViewSize?.() || null, chat: view.id }; }
const detailLabels = { projectInstructions: 'Projektets egne regler, der sendes', rules: 'Fælles grundregler, der sendes', workspace: 'Arbejdsmappe', mode: 'Arbejdsmåde', brief: 'Projektbrief, der sendes', previewReferenceText: 'Valgt element, der sendes', conversation: 'Tidligere samtale, der sendes', projectGuidance: 'Appens vejledning om projektvalg og design', planContext: 'Plan og afklaring, der sendes', projectChoices: 'Projektets opstartsvalg', projectDesign: 'Projektets designvalg', fileReferences: 'Filhenvisninger i beskeden', connection: 'Forbindelse', model: 'Model', endpoint: 'Serveradresse', recipients: 'Modtagere', region: 'Behandlingssted', retention: 'Opbevaring', training: 'Brug til træning', price: 'Pris og gratisbegrænsninger', capabilities: 'Modelmuligheder', material: 'Hvad sendes?', references: 'Udvalgte private referencer', skills: 'Skills, AI’en kan hente', localStorage: 'Lokal historik og yderligere netværk', security: 'Forbindelsens sikkerhed', source: 'Kilde', checkedAt: 'Dokumentation kontrolleret', evidence: 'Grundlag' };
// Kort resumé i almindeligt dansk. Alle oplysninger ligger under "Se alle oplysninger".
// Modelstøtte: kun det, udbyderens katalog oplyser. Aura viser aldrig sine egne iagttagelser som prøver, og
// "ikke oplyst" er ikke det samme som understøttet. Efter forslag i #37.
// Appens egne instruktioner, som de sendes, ét fragment ad gangen med sin egen kontrolsum. Teksten ligger bag
// hver sin fold, så listen er til at overskue, og rækkevidden står først, så den ikke læses som hele modelkaldet.
function appendAppContext(appContext) {
  if (!appContext?.components?.length) return;
  const dd = node('dd'), list = node('div');
  list.append(node('p', appContext.scope, 'hint'));
  for (const part of appContext.components) {
    const fold = node('details');
    fold.append(node('summary', `${part.title} (${part.text.split(/\s+/).length} ord)`), node('pre', part.text), node('p', `Kontrolsum: ${part.hash}`, 'hint'));
    list.append(fold);
  }
  dd.append(list);
  $('#data-details').append(node('dt', 'Appens egne instruktioner, der sendes'), dd);
}
function appendModelSupport(support) {
  if (!support) return;
  const word = value => value === true ? 'understøttet' : value === false ? 'ikke understøttet' : 'ikke oplyst';
  const line = item => `Værktøjer: ${word(item.tools)} · Billeder: ${word(item.images)}`;
  const dd = node('dd');
  dd.append(node('p', line(support.model)));
  if (support.route) dd.append(node('p', `Valgt rute · ${line(support.route).toLocaleLowerCase('da-DK')}`));
  const read = support.checkedAt ? `Læst fra udbyderens katalog ${new Date(support.checkedAt).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Det vides ikke, hvornår kataloget sidst blev læst.';
  dd.append(node('p', `${read} Det er udbyderens egne oplysninger, ikke en prøve Aura har kørt.`, 'hint'));
  $('#data-details').append(node('dt', 'Modelstøtte ifølge udbyderen'), dd);
}
function showData(data, canSend) {
  $('#data-summary').replaceChildren();
  const unknown = [data.region, data.retention, data.training, data.price].filter(v => /ukendt|ikke verificeret/i.test(String(v)));
  $('#data-warning').hidden = !unknown.length;
  $('#data-warning').textContent = 'Nogle vilkår er ukendte for denne forbindelse. Del kun det, du er sikker på, at du må dele.';
  const hasPlan = Array.isArray(data.planContext) ? data.planContext.length > 0 : Boolean(data.planContext);
  const material = ['Din besked', data.brief ? 'projektbriefen' : '', hasPlan ? 'planen og afklaringen' : ''].filter(Boolean);
  $('#data-lead').textContent = `${material.join(', ')} og de projektfiler, AI’en læser, sendes til ${data.provider || data.connection}.`;
  // Den fortsatte agentsession kan allerede have historik. Tilvalget nedenfor er en ekstra kopi, ikke en kontakt til at slette AI'ens kontekst.
  $('#data-history-text').textContent = 'I denne samtale kan AI’en bruge tidligere beskeder og værktøjsresultater. Start Ny samtale for et nyt forløb.' + (data.historyIncluded ? ' En ekstra kopi af tidligere samtale medsendes efter dit tilvalg. Se indholdet under alle oplysninger.' : '');
  $('#data-history-text').hidden = false;
  // Filhenvisninger står i første lag, fordi de er nyt materiale, brugeren selv har valgt at dele.
  // Et valgt element står også i første lag: AI'en får elementets tekst, placering og et uddrag af sidens HTML.
  const shared = [data.fileReferences?.length ? `Filhenvisninger: ${data.fileReferences.join(', ')}. AI’en får stien og læser selv filen i projektet.` : '', data.previewReference ? `Valgt i forhåndsvisningen: ${data.previewReference}. AI’en får elementets tekst, placering og et uddrag af sidens HTML; se det under alle oplysninger.` : ''].filter(Boolean);
  $('#data-refs-text').textContent = shared.join(' ');
  $('#data-refs-text').hidden = !shared.length;
  for (const [label, value] of Object.entries({ 'AI': data.modelName ? `${data.modelName} · ${data.provider || data.connection}` : `${data.model} · ${data.connection}`, 'Hvor': data.regionShort || data.region, 'Træning': data.trainingShort || data.training, 'Pris': data.priceShort || data.price })) {
    $('#data-summary').append(node('dt', label), node('dd', Array.isArray(value) ? value.join(', ') : value));
  }
  // Alle oplysninger som korte rækker. Lange tekster, fx appens vejledning og planen, har hver sin fold.
  $('#data-details').replaceChildren();
  for (const [key, label] of Object.entries(detailLabels)) {
    const value = data[key];
    if (key === 'projectInstructions' && !value) continue;
    if (['fileReferences', 'brief', 'previewReferenceText'].includes(key) && !value?.length) continue;
    const text = key === 'mode' ? ({ chat: 'Samtale', plan: 'Planlæg', build: 'Byg den valgte plan', free: 'Byg' }[value]) : key === 'conversation' && !value ? 'Medsendes ikke. Den aktive samtale og en valgt plan indgår stadig.' : Array.isArray(value) ? value.join(', ') || 'Ingen' : value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || 'Ingen');
    const dd = node('dd');
    if (text.length > 160) { const fold = node('details'); fold.append(node('summary', `Vis (${text.split(/\s+/).length} ord)`), node('pre', text)); dd.append(fold); }
    else dd.textContent = text;
    $('#data-details').append(node('dt', label), dd);
  }
  appendModelSupport(data.modelSupport);
  appendAppContext(data.appContext);
  // Vedhæftningernes præcise indhold står i første lag, fordi det er nyt materiale, brugeren selv har valgt at dele.
  window.chatMaterials?.disclose(data.chatMaterials || null, data.imageNotice || '');
  $('#accept-send').hidden = !canSend; $('#data-dialog').showModal();
}
async function sendNow(data, text) {
  const v = view, owner = selectedOwner(); v.activityGroup = null; v.planCard = false; v.runConnection = $('#connection-select').value; v.historyNotice = ''; renderHistoryControls();
  v.runWorkMode = $('#work-mode').value;
  v.runContextSelection = { connectionID: $('#connection-select').value, modelID: $('#model-select').value, routeID: $('#route-row').hidden ? '' : $('#route-select').value };
  v.activeModelSummary = $('#model-chip').textContent;
  v.activeModelBrand = { kind: state?.connections.find(c => c.id === v.runConnection)?.kind, modelID: $('#model-select').value };
  $('#model-options').open = false; $('#task-dialog').close(); $('#connection-warning').hidden = true; $('#data-dialog').close(); setRunning(true, 'Starter agent …');
  if ($('#work-mode').value === 'free') { activePlan = null; $('#plan-card').hidden = true; }
  $('#run-review').hidden = true; if ($('#work-mode').value === 'build') $('#plan-card').hidden = true; if ($('#work-mode').value === 'plan') { activePlan = null; $('#plan-card').hidden = true; }
  Object.assign(v, { lastSentText: text, lastTarget: data.previewReference || '', lastTargetRef: window.workspace?.target() || null, lastCheckpoint: null, rejectedThisRun: false, lastRejection: null });
  appendMessage(text + (data.fileReferenceText || '') + (v.lastTarget ? `\n\nMål i forhåndsvisningen: ${v.lastTarget}` : ''), 'user', v); $('#prompt').value = ''; await saveChatDraft();
  const compact = v.compactNext === true; v.compactNext = false; v.effortLevels = data.effortLevels || [];
  try { await call('send', { text, fingerprint: data.fingerprint, contextBinding: data.contextBinding, chat: v.id, compact }, owner); if (view === v) { acceptedFingerprint = reviewKey(data); window.workspace?.clearReferences(); } }
  catch (error) { if (error.message === 'Opgaven blev stoppet før afsendelse.') { setRunning(false, 'Stoppet', v); return; } if (view === v) { $('#prompt').value = text; await saveChatDraft(); } setRunning(false, 'Fejl', v); renderRunReview({ status: 'error', files: [], tools: [], failure: { kind: 'start', message: error.message } }, v); }
}
// Under en opgave viser statusfeltet, hvor længe den har kørt, så en lang tænkepause ikke ligner, at appen er gået i stå.
let runTimer = null;
const elapsedText = ms => { const seconds = Math.floor(ms / 1000); return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`; };
// Én status for opgaven. Overskriften i samtalen siger kort, hvor opgaven er; linjen under siger, hvad der sker, og
// om AI'en venter på brugeren. Efter Stop og fejl står vejen videre på resultatkortet, ikke i flere bokse.
// Status pr. samtale. Godkendelser og spørgsmål i en samtale i baggrunden vises i sidepanelet og venter, til den åbnes.
function setStatusDetail(text, v = view) { v.statusDetail = text; if (v === view) renderStatus(); }
function waitFor(id, title, element, v = view) { v.waitingFor = [...v.waitingFor.filter(item => item.id !== id), { id, title, element }]; if (v === view) renderStatus(); window.chats?.render(); }
function doneWaiting(id, v = view) { v.waitingFor = v.waitingFor.filter(item => item.id !== id); if (v === view) renderStatus(); window.chats?.render(); }
function renderStatus() {
  const v = view, waiting = v.running && v.waitingFor.length > 0;
  $('#agent-activity').hidden = !v.running; $('#agent-activity').classList.toggle('is-waiting', waiting);
  $('#agent-activity-text').textContent = waiting ? `Venter på dig: ${v.waitingFor[0].title}${v.waitingFor.length > 1 ? ` Og ${v.waitingFor.length - 1} mere.` : ''}` : window.ChatDisplay.phase(v) || v.statusDetail;
  $('#agent-activity-jump').hidden = !waiting; $('#agent-follow').hidden = waiting;
  window.liveWork?.render();
  const progress = window.ChatDisplay.progress(v);
  $('#agent-progress').textContent = progress.text; $('#agent-progress').hidden = waiting;
  $('#agent-activity').classList.toggle('is-quiet', progress.quiet && !waiting);
  $('#chat-form').setAttribute('aria-busy', String(v.running));
  $('#chat-form').dataset.workState = window.ChatDisplay.workState(v);
  if (v.running) $('#run-status').textContent = waiting ? 'Venter på dig' : `${v.runLabel} ${elapsedText(Date.now() - v.runStartedAt)}`;
}
$('#agent-activity-jump').onclick = () => { const item = view.waitingFor[0]; if (!item?.element?.isConnected) return; item.element.scrollIntoView({ block: 'nearest' }); item.element.querySelector('button, textarea, input')?.focus(); };
function setRunning(value, status, v = view) {
  if (value && !v.running) { v.runStartedAt = Date.now(); v.lastSignalAt = v.runStartedAt; v.receivedChars = 0; v.modelProgress = null; v.todos = []; }
  if (!value) v.waitingFor = [];
  // Når opgaven er færdig, får de svar, der blev tegnet undervejs, deres kopiknapper. Ældre svar røres ikke.
  if (!value && v.running) { for (const id of v.unfinishedParts) if (v.parts.has(id)) markdownInto(v.parts.get(id), v.assistantText.get(id), true); v.unfinishedParts.clear(); }
  v.running = value; v.runLabel = status;
  if (value) v.statusDetail = status.startsWith('Starter') ? 'Aura starter AI’en …' : $('#work-mode').value === 'plan' ? 'Venter på modellens forslag …' : 'Venter på modellen …';
  if (v === view) { running = value; $('#run-status').textContent = status; updateModelSummary(); }
  applyRunning(); window.chats?.render();
  if (!anyRunning() && recovery) { const reason = recovery; recovery = ''; showConnectionWarning(reason); }
}
// Navigation og indstillinger er tilgængelige, mens opgaver fortsætter i baggrunden.
function applyRunning() {
  const busy = projectLoading || running;
  clearInterval(runTimer); runTimer = running ? setInterval(renderStatus, 1000) : null;
  // Den tomme forhåndsvisning ånder roligt, mens AI'en arbejder. Animationen slås fra ved reduceret bevægelse.
  $('#preview-empty').classList.toggle('is-working', busy);
  // Arbejdsstatus om skrivefeltet. Mærket på en vist forhåndsvisning sættes i live-work.js sammen med statusteksten.
  $('#chat-form').classList.toggle('is-working', running);
  if (!running) $('#preview-working').hidden = true;
  window.chatMaterials?.sync();
  // En samtale, der ikke arbejder, viser sin egen seneste status, fx Stoppet eller Fejl. Linjen over skrivefeltet siger, hvis en anden arbejder.
  if (!running) $('#run-status').textContent = view.runLabel || 'Klar';
  $('#send').disabled = projectLoading || running || Boolean(view.submitting); $('#stop').hidden = !running;
  $('#composer-wait').hidden = true;
  const mainRunning = window.chats?.projects().find(item => item.root === current?.root)?.chats?.some(chat => chat.running && !chat.isolated);
  $('#merge-copy').disabled = projectLoading || running || Boolean(mainRunning);
  $('#copy-wait').hidden = !current?.isolated || running || !mainRunning;
  const value = projectLoading;
  for (const selector of ['#new', '#open', '#connections-button', '#skills-button', '#features-button', '#publish-button', '#setup-hosting', '#deploy-button', '#intro-button']) $(selector).disabled = value;
  for (const selector of ['#composer-mode', '#accept-plan-offer', '#work-mode', '#build-plan', '#revise-plan', '#start-idea', '#plan-idea-first', '#build-idea-now']) $(selector).disabled = running;
  for (const selector of ['#model-chip', '#model-load', '#model-search', '#connection-select', '#model-select', '#route-select']) $(selector).disabled = projectLoading;
  for (const button of document.querySelectorAll('#model-shortlist button')) button.disabled = projectLoading;
  $('#task-next-note').hidden = !running;
  $('#include-history').disabled = running;
  setupControls(); updateIdeaApproach();
  renderStatus(); window.previewEdit?.available();
}
function showSkill() {
  const skill = skillList.find(s => s.id === $('#skill-select').value); if (!skill) return;
  $('#skill-content').value = skill.content;
  $('#skill-source').textContent = `${skill.customized ? 'Lokal tilpasning i dette projekt' : 'Fælles version fra biblioteket'}${skill.alwaysOn ? ' · gælder altid' : skill.enabled ? '' : ' · funktionen er slået fra'}`;
}
const toolLabels = { read: 'Læs fil', edit: 'Rediger fil', write: 'Skriv fil', bash: 'Kør kommando', webfetch: 'Læs hjemmeside', websearch: 'Søg på nettet', glob: 'Find filer', grep: 'Søg i filer', external_directory: 'Adgang uden for projektet' };
const toolStatuses = { pending: 'Venter', running: 'I gang', completed: 'Afsluttet', error: 'Mislykkedes' };
// Værktøjerne står under Aktivitet. Samtalen viser én linje pr. opgave med antallet og en vej dertil.
function noteTool(id, v = view) {
  if (!v.activityGroup) {
    v.activityGroup = node('p', undefined, 'activity-pointer'); v.activityGroup.tools = new Set();
    const open = node('button', 'Se Aktivitet', 'text-button'); open.type = 'button'; open.onclick = () => window.workspace.show('activity');
    v.activityGroup.append(node('span'), open); v.log.append(v.activityGroup);
  }
  v.activityGroup.tools.add(id);
  const count = v.activityGroup.tools.size;
  v.activityGroup.firstChild.textContent = `AI’en har brugt ${count} ${count === 1 ? 'værktøj' : 'værktøjer'}.`;
}
function partElement(id, role, v = view) {
  // Et AI-svar gemmes med delens id, så søgningen også kan finde svar fra den igangværende session.
  if (!v.parts.has(id)) { const element = appendMessage('', role, v); if (role === 'assistant') element.dataset.messageId = id; v.parts.set(id, element); }
  return v.parts.get(id);
}
// Hændelser fra en samtales opgave vises i dens egen visning, også når en anden samtale er åben.
window.harness.onEvent(event => {
  const p = event.properties || {};
  if (event.type === 'chat.copy-removed') { previewFrames.get(event.workspaceRoot)?.remove(); previewFrames.delete(event.workspaceRoot); previewRevisions.delete(event.workspaceRoot); return; }
  if (event.type === 'chat.preview' && event.chat === view.id) { usePreviewContext(event); return; }
  if (event.type === 'chat.workspace' && event.chat === view.id) { window.workspace?.onChat(); return; }
  if (event.type === 'preview.runtime' && event.workspaceRoot && event.workspaceRoot !== current?.workspaceRoot) return;
  if (event.type === 'preview.runtime') return window.previewServer?.update(event);
  if (event.type === 'history.error' && (!event.chat || event.chat === view.id) && (!event.root || event.root === current?.root)) { $('#draft-status').textContent = event.message; message(event.message, true); }
  if (event.type === 'preview.ready' && event.workspaceRoot && event.workspaceRoot !== current?.workspaceRoot) return;
  if (event.type === 'preview.ready') { showPreview(event.url); window.previewServer?.refresh(); return; }
  if (event.type === 'chats.updated') { Promise.resolve(window.chats?.update(event)).then(applyRunning, () => {}); return; }
  if (!event.chat && ['usage', 'plan.ready', 'run.review', 'git.checkpoint', 'session.new', 'run.status', 'message.updated', 'message.part.updated', 'message.part.delta', 'permission.asked', 'question.asked', 'engine.error', 'session.error'].includes(event.type) && !view.id) return;
  const v = viewFor(event.chat), active = v === view;
  if (event.root) v.root ||= event.root;
  if (v.running && ['message.part.updated', 'message.part.delta', 'permission.asked', 'question.asked', 'permission.replied', 'question.replied', 'usage'].includes(event.type)) v.lastSignalAt = Date.now();
  if (event.type === 'run.todos') { v.todos = event.todos; if (active) renderStatus(); return; }
  if (event.type === 'files.written') { if (v.modelProgress) v.modelProgress.draft = null; if (active) renderStatus(); }
  if (event.type === 'model.progress') { if (v.running) { v.modelProgress = event.progress; v.lastSignalAt = event.progress.lastContentAt; if (active) renderStatus(); } return; }
  if (event.type === 'message.part.delta' && typeof p.delta === 'string' && v.partTypes.get(p.partID) === 'text') { v.receivedChars += p.delta.length; if (active) renderStatus(); }
  if (event.type === 'usage') { v.usage = event.usage; v.contextUsage = event.contextUsage || null; if (active) renderUsage(event.usage); return; }
  if (event.type === 'plan.offer') { v.planOffer = event.offered; updatePlanOffer(v); }
  if (event.type === 'plan.retired') { v.plan = null; v.planCard = false; if (active) { activePlan = null; $('#plan-card').hidden = true; } }
  if (event.type === 'plan.ready') { v.plan = event.plan; v.planCard = true; if (v.buildOffer) { v.buildOffer = false; v.review.hidden = true; } updatePlanOffer(v); if (active) { activePlan = event.plan; window.planning?.onPlan(event.plan); $('#plan-card').hidden = false; if (v.followChat) requestAnimationFrame(() => $('#plan-card').scrollIntoView({ block: 'nearest' })); } }
  if (event.type === 'run.review') { renderRunReview(event, v); if (!active) { v.unread = true; window.chats?.render(); } }
  // Versionen efter opgaven vises på resultatkortet. Kun en oversprunget version nævnes i samtalen.
  if (event.type === 'git.checkpoint') { v.lastCheckpoint = event; if (event.status === 'skipped') appendMessage(event.message, 'system', v); return; }
  if (event.type === 'session.new') { v.contextUsage = null; if (active) renderContextUsage(); v.roles.clear(); v.parts.clear(); v.partTypes.clear(); }
  if (event.type === 'run.status') {
    const working = ['starting', 'working'].includes(event.status);
    const statuses = { starting: 'Starter agent …', working: 'Arbejder …', idle: 'Klar', error: 'Fejl', stopped: 'Stoppet' };
    setRunning(working, statuses[event.status] || event.status, v);
    if (['stopped', 'error'].includes(event.status)) {
      const keepPlan = event.planRetained === true && Boolean(v.plan);
      if (!keepPlan) { v.plan = null; v.planCard = false; }
      if (active) {
        if (!$('#prompt').value) $('#prompt').value = v.lastSentText;
        // Målet i forhåndsvisningen følger med beskeden tilbage, så Send igen retter det samme element.
        if (v.lastTargetRef && !window.workspace?.target()) window.workspace?.setTarget(v.lastTargetRef);
        if (!keepPlan) { activePlan = null; $('#plan-card').hidden = true; }
        if (!keepPlan && $('#work-mode').value === 'build') { $('#work-mode').value = 'plan'; updateWorkMode(); }
      } else v.draft = { text: v.lastSentText, mode: keepPlan ? 'build' : v.draft?.mode === 'build' ? 'plan' : v.draft?.mode || 'chat' };
    }
    if (!working) { v.approvals.replaceChildren(); if (active) saveChatDraft(); }
  }
  if (event.type === 'message.updated') v.roles.set(p.info.id, p.info.role);
  if (event.type === 'message.part.updated') {
    const part = p.part;
    v.partTypes.set(part.id, part.type);
    if (v.roles.get(part.messageID) === 'user') return;
    if (part.type === 'text') showAssistant(part.id, part.text, v);
    if (part.type === 'tool' && v.running && ['pending', 'running'].includes(part.state?.status)) setStatusDetail(`${toolLabels[part.tool] || 'Værktøjshandling'} · ${toolStatuses[part.state.status]}`, v);
    // Når et værktøj er færdigt, tænker modellen over næste skridt. Banneret må ikke blive stående på det afsluttede værktøj.
    if (part.type === 'tool' && v.running && ['completed', 'error'].includes(part.state?.status)) setStatusDetail('Venter på modellens næste svar …', v);
    if (part.type === 'text' && v.running) setStatusDetail('AI’en skriver …', v);
    if (part.type === 'reasoning' && v.running) setStatusDetail('Modellen forbereder næste skridt …', v);
    if (part.type === 'tool') noteTool(part.id, v);
  }
  if (event.type === 'message.part.delta' && p.field === 'text' && v.partTypes.get(p.partID) === 'text' && v.roles.get(p.messageID) !== 'user') showAssistant(p.partID, (v.assistantText.get(p.partID) || '') + p.delta, v);
  if (event.type === 'permission.auto') return;
  // Godkendelser: se approvals.js. Fokus bliver, hvor brugeren er; statuslinjen siger, at AI'en venter.
  if (event.type === 'permission.asked') window.approvals.show(p, v);
  // AI'ens spørgsmål vises ét ad gangen med klikbare svar; se planning.js. Fokus bliver, hvor brugeren er.
  if (event.type === 'question.asked') window.planning.showQuestion(p, v);
  // En fejl under en opgave vises ét sted: på resultatkortet med en vej videre. Beskeden står klar i skrivefeltet.
  if (['engine.error', 'session.error'].includes(event.type)) {
    if (active && !$('#prompt').value) $('#prompt').value = v.lastSentText;
    if (['key', 'access', 'rejected', 'notfound'].includes(event.failure?.kind)) {
      invalidateConnection(v.runConnection, event.failure?.message || event.message || 'Udbyderen afviste opgaven. Kontrollér adgang og model.');
      verifiedConnection = ''; ++setupGeneration; acceptedFingerprint = null; pendingSend = null; setupControls();
    }
    if (v.running) setStatusDetail('Der opstod en fejl. AI’en stopper.', v);
  }
});
function setProjectColor(color) { $('#color-chosen').checked = Boolean(color); $('#color').disabled = !color; $('#color').value = color || '#475569'; $('#color-value').value = color || 'Ikke valgt'; }
const projectColor = () => $('#color-chosen').checked ? $('#color').value : null;
$('#color-chosen').onchange = () => { $('#color').disabled = !$('#color-chosen').checked; $('#color-value').value = projectColor() || 'Ikke valgt'; };
$('#color').addEventListener('input', event => { $('#color-value').value = event.target.value; });
for (const kind of ['logo', 'reference']) $(`#${kind}`).onclick = () => action(async () => showAssets(await call('chooseAssets', kind)));
$('#open').onclick = () => action(async () => { const request = ++navigationRequest, owner = selectedOwner(); await saveChatDraft(); const project = await call('openProject', undefined, owner); if (request === navigationRequest) await displayProject(project); });
$('#new').onclick = () => action(async () => {
  const request = ++navigationRequest, owner = selectedOwner();
  await saveChatDraft(); if (request !== navigationRequest) return;
  await call('newProject', undefined, owner); if (request !== navigationRequest) return;
  try { localStorage.removeItem(lastProjectKey); } catch {}
  document.body.classList.remove('setup-guided'); setupActive = false; $('#setup').hidden = true;
  ++modelRequest; ++projectDisplayRequest; recovery = ''; $('#connection-warning').hidden = true;
  if (current?.workspaceRoot) previewRevisions.set(current.workspaceRoot, revision);
  current = null; window.harness.selectContext?.(null);
  window.dispatchEvent(new CustomEvent('aura:project', { detail: { root: null } })); revision = null; acceptedFingerprint = null;
  mountView(makeView(null)); $('#workspace').hidden = true; $('#onboarding').hidden = false; $('#skills-button').disabled = true;
  $('#new').setAttribute('aria-current', 'page'); $('#view-title').textContent = 'Projektopstart'; $('#create-form').reset(); setProjectColor(null); showAssets([]);
  const features = await call('featuresGet', undefined, null); if (request !== navigationRequest || current) return;
  state.features = features; await loadStartup(); if (request !== navigationRequest || current) return;
  applyFeatures(); nameTouched = false; saveIdeaDraft(); showIdeaExamples(); $('#purpose').focus();
});
$('#create-form').onsubmit = event => {
  event.preventDefault();
  // Et klik, mens et projekt åbnes eller opstartsvalgene hentes, gør ingenting; knappen er låst imens.
  if (current || projectLoading || startupLoads > 0) return;
  action(async () => {
    projectLoading = true; applyRunning();
    let created;
    try {
      created = await call('createProject', { name: $('#name').value, purpose: $('#purpose').value, color: projectColor(), links: $('#links').value.split('\n').map(line => line.trim()).filter(Boolean), tests: $('#tests').value, startup: startupValues() });
      if (!created) return;
      await displayProject(created, { firstTask: true });
      clearIdeaDraft();
    } finally { projectLoading = false; applyRunning(); }
    // Den første besked forberedes først, når oprettelsen er frigivet. Der sendes intet til AI'en.
    $('#start-idea').click();
  });
};
$('#connections-button').onclick = () => action(async () => { const owner = selectedOwner(), ticket = navigationRequest; if (setupActive && setupStep === 'provider') setupPage('tools'); moveConnectionForm(false); const next = await call('connectionState', undefined, owner); if (ticket !== navigationRequest || owner?.root !== current?.root) return; state = next; renderConnections(); updateProvider(); connectionView('list'); $('#connections-feedback').textContent = ''; $('#connections-dialog').showModal(); });
$('#provider-kind').onchange = () => { updateProvider(); };
// Fælles afslutning, hvad enten forbindelsen blev gemt uden nøgle eller med en kontrolleret nøgle fra nøglevinduet.
async function connectionSaved({ id, guided, generation, catalog = null, feedback = 'Forbindelsen er gemt.' }) {
  const stillGuided = guided && setupActive && setupStep === 'provider' && generation === setupGeneration;
  ++setupGeneration; verifiedConnection = ''; acceptedFingerprint = null;
  renderConnections();
  if (id) $('#setup-connection').value = id;
  // Kataloget fra nøglevinduets kontrol gælder som kontrollen. Det sættes efter renderConnections, fordi renderSetup
  // rydder kontrollen, så længe den valgte forbindelse endnu ikke står i listen.
  if (catalog) { recordCatalog(id, catalog); verifiedConnection = catalog.length ? id : ''; }
  setupControls(); $('#connection-feedback').textContent = feedback;
  $('#connection-form').reset(); $('#connection-id').value = ''; updateProvider();
  if (stillGuided && id) {
    setupPage('saved');
    if (catalog) { $('#setup-ai').textContent = catalogMessage(id, catalog); if (catalog.length) $('#setup-subtitle').textContent = 'Forbindelsen er gemt.'; setupControls(); }
    else await testSetupConnection();
  } else if (!guided) { connectionView('list'); $('#connections-feedback').textContent = feedback; }
}
$('#connection-form').onsubmit = event => {
  event.preventDefault(); action(async () => {
    $('#save-connection').disabled = true;
    const generation = setupGeneration, guided = setupActive && setupStep === 'provider';
    const previousIDs = new Set(state.connections.map(c => c.id));
    const input = { ...connectionInput(), clearKey: $('#clear-key').checked };
    try {
      state = await call('saveConnection', input); if (input.id) connectionChecks.clear(input.id);
      const selected = state.connections.find(c => c.id === input.id || !previousIDs.has(c.id));
      await connectionSaved({ id: selected?.id || '', guided, generation });
    } catch (error) {
      $('#connection-feedback').textContent = error.message;
    } finally { $('#save-connection').disabled = false; }
  });
};
// Nøglevinduet renser, kontrollerer og gemmer nøglen. Hovedvinduet får kun kvitteringen.
$('#enter-key').onclick = () => {
  if (!$('#connection-form').reportValidity()) return;
  action(async () => {
    $('#enter-key').disabled = true; $('#save-connection').disabled = true;
    const generation = setupGeneration, guided = setupActive && setupStep === 'provider';
    try {
      const receipt = await call('keyConnection', connectionInput());
      if (!receipt) { $('#connection-feedback').textContent = 'Nøglen blev ikke indtastet. Forbindelsen er uændret.'; return; }
      state = receipt.state; connectionChecks.clear(receipt.id);
      const rettet = receipt.changes?.length ? ` Rettet i den indsatte nøgle: ${receipt.changes.join(', ')}.` : '';
      await connectionSaved({
        id: receipt.id, guided, generation,
        catalog: receipt.checked ? receipt.models || [] : null,
        feedback: receipt.checked ? `Nøglen er kontrolleret og gemt krypteret.${rettet}` : `Forbindelsen er gemt uden kontrol, fordi serveren ikke kunne nås.${rettet}`
      });
    } catch (error) {
      $('#connection-feedback').textContent = error.message;
    } finally { $('#enter-key').disabled = false; $('#save-connection').disabled = false; }
  });
};
$('#connection-select').onchange = () => { autoConnect = true; action(() => loadModels()); }; $('#model-select').onchange = () => { updateModelSummary(); action(() => loadRoutes()); };
$('#data-button').onclick = () => action(async () => showData(await call('prepare', selection()), false));
// Låsen tilhører samtalen og sættes før første await, også ved tastaturafsendelse.
$('#chat-form').onsubmit = event => {
  event.preventDefault();
  const sourceView = view, owner = selectedOwner(), text = $('#prompt').value.trim();
  if (!text || running || projectLoading || sourceView.submitting || pendingSend) return;
  sourceView.submitting = true;
  action(async () => {
    try {
      if (!$('#connection-select').value && !state?.connections?.length) { showSetup('Tilslut en AI for at sende beskeden. Din kladde er bevaret.'); return; }
      if (!$('#connection-select').value || !$('#model-select').value || (!$('#route-row').hidden && !$('#route-select').value)) { openTaskSettings(); message('Vælg model og eventuel modeludbyder.', true); return; }
      $('#send').disabled = true;
      if (['chat', 'plan'].includes($('#work-mode').value) && window.ConversationMode.buildRequest(text)) {
        $('#work-mode').value = activePlan ? 'build' : 'free'; $('#include-history').checked = true; acceptedFingerprint = null; updateWorkMode(); saveChatDraft();
      }
      const data = await call('prepare', selection(), owner);
      if (view !== sourceView || current?.root !== owner?.root) return;
      if (data.accepted || reviewKey(data) === acceptedFingerprint) await sendNow(data, text);
      else { pendingSend = { data, text }; showData(data, true); }
    } catch (error) { if (view === sourceView) { connectionFailed(error.message); throw error; } }
    finally { sourceView.submitting = false; if (view === sourceView) applyRunning(); }
  });
};
$('#prompt').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (event.repeat || !$('#prompt').value.trim() || $('#send').disabled || view.submitting || pendingSend) return;
  $('#chat-form').requestSubmit();
});
$('#send').setAttribute('aria-keyshortcuts', 'Enter Meta+Enter Control+Enter');
$('#send').title = 'Enter sender. Shift+Enter giver en ny linje.';
$('#data-dialog').addEventListener('close', () => { pendingSend = null; });
$('#accept-send').onclick = () => action(async () => { const pending = pendingSend; pendingSend = null; if (pending) await sendNow(pending.data, pending.text); });
$('#stop').onclick = () => action(() => call('stop'));
$('#skills-button').onclick = () => action(async () => { const owner = selectedOwner(), ticket = navigationRequest; const next = await call('skills', undefined, owner); if (ticket !== navigationRequest || owner?.root !== current?.root) return; skillOwner = owner; skillList = next; $('#skill-select').replaceChildren(...skillList.map(s => option(s.id, s.enabled ? s.title : `${s.title} · slået fra`))); showSkill(); $('#skills-dialog').showModal(); });
$('#skill-select').onchange = showSkill;
for (const reset of [true, false]) $(reset ? '#skill-reset' : '#skill-save').onclick = () => action(async () => { const id = $('#skill-select').value; const owner = skillOwner, next = await call('saveSkill', { id, content: $('#skill-content').value, reset }, owner); if (owner?.root !== current?.root || !$('#skills-dialog').open) return; skillList = next; acceptedFingerprint = null; showSkill(); message(reset ? 'Den fælles version bruges igen i dette projekt. Det gælder fra din næste besked.' : 'Instruktionen er gemt for dette projekt. Den gælder fra din næste besked.'); });
$('#attach-preview').onclick = () => window.previewServer.open();
$('#preview-form').onsubmit = event => { event.preventDefault(); action(async () => { const url = await call('attachPreview', $('#preview-url').value); showPreview(url, true); $('#preview-dialog').close(); }); };
$('#static-preview').onclick = () => action(async () => { showPreview(await call('attachPreview', '')); $('#preview-dialog').close(); });
$('#refresh').onclick = () => { if (current?.previewURL) $('#preview').src = current.previewURL; };
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => document.getElementById(button.dataset.close).close();
// Menuhandlingen er skjult igen, når dialogen lukkes. Giv fokus tilbage til den synlige menuåbner.
for (const id of ['support-dialog', 'connections-dialog', 'features-dialog']) document.getElementById(id).addEventListener('close', () => {
  if (document.querySelector('dialog[open]') || setupActive) return;
  const active = document.activeElement;
  if (active === document.body || !active?.checkVisibility({ checkVisibilityCSS: true })) $('#settings-toggle').focus();
});
$('#connections-dialog').addEventListener('close', () => { $('#clear-key').checked = false; });
setInterval(async () => { if (!current || polling) return; polling = true; const project = current, root = current.workspaceRoot; try { const next = await call('revision'); if (current !== project || current.workspaceRoot !== root || !next) return; if (revision && next !== revision) $('#preview').src = current.previewURL; revision = next; $('#preview-status').textContent = 'Lokal forhåndsvisning'; } catch { $('#preview-status').textContent = 'Kan ikke læse siden – kontrollér projektfilerne'; } finally { polling = false; } }, 1500);
action(async () => { syncCreateAvailability(); try { state = await call('connectionState'); renderConnections(); updateProvider(); await loadDesigns(); await loadStartup(); applyFeatures(); renderLocation(await call('projectLocation')); restoreIdeaDraft(); showIdeaExamples(); await refreshRecent(); setupControls(); for (const id of ['#welcome-build', '#welcome-example', '#welcome-open']) $(id).disabled = false; if ($('#welcome-dialog').open) $('#welcome-title').focus(); else { $('#purpose').focus(); await reopenLast(); } } finally { projectLoading = false; applyRunning(); } });
// Kom tilbage: det senest åbnede projekt åbnes igen ved start, så man fortsætter, hvor man slap.
// Et projekt, brugeren selv har lukket med Nyt projekt, åbnes ikke igen.
const lastProjectKey = 'harness.lastProject.v1';
async function reopenLast() {
  const previous = projectLoading; projectLoading = true; applyRunning();
  try {
    let root = ''; try { root = localStorage.getItem(lastProjectKey) || ''; } catch {}
    const last = root && (await call('recentProjects')).find(item => item.root === root);
    if (!last) return;
    try { await displayProject(await call('reopenProject', last.id)); }
    catch { message(`Det seneste projekt, ${last.name}, kunne ikke åbnes. Det er måske flyttet eller slettet. Brug Åbn projekt for at finde det.`, true); }
  } finally { projectLoading = previous; applyRunning(); }
}

async function loadDesigns() { const designs = await call('listDesigns'); $('#design-select').replaceChildren(option('', 'Intet design'), ...designs.map(d => option(d.id, `${d.name} · ${d.files} filer`))); }
$('#save-design').onclick = () => action(async () => { await call('saveDesign', { name: $('#design-name').value, color: projectColor(), links: $('#links').value.split('\n').map(s => s.trim()).filter(Boolean) }); await loadDesigns(); message('Designpakken er gemt lokalt og kan vælges i andre projekter.'); });
$('#design-select').onchange = () => action(async () => { updateStartupSummary(); if (!$('#design-select').value) { await clearStartupDesign(); return; } const design = await call('applyDesign', $('#design-select').value); setProjectColor(design.color); $('#links').value = design.links.join('\n'); showAssets(design.assets); updateStartupSummary(); });


// Versioners navne forkortes ved et ordskifte, så historikken kan læses. Samme regel som for AI-opgaver.
function shortLabel(text, max = 80) { const value = String(text).replace(/\s+/g, ' ').trim(); return value.length <= max ? value : value.slice(0, max).replace(/[\s,.;:]+\S*$/, '') + ' …'; }
// Tidspunkt for en version i almindeligt dansk: "i dag 14.32", "i går 09.10" eller "3. okt. 14.32".
function versionTime(at) {
  const date = new Date(at); if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }), day = new Date(); day.setHours(0, 0, 0, 0);
  const start = new Date(date); start.setHours(0, 0, 0, 0); const days = Math.round((day - start) / 86400000);
  return days === 0 ? `i dag ${time}` : days === 1 ? `i går ${time}` : `${date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${time}`;
}
// Versioner, gendannelse og fortryd ligger i history.js.

// Enkel adgang uden at skjule datagodkendelse eller ændre model automatisk.
// Under skrivefeltet står altid den aktive model, udbyderen og indsatsen, ligesom i Claude Code.
const effortNames = { minimal: 'minimal', low: 'lav', medium: 'middel', high: 'høj', xhigh: 'meget høj', max: 'maksimal' };
function updateModelSummary() {
  const model = $('#model-select');
  const connection = state?.connections.find(c => c.id === $('#connection-select').value);
  const provider = state?.definitions?.[connection?.kind]?.provider || connection?.name || '';
  const chosen = model.value && view?.effort ? effortNames[view.effort] || view.effort : null;
  const effort = model.value && window.ModelAdvice.effort(connection?.kind, model.value);
  const effortLabel = chosen ? `${chosen} indsats` : effort ? `${effort} indsats` : connection?.kind === 'mistral' ? 'standardindsats' : '';
  $('#model-effort').hidden = !chosen; $('#model-effort-text').textContent = chosen ? `Du har valgt ${chosen} indsats i denne samtale.` : '';
  const label = model.value ? [model.selectedOptions[0].textContent, provider, effortLabel].filter(Boolean).join(' · ') : 'Vælg AI';
  $('#model-summary').textContent = model.value ? model.selectedOptions[0].textContent : 'Vælg din AI';
  // En kørende samtale viser den model, opgaven blev sendt med, også hvis næste model allerede er valgt.
  const sent = view.running && view.activeModelSummary;
  window.ProviderBrand.decorate($('#model-chip'), sent ? { ...view.activeModelBrand, label: view.activeModelSummary } : { kind: connection?.kind, modelID: model.value, label });
  $('#model-chip').title = chosen ? `Du har valgt ${chosen} indsats i denne samtale. Klik for at skifte model eller indsats.` : effort ? `${effort[0].toUpperCase()}${effort.slice(1)} indsats er udbyderens standard for modellen. Klik for at skifte model.` : connection?.kind === 'mistral' ? 'Aura sender ikke et valg af indsats. Mistrals standard gælder; niveauet er ikke verificeret. Klik for at skifte model eller forbindelse.' : 'Klik for at skifte model eller forbindelse.';
  renderContextUsage();
  $('#connection-status').textContent = model.value ? (state?.connections.find(c => c.id === $('#connection-select').value)?.name || 'Valgt forbindelse') + ' · ' + model.value : 'Ingen model valgt';
}
// Forbruget i samtalen: tokens ind og ud og en anslået pris ud fra udbyderens prisliste. Det faktiske forbrug står hos udbyderen.
const tokenCount = value => Math.round(value).toLocaleString('da-DK');
function renderUsage(usage) {
  const target = $('#usage-status');
  if (!usage || !usage.calls) { target.textContent = 'Intet forbrug i denne samtale endnu'; target.dataset.usageTitle = ''; renderContextUsage(); return; }
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  const amounts = [];
  if (usage.calls > usage.unpriced + (usage.otherCalls || 0)) amounts.push(usage.cost < 0.01 ? 'under 0,01 USD' : `ca. ${usage.cost.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`);
  if (usage.otherCosts?.DKK != null) amounts.push(usage.otherCosts.DKK < 0.01 ? 'under 0,01 DKK' : `ca. ${usage.otherCosts.DKK.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DKK`);
  if (usage.unpriced) amounts.push('pris ukendt');
  const price = amounts.join(' + ');
  target.textContent = `Denne samtale: ${tokenCount(input)} tokens ind · ${tokenCount(usage.output + usage.reasoning)} ud · ${price}`;
  target.dataset.usageTitle = `${usage.calls} modelkald. Ind: ${tokenCount(usage.input)} nye, ${tokenCount(usage.cacheRead)} fra cache og ${tokenCount(usage.cacheWrite)} skrevet til cache. Ud: ${tokenCount(usage.output)} svar og ${tokenCount(usage.reasoning)} ræsonnement. Prisen er et overslag ud fra udbyderens listepris og kan afvige fra din faktura; se det faktiske forbrug hos udbyderen.`;
  renderContextUsage();
}
// Kontekstmålingen hører til detaljerne og står derfor i statuslinjens titel sammen med forbruget. Første lag
// viser kun en advarsel, når det seneste kald nærmer sig Auras grænse for et kalds input.
function renderContextUsage() {
  const v = view, target = $('#usage-status'), warning = $('#context-warning');
  // Under en opgave gælder den model, opgaven kører med, ikke et nyt valg i rullelisten.
  const selected = v?.running && v.runContextSelection ? v.runContextSelection : { connectionID: $('#connection-select').value, modelID: $('#model-select').value, routeID: $('#route-row').hidden ? '' : $('#route-select').value };
  const text = window.ContextDisplay.describe(v?.contextUsage, selected);
  target.title = [target.dataset.usageTitle || '', selected.modelID ? text.detail : ''].filter(Boolean).join(' ');
  warning.textContent = selected.modelID ? text.warning : ''; warning.hidden = !warning.textContent;
}
function showConnectionWarning(reason) {
  $('#connection-warning-text').textContent = reason;
  $('#connection-warning').hidden = false;
  if (!current) showSetup(reason);
}
$('#repair-connection').onclick = () => showSetup($('#connection-warning-text').textContent);
$('#dismiss-connection').onclick = () => { $('#connection-warning').hidden = true; $('#prompt').focus(); };
$('#model-manage').onclick = () => { $('#task-dialog').close(); showSetup(); };
// Forbered første besked vises kun, når skrivefeltet er tomt og samtalen ikke er begyndt. Så står der aldrig to måder at starte på.
function updateStartIdea() { $('#start-idea').hidden = !current || $('#project-intro').hidden || Boolean($('#prompt').value.trim()); }
$('#start-idea').onclick = () => {
  if (running) return;
  if ($('#prompt').value.trim()) { message('Din kladde er bevaret. Send eller ryd den, før du forbereder en ny besked.'); $('#prompt').focus(); return; }
  const wishes = [['idea-platform', 'Platform'], ['idea-data', 'Data'], ['idea-ui', 'Brugerflade'], ['idea-design', 'Designværktøjer'], ['idea-backend', 'Backend']]
    .filter(([id]) => $(`#${id}`).value).map(([id, label]) => ({ label, value: $(`#${id}`).value }));
  // Projektidéen er en byggeopgave; kun brugerens eget valg af arbejdsmåde har forrang, og Planlæg vælges kun af
  // brugeren. Kladden spørges der ikke om: feltet er tomt her, fordi en kladde med tekst allerede har afbrudt
  // ovenfor, og den gemte kladde opdateres forsinket. Ellers afgjorde tilfældig timing, om idéen landede i Byg.
  if (!view.modeChosen) $('#work-mode').value = 'free';
  updateWorkMode();
  // Med planlægning kommer ønskerne i projektbriefen, som følger med hver besked. Uden står de i beskeden som før.
  const inBrief = featureOn('planlaegning') && wishes.length;
  $('#prompt').value = `${current?.purpose || '[beskriv din idé her]'}${wishes.length && !inBrief ? '\n\nMine ønsker:\n' + wishes.map(w => `${w.label}: ${w.value}`).join('\n') : ''}`;
  // Ét spørgsmål, lige når idéen står i feltet: skal den planlægges først, eller bygges med det samme? Vi anbefaler
  // at planlægge, fordi spørgsmålene så stilles ét ad gangen og planen kan rettes, før noget bygges. Valget er
  // brugerens: indtil der svares, gælder arbejdsmåden ovenfor, og har brugeren selv valgt en, spørges der ikke.
  view.ideaApproach = featureOn('planlaegning') && !view.modeChosen;
  saveChatDraft(); updateStartIdea(); updateIdeaApproach(); $('#prompt').focus();
  if (inBrief) action(async () => { await window.planning.addWishes(wishes); message('Dine ønsker står i projektbriefen under Plan.'); });
};
// Kortet står kun, mens idéen ligger urørt i skrivefeltet og samtalen ikke er begyndt. Tømmes feltet, svares der,
// eller sendes beskeden, er spørgsmålet ovre, og arbejdsmåden ændres kun af brugeren selv.
function updateIdeaApproach(v = view) {
  if (v.log?.children.length || v.running) v.ideaApproach = false;
  if (v !== view) return;
  if (!$('#prompt').value.trim()) v.ideaApproach = false;
  $('#idea-approach').hidden = !v.ideaApproach;
}
const chooseIdeaApproach = mode => {
  if (running) return;
  view.ideaApproach = false; updateIdeaApproach();
  $('#work-mode').value = mode; view.modeChosen = true; acceptedFingerprint = null;
  updateWorkMode(); saveChatDraft(); $('#prompt').focus();
};
$('#plan-idea-first').onclick = () => chooseIdeaApproach('plan');
$('#build-idea-now').onclick = () => chooseIdeaApproach('free');
$('#model-select').addEventListener('change', updateModelSummary);

$('#model-done').onclick = () => { if (!$('#connection-select').value || !$('#model-select').value || (!$('#route-row').hidden && !$('#route-select').value)) { message('Vælg en forbindelse, model og eventuel udbyder først.', true); return; } updateModelSummary(); $('#model-options').open = false; $('#task-dialog').close(); $('#prompt').focus(); };

// Funktioner: brugeren slår dem til og fra under Indstillinger › Funktioner. Et fravalg skjuler handlingen; filer og historik bevares.
const featureOn = id => state?.features?.effective?.[id] !== false;
const defaultMode = () => 'chat';
// En besked fra et andet forløb bruger den valgte arbejdsmåde og den normale afsendelsesvej.
// En kladde, brugeren selv har skrevet, overskrives aldrig.
window.draftMessage = (text, note, options = {}) => {
  if (!current || running || view.submitting) return false;
  if (options.owner && (options.owner.root !== current.root || options.owner.chat !== view.id)) return false;
  if ($('#prompt').value.trim()) { message(`${note} Din kladde er bevaret, så skriv selv til AI’en, når du er klar.`); $('#prompt').focus(); return; }
  $('#work-mode').value = ['chat', 'plan', 'free', 'build'].includes(options.mode) ? options.mode : 'plan'; updateWorkMode();
  $('#prompt').value = text; saveChatDraft(); updateStartIdea(); message(note); $('#prompt').focus();
  if (options.submit) $('#chat-form').requestSubmit();
  return true;
};
// Et login uden for funktionsdialogen, fx Promte i forhåndsvisningen, kan ændre de anbefalede funktioner.
window.refreshFeatures = async () => { const owner = selectedOwner(), sourceState = state; const features = await call('featuresGet', undefined, owner); if (sourceState !== state || owner?.root !== current?.root) return; state.features = features; applyFeatures(); };
window.sharingOn = () => featureOn('deling');
function applyFeatures() {
  $('#git-button').hidden = !featureOn('versioner');
  // Udgiv er altid synlig; uden udgivelse eller en gemt version viser Udgiv det næste trin.
  for (const id of ['#publish-button', '#setup-hosting', '#startup-hosting-row']) $(id).hidden = !featureOn('deling');
  window.dispatchEvent(new Event('aura:features'));
  for (const id of ['#design-options', '#design-row']) $(id).hidden = !featureOn('design');
  const remembered = ['AI-forbindelse', featureOn('deling') && 'udgivelsesønske', featureOn('design') && 'designpakke'].filter(Boolean);
  $('#remember-info').dataset.info = `Husker ${remembered.join(', ')} og teststrategi fra det seneste projekt. Godkendelser og private referencer huskes ikke.`;
  updateStartupSummary();
}
// Et valg slår det til, funktionen bygger på, og et fravalg slår det fra, der bygger på den. Hovedprocessen gør det samme.
function coupleFeatures(values, id, value) {
  const next = { ...values, [id]: value };
  if (value) for (const required of state.features.list.find(feature => feature.id === id).requires) next[required] = true;
  else for (const feature of state.features.list) if (feature.requires.includes(id)) next[feature.id] = false;
  return next;
}
// Én kontakt pr. funktion med én linje forklaring. Skills står bag ⓘ i Indstillinger; ved første start er de udeladt.
function featureRow(feature, checked, onChange, note, withSkills = true) {
  const row = node('div', undefined, 'feature-row'); row.dataset.feature = feature.id;
  const label = node('label', undefined, 'feature-toggle');
  const title = node('strong', feature.title);
  const requires = feature.requires.map(id => state.features.list.find(item => item.id === id).title);
  const integration = feature.skills[0]?.integration;
  // En integration viser ejer, adgang og dataflow, så man kan vurdere den, før den slås til.
  if (withSkills && integration) title.append(info(feature.title, [`System: ${integration.system}`, `Ejer: ${integration.owner}`, `Adgang: ${integration.access}`, `Data: ${integration.data}`, `Dataflow: ${integration.dataFlow}`, `Pris: ${integration.cost}`, integration.itRoute ? 'Kræver hjælp fra IT-afdelingen.' : '', integration.sensitive ? 'Omfatter følsomme personoplysninger.' : '', `Skillen vedligeholdes af ${integration.maintainer} og er kontrolleret ${integration.checkedAt}.`].filter(Boolean).join('\n')));
  else if (withSkills) title.append(info(feature.title, `${feature.skills.length === 1 ? 'Skill' : 'Skills'}, AI’en henter, når opgaven passer:\n${feature.skills.map(skill => `• ${skill.title}: ${skill.summary}`).join('\n')}${requires.length ? `\n\nBygger på ${requires.join(' og ')}, som slås til sammen med den.` : ''}`));
  const text = node('span'); text.append(title, node('small', feature.summary));
  const input = node('input'); input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', feature.title); input.dataset.feature = feature.id; input.checked = checked; input.disabled = projectLoading;
  input.id = `feature-${feature.id}-${crypto.randomUUID()}`; label.htmlFor = input.id;
  input.onchange = () => onChange(feature.id, input.checked);
  label.append(text, input); row.append(label);
  if (note) row.append(note);
  return row;
}
// Første start, Vælg selv: intet er slået til, før brugeren vælger det.
let pendingAI = false, pickedFeatures = {};
function updatePick() {
  for (const input of document.querySelectorAll('#setup-features-list input[data-feature]')) input.checked = pickedFeatures[input.dataset.feature] === true;
  const count = Object.values(pickedFeatures).filter(Boolean).length;
  $('#features-continue').textContent = count ? `Fortsæt med ${count} ${count === 1 ? 'funktion' : 'funktioner'}` : 'Fortsæt uden funktioner';
}
$('#features-all').onclick = () => action(async () => {
  state.features = await call('featuresSave', { scope: 'alle', chosen: 'alle', values: {} });
  await leaveSetup(pendingAI);
});
$('#features-pick').onclick = () => {
  // Ved første start vælges kun de almindelige funktioner. Integrationer slås til under Indstillinger › Funktioner.
  const main = state.features.list.filter(feature => !feature.group);
  pickedFeatures = Object.fromEntries(main.map(feature => [feature.id, false]));
  $('#setup-features-list').replaceChildren(...main.map(feature => featureRow(feature, false, (id, value) => { pickedFeatures = coupleFeatures(pickedFeatures, id, value); updatePick(); }, null, false)));
  updatePick(); setupPage('features-pick');
};
$('#features-continue').onclick = () => action(async () => {
  state.features = await call('featuresSave', { scope: 'alle', chosen: 'valgt', values: pickedFeatures });
  await leaveSetup(pendingAI);
});
// Indstillinger › Funktioner: standarden for alle projekter eller undtagelser for det åbne projekt.
let featureScope = 'alle';
function renderFeatures(focus) {
  const features = state.features, project = featureScope === 'projekt';
  $('#features-scope').hidden = !current; $('#features-project-name').textContent = `Kun ${current?.name || 'dette projekt'}`; $('#features-project-name').title = current?.name || '';
  for (const radio of document.querySelectorAll('[name="features-scope"]')) radio.checked = radio.value === featureScope;
  const values = project ? features.effective : features.defaults;
  const row = feature => {
    let note;
    if (current && features.exceptions[feature.id] !== undefined) {
      const missing = feature.requires.filter(id => !features.effective[id]).map(id => features.list.find(item => item.id === id).title);
      const status = !features.exceptions[feature.id] ? 'slået fra' : missing.length ? `slået til, men kræver ${missing.join(' og ')}` : 'slået til';
      note = node('p', project ? `Kun i dette projekt: ${status}.` : `${current.name} har en undtagelse: ${status}.`, 'feature-note');
      if (project) { const reset = node('button', 'Brug standarden', 'text-button'); reset.type = 'button'; reset.onclick = () => action(() => saveFeatures(feature.id, null)); note.append(' ', reset); }
    }
    return featureRow(feature, values[feature.id] === true, (id, value) => action(() => saveFeatures(id, value)), note);
  };
  // Integrationer står for sig: én kontakt pr. system, som man slår til, når projektet skal bruge det.
  const integrations = features.list.filter(feature => feature.group === 'integrationer');
  const heading = integrations.length ? [node('h3', 'Integrationer', 'features-group'), node('p', 'Slå de systemer til, dit projekt skal hente data fra.', 'hint')] : [];
  $('#features-list').replaceChildren(...features.list.filter(feature => !feature.group).map(row), ...heading, ...integrations.map(row));
  $('#features-advanced').hidden = !current;
  if (focus) document.querySelector(`#features-list input[data-feature="${focus}"]`)?.focus();
}
async function saveFeatures(id, value) {
  const owner = featuresOwner, scope = featureScope, sourceState = state;
  const features = await call('featuresSave', { scope, values: { [id]: value } }, owner);
  if (sourceState !== state || owner?.root !== current?.root) return;
  state.features = features; renderFeatures(id);
  acceptedFingerprint = null; applyFeatures();
  // En funktionskontakt ændrer ikke brugerens valg af Byg eller Samtale.
  if (id === 'planlaegning' && !features.effective.planlaegning && current && !running && !activePlan && $('#work-mode').value === 'plan') { $('#work-mode').value = defaultMode(); updateWorkMode(); saveChatDraft(); }
  $('#features-feedback').textContent = `Gemt for ${featureScope === 'projekt' ? 'dette projekt' : 'alle projekter'}. Det gælder fra din næste besked.`;
}
$('#features-button').onclick = () => action(async () => {
  const owner = selectedOwner(), ticket = navigationRequest, features = await call('featuresGet', undefined, owner);
  if (ticket !== navigationRequest || owner?.root !== current?.root) return;
  featuresOwner = owner; state.features = features;
  featureScope = current && Object.keys(state.features.exceptions).length ? 'projekt' : 'alle';
  $('#features-feedback').textContent = ''; renderFeatures(); $('#features-dialog').showModal();
});
for (const radio of document.querySelectorAll('[name="features-scope"]')) radio.onchange = () => { featureScope = radio.value; $('#features-feedback').textContent = ''; renderFeatures(); };

function hostingLabel(value) { return ({ vercel: 'Vercel', azure: 'Azure', own: 'Egen løsning' })[value] || 'Beslut senere'; }
function testLabel(value) { return ({ manuel: 'Manuel gennemgang', automatiske: 'Automatiske tests', senere: 'Beslut senere' })[value] || 'Beslut senere'; }
function startupValues() { return { hosting: $('#startup-hosting').value, connectionID: $('#startup-connection').value, designID: $('#design-select').value, tests: $('#tests').value }; }
function renderStartupConnections() {
  const previous = $('#startup-connection').value;
  $('#startup-connection').replaceChildren(option('', 'Beslut senere'), ...(state?.connections || []).map(c => option(c.id, c.name)));
  if (state?.connections.some(c => c.id === previous)) $('#startup-connection').value = previous;
  updateStartupSummary();
}
// Flere valg viser de valg, der er truffet. Valg under en slået fra funktion nævnes ikke, men huskes, hvis funktionen slås til igen.
function updateStartupSummary() {
  const values = startupValues(), design = featureOn('design'), sharing = featureOn('deling');
  const chosen = [state?.connections.find(c => c.id === values.connectionID)?.name, sharing && values.hosting && hostingLabel(values.hosting), design && values.designID && $('#design-select').selectedOptions[0]?.textContent.split(' · ')[0], values.tests !== 'senere' && testLabel(values.tests)].filter(Boolean);
  $('#project-options-summary').textContent = chosen.length ? `Flere valg · ${chosen.join(' · ')}` : 'Flere valg · valgfrit';
}
async function clearStartupDesign() {
  showAssets(await call('clearAssets')); $('#design-select').value = ''; setProjectColor(null); $('#links').value = ''; updateStartupSummary();
}
async function loadStartup() {
  const request = navigationRequest, owner = selectedOwner();
  ++startupLoads; syncCreateAvailability();
  try {
  const result = await call('preferencesGet', undefined, owner);
  if (request !== navigationRequest) return;
  renderStartupConnections();
  $('#startup-hosting').value = result.values.hosting; $('#startup-connection').value = result.values.connectionID; $('#tests').value = result.values.tests; $('#design-select').value = result.values.designID;
  $('#startup-warning').textContent = result.warnings.join(' ');
  if (result.values.designID) {
    try { const design = await call('applyDesign', result.values.designID, owner); if (request !== navigationRequest) return; setProjectColor(design.color); $('#links').value = design.links.join('\n'); showAssets(design.assets); }
    catch { if (request !== navigationRequest) return; await clearStartupDesign(); $('#startup-warning').textContent = 'Designpakken kunne ikke indlæses. Vælg en anden, eller fortsæt uden design.'; }
  }
  for (const selector of ['#project-options', '#design-options']) $(selector).open = false;
  updateStartupSummary();
  } finally { --startupLoads; syncCreateAvailability(); }
}
$('#forget-startup').onclick = () => action(async () => { await call('preferencesSave', { hosting: '', connectionID: '', designID: '', tests: 'senere' }); $('#startup-warning').textContent = 'De huskede valg er glemt. Valgene her er bevaret.'; });
for (const selector of ['#startup-hosting', '#startup-connection', '#tests']) $(selector).addEventListener('change', updateStartupSummary);
$('#model-load').onclick = () => action(() => loadModels(state?.projectSettings.selection?.connectionID === $('#connection-select').value ? state.projectSettings.selection : {}));


// Introduktionen vælger kun brugerrejse. Den giver ingen model- eller værktøjstilladelser.
const introductionKey = 'harness.introduction.v1';
const ideaDraftKey = 'harness.ideaDraft.v1';
let nameTouched = false;
function completeIntroduction(mode) {
  try { localStorage.setItem(introductionKey, mode); } catch {}
}
function showIntroduction(step = 'path') {
  $('#welcome-path').hidden = step !== 'path'; $('#welcome-start').hidden = step !== 'start'; $('#welcome-demo').hidden = true;
  $('#welcome-dialog').setAttribute('aria-labelledby', step === 'path' ? 'welcome-path-title' : 'welcome-title');
  document.body.classList.add('introduction-open'); if (!$('#welcome-dialog').open) $('#welcome-dialog').showModal(); $(step === 'path' ? '#welcome-path-title' : '#welcome-title').focus();
}
function closeIntroduction() { document.body.classList.remove('introduction-open'); $('#welcome-dialog').close(); }
function leaveIntroduction() {
  if (setupActive) action(() => leaveSetup(false));
  completeIntroduction('skipped'); closeIntroduction();
  (current ? $('#prompt') : $('#purpose')).focus();
}
$('#welcome-skip').onclick = leaveIntroduction;
$('#welcome-dialog').addEventListener('close', () => { if (!$('#welcome-dialog').open) document.body.classList.remove('introduction-open'); });
$('#welcome-dialog').addEventListener('cancel', event => { event.preventDefault(); leaveIntroduction(); });
$('#intro-button').onclick = () => showIntroduction();
$('#setup-back').onclick = () => { if (setupStep === 'features-pick') setupPage('features'); else if (setupStep === 'provider' && $('#setup-provider').dataset.view === 'details') providerPicker(); else if (setupStep !== 'choice') setupPage('choice'); else if (repeatSetup) action(() => leaveSetup(false)); else if (guidedSetup) showIntroduction('start'); else action(() => leaveSetup(false)); };
async function beginGuidedProject() {
  if (current) { await $('#new').onclick(); if (current) return; }
  closeIntroduction(); showSetup('', true);
}
$('#welcome-build').onclick = () => action(beginGuidedProject);
$('#demo-build').onclick = () => action(beginGuidedProject);
$('#welcome-open').onclick = () => action(async () => {
  const project = await call('openProject');
  if (!project) return;
  completeIntroduction('opened'); closeIntroduction(); await displayProject(project);
});
function demoPreview(list) {
  $('#demo-preview').srcdoc = `<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="harness://app/demo.css"><small>BIBLIOTEKET · DEMONSTRATION</small><h1>Det sker på biblioteket</h1><section class="${list?'list':'cards'}"><article><strong>Læseklub</strong><p>Tirsdag · kl. 16</p></article><article><strong>Hjælp til din computer</strong><p>Torsdag · kl. 10</p></article></section></html>`;
  $('#demo-answer').textContent = list ? 'Nu vises aktiviteterne som en liste. I dit eget projekt beskriver du ændringerne i samtalen.' : 'Her er et eksempel med to aktiviteter. Prøv at ændre visningen.';
  $('#demo-change').textContent = list ? 'Vis aktiviteterne som kort' : 'Vis aktiviteterne som en liste';
  $('#demo-change').dataset.list = String(list);
}
$('#welcome-example').onclick = () => { $('#welcome-start').hidden = true; $('#welcome-demo').hidden = false; $('#welcome-dialog').setAttribute('aria-labelledby', 'demo-title'); demoPreview(false); $('#demo-title').focus(); };
$('#demo-change').onclick = () => demoPreview($('#demo-change').dataset.list !== 'true');
$('#demo-back').onclick = () => showIntroduction('start');
$('#path-app').onclick = () => showIntroduction('start');
$('#welcome-back').onclick = () => showIntroduction('path');
$('#path-tools').onclick = () => { completeIntroduction('tools'); closeIntroduction(); openTools(); };
$('#tools-button').onclick = () => openTools();

// Aura Harness i brugerens eget kodeværktøj. Ét spørgsmål pr. trin; hovedprocessen vælger mappen og skriver filerne efter en gennemgang.
let toolsCatalog = null, toolsFolder = null, toolsChoice = null, toolsReviewState = null, toolsSkills = null;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const operationText = { opret: 'Opret', tilfoej: 'Tilføj afsnit', opdater: 'Opdatér', uaendret: 'Uændret', konflikt: 'Ændret af dig · røres ikke', fjern: 'Fjern', 'fjern-afsnit': 'Fjern afsnit', bevar: 'Bevares' };
async function toolsAction(fn) {
  $('#tools-error').hidden = true;
  try { return await fn(); } catch (error) { $('#tools-error').textContent = error.message; $('#tools-error').hidden = false; }
}
function toolsStep(step) {
  for (const id of ['choose', 'folder', 'review', 'skills', 'done', 'remove']) $(`#tools-step-${id}`).hidden = id !== step;
  $(`#tools-${step}-title`).focus();
}
const toolById = id => toolsCatalog.tools.find(tool => tool.id === id);
async function copyText(text, button) {
  const label = button.textContent;
  try { await call('clipboardWrite', text); button.textContent = 'Kopieret'; } catch { button.textContent = 'Kunne ikke kopiere'; }
  setTimeout(() => { button.textContent = label; }, 1800);
}
function toolCard(tool) {
  const button = node('button', undefined, 'tools-card'); button.type = 'button'; button.dataset.tool = tool.id;
  button.append(node('strong', tool.name), node('span', tool.summary));
  button.onclick = () => chooseTool(tool.id);
  return button;
}
function renderAllTools(query) {
  const words = query.trim().toLocaleLowerCase('da');
  const others = toolsCatalog.tools.filter(tool => !toolsCatalog.featuredTools.includes(tool.id) && (!words || `${tool.name} ${tool.vendor}`.toLocaleLowerCase('da').includes(words)));
  $('#tools-list').replaceChildren(...(others.length ? others.map(tool => {
    const row = node('div', undefined, 'tools-row');
    const text = node('span'); text.append(node('strong', tool.name), node('small', tool.installable ? ` · ${tool.vendor}` : ` · ${tool.vendor} · kopiér teksten til platformens egne felter`));
    const button = node('button', tool.installable ? 'Vælg' : 'Kopiér tekst'); button.type = 'button'; button.dataset.tool = tool.id;
    button.onclick = tool.installable ? () => chooseTool(tool.id) : () => copyText(toolsCatalog.knowledge, button);
    row.append(text, button); return row;
  }) : [node('p', 'Ingen værktøjer passer til søgningen.', 'hint')]));
}
function renderToolsCatalog() {
  // Integrationer følger ikke med, før man vælger dem, så tallet her er de skills, der installeres som standard.
  const base = toolsCatalog.skills.filter(skill => !skill.integration).length, extra = toolsCatalog.skills.length - base;
  $('#tools-skill-count').textContent = base;
  $('#tools-included-summary').textContent = `Hvad følger med? Grundregler og ${base} skills${extra ? ` · ${extra} ${extra === 1 ? 'integration' : 'integrationer'} kan vælges til` : ''}`;
  $('#tools-skills').replaceChildren(...toolsCatalog.skills.map(skill => {
    const details = node('details', undefined, 'tools-skill');
    const summary = node('summary'); summary.append(node('strong', skill.title), node('span', ` · ${skill.summary}`));
    const list = node('dl');
    for (const [label, key] of [['Hvad gør den?', 'hvad'], ['Hvornår bruges den?', 'hvornaar'], ['Hvad får du?', 'resultat'], ['Hvad gør den ikke?', 'ikke']]) list.append(node('dt', label), node('dd', skill.faq[key]));
    details.append(summary, list);
    return details;
  }));
  $('#tools-featured').replaceChildren(...toolsCatalog.featuredTools.map(id => toolCard(toolById(id))));
  renderAllTools('');
}
$('#tools-more').onclick = () => { $('#tools-all').hidden = false; $('#tools-more').hidden = true; $('#tools-search').focus(); };
$('#tools-search').oninput = () => renderAllTools($('#tools-search').value);
async function openTools() {
  $('#tools-error').hidden = true;
  if (!$('#tools-dialog').open) $('#tools-dialog').showModal();
  await toolsAction(async () => { toolsCatalog ??= await call('toolsCatalog'); renderToolsCatalog(); });
  $('#tools-all').hidden = true; $('#tools-more').hidden = false; $('#tools-search').value = '';
  toolsStep('choose');
}
function chooseTool(id) {
  toolsChoice = id;
  $('#tools-folder-lead').textContent = `Vælg den mappe, du åbner i ${toolById(id).name}. Det er ofte den mappe, hvor README.md og .git ligger.`;
  toolsStep('folder');
}
$('#tools-back-choose').onclick = () => toolsStep('choose');
$('#tools-folder').onclick = () => toolsAction(async () => {
  const folder = await call('toolsFolder');
  if (!folder) return;
  toolsFolder = folder;
  // Et tidligere udvalg bevares; ellers følger alle skills med undtagen integrationer, som man vælger til.
  toolsSkills = new Set(folder.manifest?.skills || toolsCatalog.skills.filter(skill => !skill.integration).map(skill => skill.name));
  await reviewTools();
});
// Resumé i almindeligt dansk. De præcise filændringer ligger under "Se de præcise ændringer".
function planLines(review) {
  const lines = [];
  const active = review.operations.filter(op => !['uaendret', 'konflikt', 'bevar'].includes(op.action));
  for (const op of active.filter(item => item.kind === 'blok' && item.path !== '.gitignore')) {
    const pointer = /@AGENTS\.md/.test(op.preview || '');
    const removing = op.action === 'fjern' || op.action === 'fjern-afsnit';
    if (removing) lines.push(`Aura Harness-afsnittet i ${op.path} fjernes.`);
    else if (pointer) lines.push(op.action === 'opret' ? `${op.path} oprettes med en henvisning til AGENTS.md.` : op.action === 'tilfoej' ? `${op.path} får en henvisning til AGENTS.md. Dine egne regler bevares.` : `Henvisningen i ${op.path} opdateres.`);
    else lines.push(op.action === 'opret' ? `Grundreglerne lægges i en ny ${op.path}.` : op.action === 'tilfoej' ? `Grundreglerne tilføjes nederst i ${op.path}. Dine egne regler bevares.` : `Grundreglerne i ${op.path} opdateres til version ${review.version}.`);
  }
  const skills = new Map();
  for (const op of active.filter(item => /\/harness-[a-z0-9-]+\//.test(item.path))) {
    const [, dir, name] = /^(.*)\/(harness-[a-z0-9-]+)\//.exec(op.path);
    const key = `${dir}|${op.action === 'fjern' ? 'fjern' : op.action === 'opret' ? 'opret' : 'opdater'}`;
    if (!skills.has(key)) skills.set(key, new Set());
    skills.get(key).add(name);
  }
  for (const [key, names] of skills) {
    const [dir, kind] = key.split('|');
    lines.push(kind === 'opret' ? `${plural(names.size, 'skill', 'skills')} lægges i ${dir}.` : kind === 'fjern' ? `${plural(names.size, 'skill', 'skills')} fra en tidligere installation fjernes fra ${dir}.` : `${plural(names.size, 'skill', 'skills')} opdateres i ${dir}.`);
  }
  const ignore = active.find(item => item.path === '.gitignore');
  if (ignore) lines.push(ignore.action === 'opret' ? 'En ny .gitignore holder hemmeligheder og lokale filer ude af Git.' : ignore.action === 'tilfoej' ? '.gitignore får et afsnit, der holder hemmeligheder og lokale filer ude af Git.' : 'Afsnittet i .gitignore opdateres.');
  if (active.some(item => item.path.startsWith('.harness/') && item.action === 'opret')) lines.push('En kort forklaring og en oversigt over installationen lægges i .harness.');
  return lines;
}
function reviewNotes(review) {
  const notes = [];
  if (review.conflicts) notes.push(`${plural(review.conflicts, 'fil er', 'filer er')} ændret af dig og bliver ikke rørt.`);
  if (review.git.initialized === false) notes.push('Mappen bruger ikke Git, så ændringerne kan ikke fortrydes med en tidligere version.');
  else if (review.git.changes) notes.push(`Der er ${plural(review.git.changes, 'ændring', 'ændringer')}, som ikke er gemt i Git. Gem gerne en version først, så Aura Harness' ændringer kan ses for sig.`);
  if (review.ignored === null) notes.push('Det kunne ikke kontrolleres, om projektets .gitignore udelader nogle af filerne.');
  else if (review.ignored.length) {
    const groups = new Map();
    for (const file of review.ignored) { const dir = review.dirs.find(item => file.startsWith(`${item}/`)); const key = dir ? `${dir}/` : file; groups.set(key, (groups.get(key) || 0) + 1); }
    const summary = [...groups].map(([key, count]) => key.endsWith('/') ? `${key} (${plural(count, 'fil', 'filer')})` : key).join(', ');
    notes.push(`Projektets .gitignore udelader ${summary}. Filerne kommer ikke med, når andre henter projektet. Ret .gitignore, hvis de skal deles.`);
  }
  return [...notes, ...review.warnings];
}
function renderOperations(target, operations) {
  const groups = new Map();
  for (const op of operations) { if (!groups.has(op.action)) groups.set(op.action, []); groups.get(op.action).push(op); }
  target.replaceChildren(...[...groups].map(([actionName, ops]) => {
    const details = node('details', undefined, `tools-ops tools-ops-${actionName}`);
    details.open = ['konflikt', 'tilfoej', 'bevar'].includes(actionName) || ops.length <= 4;
    details.append(node('summary', `${operationText[actionName]} · ${ops.length}`));
    const list = node('ul');
    for (const op of ops) {
      const item = node('li'); item.append(node('code', op.path));
      if (op.reason) item.append(node('span', ` ${op.reason}`, 'hint'));
      if (op.preview) { const view = node('details'); view.append(node('summary', op.kind === 'blok' ? 'Se afsnittet' : 'Se filen'), node('pre', op.preview)); item.append(view); }
      list.append(item);
    }
    details.append(list);
    return details;
  }));
}
// Integrationer vælges til for de systemer, man bruger. De tælles for sig og står aldrig som fravalgte skills.
function skillChoice(chosen) {
  const base = toolsCatalog.skills.filter(skill => !skill.integration);
  return { base, left: base.filter(skill => !chosen.has(skill.name)), integrations: toolsCatalog.skills.filter(skill => skill.integration && chosen.has(skill.name)) };
}
async function reviewTools() {
  const installed = toolsFolder.manifest?.tools || [];
  const review = await call('toolsReview', { tools: [...new Set([...installed, toolsChoice])], skills: [...toolsSkills] });
  toolsReviewState = review;
  const name = toolById(toolsChoice).name;
  const nothing = review.operations.every(op => op.action === 'uaendret');
  const others = installed.filter(id => id !== toolsChoice).map(id => toolById(id)?.name || id);
  $('#tools-review-summary').textContent = nothing ? `Aura Harness er allerede installeret til ${name} i ${review.folder}. Intet ændres.` : others.length && !installed.includes(toolsChoice) ? `Aura Harness er allerede installeret til ${others.join(', ')} i ${review.folder}. ${name} tilføjes, når du installerer:` : `Det sker i ${review.folder}, når du installerer til ${name}:`;
  const { base, left, integrations } = skillChoice(toolsSkills);
  $('#tools-skills-status').textContent = `Skills: ${base.length - left.length} af ${base.length} valgt${left.length ? ` · fravalgt: ${left.map(skill => skill.title).join(', ')}` : ''}${integrations.length ? ` · integrationer: ${integrations.map(skill => skill.title).join(', ')}` : ''}`;
  const lines = planLines(review);
  $('#tools-plan').replaceChildren(...lines.map(text => node('li', text))); $('#tools-plan').hidden = !lines.length;
  const notes = reviewNotes(review);
  $('#tools-notes').replaceChildren(...notes.map(text => node('li', text))); $('#tools-notes').hidden = !notes.length;
  renderOperations($('#tools-operations'), review.operations);
  $('#tools-install').textContent = nothing ? 'Registrér installationen' : review.conflicts ? 'Installer resten' : 'Installer';
  toolsStep('review');
}
// Udvælgelse som i en cookie-dialog: kategorier kan slås til og fra samlet, og hver kan foldes ud til de enkelte skills.
function renderSkillPicker() {
  $('#tools-categories').replaceChildren(...toolsCatalog.categories.map(category => {
    const box = node('div', undefined, 'skill-category');
    const head = node('div', undefined, 'skill-category-head');
    const label = node('label', undefined, 'check-label');
    const toggle = node('input'); toggle.type = 'checkbox'; toggle.dataset.category = category.id;
    const text = node('span'); text.append(node('strong', category.title), node('small', '', 'skill-count'), node('small', category.summary));
    label.append(toggle, text);
    const expand = node('button', 'Vis skills', 'text-button'); expand.type = 'button'; expand.setAttribute('aria-expanded', 'false');
    const list = node('div', undefined, 'skill-list'); list.hidden = true;
    expand.onclick = () => { list.hidden = !list.hidden; expand.setAttribute('aria-expanded', String(!list.hidden)); expand.textContent = list.hidden ? 'Vis skills' : 'Skjul skills'; };
    for (const name of category.skills) {
      const skill = toolsCatalog.skills.find(item => item.name === name);
      const row = node('label', undefined, 'check-label');
      const input = node('input'); input.type = 'checkbox'; input.dataset.skill = name; input.checked = toolsSkills.has(name);
      input.onchange = updateSkillPicker;
      const detail = node('span'); detail.append(node('strong', skill.title), node('small', skill.summary));
      row.append(input, detail); list.append(row);
    }
    toggle.onchange = () => { for (const input of list.querySelectorAll('input')) input.checked = toggle.checked; updateSkillPicker(); };
    head.append(label, expand); box.append(head, list);
    return box;
  }));
  updateSkillPicker();
}
function updateSkillPicker() {
  for (const category of toolsCatalog.categories) {
    const inputs = [...document.querySelectorAll(`#tools-categories input[data-skill]`)].filter(input => category.skills.includes(input.dataset.skill));
    const chosen = inputs.filter(input => input.checked).length;
    const toggle = document.querySelector(`#tools-categories input[data-category="${category.id}"]`);
    toggle.checked = chosen === inputs.length; toggle.indeterminate = chosen > 0 && chosen < inputs.length;
    toggle.closest('.skill-category').querySelector('.skill-count').textContent = `${chosen} af ${inputs.length}`;
  }
  const { base, left, integrations } = skillChoice(new Set([...document.querySelectorAll('#tools-categories input[data-skill]:checked')].map(input => input.dataset.skill)));
  $('#tools-skill-total').textContent = `${base.length - left.length} af ${base.length} skills valgt${integrations.length ? ` og ${integrations.length} ${integrations.length === 1 ? 'integration' : 'integrationer'}` : ''}. Grundreglerne er altid med.`;
}
$('#tools-customize').onclick = () => { renderSkillPicker(); toolsStep('skills'); };
// Vælg alle skills gælder ikke integrationerne; dem vælger man enkeltvis.
$('#tools-skills-all').onclick = () => { for (const input of document.querySelectorAll('#tools-categories input[data-skill]')) if (!toolsCatalog.skills.find(skill => skill.name === input.dataset.skill).integration) input.checked = true; updateSkillPicker(); };
$('#tools-skills-back').onclick = () => toolsStep('review');
$('#tools-skills-save').onclick = () => toolsAction(async () => {
  toolsSkills = new Set([...document.querySelectorAll('#tools-categories input[data-skill]')].filter(input => input.checked).map(input => input.dataset.skill));
  await reviewTools();
});
$('#tools-back').onclick = () => toolsStep('folder');
$('#tools-install').onclick = () => toolsAction(async () => {
  const result = await call('toolsInstall', { skipConflicts: Boolean(toolsReviewState?.conflicts) });
  const tool = toolById(toolsChoice);
  toolsFolder = { ...toolsFolder, manifest: { version: result.version, tools: result.tools } };
  $('#tools-prompt-intro').closest('.tools-prompt').hidden = false; $('#tools-verify').closest('details').hidden = false; $('#tools-removal').hidden = false; $('#tools-reveal').hidden = false;
  $('#tools-done-title').textContent = `${tool.name} kan nu bruge Aura Harness`;
  $('#tools-done-summary').textContent = `Grundreglerne og ${plural(result.skills.length, 'skill', 'skills')} ligger i ${result.folder}.${result.skipped.length ? ` ${plural(result.skipped.length, 'fil, du har ændret, er', 'filer, du har ændret, er')} ikke rørt.` : ''} Gennemgå ændringerne i Git, før du gemmer en version.`;
  $('#tools-prompt-intro').textContent = `Åbn ${result.folder} i ${tool.name}, start en ny samtale, og skriv:`;
  $('#tools-prompt-text').textContent = 'Hvilke projektinstruktioner og skills fra Aura Harness har du adgang til? Hvad er kontrolordet i Aura Harness-profilen? Ændr ingen filer.';
  $('#tools-prompt-text').dataset.expect = `Svaret bør nævne kontrolordet ${toolsCatalog.controlWord}.`;
  $('#tools-verify-summary').textContent = `Sådan kontrollerer du det i ${tool.name}`;
  $('#tools-verify').replaceChildren(...result.tools.map(id => { const item = toolById(id); const box = node('div'); box.append(node('strong', item.name), node('p', item.verification), node('p', item.caveat, 'hint')); return box; }), node('p', $('#tools-prompt-text').dataset.expect, 'hint'));
  toolsStep('done');
});
$('#tools-copy-prompt').onclick = () => copyText($('#tools-prompt-text').textContent, $('#tools-copy-prompt'));
$('#tools-reveal').onclick = () => toolsAction(() => call('toolsReveal'));
$('#tools-done').onclick = () => $('#tools-dialog').close();
$('#tools-removal').onclick = () => toolsAction(async () => { renderOperations($('#tools-remove-operations'), (await call('toolsRemoval')).operations); toolsStep('remove'); });
$('#tools-remove-back').onclick = () => toolsStep('done');
$('#tools-remove').onclick = () => toolsAction(async () => {
  const result = await call('toolsRemove');
  toolsFolder = { ...toolsFolder, manifest: null };
  $('#tools-done-title').textContent = 'Aura Harness er fjernet';
  $('#tools-done-summary').textContent = `Aura Harness er fjernet fra ${result.folder}.${result.kept.length ? ` Disse filer, du har ændret, er bevaret: ${result.kept.join(', ')}.` : ''}`;
  $('#tools-prompt-intro').closest('.tools-prompt').hidden = true; $('#tools-verify').closest('details').hidden = true; $('#tools-removal').hidden = true; $('#tools-reveal').hidden = true;
  toolsStep('done');
});
$('#provider-account').onclick = () => action(() => call('providerAccount', $('#provider-kind').value));
function renderLocation(location) { $('#project-location').textContent = `Projektet gemmes i ${location.label}.`; $('#project-location').title = location.path; }
$('#choose-location').onclick = () => action(async () => renderLocation(await call('chooseProjectLocation')));
function saveIdeaDraft() {
  try { localStorage.setItem(ideaDraftKey, JSON.stringify({name: $('#name').value, purpose: $('#purpose').value, nameTouched})); $('#idea-draft-status').textContent = 'Kladden er gemt på denne computer.'; } catch { $('#idea-draft-status').textContent = 'Kladden kan ikke gemmes automatisk på denne computer.'; }
}
function clearIdeaDraft() { try { localStorage.removeItem(ideaDraftKey); } catch {} }
function restoreIdeaDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(ideaDraftKey));
    if (draft && typeof draft.name === 'string' && typeof draft.purpose === 'string') {
      $('#name').value = draft.name.slice(0,80); $('#purpose').value = draft.purpose.slice(0,3000); nameTouched = draft.nameTouched === true;
    }
  } catch {}
}
$('#name').addEventListener('input', () => { nameTouched = true; saveIdeaDraft(); });
// Et kort navneforslag ud fra idéen: det, der skal laves, uden resten af sætningen. Brugeren kan altid rette det.
const genericNames = new Set(['side', 'app', 'hjemmeside', 'webside', 'løsning', 'værktøj', 'system', 'program', 'platform', 'portal', 'oversigt', 'liste', 'formular', 'applikation', 'prototype', 'tjeneste', 'webapp']);
function suggestName(purpose) {
  const text = purpose.trim().replace(/^(jeg|vi)\s+(vil|skal|ønsker at|kunne godt tænke (mig|os) at)\s+(gerne\s+)?(lave|bygge|skabe|have|udvikle)\s+/i, '').replace(/^(en|et|nogle|min|mit|mine|vores)\s+/i, '');
  let words = text.split(/[,.;:!?\n]|\s(?:hvor|som|der|så|til at|for at)\s/i)[0].trim().split(/\s+/).filter(Boolean);
  if (words.length === 1 && genericNames.has(words[0].toLocaleLowerCase('da'))) {
    const place = /(?:^|\s)(?:i|til|for|om|på)\s+(?:vores|min|mit|mine|jeres|den|det|de)?\s*([\p{L}-]{4,}(?:\s+[\p{L}-]+){0,2})/iu.exec(text);
    words = place ? place[1].split(/\s+/) : text.split(/\s+/).slice(0, 5);
  }
  const name = words.slice(0, 5).join(' ');
  return (name.charAt(0).toLocaleUpperCase('da') + name.slice(1)).slice(0, 80);
}
$('#purpose').addEventListener('input', () => {
  if (!nameTouched) $('#name').value = suggestName($('#purpose').value);
  saveIdeaDraft(); showIdeaExamples();
});
// Tre faste eksempler på idéer, der virker som en lokal side uden server. Et eksempel udfylder kun idéen og navnet;
// AI'en bygger det først, når du starter projektet. De vises kun, når idéfeltet er tomt, så intet overskrives.
const ideaExamples = [
  { title: 'Tilmelding til arrangementer', hint: 'Kommende arrangementer med tilmelding', name: 'Arrangementer og tilmelding', purpose: 'En side med vores kommende arrangementer, hvor man kan se dato, sted og en kort beskrivelse og tilmelde sig med navn og e-mail. Tilmeldingerne gemmes i browseren, så siden virker uden server, og arrangøren kan se en liste over de tilmeldte.' },
  { title: 'Tjekliste til nye kolleger', hint: 'Første arbejdsdag med flueben', name: 'Tjekliste til nye kolleger', purpose: 'En tjekliste til nye kolleger på deres første arbejdsdag, hvor de kan sætte flueben ved hver opgave, se hvor meget der mangler, og printe listen. Fluebenene huskes i browseren.' },
  { title: 'Quiz om Danmarkshistorie', hint: 'Ti spørgsmål og en score til sidst', name: 'Quiz om Danmarkshistorie', purpose: 'En quiz med ti spørgsmål om Danmarkshistorie. Man ser ét spørgsmål ad gangen med fire svarmuligheder, får at vide, om svaret var rigtigt, og ser sin score til sidst med mulighed for at prøve igen.' }
];
function showIdeaExamples() {
  const empty = !$('#purpose').value.trim();
  $('#idea-examples-row').hidden = !empty;
  if (!empty) { $('#idea-examples').hidden = true; $('#idea-examples-toggle').setAttribute('aria-expanded', 'false'); }
}
$('#idea-examples').replaceChildren(...ideaExamples.map(example => {
  const button = node('button', undefined, 'idea-example'); button.type = 'button';
  button.append(node('strong', example.title), node('span', example.hint));
  button.onclick = () => {
    $('#purpose').value = example.purpose; $('#name').value = example.name; nameTouched = false;
    saveIdeaDraft(); showIdeaExamples();
    const field = $('#purpose'); field.focus(); field.setSelectionRange(field.value.length, field.value.length);
    message('Eksemplet er sat ind. Ret det til, eller start projektet, så bygger AI’en det.');
  };
  return button;
}));
$('#idea-examples-toggle').onclick = () => {
  const open = $('#idea-examples').hidden;
  $('#idea-examples').hidden = !open; $('#idea-examples-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#idea-examples .idea-example').focus();
};
try { if (!localStorage.getItem(introductionKey)) showIntroduction(); } catch { showIntroduction(); }

// Det guidede forløb ændrer aldrig model, rute eller betaling uden et aktivt valg.
let modelCatalog = [], activePlan = null;
function modelDescription(model) {
  const price = model.price;
  const known = price && price.prompt != null && price.completion != null && Number.isFinite(Number(price.prompt)) && Number.isFinite(Number(price.completion));
  const cost = !known ? 'Kataloget oplyser ingen pris' : Number(price.prompt) === 0 && Number(price.completion) === 0 ? '0 USD for input/output*' : `${Number(price.prompt) * 1e6} / ${Number(price.completion) * 1e6} ${price.currency === 'DKK' ? 'DKK' : 'USD'} pr. mio. input-/outputtokens`;
  return `${cost} · ${model.capabilities?.tools === true ? 'Værktøjskald angivet i kataloget' : model.capabilities?.tools === false ? 'Ingen værktøjskald angivet' : 'Kodeværktøjer ikke verificeret'}`;
}
// For udbyderne i opsætningen vælges udbyderens eget udgangspunkt på forhånd. Det er ikke en anbefaling fra appen; modellen står under skrivefeltet og i resuméet før første afsendelse.
function preselectRecommended(connectionID) {
  const kind = state.connections.find(c => c.id === connectionID)?.kind;
  if (!featuredProviders.some(item => item.kind === kind)) return;
  const { defaultID } = window.ModelAdvice.suggest(modelCatalog, kind);
  if (defaultID) $('#model-select').value = defaultID;
}
function markChosenModel() { for (const button of document.querySelectorAll('#model-shortlist .model-choice')) button.setAttribute('aria-pressed', String(button.dataset.model === $('#model-select').value)); }
function renderShortlist() {
  const kind = state.connections.find(c => c.id === $('#connection-select').value)?.kind;
  const { curated, defaultID, picks } = window.ModelAdvice.suggest(modelCatalog, kind);
  $('#model-shortlist').replaceChildren();
  for (const { model, text } of picks) {
    const button = node('button', undefined, 'model-choice'); button.type = 'button'; button.dataset.model = model.id;
    const heading = node('strong', undefined, 'provider-brand-heading'), logo = window.ProviderBrand.icon(kind, document);
    if (logo) heading.append(logo);
    heading.append(node('span', model.name));
    button.append(heading, node('span', text));
    // Et klik vælger modellen og lukker dialogen. Kun OpenRouter kræver bagefter et valg af udbyder.
    button.onclick = () => action(async () => {
      if ($('#model-select').value !== model.id) view.effort = null;
      $('#model-select').value = model.id; $('#model-evidence').textContent = `${model.name}: ${modelDescription(model)}. Modtager: ${state.connections.find(c => c.id === $('#connection-select').value)?.name || 'valgt forbindelse'}.`;
      markChosenModel(); updateModelSummary(); await loadRoutes();
      if ($('#route-row').hidden) { $('#model-options').open = false; $('#task-dialog').close(); $('#prompt').focus(); }
    });
    $('#model-shortlist').append(button);
  }
  // Modellen øverst er udbyderens eget udgangspunkt, ikke appens anbefaling. Det står synligt; resten ligger bag ⓘ.
  const hint = node('p', !picks.length ? 'Ingen forslag fra din forbindelse. Se alle modeller nedenfor.' : defaultID ? 'Den første er udbyderens eget udgangspunkt.' : 'Et udvalg fra din forbindelse.', 'hint');
  if (picks.length) hint.append(info('modellerne', `${curated ? 'Aura anbefaler ingen model. ' : ''}Du ser pris og modtager, før noget sendes.`));
  $('#model-shortlist').append(hint);
  markChosenModel();
}
$('#model-search').oninput = () => { const query = $('#model-search').value.toLocaleLowerCase(); for (const item of $('#model-select').options) item.hidden = Boolean(item.value && item.value !== $('#model-select').value && !item.textContent.toLocaleLowerCase().includes(query)); };
function updateWorkMode() {
  const mode = $('#work-mode').value;
  view.composerMode = mode;
  $('#composer-mode').textContent = ({ chat: 'Samtale', plan: 'Planlæg', build: 'Byg', free: 'Byg' })[mode];
  $('#prompt').placeholder = window.workspace?.target() ? 'Hvad skal AI’en ændre her? Fx Gør teksten kortere.' : mode === 'chat' ? 'Stil et spørgsmål, eller beskriv din idé …' : 'Beskriv det, du vil bygge eller ændre …';
  $('#mode-help').textContent = mode === 'chat' ? 'Tal med AI’en om projektet. Filerne ændres ikke.' : mode === 'plan' ? 'Lav en plan sammen med AI’en, før den ændrer appen.' : mode === 'build' ? 'AI’en bygger efter den plan, du har valgt. Handlinger kræver fortsat godkendelse.' : 'AI’en ændrer appen efter din besked og projektets tilladelser.';
}
$('#work-mode').onchange = () => {
  if (['chat', 'plan'].includes(view.composerMode) && ['free', 'build'].includes($('#work-mode').value)) $('#include-history').checked = true;
  view.modeChosen = true; acceptedFingerprint = null; updateWorkMode();
  view.ideaApproach = false; updateIdeaApproach();
  if ($('#work-mode').value === 'chat') { view.planCard = false; $('#plan-card').hidden = true; }
};
$('#composer-mode').onclick = () => { $('#task-dialog').showModal(); $('#task-dialog .workflow').open = true; $('#work-mode').focus(); };
$('#accept-plan-offer').onclick = () => {
  if (running) return;
  if (activePlan) { view.planCard = true; $('#plan-card').hidden = false; updatePlanOffer(); $('#build-plan').focus(); return; }
  $('#work-mode').value = 'plan'; updateWorkMode(); view.planOffer = false; $('#plan-offer').hidden = true;
  if (!$('#prompt').value.trim()) $('#prompt').value = 'Lad os lave en plan for det, vi har talt om.';
  $('#include-history').checked = true; acceptedFingerprint = null; saveChatDraft(); $('#prompt').focus();
};
$('#dismiss-plan-offer').onclick = () => action(async () => {
  view.planOffer = false; $('#plan-offer').hidden = true;
  await call('saveDraft', { root: current.root, chat: view.id, text: $('#prompt').value, mode: $('#work-mode').value, dismissPlanOffer: true });
  $('#prompt').focus();
});
$('#revise-plan').onclick = () => {
  if (!activePlan || running) return;
  $('#work-mode').value = 'plan'; updateWorkMode();
  if (!$('#prompt').value.trim()) $('#prompt').value = 'Ret forslaget: ';
  saveChatDraft(); $('#prompt').focus();
};
$('#build-plan').onclick = () => {
  if (!activePlan || running) return;
  if ($('#prompt').value.trim()) { message('Send eller ryd din beskedkladde, før du bygger planen.'); return; }
  $('#work-mode').value = 'build'; $('#include-history').checked = true; updateWorkMode(); acceptedFingerprint = null;
  $('#prompt').value = 'Byg første udkast efter den plan, jeg har gennemgået. Afslut med konkrete ting, jeg skal prøve i forhåndsvisningen.';
  $('#chat-form').requestSubmit();
};
// Resultatkortet kvitterer for ændringerne. Værktøjer og kontrolresultater står i Aktivitet.
// En plain afvisning stopper opgaven i OpenCode; kortet siger det i stedet for at give modellen skylden.
function updatePlanOffer(v = view) {
  // Et konkret forslag har allerede næste handling. En sen markør må ikke starte en ny planrunde.
  if (v.plan || v.buildOffer) v.planOffer = false;
  if (v === view) $('#plan-offer').hidden = !v.planOffer;
}
const reviewButton = (text, onClick, primary = false) => { const button = node('button', text, primary ? 'primary' : undefined); button.type = 'button'; button.onclick = onClick; return button; };
const retrySend = () => { if (running) return; if (!$('#prompt').value.trim()) $('#prompt').value = view.lastSentText; $('#send').click(); };
function reviewFiles(box, result) {
  if (!result.files?.length) return;
  if (!result.task) return;
  // Hver fil åbner sin linje-diff under Ændringer. Brugeren vælger selv at skifte fane.
  const list = node('ul', undefined, 'review-files');
  for (const file of [...result.files].sort((a, b) => a.localeCompare(b, 'da')).slice(0, 6)) { const item = node('li'), link = node('button', file, 'file-ref'); link.type = 'button'; link.dataset.path = file; link.dataset.change = result.task; link.title = `Se ændringerne i ${file}`; item.append(link); list.append(item); }
  if (result.files.length > 6) list.append(node('li', `og ${result.files.length - 6} flere`, 'hint'));
  box.append(list);
}
const filesText = (count, prefix) => count ? `${prefix} ${count} ${count === 1 ? 'fil' : 'filer'}:` : '';
// Fortryd opgaven: kun opgavens egne ændringer fjernes, og det, du har rettet siden, bevares. Er opgaven gemt som
// version, fortrydes versionen; ellers bruges Auras øjebliksbillede, så længe appen er åben. Begge veje gennemgås først.
function undoAction(result, label, title, v = view) {
  if (!result.files.length || !result.task || v.undoneTasks?.has(result.task)) return null;
  const checkpoint = v.lastCheckpoint?.status === 'saved' && v.lastCheckpoint.head ? v.lastCheckpoint : null, task = shortLabel(v.lastSentText);
  const button = reviewButton(label, () => action(() => reviewRestoration(checkpoint ? { revert: checkpoint.head } : { task: result.task }, { title, confirm: title, label: `Fortrudt: ${task}`, taskUndo: true, taskID: result.task })));
  button.classList.add('text-button'); return button;
}
function resultActions(result, v = view) {
  const actions = node('div', undefined, 'review-actions');
  if (result.files.length && result.task) {
    const changes = reviewButton(v.reviewedTask === result.task ? 'Ændringer gennemgået' : 'Se ændringer', () => action(async () => {
      await window.workspace.showChange(result.task);
      v.reviewedTask = result.task; changes.textContent = 'Ændringer gennemgået';
      v.review.classList.add('is-reviewed');
      for (const details of v.review.querySelectorAll('details')) details.open = false;
    }));
    actions.append(changes);
  }
  const undo = undoAction(result, 'Fortryd opgaven', 'Fortryd opgaven', v);
  if (undo) { const menu = node('details', undefined, 'result-options'); menu.append(node('summary', 'Flere valg'), undo); actions.append(menu); }
  return actions;
}
const targetLine = (box, v = view) => { if (v.lastTarget) box.append(node('p', `Mål: ${v.lastTarget}`, 'review-target')); };
function renderRunReview(result, v = view) {
  const box = v.review; box.replaceChildren();
  const { lastCheckpoint, lastSentText, rejectedThisRun, lastRejection } = v;
  result = { files: [], tools: [], ...result };
  v.buildOffer = ['chat', 'plan'].includes(result.mode) && result.status === 'idle' && result.buildOffer === true && !v.plan && !v.waitingFor?.length;
  updatePlanOffer(v);
  const show = () => { box.hidden = false; if (v === view && v.followChat) requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest' })); };
  const saved = result.files.length && lastCheckpoint?.status === 'saved';
  if (result.unavailable) { show(); box.append(node('h3', 'Ændringerne kunne ikke læses'), node('p', 'Gennemgå filerne under Kode, før du fortsætter.')); return; }
  if (result.status === 'error') {
    // Fejl: typen afgør forklaringen og handlingen. Den rå besked står under Se detaljer.
    const info = window.ApprovalView.failureText(result.failure?.kind); show();
    box.append(node('h3', info.title), node('p', `${info.text} Din besked står klar i skrivefeltet.`));
    if (result.files.length) { box.append(node('p', filesText(result.files.length, 'AI’en nåede at ændre'))); reviewFiles(box, result); }
    const actions = node('div', undefined, 'review-actions');
    const kind = state?.connections.find(c => c.id === $('#connection-select').value)?.kind;
    const pages = { anthropic: 'billing', mistral: 'billing', corti: 'console', alexandra: 'billing', openrouter: 'start', zen: 'start' };
    if (info.action === 'connection') actions.append(reviewButton('Gennemgå AI-forbindelse', () => showSetup(info.title), true));
    if (info.action === 'account' && pages[kind]) actions.append(reviewButton('Åbn kontoen hos udbyderen', () => action(() => call('providerAccount', { kind, page: pages[kind] })), true));
    else if (info.action === 'account') actions.append(reviewButton('Gennemgå AI-forbindelse', () => showSetup(info.title), true));
    if (info.action === 'model') actions.append(reviewButton('Vælg en anden model', () => openTaskSettings(), true));
    actions.append(reviewButton('Prøv igen', retrySend, info.action === 'retry'));
    if (result.files.length) actions.append(resultActions(result, v));
    box.append(actions);
    if (result.failure?.message) { const fold = node('details', undefined, 'review-details'); fold.append(node('summary', 'Se detaljer'), node('pre', result.failure.message)); box.append(fold); }
    return;
  }
  if (result.status === 'stopped') {
    show();
    box.append(node('h3', 'Du stoppede opgaven')); targetLine(box, v); box.append(node('p', result.files.length ? filesText(result.files.length, 'AI’en nåede at ændre') : 'AI’en nåede ikke at ændre noget. Din besked står klar i skrivefeltet, så du kan sende den igen.'));
    reviewFiles(box, result);
    if (saved) box.append(node('p', 'Det, den nåede, er gemt som en version, så du kan fortryde det.', 'hint'));
    const actions = node('div', undefined, 'review-actions');
    if (result.files.length) actions.append(resultActions(result, v));
    actions.append(reviewButton('Send igen', retrySend, !saved));
    box.append(actions); return;
  }
  if (rejectedThisRun) {
    // Afvist uden besked: AI'en stoppede. Vejen videre er at sige, hvad den skal gøre i stedet.
    show();
    box.append(node('h3', 'Du afviste en handling, så AI’en stoppede'), node('p', lastRejection ? `Afvist: ${lastRejection.title.replace(/^Må AI’en /, '').replace(/\?$/, '')}${lastRejection.target ? ` · ${lastRejection.target.split('\n')[0].slice(0, 160)}` : ''}.` : 'En handling blev afvist.'));
    if (result.files.length) { box.append(node('p', filesText(result.files.length, 'Før det nåede AI’en at ændre'))); reviewFiles(box, result); }
    const actions = node('div', undefined, 'review-actions');
    actions.append(reviewButton('Skriv, hvad AI’en skal gøre i stedet', () => { if (!$('#prompt').value.trim()) $('#prompt').value = 'Gør det på en anden måde: '; $('#prompt').focus(); }, true), reviewButton('Send beskeden igen', () => { $('#prompt').value = lastSentText; retrySend(); }));
    if (result.files.length) actions.append(resultActions(result, v));
    box.append(actions); return;
  }
  // En opgave, der slutter uden svar og uden ændringer, må ikke ligne et resultat.
  if (!result.files.length && result.answered === false) {
    const long = result.finish === 'length';
    show(); box.append(node('h3', 'AI’en stoppede uden et resultat'), node('p', long
      ? 'Modellen brugte hele svaret på at tænke og nåede ikke at skrive noget. Det sker oftest ved store opgaver og lange samtaler.'
      : 'AI’en stoppede uden at svare eller ændre filer. Prøv igen. Virker det stadig ikke, så vælg en anden model.'));
    const actions = node('div', undefined, 'review-actions'), again = () => { $('#prompt').value = lastSentText; retrySend(); };
    // Lav indsats får modellen til at tænke kortere. Den vises kun, når modellen tager imod den og ikke allerede bruger den.
    const lower = long && v.effort !== 'low' && (v.effortLevels || []).includes('low');
    if (lower) actions.append(reviewButton('Prøv igen med lav indsats', () => { v.effort = 'low'; updateModelSummary(); again(); }, true));
    // En lang samtale gøres kortere, før beskeden sendes igen. Planen og filerne bevares.
    // Ældre beskeder, der endnu ikke er vist, tæller også med.
    if (long && v.log.querySelectorAll('.chat-message.user').length + v.historyPending.filter(item => item.role === 'user').length > 1) actions.append(reviewButton('Gør samtalen kortere og prøv igen', () => { v.compactNext = true; again(); }, !lower));
    actions.append(reviewButton('Prøv igen', again, !actions.children.length));
    box.append(actions); return;
  }
  if (v.buildOffer) {
    show(); box.append(node('h3', 'Næste skridt'));
    const build = reviewButton('Byg videre', () => {
      if (v !== view || running || v.submitting) return;
      if ($('#prompt').value.trim()) { message('Send eller ryd din beskedkladde først.'); $('#prompt').focus(); return; }
      $('#include-history').checked = true;
      window.draftMessage('Byg videre ud fra det, vi har aftalt i samtalen.', 'AI’en bygger videre ud fra samtalen.', { mode: 'free', submit: true, owner: selectedOwner() });
    }, true);
    box.append(build); return;
  }
  if (['chat', 'plan'].includes(result.mode) && !result.files.length) { box.hidden = true; return; }
  show();
  box.classList.toggle('is-reviewed', v.reviewedTask === result.task);
  box.append(node('p', result.files.length ? `${result.files.length} ${result.files.length === 1 ? 'fil ændret' : 'filer ændret'}${saved ? ' · Gemt' : ''}` : 'Opgaven er afsluttet uden filændringer.', 'result-receipt'));
  if (result.skipped) box.append(node('p', 'Nogle filer er udeladt af oversigten på grund af filtype eller størrelse.', 'hint'));
  const actions = resultActions(result, v);
  if (actions.children.length) box.append(actions);
}


let localDiscoveryGeneration = 0, localDiscoveryResult = null;
async function discoverLocal() {
  const generation = ++localDiscoveryGeneration;
  localDiscoveryResult = null;
  $('#local-discovery-use').hidden = true;
  $('#local-discovery-retry').disabled = true;
  $('#local-discovery-models').replaceChildren();
  $('#local-discovery-status').textContent = 'Leder efter Ollama på denne computer …';
  try {
    const result = await call('discoverLocalModels');
    if (generation !== localDiscoveryGeneration) return;
    localDiscoveryResult = result; $('#setup-local-hint').textContent = result.status === 'found' ? `${result.models.length} ${result.models.length === 1 ? 'model fundet' : 'modeller fundet'} i Ollama.` : 'Brug en model, du har i Ollama.';
    $('#local-discovery-status').textContent = ({ found: 'Vi fandt dine modeller. Du kan fortsætte med Ollama.', empty: 'Ollama er åben, men har ingen modeller. Tilføj en model i Ollama, og søg igen.', invalid: 'Vi kunne ikke læse modellerne. Kontrollér Ollama, eller brug en anden adresse.', unavailable: 'Åbn Ollama, hvis du har det installeret, og søg igen. Du kan også vælge senere.' })[result.status];
    for (const model of result.models.slice(0, 6)) $('#local-discovery-models').append(node('li', model.name + (model.remote ? ' · mulig cloudmodel' : '')));
    if (result.models.length > 6) $('#local-discovery-models').append(node('li', `Og ${result.models.length - 6} andre modeller`));
    $('#local-discovery-use').hidden = result.status !== 'found';
  } finally { if (generation === localDiscoveryGeneration) $('#local-discovery-retry').disabled = false; }
}
$('#local-discovery-retry').onclick = () => action(discoverLocal);
$('#local-discovery-use').onclick = () => action(async () => {
  if (running || localDiscoveryResult?.status !== 'found') return;
  $('#local-discovery-use').disabled = true;
  try {
    const address = localDiscoveryResult.baseURL;
    let saved = state.connections.find(c => c.kind === 'ollama' && c.baseURL === address);
    if (!saved) {
      state = await call('saveConnection', { kind: 'ollama', name: 'Ollama på denne computer', baseURL: address });
      saved = state.connections.find(c => c.kind === 'ollama' && c.baseURL === address);
    }
    renderConnections(); $('#setup-connection').value = saved.id;
    verifiedConnection = ''; setupPage('saved'); await testSetupConnection();
  } finally { $('#local-discovery-use').disabled = false; }
});

$('#prompt').addEventListener('input', () => {
  updateStartIdea(); updateIdeaApproach();
  if (!current || !view.id) return;
  // Kladden gemmes straks lokalt for samtalen, så den også findes, hvis appen lukkes, før den er skrevet til samtalefilen.
  try { localStorage.setItem(`harness.chatDraft.${current.root}.${view.id}`, JSON.stringify({ text: $('#prompt').value, mode: $('#work-mode').value })); } catch {}
  clearTimeout(draftTimer); draftTimer = setTimeout(saveChatDraft, 250);
});
$('#work-mode').addEventListener('change', saveChatDraft);
$('#include-history').onchange = () => { acceptedFingerprint = null; };
$('#setup-find-local').onclick = () => { setupPage('local'); if (!localDiscoveryResult) action(discoverLocal); };
$('#setup-add-provider').onclick = () => setupProvider();

// Ny samtale i det åbne projekt. Den forrige står i sidepanelet og kan åbnes igen; en opgave i den fortsætter.
async function newChat() { if (!current) return; const owner = selectedOwner(), request = ++navigationRequest; await saveChatDraft(); const next = await call('newConversation', undefined, owner); if (!next || request !== navigationRequest || current?.root !== owner.root) return; current.workbench = next; await showChat(next); $('#prompt').focus(); }
$('#merge-copy').onclick = () => action(() => reviewRestoration({ merge: true, chat: view.id }, { title: 'Flet samtalens ændringer ind?', confirm: 'Flet ind i projektet', label: `Flettet ind: ${chatTitle(view.id)}` }));

function openTaskSettings() {
  if (!state?.connections?.length) { showSetup('Tilslut en AI for at bygge videre. Din kladde er bevaret.'); return; }
  $('#model-options').open = true; if (!$('#task-dialog').open) $('#task-dialog').showModal();
}
$('#model-chip').onclick = openTaskSettings;
// En valgt indsats hører til modellen. Et skift af model eller forbindelse vender tilbage til udbyderens standard.
const resetEffort = () => { if (view) view.effort = null; updateModelSummary(); };
$('#model-effort-reset').onclick = resetEffort;
for (const id of ['#connection-select', '#model-select']) $(id).addEventListener('change', () => { if (view?.effort) resetEffort(); });
for (const id of ['settings-menu', 'project-menu', 'preview-menu']) {
  document.getElementById(id).addEventListener('click', event => { if (event.target.closest('button') && (id !== 'preview-menu' || event.target.closest('#attach-preview'))) document.getElementById(id).hidePopover(); });
}

$('#support-button').onclick = () => action(async () => {
  $('#support-dialog').showModal(); $('#support-status').textContent = '';
  const report = await call('supportReport');
  $('#support-version').textContent = `Aura ${report.app} · ${report.system === 'darwin' ? 'macOS' : report.system === 'win32' ? 'Windows' : report.system} · ${report.arkitektur}`;
  $('#support-report').textContent = JSON.stringify(report, null, 2);
  // Adressen står synligt, så den kan kopieres, hvis computeren ikke har et e-mailprogram.
  const person = await call('supportContact');
  $('#support-contact').textContent = person ? `Send feedback til ${person.name}, ${person.email}.` : 'Send feedback til den, der inviterede dig.';
  $('#support-feedback').hidden = !person; if (person) $('#support-feedback').textContent = `Skriv en e-mail til ${person.name}`;
});
$('#support-save').onclick = () => action(async () => { $('#support-status').textContent = await call('supportSave') ? 'Rapporten er gemt på din computer. Du vælger selv, om du vil dele den.' : 'Rapporten blev ikke gemt.'; });
$('#support-feedback').onclick = () => action(() => call('supportFeedback'));

// Udgiv forbinder komplai Run fra sin egen dialog; appens funktioner følger med.
window.addEventListener('harness:komplai-connected', () => action(async () => { state = await call('connectionState'); renderConnections(); applyFeatures(); }));

// Ældre gemte beskeder hentes en side ad gangen fra denne computer. Det starter ingen AI-opgave.
const beskeder = n => `${n} tidligere ${n === 1 ? 'besked' : 'beskeder'}`;
function renderHistoryControls() {
  const next = view.historyPending.length ? window.HistoryPages.takePrevious(view.historyPending).recent.length : 0;
  $('#history-load').hidden = !next; $('#history-load').textContent = `Vis ${beskeder(next)}`;
  $('#history-load-status').textContent = view.historyNotice;
}
// En gemt besked tegnes med sit id, så et søgetræf kan finde den igen.
function storedMessage(item, v) {
  const element = appendMessage(item.text, item.role, v);
  if (typeof item.id === 'string') element.dataset.messageId = item.id;
  return element;
}
// Henter næste side ældre beskeder ind over samtalen og bevarer læsepositionen.
function showOlderMessages(v = view) {
  const container = $('#chat-content'), height = container.scrollHeight, top = container.scrollTop;
  const page = window.HistoryPages.takePrevious(v.historyPending); if (!page.recent.length) return false;
  const fragment = document.createDocumentFragment();
  for (const item of page.recent) storedMessage(item, { log: fragment });
  // Skærmlæsere skal kun have statuslinjen læst op, ikke hele den hentede side. Loggen er derfor ikke levende,
  // indtil browseren har opdateret tilgængelighedstræet efter indsættelsen.
  v.log.setAttribute('aria-live', 'off'); v.log.prepend(fragment);
  requestAnimationFrame(() => requestAnimationFrame(() => v.log.setAttribute('aria-live', 'polite')));
  v.followChat = false; v.historyPending = page.older;
  v.historyNotice = `${beskeder(page.recent.length)} vist fra denne computer.${page.older.length ? ` ${page.older.length} mere gemt.` : ''}`;
  renderHistoryControls();
  const position = top + container.scrollHeight - height; container.scrollTop = position; v.scrollTop = position;
  requestAnimationFrame(() => { if (view === v) { container.scrollTop = position; v.scrollTop = position; updateChatScroll(); } });
  return true;
}
$('#history-load').onclick = () => { if (showOlderMessages() && !view.historyPending.length) $('#history-load-status').focus({ preventScroll: true }); };

// Et søgetræf åbner den gemte samtale og viser beskeden. Det sendes ikke til AI'en. Efter forslag i #28.
window.openStoredMessage = async result => {
  if (!result || !/^[a-f0-9]{64}$/.test(result.project || '') || !/^[a-f0-9-]{36}$/.test(result.chat || '') || typeof result.message !== 'string' || result.message.length > 200) throw new Error('Vælg et aktuelt søgetræf.');
  const project = window.chats.projects().find(item => item.id === result.project);
  if (!project) throw new Error('Projektet findes ikke længere. Søg igen.');
  try { await saveChatDraft(true); } catch { throw new Error('Kladden kunne ikke gemmes. Kopiér teksten, før du åbner en anden samtale.'); }
  await window.chats.openChat(project, result.chat);
  if (current?.root !== project.root || view.id !== result.chat) throw new Error('Samtalen blev ikke åbnet. Vælg træffet igen.');
  const v = view, find = () => [...v.log.children].find(element => element.dataset?.messageId === result.message);
  // Ældre sider hentes, indtil beskeden står i samtalen.
  while (!find() && v.historyPending.some(item => item.id === result.message) && showOlderMessages(v));
  // En brugerbesked fra den igangværende session har intet id endnu; den kendes på træffets tekst.
  if (!find() && result.role === 'user' && result.excerpt) {
    const excerpt = result.excerpt.normalize('NFC'), match = [...v.log.querySelectorAll('.chat-message.user:not([data-message-id])')].reverse().find(element => element.textContent.normalize('NFC').includes(excerpt));
    if (match) match.dataset.messageId = result.message;
  }
  // Samtalen bygges aldrig om her, så linjer, der kun står i den åbne visning, bevares.
  const target = find(); if (!target) throw new Error('Samtalen er åbnet, men beskeden kan ikke markeres. Rul op for at finde den.');
  for (const element of v.log.querySelectorAll('.search-message-hit')) element.classList.remove('search-message-hit');
  v.followChat = false; target.classList.add('search-message-hit'); target.tabIndex = -1;
  target.scrollIntoView({ block: 'center', behavior: 'auto' }); target.focus({ preventScroll: true });
  // Hentede sider genopretter læsepositionen ved næste skærmopdatering; træffet rulles frem efter dem.
  requestAnimationFrame(() => { if (view === v && target.isConnected) { target.scrollIntoView({ block: 'center', behavior: 'auto' }); v.followChat = false; updateChatScroll(); } });
  return target;
};
