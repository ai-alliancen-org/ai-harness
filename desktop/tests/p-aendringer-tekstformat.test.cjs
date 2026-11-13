// Spor P (beta 3), bivirkning af N:C2-3: en fil, der ikke er gyldig UTF-8 (fx Windows-1252), huskes kun ved navn i Auras
// øjebliksbilleder, så Fortryd ikke kan skrive den tilbage med erstatningstegn. Men ændrede AI'en filen, fx ved den konvertering
// til UTF-8, som Aura selv beder om, forsvandt ændringen tavst fra opgavens Ændringer, fra Hele samtalen og fra Fortryd.
// Nu står filen under Ændringer som ændret uden linje-diff, og begge veje til Fortryd lader den være og siger det.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { capture, changes } = require('../core/changes.cjs');
const { taskSummary, hash } = require('../core/change-review.cjs');
const { Workbench } = require('../core/workbench.cjs');
const { Restoration } = require('../core/restoration.cjs');
const profiles = path.join(__dirname, '../../profiles');

const latin1 = Buffer.concat([Buffer.from('<!doctype html><meta charset="windows-1252">\n<p>K'), Buffer.from([0xf8]), Buffer.from('benhavn</p>\n')]);
const converted = '<!doctype html><meta charset="utf-8">\n<p>København</p>\n';

async function project(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-p-tekstformat-'))), root = path.join(directory, 'projekt');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/index.html'), latin1); await fs.writeFile(path.join(root, 'public/om.html'), '<p>Ærø</p>\n');
  const before = await capture(root);
  // AI'en konverterer filen til UTF-8 og retter en anden side.
  await fs.writeFile(path.join(root, 'public/index.html'), converted); await fs.writeFile(path.join(root, 'public/om.html'), '<p>Ærø og Fanø</p>\n');
  return { directory, root, before };
}
async function bench(t, directory, root) {
  const value = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  await value.activate({ root, name: 'Haver', purpose: 'Haver' });
  t.after(() => value.close()); value.restoration = new Restoration(value.git, value.store);
  return value;
}
const aiTask = (root, files) => ({ id: 'opgave-1', root, label: 'Konvertér siden', mode: 'free', status: 'idle', startedAt: 1, endedAt: 2, files, skipped: 0, aiFiles: new Set(files.map(item => item.file)), aiHashes: new Map([['public/index.html', hash(converted)], ['public/om.html', hash('<p>Ærø og Fanø</p>\n')]]), commands: 0 });

test('en AI-opgave, der konverterer en fil i et ældre tekstformat, viser filen som ændret uden linje-diff', async t => {
  const { root, before } = await project(t);
  const diff = await changes(root, before);
  assert.deepEqual(diff.files.map(item => item.file).sort(), ['public/index.html', 'public/om.html']);
  const entry = diff.files.find(item => item.file === 'public/index.html');
  assert.equal(entry.binary, true); assert.equal(entry.opaque, true);
  assert.equal(entry.beforeExists, true); assert.equal(entry.afterExists, true);
  assert.equal(entry.before, undefined, 'den gamle tekst huskes ikke med erstatningstegn');
  const summary = taskSummary(aiTask(root, diff.files));
  const row = summary.files.find(item => item.file === 'public/index.html');
  assert.equal(row.change, 'ændret'); assert.equal(row.binary, true); assert.equal(row.opaque, true);
  assert.equal(row.by, 'ai', 'AI’ens filværktøj skrev præcis det indhold, der ligger nu');
  assert.equal(summary.totals.files, 2);
});

test('modværn: en uændret fil i et ældre tekstformat står ikke under Ændringer', async t => {
  const { root } = await project(t);
  await fs.writeFile(path.join(root, 'public/gammel.html'), latin1);
  const before = await capture(root);
  await fs.writeFile(path.join(root, 'public/om.html'), '<p>Ny</p>\n');
  assert.deepEqual((await changes(root, before)).files.map(item => item.file), ['public/om.html']);
});

test('Fortryd i Aura sætter de øvrige filer tilbage, lader filen være og siger det', async t => {
  const { directory, root, before } = await project(t);
  const diff = await changes(root, before), value = await bench(t, directory, root);
  value.session().tasks.push(aiTask(root, diff.files));
  const undo = await value.undoTask({ task: 'opgave-1' });
  assert.deepEqual(undo.files, ['public/om.html']);
  assert.deepEqual(undo.kept, ['public/index.html']);
  assert.equal(await fs.readFile(path.join(root, 'public/om.html'), 'utf8'), '<p>Ærø</p>\n');
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), converted, 'filen er ikke slettet eller skrevet med erstatningstegn');
});

test('Fortryd opgaven (gennemgangen før gendannelsen) foreslår ikke at slette filen, og gennemgangen nævner den', async t => {
  const { directory, root, before } = await project(t);
  const diff = await changes(root, before), value = await bench(t, directory, root);
  const review = await value.restoration.review(root, { task: { files: diff.files } });
  assert.deepEqual(review.files.map(item => item.file), ['public/om.html']);
  assert.deepEqual(review.kept, ['public/index.html']);
  const only = await value.restoration.review(root, { task: { files: diff.files.filter(item => item.file === 'public/index.html') } }).catch(error => error);
  assert.ok(only instanceof Error, 'en opgave, der kun ændrede sådan en fil, kan ikke fortrydes her');
  assert.match(only.message, /ældre tekstformat/);
  assert.match(only.message, /Versioner/);
});

test('Hele samtalen viser filen som ændret, og filens visning har ingen linje-diff', async t => {
  const { directory, root, before } = await project(t);
  const value = await bench(t, directory, root);
  const session = value.session(); session.baseline = before; session.startedAt = 0;
  const overview = await value.changeOverview();
  const row = overview.session.files.find(item => item.file === 'public/index.html');
  assert.ok(row, 'filen står under Hele samtalen');
  assert.equal(row.change, 'ændret'); assert.equal(row.opaque, true);
  const detail = await value.changeFile({ source: 'session', file: 'public/index.html' });
  assert.equal(detail.opaque, true); assert.deepEqual(detail.hunks, []);
});
