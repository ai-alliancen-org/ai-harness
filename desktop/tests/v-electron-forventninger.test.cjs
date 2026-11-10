// Electron-prøverne skal vente på det, appen faktisk viser (Q:B2-1 og skeptikerens fund i scripts/measure-screens.cjs).
// Et nyt projekt med Versioner og fortryd godkender filændringer i projektet uden kort, og samtalen kvitterer i stedet; uden
// versioner spørger projektet som før (beslutning (c), 10. november 2026). Selve adfærden prøves med rigtig Git og med
// Electron-prøvernes egen Git-opsætning i tests/v-sikkerhedsnet-nye-projekter.test.cjs. Her kontrolleres scripterne mod den:
// et script, der venter på et kort, som aldrig kommer, hænger i Electron, og det kan Node-prøverne ellers ikke se.
// Prøven kører ikke Electron; den læser scripterne og bruger appens egen kvitteringstekst (ui/approval-view.js og ui/approvals.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktop = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(desktop, file), 'utf8');
const { receiptText } = require('../ui/approval-view.js');
// ui/approvals.js kvitterer en automatisk godkendt projektfil med etiketten «projektets filer».
const label = read('ui/approvals.js').match(/policy\?\.projectFile \? '([^']+)'/)?.[1];
const automatic = receiptText({ count: 1, automatic: true, label });
// Linjer, der venter på eller klikker et godkendelseskort.
const cardWaits = text => text.split('\n').filter(line => /Tillad (én gang|for denne opgave|altid)/.test(line) && /approve|waitFor|click/.test(line));
// Linjen med den blok ({), en linje står i: der læses baglæns, til en { ikke lukkes igen før linjen. Linjens egne parenteser
// (fx { timeout }) tæller ikke, så kun blokken omkring linjen findes.
function enclosing(text, target) {
  const lines = text.split('\n'); let depth = 0;
  for (let i = lines.indexOf(target) - 1; i >= 0; i--) {
    for (const char of [...lines[i]].reverse()) { if (char === '}') depth++; else if (char === '{' && --depth < 0) return lines[i]; }
  }
  return '';
}

test('appens kvittering for en automatisk godkendt filændring er den, prøverne venter på', () => {
  assert.equal(label, 'projektets filer');
  assert.equal(automatic, '1 handling godkendt automatisk: projektets filer.');
});

test('verify-features og verify-versions venter på kvitteringen i et projekt med versioner, ikke på et kort', () => {
  for (const file of ['scripts/verify-features.cjs', 'scripts/verify-versions.cjs']) {
    const text = read(file);
    assert.ok(text.includes(automatic), `${file} venter på kvitteringen «${automatic}»`);
    assert.deepEqual(cardWaits(text).filter(line => line.includes('Tillad for denne opgave')), [], `${file} venter ikke på «Tillad for denne opgave», som et nyt projekt med versioner aldrig viser`);
  }
  // I verify-features venter kun trin 6, projektet uden versioner, på et kort, og kun gennem sendTask uden version.
  const features = read('scripts/verify-features.cjs');
  assert.deepEqual(cardWaits(features).map(line => line.trim()), ["await helpers.approve(page, 'Tillad én gang');"]);
  assert.match(features, /if \(expectVersion\) await autoApproved\(receipts\);\s*else \{\s*await helpers\.approve\(page, 'Tillad én gang'\);/);
  assert.deepEqual(cardWaits(read('scripts/verify-versions.cjs')), []);
});

test('measure-screens venter kun på godkendelseskortet, når versionerne er slået fra, og ellers på kvitteringen', () => {
  const text = read('scripts/measure-screens.cjs');
  const waits = cardWaits(text);
  assert.ok(waits.length > 0, 'målingen af godkendelseskortet findes stadig for et projekt uden versioner');
  for (const line of waits) assert.match(enclosing(text, line), /if \(withoutVersions\)/, `kortet kommer kun uden versioner: ${line.trim()}`);
  assert.ok(text.includes(automatic), `med versioner venter målingen på kvitteringen «${automatic}»`);
  assert.match(text, /omitted: withoutVersions \? \[[^\]]*\] : \['Godkendelse af filændringer'\]/, 'maalinger.json siger, at kortet ikke måles med versioner');
});
