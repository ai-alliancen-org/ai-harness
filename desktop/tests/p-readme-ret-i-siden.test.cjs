// Spor P (beta 3): afsnittet om Ret i siden i README skal læses i den rigtige rækkefølge. Sætningen «Det gør elementet til målet
// for næste besked» handler om **Bed AI'en ændre det** og skal stå lige efter den. Sætningerne om det ældre tekstformat (N:C2-7)
// stod imellem, så «Det» pegede på «brug Versioner».
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const afsnit = readme.split('\n').find(line => line.startsWith('- **Ret i siden:**'));

test('«Det gør elementet til målet» står lige efter Bed AI’en ændre det', () => {
  assert.ok(afsnit, 'afsnittet om Ret i siden findes');
  const anchor = "**Bed AI'en ændre det** er vejen videre.";
  const at = afsnit.indexOf(anchor);
  assert.ok(at >= 0, 'sætningen om Bed AI’en ændre det findes');
  const next = afsnit.slice(at + anchor.length).trimStart();
  assert.ok(next.startsWith('Det gør elementet til målet for næste besked'), `næste sætning er: ${next.slice(0, 80)}`);
});

test('sætningerne om citationstegn og det ældre tekstformat står stadig i afsnittet', () => {
  for (const text of ['strengens eget citationstegn', 'konvertere filen til UTF-8', '`<meta charset="windows-1252">`', 'Ændrer en AI-opgave sådan en fil, står den under Ændringer uden linje-diff, og Fortryd sætter den ikke tilbage, men siger det; brug Versioner.']) assert.ok(afsnit.includes(text), text);
});
