// AI'ens værktøj aura_preview: starter forhåndsvisningen, hvis brugeren har godkendt netop dette projekts pakker og opstart.
// Samtykket gives i forhåndsvisningens dialog og huskes, til projektets fingeraftryk (package.json, lockfiler, opstartsfiler) ændres.
const { consentValid, WAITS } = require('./preview-bridge.cjs');

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
// startStatic (fra main) viser den statiske side med det samme, fx når en samtale i baggrunden lige har skrevet public/index.html.
async function previewAnswer(space, action, { wait = defaultWait, startStatic } = {}) {
  if (!space?.devServer) return { state: 'error', message: 'Projektet er ikke åbent i Aura.' };
  const server = space.devServer, busy = () => ['installing', 'starting', 'stopping'].includes(server.state);
  const snap = () => { const s = server.snapshot(); return { state: s.state === 'idle' || s.state === 'stopped' ? 'idle' : s.state, url: s.url || null, message: s.message || '', ...(s.state === 'error' ? { log: String(s.output || '').slice(-800) } : {}) }; };
  // Har brugeren selv tilsluttet en lokal server, er den forhåndsvisningen. Aura starter intet i stedet for den, og AI'en
  // bliver ikke bedt om at få brugeren til at trykke Start (fund N:C2-5, beta 3). Projektets egen server sætter også
  // externalPreview, men kun mens den kører, og så svarer snap().
  const attached = () => !['installing', 'starting', 'stopping', 'running'].includes(server.state) && !space.preview?.url && space.externalPreview
    ? { state: 'running', url: space.externalPreview, message: 'Brugeren har tilsluttet sin egen lokale server, og den vises i forhåndsvisningen. Aura starter ikke en server.' } : null;
  // Et statisk projekt uden package.json har ingen server at starte: den statiske adresse er forhåndsvisningen.
  // Er siden ikke vist endnu, siges det ærligt: der er ingen Start-knap og intet samtykke at bede om (fund 23, beta 3).
  // Auras uændrede startside vises heller ikke, før AI'en har lavet første version (openProject i core/projects.cjs).
  const staticAnswer = async (show = false) => {
    if (['installing', 'starting', 'stopping', 'running'].includes(server.state)) return null;
    const project = (await server.status().catch(() => null))?.project;
    if (project?.kind !== 'static') return null;
    if (show && !space.preview?.url && startStatic) await startStatic().catch(() => false);
    const url = space.preview?.url;
    return url ? { state: 'running', url, message: 'Projektet er en enkel hjemmeside og vises direkte.' }
      : { state: 'idle', url: null, message: 'Projektet er en enkel hjemmeside uden server, så der er intet at starte, og brugeren skal ikke trykke Start. Aura viser public/index.html direkte i forhåndsvisningen, når filen findes og ikke længere er Auras uændrede startside.' };
  };
  const own = attached(); if (own) return own;
  if (action === 'status' || server.state === 'running') return (await staticAnswer()) || snap();
  if (busy()) { await wait(() => !busy(), WAITS.busy); return snap(); }
  const early = await staticAnswer(true); if (early) return early;
  const status = await server.status(), settings = await space.owner.store.project(space.owner.project.root);
  let consent = settings.previewConsent;
  // Overgang fra beta 2 (Q:C2-4): et samtykke til det gamle fingeraftryk, hvor netlisten talte med, gælder, når pakker, opstart og
  // netliste er de samme som dengang (dev-server.cjs beregner det med den aktuelle netliste). Det gemmes med det nye fingeraftryk.
  if (!consentValid(consent, status.project?.fingerprint) && status.project?.legacyFingerprint && consentValid(consent, status.project.legacyFingerprint)) {
    consent = { ...consent, fingerprint: status.project.fingerprint, at: Date.now() };
    await space.owner.store.saveProject(space.owner.project.root, { previewConsent: consent });
  }
  if (!consentValid(consent, status.project?.fingerprint)) return { state: 'needs_consent', message: 'Brugeren har ikke godkendt at starte forhåndsvisningen for denne version af projektets pakker. Bed brugeren trykke Start i forhåndsvisningen, og prøv derefter igen.' };
  const scripts = consent.scripts === true;
  space.forceStatic = false;
  if (!status.project.installed) {
    await server.execute((await server.prepare('install', scripts)).token);
    await wait(() => !busy(), WAITS.install);
    if (server.state === 'error') return snap();
  }
  await server.execute((await server.prepare('start', scripts)).token);
  await wait(() => server.state === 'running' || server.state === 'error', WAITS.start);
  return snap();
}
async function defaultWait(done, ms) { const end = Date.now() + ms; while (Date.now() < end && !done()) await new Promise(resolve => setTimeout(resolve, 250)); }

module.exports = { resolveSpace, aiPreview };
