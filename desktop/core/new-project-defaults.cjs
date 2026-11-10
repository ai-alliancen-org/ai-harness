// Nye projekters automatik og sikkerhedsnettet (brugerens beslutning (c), 10. november 2026, «Ingen automatik»).
// Et nyt projekt får filændringer i projektet uden kort og kommandoer i sandkassen (ApprovalsPolicy.applyNewProjectDefaults) kun,
// når det har sit sikkerhedsnet: funktionen Versioner og fortryd er slået til for projektet, automatiske versioner er valgt, og
// Git kan gemme dem. Det sidste er samme kontrol, som opgavens automatiske version selv bruger (checkpoints.automaticBlock): et
// repository i projektets egen mappe med en første version, uden hooks, filtre eller en igangværende Git-handling.
// Uden sikkerhedsnet spørger projektet som før og huskes som ventende i projektets lager. Kommer sikkerhedsnettet senere, gives
// standarderne én gang. Har brugeren i mellemtiden selv valgt projektets automatik, i Projektets indstillinger eller med «Tillad
// altid i projektet» på et kort, røres den ikke. Slås versionerne fra igen, ændres intet, og eksisterende projekter ændres ikke.
const { automaticBlock } = require('./checkpoints.cjs');

const PENDING = 'approvalDefaultsPending';
const sandboxSupport = () => require('./command-sandbox.cjs').support();

// bench er en arbejdsbænk (core/workbench.cjs) eller noget med samme store, features, git og approvalsPolicy.
// Hvad sikkerhedsnettet mangler: 'funktion' (Versioner og fortryd er slået fra), 'automatisk' (projektet gemmer ikke en version
// efter hver AI-opgave) eller 'git' (Git kan ikke gemme versionerne; detail er Gits egen grund). null, når nettet er der.
async function missing(bench, root) {
  try {
    if ((await bench.features.get(root)).effective.versioner !== true) return { kind: 'funktion' };
    if ((await bench.store.project(root)).autoCheckpoint !== true) return { kind: 'automatisk' };
    const block = await automaticBlock(await bench.git.repository(root));
    return block ? { kind: 'git', detail: block } : null;
  } catch (error) { return { kind: 'git', detail: error?.message || '' }; }
}
async function safetyNet(bench, root) { return !await missing(bench, root); }
async function pending(store, root) { return Boolean(root) && (await store.project(root))[PENDING] === true; }
// Markeringen fjernes i den samme skrivning, der ser den, så standarderne højst gives én gang.
async function take(store, root) {
  if (!await pending(store, root)) return false;
  return store.update(state => {
    const project = state.projects[store.projectKey(root)];
    if (project?.[PENDING] !== true) return false;
    delete project[PENDING]; return true;
  });
}
async function give(bench, root, support) {
  await bench.approvalsPolicy.applyNewProjectDefaults(root, { commandsAvailable: (await support()).available === true });
}
// Ved oprettelsen, efter at Git er startet, og automatiske versioner er gemt. Giver true, når standarderne er givet.
async function created(bench, root, { support = sandboxSupport } = {}) {
  if (await safetyNet(bench, root)) { await take(bench.store, root); await give(bench, root, support); return true; }
  // Projektet spørger som før, også hvis et tidligere projekt i en mappe med samme sti havde valgt automatik.
  await bench.approvalsPolicy.setProjectFiles(root, false);
  await bench.approvalsPolicy.setCommands(root, false);
  await bench.store.saveProject(root, { [PENDING]: true });
  return false;
}
// Når sikkerhedsnettet kan være kommet: funktionen, automatiske versioner, en gemt version, eller før en opgave forberedes.
// Giver true, når standarderne blev givet nu.
async function settle(bench, root, { support = sandboxSupport } = {}) {
  if (!await pending(bench.store, root) || !await safetyNet(bench, root) || !await take(bench.store, root)) return false;
  // Er filændringer eller kommandoer slået til, mens projektet ventede, har brugeren selv valgt (et nyt projekt uden
  // sikkerhedsnet starter med begge slået fra). Så røres projektets automatik ikke, heller ikke den del, brugeren ikke valgte.
  const now = await bench.approvalsPolicy.settings(root);
  if (now.autoProjectFiles || now.autoCommands) return false;
  await give(bench, root, support);
  return true;
}
// Brugerens eget valg af filændringer eller kommandoer i Projektets indstillinger: projektet venter ikke længere på standarderne.
const chosen = (store, root) => take(store, root);
// Til Projektets indstillinger: hvad projektet venter på (missing), eller null. Har brugeren selv slået filændringer eller
// kommandoer til, mens projektet ventede, fx med «Tillad altid i projektet» på et kort, venter det ikke længere, for settle
// giver så intet.
async function waiting(bench, root, approvals) {
  if (!await pending(bench.store, root)) return null;
  const now = approvals || await bench.approvalsPolicy.settings(root);
  if (now.autoProjectFiles || now.autoCommands) return null;
  return missing(bench, root);
}
module.exports = { created, settle, chosen, pending, waiting, missing, safetyNet, PENDING };
