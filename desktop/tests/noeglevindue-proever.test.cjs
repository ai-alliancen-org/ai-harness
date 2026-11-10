// Q:B1-6: siden 0.7.0-beta.1 afviser hovedprocessen en nøgle fra hovedvinduet («Nøglen indtastes i nøglevinduet. Brug
// Indtast nøgle.», main.cjs). Electron-prøverne skal derfor gemme en forbindelse med nøgle ad brugerens vej gennem
// nøglevinduet (ui-test-helpers.cjs addConnection og enterCredential). verify-windows-nsis-upgrade.cjs sendte stadig en rå
// nøgle fra hovedvinduet og forventede, at det lykkedes, så prøven ville fejle på Windows. Prøven her læser kun scripternes
// tekst; selve opgraderingsprøven kræver rigtig Windows og køres ikke her.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scripts = path.join(__dirname, '../scripts');
const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');

test('hovedprocessen afviser stadig en nøgle fra hovedvinduet, så prøverne må bruge nøglevinduet', () => {
  assert.match(main, /'apiKey' in value[^\n]*throw new Error\('Nøglen indtastes i nøglevinduet\. Brug Indtast nøgle\.'\)/);
});

test('ingen Electron-prøve forventer, at en rå nøgle fra hovedvinduet bliver gemt', () => {
  const problems = [];
  for (const name of fs.readdirSync(scripts).filter(file => file.endsWith('.cjs'))) {
    const lines = fs.readFileSync(path.join(scripts, name), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/window\.harness\.saveConnection\(/.test(line) || !/apiKey/.test(line)) return;
      // Kun en bevidst afvisning er i orden: resultatet skal kontrolleres som afvist (ok false).
      const result = /const (\w+) = await page\.evaluate/.exec(line)?.[1];
      const rest = lines.slice(index, index + 4).join('\n');
      if (!result || !new RegExp(`assert\\.equal\\(${result}\\.ok, false\\)`).test(rest)) problems.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(problems, [], 'gem forbindelsen med nøgle gennem nøglevinduet (helpers.addConnection med app)');
});

test('opgraderingsprøven på Windows gemmer forbindelsen gennem nøglevinduet og tæller katalogkald relativt', () => {
  const source = fs.readFileSync(path.join(scripts, 'verify-windows-nsis-upgrade.cjs'), 'utf8');
  assert.match(source, /helpers\.addConnection\(page, \{[^}]*apiKey: key[^}]*app[^}]*\}\)/, 'forbindelsen gemmes ad brugerens vej med nøglevinduet');
  // Nøglevinduet kontrollerer nøglen ved at hente kataloget, så antallet af kald før opdateringen er ikke længere 1.
  assert.doesNotMatch(source, /assert\.equal\(modelRequests, \d+/, 'kald tælles i forhold til tallet før opdateringen');
  assert.match(source, /assert\.equal\(modelRequests, requestsBeforeUpdate,/);
  assert.match(source, /assert\.equal\(modelRequests, requestsBeforeUpdate \+ 1\)/);
});
