// Auras netværkskald, beta 3. R#36: CSV-eksporten passer til dansk Excel og siger, hvilket filter og hvilken periode den dækker.
// R#38: dialogens første lag har én sætning, én primær knap og Luk; resten ligger bag Se detaljer i almindeligt dansk.
// R#39: registreringerne gemmes i højst 30 dage og kan ryddes fra dialogen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { select, serialize } = require('../core/network-report.cjs');
const network = require('../core/network-journal.cjs');
const { NetworkJournal } = network;

const UI = path.join(__dirname, '../ui/network-report.js');
const DAG = 24 * 60 * 60 * 1000;

// Felterne deles ved semikolon uden for anførselstegn, sådan som dansk Excel læser en .csv-fil.
function felter(linje) {
  const ud = []; let celle = '', inde = false;
  for (let i = 0; i < linje.length; i++) {
    const c = linje[i];
    if (c === '"') { if (inde && linje[i + 1] === '"') { celle += '"'; i++; } else inde = !inde; }
    else if (c === ';' && !inde) { ud.push(celle); celle = ''; }
    else celle += c;
  }
  ud.push(celle); return ud;
}
function tabel(csv) {
  const linjer = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean), hoved = felter(linjer[0]);
  return { hoved, linjer, raekker: linjer.slice(1).map(linje => Object.fromEntries(felter(linje).map((v, i) => [hoved[i], v]))) };
}
async function mappe(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-netvaerk-b3-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
// Dialogens markup står som én skabelon i kilden. Første lag er alt uden for Se detaljer.
function markup() { return /`(<div class="dialog-heading">[\s\S]*?)`/.exec(require('node:fs').readFileSync(UI, 'utf8'))[1]; }
const foersteLag = html => html.replace(/<details[\s\S]*<\/details>/g, '');

const nu = Date.parse('2026-11-09T12:00:00Z');
const snapshot = { scope: 'aura-only', startedAt: '2026-11-09T11:00:00.000Z', recordingStartedAt: '2026-11-01T08:00:00.000Z', dropped: 0,
  coverage: [{ category: 'model', status: 'partial', note: 'Delvis dækket.' }], limits: ['Kun Auras egne kald; ikke alle computerens forbindelser.'], records: [
    { startedAt: '2026-11-08T09:00:00.000Z', category: 'model', purpose: 'model-response', host: 'api.anthropic.com', locality: 'remote', method: 'POST', status: 'completed', httpStatus: 200,
      attempt: null, headersMs: 123.457, firstBodyMs: 246.913, totalMs: 370.37, sentBytes: 7, receivedBytes: 2048, errorCategory: null },
    { startedAt: '2026-11-09T11:58:00.000Z', category: 'catalog', purpose: 'model-catalog', host: 'api.mistral.ai', locality: 'remote', method: 'GET', status: 'failed', httpStatus: 429,
      attempt: null, headersMs: 80.125, firstBodyMs: null, totalMs: 81.625, sentBytes: null, receivedBytes: null, errorCategory: 'http' },
    { startedAt: '2026-11-09T11:59:00.000Z', category: 'model', purpose: 'model-response', host: 'api.anthropic.com', locality: 'remote', method: 'POST', status: 'completed', httpStatus: 200,
      attempt: null, headersMs: 10, firstBodyMs: 20, totalMs: 30, sentBytes: 5, receivedBytes: 10, errorCategory: null }
  ] };

test('R#36: CSV til dansk Excel: semikolon, decimalkomma og tomme felter, der ikke er målinger', () => {
  const csv = serialize(select(snapshot, { period: 'all' }, nu), 'csv');
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'BOM, så Excel læser æ, ø og å');
  assert.doesNotMatch(csv, /^\uFEFF?sep=/, 'ingen sep=-linje: den får Excel til at overse BOM');
  const { hoved, linjer, raekker } = tabel(csv);
  assert.ok(hoved.length >= 15 && hoved.includes('startedAt') && hoved.includes('totalMs'), 'overskriften deles ved semikolon: ' + hoved.join(' | '));
  for (const linje of linjer) assert.equal(felter(linje).length, hoved.length, 'hver linje har lige så mange felter som overskriften');
  assert.equal(raekker[0].headersMs, '123,457'); assert.equal(raekker[0].firstBodyMs, '246,913'); assert.equal(raekker[0].totalMs, '370,37');
  assert.equal(raekker[0].receivedBytes, '2048'); assert.equal(raekker[0].httpStatus, '200');
  assert.equal(raekker[0].errorCategory, '', 'et gennemført kald har ingen fejltype, og det er ingen manglende måling');
  assert.equal(raekker[0].attempt, '', 'forsøgsnummeret er ingen måling');
  assert.equal(raekker[1].firstBodyMs, 'Ikke målt'); assert.equal(raekker[1].sentBytes, 'Ikke målt'); assert.equal(raekker[1].errorCategory, 'http');
});

