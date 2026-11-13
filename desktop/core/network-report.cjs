// SPDX-License-Identifier: EUPL-1.2
'use strict';
const TYPES = new Set(['model','catalog','integration','preview','git','update','subprocess']);
const STATUSES = new Set(['completed','failed','cancelled','attempted','headers','receiving','interrupted']);
// Samme ord som i dialogen (ui/network-report.js), så en gemt fil siger det samme som skærmen.
const PERIOD_LABELS = { session: 'Denne appkørsel', '5m': 'Seneste 5 minutter', all: 'Alle gemte registreringer' };
const TYPE_LABELS = { model: 'AI-model', catalog: 'Modelkatalog', integration: 'Integration', preview: 'Forhåndsvisning', git: 'Git', update: 'Opdateringer', subprocess: 'Underprocesser' };
const STATUS_LABELS = { completed: 'Gennemført', failed: 'Fejl', cancelled: 'Afbrudt', attempted: 'Venter på svar', headers: 'Svar startet', receiving: 'Modtager svar', interrupted: 'Uafsluttet ved genstart' };
function select(snapshot, filters = {}, now = Date.now()) {
  const category = TYPES.has(filters?.category) ? filters.category : '';
  const status = STATUSES.has(filters?.status) ? filters.status : '';
  const period = ['5m','session'].includes(filters?.period) ? filters.period : 'all';
  const since = period === '5m' ? now - 300000 : period === 'session' ? Date.parse(snapshot.startedAt) : 0;
  const records = snapshot.records.filter(row => (!category || row.category === category) && (!status || row.status === status) && (!since || Date.parse(row.startedAt) >= since));
  // Periodens start og antallet i hele journalen følger med, så en eksport ikke kan læses som hele loggen, når den er et udsnit.
  // «Alle» starter ved det tidligste af registreringens start og det ældste kald.
  const starts = [snapshot.recordingStartedAt, ...snapshot.records.map(row => row.startedAt)].map(value => Date.parse(value)).filter(Number.isFinite);
  const periodFrom = since ? new Date(since).toISOString() : starts.length ? new Date(Math.min(...starts)).toISOString() : null;
  return {...snapshot, generatedAt:new Date(now).toISOString(), filters:{category,status,period}, periodFrom, totalRecords:snapshot.records.length, records};
}
// Kun målinger står som «Ikke målt», når de mangler. Et tomt felt i errorCategory eller attempt betyder ingen fejl eller intet nummer.
const MEASURED = new Set(['httpStatus','headersMs','firstBodyMs','totalMs','sentBytes','receivedBytes']);
function text(field, value) {
  if (value === null || value === undefined) return MEASURED.has(field) ? 'Ikke målt' : '';
  // Decimalkomma, så dansk Excel læser 123,457 ms som et tal og ikke som 123457.
  return typeof value === 'number' ? String(value).replace('.', ',') : String(value);
}
function cell(raw) {
  // En celle, der starter med =, +, @ eller -, kan blive en formel i et regneark. Den får en apostrof foran.
  const safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"','""') + '"';
}
function describe(report) {
  const filters = report.filters || {};
  return [`Periode: ${PERIOD_LABELS[filters.period] || PERIOD_LABELS.all}`, `Type: ${TYPE_LABELS[filters.category] || 'Alle typer'}`, `Status: ${STATUS_LABELS[filters.status] || 'Alle statusser'}`].join(' · ');
}
function serialize(report, format) {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
  if (format !== 'csv') throw new Error('Vælg CSV eller JSON.');
  const fields = ['startedAt','category','purpose','host','locality','method','status','httpStatus','attempt','headersMs','firstBodyMs','totalMs','sentBytes','receivedBytes','errorCategory'];
  const rows = report.records.length ? report.records.map(record => fields.map(field => text(field, record[field]))) : [fields.map(() => '')];
  // Filter, periode, udsnit, dækning og begrænsninger står som kolonner på hver linje, så en løsrevet eksport hverken kan ligne
  // en fuld trafiklog for computeren eller hele Auras log, når den er et udsnit.
  const coverage = (report.coverage || []).map(item => `${item.category}: ${item.status} (${item.note || ''})`).join(' | ');
  const limits = (report.limits || []).join(' | ');
  const total = Number.isSafeInteger(report.totalRecords) ? report.totalRecords : report.records.length;
  const extra = ['filter','periodFrom','generatedAt','selection','scope','coverage','limits','dropped'];
  const context = [describe(report), report.periodFrom || '', report.generatedAt || '', `${report.records.length} af ${total} registreringer`, report.scope, coverage, limits, text('dropped', report.dropped)];
  // Semikolon som feltskel, som dansk Excel bruger. BOM gør, at æ, ø og å læses rigtigt. Ingen sep=-linje: den får Excel til at
  // overse BOM. Alle felter står i anførselstegn, så semikolon i en tekst aldrig deler cellen.
  return '\uFEFF' + [[...fields, ...extra], ...rows.map(row => [...row, ...context])].map(row => row.map(value => cell(String(value ?? ''))).join(';')).join('\r\n') + '\r\n';
}
module.exports = {select,serialize};
