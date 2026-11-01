// SPDX-License-Identifier: EUPL-1.2
'use strict';
const TYPES = new Set(['model','catalog','integration','preview','git','update','subprocess']);
const STATUSES = new Set(['completed','failed','cancelled','attempted','headers','receiving','interrupted']);
function select(snapshot, filters = {}, now = Date.now()) {
  const category = TYPES.has(filters?.category) ? filters.category : '';
  const status = STATUSES.has(filters?.status) ? filters.status : '';
  const since = filters?.period === '5m' ? now - 300000 : filters?.period === 'session' ? Date.parse(snapshot.startedAt) : 0;
  return {...snapshot, generatedAt:new Date(now).toISOString(), filters:{category,status,period:['5m','session'].includes(filters?.period)?filters.period:'all'},
    records:snapshot.records.filter(row => (!category || row.category === category) && (!status || row.status === status) && (!since || Date.parse(row.startedAt) >= since))};
}
function cell(value) {
  // Spreadsheet formula injection is still possible with hostname-like labels
  // starting with '-' or user-controlled strings in future journal adapters.
  const raw = value === null || value === undefined ? 'Ikke målt' : String(value);
  const safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"','""') + '"';
}
function serialize(report, format) {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
  if (format !== 'csv') throw new Error('Vælg CSV eller JSON.');
  const fields = ['startedAt','category','purpose','host','locality','method','status','httpStatus','attempt','headersMs','firstBodyMs','totalMs','sentBytes','receivedBytes','errorCategory'];
  const rows = [fields, ...(report.records.length ? report.records.map(record => fields.map(field => record[field])) : [fields.map(() => '')])];
  // CSV includes coverage, retention and limits as columns on each record so a
  // detached export cannot quietly look like a complete machine traffic log.
  const coverage = report.coverage.map(item => `${item.category}: ${item.status} (${item.note || ''})`).join(' | ');
  const limits = (report.limits || []).join(' | ');
  const extra = ['scope','coverage','limits','dropped'];
  return '\uFEFF' + rows.map((row,index) => [...row,...(index ? [report.scope,coverage,limits,report.dropped] : extra)].map(cell).join(',')).join('\r\n') + '\r\n';
}
module.exports = {select,serialize};
