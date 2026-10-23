const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../core/store.cjs');
const { Copies } = require('../core/copies.cjs');
const { Restoration } = require('../core/restoration.cjs');
const { GitVersions } = require('../core/git.cjs');
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kopier-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'projekt'); await fs.mkdir(root);
  const store = new Store(path.join(dir, 'data'), {}), copies = new Copies(store), restoration = new Restoration(new GitVersions(), store);
  return { dir, root, copies, restoration };
}
test('kopien medtager ugemte filer, udelader metadata og nøgler, og skriver aldrig gennem links', async t => {
  const { dir, root, copies } = await fixture(t);
  await fs.writeFile(path.join(root, 'a.txt'), 'ugemt'); await fs.writeFile(path.join(root, '.env'), 'password');
  await fs.mkdir(path.join(root, '.git')); await fs.writeFile(path.join(root, '.git/config'), 'metadata');
  await fs.writeFile(path.join(dir, 'udenfor.txt'), 'bevar'); await fs.symlink(path.join(dir, 'udenfor.txt'), path.join(root, 'link.txt'));
  const copy = await copies.create(root, 'samtale');
  assert.equal(await fs.readFile(path.join(copy.root, 'a.txt'), 'utf8'), 'ugemt');
  for (const file of ['.env', '.git', 'link.txt']) await assert.rejects(fs.access(path.join(copy.root, file)));
  await fs.writeFile(path.join(copy.root, 'a.txt'), 'rettet'); assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'ugemt');
  assert.deepEqual((await copies.diff(copy)).files.map(f => f.file), ['a.txt']);
  assert.equal((await copies.load(copy.id, root)).root, copy.root);
  await assert.rejects(copies.load(copy.id, dir), /kan ikke læses/);
});
test('indfletning bevarer projektets andre linjer, viser konflikter, og kan fortrydes uden Git', async t => {
  const { root, copies, restoration } = await fixture(t);
  await fs.writeFile(path.join(root, 'a.txt'), 'første\nmidte\nsidste\n');
  const copy = await copies.create(root, 'samtale');
  await fs.writeFile(path.join(copy.root, 'a.txt'), 'første\nmidte\nAI\n'); await fs.writeFile(path.join(root, 'a.txt'), 'bruger\nmidte\nsidste\n');
  let diff = await copies.diff(copy), review = await restoration.review(root, { merge: diff });
  assert.equal(review.kind, 'merge'); assert.equal(review.conflicts, 0); assert.match(review.files[0].after, /bruger\nmidte\nAI/);
  await restoration.apply(root, review.token); assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'bruger\nmidte\nAI\n');
  await fs.writeFile(path.join(root, 'a.txt'), 'bruger\nsenere\nAI\n');
  const undo = await restoration.review(root, { undo: true }); assert.equal(undo.undoMerge, true); await restoration.apply(root, undo.token);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'bruger\nsenere\nsidste\n');
  await fs.writeFile(path.join(copy.root, 'a.txt'), 'AI\nmidte\nsidste\n'); diff = await copies.diff(copy); review = await restoration.review(root, { merge: diff });
  assert.equal(review.conflicts, 1); await restoration.apply(root, review.token);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'bruger\nsenere\nsidste\n', 'uden et valg beholdes brugerens linjer');
});
test('ny, slettet og binær fil gennemgås; ændringer efter gennemgang og beskyttede inputs afvises', async t => {
  const { root, copies, restoration } = await fixture(t);
  await fs.writeFile(path.join(root, 'slet.txt'), 'gammel'); const copy = await copies.create(root, 'samtale');
  await fs.unlink(path.join(copy.root, 'slet.txt')); await fs.writeFile(path.join(copy.root, 'ny.txt'), 'ny'); await fs.writeFile(path.join(copy.root, 'ikon.png'), Buffer.from([0, 1, 2]));
  const diff = await copies.diff(copy), review = await restoration.review(root, { merge: diff });
  assert.equal(review.files.length, 3); await fs.writeFile(path.join(root, 'ny.txt'), 'bruger');
  await assert.rejects(restoration.apply(root, review.token), /Filerne har ændret/);
  for (const file of ['../udenfor.txt', '.env', '.git/config', 'references/privat.txt']) await assert.rejects(restoration.review(root, { merge: { files: [{ file, base: null, theirs: 'AI' }] } }), /beskyttet/);
  await fs.symlink(root, path.join(copy.root, 'link')); const blocked = await copies.diff(copy); assert.ok(blocked.unsupported.includes('link'));
});
test('Fortryd indfletning viser en senere konflikt og afviser et ændret journalgrundlag', async t => {
  const { root, copies, restoration } = await fixture(t);
  await fs.writeFile(path.join(root, 'a.txt'), 'Før\nMidte\n'); const copy = await copies.create(root, 'samtale');
  await fs.writeFile(path.join(copy.root, 'a.txt'), 'AI\nMidte\n');
  const merge = await restoration.review(root, { merge: await copies.diff(copy) }); await restoration.apply(root, merge.token);
  await fs.writeFile(path.join(root, 'a.txt'), 'Bruger\nMidte\n');
  const undo = await restoration.review(root, { undo: true }); assert.equal(undo.conflicts, 1);
  await restoration.apply(root, undo.token); assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'Bruger\nMidte\n');
  const journal = await restoration.previous(root);
  await fs.writeFile(path.join(path.dirname(restoration.journal(root)), journal.id, journal.files[0].afterCopy), 'Ændret grundlag');
  await assert.rejects(restoration.review(root, { undo: true }), /grundlag blev ændret/);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'Bruger\nMidte\n');
});
test('oprydning bevarer uflettet materiale, men fjerner afsluttede kopier og afbrudte oprettelser', async t => {
  const { root, copies } = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'base');
  const keep = await copies.create(root, 'a'), done = await copies.create(root, 'b'); await copies.write({ ...done, merged: true });
  const half = 'abcdef12-1234-1234-1234-abcdef123456'; await fs.mkdir(path.join(copies.folder(half), 'project'), { recursive: true });
  await fs.writeFile(path.join(copies.folder(half), 'creating.json'), JSON.stringify({ version: 1, id: half }));
  await copies.cleanup(); assert.ok(await copies.load(keep.id, root)); assert.equal(await copies.load(done.id, root), null); await assert.rejects(fs.access(copies.folder(half)));
});
test('et forsvundet manifest sletter ikke en uflettet kopi eller erstatter den lydløst med projektet', async t => {
  const { root, copies } = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'før');
  const copy = await copies.create(root, 'a'); await fs.writeFile(path.join(copy.root, 'a.txt'), 'uflettet rettelse');
  await fs.rm(path.join(copies.folder(copy.id), 'copy.json'));
  await copies.cleanup(); assert.equal(await fs.readFile(path.join(copy.root, 'a.txt'), 'utf8'), 'uflettet rettelse');
  await assert.rejects(copies.load(copy.id, root), /kan ikke læses.*bevaret/);
});
test('arbejdsbænken afviser en ændret kopi og gemmer en gennemgået indfletning som version', async t => {
  const { dir, root } = await fixture(t);
  const { Workbench } = require('../core/workbench.cjs');
  const bench = new Workbench({ directory: path.join(dir, 'bench'), safeStorage: {}, profiles: path.join(__dirname, '../../profiles'), emit: () => {} });
  t.after(() => bench.close()); bench.restoration = new Restoration(bench.git, bench.store);
  await fs.writeFile(path.join(root, 'a.txt'), 'øverst\nmidte\nnederst\n');
  await bench.git.startProject(root); await bench.store.saveProject(root, { autoCheckpoint: true });
  await bench.activate({ root, name: 'Prøve' }); const original = bench.chat;
  await original.saveDraft({ text: 'Originalen', mode: 'free' }); await bench.newChat(); const chat = bench.chat;
  const copy = await bench.copies.create(root, chat.id); chat.copy = copy; chat.root = copy.root;
  chat.data = await bench.history.updateChat(root, chat.id, data => { data.copy = { id: copy.id }; });
  await fs.writeFile(path.join(copy.root, 'a.txt'), 'øverst\nmidte\nAI\n'); await fs.writeFile(path.join(root, 'a.txt'), 'bruger\nmidte\nnederst\n');
  original.running = true; bench.claim(original); await assert.rejects(bench.mergeReview({ chat: chat.id }), /Vent på opgaven/); original.running = false; bench.release(original);
  original.sending = true; await assert.rejects(bench.mergeReview({ chat: chat.id }), /Vent på opgaven/); original.sending = false;
  const stale = await bench.mergeReview({ chat: chat.id }); await fs.writeFile(path.join(copy.root, 'a.txt'), 'øverst\nmidte\nAI igen\n');
  await assert.rejects(bench.mergeApply({ chat: chat.id, token: stale.token }), /Kopien har ændret/);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'bruger\nmidte\nnederst\n');
  await fs.writeFile(path.join(copy.root, 'ikon.png'), Buffer.from([0, 1, 2]));
  const review = await bench.mergeReview({ chat: chat.id }), result = await bench.mergeApply({ chat: chat.id, token: review.token });
  assert.ok(result.savedFirst); assert.ok(result.saved); assert.equal(result.error, null);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'bruger\nmidte\nAI igen\n');
  assert.equal(chat.copy, null); assert.equal(chat.root, root); await assert.rejects(fs.access(copy.root));
  const status = await bench.git.status(root); assert.match(status.history[0].message, /^Flettet ind:/); assert.equal(status.changes, 0);
  assert.equal((await bench.history.readChat(root, chat.id)).copy, null);
  const overview = await chat.changeOverview(); assert.equal(overview.session.files[0].by, 'dig');
  const binary = overview.tasks[0].files.find(file => file.file === 'ikon.png'); assert.equal(binary.binary, true); assert.equal(binary.change, 'ny');
  assert.equal(overview.tasks[0].changedSince, 0, 'en uændret binær fil tæller ikke som ændret igen');
  await fs.writeFile(path.join(root, 'ikon.png'), Buffer.from([0, 9, 2]));
  assert.equal((await chat.changeOverview()).tasks[0].changedSince, 1);
  await fs.writeFile(path.join(root, 'ikon.png'), Buffer.from([0, 1, 2]));
  assert.deepEqual(chat.changeFile({ source: overview.tasks[0].id, file: 'ikon.png' }).hunks, []);
  await bench.features.save(root, { scope: 'projekt', values: { versioner: false } });
  const again = await bench.copies.create(root, chat.id); chat.copy = again; chat.root = again.root;
  chat.data = await bench.history.updateChat(root, chat.id, data => { data.copy = { id: again.id }; });
  await fs.writeFile(path.join(again.root, 'a.txt'), 'bruger\nmidte\nSidste kopi\n');
  const withoutVersions = await bench.mergeReview({ chat: chat.id }); assert.equal(withoutVersions.saveAfter, false);
  const merged = await bench.mergeApply({ chat: chat.id, token: withoutVersions.token }); assert.equal(merged.saved, null);
  assert.equal((await bench.git.status(root)).history[0].commit, status.history[0].commit, 'fravalget forhindrer en automatisk version');
  const undo = await bench.restoration.review(root, { undo: true }); await bench.restoration.apply(root, undo.token);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'bruger\nmidte\nAI igen\n');
});