test('R#36: CSV og JSON siger, hvilket filter og hvilken periode de dækker, også når intet passer', () => {
  const rapport = select(snapshot, { period: '5m', status: 'failed' }, nu);
  const { raekker } = tabel(serialize(rapport, 'csv'));
  assert.equal(raekker.length, 1);
  assert.match(raekker[0].filter, /Periode: Seneste 5 minutter/); assert.match(raekker[0].filter, /Type: Alle typer/); assert.match(raekker[0].filter, /Status: Fejl/);
  assert.equal(raekker[0].periodFrom, '2026-11-09T11:55:00.000Z'); assert.equal(raekker[0].generatedAt, '2026-11-09T12:00:00.000Z');
  assert.equal(raekker[0].selection, '1 af 3 registreringer');
  const json = JSON.parse(serialize(rapport, 'json'));
  assert.equal(json.periodFrom, '2026-11-09T11:55:00.000Z'); assert.equal(json.totalRecords, 3); assert.deepEqual(json.filters, { category: '', status: 'failed', period: '5m' });
  // Standarden i dialogen er denne appkørsel: eksporten siger, at den ældre kørsel ikke er med.
  const session = tabel(serialize(select(snapshot, { period: 'session' }, nu), 'csv')).raekker;
  assert.equal(session.length, 2); assert.match(session[0].filter, /Periode: Denne appkørsel/); assert.equal(session[0].periodFrom, '2026-11-09T11:00:00.000Z'); assert.equal(session[0].selection, '2 af 3 registreringer');
  const alle = tabel(serialize(select(snapshot, { period: 'all' }, nu), 'csv')).raekker;
  assert.match(alle[0].filter, /Periode: Alle gemte registreringer/); assert.equal(alle[0].periodFrom, '2026-11-01T08:00:00.000Z');
  const tom = tabel(serialize(select(snapshot, { period: '5m', category: 'git' }, nu), 'csv')).raekker;
  assert.equal(tom.length, 1); assert.match(tom[0].filter, /Type: Git/); assert.equal(tom[0].selection, '0 af 3 registreringer'); assert.equal(tom[0].startedAt, '');
});

