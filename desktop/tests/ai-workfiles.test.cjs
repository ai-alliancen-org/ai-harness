// AI-arbejdsfiler ligger i projektmappen under .aura/tmp/<opgave>, og AI'ens midlertidige mappe er den samme
// mappe, ikke systemets temp-mappe. Skrivning uden for projektet nægtes i Byg uden et godkendelseskort.
// Systemprompten må ikke nævne en absolut appdata-sti.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const chat = require('../core/chat-session.cjs');
const { isolatedEnv } = require('../core/engine.cjs');

test('AI-arbejdsfilerne ligger i projektets .aura/tmp under opgavens id', () => {
  assert.equal(typeof chat.scratchRootFor, 'function', 'scratchRootFor skal være eksporteret');
  assert.equal(chat.scratchRootFor('/projekt', 'op-1'), path.join('/projekt', '.aura', 'tmp', 'op-1'));
});

test('systemprompten peger på den relative mappe og ikke på en absolut sti', () => {
  assert.equal(typeof chat.scratchInstruction, 'function', 'scratchInstruction skal være eksporteret');
  const tekst = chat.scratchInstruction();
  assert.match(tekst, /\.aura\/tmp/);
  assert.equal(chat.scratchInstruction(), chat.scratchInstruction('op-2'), 'teksten er den samme for hver opgave, så cachen ikke brydes');
  assert.doesNotMatch(tekst, new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'ingen systemtemp-sti');
  assert.doesNotMatch(tekst, /appdata|\/Users\//i, 'ingen appdata- eller brugersti');
});

test('motorprocessen har sin egen temp-mappe i appdata, ikke i projektet', () => {
  const env = isolatedEnv('/appdata/runtime', {}, 'kode', { commandIsolation: false });
  assert.equal(env.TMPDIR, path.join('/appdata/runtime', 'tmp'));
  assert.equal(env.TEMP, env.TMPDIR); assert.equal(env.TMP, env.TMPDIR);
});

test('opgavestart: .aura/tmp får en .gitignore, der ignorerer alt, og links afvises', async t => {
  const rod = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-scratch-'));
  t.after(() => fs.rm(rod, { recursive: true, force: true }));
  const projekt = path.join(rod, 'projekt'); await fs.mkdir(projekt);
  await chat.prepareScratch(projekt, chat.scratchRootFor(projekt, 'op-1'));
  assert.equal(await fs.readFile(path.join(projekt, '.aura', 'tmp', '.gitignore'), 'utf8'), '*\n');
  assert.ok((await fs.stat(chat.scratchRootFor(projekt, 'op-1'))).isDirectory());
  const ekstern = path.join(rod, 'ekstern'); await fs.mkdir(ekstern);
  const andet = path.join(rod, 'andet'); await fs.mkdir(path.join(andet, '.aura'), { recursive: true });
  await fs.symlink(ekstern, path.join(andet, '.aura', 'tmp'));
  await assert.rejects(chat.prepareScratch(andet, chat.scratchRootFor(andet, 'op-1')), /almindelig mappe/);
  const tredje = path.join(rod, 'tredje'); await fs.mkdir(tredje); await fs.symlink(ekstern, path.join(tredje, '.aura'));
  await assert.rejects(chat.prepareScratch(tredje, chat.scratchRootFor(tredje, 'op-1')), /almindelig mappe/);
});

test('kortet siger skrive, når AI\'en skriver i en mappe uden for projektet, og se, når den læser', () => {
  const view = require('../ui/approval-view.js');
  assert.equal(view.directoryTitle({ permission: 'external_directory', toolInput: { tool: 'write' } })[0], 'Må AI’en skrive i en mappe uden for projektet?');
  assert.equal(view.directoryTitle({ permission: 'external_directory', toolInput: { tool: 'edit' } })[0], 'Må AI’en skrive i en mappe uden for projektet?');
  assert.equal(view.directoryTitle({ permission: 'external_directory', toolInput: { tool: 'read' } })[0], 'Må AI’en se en mappe uden for projektet?');
  assert.equal(view.directoryTitle({ permission: 'external_directory' })[0], 'Må AI’en se en mappe uden for projektet?');
});