test('pakkelinks i kopien peger på kopiens filer; links ud af projektet følger ikke med', async t => {
  const { dir, root, copies } = await fixture(t);
  await fs.mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules/pakke/dist'), { recursive: true }); await fs.writeFile(path.join(root, 'node_modules/pakke/dist/start.js'), 'original');
  await fs.writeFile(path.join(dir, 'privat.js'), 'privat');
  await fs.symlink('../pakke/dist/start.js', path.join(root, 'node_modules/.bin/start'));
  await fs.symlink(path.join(dir, 'privat.js'), path.join(root, 'node_modules/udenfor'));
  const copy = await copies.create(root, 'a');
  if (process.platform === 'darwin') {
    assert.equal(await fs.realpath(path.join(copy.root, 'node_modules/.bin/start')), path.join(copy.root, 'node_modules/pakke/dist/start.js'));
    await fs.writeFile(path.join(copy.root, 'node_modules/.bin/start'), 'kopi');
    assert.equal(await fs.readFile(path.join(root, 'node_modules/pakke/dist/start.js'), 'utf8'), 'original');
    await assert.rejects(fs.access(path.join(copy.root, 'node_modules/udenfor')));
  } else await assert.rejects(fs.access(path.join(copy.root, 'node_modules')));
});

test('fejl i registrering og papirkurv mister ikke en samtales uflettede materiale', async t => {
  const { dir, root } = await fixture(t); const { Workbench } = require('../core/workbench.cjs');
  const bench = new Workbench({ directory: path.join(dir, 'bench'), safeStorage: {}, profiles: path.join(__dirname, '../../profiles'), emit: () => {} });
  t.after(() => bench.close()); await fs.writeFile(path.join(root, 'a.txt'), 'original');
  await bench.activate({ root, name: 'Prøve' }); const first = bench.chat; await first.saveDraft({ text: 'Første', mode: 'free' });
  await bench.newChat(); const second = bench.chat; second.prepared = { root }; first.running = true; bench.claim(first);
  const update = bench.history.updateChat.bind(bench.history); bench.history.updateChat = async () => { throw new Error('fuld disk'); };
  await assert.rejects(bench.allocate(second), /fuld disk/); assert.equal(second.root, root); assert.equal(second.copy, null);
  assert.deepEqual(await fs.readdir(bench.copies.directory), []);
  bench.history.updateChat = update; await bench.allocate(second); const copy = second.copy;
  await fs.writeFile(path.join(copy.root, 'a.txt'), 'uflettet');
  await assert.rejects(bench.deleteChat({ id: second.id }, async () => { throw new Error('papirkurven afviser'); }), /papirkurven/);
  assert.equal(bench.chat, second); assert.equal((await bench.history.readChat(root, second.id)).copy.id, copy.id);
  assert.equal(await fs.readFile(path.join(copy.root, 'a.txt'), 'utf8'), 'uflettet'); first.running = false; bench.release(first);
});

