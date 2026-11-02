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
const { ApprovalsPolicy, refusesOutsideWrite } = require('../core/approvals-policy.cjs');

test('AI-arbejdsfilerne ligger i projektets .aura/tmp under opgavens id', () => {
  assert.equal(typeof chat.scratchRootFor, 'function', 'scratchRootFor skal være eksporteret');
  assert.equal(chat.scratchRootFor('/projekt', 'op-1'), path.join('/projekt', '.aura', 'tmp', 'op-1'));
});

test('systemprompten peger på den relative mappe og ikke på en absolut sti', () => {
  assert.equal(typeof chat.scratchInstruction, 'function', 'scratchInstruction skal være eksporteret');
  const tekst = chat.scratchInstruction('op-1');
  assert.match(tekst, /\.aura\/tmp\/op-1/);
  assert.doesNotMatch(tekst, new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'ingen systemtemp-sti');
  assert.doesNotMatch(tekst, /appdata|\/Users\//i, 'ingen appdata- eller brugersti');
});

test('motoren bruger AI-mappen som TEMP, TMP og TMPDIR, ikke systemets temp-mappe', () => {
  const mappe = path.join('/projekt', '.aura', 'tmp');
  const env = isolatedEnv('/appdata/runtime', {}, 'kode', { commandIsolation: false, tempRoot: mappe });
  assert.equal(env.TMPDIR, mappe);
  assert.equal(env.TEMP, mappe);
  assert.equal(env.TMP, mappe);
});

test('i Byg nægtes skrivning uden for projektet, og i Planlæg og Samtale gør den ikke det', async t => {
  const rod = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-skriv-'));
  t.after(() => fs.rm(rod, { recursive: true, force: true }));
  const projekt = path.join(rod, 'projekt'), udenfor = path.join(rod, 'ekstern');
  await fs.mkdir(projekt); await fs.mkdir(udenfor);
  const politik = new ApprovalsPolicy({ project: async () => ({ approvals: null }) });
  const p = { id: 'p1', permission: 'external_directory', patterns: [udenfor + '/*'], metadata: { filepath: path.join(udenfor, 'a.txt'), parentDir: udenfor }, toolInput: { tool: 'write' } };
  const i_byg = { projectRoot: projekt, workspaceRoot: projekt, mode: 'build' };
  const i_planlaeg = { ...i_byg, mode: 'plan' };
  const beskrivelse = await politik.describe(i_byg, p);
  assert.equal(refusesOutsideWrite(i_byg, p, beskrivelse), true, 'Byg skal afvise skrivning uden for projektet');
  assert.equal(refusesOutsideWrite(i_planlaeg, p, await politik.describe(i_planlaeg, p)), false, 'Planlæg er ikke omfattet af nægtelsen her');
});

test('kortet siger skrive, når AI\'en skriver i en mappe uden for projektet, og se, når den læser', () => {
  const view = require('../ui/approval-view.js');
  assert.equal(view.directoryTitle({ permission: 'external_directory', toolInput: { tool: 'write' } })[0], 'Må AI’en skrive i en mappe uden for projektet?');
  assert.equal(view.directoryTitle({ permission: 'external_directory', toolInput: { tool: 'edit' } })[0], 'Må AI’en skrive i en mappe uden for projektet?');
  assert.equal(view.directoryTitle({ permission: 'external_directory', toolInput: { tool: 'read' } })[0], 'Må AI’en se en mappe uden for projektet?');
  assert.equal(view.directoryTitle({ permission: 'external_directory' })[0], 'Må AI’en se en mappe uden for projektet?');
});
