// R#17: den 21. tilladte adresse af samme slags må aldrig gemmes, og et projekt med en ugyldig gemt opstart skal altid kunne åbnes,
// vises og rettes. Prøverne bruger det rigtige lager på disken og main.cjs' egen tekst for rum, indstillinger og preview:allow.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { desktopRequire, tempDir, previewMain } = require('./c1-main-kilde.cjs');
const { Store } = desktopRequire('./core/store.cjs');
const { normalizeRuntimeConfig } = desktopRequire('./core/project-runtime.cjs');
const { grantAddress, NETWORK_LIMIT } = desktopRequire('./core/preview-policy.cjs');
const { storedRuntime, effectiveRuntime } = desktopRequire('./core/preview-config.cjs');

const twenty = Array.from({ length: 20 }, (_, i) => `https://cdn${i + 1}.nyhedsside.dk`);
const next = 'https://cdn21.nyhedsside.dk';
const seen = [{ kind: 'images', origin: next }];

test('loftet i samtykket er det samme som i normalizeRuntimeConfig', () => {
  assert.equal(NETWORK_LIMIT, 20);
  assert.doesNotThrow(() => normalizeRuntimeConfig({ network: { images: twenty } }));
  assert.throws(() => normalizeRuntimeConfig({ network: { images: [...twenty, next] } }), /højst 20/);
});

test('den 21. adresse af samme slags afvises med en vej videre, og listen er stadig gyldig', () => {
  assert.throws(() => grantAddress({ network: { images: twenty } }, seen, { kind: 'images', origin: next }), /20 adresser under Billeder[\s\S]*Fjern en adresse under Projektets indstillinger › Forhåndsvisning › Se detaljer/);
  // Under loftet tilføjes adressen, og resultatet er kontrolleret.
  const granted = grantAddress({ network: { images: twenty.slice(0, 19) } }, seen, { kind: 'images', origin: next });
  assert.equal(granted.network.images.length, 20);
  assert.doesNotThrow(() => normalizeRuntimeConfig(granted));
  // En adresse, der allerede står på en fuld liste, giver ingen fejl.
  assert.equal(grantAddress({ network: { images: twenty } }, [{ kind: 'images', origin: twenty[0] }], { kind: 'images', origin: twenty[0] }).network.images.length, 20);
});

test('preview:allow gemmer intet, når listen er fuld, og projektet kan stadig bruges', async t => {
  const dir = await tempDir(t, 'aura-c1-loft-');
  const root = path.join(dir, 'projekt'); await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/index.html'), '<h1>Nyheder</h1>');
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  await store.saveProject(root, { runtime: { network: { scripts: [], styles: [], connect: [], images: twenty } } });
  const main = previewMain({ root, store });
  await main.selectSpace(root, main.owner);
  main.spaces.get(root).blocked = new Map([[`images:${next}`, { kind: 'images', origin: next }]]);
  await assert.rejects(main.handlers['preview:allow']({ kind: 'images', origin: next }), /Fjern en adresse under Projektets indstillinger/);
  assert.equal((await store.project(root)).runtime.network.images.length, 20, 'lageret har stadig 20 adresser');
  assert.equal((await main.projectSettings()).runtime.network.images.length, 20, 'indstillingerne kan åbnes');
  await assert.doesNotReject(main.handlers['preview:runtime'](), 'forhåndsvisningens dialog kan åbnes');
});

test('et projekt med en ugyldig gemt opstart kan altid åbnes, vises og rettes', async t => {
  const dir = await tempDir(t, 'aura-c1-ugyldig-');
  const root = path.join(dir, 'projekt'); await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/index.html'), '<h1>Nyheder</h1>');
  const store = new Store(path.join(dir, 'appdata'), { isEncryptionAvailable: () => false });
  // Som efter fejlen: 21 billedadresser i lageret, plus en ugyldig adresse og en tjeneste, der ikke kan bruges.
  await store.saveProject(root, { runtime: { mode: 'auto', services: [{ id: 'web', label: 'Shell', command: ['sh', '-c', 'echo'] }], network: { scripts: ['http://ikke-https.dk'], styles: [], connect: [], images: [...twenty, next] } } });
  // Som efter en genstart: et nyt rum læser lageret.
  const main = previewMain({ root, store, openProject: async () => ({ staticPreview: true }) });
  await assert.doesNotReject(main.selectSpace(root, main.owner), 'projektet kan åbnes');
  const ctx = main.spaces.get(root);
  assert.deepEqual(ctx.runtimeConfig.network.images, twenty, 'de gyldige adresser bruges, den overskydende falder bort');
  assert.deepEqual(ctx.runtimeConfig.network.scripts, [], 'en ugyldig adresse falder bort');
  assert.equal(ctx.runtimeConfig.services, undefined, 'en ugyldig tjeneste bruges ikke');
  assert.ok(ctx.preview?.url, 'den statiske forhåndsvisning vises');
  const settings = await main.projectSettings();
  assert.deepEqual(settings.runtime.network.images, twenty, 'Projektets indstillinger kan åbnes og vise listen');
  const status = await main.handlers['preview:runtime']();
  assert.equal(status.project.kind, 'static', 'forhåndsvisningens dialog kan åbnes');
});

test('storedRuntime bevarer en gyldig opstart uændret og redder det gyldige af en ugyldig', async t => {
  const valid = { mode: 'static', network: { scripts: ['https://cdn.example.com'], styles: [], connect: [], images: ['https:'] } };
  assert.deepEqual(storedRuntime(valid), normalizeRuntimeConfig(valid));
  assert.deepEqual(storedRuntime(undefined), { mode: 'auto' });
  assert.deepEqual(storedRuntime('ikke en opsætning'), { mode: 'auto' });
  const service = { id: 'web', label: 'Webside', command: ['node', 'server.js'], cwd: '.' };
  const rescued = storedRuntime({ mode: 'ukendt', services: [service], network: { images: ['https://a.dk', 'https://a.dk/', 'file:///etc/passwd'], scripts: 'ikke en liste' } });
  assert.deepEqual(rescued, { mode: 'auto', services: [service], network: { scripts: [], connect: [], images: ['https://a.dk'], styles: [] } });
  // effectiveRuntime bruges af projektets server og må heller ikke kaste.
  const root = await tempDir(t, 'aura-c1-effektiv-');
  assert.deepEqual((await effectiveRuntime(root, { network: { images: [...twenty, next] } })).network.images, twenty);
});