test('oprydning bevarer senere ændringer og filer i en efterladt flettet kopi', async t => {
  const { root, copies } = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'base');
  const changed = await copies.create(root, 'changed'), added = await copies.create(root, 'added'), dependency = await copies.create(root, 'dependency'), removed = await copies.create(root, 'removed'), outer = await copies.create(root, 'outer');
  await fs.mkdir(path.join(dependency.root, 'node_modules/pakke'), { recursive: true });
  await fs.writeFile(path.join(dependency.root, 'node_modules/pakke/note.txt'), 'base');
  for (const copy of [changed, added, dependency, removed, outer]) await copies.write({ ...copy, merged: true });
  const old = await fs.stat(path.join(changed.root, 'a.txt'));
  await fs.writeFile(path.join(changed.root, 'a.txt'), 'edit');
  await fs.utimes(path.join(changed.root, 'a.txt'), old.atime, old.mtime);
  await fs.writeFile(path.join(added.root, 'senere.txt'), 'brugerens nye fil');
  await fs.writeFile(path.join(dependency.root, 'node_modules/pakke/note.txt'), 'edit');
  await fs.unlink(path.join(removed.root, 'a.txt'));
  await fs.writeFile(path.join(copies.folder(outer.id), 'bevar-mig.txt'), 'brugerens fil ved siden af project');
  await new Copies(copies.store).cleanup();
  for (const copy of [changed, added, dependency, removed, outer]) assert.ok(await copies.load(copy.id, root));
  assert.equal(await fs.readFile(path.join(changed.root, 'a.txt'), 'utf8'), 'edit');
  assert.equal(await fs.readFile(path.join(added.root, 'senere.txt'), 'utf8'), 'brugerens nye fil');
  assert.equal(await fs.readFile(path.join(dependency.root, 'node_modules/pakke/note.txt'), 'utf8'), 'edit');
  assert.equal(await fs.readFile(path.join(copies.folder(outer.id), 'bevar-mig.txt'), 'utf8'), 'brugerens fil ved siden af project');
});
test('oprydning kræver et aktuelt sammenligningsgrundlag og følger ikke en erstattet kopirod', async t => {
  const { dir, root, copies } = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'bevar');
  const legacy = await copies.create(root, 'legacy'), unknown = await copies.create(root, 'unknown');
  const manifest = path.join(copies.folder(legacy.id), 'copy.json');
  const data = JSON.parse(await fs.readFile(manifest, 'utf8')); data.merged = true;
  await fs.writeFile(manifest, JSON.stringify(data)); // Older merged records have no cleanupProof.
  await copies.write({ ...unknown, merged: true });
  const elsewhere = path.join(dir, 'bevarede-filer'); await fs.rename(unknown.root, elsewhere); await fs.symlink(elsewhere, unknown.root);
  await copies.cleanup();
  assert.ok(await copies.load(legacy.id, root));
  assert.equal(await fs.readFile(path.join(legacy.root, 'a.txt'), 'utf8'), 'bevar');
  assert.equal((await fs.lstat(unknown.root)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(path.join(elsewhere, 'a.txt'), 'utf8'), 'bevar');
});

test('oprydning bevarer omdøbninger, tomme mapper, ændrede rettigheder og ødelagt proof', async t => {
  const { root, copies } = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'base');
  for (const change of ['rename','directory','mode','proof']) {
    const copy = await copies.create(root, change); await copies.write({ ...copy, merged: true });
    if (change === 'rename') await fs.rename(path.join(copy.root, 'a.txt'), path.join(copy.root, 'b.txt'));
    if (change === 'directory') await fs.mkdir(path.join(copy.root, 'nye-noter'));
    if (change === 'mode') await fs.chmod(path.join(copy.root, 'a.txt'), 0o755);
    if (change === 'proof') {
      const file = path.join(copies.folder(copy.id), 'copy.json'), data = JSON.parse(await fs.readFile(file));
      data.cleanupProof.digest = '0'.repeat(64); await fs.writeFile(file, JSON.stringify(data));
    }
    await copies.cleanup(); assert.ok(await copies.load(copy.id, root), `${change} kræver bevarelse`);
  }
});
