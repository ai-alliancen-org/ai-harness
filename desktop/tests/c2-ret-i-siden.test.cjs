// Ret i siden (gennemgangens fund 18 og 21, beta 3). En direkte rettelse må kun ændre den valgte tekst:
// en fil, der ikke er gyldig UTF-8, overlades til AI'en, og en rettelse i en JavaScript-streng må ikke afslutte strengen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const edit = require('../core/preview-edit.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

async function project(t, files) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-ret-'))), root = path.join(directory, 'projekt');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  await bench.activate({ root, name: 'Lokaler', purpose: 'Lokaler' });
  t.after(() => bench.close());
  return { root, bench };
}
// Samme kæde som pickedElement i main.cjs: rens valget, find teksten, vælg kilden og afgør, om den kan rettes direkte.
async function pick(bench, root, raw, tag, pageFile = '') {
  const selection = { ...edit.sanitizeSelection({ tag, text: raw, raw, leaf: true, html: `<${tag}>${raw}</${tag}>`, selector: tag }), id: `valg-${tag}-${raw}`, page: '/', pageFile };
  const found = await edit.findText(root, raw, { tag, pageFile });
  const choice = edit.chooseSource(found.matches, { pageFile });
  selection.source = choice.match ? { file: choice.match.file, line: choice.match.line } : null;
  selection.edit = edit.editability(selection, choice);
  return bench.rememberSelection(selection);
}
// En ældre side i Windows-1252: ø, å, Æ og Å er enkeltbytes, som ikke er gyldig UTF-8.
const latin1 = Buffer.concat([Buffer.from('<!doctype html><meta charset="windows-1252">\n<h1>Velkommen</h1>\n<p>K'), Buffer.from([0xf8]), Buffer.from('benhavn, p'), Buffer.from([0xe5]), Buffer.from(' '), Buffer.from([0xc6]), Buffer.from('r'), Buffer.from([0xf8]), Buffer.from(' og i '), Buffer.from([0xc5]), Buffer.from('rhus</p>\n<h2>S'), Buffer.from([0xf8]), Buffer.from('ren</h2>\n')]);

test('fund 18: en fil, der ikke er UTF-8, rettes ikke direkte; kortet siger hvorfor, og filen er byte for byte uændret', async t => {
  const { root, bench } = await project(t, { 'public/index.html': latin1 });
  const heading = await pick(bench, root, 'Velkommen', 'h1', 'public/index.html');
  assert.deepEqual(heading.source, { file: 'public/index.html', line: 2 }, 'AI’en får stadig kilden at vide');
  assert.equal(heading.edit.possible, false, 'kortet tilbyder ikke Ret teksten');
  assert.match(heading.edit.reason, /ældre tekstformat/); assert.match(heading.edit.reason, /æ, ø og å/); assert.match(heading.edit.reason, /Bed AI’en/);
  await assert.rejects(bench.textEdit({ id: heading.id, text: 'Hej og velkommen' }), /ældre tekstformat/);
  assert.ok((await fs.readFile(path.join(root, 'public/index.html'))).equals(latin1), 'ingen bytes er ændret');
  // Teksten, der allerede vises med erstatningstegnet, kan heller ikke rettes direkte.
  const name = await pick(bench, root, 'S\uFFFDren', 'h2', 'public/index.html');
  assert.equal(name.edit.possible, false);
  // Henvisningen til AI'en siger, at filen skal behandles som andet end UTF-8, så AI'en ikke ødelægger den på samme måde.
  assert.match(edit.referenceText(heading), /ikke gemt som UTF-8/);
});

// Prøve 2 vogter kontrollen, når Aura finder teksten igen før rettelsen (match.utf8 i applyTextEdit). Bytekontrollen lige før
// skrivningen vogtes af prøve 3. Den nye tekst har strengens eget citationstegn, så uden kontrollen ville Aura give en forkert grund
// («kræver en ændring i koden») i stedet for den rigtige: filen er gemt i et ældre tekstformat.
test('fund 18: er filen gemt i et ældre tekstformat efter valget, afviser Aura rettelsen med netop den grund, når teksten findes igen', async t => {
  const { root } = await project(t, { 'public/index.html': latin1 });
  // Valget blev gjort, mens filen var UTF-8; bagefter er den gemt i et ældre tekstformat.
  const selection = { ...edit.sanitizeSelection({ tag: 'h1', text: 'Velkommen', raw: 'Velkommen', leaf: true }), pageFile: 'public/index.html', source: { file: 'public/index.html', line: 2 }, edit: { possible: true } };
  await assert.rejects(edit.applyTextEdit(root, selection, 'Hej'), error => error.code === 'encoding' && /ældre tekstformat/.test(error.message));
  assert.ok((await fs.readFile(path.join(root, 'public/index.html'))).equals(latin1));
  // I en JavaScript-streng: grunden er tekstformatet, ikke strengens citationstegn i den nye tekst.
  const script = Buffer.concat([Buffer.from('// K'), Buffer.from([0xf8]), Buffer.from('benhavn\nconst overskrift = "Velkommen";\nmodule.exports = overskrift;\n')]);
  const js = await project(t, { 'src/data.js': script });
  const valg = { ...edit.sanitizeSelection({ tag: 'h1', text: 'Velkommen', raw: 'Velkommen', leaf: true }), pageFile: '', source: { file: 'src/data.js', line: 2 }, edit: { possible: true } };
  await assert.rejects(edit.applyTextEdit(js.root, valg, 'Velkommen "hjem"'), error => error.code === 'encoding');
  assert.ok((await fs.readFile(path.join(js.root, 'src/data.js'))).equals(script), 'intet er skrevet');
});

