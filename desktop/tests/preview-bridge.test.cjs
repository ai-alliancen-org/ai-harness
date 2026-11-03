// AI'en kan starte forhåndsvisningen gennem værktøjet aura_preview (beslutning for beta 2). Værktøjet taler med hovedprocessen gennem
// en lokal bro med hemmelig nøgle. Broen kan kun starte og spørge til status for det projekt, pluginet blev skrevet til.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const preview = require('../core/preview-bridge.cjs');

test('broen svarer kun med den rigtige nøgle og kun for det rigtige projekt', async t => {
  const calls = [];
  const bridge = await preview.listen({ start: async ({ root }) => { calls.push(['start', root]); return { state: 'running', url: 'http://localhost:5173/' }; }, status: async ({ root }) => ({ state: 'idle', root }) });
  t.after(() => bridge.close());
  const send = (headers, body) => fetch(bridge.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await send({}, { action: 'status', root: '/p' })).status, 401);
  assert.equal((await send({ authorization: 'Bearer forkert' }, { action: 'status', root: '/p' })).status, 401);
  const ok = await send({ authorization: `Bearer ${bridge.token}` }, { action: 'start', root: '/p' });
  assert.equal(ok.status, 200); assert.equal((await ok.json()).state, 'running'); assert.deepEqual(calls, [['start', '/p']]);
  assert.equal((await send({ authorization: `Bearer ${bridge.token}` }, { action: 'slet-alt', root: '/p' })).status, 400, 'ukendt handling afvises');
  assert.equal((await send({ authorization: `Bearer ${bridge.token}` }, { action: 'start' })).status, 400, 'rod mangler');
});

test('en fejl i håndteringen bliver til en dansk fejltekst, ikke en stakspor', async t => {
  const bridge = await preview.listen({ start: async () => { throw new Error('Installér projektets pakker først.'); }, status: async () => ({}) });
  t.after(() => bridge.close());
  const response = await fetch(bridge.url, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', root: '/p' }) });
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.state, 'error'); assert.match(body.message, /Installér projektets pakker først/); assert.doesNotMatch(JSON.stringify(body), /at .*\.cjs/);
});

test('pluginkilden indeholder værktøjet og kun den nøgle og rod, den blev skrevet til', () => {
  const source = preview.pluginSource({ url: 'http://127.0.0.1:1234/', token: 'hemmelig', root: '/projekt' });
  assert.match(source, /aura_preview/); assert.match(source, /"hemmelig"/); assert.match(source, /"\/projekt"/);
  assert.match(source, /enum\(\['start', 'status'\]\)/);
});

test('samtykket gælder kun, så længe projektets fingeraftryk er uændret', () => {
  assert.equal(preview.consentValid({ fingerprint: 'a', scripts: false }, 'a'), true);
  assert.equal(preview.consentValid({ fingerprint: 'a' }, 'b'), false);
  assert.equal(preview.consentValid(null, 'a'), false);
});

test('prompten henviser AI\'en til værktøjet i stedet for at starte servere med kommandoer', () => {
  const guidance = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'project-guidance.cjs'), 'utf8');
  assert.match(guidance, /aura_preview/); assert.match(guidance, /needs_consent/);
});
