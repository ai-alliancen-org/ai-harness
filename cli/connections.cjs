const connections = require('../desktop/core/connections.cjs');
const { definitions, assertSupported } = connections;
const { Cancelled } = require('./terminal.cjs');
const { isLegacy } = require('./storage.cjs');
const { discoverLocalModels } = require('../desktop/core/local-discovery.cjs');
// Samme grænse som i nøglevinduet: kun en server, der ikke kan nås, må gemmes uden kontrol.
const UNREACHABLE = ['unreachable', 'timeout'];

// Ctrl+C skal kunne afbryde et netkald under login og modelvalg. app.stop() kalder pendingLogin.cancel().
// Selve forespørgslen kan ikke afbrydes herfra (listModels tager intet signal), men ventetiden slutter straks og rent,
// og et sent svar bruges aldrig til noget.
function abortable(app, work) {
  return new Promise((resolve, reject) => {
    if (app.closing) { Promise.resolve(work).catch(() => {}); reject(new Cancelled()); return; }
    const slot = { cancel: () => { if (app.pendingLogin === slot) app.pendingLogin = null; reject(new Cancelled()); } };
    app.pendingLogin = slot;
    Promise.resolve(work).then(resolve, reject).finally(() => { if (app.pendingLogin === slot) app.pendingLogin = null; });
  });
}
// Gamle nøgler (adgangssætningslageret) flyttes til nøgleringen ved første brug. Fejler det, er det kun alvorligt, hvis den
// forbindelse, der skal bruges nu, selv er en gammel nøgle; ellers fortsætter brugeren med en besked.
async function moveLegacy(app, secret) {
  try { await app.vault.migrate(app.bench.store, app.ui); }
  catch (error) { if (secret !== undefined && isLegacy(secret)) throw error; app.ui.line(`${error.message} Ældre nøgler ligger uændret i adgangssætningslageret.`); }
}
async function unlockConnection(app, id) {
  let connection = await app.bench.connection(id);
  assertSupported(connection);
  if (connection.secret) {
    await app.vault.unlock(app.ui);
    await moveLegacy(app, connection.secret);
    connection = await app.bench.connection(id);
    app.vault.verify(connection.secret);
    app.ui.protect(app.bench.store.decrypt(connection));
  }
  return connection;
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
    const discovery = await abortable(app, discoverLocalModels());
    ui.line(discovery.models.length ? `${discovery.models.length} modeller fundet i Ollama på denne computer.` : 'Ingen kørende modeller fundet på Ollamas standardadresse. Du kan angive en anden adresse.');
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
  ui.line('Kontrollerer nøglen ved at hente modellisten; ingen beskeder eller projektfiler sendes.');
  let models = null;
  try { models = await abortable(app, connections.listModels(checked, key)); }
  catch (error) {
    if (error?.code === 'CANCELLED') { ui.line('Afbrudt. Intet er gemt.'); throw error; }
    // Kunne serveren ikke nås (fx slukket), er nøglen ikke afvist. Brugeren vælger, om den gemmes ukontrolleret.
    if (UNREACHABLE.includes(error?.reason)) {
      ui.line('Serveren kunne ikke nås, så nøglen er ikke kontrolleret.');
      const keep = await ui.choose('Vil du gemme forbindelsen alligevel?', [{ label: 'Gem alligevel', value: 'keep' }, { label: 'Fjern forbindelsen', value: 'remove' }]);
      if (keep === 'keep') {
        const id = await abortable(app, bench.storeConnection({ ...input, name }));
        ui.line('Forbindelsen er gemt uden kontrol. Modellerne hentes, når serveren kan nås.'); return id;
      }
    }
    ui.line('Forbindelsen blev ikke gemt, fordi den ikke kunne kontrolleres.');
    if (!UNREACHABLE.includes(error?.reason)) ui.line('Det kan du gøre: kopiér nøglen igen med kopiér-knappen hos udbyderen, og kør aura login på ny. Kontrollér også, at nøglen hører til den udbyder, du valgte.');
    throw error;
  }
  const id = await abortable(app, bench.storeConnection({ ...input, name }, { catalog: models }));
  ui.line(`${models.length} modeller fundet. Det beviser ikke adgang til kodeværktøjer eller ledig kvote.`);
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
  const models = await abortable(app, bench.models(connectionID));
  const modelID = await ui.choose('Vælg model', models.map(m => ({ value: m.id, label: `${m.name || m.id}${m.name && m.name !== m.id ? ` (${m.id})` : ''}${m.capabilities?.tools === false ? ' · kataloget angiver ingen værktøjskald' : ''}` })));
  if (!modelID) return null;
  const routes = await abortable(app, bench.routes(connectionID, modelID));
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