test('fund 18: gemmes filen i et ældre tekstformat lige før skrivningen, fanger bytekontrollen det', async t => {
  const utf8 = Buffer.from(latin1.toString('latin1'), 'utf8');
  const { root } = await project(t, { 'public/index.html': utf8 });
  const projectFiles = require('../core/project-files.cjs'), original = projectFiles.readFile;
  let reads = 0;
  // Søgningen ser en UTF-8-fil. Før næste læsning gemmer et andet program filen som Windows-1252.
  projectFiles.readFile = async (...args) => { if (++reads === 2) await fs.writeFile(path.join(root, 'public/index.html'), latin1); return original(...args); };
  t.after(() => { projectFiles.readFile = original; });
  const selection = { ...edit.sanitizeSelection({ tag: 'h1', text: 'Velkommen', raw: 'Velkommen', leaf: true }), pageFile: 'public/index.html', source: { file: 'public/index.html', line: 2 }, edit: { possible: true } };
  await assert.rejects(edit.applyTextEdit(root, selection, 'Hej'), error => error.code === 'encoding');
  assert.equal(reads, 2, 'kontrollen sker efter den sidste læsning');
  assert.ok((await fs.readFile(path.join(root, 'public/index.html'))).equals(latin1), 'intet er skrevet');
});

test('fund 18: gyldig UTF-8 med BOM, æ, ø, å og et ægte erstatningstegn rettes stadig, og kun den valgte tekst ændres', async t => {
  const page = Buffer.from('\uFEFF<!doctype html><meta charset="utf-8">\n<h1>Velkommen</h1>\n<p>København, på Ærø og i Århus \uFFFD</p>\n', 'utf8');
  const { root, bench } = await project(t, { 'public/index.html': page });
  const heading = await pick(bench, root, 'Velkommen', 'h1', 'public/index.html');
  assert.equal(heading.edit.possible, true);
  await bench.textEdit({ id: heading.id, text: 'Hej og velkommen' });
  const after = await fs.readFile(path.join(root, 'public/index.html'));
  assert.ok(after.equals(Buffer.from(page.toString('utf8').replace('Velkommen', 'Hej og velkommen'), 'utf8')), 'BOM, æ, ø, å og resten af filen er bevaret');
});

test('fund 21: en ny tekst med strengens eget citationstegn afvises, så JavaScript-filen ikke får en syntaksfejl', async t => {
  const source = 'const lokaler = [{ navn: "Mødelokale A", pladser: 8 }, { navn: \'Jens team\', pladser: 4 }];\nmodule.exports = lokaler;\n';
  const { root, bench } = await project(t, { 'src/data.js': source });
  const room = await pick(bench, root, 'Mødelokale A', 'h2');
  assert.equal(room.edit.possible, true, 'teksten står ét sted og kan som udgangspunkt rettes');
  await assert.rejects(bench.textEdit({ id: room.id, text: 'Mødelokale "Store sal"' }), /kræver en ændring i koden/);
  const team = await pick(bench, root, 'Jens team', 'h2');
  await assert.rejects(bench.textEdit({ id: team.id, text: 'Jens\' team' }), /kræver en ændring i koden/);
  assert.equal(await fs.readFile(path.join(root, 'src/data.js'), 'utf8'), source, 'filen er uændret');
  // Det andet citationstegn må gerne stå i strengen, og filen kan stadig læses som JavaScript.
  await bench.textEdit({ id: room.id, text: 'Mødelokale \'Store sal\'' });
  await bench.textEdit({ id: team.id, text: 'Jens "team"' });
  const after = await fs.readFile(path.join(root, 'src/data.js'), 'utf8');
  assert.match(after, /navn: "Mødelokale 'Store sal'"/); assert.match(after, /navn: 'Jens "team"'/);
  assert.doesNotThrow(() => new vm.Script(after), 'filen er gyldig JavaScript');
});

test('fund 21: replacementFor kender strengens citationstegn; uden det rettes en streng ikke direkte', () => {
  assert.equal(edit.replacementFor('src/App.tsx', 'Hej "du"', 'string', "'"), 'Hej "du"');
  assert.throws(() => edit.replacementFor('src/App.tsx', 'Hej "du"', 'string', '"'), /kræver en ændring i koden/);
  assert.throws(() => edit.replacementFor('src/App.tsx', "Jens' team", 'string', "'"), /kræver en ændring i koden/);
  assert.equal(edit.replacementFor('src/App.tsx', 'Jens’ team', 'string', "'"), 'Jens’ team', 'den typografiske apostrof afslutter ikke strengen');
  // I en skabelon (Astro, Vue, Svelte) kan strengen stå i en attribut, så kun typografiske anførselstegn rettes direkte (tests/c2-vue-citat.test.cjs).
  assert.equal(edit.replacementFor('src/pages/index.astro', 'Hej “du”', 'string', '`'), 'Hej “du”');
  assert.throws(() => edit.replacementFor('src/App.tsx', 'Hej', 'string'), /kræver en ændring i koden/, 'ukendt citationstegn: AI’en tager over');
});
