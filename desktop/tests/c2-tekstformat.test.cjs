// Fund N:C2-6 og N:C2-3 (beta 3), Ret i siden for en fil, der ikke er gemt som UTF-8 (fx Windows-1252).
// N:C2-6: kortets begrundelse står i første lag og må ikke bruge fagordet UTF-8 (desktop/DESIGN.md, Rolige skærme).
// N:C2-3: henvisningen til AI'en skal også nævne filens tegnsætsangivelse, fx <meta charset="windows-1252">. Konverterer AI'en
// filen uden at rette den, vises æ, ø og å forkert hos værter, der ikke selv angiver tegnsættet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const edit = require('../core/preview-edit.cjs');

const latin1 = Buffer.concat([Buffer.from('<!doctype html><meta charset="windows-1252">\n<h1>Velkommen</h1>\n<p>K'), Buffer.from([0xf8]), Buffer.from('benhavn</p>\n')]);
async function project(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-tekstformat-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public')); await fs.writeFile(path.join(root, 'public/index.html'), latin1);
  return root;
}
async function choose(root) {
  const selection = { ...edit.sanitizeSelection({ tag: 'h1', text: 'Velkommen', raw: 'Velkommen', leaf: true }), pageFile: 'public/index.html' };
  const choice = edit.chooseSource((await edit.findText(root, 'Velkommen', { tag: 'h1', pageFile: 'public/index.html' })).matches, { pageFile: 'public/index.html' });
  selection.source = { file: choice.match.file, line: choice.match.line };
  selection.edit = edit.editability(selection, choice);
  return selection;
}

test('kortet forklarer det i almindeligt dansk uden fagordet UTF-8', async t => {
  const selection = await choose(await project(t));
  assert.equal(selection.edit.possible, false);
  assert.equal(selection.edit.code, 'encoding');
  assert.doesNotMatch(selection.edit.reason, /UTF-?8/i, 'fagord står bag detaljer, ikke i første lag');
  assert.match(selection.edit.reason, /ældre tekstformat/);
  assert.match(selection.edit.reason, /æ, ø og å/); assert.match(selection.edit.reason, /Bed AI’en/);
});

test('afvisningen ved Ret teksten bruger samme almindelige ord', async t => {
  const root = await project(t), selection = await choose(root);
  await assert.rejects(edit.applyTextEdit(root, { ...selection, edit: { possible: true } }, 'Hej'), error => error.code === 'encoding' && !/UTF-?8/i.test(error.message) && /ældre tekstformat/.test(error.message));
});

test('henvisningen til AI’en nævner tegnsætsangivelsen i filen, så siden også vises rigtigt efter en konvertering', async t => {
  const reference = edit.referenceText(await choose(await project(t)));
  assert.match(reference, /ikke gemt som UTF-8/, 'AI’en får det tekniske navn');
  assert.match(reference, /<meta charset="windows-1252">/, 'eksemplet viser, hvad der skal rettes');
  assert.match(reference, /tegnsætsangivelse/);
  assert.match(reference, /utf-8/, 'angivelsen skal pege på det nye tegnsæt');
});
