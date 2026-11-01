// Kontraktprøve del 2 for mappeadgang: Auras fortolkning af de optagne OpenCode 1.18.33-forespørgsler.
// tests/opencode-contract.test.cjs kontrollerer, hvad motoren sender. Denne prøve kontrollerer, at Aura kan
// bruge det: en mappe uden for projektet skal få et navn og kunne huskes, ikke stå som "Denne handling".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ApprovalsPolicy } = require('../core/approvals-policy.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'opencode-1.18.33');
const UNDTAGET = new Set([
  'byg-git-filer__write-ude-ny-mappe__1-external_directory.json',
  'byg-uden-git-filer__write-ude-ny-mappe__1-external_directory.json',
  'free-git-filer__write-ude-ny-mappe__1-external_directory.json',
]);

test('alle optagne mappeforespørgsler uden for projektet får et navn og kan huskes', async t => {
  const rod = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-kontrakt-'));
  t.after(() => fs.rm(rod, { recursive: true, force: true }));
  const projekt = path.join(rod, 'Dokumenter', 'projekt'), udenfor = path.join(rod, 'Dokumenter', 'ekstern');
  await fs.mkdir(projekt, { recursive: true }); await fs.mkdir(udenfor, { recursive: true });
  const erstat = value => JSON.parse(JSON.stringify(value)
    .replaceAll('${OUTSIDE}', udenfor).replaceAll('${ROOT}', projekt).replaceAll('${BASE}', path.join(rod)));
  const politik = new ApprovalsPolicy({ project: async () => ({ approvals: null }) });
  const kontekst = { projectRoot: projekt, workspaceRoot: projekt };
  const fund = [];
  for (const file of fsSync.readdirSync(FIXTURES).filter(f => f.endsWith('.json') && f !== 'INDEX.json')) {
    const fx = JSON.parse(fsSync.readFileSync(path.join(FIXTURES, file), 'utf8'));
    if (fx.request?.permission !== 'external_directory') continue;
    const forespoergsel = erstat(fx.request);
    // Kun forespørgsler der peger ud af projektet: det er hele pointen med mappeadgang.
    if (!JSON.stringify(forespoergsel).includes(udenfor)) continue;
    // Kendte undtagelser, skrevet ud så de ikke gemmer sig: skrivning til en mappe, der ikke findes endnu, kan ikke
    // huskes som en eksisterende mappe. Trin 4 i planen nægter skrivning uden for projektet i Byg.
    if (UNDTAGET.has(file)) continue;
    const d = await politik.describe(kontekst, forespoergsel);
    fund.push({ file, label: d.label, persistable: d.persistable });
  }
  assert.ok(fund.length >= 10, `for få mappeforespørgsler til at være en kontrol: ${fund.length}`);
  const fejl = fund.filter(f => f.label === 'Denne handling' || !f.label.startsWith('Mappeadgang') || f.persistable !== true);
  assert.deepEqual(fejl.map(f => f.file), [], 'disse optagne forespørgsler får ikke navn eller kan ikke huskes:\n' + fejl.map(f => `${f.file}: ${f.label}`).join('\n'));
});
