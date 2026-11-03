// AI'ens værktøj aura_preview: starter forhåndsvisningen, hvis brugeren har godkendt netop dette projekts pakker og opstart.
// Samtykket gives i forhåndsvisningens dialog og huskes, til projektets fingeraftryk (package.json, lockfiler, opstartsfiler) ændres.
const { consentValid } = require('./preview-bridge.cjs');

async function aiPreview(space, action, { wait = defaultWait } = {}) {
  if (!space?.devServer) return { state: 'error', message: 'Projektet er ikke åbent i Aura.' };
  const server = space.devServer, busy = () => ['installing', 'starting', 'stopping'].includes(server.state);
  const snap = () => { const s = server.snapshot(); return { state: s.state === 'idle' || s.state === 'stopped' ? 'idle' : s.state, url: s.url || null, message: s.message || '', ...(s.state === 'error' ? { log: String(s.output || '').slice(-800) } : {}) }; };
  if (action === 'status' || server.state === 'running') return snap();
  if (busy()) { await wait(() => !busy(), 90000); return snap(); }
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

module.exports = { aiPreview };
