const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { merge3, resolve } = require('../core/merge.cjs');
const { History, PreviewImages, kindOf, defaultName } = require('../core/history.cjs');
const { GitVersions, run } = require('../core/git.cjs');
const { Restoration } = require('../core/restoration.cjs');
const { Store } = require('../core/store.cjs');
async function temp(t) { const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-historik-'))); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
const lines = (...items) => items.map(item => `${item}\n`).join('');

test('fletningen fjerner kun ændringen og bevarer det, der er rettet siden, byte for byte', () => {
  // base: filen efter ændringen. ours: filen nu. theirs: filen før ændringen.
  const base = lines('a', 'B fra AI', 'c', 'd', 'e'), ours = lines('a', 'B fra AI', 'c', 'd', 'E fra dig'), theirs = lines('a', 'b', 'c', 'd', 'e');
  let merge = merge3(base, ours, theirs);
  assert.equal(merge.clean, true); assert.equal(resolve(merge), lines('a', 'b', 'c', 'd', 'E fra dig'));
  // Brugeren har ikke rørt noget: resultatet er filen før ændringen.
  assert.equal(resolve(merge3(base, base, theirs)), theirs);
  // Samme ændring på begge sider er ingen konflikt.
  assert.equal(merge3(lines('x'), lines('y'), lines('y')).clean, true);
  // Begge har rettet samme linje: konflikt, og brugeren vælger for hele filen.
  merge = merge3(lines('a', 'Fire lokaler', 'c'), lines('a', 'Fire store lokaler', 'c'), lines('a', 'Tre lokaler', 'c'));
  assert.equal(merge.clean, false); assert.equal(merge.conflicts, 1); assert.equal(merge.segments.find(s => s.type === 'conflict').line, 2);
  assert.equal(resolve(merge, 'ours'), lines('a', 'Fire store lokaler', 'c')); assert.equal(resolve(merge, 'theirs'), lines('a', 'Tre lokaler', 'c'));
  // To indsættelser samme sted er en konflikt; en indsættelse lige før en fjernet blok er ikke.
  assert.equal(merge3(lines('a', 'b'), lines('a', 'din', 'b'), lines('a', 'gammel', 'b')).clean, false);
  merge = merge3(lines('a', 'AI 1', 'AI 2', 'b'), lines('a', 'din', 'AI 1', 'AI 2', 'b'), lines('a', 'b'));
  assert.equal(merge.clean, true); assert.equal(resolve(merge), lines('a', 'din', 'b'));
  // Linjeskift og manglende afsluttende linjeskift bevares.
  merge = merge3('a\r\nX\r\nc', 'a\r\nX\r\nc ændret', 'a\r\nb\r\nc');
  assert.equal(resolve(merge), 'a\r\nb\r\nc ændret');
  assert.equal(resolve(merge3('', 'ny', '')), 'ny');
});

test('versionernes type og navn kommer fra Auras beskrivelser; omdøbning ændrer ikke Git', async t => {
  assert.equal(kindOf('AI-opgave: Byg en side'), 'ai'); assert.equal(kindOf('Afbrudt AI-opgave: x'), 'stopped'); assert.equal(kindOf('Gendannet til: x'), 'restore');
  assert.equal(kindOf('Fortrudt: x'), 'undo'); assert.equal(kindOf('Dine ændringer før gendannelsen'), 'saved'); assert.equal(kindOf('Projekt oprettet'), 'start'); assert.equal(kindOf('Mine noter'), 'manual');
  assert.equal(defaultName('AI-opgave: Byg første udkast efter den plan, jeg har gennemgået. Afslut med konkrete ting.'), 'Byg første udkast efter den plan, jeg har gennemgået');
  assert.equal(defaultName('AI-opgave: ' + 'ord '.repeat(30)), 'ord ord ord ord ord ord ord ord ord ord ord ord ord ord ord …');
  assert.equal(defaultName('Gendannet til: Første side'), 'Tilbage til »Første side«'); assert.equal(defaultName('Fortrudt: Byg'), 'Fortrudt »Byg«');
  assert.equal(defaultName('Projekt oprettet'), 'Projektet blev oprettet');
  const directory = await temp(t), root = path.join(directory, 'projekt'); await fs.mkdir(root);
  const store = new Store(path.join(directory, 'data'), {}), history = new History(store);
  const commit = 'a'.repeat(40);
  assert.deepEqual((await history.describe(root, [{ commit, message: 'AI-opgave: Byg en side. Mere.', at: '2026-10-06T10:00:00Z' }]))[0], { commit, message: 'AI-opgave: Byg en side. Mere.', at: '2026-10-06T10:00:00Z', kind: 'ai', kindLabel: 'AI-opgave', name: 'Byg en side', renamed: false });
  assert.equal(await history.rename(root, commit, '  Forsiden  '), 'Forsiden');
  assert.equal((await history.describe(root, [{ commit, message: 'AI-opgave: Byg' }]))[0].name, 'Forsiden');
  await assert.rejects(history.rename(root, commit, 'to\nlinjer'), /én linje/); await assert.rejects(history.rename(root, 'ikke-en-version', 'x'), /Vælg en version/);
  await history.rename(root, commit, '');
  assert.equal((await history.describe(root, [{ commit, message: 'AI-opgave: Byg' }]))[0].renamed, false);
});

async function repository(t) {
  const base = await temp(t), root = path.join(base, 'Projekt med mellemrum'); await fs.mkdir(root);
  const git = new GitVersions(); await git.initialize(root);
  // Brugerens særskilte tilladelse gælder kun syntetiske testrepositories.
  for (const [key, value] of [['user.name', 'Testbruger'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(base, 'hooks')]]) await run(root, ['config', '--local', key, value]);
  const store = { root: path.join(base, 'appdata'), projectKey: x => require('node:crypto').createHash('sha256').update(x).digest('hex') };
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), value); };
  const save = async message => { const review = await git.review(root); return (await git.commit(root, { token: review.token, files: review.files.filter(f => !f.blocked).map(f => f.file), message })).head; };
  return { base, root, git, store, write, save, restore: new Restoration(git, store), read: name => fs.readFile(path.join(root, name), 'utf8') };
}

