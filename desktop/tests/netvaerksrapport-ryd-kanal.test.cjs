// R#39: Ryd rapporten i dialogen Auras netværkskald kalder window.harness.networkReportClear. Kanalen skal findes i både preload.cjs
// og main.cjs, ellers fejler knappen med «Rapporten kunne ikke ryddes». Prøven fejler, indtil begge filer har kanalen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('R#39: kanalen network:clear findes i preload.cjs og main.cjs og rydder den fælles journal', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(preload, /^ {2}networkReportClear: 'network:clear',$/m, 'preload.cjs mangler networkReportClear');
  assert.match(main, /handle\('network:clear', [^\n]*networkJournal\.clear\(\)/, 'main.cjs mangler handleren network:clear');
  assert.match(fs.readFileSync(path.join(__dirname, '../ui/network-report.js'), 'utf8'), /window\.harness\.networkReportClear\(/, 'dialogen kalder kanalen');
});
