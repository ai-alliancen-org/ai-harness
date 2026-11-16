// Brugerens valg 16. november 2026: en ødelagt gendannelsesjournal (kopien før sidste gendannelse) lægges til side under et nyt
// navn og bevares. Den første, der læser den, får besked; derefter er der ingen journal, og nye gendannelser virker igen. Kan filen
// slet ikke læses, afvises gendannelser som før, og intet flyttes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../core/store.cjs');
const { Restoration } = require('../core/restoration.cjs');

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-journal-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'projekt'); await fs.mkdir(root);
  const restoration = new Restoration(null, new Store(path.join(base, 'data'), {}));
  const journal = restoration.journal(root); await fs.mkdir(path.dirname(journal), { recursive: true });
  return { root, restoration, journal };
}
const asideFiles = async journal => (await fs.readdir(path.dirname(journal))).filter(name => name.startsWith('damaged-'));

test('en ødelagt journal lægges til side, bevares, meldes én gang, og bagefter er der ingen journal', async t => {
  for (const damaged of ['{', JSON.stringify({ version: 2, root: '/andet', id: 'x', files: [] })]) {
    const { root, restoration, journal } = await fixture(t);
    await fs.writeFile(journal, damaged);
    const error = await restoration.previous(root).then(() => null, failure => failure);
    assert.ok(error, 'den første læsning siger det');
    assert.match(error.message, /kan ikke læses\. Den er lagt til side i appens lokale data, og nye gendannelser virker igen\./);
    assert.equal(await fs.readFile(error.setAside, 'utf8'), damaged, 'indholdet er bevaret uændret');
    assert.deepEqual(await asideFiles(journal), [path.basename(error.setAside)]);
    await assert.rejects(fs.access(journal), 'latest.json er væk');
    assert.equal(await restoration.previous(root), null, 'næste læsning finder ingen journal');
    assert.equal(await restoration.status(root), null);
  }
});

test('kan journalen slet ikke læses, afvises gendannelser som før, og intet flyttes', async t => {
  const { root, restoration, journal } = await fixture(t);
  await fs.mkdir(journal);
  await assert.rejects(restoration.previous(root), /kan ikke læses\. Den er bevaret i appens lokale data\./);
  assert.ok((await fs.stat(journal)).isDirectory(), 'intet er flyttet');
  assert.deepEqual(await asideFiles(journal), []);
});

test('to samtidige læsninger lægger journalen til side én gang og melder det én gang', async t => {
  const { root, restoration, journal } = await fixture(t);
  await fs.writeFile(journal, '{');
  const results = await Promise.allSettled([restoration.previous(root), restoration.previous(root)]);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1, 'kun én får besked');
  assert.deepEqual(results.filter(result => result.status === 'fulfilled').map(result => result.value), [null]);
  assert.equal((await asideFiles(journal)).length, 1, 'kun én kopi lagt til side');
});

test('en gyldig journal læses uændret og bliver liggende', async t => {
  const { root, restoration, journal } = await fixture(t);
  const valid = { version: 1, root, id: '0f8fad5b-d9cb-469f-a165-70867728950e', files: [], state: 'applied', at: '2026-11-16T09:00:00.000Z' };
  await fs.writeFile(journal, JSON.stringify(valid));
  assert.deepEqual(await restoration.previous(root), valid);
  assert.equal(await fs.readFile(journal, 'utf8'), JSON.stringify(valid));
  assert.deepEqual(await asideFiles(journal), []);
});
