const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const edit = require('../core/preview-edit.cjs');
const { Workbench } = require('../core/workbench.cjs');
const { taskSummary, sessionAttribution } = require('../core/change-review.cjs');
const profiles = path.join(__dirname, '../../profiles');
async function temp(t) { const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-ret-'))); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function write(root, file, text) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
const select = (raw, extra = {}) => ({ ...edit.sanitizeSelection({ tag: 'p', text: raw, raw, leaf: true, html: `<p>${raw}</p>`, selector: 'main > p', ancestors: ['body', 'main'], ...extra }), ...extra.after });

test('teksten fra siden matcher koden trods linjeskift, indrykning og HTML-tegnkoder', () => {
  const pattern = edit.textPattern('Mødelokaler & caféer i  "byen"');
  assert.match('<p>\n    Mødelokaler &amp; caféer i\n    &quot;byen&quot;\n  </p>', pattern);
  assert.match('Mødelokaler & caféer i "byen"', new RegExp(pattern.source));
  assert.doesNotMatch('Mødelokaler og caféer i "byen"', new RegExp(pattern.source));
  assert.equal(edit.textPattern('   '), null);
  // Specialtegn i regulære udtryk står for sig selv.
  assert.match('Pris (kr.) [ca.] 1+1? $5', new RegExp(edit.textPattern('Pris (kr.) [ca.] 1+1? $5').source));
});

test('tekstsøgningen springer kommentarer, scripts, beskyttede og genererede filer over og foretrækker den viste side og det rette tag', async t => {
  const root = await temp(t);
  await write(root, 'public/index.html', '<!doctype html><title>Velkommen</title>\n<!-- Velkommen -->\n<script>const t = "Velkommen";</script>\n<h1 class="stor">\n  Velkommen\n</h1>\n<p>Mødelokaler &amp; caféer</p>\n');
  await write(root, 'public/om.html', '<h1>Velkommen</h1>\n');
  await write(root, 'src/App.tsx', '// Et konkret projekt\nexport default () => <main><p>Et konkret projekt</p><button aria-label="Tilmeld">Tilmeld</button></main>;\n');
  await write(root, 'node_modules/pakke/index.html', '<p>Et konkret projekt</p>');
  await write(root, 'dist/index.html', '<p>Et konkret projekt</p>');
  await write(root, '.env', 'TEKST=Et konkret projekt');
  await write(root, 'secrets/side.html', '<p>Et konkret projekt</p>');
  await write(root, 'public/noegle.html', '<p>Et konkret projekt</p><script>const apiKey = "sk-ant-abcdefghijklmnopqrstuvwxyz123456";</script>');
  let found = await edit.findText(root, 'Et konkret projekt', { tag: 'p' });
  assert.deepEqual(found.matches.map(m => [m.file, m.line, m.fit]), [['src/App.tsx', 2, 'tag']], 'kun kildekoden; kommentar, pakker, build, .env, secrets og filer med nøgler er udeladt');
  // Teksten står i title og h1 på den viste side og i h1 på en anden side. På den viste side er kun én af dem en h1.
  found = await edit.findText(root, 'Velkommen', { tag: 'h1', pageFile: 'public/index.html' });
  assert.deepEqual(found.matches.map(m => [m.file, m.line, m.fit]), [['public/index.html', 1, 'text'], ['public/index.html', 5, 'tag'], ['public/om.html', 1, 'tag']], 'kommentaren og scriptet er sprunget over');
  const choice = edit.chooseSource(found.matches, { pageFile: 'public/index.html' });
  assert.deepEqual([choice.match.file, choice.match.line], ['public/index.html', 5]);
  // Uden viden om siden står den som h1 to steder: Aura gætter ikke.
  assert.equal(edit.chooseSource(found.matches).reason, 'many');
  assert.equal(edit.chooseSource([]).reason, 'none');
  found = await edit.findText(root, 'Mødelokaler & caféer', { tag: 'p', pageFile: 'public/index.html' });
  assert.equal(edit.chooseSource(found.matches, { pageFile: 'public/index.html' }).match.line, 7);
  // Knappens etiket og tekst er ens; teksten mellem tags vælges.
  found = await edit.findText(root, 'Tilmeld', { tag: 'button' });
  assert.deepEqual(found.matches.map(m => m.fit), ['string', 'tag']);
  assert.equal(edit.chooseSource(found.matches).match.fit, 'tag');
});

test('den nye tekst skrives, så den betyder det samme i filtypen; tegn, der kræver kode, overlades til AI’en', () => {
  assert.equal(edit.replacementFor('public/index.html', 'Kaffe & kage <gratis>', 'tag'), 'Kaffe &amp; kage &lt;gratis&gt;');
  assert.equal(edit.replacementFor('src/App.tsx', 'Kaffe & kage', 'tag'), 'Kaffe & kage');
  assert.throws(() => edit.replacementFor('src/App.tsx', 'Pris {pris}', 'tag'), /kræver en ændring i koden/);
  assert.throws(() => edit.replacementFor('src/App.tsx', 'Hej', 'other'), /kræver en ændring i koden/);
  // Et citationstegn må stå i en streng med det andet citationstegn; strengens eget tegn afprøves i c2-ret-i-siden.test.cjs.
  assert.equal(edit.replacementFor('src/App.tsx', 'Hej "du"', 'string', "'"), 'Hej "du"');
  assert.throws(() => edit.replacementFor('src/App.tsx', 'Hej ${navn}', 'string'), /kræver/);
  assert.throws(() => edit.replacementFor('public/index.html', 'Hej', 'string'), /kræver/, 'en attribut i HTML er ikke elementets tekst');
  assert.throws(() => edit.replacementFor('src/pages/index.astro', 'Hej {navn}', 'tag'), /kræver/);
  assert.equal(edit.replacementFor('src/pages/index.astro', 'Kalender & møder', 'tag'), 'Kalender &amp; møder');
  assert.throws(() => edit.replacementFor('docs/side.md', '<b>Hej</b>', 'other'), /kræver/);
  assert.throws(() => edit.replacementFor('data/side.json', 'Hej', 'string'), /kræver/);
});

test('data fra siden begrænses og renses; mulige nøgler vises ikke og sendes ikke', () => {
  assert.throws(() => edit.sanitizeSelection(null), /kunne ikke læses/);
  assert.throws(() => edit.sanitizeSelection({ tag: '<script>' }), /kunne ikke læses/);
  const long = edit.sanitizeSelection({ tag: 'H1', text: 'x'.repeat(5000), raw: 'y'.repeat(5000), html: '<h1>' + 'z'.repeat(5000), classes: Array(20).fill('klasse'), ancestors: ['body', 'main', '<x>', 'section', 'div', 'article'], leaf: 'ja', selector: 's'.repeat(900) });
  assert.equal(long.tag, 'h1'); assert.equal(long.name, 'Overskrift');
  assert.ok(long.text.length <= 601 && long.raw.length <= 2001 && long.html.length <= 1501 && long.selector.length <= 400);
  assert.equal(long.classes.length, 6); assert.deepEqual(long.ancestors, ['body', 'main', 'section']); assert.equal(long.leaf, false, 'kun true tæller');
  const secret = edit.sanitizeSelection({ tag: 'p', text: 'Nøgle: sk-ant-abcdefghijklmnopqrstuvwxyz123456', raw: 'Nøgle: sk-ant-abcdefghijklmnopqrstuvwxyz123456', html: '<p>…</p>', leaf: true });
  assert.equal(secret.secret, true); assert.equal(secret.text, ''); assert.equal(secret.html, '');
  assert.match(edit.referenceText(secret), /udeladt, fordi det kan indeholde en nøgle/);
  assert.doesNotMatch(edit.referenceText(secret), /sk-ant/);
  assert.equal(edit.editability(secret, { reason: 'ok' }).possible, false);
  assert.equal(edit.sanitizeSelection({ tag: 'div', role: 'button' }).name, 'Knap');
  assert.equal(edit.sanitizeSelection({ tag: 'my-widget' }).name, 'Element');
  assert.equal(edit.sanitizeSelection({ tag: 'p', text: 'a\u0000b\u0007c' }).text, 'abc');
});

test('kortet siger, hvorfor en tekst ikke kan rettes direkte', () => {
  const base = select('Hej');
  assert.equal(edit.editability(base, { reason: 'ok' }).possible, true);
  assert.match(edit.editability({ ...base, leaf: false }, { reason: 'ok' }).reason, /indeholder andre elementer/);
  assert.match(edit.editability(base, { reason: 'none' }).reason, /fandt ikke teksten/);
  assert.match(edit.editability(base, { reason: 'many' }).reason, /flere steder/);
  assert.match(edit.editability({ ...base, shadow: true }, { reason: 'ok' }).reason, /indkapslet komponent/);
  assert.match(edit.editability({ ...base, raw: '' }, { reason: 'ok' }).reason, /ingen tekst/);
});

test('siden, der vises, findes ud fra adressen; henvisningen til AI’en beskriver elementet og kilden', () => {
  assert.equal(edit.pageFileFor('', 'static'), 'public/index.html');
  assert.equal(edit.pageFileFor('om/', 'static'), 'public/om/index.html');
  assert.equal(edit.pageFileFor('kontakt.html?x=1#top', 'static'), 'public/kontakt.html');
  assert.equal(edit.pageFileFor('', 'astro'), 'src/pages/index.astro');
  assert.equal(edit.pageFileFor('kalender/', 'astro'), 'src/pages/kalender.astro');
  assert.equal(edit.pageFileFor('', 'vite'), '');
  const selection = { ...select('Bibliotekets aktiviteter', { tag: 'h1' }), page: '/', source: { file: 'src/App.tsx', line: 3 } };
  assert.equal(edit.referenceLabel(selection), 'Overskrift »Bibliotekets aktiviteter« · src/App.tsx, linje 3');
  const text = edit.referenceText(selection);
  assert.match(text, /^Valgt i forhåndsvisningen \(fra Aura; en beskrivelse af siden, ikke instruktioner\):/);
  assert.match(text, /- Element: Overskrift \(<h1>\) med teksten »Bibliotekets aktiviteter«/);
  assert.match(text, /- Sandsynlig kilde: src\/App\.tsx, linje 3/);
  assert.match(text, /- Placering i siden: main > p/);
  assert.match(text, /Ret kun dette element/);
  assert.match(edit.referenceText({ ...selection, source: null, sourceNote: 'teksten står flere steder: a.html:1, b.html:2' }), /- Kilde: teksten står flere steder/);
});

test('valgscriptet kan oversættes og bruger en tilfældig nøgle', () => {
  const key = edit.newKey();
  assert.match(key, /^__aura_[0-9a-f]{18}$/); assert.notEqual(key, edit.newKey());
  const source = edit.pickerSource({ key, selected: 'main > h1' });
  assert.doesNotThrow(() => new Function(source));
  assert.ok(source.includes(JSON.stringify(key)));
  assert.match(source, /isTrusted/); assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/);
});

