// Fund N:C2-2 (beta 3): i en Vue-skabelon kan en streng stå inde i en attribut, fx :tekst="'Mødelokale A'". Strengens citationstegn
// er ', men attributtens afgrænser er ". Reglen «det andet citationstegn er tilladt» lod Aura skrive :tekst="'Mødelokale "Store sal"'",
// og skabelonen gik i stykker. Aura kan ikke se, om en streng i en skabelon (Vue, Svelte, Astro) står i en attribut, så her overlades
// begge lige citationstegn til AI'en. Typografiske anførselstegn og apostroffer kan stadig rettes direkte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const edit = require('../core/preview-edit.cjs');
const { Workbench } = require('../core/workbench.cjs');
const profiles = path.join(__dirname, '../../profiles');

test('en streng i en Vue-, Svelte- eller Astro-skabelon: begge lige citationstegn overlades til AI’en', () => {
  for (const file of ['src/App.vue', 'src/lib/Kort.svelte', 'src/pages/index.astro'])
    for (const [text, quote] of [['Mødelokale "Store sal"', "'"], ["Mødelokale 'Store sal'", '"'], ['Hej "du"', '`'], ["Jens' team", '`']])
      assert.throws(() => edit.replacementFor(file, text, 'string', quote), /kræver en ændring i koden/, `${file}: ${text} i en streng med ${quote}`);
  assert.equal(edit.replacementFor('src/App.vue', 'Mødelokale “Store sal”', 'string', "'"), 'Mødelokale “Store sal”', 'typografiske anførselstegn afslutter hverken strengen eller attributten');
  assert.equal(edit.replacementFor('src/App.vue', 'Jens’ team', 'string', '"'), 'Jens’ team');
});

test('modværn: i JavaScript og TypeScript er det andet citationstegn stadig tilladt', () => {
  assert.equal(edit.replacementFor('src/App.tsx', 'Hej "du"', 'string', "'"), 'Hej "du"');
  assert.equal(edit.replacementFor('src/data.js', "Jens' team", 'string', '"'), "Jens' team");
});

test('hele kæden: Ret i siden ødelægger ikke en Vue-skabelon med en streng i en attribut', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-c2-vue-'))), root = path.join(directory, 'projekt');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = '<template>\n  <Overskrift :tekst="\'Mødelokale A\'" />\n</template>\n';
  await fs.mkdir(path.join(root, 'src'), { recursive: true }); await fs.writeFile(path.join(root, 'src/App.vue'), source);
  const bench = new Workbench({ directory: path.join(directory, 'data'), profiles, emit: () => {}, safeStorage: {} });
  await bench.activate({ root, name: 'Lokaler', purpose: 'Lokaler' });
  t.after(() => bench.close());
  const selection = { ...edit.sanitizeSelection({ tag: 'h2', text: 'Mødelokale A', raw: 'Mødelokale A', leaf: true, html: '<h2>Mødelokale A</h2>', selector: 'h2' }), id: 'valg-vue', page: '/', pageFile: '' };
  const choice = edit.chooseSource((await edit.findText(root, 'Mødelokale A', { tag: 'h2' })).matches, {});
  assert.equal(choice.match?.fit, 'string'); assert.equal(choice.match?.quote, "'");
  selection.source = { file: choice.match.file, line: choice.match.line };
  selection.edit = edit.editability(selection, choice);
  const valg = bench.rememberSelection(selection);
  await assert.rejects(bench.textEdit({ id: valg.id, text: 'Mødelokale "Store sal"' }), /kræver en ændring i koden/);
  assert.equal(await fs.readFile(path.join(root, 'src/App.vue'), 'utf8'), source, 'skabelonen er uændret');
  await bench.textEdit({ id: valg.id, text: 'Mødelokale “Store sal”' });
  assert.equal(await fs.readFile(path.join(root, 'src/App.vue'), 'utf8'), source.replace('Mødelokale A', 'Mødelokale “Store sal”'));
});