test('R#38: første lag har én sætning, én primær knap og én Luk; filtre, format og tabel ligger bag Se detaljer', () => {
  const html = markup(), lag = foersteLag(html);
  assert.equal((lag.match(/class="primary"/g) || []).length, 1, 'én primær knap');
  assert.match(lag, /class="primary">Gem rapport</);
  assert.equal((lag.match(/>Luk</g) || []).length, 1, 'én Luk');
  assert.equal((lag.match(/<button/g) || []).length, 2, 'kun Gem rapport og Luk er knapper i første lag');
  assert.doesNotMatch(lag, /<select|<table/, 'filtre, format og tabel ligger bag Se detaljer');
  assert.match(html, /<summary>Se detaljer<\/summary>/);
  const detaljer = html.slice(html.indexOf('<summary>Se detaljer</summary>'));
  for (const id of ['network-period', 'network-category', 'network-status', 'network-format', 'network-report-rows', 'network-report-refresh']) assert.match(detaljer, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(html, /svarheaders|Første bytes|HTTP-svar/, 'almindeligt dansk i dialogen');
});

test('R#38: typefilteret viser kun typer, Aura registrerer, ældre kald viser datoen, og sætningen siger antal og destinationer', () => {
  const rapport = require('../ui/network-report.js');
  const snap = new NetworkJournal().snapshot();
  assert.deepEqual(rapport.categoryOptions(snap).map(([key]) => key), ['model', 'catalog']);
  assert.deepEqual(rapport.categoryOptions({ ...snap, records: [{ category: 'integration' }] }).map(([key]) => key), ['model', 'catalog', 'integration']);
  const morgen = Date.parse('2026-11-09T06:30:00Z');
  assert.match(rapport.timeText('2026-10-01T06:00:00.000Z', morgen), /2026/, 'ældre kald viser datoen');
  assert.doesNotMatch(rapport.timeText('2026-11-09T06:00:00.000Z', morgen), /2026/, 'dagens kald viser kun klokkeslæt');
  assert.equal(rapport.summaryText([{ host: 'a.dk' }, { host: 'a.dk' }], { period: 'session' }), 'Denne appkørsel: 2 registrerede kald til 1 destination.');
  assert.equal(rapport.summaryText([], { period: '5m', status: 'failed' }), 'Seneste 5 minutter · Fejl: ingen registrerede kald.');
  assert.doesNotMatch(Object.values(rapport.statuses).join(' '), /svarheaders/);
});

test('R#38: begrænsningerne er skrevet på almindeligt dansk uden feltnavne', () => {
  const limits = new NetworkJournal().snapshot().limits.join(' ');
  assert.doesNotMatch(limits, /sentBytes|receivedBytes|request-body|body-bytes|Loopback|redirects|DNS|UDP|\bnull\b|transportfunktionen|credentials|query-parametre/);
});

test('R#39: registreringer ældre end 30 dage indlæses ikke og forsvinder, mens Aura kører', async t => {
  const dir = path.join(await mappe(t), 'journal'); await fs.mkdir(dir, { mode: 0o700 });
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  await fs.writeFile(path.join(dir, 'requests.json'), JSON.stringify({ schemaVersion: 1, recordingStartedAt: '2026-09-01T00:00:00.000Z', dropped: 0, records: [
    { id: id(1), startedAt: '2026-09-20T10:00:00.000Z', status: 'completed', category: 'model', host: 'api.gammel.dk', locality: 'remote' },
    { id: id(2), startedAt: '2026-10-20T10:00:00.000Z', status: 'completed', category: 'model', host: 'api.ny.dk', locality: 'remote' }
  ] }), { mode: 0o600 });
  let tid = nu;
  const journal = new NetworkJournal({ now: () => tid }); await journal.configure({ directory: dir });
  assert.deepEqual(journal.snapshot().records.map(r => r.host), ['api.ny.dk']);
  assert.equal(journal.snapshot().recordingStartedAt, new Date(nu - 30 * DAG).toISOString(), 'perioden «alle» starter højst 30 dage tilbage');
  await journal.flush();
  assert.doesNotMatch(await fs.readFile(path.join(dir, 'requests.json'), 'utf8'), /api\.gammel\.dk/, 'den gamle registrering slettes også i filen');
  // Aura kører videre: 16 dage senere er kaldet fra 20. oktober over 30 dage gammelt.
  tid = Date.parse('2026-11-25T12:00:00Z');
  await journal.observedFetch('https://api.ny2.dk/x', {}, { category: 'model' }, () => new Response('svar'));
  assert.deepEqual(journal.snapshot().records.map(r => r.host), ['api.ny2.dk']);
});

test('R#39: rapporten kan ryddes, også i filen, og nye kald registreres bagefter', async t => {
  const dir = path.join(await mappe(t), 'journal');
  const journal = new NetworkJournal({ limit: 2, now: () => nu }); await journal.configure({ directory: dir });
  for (let i = 0; i < 3; i++) await journal.observedFetch('https://api.eksempel.dk/x', {}, { category: 'model' }, () => new Response('svar'));
  await journal.flush(); assert.equal(journal.snapshot().dropped, 1);
  const tomt = await journal.clear();
  assert.deepEqual(tomt.records, []); assert.equal(tomt.dropped, 0); assert.equal(tomt.recordingStartedAt, new Date(nu).toISOString());
  const gemt = JSON.parse(await fs.readFile(path.join(dir, 'requests.json'), 'utf8'));
  assert.deepEqual(gemt.records, []); assert.equal(gemt.dropped, 0);
  await journal.observedFetch('https://api.eksempel.dk/y', {}, { category: 'model' }, () => new Response('svar'));
  assert.equal(journal.snapshot().records.length, 1);
  // Den fælles journal, som handleren network:clear i main.cjs rydder, sender den tomme rapport tilbage til dialogen.
  assert.equal(typeof network.clear, 'function', 'appens fælles journal kan ryddes');
  await network.observedFetch('https://api.eksempel.dk/z', {}, { category: 'model' }, () => new Response('svar'));
  assert.ok(network.snapshot().records.length >= 1);
  const faelles = await network.clear(); assert.deepEqual(faelles.records, []); assert.equal(network.snapshot().records.length, 0);
});

// Dialogens eget script køres i en afgrænset ramme med en lille DOM-attrap og en attrap for window.harness. Rammen kender kun
// elementer med id fra markup, så forløbet afprøves uden Electron: åbn, læs, filtrér, gem med format og filtre, ryd og luk.
function ramme(svar) {
  const elementer = {}, kald = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.hidden = false; this.disabled = false; this.value = ''; this.lyttere = {}; this.open = false; }
    append(...a) { this.children.push(...a); } replaceChildren(...a) { this.children = a; } setAttribute() {} focus() { ramme.fokus = this; }
    addEventListener(type, fn) { (this.lyttere[type] ||= []).push(fn); } udloes(type) { for (const fn of this.lyttere[type] || []) fn(); }
    set innerHTML(html) {
      for (const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const el = new El(match[1]); el.id = match[2]; elementer[match[2]] = el;
        if (match[1] === 'select') el.value = /<option value="([^"]*)"/.exec(html.slice(match.index))?.[1] ?? '';
      }
      this.lukkere = [...html.matchAll(/data-network-close/g)].map(() => new El('button'));
    }
    querySelectorAll(selector) { return selector === '[data-network-close]' ? this.lukkere : []; }
    showModal() { this.open = true; } close() { this.open = false; this.udloes('close'); }
  }
  const aaben = new El('button'); elementer['network-report-open'] = aaben;
  let dialog;
  const document = { getElementById: id => elementer[id] || null, createElement: tag => (tag === 'dialog' ? dialog = new El(tag) : new El(tag)), body: { append() {} } };
  const harness = {
    networkReport: async () => { kald.push(['report']); return { ok: true, value: svar.report }; },
    networkReportSave: async value => { kald.push(['save', value]); return { ok: true, value: true }; },
    networkReportClear: async () => { kald.push(['clear']); return { ok: true, value: svar.cleared }; }
  };
  class Option { constructor(label, value) { this.label = label; this.value = value; } }
  require('node:vm').runInNewContext(require('node:fs').readFileSync(UI, 'utf8'), { document, window: { harness }, Option, Date, Number, Set, Object, Math, setTimeout });
  // Kald fra rammen er lavet i en anden realm; JSON giver almindelige objekter, som deepStrictEqual kan sammenligne.
  const tekst = id => elementer[id].textContent, sidste = () => JSON.parse(JSON.stringify(kald.at(-1)));
  const raekker = () => elementer['network-report-rows'].children.length;
  return { elementer, kald, sidste, aaben, dialog: () => dialog, tekst, raekker };
}
const vent = () => new Promise(resolve => setImmediate(resolve));