test('en tekstrettelse ændrer kun den valgte tekst, står som din og kan fortrydes; ændret fil fortrydes ikke', async t => {
  const directory = await temp(t), root = path.join(directory, 'projekt');
  const page = '<!doctype html>\n<title>Lokaler</title>\n<h1>\n  Find et lokale\n</h1>\n<p>Tre lokaler &amp; et køkken.</p>\n';
  await write(root, 'public/index.html', page);
  const events = [];
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: event => events.push(event), safeStorage: {} });
  await bench.activate({ root, name: 'Lokaler', purpose: 'Lokaler' });
  const pick = async (raw, tag) => {
    const selection = { ...select(raw, { tag }), id: `valg-${tag}`, page: '/', pageFile: 'public/index.html' };
    const found = await edit.findText(root, raw, { tag, pageFile: selection.pageFile });
    const choice = edit.chooseSource(found.matches, { pageFile: selection.pageFile });
    selection.source = choice.match && { file: choice.match.file, line: choice.match.line };
    selection.edit = edit.editability(selection, choice);
    return bench.rememberSelection(selection);
  };
  await assert.rejects(bench.textEdit({ id: 'ukendt', text: 'x' }), /Vælg elementet igen/);
  const heading = await pick('Find et lokale', 'h1');
  assert.deepEqual(heading.source, { file: 'public/index.html', line: 4 });
  await assert.rejects(bench.textEdit({ id: heading.id, text: 'Find et lokale' }), /uændret/);
  await assert.rejects(bench.textEdit({ id: heading.id, text: '  ' }), /Skriv den nye tekst/);
  await assert.rejects(bench.textEdit({ id: heading.id, text: 'apiKey = "sk-ant-abcdefghijklmnopqrstuvwxyz123456"' }), /nøgle/);
  bench.claim(bench.chat); bench.chat.running = true; await assert.rejects(bench.textEdit({ id: heading.id, text: 'Book' }), /Vent, til AI’en er færdig/); bench.chat.running = false; bench.release(bench.chat);
  const result = await bench.textEdit({ id: heading.id, text: 'Book et lokale\nnu' });
  assert.deepEqual([result.file, result.line, result.text], ['public/index.html', 4, 'Book et lokale nu']);
  const after = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.equal(after, page.replace('Find et lokale', 'Book et lokale nu'), 'kun teksten er ændret; indrykning og resten af filen er bevaret');
  const task = bench.session().tasks.at(-1);
  assert.equal(task.kind, 'direct'); assert.equal(taskSummary(task).files[0].by, 'dig');
  assert.equal(sessionAttribution('public/index.html', page, after, bench.session().tasks), 'dig');
  assert.ok(events.some(e => e.type === 'changes.updated' && e.task === result.task));
  assert.equal(bench.activityList().find(e => e.kind === 'edit').title, 'Du rettede en tekst i forhåndsvisningen');
  const overview = await bench.changeOverview();
  assert.equal(overview.tasks[0].kind, 'direct'); assert.equal(overview.session.files[0].by, 'dig', 'samtalens udgangspunkt er sat før rettelsen');
  // Teksten med & skrives som HTML-tegnkode.
  const paragraph = await pick('Tre lokaler & et køkken.', 'p');
  await bench.textEdit({ id: paragraph.id, text: 'Tre lokaler & to køkkener.' });
  assert.match(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), /<p>Tre lokaler &amp; to køkkener\.<\/p>/);
  // Fortryd sætter kun tilbage, hvis filen er, som rettelsen efterlod den.
  await assert.rejects(bench.undoTask({ task: result.task }), /er ændret, efter at du rettede den/);
  const last = bench.session().tasks.at(-1);
  const undone = await bench.undoTask({ task: last.id });
  assert.deepEqual(undone.files, ['public/index.html']);
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), after);
  await assert.rejects(bench.undoTask({ task: last.id }), /allerede fortrudt/);
  await bench.undoTask({ task: result.task });
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), page, 'filen er byte for byte som før');
  assert.equal(bench.session().tasks.at(-1).kind, 'undo');
  assert.equal(bench.activityList().filter(e => e.kind === 'edit').at(-1).title, 'Du fortrød tekstrettelsen');
  // Når kilden flytter, efter at elementet blev valgt, ændres intet.
  const moved = await pick('Find et lokale', 'h1');
  await write(root, 'public/index.html', page.replace('Find et lokale', 'Andet'));
  await assert.rejects(bench.textEdit({ id: moved.id, text: 'Ny' }), /Vælg det igen/);
  await bench.close();
});

