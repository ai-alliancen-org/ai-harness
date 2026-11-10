// Spørgsmål Q:C1-4 (beta 3), anden halvdel: main.cjs sender beskeden om en reddet gemt opstart med Projektets indstillinger
// (runtimeNotice), og ui/project-settings.js viser den i #project-runtime-notice med det sprungne bag Se detaljer. Når opstarten er
// gemt igen, er beskeden væk. Prøven kører main.cjs' egen tekst mod rigtigt lager og ui/project-settings.js uændret i en vm-kontekst.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { desktopRequire, tempDir, previewMain } = require('./c1-main-kilde.cjs');
const { elements, desktop } = require('./c1-dom.cjs');
const { Store } = desktopRequire('./core/store.cjs');

const twenty = Array.from({ length: 20 }, (_, i) => `https://cdn${i + 1}.nyhedsside.dk`);

test('Projektets indstillinger får beskeden fra main.cjs, når den gemte opstart blev reddet, og ingen, når den er gyldig', async t => {
  const dir = await tempDir(t, 'aura-c1-besked-');
  const root = path.join(dir, 'projekt'); await fsp.mkdir(path.join(root, 'public'), { recursive: true });
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  await store.saveProject(root, { runtime: { mode: 'auto', network: { scripts: [], styles: [], connect: [], images: [...twenty, 'https://cdn21.nyhedsside.dk'] } } });
  const main = previewMain({ root, store });
  const settings = await main.projectSettings();
  assert.equal(settings.runtimeNotice?.text, 'En del af projektets gemte opstart kunne ikke bruges og er sprunget over. Aura bruger resten. Vil du gemme opstarten igen, så åbn Se detaljer under Opstart, og tryk Gem opstart.');
  assert.deepEqual(settings.runtimeNotice.details, ['1 adresse under Billeder er sprunget over.', 'En adresse skal være en præcis adresse som https://eksempel.dk, og der kan højst være 20 af hver slags.']);
  await store.saveProject(root, { runtime: settings.runtime });
  assert.equal((await main.projectSettings()).runtimeNotice, null, 'efter Gem opstart er beskeden væk');
});

function settingsUI(answers) {
  const dom = elements();
  const dialog = dom.$('#project-settings-dialog'); dialog.querySelectorAll = () => [];
  const context = vm.createContext({ $: dom.$, node: dom.node, current: { root: '/projekt', name: 'Projekt' }, selectedOwner: () => null, console, crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000000' },
    action: async fn => fn(), call: async method => answers[method], window: {} });
  vm.runInContext(fs.readFileSync(path.join(desktop, 'ui/project-settings.js'), 'utf8'), context, { filename: 'ui/project-settings.js' });
  return { ...dom, open: () => context.window.projectSettings.open() };
}

test('ui/project-settings.js viser beskeden i almindeligt dansk med det sprungne bag Se detaljer, og skjuler den uden besked', async () => {
  const notice = { text: 'En del af projektets gemte opstart kunne ikke bruges og er sprunget over. Aura bruger resten. Vil du gemme opstarten igen, så åbn Se detaljer under Opstart, og tryk Gem opstart.', details: ['1 adresse under Billeder er sprunget over.'] };
  const med = settingsUI({ projectSettings: { runtime: { mode: 'auto' }, runtimeNotice: notice, approvals: {}, commandSandbox: { available: true } } });
  await med.open();
  assert.equal(med.$('#project-runtime-notice').hidden, false);
  assert.equal(med.$('#project-runtime-notice-text').textContent, notice.text);
  assert.deepEqual(med.$('#project-runtime-notice-list').children.map(item => item.textContent), notice.details);
  assert.equal(med.$('#project-runtime-notice-more').hidden, false);
  const uden = settingsUI({ projectSettings: { runtime: { mode: 'auto' }, runtimeNotice: null, approvals: {}, commandSandbox: { available: true } } });
  await uden.open();
  assert.equal(uden.$('#project-runtime-notice').hidden, true);
});