test('R#38 og R#39: dialogens forløb: åbn, filtrér, gem med format og filtre, ryd og luk', async () => {
  const report = { ...new NetworkJournal({ now: () => nu }).snapshot(), startedAt: '2026-11-09T11:00:00.000Z', records: snapshot.records };
  const r = ramme({ report, cleared: { ...report, records: [], dropped: 0 } });
  r.aaben.udloes('click'); await vent();
  assert.equal(r.dialog().open, true);
  assert.equal(r.tekst('network-report-summary'), 'Denne appkørsel: 2 registrerede kald til 2 destinationer.');
  assert.equal(r.raekker(), 2); assert.equal(r.elementer['network-report-save'].disabled, false);
  assert.deepEqual(r.elementer['network-category'].children.map(option => option.value), ['', 'model', 'catalog'], 'kun typer, Aura registrerer');
  await r.elementer['network-report-save'].onclick();
  assert.deepEqual(r.sidste(), ['save', { format: 'csv', filters: { period: 'session', category: '', status: '' } }], 'Gem rapport gemmer CSV med dialogens filtre');
  assert.match(r.tekst('network-report-feedback'), /gemt på denne computer/);
  r.elementer['network-status'].value = 'failed'; r.elementer['network-status'].udloes('change');
  assert.equal(r.tekst('network-report-summary'), 'Denne appkørsel · Fejl: 1 registreret kald til 1 destination.');
  r.elementer['network-format'].value = 'json'; await r.elementer['network-report-save'].onclick();
  assert.deepEqual(r.sidste(), ['save', { format: 'json', filters: { period: 'session', category: '', status: 'failed' } }]);
  // Ryd rapporten spørger først (N:E-4); først svaret i spørgsmålet sletter.
  r.elementer['network-report-clear'].onclick(); assert.notDeepEqual(r.sidste(), ['clear']);
  await r.elementer['network-report-clear-confirm'].onclick();
  assert.deepEqual(r.sidste(), ['clear']);
  assert.equal(r.tekst('network-report-summary'), 'Denne appkørsel · Fejl: ingen registrerede kald.'); assert.equal(r.raekker(), 0);
  assert.match(r.tekst('network-report-feedback'), /ryddet/); assert.equal(r.elementer['network-report-save'].disabled, false);
  r.dialog().close(); assert.equal(ramme.fokus, r.aaben, 'fokus lander på knappen, der åbnede dialogen');
});

test('R#39: dialogen siger, hvor og hvor længe registreringerne gemmes, og har Ryd rapporten bag Se detaljer', () => {
  const html = markup(), lag = foersteLag(html);
  assert.equal(network.RETENTION_DAYS, 30);
  assert.match(lag, /denne computer/); assert.match(lag, new RegExp(`højst ${network.RETENTION_DAYS} dage`), 'dialogen nævner samme grænse, som journalen bruger');
  const detaljer = html.slice(html.indexOf('<summary>Se detaljer</summary>'));
  assert.match(detaljer, /id="network-report-clear"[^>]*>Ryd rapporten</);
  assert.match(require('node:fs').readFileSync(UI, 'utf8'), /window\.harness\.networkReportClear\(/);
  assert.match(new NetworkJournal().snapshot().limits.join(' '), /30 dage/, 'eksporten siger også, hvor længe registreringerne gemmes');
});