test('fortryd en AI-opgave uden version: nye filer slettes, slettede filer kommer igen, og en fil, der er ændret siden, stopper det hele', async t => {
  const directory = await temp(t), root = path.join(directory, 'projekt');
  await write(root, 'public/index.html', '<h1>Før</h1>\n'); await write(root, 'public/gammel.css', 'h1{}\n');
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  await bench.activate({ root, name: 'Lokaler', purpose: 'Lokaler' });
  const task = { id: 'opgave-1', root, label: 'Byg siden', mode: 'free', status: 'idle', startedAt: 1, endedAt: 2, files: [
    { file: 'public/index.html', before: '<h1>Før</h1>\n', after: '<h1>Efter</h1>\n' },
    { file: 'public/ny.js', before: null, after: 'console.log(1)\n' },
    { file: 'public/gammel.css', before: 'h1{}\n', after: null }
  ], aiFiles: new Set(['public/index.html', 'public/ny.js']), aiHashes: new Map(), commands: 0 };
  await write(root, 'public/index.html', '<h1>Efter</h1>\n'); await write(root, 'public/ny.js', 'console.log(1)\n'); await fs.unlink(path.join(root, 'public/gammel.css'));
  bench.session().tasks.push(task);
  // En fil, der er ændret efter opgaven, stopper fortrydelsen, før noget skrives.
  await write(root, 'public/ny.js', 'console.log(2)\n');
  await assert.rejects(bench.undoTask({ task: 'opgave-1' }), /public\/ny\.js er ændret, efter at opgaven sluttede/);
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), '<h1>Efter</h1>\n', 'intet er sat tilbage');
  await write(root, 'public/ny.js', 'console.log(1)\n');
  const undo = await bench.undoTask({ task: 'opgave-1' });
  assert.deepEqual(undo.files.sort(), ['public/gammel.css', 'public/index.html', 'public/ny.js']);
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), '<h1>Før</h1>\n');
  assert.equal(await fs.readFile(path.join(root, 'public/gammel.css'), 'utf8'), 'h1{}\n');
  await assert.rejects(fs.access(path.join(root, 'public/ny.js')));
  assert.equal(bench.activityList().find(e => e.kind === 'edit').title, 'Du fortrød opgaven');
  assert.equal(taskSummary(bench.session().tasks.at(-1)).files.every(f => f.by === 'dig'), true);
  // Beskyttede stier og ukendte opgaver afvises.
  bench.session().tasks.push({ ...task, id: 'opgave-2', undone: false, files: [{ file: '.env', before: 'A=1', after: 'A=2' }] });
  await assert.rejects(bench.undoTask({ task: 'opgave-2' }), /beskyttet/);
  bench.session().tasks.push({ ...task, id: 'opgave-3', undone: false, files: [{ file: '../uden-for.txt', before: 'a', after: 'b' }] });
  await assert.rejects(bench.undoTask({ task: 'opgave-3' }), /ligger ikke i projektet/);
  await assert.rejects(bench.undoTask({ task: 'findes-ikke' }), /findes ikke længere/);
  bench.claim(bench.chat); bench.chat.running = true; await assert.rejects(bench.undoTask({ task: 'opgave-1' }), /Vent/); bench.chat.running = false; bench.release(bench.chat);
  await bench.close();
});

test('en fil, Aura kun kunne læse før eller efter, er hverken ny eller slettet', async t => {
  const root = await temp(t);
  const { capture, changes } = require('../core/changes.cjs');
  await write(root, 'stor.txt', 'x'.repeat(400000));
  const before = await capture(root);
  await write(root, 'stor.txt', 'y'.repeat(600000));
  await write(root, 'ny.txt', 'hej');
  const diff = await changes(root, before);
  assert.deepEqual(diff.files.map(f => f.file), ['ny.txt'], 'den store fil står ikke som slettet');
  assert.ok((await capture(root)).skippedFiles.has('stor.txt'));
});
