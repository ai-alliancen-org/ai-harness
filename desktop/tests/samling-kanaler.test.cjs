// Den omvendte vagt af tests/preload-channels.test.cjs: hvert kald fra brugerfladen skal have en kanal i preload.cjs og en
// handler i hovedprocessen. Mangler en af dem, fejler knappen først, når brugeren trykker på den. Det skete i beta 3 for
// «Fjern kun fra denne computer» i Udgiv (komplaiPublishForget, K1) og for Ryd rapporten i Auras netværkskald
// (networkReportClear, fund 39): kalderen fandtes i ui/, men kanalen manglede i preload.cjs og main.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktop = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(desktop, file), 'utf8');

test('hvert kald fra brugerfladen har en kanal i preload.cjs og en handler i hovedprocessen', () => {
  const preload = read('preload.cjs');
  const kanaler = new Map([...preload.matchAll(/^\s{2}(\w+):\s*'([a-z-]+:[a-z-]+)',?$/gm)].map(match => [match[1], match[2]]));
  assert.ok(kanaler.size > 100, `forventede hele kanallisten, fandt ${kanaler.size}`);
  // main.cjs registrerer med handle('kanal', ...). Vedhæftningernes kanaler registreres i core/chat-materials-ipc.cjs.
  const main = read('main.cjs'), materialer = read('core/chat-materials-ipc.cjs');
  const haandteret = kanal => main.includes(`handle('${kanal}'`) || materialer.includes(`'${kanal}'`);
  // Brugerfladen kalder window.harness.navn(...) direkte eller gennem en lille hjælper, der slår navnet op i window.harness:
  // call i app.js, api i deployment.js og hosting.js og invoke i updates.js.
  const ui = path.join(desktop, 'ui'), kald = new Map();
  for (const file of fs.readdirSync(ui).filter(name => name.endsWith('.js'))) {
    const kilde = fs.readFileSync(path.join(ui, file), 'utf8');
    for (const mønster of [/window\.harness\.(\w+)\(/g, /\bcall\('(\w+)'/g, /\bapi\('(\w+)'/g, /\binvoke\('(\w+)'/g]) {
      for (const match of kilde.matchAll(mønster)) kald.set(match[1], [...(kald.get(match[1]) || []), file]);
    }
  }
  assert.ok(kald.size > 100, `forventede brugerfladens kald, fandt ${kald.size}`);
  // selectContext og onEvent er preloadens egne funktioner, ikke IPC-kanaler.
  const egne = new Set(['selectContext', 'onEvent']);
  const udenKanal = [...kald].filter(([navn]) => !egne.has(navn) && !kanaler.has(navn)).map(([navn, filer]) => `${navn} (${[...new Set(filer)].join(', ')})`);
  assert.deepEqual(udenKanal, [], 'Brugerfladen kalder disse navne, men preload.cjs har ingen kanal til dem:\n' + udenKanal.join('\n'));
  const udenHandler = [...kald.keys()].filter(navn => kanaler.has(navn) && !haandteret(kanaler.get(navn))).map(navn => `${navn} (${kanaler.get(navn)})`);
  assert.deepEqual(udenHandler, [], 'Disse kanaler har ingen handler i hovedprocessen:\n' + udenHandler.join('\n'));
});
