// Fund N:C1-4 og spørgsmål Q:C1-6 (beta 3): beslutningen 3. november siger seks faner på én linje, der ruller sidelæns, og at den
// valgte fane altid står synligt. I styles.css gjaldt det kun under 430 px. Med sammenfoldet sidepanel ved 980 × 720 er arbejdsfladen
// ca. 493 px bred, så fanerne (ca. 511 px) brød over på to linjer, og DESIGN.md passede ikke. Der var heller ingen synlig markering af,
// at der er flere faner. Nu står fanerne altid på én linje, og en fadet kant viser, i hvilken retning der er flere faner.
// Prøven læser CSS og regler som tekst; selve udseendet måles i Electron af scripts/verify-workspace.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktop = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(desktop, 'ui/styles.css'), 'utf8');
// Reglerne for en vælger uden for @container og @media, i den rækkefølge de står.
function topLevel(selector) {
  const rules = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) { const head = css.slice(css.lastIndexOf('}', start) + 1, start).replace(/\/\*[\s\S]*?\*\//g, '').trim(); if (head === selector) rules.push(css.slice(start + 1, i)); }
    }
  }
  return rules.join(';');
}

test('fanerne står altid på én linje og ruller sidelæns, uanset arbejdsfladens bredde', () => {
  const strip = topLevel('.work-tabs');
  assert.match(strip, /flex-wrap:\s*nowrap/, 'ikke kun under 430 px');
  assert.match(strip, /overflow-x:\s*auto/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.work-tabs\s*\{[^}]*flex-wrap:\s*wrap/, 'ingen regel lader fanerne bryde over på to linjer');
  assert.match(topLevel('.work-tab'), /flex:\s*none/, 'en fane bliver aldrig klemt sammen');
});

test('en fadet kant viser, at der er flere faner i den retning, og forsvinder ved enden', () => {
  const strip = topLevel('.work-tabs');
  // Dækfladerne ruller med indholdet (local) og dækker skyggen ved enden; skyggerne står fast i kanten (scroll).
  assert.equal((strip.match(/no-repeat local/g) || []).length, 2, 'to dækflader, venstre og højre');
  assert.equal((strip.match(/no-repeat scroll/g) || []).length, 2, 'to skygger, venstre og højre');
  assert.match(strip, /var\(--shadow\)/, 'skyggen bruger temaets skyggefarve, så den passer i lyst og mørkt tema');
  assert.match(strip, /var\(--surface\)/, 'dækfladen har stribens egen baggrund');
});

test('DESIGN.md beskriver det samme som CSS, og Electron-prøven måler det med sammenfoldet sidepanel', () => {
  const design = fs.readFileSync(path.join(desktop, 'DESIGN.md'), 'utf8');
  const rule = design.split('\n').find(line => line.includes('Sidepanelet kan foldes sammen til ikoner'));
  assert.ok(rule, 'reglen om fanerne findes');
  assert.match(rule, /altid på én linje/);
  assert.match(rule, /ruller striben sidelæns/);
  assert.match(rule, /fadet kant/);
  assert.match(rule, /Den valgte fane står altid helt synligt/);
  assert.doesNotMatch(rule, /må de bryde|når arbejdsfladen er smal/);
  const verify = fs.readFileSync(path.join(desktop, 'scripts/verify-workspace.cjs'), 'utf8');
  assert.match(verify, /fanerne står på én linje med sammenfoldet sidepanel/);
  assert.match(verify, /den fadede kant viser flere faner/);
});
