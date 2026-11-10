// K3, fund N:C1-2 (beta 3): forklaringen på et link eller en omdirigering, som forhåndsvisningen ikke viser, sagde «Den viser kun
// projektets egen side. Tryk ↻ for at komme tilbage til appen.». «Appen» kan læses som Aura, og teksten passede ikke, når adressen
// var projektets egen server under et andet navn, fx localhost i stedet for 127.0.0.1. Statuslinjen siger «↻ henter din side igen»
// (ui/app.js), så forklaringen bruger samme ord. Tilslutning af [::1], hvor ↻ gav samme blokering igen, afvises nu i preview:attach
// (tests/c1-ipv6-tilslutning.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { blockedNavigation, blockedRequest } = require('../core/preview-policy.cjs');
const { diagnosticForFrameBlock } = require('../core/preview-session.cjs');

const TEKST = 'Forhåndsvisningen kan ikke vise https://www.borger.dk. Den viser kun dit projekt på dets egen adresse. Tryk ↻ for at hente din side igen.';

test('forklaringen siger, hvad ↻ gør, med statuslinjens ord og uden ordet appen', () => {
  const link = blockedNavigation('https://www.borger.dk/om?x=1');
  assert.equal(link.message, TEKST);
  assert.doesNotMatch(link.message, /\bappen\b/i, '«appen» kan læses som Aura');
  // Statuslinjens detalje i ui/app.js bruger de samme ord om ↻.
  const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  assert.match(app, /↻ henter din side igen/);
  assert.match(link.message, /Tryk ↻ for at hente din side igen\./);
});

test('samme tekst for en omdirigering i webRequest og for appens frame-src i konsollen', () => {
  assert.equal(blockedRequest({ url: 'https://www.borger.dk/', resourceType: 'subFrame' }).message, TEKST);
  assert.equal(diagnosticForFrameBlock({ message: "Framing 'https://www.borger.dk/' violates the following Content Security Policy directive: \"frame-src aura-preview:\". The request has been blocked." }).message, TEKST);
});

test('teksten passer også, når adressen er projektets egen server under et andet navn', () => {
  // Projektet vises på 127.0.0.1:5173; siden linker til localhost:5173. Det er samme server, men ikke forhåndsvisningens adresse.
  const message = blockedNavigation('http://localhost:5173/side').message;
  assert.match(message, /^Forhåndsvisningen kan ikke vise http:\/\/localhost:5173\. Den viser kun dit projekt på dets egen adresse\./);
  assert.equal(blockedNavigation('ikke en adresse').message, 'Forhåndsvisningen kan ikke vise en anden adresse. Den viser kun dit projekt på dets egen adresse. Tryk ↻ for at hente din side igen.');
});
