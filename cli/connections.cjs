const { definitions, assertSupported } = require('../desktop/core/connections.cjs');
const { discoverLocalModels } = require('../desktop/core/local-discovery.cjs');

async function unlockConnection(app, id) {
  const connection = await app.bench.connection(id);
  assertSupported(connection);
  if (connection.secret) { await app.vault.unlock(app.ui); app.ui.protect(app.bench.store.decrypt(connection)); }
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
  if (kind === 'ollama') {
    const discovery = await discoverLocalModels();
    ui.line(discovery.models.length ? `${discovery.models.length} modeller fundet i Ollama på denne computer.` : 'Ingen kørende modeller fundet på Ollamas standardadresse. Du kan angive en anden adresse.');
  }
  if (['compatible', 'ollama', 'azure'].includes(kind)) baseURL = (await ui.ask('Serveradresse', { fallback: baseURL, required: true })).trim();
  const extra = {};
  if (kind === 'azure') {
    extra.deployment = await ui.ask('Deployment-navn fra Azure', { required: true });
    extra.protocol = await ui.choose('Hvilket API bruger deploymentet?', [{ value: 'responses', label: 'Responses' }, { value: 'openai', label: 'Chat Completions' }]);
    if (!extra.protocol) return null;
  }
  const name = await ui.ask('Forbindelsens navn', { fallback: definition.name });
  const apiKey = await ui.ask(definition.keyRequired ? 'API-nøgle' : 'API-nøgle (tom ved ingen)', { secret: true, required: definition.keyRequired });
  ui.protect(apiKey);
  if (apiKey) await vault.unlock(ui);
  const before = new Set((await bench.store.read()).connections.map(c => c.id));
  const state = await bench.saveConnection({ kind, name, baseURL, apiKey, ...extra });
  const connection = state.connections.find(c => !before.has(c.id));
  ui.line('Forbindelsen er gemt. Henter modellisten; ingen beskeder eller projektfiler sendes.');
  let models;
  try { models = await bench.models(connection.id); }
  catch (error) {
    // En forbindelse, der ikke kunne kontrolleres, fjernes igen, så et nyt forsøg ikke giver en dublet med samme navn.
    await bench.removeConnection(connection.id).catch(() => {});
    ui.line('Forbindelsen blev ikke gemt, fordi den ikke kunne kontrolleres.');
    throw error;
  }
  ui.line(`${models.length} modeller fundet. Det beviser ikke adgang til kodeværktøjer eller ledig kvote.`);
  return connection.id;
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
  const models = await bench.models(connectionID);
  const modelID = await ui.choose('Vælg model', models.map(m => ({ value: m.id, label: `${m.name || m.id}${m.name && m.name !== m.id ? ` (${m.id})` : ''}${m.capabilities?.tools === false ? ' · kataloget angiver ingen værktøjskald' : ''}` })));
  if (!modelID) return null;
  const routes = await bench.routes(connectionID, modelID);
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
