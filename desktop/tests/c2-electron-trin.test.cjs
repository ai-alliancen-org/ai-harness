// Spørgsmål Q:C1-5 og Q:C2-2 (beta 3): to forløb kan kun bevises helt i Electron, så de står som trin i Electron-prøverne:
// - scripts/verify-framework-preview.cjs: et blokeret billede, mens Vite kører, Tillad og den nye indholdspolitik uden genstart.
// - scripts/verify-desktop.cjs: /om uden / i den statiske forhåndsvisning sendes videre til /om/, og et relativt link virker.
// Denne prøve vogter, at trinnene står der, og at Electron-trinnets måling holder: et kald fra siden til dens egen adresse får
// forhåndsvisningens indholdspolitik med, så politikken kan læses uden at hente billedet fra nettet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installSession } = require('../core/preview-session.cjs');

const scripts = process.env.AURA_ELECTRON_SCRIPTS || path.join(__dirname, '../scripts');
const read = name => fs.readFileSync(path.join(scripts, name), 'utf8');

test('Electron-trinnets måling: et kald fra siden til dens egen adresse får indholdspolitikken med, også efter Tillad', () => {
  const page = 'http://127.0.0.1:5173/', network = { scripts: [], styles: [], connect: [], images: [] };
  const ctx = { key: 'react', root: '/react', externalPreview: page, devServer: { snapshot: () => ({ runtimeConfig: { mode: 'auto', network }, services: [] }) } };
  let headers;
  installSession({ protocol: { handle() {} }, webRequest: { onBeforeRequest() {}, onHeadersReceived(listener) { headers = listener; } } }, { contexts: () => [ctx] });
  const csp = () => { let answer; headers({ url: page, resourceType: 'xhr', initiatorOrigin: 'http://127.0.0.1:5173', frame: { url: page }, responseHeaders: {} }, value => { answer = value; }); return String(answer.responseHeaders['Content-Security-Policy']); };
  assert.doesNotMatch(csp(), /billeder\.example\.com/);
  // Som DevServer.useNetwork efter Tillad: den kørende server får den nye netliste.
  network.images = ['https://billeder.example.com'];
  assert.match(csp(), /img-src[^;]*https:\/\/billeder\.example\.com/);
});

test('verify-framework-preview.cjs har hele samtykkeforløbet med en kørende Vite-server', () => {
  const source = read('verify-framework-preview.cjs');
  assert.match(source, /Siden vil hente et billede fra \$\{billede\}/, 'spørgsmålet om billedet');
  assert.match(source, /name: 'Tillad denne adresse'/);
  assert.match(source, /Adressen er tilladt, og forhåndsvisningen er genindlæst\./);
  assert.match(source, /img-src\[\^;\]\*https:\\\/\\\/billeder\\\.example\\\.com/, 'den nye indholdspolitik for den kørende server');
  assert.match(source, /serveren er ikke genstartet/);
});

test('verify-desktop.cjs viser /om uden / i den statiske forhåndsvisning og følger et relativt link', () => {
  const source = read('verify-desktop.cjs');
  assert.match(source, /location\.href = '\/om';/);
  assert.match(source, /location\.pathname\), '\/om\/'/);
  assert.match(source, /location\.pathname\), '\/om\/kontakt\.html'/);
});