test('fortryd en gemt version: senere versioner og ugemte rettelser bevares, konflikter afgøres, og første version kan ikke fortrydes', async t => {
  const r = await repository(t);
  await r.write('public/index.html', lines('<h1>Lokaler</h1>', '<p>Tre lokaler.</p>', '<ul>', '<li>Lille sal</li>', '</ul>', '<footer>Kommunen</footer>'));
  const first = await r.save('Projekt oprettet');
  await r.write('public/index.html', (await r.read('public/index.html')).replace('<li>Lille sal</li>\n', '<li>Lille sal</li>\n<li>Stor sal</li>\n')); await r.write('ny.js', 'ny\n');
  const task = await r.save('AI-opgave: Tilføj en sal');
  await r.write('public/index.html', (await r.read('public/index.html')).replace('<h1>Lokaler</h1>', '<h1>Mødelokaler</h1>'));
  await r.save('Senere version');
  await r.write('public/index.html', (await r.read('public/index.html')).replace('Kommunen', 'Borgerservice'));
  const review = await r.restore.review(r.root, { revert: task });
  assert.equal(review.kind, 'revert');
  assert.deepEqual(review.files.map(f => [f.file, f.outcome, f.action]), [['ny.js', 'restore', 'Slettes'], ['public/index.html', 'kept', 'Ændres']]);
  await r.restore.apply(r.root, review.token);
  assert.equal(await r.read('public/index.html'), lines('<h1>Mødelokaler</h1>', '<p>Tre lokaler.</p>', '<ul>', '<li>Lille sal</li>', '</ul>', '<footer>Borgerservice</footer>'));
  await assert.rejects(fs.access(path.join(r.root, 'ny.js')));
  // Kopien før fortrydelsen kan bringe det hele tilbage.
  const undo = await r.restore.review(r.root, { undo: true }); await r.restore.apply(r.root, undo.token);
  assert.match(await r.read('public/index.html'), /Stor sal/); assert.equal(await r.read('ny.js'), 'ny\n');
  // Konflikt: brugeren har rettet den linje, versionen tilføjede.
  await r.write('public/index.html', (await r.read('public/index.html')).replace('<li>Stor sal</li>', '<li>Stor sal med scene</li>'));
  const conflict = await r.restore.review(r.root, { revert: task });
  const entry = conflict.files.find(f => f.file === 'public/index.html');
  assert.equal(entry.outcome, 'conflict'); assert.equal(conflict.conflicts, 1); assert.match(entry.conflict.parts[0].ours, /Stor sal med scene/);
  await r.restore.apply(r.root, conflict.token, { 'public/index.html': 'ours' });
  assert.match(await r.read('public/index.html'), /Stor sal med scene/, 'brugerens linjer er beholdt');
  await assert.rejects(fs.access(path.join(r.root, 'ny.js')), 'filen uden konflikt er fortrudt');
  await assert.rejects(r.restore.review(r.root, { revert: first }), /første version kan ikke fortrydes/);
  await assert.rejects(r.restore.review(r.root, { revert: 'f'.repeat(40) }), /Git kunne ikke/);
});

