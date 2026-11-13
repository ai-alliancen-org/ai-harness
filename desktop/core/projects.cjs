const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const escapeHTML = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function validate(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw new Error('Skriv et projektnavn på højst 80 tegn.');
  if (typeof input.purpose !== 'string' || !input.purpose.trim() || input.purpose.length > 3000) throw new Error('Beskriv idéen med højst 3.000 tegn.');
  if (input.color != null && input.color !== '' && !/^#[a-f0-9]{6}$/i.test(input.color)) throw new Error('Vælg en gyldig brandfarve.');
  if (!Array.isArray(input.links) || input.links.length > 10) throw new Error('Tilføj højst ti referencelinks.');
  for (const link of input.links) {
    let url;
    try { url = new URL(link); } catch { throw new Error('Et referencelink er ugyldigt. Brug en fuld http- eller https-adresse.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Referencelinks skal være almindelige http- eller https-adresser uden loginoplysninger.');
  }
  if (!['manuel', 'automatiske', 'senere'].includes(input.tests)) throw new Error('Vælg en teststrategi.');
  return { name: input.name.trim(), purpose: input.purpose.trim(), color: input.color || null, links: input.links, tests: input.tests };
}

// Danske bogstaver skrives om, så mappenavnet kan læses og bruges af udviklingsværktøjer.
const danishLetters = { æ: 'ae', ø: 'oe', å: 'aa', Æ: 'Ae', Ø: 'Oe', Å: 'Aa' };
function folderSlug(name) {
  return name.replace(/[æøåÆØÅ]/g, letter => danishLetters[letter]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || 'projekt';
}

async function createProject(parent, input, assets = [], profileRoot) {
  const values = validate(input);
  await checkProjectAccess(parent);
  const base = path.join(await fs.realpath(parent), `projekt-${folderSlug(values.name)}`);
  let root;
  // Eksisterende mapper må aldrig genbruges eller overskrives. Et projekt med samme navn får et nummer.
  for (let number = 1; ; number++) {
    root = number === 1 ? base : `${base}-${number}`;
    try { await fs.mkdir(root); break; }
    catch (error) { if (error.code !== 'EEXIST' || number >= 99) throw error; }
  }
  try {
    await fs.mkdir(path.join(root, 'public', 'assets'), { recursive: true });
    await fs.mkdir(path.join(root, 'references'));
    const copied = [];
    for (const asset of assets) {
      const stat = await fs.lstat(asset.path);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('Hver materialefil skal være en almindelig fil på højst 10 MB.');
      const ext = path.extname(asset.path).toLowerCase();
      if (!['reference', 'logo'].includes(asset.kind)) throw new Error('Ukendt materialetype.');
      if (asset.kind === 'logo' && !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Logoer skal være PNG, JPG eller WebP.');
      const relative = `${asset.kind === 'logo' ? 'public/assets' : 'references'}/${crypto.randomUUID()}${ext}`;
      await fs.copyFile(asset.path, path.join(root, relative), require('node:fs').constants.COPYFILE_EXCL);
      copied.push({ kind: asset.kind, name: asset.name || path.basename(asset.path), file: relative });
    }
    const logo = copied.find(asset => asset.kind === 'logo');
    const starter = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(values.name)}</title><link rel="stylesheet" href="styles.css"></head>
<body><main>${logo ? `<img class="logo" src="${logo.file.slice(7)}" alt="Projektets logo">` : ''}<p class="label">HER BEGYNDER DIN IDÉ</p><h1>${escapeHTML(values.name)}</h1><p class="intro">${escapeHTML(values.purpose)}</p><div class="card"><h2>Plads til det, du vil skabe.</h2><p>Dette er din lokale startside. Den er oprettet fra dine valg og er endnu ikke bygget af en AI.</p></div></main></body></html>`;
    // Startsidens fingeraftryk. Så længe siden er uændret, viser appen en pladsholder i stedet for siden; se openProject.
    const project = { schemaVersion: 1, ...values, designChoices: { color: values.color }, template: 'statisk-web', assets: copied, starter: crypto.createHash('sha256').update(starter).digest('hex') };
    await fs.writeFile(path.join(root, 'harness.json'), JSON.stringify(project, null, 2) + '\n', { flag: 'wx' });
    const rules = await fs.readFile(path.join(profileRoot, 'grundregler.md'), 'utf8');
    for (const file of ['AGENTS.md', 'CLAUDE.md']) await fs.writeFile(path.join(root, file), rules, { flag: 'wx' });
    await fs.writeFile(path.join(root, '.gitignore'), (await fs.readFile(path.join(profileRoot, 'gitignore.txt'), 'utf8')) + '\n# Lokalt inspirationsmateriale\n/references/\n', { flag: 'wx' });
    await fs.writeFile(path.join(root, 'public', 'index.html'), starter, { flag: 'wx' });
    await fs.writeFile(path.join(root, 'public', 'styles.css'), '/* Midlertidig startside fra Aura. Farver, typografi og teknologi er ikke valgt. */\nbody{margin:0;padding:32px;background:#fff;color:#222;font:16px/1.6 system-ui}main{max-width:800px;margin:auto}.logo{max-width:180px;max-height:90px;object-fit:contain}', { flag: 'wx' });
    await fs.writeFile(path.join(root, 'README.md'), `# ${values.name}\n\n${values.purpose}\n\nÅbn projektmappen i Aura for lokal forhåndsvisning. En enkel hjemmeside vises fra public/. Bygges projektet senere med et framework eller en tjeneste, viser forhåndsvisningen det, projektets opstart starter.\n\nProjektvalg ligger i harness.json. Referencer ligger i references/ og er ikke offentlige. Logoer i public/assets/ er offentligt indhold ved udgivelse.\n\nTeststrategi: ${values.tests}. Der er endnu ikke oprettet tests. Versioner gemmes lokalt med Git i denne mappe; intet sendes nogen steder hen. AI-forbindelsen vælges separat i appen. Hosting er ikke tilsluttet.\n`, { flag: 'wx' });
    return { root, ...project };
  } catch (error) {
    throw new Error(`Projektoprettelsen blev afbrudt. Eventuelle filer er bevaret i ${root}. ${error.message}`);
  }
}

// En faktisk mappeåbning udløser operativsystemets adgangskontrol før første AI-opgave.
// Der læses ingen filindhold, og eksisterende projekter ændres ikke.
async function checkProjectAccess(folder) {
  try {
    const root = await fs.realpath(folder);
    const directory = await fs.opendir(root);
    await directory.close();
    return root;
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) throw new Error('Aura kan ikke åbne projektmappen. Tillad mappeadgang i computerens indstillinger, og prøv igen, eller vælg en anden mappe.', { cause: error });
    throw error;
  }
}

async function openProject(folder) {
  const root = await checkProjectAccess(folder);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Vælg en mappe som arbejdsområde.');
  const base = { root, name: path.basename(root), purpose: '', assets: [], links: [], template: 'eksisterende', warnings: [] };
  const manifest = path.join(root, 'harness.json');
  try {
    const info = await fs.lstat(manifest);
    if (!info.isFile() || info.size > 100_000) throw new Error('Projektfilen er ugyldig.');
    const project = JSON.parse(await fs.readFile(manifest, 'utf8'));
    validate(project);
    if (project.schemaVersion !== 1) throw new Error('Ukendt projektformat.');
    if (!Array.isArray(project.assets) || project.assets.some(a => !a || !['logo', 'reference'].includes(a.kind) || typeof a.name !== 'string' || typeof a.file !== 'string')) throw new Error('Ugyldige materialer.');
    Object.assign(base, validate(project), { schemaVersion: 1, assets: project.assets, template: 'statisk-web' });
    if (project.designChoices && Object.hasOwn(project.designChoices, 'color') && (project.designChoices.color === null || /^#[a-f0-9]{6}$/i.test(project.designChoices.color))) base.designChoices = { color: project.designChoices.color };
    if (/^[a-f0-9]{64}$/.test(project.starter || '')) base.starter = project.starter;
  } catch (error) {
    if (error.code !== 'ENOENT') base.warnings.push('harness.json kunne ikke indlæses. Mappen er åbnet uden at ændre filen.');
  }
  try {
    const dir = await fs.lstat(path.join(root, 'public'));
    const index = await fs.lstat(path.join(root, 'public/index.html'));
    if (dir.isDirectory() && index.isFile()) base.staticPreview = true;
    // Den uændrede startside er ikke brugerens app endnu. Ruden viser en pladsholder, til AI'en har bygget første version.
    if (base.staticPreview && base.starter && index.size < 100_000 && crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'public/index.html'))).digest('hex') === base.starter) { base.staticPreview = false; base.waitingForFirstVersion = true; }
  } catch { /* Projektåbning kræver ikke en startside. */ }
  return base;
}
// Ældre manifests indeholdt en automatisk grøn farve. Den kan ikke regnes som et aktivt brugervalg.
function designContext(project) {
  return {
    primaryColor: project.designChoices?.color || null,
    colorSource: project.designChoices?.color ? 'Valgt af brugeren' : 'Ingen bekræftet brandfarve',
    startingPoint: project.waitingForFirstVersion ? 'Auras uændrede pladsholder. Dens HTML/CSS, farver og typografi er ikke brugerens valg. Foreslå design og teknologi ud fra opgaven.' : 'Undersøg projektets aktuelle kode og brugerens ønsker. Et gammelt harness.json er ikke bevis for en valgt brandfarve.',
  };
}
module.exports = { createProject, openProject, validate, folderSlug, checkProjectAccess, designContext };
