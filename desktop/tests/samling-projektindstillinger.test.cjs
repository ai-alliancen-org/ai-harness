// Fund 1 og 10 (beta 3): «Tillad uden isolation» i projektets indstillinger skal kunne gemmes på Windows. Afgørelsen ligger i
// projectCommandSettings i core/approvals-policy.cjs (afprøvet i tests/approvals-policy.test.cjs). Denne prøve kører main.cjs'
// egen handler 'project:settings-save' med den rigtige ApprovalsPolicy og Store, så det er selve kanalen, der afprøves.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const desktop = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(desktop, 'main.cjs'), 'utf8');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');
const { Store } = require('../core/store.cjs');
const sandbox = require('../core/command-sandbox.cjs');

function handlerText() {
  const start = source.indexOf("handle('project:settings-save', "), end = source.indexOf('\n}));', start);
  assert.ok(start >= 0 && end > start, 'handleren findes i main.cjs');
  return source.slice(start + "handle('project:settings-save', ".length, end + '\n})'.length);
}
function projectSettingsText() {
  const start = source.indexOf('async function projectSettings() {'), end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'projectSettings findes i main.cjs');
  return source.slice(start, end + 2);
}

// support er det, command-sandbox.support() svarer på den simulerede computer. Kun det modul skiftes ud.
async function kanal(t, support) {
  const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-indstillinger-'))), root = path.join(base, 'projekt');
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  await fsp.mkdir(root);
  const store = new Store(path.join(base, 'data'), {}), workbench = { store, approvalsPolicy: new ApprovalsPolicy(store), chats: new Map() };
  const fakeRequire = name => name === './core/command-sandbox.cjs' ? { ...sandbox, support: async () => support } : require(path.join(desktop, name));
  // storedRuntimeNotice er main.cjs' egen import fra core/preview-config.cjs (Q:C1-4); projectSettings giver beskeden med.
  const stubs = { exclusive: action => action(), requireProject: () => root, normalizeRuntimeConfig: value => value, storedRuntime: value => value || {}, storedRuntimeNotice: require('../core/preview-config.cjs').storedRuntimeNotice, workbench, spaces: new Map(), currentWorkbench: () => workbench, inspectRuntime: async () => ({}), require: fakeRequire };
  const names = Object.keys(stubs), values = names.map(name => stubs[name]);
  const projectSettings = new Function(...names, projectSettingsText() + '\nreturn projectSettings;')(...values);
  return new Function(...names, 'projectSettings', 'return (' + handlerText() + ');')(...values, projectSettings);
}

test('fund 1: Windows kan gemme «Tillad uden isolation» i projektets indstillinger, og et fravalg fjerner det igen', async t => {
  const save = await kanal(t, await sandbox.support({ platform: 'win32' }));
  const saved = await save({ autoCommands: true, autoCommandsUnisolated: true });
  assert.equal(saved.approvals.autoCommands, true);
  assert.equal(saved.approvals.autoCommandsUnisolated, true);
  const off = await save({ autoCommands: false });
  assert.deepEqual([off.approvals.autoCommands, off.approvals.autoCommandsUnisolated], [false, false]);
});

test('fund 1: uden udtrykkeligt valg af «uden isolation» siger Windows stadig nej, og en Mac uden sandkasse får ingen reservevej', async t => {
  const windows = await kanal(t, await sandbox.support({ platform: 'win32' }));
  await assert.rejects(windows({ autoCommands: true }), /Windows/);
  const mac = await kanal(t, { available: false, platform: 'darwin', reason: 'Kommandobeskyttelsen kan ikke starte på denne computer. Automatisk kommandokørsel er slået fra.' });
  await assert.rejects(mac({ autoCommands: true, autoCommandsUnisolated: true }), /Kommandobeskyttelsen kan ikke starte/);
  await assert.rejects(mac({ autoCommands: true, autoCommandsUnisolated: 'ja' }), /Ugyldigt valg af Auto-godkend/);
});
