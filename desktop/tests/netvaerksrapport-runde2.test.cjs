// Auras netværkskald, runde 2 (spor D). N:E-4: «Ryd rapporten» spørger først, ligesom Slet samtale. N:E-6: en gemt fil uden
// tidsorden mister alle registreringer over 30 dage ved indlæsning. N:E-7: 30-dagesgrænsen gælder også det, rapporten viser
// (snapshot), og det, der gemmes (save), også når Aura står åben uden nye kald.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { NetworkJournal, RETENTION_DAYS } = require('../core/network-journal.cjs');
const { Document, visible, CONTROLS, label } = require('./d2-dom.cjs');

const DAG = 24 * 60 * 60 * 1000;
const nu = Date.parse('2026-11-10T12:00:00Z');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function mappe(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aura-netvaerk-r2-'));
  // En planlagt gemning (50 ms efter et kald eller en visning) kan skrive en midlertidig fil, mens mappen fjernes. Oprydningen
  // prøver derfor igen ved ENOTEMPTY, så prøven ikke fejler tilfældigt under belastning.
  t.after(() => fsp.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const dir = path.join(root, 'journal'); await fsp.mkdir(dir, { mode: 0o700 });
  return dir;
}
const gemt = async dir => JSON.parse(await fsp.readFile(path.join(dir, 'requests.json'), 'utf8'));
const record = (n, startedAt, host) => ({ id: id(n), startedAt, status: 'completed', category: 'model', host, locality: 'remote' });

// --- N:E-6 ---

test('N:E-6: en gemt fil uden tidsorden mister alle registreringer over 30 dage ved indlæsning, også dem midt i filen', async t => {
  const dir = await mappe(t);
  // Ny, gammel, ny, gammel: en tidlig grænse, der stopper ved den første nye registrering, ville lade de gamle stå.
  await fsp.writeFile(path.join(dir, 'requests.json'), JSON.stringify({ schemaVersion: 1, recordingStartedAt: '2026-09-01T00:00:00.000Z', dropped: 0, records: [
    record(1, '2026-11-01T10:00:00.000Z', 'api.ny1.dk'), record(2, '2026-09-15T10:00:00.000Z', 'api.gammel1.dk'),
    record(3, '2026-11-05T10:00:00.000Z', 'api.ny2.dk'), record(4, '2026-10-01T10:00:00.000Z', 'api.gammel2.dk')
  ] }), { mode: 0o600 });
  const journal = new NetworkJournal({ now: () => nu }); await journal.configure({ directory: dir });
  assert.deepEqual(journal.snapshot().records.map(r => r.host), ['api.ny1.dk', 'api.ny2.dk']);
  await journal.flush();
  assert.deepEqual((await gemt(dir)).records.map(r => r.host), ['api.ny1.dk', 'api.ny2.dk'], 'de gamle registreringer er også væk i filen');
});

// --- N:E-7 ---

test('N:E-7: en Aura, der står åben uden nye kald, viser ikke registreringer over 30 dage', async t => {
  const dir = await mappe(t); let tid = nu;
  const journal = new NetworkJournal({ now: () => tid }); await journal.configure({ directory: dir });
  await journal.observedFetch('https://api.eksempel.dk/x', {}, { category: 'model' }, () => new Response('svar'));
  assert.equal(journal.snapshot().records.length, 1);
  tid = nu + (RETENTION_DAYS + 2.5) * DAG;
  const snapshot = journal.snapshot();
  assert.deepEqual(snapshot.records, [], 'kaldet er 32,5 dage gammelt');
  assert.ok(Date.parse(snapshot.recordingStartedAt) >= tid - RETENTION_DAYS * DAG, 'perioden «alle» starter højst 30 dage tilbage');
  // Visningen planlægger en gemning; den gøres færdig her, før mappen fjernes.
  await journal.flush();
});

test('N:E-7: det, der gemmes, overholder også 30 dage, og filen ryddes, når rapporten vises, uden at Aura genstartes', async t => {
  const dir = await mappe(t); let tid = nu;
  const journal = new NetworkJournal({ now: () => tid }); await journal.configure({ directory: dir });
  await journal.observedFetch('https://api.gammel.dk/x', {}, { category: 'model' }, () => new Response('svar'));
  await journal.flush(); assert.equal((await gemt(dir)).records.length, 1);
  tid = nu + (RETENTION_DAYS + 1) * DAG;
  // save() alene: fx når Aura lukkes (flush) uden nye kald.
  await journal.flush();
  assert.deepEqual((await gemt(dir)).records, [], 'en lukning efter 31 dage gemmer ikke det gamle kald');
  // snapshot() alene: rapporten vises, og den planlagte gemning rydder filen.
  const anden = await mappe(t); tid = nu;
  const aaben = new NetworkJournal({ now: () => tid }); await aaben.configure({ directory: anden });
  await aaben.observedFetch('https://api.gammel.dk/y', {}, { category: 'model' }, () => new Response('svar'));
  await aaben.flush(); assert.equal((await gemt(anden)).records.length, 1);
  tid = nu + (RETENTION_DAYS + 1) * DAG;
  aaben.snapshot();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual((await gemt(anden)).records, [], 'filen er ryddet uden genstart');
});

test('N:E-7: en Aura, der står åben uden kald og uden at rapporten vises, rydder også filen efter 30 dage', async t => {
  const dir = await mappe(t); let tid = nu;
  const journal = new NetworkJournal({ now: () => tid, sweepMs: 20 }); await journal.configure({ directory: dir });
  await journal.observedFetch('https://api.gammel.dk/z', {}, { category: 'model' }, () => new Response('svar'));
  await journal.flush(); assert.equal((await gemt(dir)).records.length, 1);
  tid = nu + (RETENTION_DAYS + 1) * DAG;
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual((await gemt(dir)).records, [], 'den løbende oprydning har fjernet kaldet fra filen');
});

// --- N:E-4: dialogen med den rigtige markup ---

const UI = path.join(__dirname, '../ui/network-report.js');
function dialogen({ cleared } = {}) {
  const doc = new Document({ deployment: false }), kald = [];
  const aaben = doc.createElement('button'); aaben.id = 'network-report-open'; aaben.textContent = 'Auras netværkskald'; doc.root.append(aaben);
  const report = { ...new NetworkJournal({ now: () => nu }).snapshot(), startedAt: '2026-11-10T11:00:00.000Z', records: [{ ...record(1, '2026-11-10T11:30:00.000Z', 'api.anthropic.com'), method: 'POST', httpStatus: 200 }] };
  const harness = {
    networkReport: async () => { kald.push('report'); return { ok: true, value: report }; },
    networkReportSave: async () => { kald.push('save'); return { ok: true, value: true }; },
    networkReportClear: async () => { kald.push('clear'); return { ok: true, value: cleared || { ...report, records: [] } }; }
  };
  vm.runInNewContext(fs.readFileSync(UI, 'utf8'), { document: doc, window: { harness }, Option: function Option(text, value) { return doc.option(text, value); }, Date, Number, Set, Object, Math, setTimeout });
  const $ = name => doc.getElementById(name);
  const dialog = doc.querySelector('#network-report-dialog');
  const valg = () => dialog.querySelectorAll(CONTROLS).filter(visible).map(label);
  const klik = async el => { assert.ok(visible(el), `«${label(el)}» er ikke synlig: ${valg().join(' | ')}`); assert.ok(!el.disabled, `«${label(el)}» er slået fra`); if (el.tagName === 'SUMMARY') el.parent.open = !el.parent.open; else await el.onclick?.(); await new Promise(resolve => setImmediate(resolve)); };
  return { doc, $, dialog, kald, aaben, valg, klik };
}
const vent = () => new Promise(resolve => setImmediate(resolve));

test('N:E-4: «Ryd rapporten» spørger først; Annuller sletter intet, og først «Ryd rapporten» i spørgsmålet sletter', async () => {
  const d = dialogen();
  d.aaben.dispatch('click'); await vent();
  assert.deepEqual(d.valg(), ['Luk', 'Se detaljer', 'network-report-save'], 'første lag er uændret');
  await d.klik(d.dialog.querySelector('#network-report-details > summary'));
  await d.klik(d.$('network-report-clear'));
  assert.equal(d.kald.includes('clear'), false, 'intet er slettet endnu');
  const spoergsmaal = d.$('network-report-clear-question');
  assert.ok(visible(spoergsmaal), 'spørgsmålet står i dialogen');
  assert.match(spoergsmaal.textContent, /alle projekter/); assert.match(spoergsmaal.textContent, /kan ikke fortrydes/);
  assert.equal(visible(d.$('network-report-clear')), false, 'Ryd rapporten står ikke to gange');
  assert.equal(d.doc.activeElement, d.$('network-report-clear-cancel'), 'fokus står på Annuller, som ved Slet samtale');
  // Annuller: intet slettes, og Ryd rapporten står igen.
  await d.klik(d.$('network-report-clear-cancel'));
  assert.equal(d.kald.includes('clear'), false); assert.equal(visible(spoergsmaal), false); assert.ok(visible(d.$('network-report-clear')));
  assert.equal(d.doc.activeElement, d.$('network-report-clear'));
  // Bekræft: nu slettes registreringerne.
  await d.klik(d.$('network-report-clear')); await d.klik(d.$('network-report-clear-confirm'));
  assert.deepEqual(d.kald.filter(k => k === 'clear'), ['clear']);
  assert.match(d.$('network-report-feedback').textContent, /ryddet/);
  assert.equal(visible(spoergsmaal), false, 'spørgsmålet er væk igen');
});

test('N:E-4: et åbent spørgsmål forsvinder, når dialogen lukkes, så næste åbning ikke starter med det', async () => {
  const d = dialogen();
  d.aaben.dispatch('click'); await vent();
  await d.klik(d.dialog.querySelector('#network-report-details > summary'));
  await d.klik(d.$('network-report-clear')); assert.ok(visible(d.$('network-report-clear-question')));
  d.dialog.close(); d.aaben.dispatch('click'); await vent();
  assert.equal(visible(d.$('network-report-clear-question')), false); assert.equal(d.kald.includes('clear'), false);
});
