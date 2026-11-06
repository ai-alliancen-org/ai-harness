// AI'ens værktøj aura_preview: starter forhåndsvisningen, hvis brugeren har godkendt netop dette projekts pakker og opstart.
// Samtykket gives i forhåndsvisningens dialog og huskes, til projektets fingeraftryk (package.json, lockfiler, opstartsfiler) ændres.
const { consentValid } = require('./preview-bridge.cjs');

// Finder projektets rum. En samtale i baggrunden har måske aldrig været åbnet i Aura, så rummet oprettes, hvis projektet kendes.
async function resolveSpace(root, { spaceFor, ownerFor, selectSpace }) {
  let space = spaceFor(root);
  if (space?.ready) await space.ready.catch(() => {});
  if (!space?.devServer) {
    const owner = ownerFor(root);
    if (owner) { await selectSpace(root, owner); space = spaceFor(root); }
  }
  return space;
}

// Siden henter måske fra en adresse uden for projektets netliste. AI'en får adressen at vide og besked om at bruge lokale filer,
// så den ikke gætter, beder om netadgang eller dækker fejlen med opdigtede data. Netlisten er brugerens valg og ændres ikke her.
async function aiPreview(space, action, options = {}) {
  const answer = await previewAnswer(space, action, options);
  if (!space?.devServer || !answer || typeof answer !== 'object') return answer;
  const blocked = ((await space.devServer.status().catch(() => null))?.project?.diagnostics || []).filter(item => item?.origin).map(item => ({ adresse: item.origin, slags: item.kind }));
  if (!blocked.length) return answer;
  const addresses = [...new Set(blocked.map(item => item.adresse))].join(', ');
  const note = `Siden henter fra ${addresses}, som ikke står på projektets netliste og derfor bliver blokeret. Brug lokale filer eller projektets egne pakker i stedet. Bed ikke om netadgang, og skjul ikke fejlen eller erstat rigtige data med opdigtede eksempeldata.`;
  return { ...answer, blocked, message: answer.message ? `${answer.message} ${note}` : note };
}
async function previewAnswer(space, action, { wait = defaultWait } = {}) {
  if (!space?.devServer) return { state: 'error', message: 'Projektet er ikke åbent i Aura.' };
  const server = space.devServer, busy = () => ['installing', 'starting', 'stopping'].includes(server.state);
  const snap = () => { const s = server.snapshot(); return { state: s.state === 'idle' || s.state === 'stopped' ? 'idle' : s.state, url: s.url || null, message: s.message || '', ...(s.state === 'error' ? { log: String(s.output || '').slice(-800) } : {}) }; };
  // Et statisk projekt uden package.json har ingen server at starte: den statiske adresse er forhåndsvisningen.
  const staticAnswer = async () => {
    const url = space.preview?.url;
    if (!url || ['installing', 'starting', 'stopping', 'running'].includes(server.state)) return null;
    const project = (await server.status().catch(() => null))?.project;
    return project?.kind === 'static' ? { state: 'running', url, message: 'Projektet er en enkel hjemmeside og vises direkte.' } : null;
  };
  if (action === 'status' || server.state === 'running') return (await staticAnswer()) || snap();
  if (busy()) { await wait(() => !busy(), 90000); return snap(); }
  const early = await staticAnswer(); if (early) return early;
  const status = await server.status(), settings = await space.owner.store.project(space.owner.project.root);
  if (!consentValid(settings.previewConsent, status.project?.fingerprint)) return { state: 'needs_consent', message: 'Brugeren har ikke godkendt at starte forhåndsvisningen for denne version af projektets pakker. Bed brugeren trykke Start i forhåndsvisningen, og prøv derefter igen.' };
  const scripts = settings.previewConsent.scripts === true;
  space.forceStatic = false;
  if (!status.project.installed) {
    await server.execute((await server.prepare('install', scripts)).token);
    await wait(() => !busy(), 300000);
    if (server.state === 'error') return snap();
  }
  await server.execute((await server.prepare('start', scripts)).token);
  await wait(() => server.state === 'running' || server.state === 'error', 90000);
  return snap();
}
async function defaultWait(done, ms) { const end = Date.now() + ms; while (Date.now() < end && !done()) await new Promise(resolve => setTimeout(resolve, 250)); }

module.exports = { resolveSpace, aiPreview };
