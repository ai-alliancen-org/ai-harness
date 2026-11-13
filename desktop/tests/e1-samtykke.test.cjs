// Valg 4 (5. november 2026): nye projekter får en kort fast netliste, og alt andet kræver brugerens samtykke pr. adresse.
// Prøverne beviser, at en adresse som https://evil.example ikke kan komme på listen fra en fil, fra AI-ens svar eller fra siden.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DESIGN_PREVIEW_NETWORK } = require('../core/project-runtime.cjs');
const { consentableAddress, grantAddress, policyFor, allowedRequest } = require('../core/preview-policy.cjs');
const { effectiveRuntime } = require('../core/preview-config.cjs');
const { guidanceFor } = require('../core/project-guidance.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const set = (blocked) => [{ kind: 'scripts', origin: blocked }];

test('nye projekter får præcis den korte liste, og ingen eksterne billeder', () => {
  assert.deepEqual(DESIGN_PREVIEW_NETWORK, { scripts: ['https://cdn.tailwindcss.com'], styles: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'], connect: [], images: [] });
  const projekt = policyFor({ origin: 'aura-preview://nyt/', network: DESIGN_PREVIEW_NETWORK });
  assert.equal(allowedRequest({ url: 'https://fonts.gstatic.com/s/a.woff2', resourceType: 'font' }, projekt), true);
  assert.equal(allowedRequest({ url: 'https://cdn.jsdelivr.net/x.js', resourceType: 'script' }, projekt), false);
  assert.equal(allowedRequest({ url: 'https://billeder.example.com/a.png', resourceType: 'image' }, projekt), false);
});

test('samtykke tillader kun præcise https-værter, aldrig IP, lokale, private eller andre former', () => {
  assert.equal(consentableAddress('images', 'https://billeder.example.com').ok, true);
  const afvist = ['http://cdn.example.com', 'https://127.0.0.1', 'https://localhost', 'https://10.0.0.5', 'https://192.168.1.2', 'https://[::1]', 'https://[::ffff:7f00:1]', 'https://2130706433', 'https://0x7f.1', 'https://intern', 'https://bruger:kode@cdn.example.com', 'https://cdn.example.com:8443', 'https://*.example.com', 'https://cdn.example.com/sti', 'https://a.localhost', 'ikke en adresse'];
  const interne = ['https://x.local', 'https://printer.internal', 'https://metadata.google.internal', 'https://foo.lan', 'https://a.home.arpa', 'https://x.test', 'https://evil.example', 'https://a.invalid', 'https://router.intranet', 'https://nas.corp', 'https://nas.home'];
  for (const adresse of interne) assert.equal(consentableAddress('scripts', adresse).ok, false, adresse);
  for (const adresse of afvist) assert.equal(consentableAddress('scripts', adresse).ok, false, adresse);
  assert.equal(consentableAddress('connect', 'https://api.example.com').ok, false, 'forbindelser kan ikke tillades herfra');
});

test('en adresse kommer kun på listen, hvis forhåndsvisningen har blokeret den, og typen følger blokeringen', () => {
  const evil = 'https://evil.example.com';
  assert.throws(() => grantAddress({}, [], { kind: 'scripts', origin: evil }), /ikke blokeret/);
  assert.throws(() => grantAddress({}, set('https://andet.example'), { kind: 'scripts', origin: evil }), /ikke blokeret/);
  assert.throws(() => grantAddress({}, set(evil), { kind: 'images', origin: evil }), /ikke blokeret/, 'en anden type end den blokerede');
  const ny = grantAddress({ mode: 'auto', network: DESIGN_PREVIEW_NETWORK }, set(evil), { kind: 'scripts', origin: evil });
  assert.deepEqual(ny.network.scripts, ['https://cdn.tailwindcss.com', evil]);
  assert.deepEqual(ny.network.styles, DESIGN_PREVIEW_NETWORK.styles, 'andre lister er uændrede');
  assert.throws(() => grantAddress({}, set('https://10.0.0.1'), { kind: 'scripts', origin: 'https://10.0.0.1' }));
});

test('et projekt uden gemt netliste får en komplet liste, når en adresse tillades', () => {
  const ny = grantAddress({}, [{ kind: 'images', origin: 'https://billeder.example.com' }], { kind: 'images', origin: 'https://billeder.example.com' });
  assert.deepEqual(ny.network, { scripts: [], styles: [], images: ['https://billeder.example.com'], connect: [] });
});

test('fra en fil: .aura/preview.json kan ikke sætte evil.example på listen', async t => {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-e1-')));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, '.aura'));
  await fsp.writeFile(path.join(root, '.aura', 'preview.json'), JSON.stringify({ services: [{ id: 'web', label: 'Web', command: ['node', 'a.js'], cwd: '.' }], network: { scripts: ['https://evil.example.com'], images: ['https://evil.example.com'] } }));
  const config = await effectiveRuntime(root, { network: DESIGN_PREVIEW_NETWORK });
  assert.ok(!JSON.stringify(config.network).includes('evil.example'));
});

test('fra AI-ens svar: prompten og aura_preview kan hverken give eller besvare samtykket', () => {
  const tekst = guidanceFor('desktop', { network: DESIGN_PREVIEW_NETWORK });
  assert.match(tekst, /kræver brugerens samtykke pr\. adresse/);
  assert.match(tekst, /hverken give eller besvare/);
  for (const [fil, kilde] of Object.entries({ bridge: read('core/preview-bridge.cjs'), ai: read('core/ai-preview.cjs') })) assert.doesNotMatch(kilde, /previewAllow|preview:allow|grantAddress/, fil);
});

test('fra siden: kanalen findes kun i brugerfladen, og hovedprocessen tillader kun set blokering efter brugerens klik', () => {
  const main = read('main.cjs'), preload = read('preload.cjs'), server = read('ui/server.js'), session = read('core/preview-session.cjs');
  assert.match(preload, /previewAllow: 'preview:allow'/);
  assert.match(server, /call\('previewAllow'/, 'kun brugerfladen kalder kanalen');
  assert.match(main, /handle\('preview:allow'[\s\S]{0,900}grantAddress\(/);
  assert.doesNotMatch(session, /grantAddress|preview:allow|saveProject/, 'blokeringen skriver aldrig selv på listen');
  const hændelse = main.slice(main.indexOf('function previewDiagnostic'), main.indexOf('function configurePreviewSession'));
  assert.doesNotMatch(hændelse, /grantAddress|saveProject/, 'en blokering fra siden skriver aldrig selv på listen');
});

test('Se detaljer viser listen, og samtykket stiller ét spørgsmål med to valg', () => {
  const server = read('ui/server.js');
  assert.match(server, /Tillad denne adresse/); assert.match(server, /Behold blokeret/);
  assert.match(server, /Se detaljer: projektets netliste/);
});