test('fortryd en opgave uden Git ud fra øjebliksbilleder, med valg ved konflikt og kopi til fortrydelse', async t => {
  const base = await temp(t), root = path.join(base, 'Uden Git'); await fs.mkdir(path.join(root, 'public'), { recursive: true });
  const store = { root: path.join(base, 'appdata'), projectKey: x => require('node:crypto').createHash('sha256').update(x).digest('hex') };
  const restore = new Restoration(new GitVersions(), store);
  const before = lines('a', 'b', 'c'), after = lines('a', 'B', 'c');
  await fs.writeFile(path.join(root, 'public/index.html'), lines('a', 'B', 'c', 'din linje'));
  await fs.writeFile(path.join(root, 'public/ny.css'), 'h1{}\n');
  const task = { files: [{ file: 'public/index.html', before, after }, { file: 'public/ny.css', before: null, after: 'h1{}\n' }, { file: 'public/slettet.txt', before: 'gammel\n', after: null }] };
  const review = await restore.review(root, { task });
  assert.equal(review.git, false);
  assert.deepEqual(review.files.map(f => [f.file, f.outcome, f.action]), [['public/index.html', 'kept', 'Ændres'], ['public/ny.css', 'restore', 'Slettes'], ['public/slettet.txt', 'restore', 'Genskabes']]);
  await restore.apply(root, review.token);
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), lines('a', 'b', 'c', 'din linje'));
  assert.equal(await fs.readFile(path.join(root, 'public/slettet.txt'), 'utf8'), 'gammel\n');
  await assert.rejects(fs.access(path.join(root, 'public/ny.css')));
  const undo = await restore.review(root, { undo: true }); await restore.apply(root, undo.token);
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), lines('a', 'B', 'c', 'din linje'));
  // Filen er slettet af brugeren efter opgaven: hele filen afgøres af brugeren.
  await fs.rm(path.join(root, 'public/index.html'));
  const whole = await restore.review(root, { task: { files: [{ file: 'public/index.html', before, after }] } });
  assert.equal(whole.files[0].outcome, 'conflict'); assert.equal(whole.files[0].conflict.whole, true); assert.equal(whole.files[0].conflict.ours, null);
  const kept = await restore.apply(root, whole.token, {});
  assert.equal(kept.files, 0, 'uden valg beholdes brugerens version, her den slettede fil');
  // Ændrer filen sig mellem gennemgang og udførelse, ændres intet.
  await fs.writeFile(path.join(root, 'public/index.html'), after);
  const stale = await restore.review(root, { task: { files: [{ file: 'public/index.html', before, after }] } });
  await fs.writeFile(path.join(root, 'public/index.html'), 'ændret imens\n');
  await assert.rejects(restore.apply(root, stale.token), /ændret sig/);
  await assert.rejects(restore.review(root, { task: { files: [{ file: '../uden-for.txt', before: 'a', after: 'b' }] } }), /beskyttet eller ugyldig/);
});

