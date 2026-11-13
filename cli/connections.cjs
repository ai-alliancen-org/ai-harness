const connections = require('../desktop/core/connections.cjs');
const { definitions, assertSupported } = connections;
const { Cancelled } = require('./terminal.cjs');
const { isLegacy } = require('./storage.cjs');
const localDiscovery = require('../desktop/core/local-discovery.cjs');
// Samme grænse som i nøglevinduet: kun en server, der ikke kan nås, må gemmes uden kontrol.
const UNREACHABLE = ['unreachable', 'timeout'];

// «1 model» og «2 modeller» (N:F-4).
const modelCount = count => `${count} ${count === 1 ? 'model' : 'modeller'}`;
// Ctrl+C skal kunne afbryde et netkald under login og modelvalg. app.stop() kalder pendingLogin.cancel(), som afslutter
// ventetiden og stopper selve kaldet gennem signalet. Ellers venter terminalen på tidsgrænsen, før prompten kommer igen (K4).
// Et sent svar bruges aldrig til noget.
function abortable(app, start) {
  return new Promise((resolve, reject) => {
    if (app.closing) { reject(new Cancelled()); return; }
    const controller = new AbortController();
    const slot = { cancel: () => { if (app.pendingLogin === slot) app.pendingLogin = null; controller.abort(); reject(new Cancelled()); } };
    app.pendingLogin = slot;
    let work; try { work = start(controller.signal); } catch (error) { if (app.pendingLogin === slot) app.pendingLogin = null; reject(error); return; }
    Promise.resolve(work).then(resolve, reject).finally(() => { if (app.pendingLogin === slot) app.pendingLogin = null; });
  });
}
const LEFT_BEHIND = 'Gamle nøgler ligger uændret i terminalens adgangssætningslager. Har du glemt adgangssætningen, kan de gamle forbindelser fjernes med aura logout.';
// Gamle nøgler fra adgangssætningslageret (0.2.0-beta.6) flyttes til nøgleringen. Er den forbindelse, der skal bruges nu, selv
// gammel, sker det uden at spørge, for ellers kan nøglen ikke læses. Ellers spørger Aura først, og et nej eller en fejl huskes
// resten af kørslen, så adgangssætningen ikke kræves ved hver besked (fund 46). Ctrl+C afbryder hele handlingen (fund 49).
async function moveLegacy(app, secret) {
  const { vault, ui, bench } = app;
  if (vault.mode !== 'keychain') return;
  const current = secret !== undefined && isLegacy(secret);
  if (!current) {
    if (app.legacyPostponed) return;
    const count = (await vault.pendingLegacy(bench.store)).length;
    if (!count) return;
    ui.line(`${count} ${count === 1 ? 'gemt nøgle' : 'gemte nøgler'} fra en tidligere version af terminalen ligger endnu i adgangssætningslageret.`);
    const choice = await ui.choose(`Vil du flytte ${count === 1 ? 'den' : 'dem'} til computerens nøglering nu? Det kræver din gamle adgangssætning.`, [{ label: 'Flyt nu (anbefalet)', value: 'move' }, { label: 'Ikke nu', value: 'later' }]);
    if (choice !== 'move') { app.legacyPostponed = true; ui.line(LEFT_BEHIND); return; }
  }
  try {
    await vault.migrate(bench.store, ui);
    // Værdier, som adgangssætningen ikke kunne åbne, bliver liggende. De tilbydes ikke igen i denne kørsel (N:F-2).
    if ((await vault.pendingLegacy(bench.store)).length) app.legacyPostponed = true;
  } catch (error) {
    if (error?.code === 'CANCELLED') throw error;
    if (current) throw Object.assign(new Error(`${error.message} Har du glemt adgangssætningen, så fjern forbindelsen med aura logout, og tilføj nøglen igen med aura login.`), { code: error.code });
    app.legacyPostponed = true;
    ui.line(`${error.message} ${LEFT_BEHIND}`);
  }
}
async function unlockConnection(app, id) {
  let connection = await app.bench.connection(id);
  assertSupported(connection);
  if (connection.secret) {
    await app.vault.unlock(app.ui);
    // Kun den aktuelle forbindelses egen gamle nøgle kræver adgangssætningen her. Andre gamle nøgler venter til aura login.
    if (isLegacy(connection.secret)) { await moveLegacy(app, connection.secret); connection = await app.bench.connection(id); }
    app.vault.verify(connection.secret);
    app.ui.protect(app.bench.store.decrypt(connection));
  }
  return connection;
}
const COPY_KEY = 'Det kan du gøre: kopiér nøglen igen med kopiér-knappen hos udbyderen, og kør aura login på ny. Kontrollér også, at nøglen hører til den udbyder, du valgte.';
const CHECK_ADDRESS = 'Det kan du gøre: kontrollér serveradressen, og kør aura login på ny.';
// Rådet skal passe til fejlen. Kun en afvist eller ugyldig nøgle giver råd om nøglen. En adresse, der svarer 404 eller ikke
// giver en modelliste, og en forbindelse uden nøgle, fx Ollama, giver råd om adressen (fund 42). Serverfejl og kvote
// forklares af selve beskeden.
function advice(error, key) {
  const status = Number(/^HTTP (\d{3})\b/.exec(String(error?.details || ''))?.[1]) || 0;
  if (error?.reason === 'server' || status === 402 || status === 429) return '';
  if (status === 401 || status === 403) return key ? COPY_KEY : 'Det kan du gøre: kør aura login på ny, og indtast serverens API-nøgle.';
  if (key && !status && ['rejected', 'invalid'].includes(error?.reason) && error?.details !== 'omdirigering') return COPY_KEY;
  return CHECK_ADDRESS;
}
async function login(app, kind) {
  const { ui, bench, vault } = app;
  if (!kind) {
    kind = await ui.choose('Hvordan vil du forbinde din AI?', [
      { label: 'Jeg har en adgangsnøgle', value: 'key' }, { label: 'AI på min computer', value: 'ollama' }
    ]);
    if (!kind) return null;
  }
  if (kind === 'key') {
    kind = await ui.choose('Vælg udbyder', [{ label: 'Claude', value: 'anthropic' }, { label: 'Mistral', value: 'mistral' }, { label: 'Corti', value: 'corti' }, { label: 'Alexandra', value: 'alexandra' }, { label: 'Vælg en anden', value: 'other' }]);
    if (kind === 'other') kind = await ui.choose('Vælg en anden udbyder', ['openai', 'azure', 'openrouter', 'zen', 'compatible'].map(value => ({ value, label: definitions[value].name })));
    if (!kind) return null;
  }
  assertSupported({ kind });
  const definition = definitions[kind]; let baseURL = definition.baseURL;
  // Brugeren skal se, hvor data behandles, før der bedes om en nøgle.
  if (definition.regionShort) ui.line(`Her behandles data: ${definition.regionShort}`);
  if (definition.trainingShort) ui.line(`Træning: ${definition.trainingShort}`);
  if (kind === 'ollama') {
    // Opdagelsen har sin egen korte tidsgrænse. Ctrl+C stopper den også.
    const discovery = await abortable(app, signal => localDiscovery.discoverLocalModels((url, options = {}) => connections.requestJSON(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal })));
    ui.line(discovery.models.length ? `${modelCount(discovery.models.length)} fundet i Ollama på denne computer.` : 'Ingen kørende modeller fundet på Ollamas standardadresse. Du kan angive en anden adresse.');
  }
  if (['compatible', 'ollama', 'azure'].includes(kind)) baseURL = (await ui.ask('Serveradresse', { fallback: baseURL, required: true })).trim();
  const extra = {};
  if (kind === 'azure') {
    extra.deployment = await ui.ask('Deployment-navn fra Azure', { required: true });
    extra.protocol = await ui.choose('Hvilket API bruger deploymentet?', [{ value: 'responses', label: 'Responses' }, { value: 'openai', label: 'Chat Completions' }]);
    if (!extra.protocol) return null;
  }
  let name = await ui.ask('Forbindelsens navn', { fallback: definition.name });
  const apiKey = await ui.ask(definition.keyRequired ? 'API-nøgle' : 'API-nøgle (tom ved ingen)', { secret: true, required: definition.keyRequired });
  ui.protect(apiKey);
  // Nøglen renses som i nøglevinduet, før den kontrolleres: Bearer, Authorization, NAVN= og usynlige tegn fjernes.
  let key = apiKey;
  if (apiKey) {
    try {
      const cleaned = connections.cleanKey(apiKey, kind, { strict: true });
      key = cleaned.key; ui.protect(key);
      // Terminalens rensning ville ellers læse "Bearer foran" som en nøgle efter ordet Bearer.
      if (cleaned.changes.length) ui.line(`Rettet i den indsatte nøgle: ${cleaned.changes.map(change => change === 'Bearer foran' ? 'foranstillet Bearer' : change).join(', ')}.`);
    } catch (error) { ui.line(`Forbindelsen er ikke gemt. ${error.message}`); throw error; }
  }
  const input = { kind, name, baseURL, apiKey: key, ...extra };
  let checked;
  try { checked = connections.normalize(input); }
  catch (error) { ui.line(`Forbindelsen er ikke gemt. ${error.message}`); throw error; }
  // Står standardnavnet uændret, følger det regionen, fx Corti S1 · EU-S, som i appen.
  if (kind === 'corti' && (!name || name === definition.name)) name = connections.cortiName(checked.baseURL);
  if (key) { await vault.unlock(ui); await moveLegacy(app); }
  // Nøglen kontrolleres, før noget gemmes. En afvist nøgle efterlader derfor ingen forbindelse.
  ui.line(`Kontrollerer ${key ? 'nøglen' : 'forbindelsen'} ved at hente modellisten; ingen beskeder eller projektfiler sendes.`);
  let models = null;
  try { models = await abortable(app, signal => connections.listModels(checked, key, { signal })); }
  catch (error) {
    if (error?.code === 'CANCELLED') { ui.line('Afbrudt. Intet er gemt.'); throw error; }
    // Kunne serveren ikke nås (fx slukket), er nøglen ikke afvist. Brugeren vælger, om den gemmes ukontrolleret.
    if (UNREACHABLE.includes(error?.reason)) {
      ui.line(`Serveren kunne ikke nås, så ${key ? 'nøglen' : 'forbindelsen'} er ikke kontrolleret.`);
      const keep = await ui.choose('Vil du gemme forbindelsen alligevel?', [{ label: 'Gem alligevel', value: 'keep' }, { label: 'Fjern forbindelsen', value: 'remove' }]);
      if (keep === 'keep') {
        const id = await abortable(app, () => bench.storeConnection({ ...input, name }));
        ui.line('Forbindelsen er gemt uden kontrol. Modellerne hentes, når serveren kan nås.'); return id;
      }
    }
    ui.line('Forbindelsen blev ikke gemt, fordi den ikke kunne kontrolleres.');
    const next = UNREACHABLE.includes(error?.reason) ? '' : advice(error, key);
    if (next) ui.line(next);
    throw error;
  }
  const id = await abortable(app, () => bench.storeConnection({ ...input, name }, { catalog: models }));
  ui.line(`${modelCount(models.length)} fundet. Det beviser ikke adgang til kodeværktøjer eller ledig kvote.`);
  return id;
}
async function selectModel(app, connectionID) {
  const { bench, ui } = app;
  if (!connectionID) {
    const connections = (await bench.store.read()).connections;
    const saved = connections.filter(c => Object.hasOwn(definitions, c.kind));
    if (connections.some(c => c.kind === 'komplai')) ui.line('Komplai kan ikke længere bruges som AI. Vælg en anden forbindelse. Den gamle forbindelse kan fjernes med aura logout.');
    if (!saved.length) connectionID = await login(app);
    else {
      connectionID = await ui.choose('Vælg AI-forbindelse', [...saved.map(c => ({ value: c.id, label: c.name })), { value: 'new', label: 'Tilføj en forbindelse' }]);
      if (connectionID === 'new') connectionID = await login(app);
    }
  }
  if (!connectionID) return null;
  await unlockConnection(app, connectionID);
  const models = await abortable(app, signal => bench.models(connectionID, { signal }));
  const modelID = await ui.choose('Vælg model', models.map(m => ({ value: m.id, label: `${m.name || m.id}${m.name && m.name !== m.id ? ` (${m.id})` : ''}${m.capabilities?.tools === false ? ' · kataloget angiver ingen værktøjskald' : ''}` })));
  if (!modelID) return null;
  const routes = await abortable(app, signal => bench.routes(connectionID, modelID, { signal }));
  const connection = await bench.connection(connectionID);
  let routeID = '';
  if (connection.kind === 'openrouter') {
    routeID = await ui.choose('Hvilken udbyder hos OpenRouter skal behandle data?', routes.map(r => ({ value: r.id, label: `${r.name} · ${JSON.stringify(r.price || 'ukendt pris')}` })));
    if (!routeID) return null;
  }
  const selection = { connectionID, modelID, routeID };
  if (bench.project) await bench.store.saveProject(bench.project.root, { selection });
  return selection;
}
async function disclose(ui, data, force = false) {
  if (data.accepted && !force) return true;
  ui.line('\nFør du sender');
  ui.line(`Modtager: ${typeof data.recipients === 'string' ? data.recipients : JSON.stringify(data.recipients)}`);
  ui.line(`Behandling: ${data.region}`);
  ui.line(`Træning: ${data.training}`);
  ui.line(`Opbevaring: ${data.retention}`);
  ui.line(`Pris: ${data.price}`);
  ui.line('Der betales pr. token, når modellen har en pris. Forbruget afhænger af opgavens kompleksitet. Ingen automatisk overgang til en anden model.');
  ui.line(`Materiale: ${data.material}`);
  // Det, der faktisk sendes af tidligere samtale med denne besked (N:B1-7).
  if (data.historyText) ui.line(`Tidligere samtale: ${data.historyText}`);
  ui.line(`Kilde: ${data.source} · kontrolleret ${data.checkedAt}`);
  ui.line(data.security);
  if (data.references?.length) ui.line(`Valgte private referencer: ${data.references.join(', ')}`);
  ui.line(data.localStorage);
  while (true) {
    const action = await ui.choose('Vil du sende med disse oplysninger, også hvor forhold er ukendte?', [{ label: 'Send', value: 'send' }, { label: 'Annuller', value: 'cancel' }, { label: 'Se alle oplysninger', value: 'details' }]);
    if (action !== 'details') return action === 'send';
    ui.line(JSON.stringify(data, null, 2));
  }
}
module.exports = { login, selectModel, unlockConnection, disclose };
