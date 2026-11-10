// Fund N:C2-3 (beta 3), Fortryd-delen: Auras øjebliksbilleder (core/changes.cjs) læste alle filer som UTF-8. En fil i et ældre
// tekstformat (fx Windows-1252) blev husket med erstatningstegn i stedet for æ, ø og å, og Fortryd af en AI-opgave skrev den sådan
// tilbage. Nu huskes en sådan fil ikke som tekst, kun ved sit indholds hash: opgaven kan ikke sætte den tilbage, og Versioner gemmer den
// byte for byte. Ændringen står under Ændringer uden linje-diff (spor P, tests/p-aendringer-tekstformat.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { capture, changes } = require('../core/changes.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

const latin1 = Buffer.concat([Buffer.from('<!doctype html><meta charset="windows-1252">\n<p>K'), Buffer.from([0xf8]), Buffer.from('benhavn</p>\n')]);

test('en AI-opgave, der ændrer en fil i et ældre tekstformat, kan ikke fortrydes til en fil uden æ, ø og å', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-fortryd-'))), root = path.join(directory, 'projekt');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/index.html'), latin1); await fs.writeFile(path.join(root, 'public/om.html'), '<p>Ærø</p>\n');
  const before = await capture(root);
  assert.equal(before.files.has('public/index.html'), false, 'filen huskes ikke som tekst med erstatningstegn');
  assert.ok(before.skippedFiles.has('public/index.html'), 'ikke som tekst');
  assert.equal(before.files.get('public/om.html'), '<p>Ærø</p>\n', 'gyldig UTF-8 huskes som før');
  // AI'en konverterer filen til UTF-8 og retter en anden side.
  const converted = '<!doctype html><meta charset="utf-8">\n<p>København</p>\n';
  await fs.writeFile(path.join(root, 'public/index.html'), converted); await fs.writeFile(path.join(root, 'public/om.html'), '<p>Ærø og Fanø</p>\n');
  const diff = await changes(root, before);
  assert.deepEqual(diff.files.map(item => item.file), ['public/om.html', 'public/index.html']);
  assert.equal(diff.files[1].opaque, true, 'den konverterede fil står uden tekst før og efter');
  // Fortryd, som chat-session.cjs bygger opgaven ud fra øjebliksbillederne.
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  await bench.activate({ root, name: 'Haver', purpose: 'Haver' });
  t.after(() => bench.close());
  bench.session().tasks.push({ id: 'opgave-1', root, label: 'Konvertér siden', mode: 'free', status: 'idle', startedAt: 1, endedAt: 2, files: diff.files, aiFiles: new Set(diff.files.map(item => item.file)), aiHashes: new Map(), commands: 0 });
  const undo = await bench.undoTask({ task: 'opgave-1' });
  assert.deepEqual(undo.files, ['public/om.html']);
  assert.deepEqual(undo.kept, ['public/index.html']);
  assert.equal(await fs.readFile(path.join(root, 'public/om.html'), 'utf8'), '<p>Ærø</p>\n');
  const after = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.equal(after, converted, 'den konverterede fil er ikke skrevet tilbage med erstatningstegn');
  assert.ok(!after.includes('�'));
});
