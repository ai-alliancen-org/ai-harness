// Motoren genstartes kun, når motorens identitet ændres, den er stoppet, eller sandkassens tilstand skifter. En
// besked med sandkasse må ikke genstarte motoren, for så glemmer AI'en samtalen (årsag 4 i hackathon-aarsager.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { engineRestartNeeded } = require('../core/chat-session.cjs');

test('samme motor, aktiv, samme sandkasse: ingen genstart, også når sandkassen er tændt', () => {
  assert.equal(engineRestartNeeded({ identityChanged: false, engineActive: true, engineSandbox: true, sandboxNext: true }), false);
});

test('sandkassen skal tændes: motoren genstartes, fordi den er sat ved start; en eksisterende sandkasse beholdes', () => {
  assert.equal(engineRestartNeeded({ identityChanged: false, engineActive: true, engineSandbox: false, sandboxNext: true }), true);
  assert.equal(engineRestartNeeded({ identityChanged: false, engineActive: true, engineSandbox: true, sandboxNext: false }), false, 'skift fra Byg til Samtale genstarter ikke');
});

test('ændret motoridentitet eller stoppet motor genstarter altid', () => {
  assert.equal(engineRestartNeeded({ identityChanged: true, engineActive: true, engineSandbox: false, sandboxNext: false }), true);
  assert.equal(engineRestartNeeded({ identityChanged: false, engineActive: false, engineSandbox: false, sandboxNext: false }), true);
});