test('en versions filer og indhold vises kun, når det er sikkert', async t => {
  const r = await repository(t), history = new History({ ...r.store, project: async () => ({}), saveProject: async () => ({}) });
  await r.write('public/index.html', lines('<h1>A</h1>')); const first = await r.save('Projekt oprettet');
  await r.write('public/index.html', lines('<h1>B</h1>', '<p>Ny</p>')); await r.write('public/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
  const second = await r.save('AI-opgave: Ret overskriften');
  const version = await history.version(r.root, second);
  assert.equal(version.parent, first); assert.equal(version.kind, 'ai'); assert.equal(version.name, 'Ret overskriften');
  assert.deepEqual(version.files.map(f => [f.file, f.change, f.added, f.removed, f.hidden]), [['public/index.html', 'ændret', 2, 1, false], ['public/logo.png', 'ny', 0, 0, true]]);
  assert.deepEqual(await history.file(r.root, second, 'public/index.html'), { before: lines('<h1>A</h1>'), after: lines('<h1>B</h1>', '<p>Ny</p>'), hidden: false });
  assert.equal((await history.file(r.root, second, 'public/logo.png')).hidden, true);
  assert.equal((await history.version(r.root, first)).parent, null);
  await assert.rejects(history.file(r.root, second, '../x'), /Vælg en fil/);
});

test('billederne gemmes i par i appens data, bindes til en version og ryddes efter 80', async t => {
  // Optagelserne er fra forskellige tidspunkter. Filsystemets hastighed må ikke afgøre, om den manuelle versions før-billede er ældre.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-13T12:00:00Z') });
  const directory = await temp(t), root = path.join(directory, 'projekt');
  const store = { root: path.join(directory, 'data'), projectKey: () => 'nogle' }, images = new PreviewImages(store);
  const view = { page: '', width: 800, height: 600 }, jpeg = Buffer.from('ffd8ffe0', 'hex');
  const before = await images.add(root, jpeg, { role: 'before', pair: 'p1', view, task: 't1' });
  t.mock.timers.tick(1000);
  const after = await images.add(root, jpeg, { role: 'after', pair: 'p1', view, task: 't1' });
  assert.equal(await images.add(root, Buffer.alloc(0), { role: 'after', view }), null);
  await images.bind(root, 'p1', 'c'.repeat(40));
  let pair = await images.pairFor(root, { commit: 'c'.repeat(40) });
  assert.deepEqual([pair.before.id, pair.after.id, pair.view], [before.id, after.id, view]);
  assert.deepEqual((await images.pairFor(root, { task: 't1' })).after.id, after.id);
  // En version, du selv gemmer, får det seneste billede af samme visning som før-billede.
  t.mock.timers.tick(1000);
  const manual = await images.add(root, jpeg, { role: 'after', view, commit: 'd'.repeat(40) });
  pair = await images.pairFor(root, { commit: 'd'.repeat(40) });
  assert.equal(pair.after.id, manual.id); assert.equal(pair.before.id, after.id);
  assert.equal(await images.pairFor(root, { commit: 'e'.repeat(40) }), null);
  assert.match(await images.read(root, after.id), /^data:image\/jpeg;base64,/);
  await assert.rejects(images.read(root, '../../x'), /findes ikke/);
  for (let i = 0; i < 80; i++) await images.add(root, jpeg, { role: 'after', view: { ...view, width: 900 } });
  const { images: kept } = await images.index(root);
  assert.equal(kept.length, 80); assert.ok(!kept.some(entry => entry.id === before.id));
  await assert.rejects(fs.access(path.join(images.folder(root), `${before.id}.jpg`)), 'den ældste fil er slettet');
});
