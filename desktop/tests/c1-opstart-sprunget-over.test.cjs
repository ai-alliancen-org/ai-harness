// Spørgsmål Q:C1-4 (beta 3): en ugyldig gemt opstart reddes, så projektet altid kan åbnes (storedRuntime i core/preview-config.cjs),
// men det skete tavst. Projektets indstillinger siger det nu i almindeligt dansk, med det, der blev sprunget over, under Se detaljer.
// storedRuntimeNotice giver teksten; main.cjs sender den med Projektets indstillinger, og ui/project-settings.js viser den i
// #project-runtime-notice (ui/index.html).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { storedRuntime, storedRuntimeNotice } = require('../core/preview-config.cjs');

const twenty = Array.from({ length: 20 }, (_, i) => `https://cdn${i + 1}.nyhedsside.dk`);

test('en gyldig eller tom opstart giver ingen besked', () => {
  assert.equal(storedRuntimeNotice(undefined), null);
  assert.equal(storedRuntimeNotice({ mode: 'static', network: { images: twenty, scripts: [], styles: [], connect: [] } }), null);
  assert.equal(storedRuntimeNotice({ mode: 'auto', services: [{ id: 'web', label: 'Webside', command: ['node', 'server.js'] }] }), null);
});

test('det, der blev sprunget over, siges i almindeligt dansk med feltets navn fra Projektets indstillinger', () => {
  const stored = { mode: 'ukendt', services: [{ id: 'web', label: 'Shell', command: ['sh', '-c', 'echo'] }], network: { scripts: ['http://ikke-https.dk'], styles: [], connect: [], images: [...twenty, 'https://cdn21.nyhedsside.dk'] } };
  const notice = storedRuntimeNotice(stored);
  assert.ok(notice, 'en besked');
  assert.equal(notice.text, 'En del af projektets gemte opstart kunne ikke bruges og er sprunget over. Aura bruger resten. Vil du gemme opstarten igen, så åbn Se detaljer under Opstart, og tryk Gem opstart.');
  assert.deepEqual(notice.details, [
    'Opstartsmåden kunne ikke læses, så Aura bruger Automatisk.',
    'De gemte lokale tjenester kunne ikke bruges, så Aura finder selv projektets opstart.',
    '1 adresse under Scripts er sprunget over.',
    '1 adresse under Billeder er sprunget over.',
    'En adresse skal være en præcis adresse som https://eksempel.dk, og der kan højst være 20 af hver slags.'
  ]);
  // Beskeden passer til det, Aura faktisk bruger.
  const used = storedRuntime(stored);
  assert.equal(used.mode, 'auto'); assert.equal(used.services, undefined); assert.deepEqual(used.network.images, twenty); assert.deepEqual(used.network.scripts, []);
  for (const line of [notice.text, ...notice.details]) assert.doesNotMatch(line, /normaliz|runtime|config|network|undefined/i, 'ingen tekniske ord');
});

test('en opstart, der slet ikke kan læses, og en netliste, der ikke er en liste', () => {
  assert.deepEqual(storedRuntimeNotice('ikke en opsætning').details, ['Den gemte opstart kunne ikke læses, så Aura bruger Automatisk.']);
  assert.deepEqual(storedRuntimeNotice({ network: 'alt' }).details, ['Adresserne i forhåndsvisningen kunne ikke læses og er sprunget over.']);
  assert.deepEqual(storedRuntimeNotice({ network: { images: 'https://a.dk' } }).details, ['Adresserne under Billeder kunne ikke læses og er sprunget over.', 'En adresse skal være en præcis adresse som https://eksempel.dk, og der kan højst være 20 af hver slags.']);
});

test('Projektets indstillinger har pladsen til beskeden i forhåndsvisningens afsnit, med detaljerne bag Se detaljer', () => {
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  const section = html.slice(html.indexOf('<section id="project-runtime-settings"'), html.indexOf('</section>', html.indexOf('<section id="project-runtime-settings"')));
  assert.match(section, /<div id="project-runtime-notice" class="dialog-notice" role="status" hidden><p id="project-runtime-notice-text"><\/p><details id="project-runtime-notice-more"><summary>Se detaljer<\/summary><ul id="project-runtime-notice-list"><\/ul><\/details><\/div>/);
});
