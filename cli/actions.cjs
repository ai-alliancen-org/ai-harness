const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createProject } = require('../desktop/core/projects.cjs');
const { startPreview, publicFile } = require('../desktop/core/preview.cjs');
const { openBrowser } = require('./browser.cjs');
const { separateState } = require('./storage.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const show = (ui, value) => ui.line(JSON.stringify(value, null, 2));

async function init(app, parent) {
  const { ui } = app;
  parent = await fs.realpath(parent); separateState(parent, app.directory);
  const name = await ui.ask('Hvad skal projektet hedde?', { required: true });
  const purpose = await ui.ask('Hvad skal det hjælpe med?', { required: true });
  ui.line(`Der oprettes en ny undermappe i ${parent} med startside og grundregler. Der oprettes ingen Git-commit.`);
  if (!await ui.confirm('Opret projektet?')) return null;
  const project = await createProject(parent, { name, purpose, color: '#326556', links: [], tests: 'senere' }, [], app.profiles);
  await app.open(project.root); return project;
}
async function diff(app) {
  const overview = await app.bench.changeOverview();
  const files = overview.session?.files || [];
  if (!files.length) { app.ui.line('Ingen registrerede ændringer i denne åbne samtale. /save gennemgår Git-ændringer.'); return; }
  const file = await app.ui.choose('Hvilken fil vil du gennemgå?', files.map(f => ({ label: f.file, value: f.file })));
  if (file) show(app.ui, app.bench.changeFile({ source: 'session', file }));
}
async function undo(app) {
  const task = (await app.bench.changeOverview()).tasks.find(t => !t.undone && t.files?.length);
  if (!task) { app.ui.line('Ingen opgave at fortryde i den åbne samtale. /versions viser Git-historikken.'); return; }
  show(app.ui, task);
  if (await app.ui.confirm('Fortryd denne opgaves filændringer? Senere ændrede filer afvises.')) {
    await app.bench.undoTask({ task: task.id }); app.ui.line('Opgavens filændringer er fortrudt. Git-historikken er uændret.');
  }
}
async function save(app) {
  const { ui, bench } = app, root = bench.project.root;
  let status = await bench.git.status(root);
  if (!status.initialized) {
    if (!await ui.confirm('Projektet har ingen Git-historik. Opret den i denne mappe?')) return;
    status = await bench.git.initialize(root);
  }
  if (status.block) throw new Error(status.block + ' Brug din terminal til Git-opsætningen.');
  const review = await bench.git.review(root), selected = [];
  if (!review.files.length) { ui.line('Ingen ændringer at gemme.'); return; }
  ui.line(`Branch: ${review.branch}. Filer vælges én ad gangen; intet pushes.`);
  for (const file of review.files) {
    ui.line(`\n${file.file} · ${file.status}`);
    if (file.blocked) { ui.line(`Udeladt: ${file.blocked}`); continue; }
    // En gemt version, der kan rumme en hemmelighed, vises ikke; grunden står i stedet (Q:D1-4, desktop/core/git.cjs beforeHidden).
    show(ui, { før: file.beforeHidden || file.before, efter: file.text, binær: file.binary || false });
    if (await ui.confirm('Tag filen med i versionen?')) selected.push(file.file);
  }
  if (!selected.length) return;
  const message = await ui.ask('Beskriv versionen', { required: true });
  ui.line(selected.join('\n'));
  if (await ui.confirm(`Opret lokal Git-commit med beskeden »${message}«?`)) {
    const result = await bench.git.commit(root, { token: review.token, files: selected, message });
    ui.line(`Version gemt: ${result.head}. Intet er pushet.`);
  }
}
async function versions(app) {
  const { bench, ui } = app, root = bench.project.root, status = await bench.git.status(root);
  if (!status.history.length) { ui.line(status.block || 'Ingen gemte versioner.'); return; }
  const commit = await ui.choose('Vælg en gemt version', status.history.map(v => ({ label: `${v.id} · ${v.message} · ${v.at}`, value: v.commit })));
  if (!commit) return;
  const action = await ui.choose('Hvad vil du gøre med versionen?', [{ label: 'Behold det aktuelle projekt', value: 'keep' }, { label: 'Gennemgå gendannelse af filer', value: 'restore' }]);
  if (action !== 'restore') return;
  const review = await bench.restoration.review(root, { commit });
  for (const file of review.files) show(ui, file);
  if (!review.files.length) { ui.line('Filerne er allerede som i denne version.'); return; }
  if (await ui.confirm('Gendan disse filer? Nuværende filer sikkerhedskopieres; Git-historikken omskrives ikke.')) {
    await bench.restoration.apply(root, review.token);
    await bench.invalidatePlan(randomUUID()); ui.line('Filerne er gendannet. Gennemgå resultatet, før du gemmer en ny version.');
  }
}
async function preview(app) {
  const { ui } = app, root = app.bench.project.root;
  if (app.dev.snapshot().url) {
    const url = app.dev.snapshot().url; ui.line(url);
    if (await ui.confirm('Åbn udviklingsserveren i browseren?')) await (app.openBrowser || openBrowser)(url, ui);
    return;
  }
  await publicFile(path.join(root, 'public'), 'index.html').catch(() => { throw new Error('Ingen public/index.html. Brug /server til React/Vite eller Astro. Arbejdet med AI kan fortsætte uden preview.'); });
  app.preview ||= await startPreview(root);
  ui.line(`Forhåndsvisning på denne computer: ${app.preview.url}`);
  ui.line('Serveren læser public-mappen fra disk og lukker, når Aura afsluttes. Genindlæs browseren efter ændringer.');
  if (await ui.confirm('Åbn i browseren?')) await (app.openBrowser || openBrowser)(app.preview.url, ui);
}
async function server(app) {
  const { ui, dev } = app;
  const action = await ui.choose('Lokal udviklingsserver', [{ label: 'Start server', value: 'start' }, { label: 'Installér projektets pakker', value: 'install' }, { label: 'Status, output eller stop', value: 'status' }]);
  if (!action) return;
  if (action === 'status') {
    show(ui, await dev.status());
    if (await ui.confirm('Stop server eller installation?')) await dev.stop();
    return;
  }
  let scripts = false;
  if (action === 'install') scripts = await ui.confirm('Tillad også pakkernes installationsscripts? De kører kode på din computer.');
  const review = await dev.prepare(action, scripts);
  show(ui, review);
  if (!await ui.confirm('Kør den viste handling i projektmappen?')) return;
  await dev.execute(review.token);
  ui.line('Ctrl+C stopper serveren eller installationen.');
  app.serverWaiting = true;
  try { while (['starting', 'installing'].includes(dev.snapshot().state)) await pause(100); }
  finally { app.serverWaiting = false; }
  show(ui, dev.snapshot());
  if (dev.snapshot().url && await ui.confirm('Åbn i browseren?')) await (app.openBrowser || openBrowser)(dev.snapshot().url, ui);
}
async function deploy(app) {
  const { ui, deployments } = app, root = app.bench.project.root;
  const state = await deployments.state(root);
  const action = await ui.choose('Testudgivelse', [{ label: 'Gennemgå en udgivelse', value: 'review' }, { label: 'Kontrollér seneste udgivelse', value: 'status' }]);
  if (!action) return;
  if (action === 'status') { show(ui, await deployments.check(root)); return; }
  const provider = await ui.choose('Hvor skal testversionen ligge?', [{ label: 'Vercel', value: 'vercel' }, { label: 'Azure Static Web Apps', value: 'azure' }]);
  if (!provider) return;
  ui.line('Bruger dit eksisterende CLI-login hos udbyderen. Opret konto, projekt og hemmeligheder hos udbyderen først. Ingen produktion eller Git-push her.');
  const mode = await ui.choose('Hvilke filer skal udgives?', [{ label: 'Færdigbygget webside', value: 'static' }, provider === 'vercel' ? { label: 'Kildekode, der bygges hos Vercel', value: 'source' } : { label: 'Færdig frontend og Azure Functions', value: 'functions' }]);
  if (!mode) return;
  const previous = state.config?.provider === provider ? state.config : {};
  const config = { provider, mode, directory: await ui.ask('Mappe med de gemte filer, relativt til projektet', { fallback: previous.directory || (mode === 'static' ? 'public' : '.') }), project: await ui.ask('Projektets navn eller ID hos udbyderen', { fallback: previous.project || '', required: true }) };
  if (provider === 'vercel') config.scope = await ui.ask('Vercel-teamets ID eller navn', { fallback: previous.scope || '', required: true });
  else { config.subscription = await ui.ask('Azure-abonnementets ID', { fallback: previous.subscription || '', required: true }); config.group = await ui.ask('Ressourcegruppe', { fallback: previous.group || '', required: true }); }
  if (mode === 'functions') { config.frontend = await ui.ask('Frontendmappe i pakken', { fallback: 'public' }); config.api = await ui.ask('Functions-mappe i pakken', { fallback: 'api' }); }
  const review = await deployments.review(root, config); show(ui, review);
  if (await ui.confirm('Upload denne version til det viste testmiljø og accepter udbyderens eventuelle forbrug?')) show(ui, await deployments.deploy(root, review.token));
}
async function references(app) {
  const assets = (app.bench.project.assets || []).filter(a => a.kind === 'reference');
  if (!assets.length) { app.ui.line('Projektet har ingen registrerede private referencer. Intet er valgt.'); return; }
  const next = [];
  for (const asset of assets) if (await app.ui.confirm(`Må modellen læse »${asset.name || asset.file}« i kommende opgaver i denne åbne samtale?`)) next.push(asset.file);
  app.references = next;
  app.ui.line(`${next.length} referencer valgt. Tidligere læst indhold kan stadig findes i samtalen.`);
}
async function rules(app) {
  const list = await app.bench.skills.list(app.bench.project.root);
  const id = await app.ui.choose('Læs projektets regler og skills', list.map(s => ({ label: `${s.title}${s.enabled ? '' : ' (slået fra)'}`, value: s.id })));
  if (!id) return;
  const skill = list.find(s => s.id === id); app.ui.line(skill.content);
  const action = await app.ui.choose('Instruktioner for dette projekt', [{ label: 'Behold', value: 'keep' }, { label: 'Indlæs min tilpassede tekstfil', value: 'import' }, { label: 'Gendan fælles tekst', value: 'reset' }]);
  if (action === 'import') {
    const file = path.resolve(await app.ui.ask('Sti til tekstfil', { required: true }));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 96000) throw new Error('Vælg en almindelig tekstfil på højst 96 kB.');
    const content = await fs.readFile(file, 'utf8'); app.ui.line(content);
    if (await app.ui.confirm('Brug disse instruktioner fra næste AI-opgave?')) await app.bench.skills.save(app.bench.project.root, { id, content });
  } else if (action === 'reset' && await app.ui.confirm('Fjern tilpasningen og gendan den fælles tekst?')) await app.bench.skills.save(app.bench.project.root, { id, reset: true, content: '' });
}
module.exports = { init, diff, undo, save, versions, preview, server, deploy, references, rules };
